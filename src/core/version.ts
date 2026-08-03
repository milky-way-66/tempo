import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Paths } from "./config.js";

/**
 * On-disk store format version. Bump this whenever the layout of `.tempo/`
 * (the shape of `events.jsonl`, `config.json`, or the files present) changes in
 * a way that older data must be transformed to match. For every bump add one
 * entry to `MIGRATIONS` describing and performing the upgrade.
 */
export const STORE_VERSION = 1;

/** The `.tempo/version` marker file. */
function versionFile(paths: Paths): string {
  return join(paths.home, "version");
}

/**
 * The version of a store on disk. A store with no marker file is a pre-versioning
 * layout (the original `~/.tempo`), which is format-identical to v1, so we read
 * it as 1. A brand-new/empty store reports 0 so callers can tell it apart.
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

export interface Migration {
  /** Applies to a store currently at this version, producing `to`. */
  from: number;
  to: number;
  /** One line shown to the user describing what this step does. */
  describe: string;
  /** Transform the on-disk store in place. Must be idempotent-safe on retry. */
  apply: (paths: Paths) => void;
}

/**
 * Ordered format migrations. Each takes a store from `from` → `to`. There are
 * none yet (v1 is the first versioned format). When you bump STORE_VERSION to 2,
 * append `{ from: 1, to: 2, describe: "...", apply(paths) { ... } }` here.
 */
export const MIGRATIONS: Migration[] = [];

export interface UpgradeResult {
  from: number;
  to: number;
  steps: string[];
}

/**
 * Upgrade a store to STORE_VERSION, running each applicable migration in order.
 * Returns the version span and the human-readable steps performed (empty when
 * already current). Throws if a gap in the migration chain is found.
 */
export function upgradeStore(paths: Paths): UpgradeResult {
  const from = Math.max(readStoreVersion(paths), 1); // treat empty/legacy as v1
  const steps: string[] = [];
  let cur = from;
  while (cur < STORE_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === cur);
    if (!step) throw new Error(`no migration from store v${cur} to v${cur + 1}`);
    step.apply(paths);
    steps.push(`v${step.from} → v${step.to}: ${step.describe}`);
    cur = step.to;
  }
  writeStoreVersion(paths, STORE_VERSION);
  return { from, to: STORE_VERSION, steps };
}
