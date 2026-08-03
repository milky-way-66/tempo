import { join } from "node:path";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import type { Paths } from "./config.js";
import { STORE_VERSION, readStoreVersion, writeStoreVersion } from "./version.js";
import { MIGRATIONS } from "./migrations/index.js";
import { makeContext, type Migration } from "./migrations/types.js";

export interface UpgradeStep {
  from: number;
  to: number;
  describe: string;
  guide?: string;
}

export interface UpgradeResult {
  /** Version the store was at before upgrading. */
  from: number;
  /** Version it is at after (the target). */
  to: number;
  /** The steps actually run, in order (empty when already current). */
  applied: UpgradeStep[];
  /** Directory the pre-migration snapshot was copied to, if a backup was taken. */
  backup?: string;
}

export interface UpgradeOptions {
  /** Migration chain to use. Defaults to the real registry; overridable for tests. */
  migrations?: Migration[];
  /** Version to upgrade to. Defaults to STORE_VERSION. */
  target?: number;
  /** Copy events.jsonl/config.json before touching them. Default true. */
  backup?: boolean;
  /** Timestamp label for the backup dir (injected so callers/tests stay deterministic). */
  stamp?: string;
}

/**
 * Build the exact ordered list of steps to go from `from` → `target`, one
 * version at a time. Throws if the chain has a gap (no step leaving some
 * version) — better to stop than to skip a transform and corrupt data.
 */
function planMigrations(migrations: Migration[], from: number, target: number): Migration[] {
  const byFrom = new Map<number, Migration[]>();
  for (const m of migrations) {
    const list = byFrom.get(m.from) ?? [];
    list.push(m);
    byFrom.set(m.from, list);
  }
  const plan: Migration[] = [];
  for (let v = from; v < target; v++) {
    const steps = byFrom.get(v) ?? [];
    if (steps.length === 0) throw new Error(`no migration from store v${v} to v${v + 1}`);
    if (steps.length > 1) throw new Error(`ambiguous: ${steps.length} migrations leave store v${v}`);
    plan.push(steps[0]);
  }
  return plan;
}

function backupStore(paths: Paths, from: number, stamp: string): string {
  const dir = join(paths.home, "backups", `v${from}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  for (const f of [paths.eventsFile, paths.configFile]) {
    if (existsSync(f)) copyFileSync(f, join(dir, f.slice(f.lastIndexOf("/") + 1)));
  }
  return dir;
}

/**
 * Upgrade a store to `target` (default STORE_VERSION), running each applicable
 * migration in sequence based on the store's own recorded version.
 *
 * - A store already at/above nothing-to-do returns `applied: []`.
 * - A store NEWER than this binary understands throws (tell the user to update
 *   Tempo) rather than guessing.
 * - The version file is advanced after each successful step, so an interrupted
 *   run resumes from the last completed version on the next invocation.
 */
export function upgradeStore(paths: Paths, opts: UpgradeOptions = {}): UpgradeResult {
  const migrations = opts.migrations ?? MIGRATIONS;
  const target = opts.target ?? STORE_VERSION;
  const from = Math.max(readStoreVersion(paths), 1); // treat empty/legacy as v1

  if (from > target) {
    throw new Error(
      `store is at v${from} but this Tempo only understands up to v${target} — ` +
        `update Tempo (e.g. npm i -g @milkyway-666/tempo) and retry.`,
    );
  }
  if (from === target) {
    // Normalize: a legacy store reads as v1 but may lack the marker file.
    writeStoreVersion(paths, target);
    return { from, to: target, applied: [] };
  }

  const plan = planMigrations(migrations, from, target);

  const backup =
    opts.backup === false ? undefined : backupStore(paths, from, opts.stamp ?? "backup");

  const ctx = makeContext(paths);
  const applied: UpgradeStep[] = [];
  for (const m of plan) {
    m.apply(ctx);
    writeStoreVersion(paths, m.to); // record progress so a crash mid-chain is resumable
    applied.push({ from: m.from, to: m.to, describe: m.describe, guide: m.guide });
  }
  return { from, to: target, applied, backup };
}

export interface PendingPlan {
  /** The store's currently recorded version. */
  from: number;
  /** The version this Tempo would bring it to. */
  target: number;
  /** True when the store is NEWER than this Tempo understands (needs a Tempo update). */
  newer: boolean;
  /** Ordered steps remaining to reach `target` (empty when up to date or newer). */
  steps: UpgradeStep[];
}

/**
 * Inspect (without touching the store) how many steps — and which — are needed
 * to bring it up to date. Powers "you are N versions behind" messaging in
 * `tempo check` / `tempo upgrade`.
 */
export function pendingMigrations(paths: Paths, opts: { migrations?: Migration[]; target?: number } = {}): PendingPlan {
  const migrations = opts.migrations ?? MIGRATIONS;
  const target = opts.target ?? STORE_VERSION;
  const from = Math.max(readStoreVersion(paths), 1);
  if (from >= target) return { from, target, newer: from > target, steps: [] };
  const steps = planMigrations(migrations, from, target).map((m) => ({
    from: m.from,
    to: m.to,
    describe: m.describe,
    guide: m.guide,
  }));
  return { from, target, newer: false, steps };
}
