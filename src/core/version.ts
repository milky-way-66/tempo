import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Paths } from "./config.js";

/**
 * On-disk store format version. Bump this by exactly 1 whenever the layout of
 * `.tempo/` (the shape of `events.jsonl` / `config.json`, or the files present)
 * changes in a way older data must be transformed to match — and add the
 * matching step to `MIGRATIONS` in ./migrations. The number of migrations must
 * always equal `STORE_VERSION - 1`.
 */
export const STORE_VERSION = 3;

/** The `.tempo/version` marker file. */
export function versionFile(paths: Paths): string {
  return join(paths.home, "version");
}

/**
 * The version of a store on disk. A store with no marker file is a
 * pre-versioning layout (the original `~/.tempo`), format-identical to v1, so
 * it reads as 1. A brand-new/empty store reports 0 so callers can tell it apart.
 */
export function readStoreVersion(paths: Paths): number {
  const f = versionFile(paths);
  if (existsSync(f)) {
    const n = parseInt(readFileSync(f, "utf8").trim(), 10);
    return Number.isFinite(n) ? n : 1;
  }
  return existsSync(paths.eventsFile) ? 1 : 0;
}

export function writeStoreVersion(paths: Paths, v: number = STORE_VERSION): void {
  writeFileSync(versionFile(paths), `${v}\n`, "utf8");
}
