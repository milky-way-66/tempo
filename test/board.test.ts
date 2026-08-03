import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Engine } from "../src/core/engine";
import { metricsMarkdown } from "../src/core/report";
import { replay } from "../src/core/replay";
import { ConfigSchema, type Paths } from "../src/core/config";
import type { Event } from "../src/types";

function tmpStore(): Paths {
  const root = mkdtempSync(join(tmpdir(), "tempo-board-"));
  const home = join(root, ".tempo"); // mirror production: store nested in the repo root
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
    const boardFile = join(dirname(paths.home), "board.md"); // repo root, beside .tempo
    const e = new Engine(paths);

    e.add({ title: "Auth bug", importance: 5, project: "api", deadline: "2026-08-10" });
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
    const md = readFileSync(join(dirname(paths.home), "board.md"), "utf8");
    expect(md).toContain("# Tempo Board");
    expect(md).toContain("**0** tasks");
    expect(md).toMatch(/\| ---/); // table separator present
    expect(md).toContain("## Metrics");
    expect(md).toContain("No time logged yet");
  });

  it("writes board.md at the repo root, not inside .tempo", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "T", importance: 3 });
    expect(existsSync(join(dirname(paths.home), "board.md"))).toBe(true);
    expect(existsSync(join(paths.home, "board.md"))).toBe(false);
    expect(e.boardFile()).toBe(join(dirname(paths.home), "board.md"));
  });

  it("puts a backdated start (timed before its create) in Doing, not To Do", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "Fix data source page bug", importance: 5, project: "api" }); // created live (now)
    e.start({ query: "fix-data", at: "2020-01-01T09:00:00Z" }); // backdated well before the create

    const cols = e.board().columns;
    expect(cols.doing.map((t) => t.id)).toContain("fix-data-source-page-bug");
    expect(cols.todo.map((t) => t.id)).not.toContain("fix-data-source-page-bug");
    expect(e.check().ok).toBe(true); // no false "started before created"

    const md = readFileSync(join(dirname(paths.home), "board.md"), "utf8");
    // board.md must agree with the live board: the task is under Doing.
    const doingCol = md.split("\n").find((l) => l.includes("fix-data-source-page-bug"));
    expect(doingCol).toBeTruthy();
    expect(e.board().columns.doing.length).toBe(1);
  });

  it("re-renders board.md on an idempotent start (already active)", () => {
    const paths = tmpStore();
    const boardFile = join(dirname(paths.home), "board.md");
    const e = new Engine(paths);
    e.add({ title: "T", importance: 3 });
    e.start({ query: "t" });
    // wipe the snapshot, then a no-op start should rebuild it
    rmSync(boardFile);
    const r = e.start({ query: "t" }) as { alreadyActive?: boolean };
    expect(r.alreadyActive).toBe(true);
    expect(existsSync(boardFile)).toBe(true);
  });
});

describe("board — WBS hierarchy & rollup", () => {
  it("nests children under their parent in the Work Breakdown tree", () => {
    const paths = tmpStore();
    const boardFile = join(dirname(paths.home), "board.md");
    const e = new Engine(paths);
    e.add({ title: "Create project workflow", importance: 5, project: "api", est: "8h" });
    e.add({ title: "Create onboarding workflow", importance: 3, est: "3h", parent: "create-project-workflow" });

    const md = readFileSync(boardFile, "utf8");
    expect(md).toContain("## Work Breakdown");
    const lines = md.split("\n");
    const parent = lines.findIndex((l) => l.includes("`create-project-workflow`") && l.trimStart().startsWith("-"));
    const child = lines.findIndex((l) => l.includes("`create-onboarding-workflow`") && l.trimStart().startsWith("-"));
    expect(parent).toBeGreaterThanOrEqual(0);
    expect(child).toBeGreaterThan(parent); // child rendered after parent
    // child is indented deeper than the parent
    const indent = (l: string) => l.length - l.trimStart().length;
    expect(indent(lines[child])).toBeGreaterThan(indent(lines[parent]));
  });

  it("renders a project rollup with estimate vs logged", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "Task", importance: 3, project: "api", est: "2h" });
    const md = readFileSync(join(dirname(paths.home), "board.md"), "utf8");
    expect(md).toContain("## Project rollup");
    expect(md).toContain("api");
  });
});

describe("board metrics", () => {
  // Deterministic: fixed UTC "now" and past spans so window math isn't flaky.
  const config = ConfigSchema.parse({ timezone: "UTC" });
  const now = "2026-08-05T17:00:00Z"; // a Wednesday afternoon

  const ev = (o: Partial<Event> & { id: string; at: string; type: Event["type"] }) =>
    ({ logged_at: o.at, source: "live", ...o }) as Event;

  const events: Event[] = [
    ev({ id: "c1", at: "2026-08-05T09:00:00Z", type: "task.created", task: "api-work", title: "API work", importance: 5, tags: [], project: "api", estMin: 120 } as Partial<Event> as never),
    ev({ id: "s1", at: "2026-08-05T09:00:00Z", type: "task.started", task: "api-work" } as never),
    ev({ id: "e1", at: "2026-08-05T11:00:00Z", type: "task.stopped", task: "api-work", status: "done" } as never),
    ev({ id: "c2", at: "2026-08-05T13:00:00Z", type: "task.created", task: "docs", title: "Docs", importance: 1, tags: [], project: "docs" } as never),
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
    // priority split across the two 1–5 axes + the value-vs-firefighting headline
    expect(md).toContain("Time mix");
    expect(md).toContain("Time by importance");
    expect(md).toContain("Time by urgency");
    // estimate vs actual for the done, estimated task
    expect(md).toContain("Estimates vs actual");
    expect(md).toContain("api-work");
  });
});
