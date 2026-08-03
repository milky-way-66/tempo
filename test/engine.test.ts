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
      important: true,
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
    e.start({ title: "A", important: false });
    e.start({ title: "B", important: false });
    expect(e.board().columns.doing.length).toBe(2);
  });

  it("log backfills a finished span", () => {
    const e = fresh();
    const r = e.log({ title: "Standup", important: false, tags: ["meeting"], dur: "30m", at: "-3h" }) as {
      task: string;
    };
    expect(e.board().columns.done.map((t) => t.id)).toContain(r.task);
  });
});

describe("engine — edit & rename", () => {
  it("edits fields and clears an optional one", () => {
    const e = fresh();
    e.add({ title: "Draft doc", important: false, project: "dosc", est: "2h", deadline: "2026-08-10" });
    const r = e.edit({ query: "draft", important: true, urgent: true, project: "docs", est: "3h" }) as { changed: string[] };
    expect(r.changed).toEqual(expect.arrayContaining(["important", "urgent", "project", "est"]));
    let t = e.projection.tasks.get("draft-doc")!;
    expect(t.important).toBe(true);
    expect(t.urgent).toBe(true);
    expect(t.project).toBe("docs");
    expect(t.estMin).toBe(180);

    e.edit({ query: "draft", clear: ["deadline"] });
    t = e.projection.tasks.get("draft-doc")!;
    expect(t.deadline).toBeUndefined();
  });

  it("reparents under a WBS parent and rejects cycles", () => {
    const e = fresh();
    e.add({ title: "Parent", important: false });
    e.add({ title: "Child", important: false });
    e.edit({ query: "child", parent: "parent" });
    expect(e.projection.tasks.get("child")!.parent).toBe("parent");
    // making the parent a child of its own child would be a cycle
    const bad = e.edit({ query: "parent", parent: "child" }) as { error?: string };
    expect(bad.error).toMatch(/cycle/);
  });

  it("renames a project across every task and reflects on the board", () => {
    const e = fresh();
    e.add({ title: "A", important: false, project: "ap" });
    e.add({ title: "B", important: false, project: "ap" });
    const r = e.rename({ project: "ap", to: "api" }) as { tasks: number };
    expect(r.tasks).toBe(2);
    expect([...e.projection.tasks.values()].every((t) => t.project === "api")).toBe(true);
    expect(e.rename({ project: "nope", to: "x" })).toHaveProperty("error");
  });

  it("archives a task (hidden from the board) and restores it, append-only", () => {
    const e = fresh();
    e.add({ title: "Wont do this", important: false });
    e.add({ title: "Real work", important: true });
    e.archive({ query: "wont do" });
    // hidden from the board, but still in the log (append-only)
    const ids = Object.values(e.board().columns).flat().map((t) => t.id);
    expect(ids).not.toContain("wont-do-this");
    expect(ids).toContain("real-work");
    expect(e.projection.tasks.get("wont-do-this")!.archived).toBe(true);
    expect(e.check().ok).toBe(true);

    e.archive({ query: "wont do", restore: true });
    const ids2 = Object.values(e.board().columns).flat().map((t) => t.id);
    expect(ids2).toContain("wont-do-this");
    expect(e.projection.tasks.get("wont-do-this")!.archived).toBe(false);
  });

  it("keeps the log valid after edit/rename", () => {
    const e = fresh();
    e.add({ title: "T", important: false, project: "x" });
    e.edit({ query: "t", est: "1h" });
    e.rename({ project: "x", to: "y" });
    expect(e.check().ok).toBe(true);
  });
});

describe("engine — resolution", () => {
  it("asks to disambiguate a close match", () => {
    const e = fresh();
    e.add({ title: "Auth bug", important: true });
    e.add({ title: "Auth refactor", important: false });
    const r = e.start({ query: "auth" }) as { needsDisambiguation?: unknown[] };
    expect(r.needsDisambiguation?.length).toBe(2);
  });
});

describe("engine — interruptions & report", () => {
  it("counts an urgent switch as an interruption", () => {
    const e = fresh();
    e.start({ title: "Feature", important: true });
    e.stop({ query: "feature", status: "paused" });
    e.start({ title: "Hotfix", important: true, reason: "urgent" });
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
    e.add({ title: "Small task", important: true, est: "2h", period: "s1" });
    const rep = e.report({ window: "sprint" }) as { data: { onTrack?: { verdict: string } } };
    expect(rep.data.onTrack?.verdict).toBeDefined();
  });
});

describe("engine — check", () => {
  it("reports a clean log with quality metrics", () => {
    const e = fresh();
    e.add({ title: "A", important: false });
    e.start({ query: "a" });
    e.stop({ query: "a" });
    const c = e.check();
    expect(c.ok).toBe(true);
    expect(c.quality.events).toBeGreaterThan(0);
  });
});
