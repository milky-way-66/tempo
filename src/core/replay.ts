import type { Event, Projection, Task, Period } from "../types.js";
import { minutesBetween } from "./time.js";

// At the same instant, order by causal priority so replay is independent of id/append order:
// within a task it must go created → started → stopped, so a task created, started, and stopped in
// the same millisecond (a quick task logged in one breath) folds into a closed span rather than a
// stray open one. Ordering `started` before `stopped` is safe across *different* tasks too — spans
// are keyed by their `at` timestamp, so a same-instant switch (stop A, start B) yields identical
// span math regardless of which is processed first. `logged_at` then `id` are final stable tiebreaks.
const RANK: Record<Event["type"], number> = {
  "task.created": 0,
  "task.started": 1,
  "task.stopped": 2,
  // Metadata edits carry no span math, so their rank only breaks same-instant
  // ties deterministically; a later edit (by at, then logged_at) wins.
  "task.updated": 3,
  "task.archived": 4,
  note: 5,
  "project.renamed": 6,
  "period.opened": 7,
  "period.closed": 8,
};

/** Fold "" / whitespace-only optional strings to undefined (older logs may
 * carry an empty parent/project/etc. written before empties were normalized). */
function blank(s: string | undefined): string | undefined {
  const v = s?.trim();
  return v ? v : undefined;
}

function cmp(a: Event, b: Event): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (RANK[a.type] !== RANK[b.type]) return RANK[a.type] - RANK[b.type];
  if (a.logged_at !== b.logged_at) return a.logged_at < b.logged_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Fold events into a projection. Dedups by id and sorts first (order-independent). */
export function replay(input: Event[]): Projection {
  const seen = new Set<string>();
  const events = input.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  events.sort(cmp);

  const tasks = new Map<string, Task>();
  const periods = new Map<string, Period>();
  const order: string[] = [];
  const interruptionsAt: string[] = [];

  // Pass 1 — establish task existence from every `task.created`, so a
  // backdated `started`/`stopped` (logged later but timed earlier than the
  // create) still applies instead of being dropped for a not-yet-seen task.
  for (const e of events) {
    if (e.type !== "task.created" || tasks.has(e.task)) continue;
    tasks.set(e.task, {
      id: e.task,
      title: e.title,
      important: e.important ?? false,
      urgent: e.urgent ?? false,
      tags: e.tags ?? [],
      project: blank(e.project),
      estMin: e.estMin,
      deadline: blank(e.deadline),
      parent: blank(e.parent),
      period: blank(e.period),
      spans: [],
      status: "todo",
      archived: false,
      createdAt: e.at,
    });
    order.push(e.task);
  }

  // Pass 2 — apply the timeline (started/stopped/notes/periods) in `at` order.
  for (const e of events) {
    switch (e.type) {
      case "task.created":
        break; // already applied in pass 1
      case "task.started": {
        const t = tasks.get(e.task);
        if (!t) break; // started with no task.created anywhere — check() flags this
        const open = t.spans.find((s) => s.end === undefined);
        if (!open) t.spans.push({ start: e.at });
        t.status = "doing";
        if (e.reason) interruptionsAt.push(e.at);
        break;
      }
      case "task.stopped": {
        const t = tasks.get(e.task);
        if (!t) break;
        const open = t.spans.find((s) => s.end === undefined);
        if (open) open.end = e.at;
        t.status = e.status === "done" ? "done" : e.status;
        break;
      }
      case "task.updated": {
        const t = tasks.get(e.task);
        if (!t) break; // update for a never-created task — check() flags this
        if (e.title !== undefined) t.title = e.title;
        if (e.important !== undefined) t.important = e.important;
        if (e.urgent !== undefined) t.urgent = e.urgent;
        if (e.tags !== undefined) t.tags = e.tags;
        if (e.project !== undefined) t.project = blank(e.project ?? undefined);
        if (e.estMin !== undefined) t.estMin = e.estMin ?? undefined;
        if (e.deadline !== undefined) t.deadline = blank(e.deadline ?? undefined);
        if (e.parent !== undefined) t.parent = blank(e.parent ?? undefined);
        if (e.period !== undefined) t.period = blank(e.period ?? undefined);
        break;
      }
      case "task.archived": {
        const t = tasks.get(e.task);
        if (t) t.archived = e.archived;
        break;
      }
      case "project.renamed": {
        for (const t of tasks.values()) if (t.project === e.from) t.project = e.to;
        break;
      }
      case "note":
        break;
      case "period.opened":
        periods.set(e.period, {
          id: e.period,
          start: e.start,
          end: e.end,
          open: true,
          capacityHoursPerDay: e.capacityHoursPerDay,
        });
        break;
      case "period.closed": {
        const p = periods.get(e.period);
        if (p) p.open = false;
        break;
      }
    }
  }
  return { tasks, periods, interruptions: interruptionsAt.length, interruptionsAt, order };
}

// ---- time helpers ----

export interface Interval {
  start: number; // epoch ms
  end: number;
}

/** Gross minutes for one task over its whole life (open span counts to `nowISO`). */
export function taskGrossMin(t: Task, nowISO: string): number {
  let sum = 0;
  for (const s of t.spans) sum += minutesBetween(s.start, s.end ?? nowISO);
  return Math.max(0, sum);
}

/** Collect all spans as epoch intervals, optionally clipped to [lo, hi]. */
export function collectIntervals(
  tasks: Iterable<Task>,
  nowISO: string,
  lo = -Infinity,
  hi = Infinity,
): Interval[] {
  const out: Interval[] = [];
  for (const t of tasks) {
    for (const s of t.spans) {
      const start = Math.max(Date.parse(s.start), lo);
      const end = Math.min(Date.parse(s.end ?? nowISO), hi);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

/** Length of the union of intervals, in minutes (overlap counted once). */
export function unionMinutes(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.start <= curEnd) curEnd = Math.max(curEnd, s.end);
    else {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    }
  }
  total += curEnd - curStart;
  return total / 60000;
}
