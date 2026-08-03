#!/usr/bin/env node
import { existsSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "./core/engine.js";
import { buildServer } from "./server.js";
import { initStore } from "./core/git.js";
import { initPaths, globalHome, defaultConfig, type Paths } from "./core/config.js";
import { STORE_VERSION, writeStoreVersion, readStoreVersion } from "./core/version.js";
import { upgradeStore } from "./core/migrate.js";
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
          `Upgraded store v${upgrade.from} → v${upgrade.to}:`,
          ...upgrade.applied.map((s) => `  • v${s.from} → v${s.to}: ${s.describe}`),
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
} else if (cmd === "check") {
  const e = new Engine();
  const linked = ritualsLinked(e.paths);
  const rituals = linked
    ? { memoryLinked: true }
    : {
        memoryLinked: false,
        warning: `rituals not in Claude Code memory — add "@${ritualsImportPath(e.paths)}" to ${rootClaudeMd(e.paths)} (or re-run \`tempo init\`).`,
      };
  const out = { storeVersion: readStoreVersion(e.paths), rituals, ...e.check() };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} else if (cmd === "mcp") {
  startMcp().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
} else {
  process.stderr.write(`unknown command: ${cmd}\nusage: tempo [init|migrate|check|mcp]\n`);
  process.exit(1);
}
