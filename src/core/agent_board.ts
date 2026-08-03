import { DateTime } from "luxon";
import type { Projection, Task } from "../types.js";
import type { Config } from "./config.js";
import { taskGrossMin, collectIntervals } from "./replay.js";
import { formatMin } from "./time.js";
import { report, windowFor, quadrant } from "./report.js";

// The text-only "agent board": a lean, descriptive, diff-friendly companion to
// the visual board.html. Deliberately NO charts, Mermaid, ASCII-art, or unicode
// bars — just prose lines and indented outlines an agent (or git) can read.

const COLS = ["doing", "todo", "paused", "blocked", "done"] as const;
const COL_TITLE: Record<(typeof COLS)[number], string> = {
  doing: "Doing",
  todo: "To Do",
  paused: "Paused",
  blocked: "Blocked",
  done: "Done",
};
const CLASS: Record<string, string> = {
  Q1: "class A, do first",
  Q2: "class B, valuable",
  Q3: "class C, delegate",
  Q4: "class D, low-value",
};

function zoneOf(config: Config): string | undefined {
  return !config.timezone || config.timezone === "system" ? undefined : config.timezone;
}
function toDT(iso: string, config: Config): DateTime {
  const z = zoneOf(config);
  const d = DateTime.fromISO(iso);
  return z ? d.setZone(z) : d;
}

/** "due 2026-08-14 (in 11 days)" / "overdue since 2026-08-01 (2 days ago)" / "". */
function deadlineDesc(t: Task, nowISO: string, config: Config): string {
  if (!t.deadline) return "";
  const z = zoneOf(config);
  const dueEnd = DateTime.fromISO(t.deadline, z ? { zone: z } : {}).endOf("day");
  const days = Math.round(dueEnd.diff(toDT(nowISO, config).startOf("day"), "days").days);
  if (t.status === "done") return `deadline ${t.deadline}`;
  if (days < 0) return `overdue since ${t.deadline} (${-days} day${days === -1 ? "" : "s"} ago)`;
  if (days === 0) return `due ${t.deadline} (today)`;
  return `due ${t.deadline} (in ${days} day${days === 1 ? "" : "s"})`;
}

/** est / logged / remaining, described in words. */
function effortDesc(t: Task, nowISO: string): string {
  const logged = taskGrossMin(t, nowISO);
  if (!t.estMin) return logged > 0 ? `no estimate, logged ${formatMin(logged)}` : "no estimate";
  const rem = Math.max(0, t.estMin - logged);
  const pct = Math.min(100, Math.round((logged / t.estMin) * 100));
  return `estimate ${formatMin(t.estMin)}, logged ${formatMin(logged)}, ${formatMin(rem)} remaining (${pct}%)`;
}

function taskSentence(p: Projection, t: Task, nowISO: string, config: Config, showProject: boolean): string {
  const parts = [`importance ${t.importance}, urgency ${t.urgency} (${CLASS[quadrant(t)]})`];
  if (showProject && t.project) parts.push(`project ${t.project}`);
  parts.push(effortDesc(t, nowISO));
  const dl = deadlineDesc(t, nowISO, config);
  if (dl) parts.push(dl);
  const kids = [...p.tasks.values()].filter((c) => c.parent === t.id).length;
  if (kids) parts.push(`${kids} subtask${kids === 1 ? "" : "s"}`);
  return `\`${t.id}\` "${t.title}" — ${parts.join("; ")}.`;
}

/** Gross minutes on a task within [lo, hi). */
function grossIn(t: Task, nowISO: string, lo: number, hi: number): number {
  let s = 0;
  for (const iv of collectIntervals([t], nowISO, lo, hi)) s += (iv.end - iv.start) / 60000;
  return s;
}

export function agentBoard(p: Projection, config: Config, nowISO: string, project?: string): string {
  const ids = p.order.filter((id) => !project || p.tasks.get(id)!.project === project);
  const tasks = ids.map((id) => p.tasks.get(id)!);
  const doing = tasks.filter((t) => t.status === "doing").length;
  const generated = toDT(nowISO, config).toFormat("yyyy-LL-dd HH:mm");
  const showProject = !project;

  const out: string[] = ["# Tempo — Agent Board", ""];
  out.push("_Text view for agents; open `board.html` for the visual board. Auto-generated — do not edit by hand._", "");
  out.push(`**${tasks.length}** task${tasks.length === 1 ? "" : "s"} · **${doing}** in progress · updated ${generated}${project ? ` · project ${project}` : ""}.`, "");

  // ---- tasks by status ----
  out.push("## Tasks by status", "");
  for (const col of COLS) {
    const items = tasks.filter((t) => t.status === col);
    if (col !== "doing" && col !== "todo" && items.length === 0) continue;
    out.push(`### ${COL_TITLE[col]} (${items.length})`, "");
    if (items.length === 0) out.push("_none_", "");
    for (const t of items) out.push(`- ${taskSentence(p, t, nowISO, config, showProject)}`);
    out.push("");
  }

  // ---- work breakdown (indented outline; parents summarise subtree) ----
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of ids) {
    const t = p.tasks.get(id)!;
    if (t.parent && (!project || p.tasks.get(t.parent)?.project === project) && p.tasks.has(t.parent)) {
      (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(id);
    } else {
      roots.push(id);
    }
  }
  const hasTree = [...children.values()].some((c) => c.length);
  if (hasTree) {
    out.push("## Work breakdown", "");
    const subtree = (id: string): { est: number; logged: number } => {
      const t = p.tasks.get(id)!;
      const acc = { est: t.estMin ?? 0, logged: taskGrossMin(t, nowISO) };
      for (const c of children.get(id) ?? []) {
        const s = subtree(c);
        acc.est += s.est;
        acc.logged += s.logged;
      }
      return acc;
    };
    const emit = (id: string, depth: number): void => {
      const t = p.tasks.get(id)!;
      const kids = children.get(id) ?? [];
      const agg = kids.length ? subtree(id) : { est: t.estMin ?? 0, logged: taskGrossMin(t, nowISO) };
      const rem = Math.max(0, agg.est - agg.logged);
      const scope = kids.length ? "subtree" : "";
      const effort = agg.est
        ? `${scope ? scope + " " : ""}estimate ${formatMin(agg.est)}, logged ${formatMin(agg.logged)}, ${formatMin(rem)} remaining`
        : agg.logged
          ? `logged ${formatMin(agg.logged)}`
          : "no estimate";
      const done = t.status === "done" ? ", done" : "";
      out.push(`${"  ".repeat(depth)}- \`${t.id}\` (${CLASS[quadrant(t)].split(",")[0]}${done}) — ${effort}.`);
      for (const c of kids) emit(c, depth + 1);
    };
    for (const r of roots) emit(r, 0);
    out.push("");
  }

  // ---- schedule (described in words) ----
  out.push("## Schedule", "");
  const active = tasks.filter((t) => t.spans.some((s) => s.end === undefined));
  out.push(active.length ? `- Active now: ${active.map((t) => `\`${t.id}\``).join(", ")}.` : "- Active now: nothing running.");

  const week = windowFor("week", p, nowISO, config);
  const thisWeek = tasks
    .map((t) => ({ t, g: grossIn(t, nowISO, week.start, week.end) }))
    .filter((x) => x.g > 0)
    .sort((a, b) => b.g - a.g);
  if (thisWeek.length) out.push(`- Worked ${week.label}: ${thisWeek.map((x) => `\`${x.t.id}\` ${formatMin(x.g)}`).join(", ")}.`);

  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.deadline)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1));
  const overdue = upcoming.filter((t) => deadlineDesc(t, nowISO, config).startsWith("overdue"));
  if (overdue.length) out.push(`- Overdue: ${overdue.map((t) => `\`${t.id}\` (${t.deadline})`).join(", ")}.`);
  else out.push("- Overdue: none.");
  const future = upcoming.filter((t) => !deadlineDesc(t, nowISO, config).startsWith("overdue"));
  if (future.length) out.push(`- Upcoming deadlines: ${future.map((t) => `\`${t.id}\` ${deadlineDesc(t, nowISO, config)}`).join(", ")}.`);
  out.push("");

  // ---- time & priority (plain text) ----
  const today = report(p, config, nowISO, { window: "today", by: "project" });
  const wk = report(p, config, nowISO, { window: "week", by: "project" });
  if (wk.grossMin === 0 && today.grossMin === 0) {
    out.push("## Time & priority", "", "_No time logged yet — start a task and it'll show up here._", "");
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  const wq = report(p, config, nowISO, { window: "week", by: "quadrant" });
  const qmap = new Map(wq.distribution);
  const share = (q: string) => (wq.grossMin > 0 ? Math.round(((qmap.get(q) ?? 0) / wq.grossMin) * 100) : 0);

  out.push("## Time & priority", "");
  out.push(`- Today: ${formatMin(today.netMin)} worked (gross ${formatMin(today.grossMin)}).`);
  out.push(`- ${wk.win.label[0].toUpperCase() + wk.win.label.slice(1)}: net ${formatMin(wk.netMin)}, gross ${formatMin(wk.grossMin)} (×${wk.multitaskFactor.toFixed(2)} multitask), ${wk.interruptions} interruption${wk.interruptions === 1 ? "" : "s"}.`);
  if (wk.distribution.length) {
    out.push(`- By project: ${wk.distribution.map(([k, v]) => `${k} ${formatMin(v)} (${Math.round((v / wk.grossMin) * 100)}%)`).join(", ")}.`);
  }
  out.push(`- Priority mix: B valuable ${share("Q2")}%, A firefighting ${share("Q1")}%, C interruptions ${share("Q3")}%, D low-value ${share("Q4")}%.`);

  // per-axis split, described
  const imp = new Map<number, number>();
  const urg = new Map<number, number>();
  let axisTotal = 0;
  for (const t of tasks) {
    const g = grossIn(t, nowISO, week.start, week.end);
    if (g <= 0) continue;
    imp.set(t.importance, (imp.get(t.importance) ?? 0) + g);
    urg.set(t.urgency, (urg.get(t.urgency) ?? 0) + g);
    axisTotal += g;
  }
  if (axisTotal > 0) {
    const fmt = (m: Map<number, number>) =>
      [...m.entries()].sort((a, b) => b[0] - a[0]).map(([s, v]) => `${s}: ${formatMin(v)}`).join(", ");
    out.push(`- By importance: ${fmt(imp)}.`);
    out.push(`- By urgency: ${fmt(urg)}.`);
  }
  if (wk.eva.length) {
    out.push(
      `- Estimates vs actual: ${wk.eva
        .map((e) => {
          const v = Math.abs(e.ratio - 1) <= 0.1 ? "on target" : `${e.ratio.toFixed(1)}× estimate`;
          return `\`${e.id}\` ${formatMin(e.actual)} vs ${formatMin(e.est)} (${v})`;
        })
        .join(", ")}.`,
    );
  }
  if (wk.onTrack) {
    out.push(`- Sprint: ${formatMin(wk.onTrack.remainingMin)} remaining vs ${formatMin(wk.onTrack.capacityMin)} capacity → ${wk.onTrack.verdict}.`);
  }
  out.push("");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
