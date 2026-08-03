import type { Event, Projection } from "../types.js";
import type { ReadResult } from "./store.js";
import { collectIntervals, unionMinutes } from "./replay.js";

export interface CheckIssue {
  kind: "parse" | "schema" | "impossible";
  detail: string;
  at?: string;
  task?: string;
}

export interface CheckResult {
  ok: boolean;
  issues: CheckIssue[];
  quality: {
    events: number;
    backfillPct: number;
    freshnessMedianMin: number;
    multitaskFactor: number;
  };
}

const TYPES = new Set<Event["type"]>([
  "task.created",
  "task.started",
  "task.stopped",
  "note",
  "period.opened",
  "period.closed",
]);

const RANK: Record<string, number> = {
  "task.created": 0,
  "task.stopped": 1,
  "task.started": 2,
  note: 3,
  "period.opened": 4,
  "period.closed": 5,
};

function ordered(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9);
  });
}

/**
 * Validate the log: parse issues, schema, and *impossible* states. Overlaps are normal
 * (multitasking) and are NOT flagged. Also reports data-quality metrics.
 */
export function check(read: ReadResult, projection: Projection, nowISO: string): CheckResult {
  const issues: CheckIssue[] = [];
  for (const p of read.issues) issues.push({ kind: "parse", detail: `line ${p.line}: ${p.error}` });

  const valid: Event[] = [];
  for (const e of read.events) {
    if (!e.id || !e.at || !e.type) {
      issues.push({ kind: "schema", detail: "missing id/at/type" });
      continue;
    }
    if (!TYPES.has(e.type)) {
      issues.push({ kind: "schema", detail: `unknown type "${e.type}"`, at: e.at });
      continue;
    }
    if (Number.isNaN(Date.parse(e.at))) {
      issues.push({ kind: "schema", detail: `unparseable at "${e.at}"`, at: e.at });
      continue;
    }
    valid.push(e);
  }

  // impossible-state pass
  const created = new Set<string>();
  const open = new Set<string>();
  for (const e of ordered(valid)) {
    if (e.type === "task.created") {
      created.add(e.task);
    } else if (e.type === "task.started") {
      if (!created.has(e.task))
        issues.push({ kind: "impossible", detail: "started before created", task: e.task, at: e.at });
      if (open.has(e.task))
        issues.push({ kind: "impossible", detail: "double start (already open)", task: e.task, at: e.at });
      open.add(e.task);
    } else if (e.type === "task.stopped") {
      if (!open.has(e.task))
        issues.push({ kind: "impossible", detail: "stop without an open span", task: e.task, at: e.at });
      open.delete(e.task);
    }
  }

  // quality
  const n = read.events.length;
  const backfill = read.events.filter((e) => e.source === "backfill").length;
  const lags = read.events
    .map((e) => (Date.parse(e.logged_at) - Date.parse(e.at)) / 60000)
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const median = lags.length ? lags[Math.floor(lags.length / 2)] : 0;

  const net = unionMinutes(collectIntervals(projection.tasks.values(), nowISO));
  let gross = 0;
  for (const t of projection.tasks.values()) {
    for (const s of t.spans) {
      gross += (Date.parse(s.end ?? nowISO) - Date.parse(s.start)) / 60000;
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    quality: {
      events: n,
      backfillPct: n ? Math.round((backfill / n) * 100) : 0,
      freshnessMedianMin: Math.round(median),
      multitaskFactor: net > 0 ? +(gross / net).toFixed(2) : 0,
    },
  };
}
