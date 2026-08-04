import { describe, it, expect } from "vitest";
import { resolve } from "../../src/core/resolve";
import { replay } from "../../src/core/replay";
import type { Event } from "../../src/types";

let seq = 0;
function created(task: string, title: string, extra: Partial<Event> = {}): Event {
  seq++;
  return {
    id: `c${seq}`,
    at: "2026-08-03T09:00:00Z",
    logged_at: "2026-08-03T09:00:00Z",
    source: "live",
    type: "task.created",
    task,
    title,
    important: false,
    urgent: false,
    tags: [],
    ...extra,
  } as unknown as Event;
}
function stop(task: string): Event {
  seq++;
  return { id: `x${seq}`, at: "2026-08-03T10:00:00Z", logged_at: "2026-08-03T10:00:00Z", source: "live", type: "task.stopped", task, status: "done" } as unknown as Event;
}

describe("resolve", () => {
  it("matches an exact slug outright", () => {
    const p = replay([created("auth-bug", "Auth bug"), created("auth-refactor", "Auth refactor")]);
    expect(resolve(p, "auth-bug")).toEqual({ kind: "match", id: "auth-bug" });
  });

  it("matches on a single strong token overlap", () => {
    const p = replay([created("write-spec", "Write the spec"), created("deploy", "Deploy service")]);
    expect(resolve(p, "spec")).toEqual({ kind: "match", id: "write-spec" });
  });

  it("returns ambiguous for a close race", () => {
    const p = replay([created("auth-bug", "Auth bug"), created("auth-refactor", "Auth refactor")]);
    const r = resolve(p, "auth");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map((c) => c.id).sort()).toEqual(["auth-bug", "auth-refactor"]);
  });

  it("returns none for an empty or unmatched query", () => {
    const p = replay([created("a", "Alpha")]);
    expect(resolve(p, "")).toEqual({ kind: "none" });
    expect(resolve(p, "   ")).toEqual({ kind: "none" });
    expect(resolve(p, "zzzzz")).toEqual({ kind: "none" });
  });

  it("hides done tasks unless includeDone (fuzzy query; an exact slug always matches)", () => {
    const p = replay([created("shipped", "Shipped feature"), stop("shipped")]);
    expect(resolve(p, "feature").kind).toBe("none"); // fuzzy match skips done
    expect(resolve(p, "feature", { includeDone: true })).toEqual({ kind: "match", id: "shipped" });
    expect(resolve(p, "shipped")).toEqual({ kind: "match", id: "shipped" }); // exact slug wins regardless
  });

  it("hides archived tasks unless includeArchived (even by exact slug)", () => {
    const p = replay([
      created("old", "Old task"),
      { id: "a1", at: "2026-08-03T11:00:00Z", logged_at: "2026-08-03T11:00:00Z", source: "live", type: "task.archived", task: "old", archived: true } as unknown as Event,
    ]);
    expect(resolve(p, "old").kind).toBe("none");
    expect(resolve(p, "old", { includeArchived: true })).toEqual({ kind: "match", id: "old" });
  });

  it("matches on a tag token", () => {
    const p = replay([created("t", "Something", { tags: ["billing"] })]);
    expect(resolve(p, "billing")).toEqual({ kind: "match", id: "t" });
  });
});
