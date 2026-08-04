import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Engine } from "../../src/core/engine";
import { agentBoard } from "../../src/core/agent_board";
import { boardHtml } from "../../src/core/board_html";
import { replay } from "../../src/core/replay";
import { ConfigSchema, type Paths } from "../../src/core/config";
import type { Event } from "../../src/types";

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
const agentFile = (paths: Paths) => join(dirname(paths.home), "agent-board.md");
const htmlFile = (paths: Paths) => join(dirname(paths.home), "board.html");

describe("board files", () => {
  it("writes both agent-board.md and board.html after each event, dropping board.md", () => {
    const paths = tmpStore();
    const e = new Engine(paths);

    e.add({ title: "Auth bug", important: true, urgent: true, project: "api", deadline: "2026-08-10" });
    expect(existsSync(agentFile(paths))).toBe(true);
    expect(existsSync(htmlFile(paths))).toBe(true);
    expect(existsSync(join(dirname(paths.home), "board.md"))).toBe(false); // no legacy file
    expect(e.agentBoardFile()).toBe(agentFile(paths));
    expect(e.htmlFile()).toBe(htmlFile(paths));

    const md = readFileSync(agentFile(paths), "utf8");
    expect(md).toContain("# Tempo — Agent Board");
    expect(md).toContain("Auth bug");
    expect(md).toContain("class A"); // importance 5 + urgency 5 → class A
    expect(md).toContain("### To Do (1)");

    const html = readFileSync(htmlFile(paths), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Auth bug");
  });

  it("reflects status transitions in the agent board", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "Auth bug", important: true });
    e.start({ query: "auth" });
    expect(readFileSync(agentFile(paths), "utf8")).toContain("### Doing (1)");
    e.stop({ query: "auth" });
    expect(readFileSync(agentFile(paths), "utf8")).toContain("### Done (1)");
  });

  it("agent board is text-only — no charts, mermaid, or unicode bars", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "T", important: false, est: "2h" });
    const md = readFileSync(agentFile(paths), "utf8");
    expect(md).not.toContain("```mermaid");
    expect(md).not.toMatch(/[█░▁▂▃▄▅▆▇]/); // no bar/sparkline glyphs
  });

  it("puts a backdated start (timed before its create) in Doing", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "Fix data source page bug", important: true, project: "api" });
    e.start({ query: "fix-data", at: "2020-01-01T09:00:00Z" });

    const cols = e.board().columns;
    expect(cols.doing.map((t) => t.id)).toContain("fix-data-source-page-bug");
    expect(e.check().ok).toBe(true);
    const md = readFileSync(agentFile(paths), "utf8");
    expect(md).toContain("### Doing (1)");
    expect(md).toContain("fix-data-source-page-bug");
  });

  it("re-renders on an idempotent start (already active)", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "T", important: false });
    e.start({ query: "t" });
    rmSync(agentFile(paths));
    const r = e.start({ query: "t" }) as { alreadyActive?: boolean };
    expect(r.alreadyActive).toBe(true);
    expect(existsSync(agentFile(paths))).toBe(true);
  });
});

describe("board — WBS hierarchy & rollup", () => {
  it("nests children under their parent in the Work breakdown outline", () => {
    const paths = tmpStore();
    const e = new Engine(paths);
    e.add({ title: "Create project workflow", important: true, project: "api", est: "8h" });
    e.add({ title: "Create onboarding workflow", important: false, est: "3h", parent: "create-project-workflow" });

    const md = readFileSync(agentFile(paths), "utf8");
    expect(md).toContain("## Work breakdown");
    // scope to the Work-breakdown outline (the task ids also appear under Tasks by status)
    const lines = md.slice(md.indexOf("## Work breakdown")).split("\n");
    const parent = lines.findIndex((l) => l.includes("`create-project-workflow`") && l.trimStart().startsWith("-"));
    const child = lines.findIndex((l) => l.includes("`create-onboarding-workflow`") && l.trimStart().startsWith("-"));
    expect(parent).toBeGreaterThanOrEqual(0);
    expect(child).toBeGreaterThan(parent);
    const indent = (l: string) => l.length - l.trimStart().length;
    expect(indent(lines[child])).toBeGreaterThan(indent(lines[parent]));
  });
});

describe("board.html — visual", () => {
  it("plots an SVG scatter dot per open task", () => {
    const config = ConfigSchema.parse({ timezone: "UTC" });
    const p = replay([
      { id: "c1", at: "2026-08-03T09:00:00Z", logged_at: "2026-08-03T09:00:00Z", source: "live", type: "task.created", task: "ship", title: "Ship", important: true, urgent: true, tags: [] },
      { id: "c2", at: "2026-08-03T09:00:00Z", logged_at: "2026-08-03T09:00:00Z", source: "live", type: "task.created", task: "tidy", title: "Tidy", important: false, urgent: false, tags: [] },
    ] as unknown as Event[]);
    const html = boardHtml(p, config, "2026-08-03T10:00:00Z");
    expect(html).toContain("Priority map");
    expect(html).toContain("echarts"); // charting lib via CDN
    expect(html).toContain('id="scatter"');
    expect(html).toContain("echarts.init");
    expect(html).toContain('"title":"Ship"'); // task data embedded for the chart
    expect(html).toContain('"title":"Tidy"');
  });

  it("renders the Work Breakdown as a self-contained CSS calendar (titles, not slugs)", () => {
    const config = ConfigSchema.parse({ timezone: "UTC" });
    const p = replay([
      { id: "c1", at: "2026-08-03T09:00:00Z", logged_at: "2026-08-03T09:00:00Z", source: "live", type: "task.created", task: "ship-it", title: "Ship it", important: true, urgent: true, estMin: 120, deadline: "2026-08-10", tags: [] },
    ] as unknown as Event[]);
    const html = boardHtml(p, config, "2026-08-03T10:00:00Z");
    expect(html).toContain("Work Breakdown");
    expect(html).not.toContain("frappe-gantt"); // no external Gantt lib
    expect(html).not.toContain("new Gantt("); // rendered as plain HTML, no JS lib
    expect(html).toContain('class="g-tt">Ship it</span>'); // readable title in the fixed left column
    expect(html).toContain('class="g-bar'); // a positioned planned bar
    expect(html).toMatch(/class="g-bar[^"]*"[^>]*style="[^"]*left:[\d.]+%;width:[\d.]+%/); // positioned by %
    expect(html).toContain("#c96a6a"); // category-A color on the bar
    expect(html).toContain('class="g-today"'); // today line inside the window
  });

  it("shows value KPIs in the metrics section", () => {
    const config = ConfigSchema.parse({ timezone: "UTC" });
    const p = replay([
      { id: "c1", at: "2026-08-03T02:00:00Z", logged_at: "2026-08-03T02:00:00Z", source: "live", type: "task.created", task: "a", title: "A", important: true, urgent: false, estMin: 120, tags: [] },
      { id: "s1", at: "2026-08-03T02:00:00Z", logged_at: "2026-08-03T02:00:00Z", source: "live", type: "task.started", task: "a" },
      { id: "e1", at: "2026-08-03T04:00:00Z", logged_at: "2026-08-03T04:00:00Z", source: "live", type: "task.stopped", task: "a", status: "done" },
    ] as unknown as Event[]);
    const html = boardHtml(p, config, "2026-08-03T10:00:00Z");
    expect(html).toContain("Focus");
    expect(html).toContain("Firefighting");
    expect(html).toContain("Delivered");
    expect(html).toContain("on important work");
    expect(html).not.toContain("Multitask"); // old low-value tile gone
  });
});

describe("agent board — time & priority", () => {
  const config = ConfigSchema.parse({ timezone: "UTC" });
  const now = "2026-08-05T17:00:00Z"; // Wednesday afternoon

  const ev = (o: Partial<Event> & { id: string; at: string; type: Event["type"] }) =>
    ({ logged_at: o.at, source: "live", ...o }) as Event;

  const events: Event[] = [
    ev({ id: "c1", at: "2026-08-05T09:00:00Z", type: "task.created", task: "api-work", title: "API work", important: true, tags: [], project: "api", estMin: 120 } as never),
    ev({ id: "s1", at: "2026-08-05T09:00:00Z", type: "task.started", task: "api-work" } as never),
    ev({ id: "e1", at: "2026-08-05T11:00:00Z", type: "task.stopped", task: "api-work", status: "done" } as never),
    ev({ id: "c2", at: "2026-08-05T13:00:00Z", type: "task.created", task: "docs", title: "Docs", important: false, tags: [], project: "docs" } as never),
    ev({ id: "s2", at: "2026-08-05T13:00:00Z", type: "task.started", task: "docs" } as never),
    ev({ id: "e2", at: "2026-08-05T14:00:00Z", type: "task.stopped", task: "docs", status: "done" } as never),
  ];

  it("describes totals, project split, and priority mix in prose", () => {
    const md = agentBoard(replay(events), config, now);
    expect(md).toContain("## Time & priority");
    expect(md).toContain("By project:");
    expect(md).toContain("api");
    expect(md).toContain("docs");
    expect(md).toContain("Priority mix:");
    expect(md).toContain("By category:");
    expect(md).toContain("Estimates vs actual:");
    expect(md).toContain("api-work");
  });
});
