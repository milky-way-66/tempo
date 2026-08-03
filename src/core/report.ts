import { DateTime } from "luxon";
import type { Projection, Task } from "../types.js";
import type { Config } from "./config.js";
import { collectIntervals, unionMinutes, taskGrossMin } from "./replay.js";
import { formatMin } from "./time.js";

const COLS = ["todo", "doing", "paused", "blocked", "done"] as const;

/** The A/B/C/D category letter for a task's quadrant. */
export const CATEGORY: Record<string, string> = { Q1: "A", Q2: "B", Q3: "C", Q4: "D" };

export interface BoardItem {
  id: string;
  title: string;
  important: boolean;
  urgent: boolean;
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
    if (t.archived) continue;
    if (project && t.project !== project) continue;
    cols[t.status].push({ id: t.id, title: t.title, important: t.important, urgent: t.urgent, project: t.project });
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
      const cat = CATEGORY[quadrant(p.tasks.get(it.id)!)];
      lines.push(`  • ${it.id} — ${it.title}${it.project ? ` [${it.project}]` : ""} (${cat})`);
    }
  }
  return lines.join("\n");
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

/** Eisenhower quadrant from the two yes/no axes. */
export function quadrant(t: Task): "Q1" | "Q2" | "Q3" | "Q4" {
  if (t.important && t.urgent) return "Q1";
  if (t.important && !t.urgent) return "Q2";
  if (!t.important && t.urgent) return "Q3";
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

  const live = [...p.tasks.values()].filter((t) => !t.archived);
  const inWin: { t: Task; gross: number }[] = [];
  for (const id of p.order) {
    const t = p.tasks.get(id)!;
    if (t.archived) continue;
    const g = grossInWindow(t, nowISO, win);
    if (g > 0) inWin.push({ t, gross: g });
  }
  const grossMin = inWin.reduce((a, b) => a + b.gross, 0);
  const netMin = unionMinutes(collectIntervals(live, nowISO, win.start, win.end));
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
      if (!t.archived && t.period === open.id && t.status !== "done" && t.estMin) remaining += t.estMin;
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
