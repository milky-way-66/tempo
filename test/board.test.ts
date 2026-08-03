import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine";
import type { Paths } from "../src/core/config";

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
  });
});
