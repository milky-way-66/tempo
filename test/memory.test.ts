import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRitualsLinked, ritualsLinked, rootClaudeMd } from "../src/core/memory";
import type { Paths } from "../src/core/config";

function tmpStore(): Paths {
  const root = mkdtempSync(join(tmpdir(), "tempo-mem-"));
  const home = join(root, ".tempo");
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

describe("rituals memory link", () => {
  it("creates a root CLAUDE.md with the import when none exists", () => {
    const paths = tmpStore();
    expect(ritualsLinked(paths)).toBe(false);
    const r = ensureRitualsLinked(paths);
    expect(r).toBe("created");
    const md = readFileSync(rootClaudeMd(paths), "utf8");
    expect(md).toContain("@.tempo/assets/CLAUDE.md");
    expect(ritualsLinked(paths)).toBe(true);
  });

  it("appends the import to an existing CLAUDE.md, preserving content", () => {
    const paths = tmpStore();
    writeFileSync(rootClaudeMd(paths), "# My project\n\nSome existing notes.\n", "utf8");
    const r = ensureRitualsLinked(paths);
    expect(r).toBe("patched");
    const md = readFileSync(rootClaudeMd(paths), "utf8");
    expect(md).toContain("Some existing notes.");
    expect(md).toContain("@.tempo/assets/CLAUDE.md");
  });

  it("is idempotent — a second call reports present and does not duplicate", () => {
    const paths = tmpStore();
    ensureRitualsLinked(paths);
    const r = ensureRitualsLinked(paths);
    expect(r).toBe("present");
    const md = readFileSync(rootClaudeMd(paths), "utf8");
    expect(md.match(/@\.tempo\/assets\/CLAUDE\.md/g)).toHaveLength(1);
  });

  it("does not create a file when just checking", () => {
    const paths = tmpStore();
    expect(ritualsLinked(paths)).toBe(false);
    expect(existsSync(rootClaudeMd(paths))).toBe(false);
  });
});
