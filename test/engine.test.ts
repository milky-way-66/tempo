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
      imp: "high",
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
    e.start({ title: "A", imp: "med" });
    e.start({ title: "B", imp: "med" });
    expect(e.board().columns.doing.length).toBe(2);
  });

  it("log backfills a finished span", () => {
    const e = fresh();
    const r = e.log({ title: "Standup", imp: "low", tags: ["meeting"], dur: "30m", at: "-3h" }) as {
      task: string;
    };
    expect(e.board().columns.done.map((t) => t.id)).toContain(r.task);
  });
});

describe("engine — resolution", () => {
  it("asks to disambiguate a close match", () => {
    const e = fresh();
    e.add({ title: "Auth bug", imp: "high" });
    e.add({ title: "Auth refactor", imp: "med" });
    const r = e.start({ query: "auth" }) as { needsDisambiguation?: unknown[] };
    expect(r.needsDisambiguation?.length).toBe(2);
  });
});

describe("engine — interruptions & report", () => {
  it("counts an urgent switch as an interruption", () => {
    const e = fresh();
    e.start({ title: "Feature", imp: "high" });
    e.stop({ query: "feature", status: "paused" });
    e.start({ title: "Hotfix", imp: "high", reason: "urgent" });
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
    e.add({ title: "Small task", imp: "high", est: "2h", period: "s1" });
    const rep = e.report({ window: "sprint" }) as { data: { onTrack?: { verdict: string } } };
    expect(rep.data.onTrack?.verdict).toBeDefined();
  });
});

describe("engine — check", () => {
  it("reports a clean log with quality metrics", () => {
    const e = fresh();
    e.add({ title: "A", imp: "med" });
    e.start({ query: "a" });
    e.stop({ query: "a" });
    const c = e.check();
    expect(c.ok).toBe(true);
    expect(c.quality.events).toBeGreaterThan(0);
  });
});
