import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine";
import { metricsMarkdown } from "../src/core/report";
import { replay } from "../src/core/replay";
import { ConfigSchema, type Paths } from "../src/core/config";
import type { Event } from "../src/types";

function tmpStore(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-board-"));
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

describe("board.md", () => {
  it("is (re)written after each event with the current state", () => {
    const paths = tmpStore();
    const boardFile = join(paths.home, "board.md");
    const e = new Engine(paths);

    e.add({ title: "Auth bug", imp: "high", project: "api", deadline: "2026-08-10" });
    expect(existsSync(boardFile)).toBe(true);
    let md = readFileSync(boardFile, "utf8");
    expect(md).toContain("# Tempo Board");
    expect(md).toContain("Auth bug");
    expect(md).toContain("⚑"); // high importance
    expect(md).toContain("_[api]_"); // project tag
    expect(md).toContain("📋 To Do (1)");

    e.start({ query: "auth" });
    md = readFileSync(boardFile, "utf8");
    expect(md).toContain("🔨 Doing (1)");
    expect(md).toContain("📋 To Do (0)");

    e.stop({ query: "auth" });
    md = readFileSync(boardFile, "utf8");
    expect(md).toContain("✅ Done (1)");
  });

  it("renders a valid grid even with an empty log", () => {
    const paths = tmpStore();
    new Engine(paths).renderBoard();
    const md = readFileSync(join(paths.home, "board.md"), "utf8");
    expect(md).toContain("# Tempo Board");
    expect(md).toContain("**0** tasks");
    expect(md).toMatch(/\| ---/); // table separator present
    expect(md).toContain("## Metrics");
    expect(md).toContain("No time logged yet");
  });
});

describe("board metrics", () => {
  // Deterministic: fixed UTC "now" and past spans so window math isn't flaky.
  const config = ConfigSchema.parse({ timezone: "UTC" });
  const now = "2026-08-05T17:00:00Z"; // a Wednesday afternoon

  const ev = (o: Partial<Event> & { id: string; at: string; type: Event["type"] }) =>
    ({ logged_at: o.at, source: "live", ...o }) as Event;

  const events: Event[] = [
    ev({ id: "c1", at: "2026-08-05T09:00:00Z", type: "task.created", task: "api-work", title: "API work", imp: "high", tags: [], project: "api", estMin: 120 } as Partial<Event> as never),
    ev({ id: "s1", at: "2026-08-05T09:00:00Z", type: "task.started", task: "api-work" } as never),
    ev({ id: "e1", at: "2026-08-05T11:00:00Z", type: "task.stopped", task: "api-work", status: "done" } as never),
    ev({ id: "c2", at: "2026-08-05T13:00:00Z", type: "task.created", task: "docs", title: "Docs", imp: "low", tags: [], project: "docs" } as never),
    ev({ id: "s2", at: "2026-08-05T13:00:00Z", type: "task.started", task: "docs" } as never),
    ev({ id: "e2", at: "2026-08-05T14:00:00Z", type: "task.stopped", task: "docs", status: "done" } as never),
  ];

  it("renders totals, distribution by project and quadrant, and estimates", () => {
    const p = replay(events);
    const md = metricsMarkdown(p, config, now);

    expect(md).toContain("## Metrics");
    // totals: 3h gross across the week
    expect(md).toContain("Time by project");
    expect(md).toContain("api");
    expect(md).toContain("docs");
    expect(md).toContain("█"); // share bar rendered
    // quadrant split: api-work is important-not-urgent (Q2), docs is Q4
    expect(md).toContain("Time by quadrant");
    expect(md).toContain("Q2");
    expect(md).toContain("Q4");
    // estimate vs actual for the done, estimated task
    expect(md).toContain("Estimates vs actual");
    expect(md).toContain("api-work");
  });
});
