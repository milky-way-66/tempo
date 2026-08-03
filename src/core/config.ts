import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";

export const ConfigSchema = z.object({
  timezone: z.string().default("system"),
  capacityHoursPerDay: z.number().positive().default(8),
  workDays: z
    .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
    .default(["mon", "tue", "wed", "thu", "fri"]),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface Paths {
  home: string;
  eventsFile: string;
  configFile: string;
  gitattributesFile: string;
}

function pathsFor(home: string): Paths {
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

/** Walk up from `start` to the nearest ancestor containing a `.tempo/` dir. */
function findTempoHome(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".tempo"))) return join(dir, ".tempo");
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The legacy global store (`~/.tempo`), used only as a migration source. */
export function globalHome(): string {
  return join(homedir(), ".tempo");
}

/**
 * Resolve the store for runtime commands (mcp/check). The store lives inside
 * your management repo: `TEMPO_HOME` wins, otherwise the nearest `.tempo/`
 * walking up from the cwd, otherwise `.tempo/` in the cwd. Because the MCP
 * server is launched by Claude Code with the workspace as its cwd, this finds
 * the repo's store no matter which subfolder it starts in.
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.TEMPO_HOME || findTempoHome(process.cwd()) || join(process.cwd(), ".tempo");
  return pathsFor(home);
}

/** Resolve where `init`/`migrate` create the store: `.tempo/` in the cwd (or `TEMPO_HOME`). */
export function initPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.TEMPO_HOME || join(process.cwd(), ".tempo");
  return pathsFor(home);
}

export function loadConfig(paths: Paths = resolvePaths()): Config {
  if (!existsSync(paths.configFile)) return ConfigSchema.parse({});
  const raw = JSON.parse(readFileSync(paths.configFile, "utf8"));
  return ConfigSchema.parse(raw);
}

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}
