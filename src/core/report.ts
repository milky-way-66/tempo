import { DateTime } from "luxon";
import type { Projection, Task, Score } from "../types.js";
import type { Config } from "./config.js";
import { collectIntervals, unionMinutes, taskGrossMin } from "./replay.js";
import { formatMin } from "./time.js";

const COLS = ["todo", "doing", "paused", "blocked", "done"] as const;

// A task counts as "important"/"urgent" once its 1–5 score reaches this bar —
// the split that maps the two axes onto Eisenhower quadrants.
const HI = 4;

export interface BoardItem {
  id: string;
  title: string;
  importance: Score;
  urgency: Score;
  project?: string;
}

export function board(p: Projection, project?: string): Record<string, BoardItem[]> {
  const cols: Record<string, BoardItem[]> = {
    todo: [],
    doing: [],
    paused: [],
    blocked: [],
    done: [],
  };
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    if (project && t.project !== project) continue;
    cols[t.status].push({ id: t.id, title: t.title, importance: t.importance, urgency: t.urgency, project: t.project });
  }
  return cols;
}

export function boardText(p: Projection, project?: string): string {
  const cols = board(p, project);
  const lines: string[] = [];
  for (const c of COLS) {
    const items = cols[c];
    lines.push(`${c.toUpperCase()} (${items.length})`);
    for (const it of items) {
      lines.push(`  • ${it.id} — ${it.title}${it.project ? ` [${it.project}]` : ""} (i${it.importance}/u${it.urgency})`);
    }
  }
  return lines.join("\n");
}

const COL_TITLES: Record<(typeof COLS)[number], string> = {
  todo: "📋 To Do",
  doing: "🔨 Doing",
  paused: "⏸️ Paused",
  blocked: "🚧 Blocked",
  done: "✅ Done",
};
// Always show these; paused/blocked are shown only when they hold something.
const CORE_COLS = new Set<(typeof COLS)[number]>(["todo", "doing", "done"]);

/** Escape Markdown table-cell delimiters. */
const esc = (s: string) => s.replace(/\|/g, "\\|");

/** A fixed-width unicode meter for a 0–100 percentage. */
function bar(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---- per-task metric helpers ----

/** Logged (gross) minutes over a task's whole life. */
function loggedMin(t: Task, nowISO: string): number {
  return taskGrossMin(t, nowISO);
}

/** Progress toward the estimate, 0–100, clamped. Undefined when unestimated. */
function progressPct(t: Task, nowISO: string): number | undefined {
  if (!t.estMin) return undefined;
  return Math.min(100, Math.round((loggedMin(t, nowISO) / t.estMin) * 100));
}

/** Deadline marker with severity: overdue ⚠️, urgent ⏰ (≤2d), else scheduled 📅. */
function deadlineMark(t: Task, nowMs: number, config: Config): string {
  if (!t.deadline) return "";
  const z = zoneOf(config);
  const dl = DateTime.fromISO(t.deadline, z ? { zone: z } : {}).endOf("day").toMillis();
  const days = (dl - nowMs) / 86400000;
  if (t.status === "done") return ` 📅 ${t.deadline}`;
  if (days < 0) return ` ⚠️ ${t.deadline} overdue`;
  if (days <= 2) return ` ⏰ ${t.deadline}`;
  return ` 📅 ${t.deadline}`;
}

const STATUS_ICON: Record<Task["status"], string> = {
  todo: "📋",
  doing: "🔨",
  paused: "⏸️",
  blocked: "🚧",
  done: "✅",
};

// A per-task weekly-load sparkline scaled to that task's own busiest week, so
// the shape reads at a glance even for small tasks. "·" marks an empty week.
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function spark(vals: number[]): string {
  const max = Math.max(...vals);
  if (max <= 0) return "·".repeat(vals.length);
  return vals.map((v) => (v <= 0 ? "·" : SPARK[Math.min(7, Math.max(0, Math.round((v / max) * 7)))])).join("");
}

// Eisenhower quadrants, ranked A–D. A = urgent+important (do first),
// B = important not-urgent (the valuable work — schedule it), C = urgent-only
// (interruptions — delegate), D = neither (eliminate).
const QUAD_ABCD: Record<string, string> = { Q1: "A", Q2: "B", Q3: "C", Q4: "D" };

/** The A/B/C/D class of a task on the importance × urgency matrix. */
function abcd(t: Task): string {
  return QUAD_ABCD[quadrant(t)];
}

/**
 * Render the board as a GitHub-flavored Markdown kanban grid plus a metrics
 * dashboard (time totals, distribution by project and quadrant, sprint plan,
 * estimates). Regenerated after every event so the `.tempo/board.md` file is
 * always a live view of the current state.
 */
export function boardMarkdown(p: Projection, config: Config, nowISO: string, project?: string): string {
  const cols = board(p, project);
  const shown = COLS.filter((c) => CORE_COLS.has(c) || cols[c].length > 0);
  const nowMs = Date.parse(nowISO);

  const cell = (it: BoardItem): string => {
    const t = p.tasks.get(it.id)!;
    const flag = it.importance >= HI ? " ⚑" : "";
    const cls = ` **${abcd(t)}**·i${it.importance}u${it.urgency}`;
    const proj = it.project ? ` _[${esc(it.project)}]_` : "";
    const pct = progressPct(t, nowISO);
    const prog = pct !== undefined && t.status !== "done" ? ` ${bar(pct, 4)} ${pct}%` : "";
    const dl = deadlineMark(t, nowMs, config);
    return `\`${it.id}\` ${esc(it.title)}${flag}${cls}${proj}${prog}${dl}`;
  };

  const columns = shown.map((c) => cols[c].map(cell));
  const rowCount = columns.reduce((m, col) => Math.max(m, col.length), 0);

  const header = `| ${shown.map((c) => `${COL_TITLES[c]} (${cols[c].length})`).join(" | ")} |`;
  const sep = `| ${shown.map(() => "---").join(" | ")} |`;
  const bodyRows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    bodyRows.push(`| ${columns.map((col) => col[r] ?? "").join(" | ")} |`);
  }
  if (rowCount === 0) bodyRows.push(`| ${shown.map(() => "—").join(" | ")} |`);

  const total = p.order.filter((id) => !project || p.tasks.get(id)!.project === project).length;
  const doing = cols.doing.length;
  const generated = toDT(nowISO, config).toFormat("yyyy-LL-dd HH:mm");

  const lines: string[] = ["# Tempo Board", ""];
  lines.push(`> **${total}** task${total === 1 ? "" : "s"} · **${doing}** in progress · updated ${generated}`);
  if (project) lines.push(">", `> project: **${esc(project)}**`);
  lines.push("", header, sep, ...bodyRows, "");
  lines.push(
    "_⚑ important · ▓ progress · ⏰ due ≤2d · ⚠️ overdue · 📅 scheduled — auto-generated after each change; do not edit by hand._",
    "",
  );
  lines.push(...projectRollup(p, nowISO, project));
  lines.push(...workBreakdown(p, config, nowISO, project));
  lines.push(metricsMarkdown(p, config, nowISO));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---- project rollup: lifetime estimate vs logged, per project ----

/** Sum estimate/logged/remaining across tasks, grouped by project. */
function projectRollup(p: Projection, nowISO: string, project?: string): string[] {
  const rows = new Map<string, { est: number; logged: number }>();
  let anyEst = false;
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    if (project && t.project !== project) continue;
    const key = t.project ?? "(none)";
    const r = rows.get(key) ?? { est: 0, logged: 0 };
    if (t.estMin) (r.est += t.estMin), (anyEst = true);
    r.logged += loggedMin(t, nowISO);
    rows.set(key, r);
  }
  if (rows.size === 0 || !anyEst) return [];

  const out = ["## Project rollup", "", "| Project | Est | Logged | Remaining | Progress |", "| --- | ---: | ---: | ---: | :--- |"];
  const entries = [...rows.entries()].sort((a, b) => b[1].est - a[1].est);
  const totals = { est: 0, logged: 0 };
  const line = (label: string, est: number, logged: number, bold = false) => {
    const rem = Math.max(0, est - logged);
    const pct = est > 0 ? Math.min(100, Math.round((logged / est) * 100)) : 0;
    const cell = bold ? `**${esc(label)}**` : esc(label);
    const meter = est > 0 ? `\`${bar(pct)}\` ${pct}%` : "—";
    return `| ${cell} | ${est ? formatMin(est) : "—"} | ${formatMin(logged)} | ${est ? formatMin(rem) : "—"} | ${meter} |`;
  };
  for (const [k, v] of entries) {
    out.push(line(k, v.est, v.logged));
    totals.est += v.est;
    totals.logged += v.logged;
  }
  if (entries.length > 1) out.push(line("all", totals.est, totals.logged, true));
  out.push("");
  return out;
}

// ---- Work Breakdown: a 3-week, time-series WBS tree ----

interface WeekCol {
  start: number; // epoch ms, inclusive
  end: number; // epoch ms, exclusive
  label: string;
}

/** Last / this / next calendar week as epoch windows. */
function threeWeekCols(nowISO: string, config: Config): WeekCol[] {
  const cur = toDT(nowISO, config).startOf("week");
  const mk = (s: DateTime, label: string): WeekCol => ({
    start: s.toMillis(),
    end: s.plus({ weeks: 1 }).toMillis(),
    label,
  });
  return [mk(cur.minus({ weeks: 1 }), "last"), mk(cur, "this"), mk(cur.plus({ weeks: 1 }), "next")];
}

/** Gross minutes logged on a task within each week column. */
function weeklyLoad(t: Task, nowISO: string, cols: WeekCol[]): number[] {
  return cols.map((c) => {
    let sum = 0;
    for (const i of collectIntervals([t], nowISO, c.start, c.end)) sum += (i.end - i.start) / 60000;
    return sum;
  });
}

/**
 * The Work Breakdown section: a WBS tree (parent → child, indented) scoped to a
 * rolling 3-week window (last · this · next). Every not-done task is "current
 * work"; done tasks appear only if they logged time in the window. Ancestors of
 * any shown task are always included so the hierarchy stays intact. Each row
 * carries a per-week load sparkline (time series), a progress meter, and
 * estimate/logged/remaining rolled up over its subtree.
 */
function workBreakdown(p: Projection, config: Config, nowISO: string, project?: string): string[] {
  const cols = threeWeekCols(nowISO, config);
  const nowMs = Date.parse(nowISO);
  const lo = cols[0].start;
  const hi = cols[cols.length - 1].end;

  // 1. Which tasks are in scope.
  const inScope = new Set<string>();
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    if (project && t.project !== project) continue;
    const loggedInWin = collectIntervals([t], nowISO, lo, hi).some(() => true);
    if (t.status !== "done" || loggedInWin) inScope.add(id);
  }
  if (inScope.size === 0) return [];
  // Pull in ancestors so children never dangle.
  for (const id of [...inScope]) {
    let cur = p.tasks.get(id)?.parent;
    while (cur && p.tasks.has(cur) && !inScope.has(cur)) {
      inScope.add(cur);
      cur = p.tasks.get(cur)?.parent;
    }
  }

  // 2. Build the child map, preserving creation order.
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of p.order) {
    if (!inScope.has(id)) continue;
    const t = p.tasks.get(id)!;
    if (t.parent && inScope.has(t.parent)) {
      (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(id);
    } else {
      roots.push(id);
    }
  }

  // 3. Subtree rollups (self + descendants) for est / logged / weekly load.
  const roll = new Map<string, { est: number; logged: number; week: number[] }>();
  const compute = (id: string): { est: number; logged: number; week: number[] } => {
    const t = p.tasks.get(id)!;
    const acc = { est: t.estMin ?? 0, logged: loggedMin(t, nowISO), week: weeklyLoad(t, nowISO, cols) };
    for (const c of children.get(id) ?? []) {
      const cr = compute(c);
      acc.est += cr.est;
      acc.logged += cr.logged;
      acc.week = acc.week.map((v, i) => v + cr.week[i]);
    }
    roll.set(id, acc);
    return acc;
  };
  for (const r of roots) compute(r);

  // 4. Render DFS.
  const out: string[] = [
    "## Work Breakdown · 3-week window",
    "",
    "_time series: weekly load sparkline over **last · this · next** week; metrics roll up to parents._",
    "",
  ];
  const totalWeek = [0, 0, 0];
  for (const r of roots) for (let i = 0; i < 3; i++) totalWeek[i] += roll.get(r)!.week[i];
  out.push(`> weekly load — last **${formatMin(totalWeek[0])}** · this **${formatMin(totalWeek[1])}** · next **${formatMin(totalWeek[2])}**`, "");

  const emit = (id: string, depth: number): void => {
    const t = p.tasks.get(id)!;
    const kids = children.get(id) ?? [];
    const agg = roll.get(id)!;
    const est = kids.length ? agg.est : t.estMin ?? 0;
    const logged = kids.length ? agg.logged : loggedMin(t, nowISO);
    const week = kids.length ? agg.week : weeklyLoad(t, nowISO, cols);

    const flag = t.importance >= HI ? " ⚑" : "";
    const cls = ` **${abcd(t)}**·i${t.importance}u${t.urgency}`;
    const proj = !project && t.project ? ` _[${esc(t.project)}]_` : "";
    const pct = est > 0 ? Math.min(100, Math.round((logged / est) * 100)) : undefined;
    const meter = pct !== undefined ? ` ${bar(pct, 4)} ${pct}%` : "";
    const rem = est > 0 ? ` · est ${formatMin(est)} / log ${formatMin(logged)} / rem ${formatMin(Math.max(0, est - logged))}` : logged > 0 ? ` · log ${formatMin(logged)}` : "";
    const dl = deadlineMark(t, nowMs, config);
    const indent = "  ".repeat(depth);
    out.push(`${indent}- ${STATUS_ICON[t.status]} \`${t.id}\` ${esc(t.title)}${flag}${cls}${proj}${meter}${rem} · wk ${spark(week)}${dl}`);
    for (const c of kids) emit(c, depth + 1);
  };
  for (const r of roots) emit(r, 0);
  out.push("");
  return out;
}

/** A distribution table (project or quadrant) with share bars. */
function distributionTable(
  header: string,
  rows: [string, number][],
  totalMin: number,
  relabel: (k: string) => string,
): string[] {
  if (rows.length === 0) return [];
  const out = [`### ${header}`, "", "| | Time | Share |", "| --- | ---: | :--- |"];
  for (const [k, v] of rows) {
    const pct = totalMin > 0 ? Math.round((v / totalMin) * 100) : 0;
    out.push(`| ${esc(relabel(k))} | ${formatMin(v)} | \`${bar(pct)}\` ${pct}% |`);
  }
  out.push("");
  return out;
}

// ---- importance × urgency distribution ----

/** Mermaid label-safe token (letters/digits/dashes → underscores elsewhere). */
function mermaidLabel(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * A Mermaid quadrantChart plotting open work on the importance (y) × urgency (x)
 * plane. Scores 1–5 map into (0,1); points are nudged by index so identical
 * coordinates don't fully overlap. Capped so the diagram stays legible.
 */
function priorityDiagram(p: Projection, project?: string): string[] {
  const pts: { id: string; x: number; y: number }[] = [];
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    if (project && t.project !== project) continue;
    if (t.status === "done") continue;
    pts.push({ id, x: t.urgency, y: t.importance });
  }
  if (pts.length === 0) return [];
  const CAP = 24;
  const shown = pts.slice(0, CAP);
  // s/6 keeps 1→0.17 … 5→0.83 comfortably inside the axes; jitter separates ties.
  const norm = (s: number, i: number) => Math.max(0.04, Math.min(0.96, s / 6 + (((i % 3) - 1) * 0.02)));
  const out = [
    "### Priority map — open work",
    "",
    "```mermaid",
    "quadrantChart",
    "  title Importance (y) x Urgency (x)",
    "  x-axis Low urgency --> High urgency",
    "  y-axis Low importance --> High importance",
    "  quadrant-1 A do first",
    "  quadrant-2 B schedule",
    "  quadrant-3 D eliminate",
    "  quadrant-4 C delegate",
  ];
  shown.forEach((pt, i) => out.push(`  ${mermaidLabel(pt.id)}: [${norm(pt.x, i).toFixed(3)}, ${norm(pt.y, i).toFixed(3)}]`));
  out.push("```", "");
  if (pts.length > shown.length) out.push(`_showing ${shown.length} of ${pts.length} open tasks_`, "");
  return out;
}

/** Logged time this week split across each 1–5 axis (importance, then urgency). */
function scoreTables(p: Projection, config: Config, nowISO: string): string[] {
  const win = windowFor("week", p, nowISO, config);
  const imp = new Map<number, number>();
  const urg = new Map<number, number>();
  let total = 0;
  for (const t of p.tasks.values()) {
    const g = grossInWindow(t, nowISO, win);
    if (g <= 0) continue;
    imp.set(t.importance, (imp.get(t.importance) ?? 0) + g);
    urg.set(t.urgency, (urg.get(t.urgency) ?? 0) + g);
    total += g;
  }
  if (total <= 0) return [];
  const table = (title: string, m: Map<number, number>): string[] => {
    const rows = [`### ${title}`, "", "| Level | Time | Share |", "| ---: | ---: | :--- |"];
    for (let s = 5; s >= 1; s--) {
      const v = m.get(s) ?? 0;
      if (v <= 0) continue;
      const pct = Math.round((v / total) * 100);
      rows.push(`| ${s} | ${formatMin(v)} | \`${bar(pct)}\` ${pct}% |`);
    }
    rows.push("");
    return rows;
  };
  return [...table(`Time by importance — ${win.label}`, imp), ...table(`Time by urgency — ${win.label}`, urg)];
}

/**
 * The metrics dashboard appended below the kanban: today/this-week totals,
 * time distribution by project, the importance × urgency priority map and
 * per-axis time split, an open-sprint plan check, and estimate-vs-actual.
 */
export function metricsMarkdown(p: Projection, config: Config, nowISO: string): string {
  const today = report(p, config, nowISO, { window: "today", by: "project" });
  const week = report(p, config, nowISO, { window: "week", by: "project" });
  const weekByQuadrant = report(p, config, nowISO, { window: "week", by: "quadrant" });
  const open = [...p.periods.values()].find((pr) => pr.open);
  const sprint = open ? report(p, config, nowISO, { window: "sprint", by: "project" }) : null;

  const lines: string[] = ["## Metrics", ""];

  if (week.grossMin === 0 && today.grossMin === 0) {
    lines.push("_No time logged yet — start a task and it'll show up here._", "");
    return lines.join("\n");
  }

  lines.push(
    `- **Today:** net ${formatMin(today.netMin)} worked · gross ${formatMin(today.grossMin)}`,
    `- **${cap(week.win.label)}:** net ${formatMin(week.netMin)} · gross ${formatMin(week.grossMin)} ` +
      `(×${week.multitaskFactor.toFixed(2)} multitask) · ${week.interruptions} interruption${week.interruptions === 1 ? "" : "s"}`,
    "",
  );

  lines.push(...distributionTable(`Time by project — ${week.win.label}`, week.distribution, week.grossMin, (k) => k));

  // Where the time actually went: valuable deep work vs. urgent firefighting.
  const qmap = new Map(weekByQuadrant.distribution);
  const share = (q: string) =>
    weekByQuadrant.grossMin > 0 ? Math.round(((qmap.get(q) ?? 0) / weekByQuadrant.grossMin) * 100) : 0;
  lines.push(
    `- **Time mix — ${week.win.label}:** 🟢 valuable ${share("Q2")}% · 🔴 firefighting ${share("Q1")}% · ` +
      `🟡 interruptions ${share("Q3")}% · ⚪ low-value ${share("Q4")}%`,
    "",
  );

  // The importance × urgency distribution: a diagram of where open work sits,
  // plus how logged time splits across each 1–5 axis.
  lines.push(...priorityDiagram(p));
  lines.push(...scoreTables(p, config, nowISO));

  if (sprint?.onTrack) {
    lines.push(
      `### Sprint ${esc(open!.id)}`,
      "",
      `- ${formatMin(sprint.onTrack.remainingMin)} remaining vs ${formatMin(sprint.onTrack.capacityMin)} capacity → **${sprint.onTrack.verdict}**`,
      "",
    );
  }

  if (week.eva.length) {
    lines.push(`### Estimates vs actual — ${week.win.label}`, "", "| Task | Actual | Est | Verdict |", "| --- | ---: | ---: | :--- |");
    for (const e of week.eva) {
      const verdict = Math.abs(e.ratio - 1) <= 0.1 ? "on target" : `${e.ratio.toFixed(1)}× estimate`;
      lines.push(`| \`${esc(e.id)}\` | ${formatMin(e.actual)} | ${formatMin(e.est)} | ${verdict} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- reports ----

function zoneOf(config: Config): string | undefined {
  return !config.timezone || config.timezone === "system" ? undefined : config.timezone;
}
function toDT(iso: string, config: Config): DateTime {
  const z = zoneOf(config);
  const d = DateTime.fromISO(iso);
  return z ? d.setZone(z) : d;
}

export type WindowKind = "today" | "week" | "sprint";
export interface Win {
  start: number;
  end: number;
  label: string;
}

export function windowFor(kind: WindowKind, p: Projection, nowISO: string, config: Config): Win {
  const now = toDT(nowISO, config);
  if (kind === "today") {
    return { start: now.startOf("day").toMillis(), end: now.toMillis(), label: "today" };
  }
  if (kind === "week") {
    return { start: now.startOf("week").toMillis(), end: now.toMillis(), label: "this week" };
  }
  const open = [...p.periods.values()].find((pr) => pr.open);
  if (open) {
    const z = zoneOf(config);
    const s = DateTime.fromISO(open.start, z ? { zone: z } : {}).startOf("day");
    return { start: s.toMillis(), end: now.toMillis(), label: `sprint ${open.id}` };
  }
  return { start: now.startOf("week").toMillis(), end: now.toMillis(), label: "this week (no open sprint)" };
}

/** Eisenhower quadrant from the two 1–5 scores (important/urgent ≥ HI). */
export function quadrant(t: Task): "Q1" | "Q2" | "Q3" | "Q4" {
  const imp = t.importance >= HI;
  const urg = t.urgency >= HI;
  if (imp && urg) return "Q1";
  if (imp && !urg) return "Q2";
  if (!imp && urg) return "Q3";
  return "Q4";
}

function grossInWindow(t: Task, nowISO: string, win: Win): number {
  let sum = 0;
  for (const i of collectIntervals([t], nowISO, win.start, win.end)) sum += (i.end - i.start) / 60000;
  return sum;
}

function workdaysLeft(nowISO: string, endDate: string, config: Config): number {
  const z = zoneOf(config);
  let d = toDT(nowISO, config).startOf("day");
  const end = DateTime.fromISO(endDate, z ? { zone: z } : {}).startOf("day");
  const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const wd = new Set(config.workDays);
  let count = 0;
  while (d <= end) {
    if (wd.has(names[d.weekday - 1] as (typeof config.workDays)[number])) count++;
    d = d.plus({ days: 1 });
  }
  return Math.max(0, count);
}

export interface ReportOpts {
  window: WindowKind;
  by?: "project" | "tag" | "quadrant";
  addingMin?: number;
}

export interface ReportData {
  win: Win;
  grossMin: number;
  netMin: number;
  multitaskFactor: number;
  interruptions: number;
  distribution: [string, number][];
  eva: { id: string; est: number; actual: number; ratio: number }[];
  onTrack?: { remainingMin: number; capacityMin: number; verdict: string };
}

export function report(p: Projection, config: Config, nowISO: string, opts: ReportOpts): ReportData {
  const win = windowFor(opts.window, p, nowISO, config);

  const inWin: { t: Task; gross: number }[] = [];
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    const g = grossInWindow(t, nowISO, win);
    if (g > 0) inWin.push({ t, gross: g });
  }
  const grossMin = inWin.reduce((a, b) => a + b.gross, 0);
  const netMin = unionMinutes(collectIntervals(p.tasks.values(), nowISO, win.start, win.end));
  const multitaskFactor = netMin > 0 ? grossMin / netMin : 0;
  const interruptions = p.interruptionsAt.filter((a) => {
    const m = Date.parse(a);
    return m >= win.start && m <= win.end;
  }).length;

  const by = opts.by ?? "project";
  const dist = new Map<string, number>();
  for (const { t, gross } of inWin) {
    let keys: string[];
    if (by === "project") keys = [t.project ?? "(none)"];
    else if (by === "tag") keys = t.tags.length ? t.tags : ["(untagged)"];
    else keys = [quadrant(t)];
    for (const k of keys) dist.set(k, (dist.get(k) ?? 0) + gross / keys.length);
  }

  const eva: ReportData["eva"] = [];
  for (const { t } of inWin) {
    if (t.estMin && t.status === "done") {
      const actual = taskGrossMin(t, nowISO);
      eva.push({ id: t.id, est: t.estMin, actual, ratio: actual / t.estMin });
    }
  }

  let onTrack: ReportData["onTrack"];
  const open = [...p.periods.values()].find((pr) => pr.open);
  if (opts.window === "sprint" && open) {
    let remaining = 0;
    for (const t of p.tasks.values()) {
      if (t.period === open.id && t.status !== "done" && t.estMin) remaining += t.estMin;
    }
    if (opts.addingMin) remaining += opts.addingMin;
    const capMin =
      workdaysLeft(nowISO, open.end, config) *
      (open.capacityHoursPerDay ?? config.capacityHoursPerDay) *
      60;
    const verdict =
      remaining <= capMin
        ? "on track"
        : `~${formatMin(remaining - capMin)} over capacity → deadline at risk`;
    onTrack = { remainingMin: remaining, capacityMin: capMin, verdict };
  }

  return {
    win,
    grossMin,
    netMin,
    multitaskFactor,
    interruptions,
    distribution: [...dist.entries()].sort((a, b) => b[1] - a[1]),
    eva,
    onTrack,
  };
}

export function reportText(p: Projection, config: Config, nowISO: string, opts: ReportOpts): string {
  const r = report(p, config, nowISO, opts);
  const by = opts.by ?? "project";
  const lines: string[] = [];
  lines.push(
    `${r.win.label}: net ${formatMin(r.netMin)} worked, gross ${formatMin(r.grossMin)} ` +
      `(×${r.multitaskFactor.toFixed(2)} multitask), ${r.interruptions} interruptions`,
  );
  if (r.onTrack) {
    lines.push(
      `plan: ${formatMin(r.onTrack.remainingMin)} remaining vs ${formatMin(r.onTrack.capacityMin)} capacity → ${r.onTrack.verdict}`,
    );
  }
  lines.push(`by ${by}:`);
  for (const [k, v] of r.distribution) {
    const pct = r.grossMin > 0 ? Math.round((v / r.grossMin) * 100) : 0;
    lines.push(`  ${k}: ${formatMin(v)} (${pct}%)`);
  }
  if (r.eva.length) {
    lines.push("estimate vs actual:");
    for (const e of r.eva) {
      const verdict = Math.abs(e.ratio - 1) <= 0.1 ? "on target" : `${e.ratio.toFixed(1)}×`;
      lines.push(`  ${e.id}: ${formatMin(e.actual)} (est ${formatMin(e.est)}, ${verdict})`);
    }
  }
  return lines.join("\n");
}

/** Single-task est-vs-actual verdict, used by `stop`. */
export function stopVerdict(t: Task, nowISO: string): string {
  const actual = taskGrossMin(t, nowISO);
  if (!t.estMin) return `${formatMin(actual)}`;
  const ratio = actual / t.estMin;
  const v = Math.abs(ratio - 1) <= 0.1 ? "on target" : `${ratio.toFixed(1)}× estimate`;
  return `${formatMin(actual)} (est ${formatMin(t.estMin)}, ${v})`;
}
