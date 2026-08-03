#!/usr/bin/env node
import { existsSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "./core/engine.js";
import { buildServer } from "./server.js";
import { initStore } from "./core/git.js";
import { initPaths, resolvePaths, globalHome, defaultConfig, type Paths } from "./core/config.js";
import { STORE_VERSION, writeStoreVersion, readStoreVersion } from "./core/version.js";
import { upgradeStore, pendingMigrations, type UpgradeStep } from "./core/migrate.js";
import {
  ensureRitualsLinked,
  ritualsLinked,
  ritualsImportPath,
  rootClaudeMd,
  type LinkResult,
} from "./core/memory.js";

function packageRoot(): string {
  // Bundled to dist/bin.js → package root is one level up (assets/ ships alongside dist/).
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Filesystem-safe timestamp for backup dir names, e.g. 20260803-115700. */
function stampNow(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").replace(/\..+$/, "").replace(/(\d{8})(\d{6})/, "$1-$2");
}

/** Human lines for a list of migration steps: describe + optional guide. */
function stepLines(steps: UpgradeStep[]): string[] {
  return steps.flatMap((s) => [
    `  • v${s.from} → v${s.to}: ${s.describe}`,
    ...(s.guide ? [`      ↳ ${s.guide}`] : []),
  ]);
}

function writeConfigIfAbsent(paths: Paths): void {
  if (!existsSync(paths.configFile)) {
    writeFileSync(paths.configFile, JSON.stringify(defaultConfig(), null, 2) + "\n", "utf8");
  }
}

function copyAssets(paths: Paths): void {
  const assetsSrc = join(packageRoot(), "assets");
  if (existsSync(assetsSrc)) {
    cpSync(assetsSrc, join(paths.home, "assets"), { recursive: true });
  }
}

function ritualLine(paths: Paths, link: LinkResult): string {
  const md = rootClaudeMd(paths);
  if (link === "created") return `Created ${md} importing the rituals (@${ritualsImportPath(paths)}).`;
  if (link === "patched") return `Added the rituals import (@${ritualsImportPath(paths)}) to ${md}.`;
  return `${md} already imports the rituals (@${ritualsImportPath(paths)}).`;
}

function nextSteps(paths: Paths, link: LinkResult): string {
  return [
    "",
    "The store lives inside this repo — commit it with your normal git workflow:",
    "  git add .tempo CLAUDE.md board.html agent-board.md && git commit -m \"tempo: init\"",
    "",
    `Your live boards are written to ${dirname(paths.home)} (repo root):`,
    "  board.html (visual, open in a browser) and agent-board.md (text)",
    "  — both auto-update after every logged change.",
    "",
    "Register the MCP server with Claude Code (run from this repo):",
    "  claude mcp add tempo -- npx -y @milkyway-666/tempo mcp",
    "",
    ritualLine(paths, link),
    "  Claude Code auto-loads it, so the narrate-and-record rituals take effect in this repo.",
    "  The @import stays in sync when Tempo updates the rituals.",
    "",
  ].join("\n");
}

function doInit(): void {
  const paths = initPaths();
  initStore(paths);
  writeConfigIfAbsent(paths);
  writeStoreVersion(paths);
  copyAssets(paths);
  new Engine(paths).renderBoard(); // seed the (empty) board files so they exist
  const link = ensureRitualsLinked(paths); // wire the rituals into repo-root CLAUDE.md memory
  process.stdout.write(
    `Tempo initialized at ${paths.home} (store v${STORE_VERSION})` + "\n" + nextSteps(paths, link),
  );
}

function doMigrate(): void {
  const src = globalHome();
  const srcEvents = join(src, "events.jsonl");
  const srcConfig = join(src, "config.json");
  const paths = initPaths();

  if (!existsSync(srcEvents) && !existsSync(srcConfig)) {
    process.stderr.write(`Nothing to migrate: no store found at ${src}\n`);
    process.exit(1);
  }
  if (existsSync(paths.eventsFile)) {
    process.stderr.write(
      `Refusing to overwrite the existing store at ${paths.home}.\n` +
        `Move or delete ${paths.eventsFile} first, then re-run.\n`,
    );
    process.exit(1);
  }

  initStore(paths);
  if (existsSync(srcEvents)) cpSync(srcEvents, paths.eventsFile);
  if (existsSync(srcConfig)) cpSync(srcConfig, paths.configFile);
  else writeConfigIfAbsent(paths);
  copyAssets(paths);

  // Bring the copied data up to the current store format, reporting each step.
  const upgrade = upgradeStore(paths, { stamp: stampNow() });
  new Engine(paths).renderBoard(); // re-render boards from the migrated log
  const upgradeLines =
    upgrade.applied.length === 0
      ? [`Store is at v${upgrade.to}; no format changes were needed.`]
      : [
          `Upgraded store v${upgrade.from} → v${upgrade.to} (${upgrade.applied.length} step${upgrade.applied.length === 1 ? "" : "s"}):`,
          ...stepLines(upgrade.applied),
          ...(upgrade.backup ? [`Pre-migration snapshot saved to ${upgrade.backup}`] : []),
        ];

  const link = ensureRitualsLinked(paths); // wire the rituals into repo-root CLAUDE.md memory
  process.stdout.write(
    `Migrated your Tempo store from ${src} → ${paths.home}` +
      "\n" +
      upgradeLines.join("\n") +
      "\n\nThe old ~/.tempo was left untouched; delete it once you've verified the migration." +
      "\n" +
      nextSteps(paths, link),
  );
}

/** Upgrade the in-repo store through each pending migration step, in order. */
function doUpgrade(): void {
  const paths = resolvePaths();
  if (!existsSync(paths.eventsFile)) {
    process.stderr.write(`No Tempo store found (looked for ${paths.eventsFile}). Run \`tempo init\` first.\n`);
    process.exit(1);
  }
  const plan = pendingMigrations(paths);
  if (plan.newer) {
    process.stderr.write(
      `Store is at v${plan.from} but this Tempo only understands up to v${plan.target}. ` +
        `Update Tempo (e.g. npm i -g @milkyway-666/tempo) and retry.\n`,
    );
    process.exit(1);
  }
  if (plan.steps.length === 0) {
    process.stdout.write(`Store is up to date at v${plan.from} (latest v${plan.target}).\n`);
    return;
  }
  process.stdout.write(
    `Store is v${plan.from}; latest is v${plan.target} — ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} to run:\n` +
      stepLines(plan.steps).join("\n") +
      "\n\n",
  );
  const upgrade = upgradeStore(paths, { stamp: stampNow() });
  new Engine(paths).renderBoard(); // re-render the boards from the upgraded log
  process.stdout.write(
    `Done — store is now v${upgrade.to}.` +
      (upgrade.backup ? `\nPre-upgrade snapshot saved to ${upgrade.backup}` : "") +
      `\nCommit the updated .tempo/ with your normal git workflow.\n`,
  );
}

async function startMcp(): Promise<void> {
  const engine = new Engine();
  const server = buildServer(engine);
  await server.connect(new StdioServerTransport());
}

const cmd = process.argv[2] ?? "mcp";

if (cmd === "init") {
  doInit();
} else if (cmd === "migrate") {
  doMigrate();
} else if (cmd === "upgrade") {
  doUpgrade();
} else if (cmd === "check") {
  const e = new Engine();
  const linked = ritualsLinked(e.paths);
  const rituals = linked
    ? { memoryLinked: true }
    : {
        memoryLinked: false,
        warning: `rituals not in Claude Code memory — add "@${ritualsImportPath(e.paths)}" to ${rootClaudeMd(e.paths)} (or re-run \`tempo init\`).`,
      };
  const plan = pendingMigrations(e.paths);
  const store = {
    version: plan.from,
    latest: plan.target,
    upToDate: plan.steps.length === 0 && !plan.newer,
    ...(plan.newer ? { newer: true, note: "store is newer than this Tempo — update Tempo" } : {}),
    ...(plan.steps.length
      ? {
          stepsBehind: plan.steps.length,
          hint: "run `tempo upgrade`",
          pending: plan.steps.map((s) => ({ to: s.to, describe: s.describe, guide: s.guide })),
        }
      : {}),
  };
  const out = { store, storeVersion: readStoreVersion(e.paths), rituals, ...e.check() };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} else if (cmd === "mcp") {
  startMcp().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
} else {
  process.stderr.write(`unknown command: ${cmd}\nusage: tempo [init|migrate|upgrade|check|mcp]\n`);
  process.exit(1);
}
