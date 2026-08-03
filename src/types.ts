// Domain types for Tempo — the event log and the derived projection.

// Priority is two independent yes/no axes (the Eisenhower matrix): `important`
// (value/impact) and `urgent` (time pressure). Together they place a task in one
// of four categories — A both · B important · C urgent · D neither — so time can
// be attributed to where it mostly goes.
export type Reason = "urgent" | "blocked" | "distraction" | "break" | "meeting";
export type StopStatus = "done" | "paused" | "blocked";
export type Source = "live" | "backfill";

export type EventType =
  | "task.created"
  | "task.started"
  | "task.stopped"
  | "task.updated"
  | "task.archived"
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
  important: boolean; // value/impact
  urgent?: boolean; // time pressure; defaults to false when omitted
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
  important?: boolean;
  urgent?: boolean;
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

// Soft-remove a task you won't do (append-only: the history stays in the log).
// `archived: false` restores it. Replay hides archived tasks from every view.
export type TaskArchived = Base & {
  type: "task.archived";
  task: string;
  archived: boolean;
  reason?: string;
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
  | TaskArchived
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
  important: boolean;
  urgent: boolean;
  tags: string[];
  project?: string;
  estMin?: number;
  deadline?: string;
  parent?: string;
  period?: string;
  spans: Span[];
  status: TaskStatus;
  archived: boolean;
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
