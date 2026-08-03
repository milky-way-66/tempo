import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../src/core/engine";
import { initRepo } from "../src/core/git";
import type { Paths } from "../src/core/config";

function tmpPaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-git-"));
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

describe("git integration", () => {
  it("init creates a repo with a union-merge attribute", () => {
    const paths = tmpPaths();
    initRepo(paths);
    expect(existsSync(join(paths.home, ".git"))).toBe(true);
    expect(readFileSync(paths.gitattributesFile, "utf8")).toContain("events.jsonl merge=union");
  });

  it("commits on each write", () => {
    const paths = tmpPaths();
    initRepo(paths);
    const e = new Engine(paths);
    e.add({ title: "A", imp: "med" });
    e.start({ query: "a" });
    const log = execFileSync("git", ["log", "--oneline"], { cwd: paths.home }).toString();
    expect(log).toContain("task.created");
    expect(log).toContain("task.started");
  });
});
