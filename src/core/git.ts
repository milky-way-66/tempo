import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import type { Paths } from "./config.js";

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

export function isRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Create ~/.tempo as a git repo with a union-merge attribute for the log. Idempotent. */
export function initRepo(paths: Paths): void {
  if (!existsSync(paths.home)) mkdirSync(paths.home, { recursive: true });
  if (!isRepo(paths.home)) git(paths.home, ["init", "-q"]);
  // Ensure a committer identity exists (fresh machines may lack a global one).
  try {
    execFileSync("git", ["config", "user.email"], { cwd: paths.home, stdio: "ignore" });
  } catch {
    git(paths.home, ["config", "user.email", "tempo@localhost"]);
    git(paths.home, ["config", "user.name", "Tempo"]);
  }
  writeFileSync(paths.gitattributesFile, "events.jsonl merge=union\n", "utf8");
}

/** Best-effort commit of the whole store. Never throws; the append already persisted. */
export function commitAll(paths: Paths, message: string): { ok: boolean; error?: string } {
  try {
    if (!isRepo(paths.home)) return { ok: false, error: "not a git repo" };
    git(paths.home, ["add", "-A"]);
    try {
      git(paths.home, ["commit", "-q", "-m", message]);
    } catch {
      // nothing to commit — fine
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
