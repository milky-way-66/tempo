// Domain types for Tempo — the event log and the derived projection.

// Priority is two independent 1–5 axes (the Eisenhower matrix, quantified):
// `importance` (value/impact) and `urgency` (time pressure). 1 = lowest,
// 5 = highest. Together they place a task in a quadrant and let time be
// distributed across the importance × urgency plane.
export type Score = 1 | 2 | 3 | 4 | 5;
export type Reason = "urgent" | "blocked" | "distraction" | "break" | "meeting";
export type StopStatus = "done" | "paused" | "blocked";
export type Source = "live" | "backfill";

export type EventType =
  | "task.created"
  | "task.started"
  | "task.stopped"
  | "task.updated"
  | "note"
  | "project.renamed"
  | "period.opened"
  | "period.closed";

export interface Base {
  id: string; // uuid — identity + dedup key on git merge
  at: string; // ISO-8601 with offset — when it happened (required, often past)
  logged_at: string; // ISO-8601 with offset — when appended (server-written)
  source: Source;
}

export type TaskCreated = Base & {
  type: "task.created";
  task: string; // slug id
  title: string;
  importance: Score; // 1–5, value/impact
  urgency?: Score; // 1–5, time pressure; defaults to 3 when omitted
  tags: string[];
  project?: string;
  estMin?: number;
  deadline?: string; // YYYY-MM-DD
  parent?: string; // WBS parent slug
  period?: string;
};

export type TaskStarted = Base & {
  type: "task.started";
  task: string;
  reason?: Reason; // set when this start IS an interruption
};

export type TaskStopped = Base & {
  type: "task.stopped";
  task: string;
  status: StopStatus;
  reason?: string;
};

// A sparse metadata patch on an existing task. Only keys that are present
// change; an explicit `null` clears an optional field (est/deadline/parent/
// project/period). Spans and status are never touched here — those are derived
// from the started/stopped timeline.
export type TaskUpdated = Base & {
  type: "task.updated";
  task: string;
  title?: string;
  importance?: Score;
  urgency?: Score;
  tags?: string[];
  project?: string | null;
  estMin?: number | null;
  deadline?: string | null;
  parent?: string | null;
  period?: string | null;
};

// Bulk-rename a project across every task that carries it. One event fixes a
// mistyped project name instead of editing the log by hand.
export type ProjectRenamed = Base & {
  type: "project.renamed";
  from: string;
  to: string;
};

export type NoteEvent = Base & {
  type: "note";
  task?: string;
  text: string;
  energy?: "hard" | "easy";
};

export type PeriodOpened = Base & {
  type: "period.opened";
  period: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  capacityHoursPerDay?: number;
};

export type PeriodClosed = Base & {
  type: "period.closed";
  period: string;
};

export type Event =
  | TaskCreated
  | TaskStarted
  | TaskStopped
  | TaskUpdated
  | ProjectRenamed
  | NoteEvent
  | PeriodOpened
  | PeriodClosed;

// ---- Projection (derived state) ----

export interface Span {
  start: string; // ISO
  end?: string; // ISO; undefined ⇒ still open
}

export type TaskStatus = "todo" | "doing" | "paused" | "blocked" | "done";

export interface Task {
  id: string;
  title: string;
  importance: Score; // 1–5
  urgency: Score; // 1–5
  tags: string[];
  project?: string;
  estMin?: number;
  deadline?: string;
  parent?: string;
  period?: string;
  spans: Span[];
  status: TaskStatus;
  createdAt: string;
}

export interface Period {
  id: string;
  start: string;
  end: string;
  open: boolean;
  capacityHoursPerDay?: number;
}

export interface Projection {
  tasks: Map<string, Task>;
  periods: Map<string, Period>;
  interruptions: number; // count of starts carrying a reason
  interruptionsAt: string[]; // ISO instant of each interrupting start (for windowed reports)
  order: string[]; // task ids in creation order (for stable listing)
}
