import { homedir } from "node:os";
import { join } from "node:path";
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

/** Resolve the Tempo home dir. `TEMPO_HOME` overrides (used by tests). */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.TEMPO_HOME || join(homedir(), ".tempo");
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

export function loadConfig(paths: Paths = resolvePaths()): Config {
  if (!existsSync(paths.configFile)) return ConfigSchema.parse({});
  const raw = JSON.parse(readFileSync(paths.configFile, "utf8"));
  return ConfigSchema.parse(raw);
}

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}
