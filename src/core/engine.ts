import { DateTime } from "luxon";
import { resolvePaths, loadConfig, type Paths, type Config } from "./config.js";
import { append, readAll } from "./store.js";
import { replay } from "./replay.js";
import { parseInstant, parseDurationMin } from "./time.js";
import { resolve } from "./resolve.js";
import {
  board,
  boardText,
  report,
  reportText,
  stopVerdict,
  type WindowKind,
} from "./report.js";
import { check as runCheck } from "./check.js";
import { commitAll } from "./git.js";
import { newId, slugify } from "./ids.js";
import type {
  Event,
  Importance,
  Reason,
  StopStatus,
  Projection,
  TaskCreated,
} from "../types.js";

export interface CreateFields {
  title?: string;
  imp?: Importance;
  tags?: string[];
  project?: string;
  est?: string;
  deadline?: string;
  parent?: string;
  period?: string;
}

const DISAMBIG = (candidates: { id: string; title: string }[]) => ({
  needsDisambiguation: candidates,
  message:
    "Which task? " + candidates.map((c) => `${c.id} (${c.title})`).join(" · "),
});

export class Engine {
  paths: Paths;
  config: Config;
  projection: Projection;

  constructor(paths: Paths = resolvePaths()) {
    this.paths = paths;
    this.config = loadConfig(paths);
    this.projection = replay(readAll(paths).events);
  }

  reload(): void {
    this.config = loadConfig(this.paths);
    this.projection = replay(readAll(this.paths).events);
  }

  private nowISO(at?: string): string {
    return parseInstant(at, { zone: this.config.timezone });
  }

  private write(ev: Event): void {
    append(this.paths, ev);
    this.projection = replay(readAll(this.paths).events);
    const label = "task" in ev ? ev.task : "period" in ev ? ev.period : "";
    commitAll(this.paths, `${ev.type} ${label} @${ev.at}`.trim());
  }

  private envelope(at?: string): { id: string; at: string; logged_at: string; source: "live" | "backfill" } {
    const atISO = this.nowISO(at);
    const source: "live" | "backfill" = at && at !== "now" ? "backfill" : "live";
    return { id: newId(), at: atISO, logged_at: this.nowISO(), source };
  }

  private create(f: CreateFields, at?: string): string {
    if (!f.title) throw new Error("a title is required to create a task");
    if (!f.imp) throw new Error("importance (imp) is required at creation");
    const slug = slugify(f.title, new Set(this.projection.tasks.keys()));
    const ev: TaskCreated = {
      ...this.envelope(at),
      type: "task.created",
      task: slug,
      title: f.title,
      imp: f.imp,
      tags: f.tags ?? [],
      project: f.project,
      estMin: f.est ? parseDurationMin(f.est) : undefined,
      deadline: f.deadline,
      parent: f.parent,
      period: f.period,
    };
    this.write(ev);
    return slug;
  }

  // ---- capture ----

  add(args: CreateFields & { at?: string }) {
    const task = this.create(args, args.at);
    return { task, title: args.title };
  }

  start(args: CreateFields & { query?: string; reason?: Reason; at?: string }) {
    let task: string;
    if (args.query) {
      const r = resolve(this.projection, args.query);
      if (r.kind === "ambiguous") return DISAMBIG(r.candidates);
      if (r.kind === "match") task = r.id;
      else task = this.create({ ...args, title: args.title ?? args.query }, args.at);
    } else if (args.title) {
      task = this.create(args, args.at);
    } else {
      return { error: "start needs a task query or a title" };
    }

    const t = this.projection.tasks.get(task);
    const alreadyOpen = t?.spans.some((s) => s.end === undefined);
    if (!alreadyOpen) {
      this.write({ ...this.envelope(args.at), type: "task.started", task, reason: args.reason });
    }
    return { task, title: this.projection.tasks.get(task)?.title, alreadyActive: !!alreadyOpen };
  }

  private activeTasks(): string[] {
    return [...this.projection.tasks.values()]
      .filter((t) => t.spans.some((s) => s.end === undefined))
      .map((t) => t.id);
  }

  private targetOrActive(query?: string) {
    if (query) {
      const r = resolve(this.projection, query, { includeDone: true });
      if (r.kind === "ambiguous") return { disambig: r.candidates };
      if (r.kind === "match") return { id: r.id };
      return { none: true };
    }
    const active = this.activeTasks();
    if (active.length === 1) return { id: active[0] };
    if (active.length === 0) return { none: true };
    return {
      disambig: active.map((id) => ({ id, title: this.projection.tasks.get(id)!.title })),
    };
  }

  stop(args: { query?: string; status?: StopStatus; reason?: string; at?: string }) {
    const target = this.targetOrActive(args.query);
    if ("disambig" in target && target.disambig) return DISAMBIG(target.disambig);
    if ("none" in target) return { error: "no matching active task to stop" };
    const task = target.id!;
    const status: StopStatus = args.status ?? "done";
    this.write({ ...this.envelope(args.at), type: "task.stopped", task, status, reason: args.reason });
    const t = this.projection.tasks.get(task)!;
    return { task, status, verdict: stopVerdict(t, this.nowISO()) };
  }

  note(args: { query?: string; text: string; energy?: "hard" | "easy"; at?: string }) {
    let task: string | undefined;
    if (args.query) {
      const r = resolve(this.projection, args.query, { includeDone: true });
      if (r.kind === "ambiguous") return DISAMBIG(r.candidates);
      if (r.kind === "match") task = r.id;
    } else {
      const active = this.activeTasks();
      if (active.length === 1) task = active[0];
    }
    this.write({ ...this.envelope(args.at), type: "note", task, text: args.text, energy: args.energy });
    return { ok: true, task };
  }

  log(args: CreateFields & { query?: string; dur: string; at: string }) {
    const durMin = parseDurationMin(args.dur);
    let task: string;
    if (args.query) {
      const r = resolve(this.projection, args.query, { includeDone: true });
      if (r.kind === "ambiguous") return DISAMBIG(r.candidates);
      task = r.kind === "match" ? r.id : this.create({ ...args, title: args.title ?? args.query }, args.at);
    } else {
      task = this.create(args, args.at);
    }
    const startISO = this.nowISO(args.at);
    const endISO = DateTime.fromISO(startISO).plus({ minutes: durMin }).toISO({ suppressMilliseconds: true })!;
    this.write({ id: newId(), at: startISO, logged_at: this.nowISO(), source: "backfill", type: "task.started", task });
    this.write({ id: newId(), at: endISO, logged_at: this.nowISO(), source: "backfill", type: "task.stopped", task, status: "done" });
    return { task, logged: args.dur, at: startISO };
  }

  // ---- planning ----

  private dateOf(at?: string): string {
    return this.nowISO(at).slice(0, 10);
  }

  period(args: { action: "open" | "close"; name?: string; start?: string; len?: string; capacity?: number; at?: string }) {
    if (args.action === "close") {
      const name = args.name ?? [...this.projection.periods.values()].find((p) => p.open)?.id;
      if (!name) return { error: "no open period to close" };
      this.write({ ...this.envelope(args.at), type: "period.closed", period: name });
      return { period: name, closed: true };
    }
    const startDate = args.start ? this.dateOf(args.start) : this.dateOf(args.at);
    const m = (args.len ?? "2w").match(/^(\d+)\s*(w|d)$/i);
    if (!m) return { error: `bad length "${args.len}"` };
    const n = +m[1];
    const endDT =
      m[2].toLowerCase() === "w"
        ? DateTime.fromISO(startDate).plus({ weeks: n }).minus({ days: 1 })
        : DateTime.fromISO(startDate).plus({ days: n }).minus({ days: 1 });
    const endDate = endDT.toISODate()!;
    const name = args.name ?? `sprint-${startDate}`;
    this.write({
      ...this.envelope(args.at),
      type: "period.opened",
      period: name,
      start: startDate,
      end: endDate,
      capacityHoursPerDay: args.capacity,
    });
    return { period: name, start: startDate, end: endDate };
  }

  // ---- views ----

  board(project?: string) {
    return { text: boardText(this.projection, project), columns: board(this.projection, project) };
  }

  report(args: { window: WindowKind; by?: "project" | "tag" | "quadrant"; adding?: string; at?: string }) {
    const addingMin = args.adding ? parseDurationMin(args.adding) : undefined;
    const opts = { window: args.window, by: args.by, addingMin };
    const now = this.nowISO(args.at);
    return { text: reportText(this.projection, this.config, now, opts), data: report(this.projection, this.config, now, opts) };
  }

  check() {
    const read = readAll(this.paths);
    const proj = replay(read.events);
    return runCheck(read, proj, this.nowISO());
  }
}
