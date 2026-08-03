import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine";
import type { Paths } from "../src/core/config";

function tmpPaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-test-"));
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}
const fresh = () => new Engine(tmpPaths());

describe("engine — capture", () => {
  it("add → start → stop yields a done task with an est verdict", () => {
    const e = fresh();
    const { task } = e.add({
      title: "Auth bug",
      importance: 5,
      est: "1h",
      tags: ["bug"],
      at: "2026-08-03T08:59:00+07:00",
    });
    expect(task).toBe("auth-bug");
    e.start({ query: "auth", at: "2026-08-03T09:00:00+07:00" });
    const r = e.stop({ query: "auth", at: "2026-08-03T10:00:00+07:00" }) as { verdict: string };
    expect(r.verdict).toContain("on target");
    expect(e.board().columns.done.map((t) => t.id)).toContain("auth-bug");
  });

  it("multitasking keeps multiple tasks active", () => {
    const e = fresh();
    e.start({ title: "A", importance: 3 });
    e.start({ title: "B", importance: 3 });
    expect(e.board().columns.doing.length).toBe(2);
  });

  it("log backfills a finished span", () => {
    const e = fresh();
    const r = e.log({ title: "Standup", importance: 1, tags: ["meeting"], dur: "30m", at: "-3h" }) as {
      task: string;
    };
    expect(e.board().columns.done.map((t) => t.id)).toContain(r.task);
  });
});

describe("engine — edit & rename", () => {
  it("edits fields and clears an optional one", () => {
    const e = fresh();
    e.add({ title: "Draft doc", importance: 1, project: "dosc", est: "2h", deadline: "2026-08-10" });
    const r = e.edit({ query: "draft", importance: 5, urgency: 4, project: "docs", est: "3h" }) as { changed: string[] };
    expect(r.changed).toEqual(expect.arrayContaining(["importance", "urgency", "project", "est"]));
    let t = e.projection.tasks.get("draft-doc")!;
    expect(t.importance).toBe(5);
    expect(t.urgency).toBe(4);
    expect(t.project).toBe("docs");
    expect(t.estMin).toBe(180);

    e.edit({ query: "draft", clear: ["deadline"] });
    t = e.projection.tasks.get("draft-doc")!;
    expect(t.deadline).toBeUndefined();
  });

  it("reparents under a WBS parent and rejects cycles", () => {
    const e = fresh();
    e.add({ title: "Parent", importance: 3 });
    e.add({ title: "Child", importance: 3 });
    e.edit({ query: "child", parent: "parent" });
    expect(e.projection.tasks.get("child")!.parent).toBe("parent");
    // making the parent a child of its own child would be a cycle
    const bad = e.edit({ query: "parent", parent: "child" }) as { error?: string };
    expect(bad.error).toMatch(/cycle/);
  });

  it("renames a project across every task and reflects on the board", () => {
    const e = fresh();
    e.add({ title: "A", importance: 3, project: "ap" });
    e.add({ title: "B", importance: 3, project: "ap" });
    const r = e.rename({ project: "ap", to: "api" }) as { tasks: number };
    expect(r.tasks).toBe(2);
    expect([...e.projection.tasks.values()].every((t) => t.project === "api")).toBe(true);
    expect(e.rename({ project: "nope", to: "x" })).toHaveProperty("error");
  });

  it("keeps the log valid after edit/rename", () => {
    const e = fresh();
    e.add({ title: "T", importance: 3, project: "x" });
    e.edit({ query: "t", est: "1h" });
    e.rename({ project: "x", to: "y" });
    expect(e.check().ok).toBe(true);
  });
});

describe("engine — resolution", () => {
  it("asks to disambiguate a close match", () => {
    const e = fresh();
    e.add({ title: "Auth bug", importance: 5 });
    e.add({ title: "Auth refactor", importance: 3 });
    const r = e.start({ query: "auth" }) as { needsDisambiguation?: unknown[] };
    expect(r.needsDisambiguation?.length).toBe(2);
  });
});

describe("engine — interruptions & report", () => {
  it("counts an urgent switch as an interruption", () => {
    const e = fresh();
    e.start({ title: "Feature", importance: 5 });
    e.stop({ query: "feature", status: "paused" });
    e.start({ title: "Hotfix", importance: 5, reason: "urgent" });
    const rep = e.report({ window: "today" }) as { data: { interruptions: number } };
    expect(rep.data.interruptions).toBe(1);
  });
});

describe("engine — planning", () => {
  it("opens a sprint and reports an on-track verdict", () => {
    const e = fresh();
    const p = e.period({ action: "open", name: "s1", start: "2026-08-03", len: "2w", capacity: 8 }) as {
      period: string;
    };
    expect(p.period).toBe("s1");
    e.add({ title: "Small task", importance: 5, est: "2h", period: "s1" });
    const rep = e.report({ window: "sprint" }) as { data: { onTrack?: { verdict: string } } };
    expect(rep.data.onTrack?.verdict).toBeDefined();
  });
});

describe("engine — check", () => {
  it("reports a clean log with quality metrics", () => {
    const e = fresh();
    e.add({ title: "A", importance: 3 });
    e.start({ query: "a" });
    e.stop({ query: "a" });
    const c = e.check();
    expect(c.ok).toBe(true);
    expect(c.quality.events).toBeGreaterThan(0);
  });
});
