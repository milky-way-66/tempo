#!/usr/bin/env node
import { existsSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "./core/engine.js";
import { buildServer } from "./server.js";
import { initStore } from "./core/git.js";
import { initPaths, globalHome, defaultConfig, type Paths } from "./core/config.js";
import { STORE_VERSION, writeStoreVersion, upgradeStore, readStoreVersion } from "./core/version.js";

function packageRoot(): string {
  // Bundled to dist/bin.js → package root is one level up (assets/ ships alongside dist/).
  return join(dirname(fileURLToPath(import.meta.url)), "..");
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

function nextSteps(paths: Paths): string {
  return [
    "",
    "The store lives inside this repo — commit it with your normal git workflow:",
    "  git add .tempo && git commit -m \"tempo: init\"",
    "",
    "Register the MCP server with Claude Code (run from this repo):",
    "  claude mcp add tempo -- npx -y @milkyway-666/tempo mcp",
    "",
    `Behavior + rituals were copied to ${join(paths.home, "assets")}`,
    "  • assets/CLAUDE.md — add to your Claude Code memory",
    "  • assets/skills/rituals — the plan/standup/review/interrupt flows",
    "",
  ].join("\n");
}

function doInit(): void {
  const paths = initPaths();
  initStore(paths);
  writeConfigIfAbsent(paths);
  writeStoreVersion(paths);
  copyAssets(paths);
  process.stdout.write(
    `Tempo initialized at ${paths.home} (store v${STORE_VERSION})` + "\n" + nextSteps(paths),
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
  const upgrade = upgradeStore(paths);
  const upgradeLines =
    upgrade.steps.length === 0
      ? [`Store is at v${upgrade.to}; no format changes were needed.`]
      : [`Upgraded store v${upgrade.from} → v${upgrade.to}:`, ...upgrade.steps.map((s) => `  • ${s}`)];

  process.stdout.write(
    `Migrated your Tempo store from ${src} → ${paths.home}` +
      "\n" +
      upgradeLines.join("\n") +
      "\n\nThe old ~/.tempo was left untouched; delete it once you've verified the migration." +
      "\n" +
      nextSteps(paths),
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
  const out = { storeVersion: readStoreVersion(e.paths), ...e.check() };
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
