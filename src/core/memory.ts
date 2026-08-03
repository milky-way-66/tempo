import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Paths } from "./config.js";

// Claude Code auto-loads memory from a CLAUDE.md at the repo root, not from
// `.tempo/assets/CLAUDE.md`. So the store links its rituals into the root file
// with an `@import` (a single source of truth that auto-syncs when Tempo bumps
// the rituals), rather than leaving the user to copy them by hand.

/** Import path (posix, relative to the repo root) that pulls in Tempo's rituals. */
export function ritualsImportPath(paths: Paths): string {
  return `${basename(paths.home)}/assets/CLAUDE.md`;
}

/** The repo-root CLAUDE.md that Claude Code auto-loads (sibling of the store). */
export function rootClaudeMd(paths: Paths): string {
  return join(dirname(paths.home), "CLAUDE.md");
}

/** True when the root CLAUDE.md exists and imports Tempo's rituals. */
export function ritualsLinked(paths: Paths): boolean {
  const file = rootClaudeMd(paths);
  return existsSync(file) && readFileSync(file, "utf8").includes(ritualsImportPath(paths));
}

export type LinkResult = "created" | "patched" | "present";

const MARKER = "<!-- tempo:rituals — auto-managed; keeps Tempo's narrate-and-record rituals in memory -->";

/**
 * Ensure the repo-root CLAUDE.md imports Tempo's rituals. Creates the file if
 * missing, otherwise appends the import line when absent. Idempotent.
 */
export function ensureRitualsLinked(paths: Paths): LinkResult {
  const file = rootClaudeMd(paths);
  const importLine = `@${ritualsImportPath(paths)}`;

  if (!existsSync(file)) {
    writeFileSync(file, `# Project memory\n\n${MARKER}\n${importLine}\n`, "utf8");
    return "created";
  }

  const current = readFileSync(file, "utf8");
  if (current.includes(ritualsImportPath(paths))) return "present";

  const gap = current.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(file, `${gap}${MARKER}\n${importLine}\n`, "utf8");
  return "patched";
}
