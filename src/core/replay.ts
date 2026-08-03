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
  note: 3,
  "period.opened": 4,
  "period.closed": 5,
};

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

  for (const e of events) {
    switch (e.type) {
      case "task.created": {
        if (!tasks.has(e.task)) {
          tasks.set(e.task, {
            id: e.task,
            title: e.title,
            imp: e.imp,
            tags: e.tags ?? [],
            project: e.project,
            estMin: e.estMin,
            deadline: e.deadline,
            parent: e.parent,
            period: e.period,
            spans: [],
            status: "todo",
            createdAt: e.at,
          });
          order.push(e.task);
        }
        break;
      }
      case "task.started": {
        const t = tasks.get(e.task);
        if (!t) break; // started before created — check() flags this
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
