import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Event } from "../types.js";
import type { Paths } from "./config.js";

export interface ParseIssue {
  line: number;
  error: string;
  raw: string;
}

export interface ReadResult {
  events: Event[];
  issues: ParseIssue[];
}

function ensureDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append one event as a single JSON line. The ONLY writer of the log. */
export function append(paths: Paths, event: Event): void {
  ensureDir(paths.eventsFile);
  appendFileSync(paths.eventsFile, JSON.stringify(event) + "\n", "utf8");
}

/** Read and parse the whole log. Malformed lines are collected, not thrown. */
export function readAll(paths: Paths): ReadResult {
  const events: Event[] = [];
  const issues: ParseIssue[] = [];
  if (!existsSync(paths.eventsFile)) return { events, issues };
  const text = readFileSync(paths.eventsFile, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      events.push(JSON.parse(raw) as Event);
    } catch (e) {
      issues.push({ line: i + 1, error: (e as Error).message, raw });
    }
  }
  return { events, issues };
}
