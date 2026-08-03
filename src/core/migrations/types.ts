import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import type { Paths } from "../config.js";

/**
 * What a migration is handed. It reads and rewrites the store as *raw JSON* —
 * deliberately untyped, because a migration's whole job is to change the shape
 * the typed `Event`/`Config` no longer describe. Events are transformed as a
 * whole array (rewritten atomically), so a step can add, drop, rename, split,
 * or reorder events freely.
 */
export interface MigrationContext {
  paths: Paths;
  /** Every event as raw parsed JSON, in file order. Throws on a malformed line. */
  readEvents(): Record<string, unknown>[];
  /** Replace the whole event log with these objects (atomic write). */
  writeEvents(events: Record<string, unknown>[]): void;
  /** `config.json` as raw JSON (`{}` when absent). */
  readConfig(): Record<string, unknown>;
  writeConfig(config: Record<string, unknown>): void;
}

/**
 * A single-step upgrade of the on-disk store from version `from` to `from + 1`.
 * Keep `apply` deterministic and self-contained: it must not import the current
 * typed schema (that shape is a moving target), only touch data through `ctx`.
 */
export interface Migration {
  /** The store version this step upgrades FROM. */
  from: number;
  /** The store version this step produces. Must equal `from + 1`. */
  to: number;
  /** One line shown to the user, e.g. "rename `estMin` → `estimateMinutes`". */
  describe: string;
  /**
   * How to migrate to this version, for the user: what changed and what to do.
   * `tempo upgrade` handles the data automatically, so this is context — a
   * sentence, or a pointer to a doc/script (e.g. "see docs/migrations.md#v3").
   */
  guide?: string;
  apply(ctx: MigrationContext): void;
}

/** Declare a migration, enforcing the single-step invariant at load time. */
export function defineMigration(m: Migration): Migration {
  if (m.to !== m.from + 1) {
    throw new Error(`migration must be a single step, got v${m.from} → v${m.to}`);
  }
  if (!m.describe.trim()) throw new Error(`migration v${m.from} → v${m.to} needs a description`);
  return m;
}

function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

/** Build the context a migration operates through, bound to one store. */
export function makeContext(paths: Paths): MigrationContext {
  return {
    paths,
    readEvents() {
      if (!existsSync(paths.eventsFile)) return [];
      const lines = readFileSync(paths.eventsFile, "utf8").split("\n");
      const out: Record<string, unknown>[] = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        try {
          out.push(JSON.parse(raw) as Record<string, unknown>);
        } catch (e) {
          // Never silently drop data during a migration — stop and report.
          throw new Error(`events.jsonl line ${i + 1} is not valid JSON: ${(e as Error).message}`);
        }
      }
      return out;
    },
    writeEvents(events) {
      const body = events.map((e) => JSON.stringify(e)).join("\n");
      writeAtomic(paths.eventsFile, events.length ? body + "\n" : "");
    },
    readConfig() {
      if (!existsSync(paths.configFile)) return {};
      return JSON.parse(readFileSync(paths.configFile, "utf8")) as Record<string, unknown>;
    },
    writeConfig(config) {
      writeAtomic(paths.configFile, JSON.stringify(config, null, 2) + "\n");
    },
  };
}
