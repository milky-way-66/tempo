import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../../src/core/engine";
import type { Paths } from "../../src/core/config";

function tmpPaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-tools-"));
  return { home, eventsFile: join(home, "events.jsonl"), configFile: join(home, "config.json"), gitattributesFile: join(home, ".gitattributes") };
}
const fresh = () => new Engine(tmpPaths());

describe("note", () => {
  it("attaches a note to the single active task", () => {
    const e = fresh();
    e.start({ title: "Coding", important: true });
    const r = e.note({ text: "hit a snag", energy: "hard" }) as { ok: boolean; task?: string };
    expect(r.ok).toBe(true);
    expect(r.task).toBe("coding");
    expect(e.check().ok).toBe(true);
  });

  it("resolves an explicit query, even for a done task", () => {
    const e = fresh();
    e.add({ title: "Shipped", important: true });
    e.start({ query: "shipped" });
    e.stop({ query: "shipped" });
    const r = e.note({ query: "shipped", text: "post-mortem" }) as { ok: boolean; task?: string };
    expect(r.task).toBe("shipped");
  });

  it("records an untargeted note when nothing is active", () => {
    const e = fresh();
    const r = e.note({ text: "general thought" }) as { ok: boolean; task?: string };
    expect(r.ok).toBe(true);
    expect(r.task).toBeUndefined();
  });
});

describe("log", () => {
  it("backfills a finished span for a new task", () => {
    const e = fresh();
    const r = e.log({ title: "Standup", important: false, tags: ["meeting"], dur: "30m", at: "2026-08-05T09:00:00Z" }) as { task: string };
    expect(r.task).toBe("standup");
    expect(e.board().columns.done.map((t) => t.id)).toContain("standup");
    expect(e.check().ok).toBe(true);
  });

  it("logs against an existing task by query", () => {
    const e = fresh();
    e.add({ title: "Review PRs", important: false });
    const r = e.log({ query: "review", dur: "45m", at: "2026-08-05T09:00:00Z" }) as { task: string };
    expect(r.task).toBe("review-prs");
  });
});

describe("period", () => {
  it("opens a sprint with a derived name and end date", () => {
    const e = fresh();
    const r = e.period({ action: "open", start: "2026-08-03", len: "2w" }) as { period: string; start: string; end: string };
    expect(r.period).toBe("sprint-2026-08-03");
    expect(r.start).toBe("2026-08-03");
    expect(r.end).toBe("2026-08-16"); // 2 weeks minus a day
  });

  it("closes the open period when none is named", () => {
    const e = fresh();
    e.period({ action: "open", name: "s1", start: "2026-08-03", len: "1w" });
    const r = e.period({ action: "close" }) as { period: string; closed: boolean };
    expect(r).toEqual({ period: "s1", closed: true });
  });

  it("errors on close with nothing open and on a bad length", () => {
    const e = fresh();
    expect(e.period({ action: "close" })).toHaveProperty("error");
    expect(e.period({ action: "open", len: "banana" })).toHaveProperty("error");
  });
});

describe("rename", () => {
  it("errors when arguments are missing or no tasks carry the project", () => {
    const e = fresh();
    expect(e.rename({ project: "", to: "x" })).toHaveProperty("error");
    expect(e.rename({ project: "ghost", to: "x" })).toHaveProperty("error");
  });
});

describe("archive", () => {
  it("hides an archived task from later resolution (re-archiving can't find it)", () => {
    const e = fresh();
    e.add({ title: "Task", important: false });
    expect((e.archive({ query: "task" }) as { archived?: boolean }).archived).toBe(true);
    expect(e.archive({ query: "task" })).toHaveProperty("error"); // now hidden
  });

  it("restoring a task that was never archived is a no-op", () => {
    const e = fresh();
    e.add({ title: "Task", important: false });
    const r = e.archive({ query: "task", restore: true }) as { noop?: boolean; archived?: boolean };
    expect(r.noop).toBe(true);
    expect(r.archived).toBe(false);
  });
});

describe("board & report views", () => {
  it("filters the board by project", () => {
    const e = fresh();
    e.add({ title: "Api thing", important: true, project: "api" });
    e.add({ title: "Doc thing", important: false, project: "docs" });
    const ids = Object.values(e.board("api").columns).flat().map((t) => t.id);
    expect(ids).toEqual(["api-thing"]);
  });

  it("returns report text and data through the engine", () => {
    const e = fresh();
    e.log({ title: "Meeting", important: false, dur: "1h", at: "-1h" }); // an hour ago → inside today
    const r = e.report({ window: "today" }) as { text: string; data: { grossMin: number } };
    expect(r.text).toContain("today:");
    expect(r.data.grossMin).toBeGreaterThan(0);
  });
});

describe("start / stop edge cases", () => {
  it("start with neither query nor title errors", () => {
    const e = fresh();
    expect(e.start({})).toHaveProperty("error");
  });

  it("stop with no active task errors", () => {
    const e = fresh();
    expect(e.stop({})).toHaveProperty("error");
  });

  it("stop asks to disambiguate when several tasks are active", () => {
    const e = fresh();
    e.start({ title: "One", important: false });
    e.start({ title: "Two", important: false });
    const r = e.stop({}) as { needsDisambiguation?: unknown[] };
    expect(r.needsDisambiguation?.length).toBe(2);
  });

  it("switching back to an already-active task is idempotent", () => {
    const e = fresh();
    e.start({ title: "Focus", important: true });
    const r = e.start({ query: "focus" }) as { alreadyActive?: boolean };
    expect(r.alreadyActive).toBe(true);
    expect(e.board().columns.doing.length).toBe(1);
  });
});
