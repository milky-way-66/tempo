import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import type { Paths } from "./config.js";

/**
 * Prepare the `.tempo/` store. It lives *inside* your management repo as plain
 * tracked files — Tempo does not create its own repo and never commits for you;
 * you commit `.tempo/` with your normal git workflow. The `merge=union`
 * attribute keeps `events.jsonl` conflict-free when the log diverges across
 * machines. Idempotent.
 */
export function initStore(paths: Paths): void {
  if (!existsSync(paths.home)) mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.gitattributesFile, "events.jsonl merge=union\n", "utf8");
}
