import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine";
import { initStore } from "../src/core/git";
import type { Paths } from "../src/core/config";

function tmpPaths(): Paths {
  const root = mkdtempSync(join(tmpdir(), "tempo-git-"));
  const home = join(root, ".tempo");
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

describe("store", () => {
  it("initStore creates the dir with a union-merge attribute and no nested repo", () => {
    const paths = tmpPaths();
    initStore(paths);
    expect(existsSync(paths.home)).toBe(true);
    expect(existsSync(join(paths.home, ".git"))).toBe(false);
    expect(readFileSync(paths.gitattributesFile, "utf8")).toContain("events.jsonl merge=union");
  });

  it("writes events to events.jsonl without committing (the host repo owns commits)", () => {
    const paths = tmpPaths();
    initStore(paths);
    const e = new Engine(paths);
    e.add({ title: "A", imp: "med" });
    e.start({ query: "a" });
    const log = readFileSync(paths.eventsFile, "utf8");
    expect(log).toContain("task.created");
    expect(log).toContain("task.started");
    // Tempo never creates its own git repo inside the store.
    expect(readdirSync(paths.home)).not.toContain(".git");
  });
});
