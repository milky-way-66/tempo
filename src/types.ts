// Domain types for Tempo — the event log and the derived projection.

export type Importance = "high" | "med" | "low";
export type Reason = "urgent" | "blocked" | "distraction" | "break" | "meeting";
export type StopStatus = "done" | "paused" | "blocked";
export type Source = "live" | "backfill";

export type EventType =
  | "task.created"
  | "task.started"
  | "task.stopped"
  | "note"
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
  imp: Importance;
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
  imp: Importance;
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
