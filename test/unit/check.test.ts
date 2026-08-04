import { describe, it, expect } from "vitest";
import { check } from "../../src/core/check";
import { replay } from "../../src/core/replay";
import type { ReadResult } from "../../src/core/store";
import type { Event } from "../../src/types";

const NOW = "2026-08-05T12:00:00Z";
let seq = 0;
function ev(o: Partial<Event> & { type: Event["type"]; at: string }): Event {
  seq++;
  return { id: `e${seq}`, source: "live", logged_at: o.at, ...o } as Event;
}
function run(events: Event[], issues: ReadResult["issues"] = []) {
  return check({ events, issues }, replay(events), NOW);
}

describe("check — impossible states", () => {
  it("passes a clean create → start → stop log", () => {
    const r = run([
      ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "a", title: "A", important: false, tags: [] } as never),
      ev({ type: "task.started", at: "2026-08-05T09:00:00Z", task: "a" } as never),
      ev({ type: "task.stopped", at: "2026-08-05T10:00:00Z", task: "a", status: "done" } as never),
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("flags a start with no matching task.created", () => {
    const r = run([ev({ type: "task.started", at: "2026-08-05T09:00:00Z", task: "ghost" } as never)]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === "impossible" && /without a task.created/.test(i.detail))).toBe(true);
  });

  it("flags a double start on an already-open task", () => {
    const r = run([
      ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "a", title: "A", important: false, tags: [] } as never),
      ev({ type: "task.started", at: "2026-08-05T09:00:00Z", task: "a" } as never),
      ev({ type: "task.started", at: "2026-08-05T09:30:00Z", task: "a" } as never),
    ]);
    expect(r.issues.some((i) => /double start/.test(i.detail))).toBe(true);
  });

  it("flags a stop with no open span", () => {
    const r = run([
      ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "a", title: "A", important: false, tags: [] } as never),
      ev({ type: "task.stopped", at: "2026-08-05T10:00:00Z", task: "a", status: "done" } as never),
    ]);
    expect(r.issues.some((i) => /stop without an open span/.test(i.detail))).toBe(true);
  });

  it("flags an update for a never-created task", () => {
    const r = run([ev({ type: "task.updated", at: "2026-08-05T09:00:00Z", task: "ghost", title: "x" } as never)]);
    expect(r.issues.some((i) => /updated without a task.created/.test(i.detail))).toBe(true);
  });
});

describe("check — schema & parse", () => {
  it("reports an unknown event type", () => {
    const r = run([ev({ type: "bogus.type" as Event["type"], at: "2026-08-05T09:00:00Z" } as never)]);
    expect(r.issues.some((i) => i.kind === "schema" && /unknown type/.test(i.detail))).toBe(true);
  });

  it("surfaces parse issues from the reader", () => {
    const r = run([], [{ line: 3, error: "Unexpected token", raw: "{bad" }]);
    expect(r.issues.some((i) => i.kind === "parse" && /line 3/.test(i.detail))).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe("check — quality metrics", () => {
  it("reports event count, backfill %, and multitask factor", () => {
    const events = [
      ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "a", title: "A", important: false, tags: [] } as never),
      { ...ev({ type: "task.started", at: "2026-08-05T09:00:00Z", task: "a" } as never), source: "backfill" } as Event,
      ev({ type: "task.stopped", at: "2026-08-05T10:00:00Z", task: "a", status: "done" } as never),
    ];
    const r = run(events);
    expect(r.quality.events).toBe(3);
    expect(r.quality.backfillPct).toBe(33); // 1 of 3
    expect(r.quality.multitaskFactor).toBe(1); // single task, no overlap
  });
});
