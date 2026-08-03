#!/usr/bin/env node
import { existsSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "./core/engine.js";
import { buildServer } from "./server.js";
import { initRepo } from "./core/git.js";
import { resolvePaths, defaultConfig } from "./core/config.js";

function packageRoot(): string {
  // Bundled to dist/bin.js → package root is one level up (assets/ ships alongside dist/).
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function doInit(): void {
  const paths = resolvePaths();
  initRepo(paths);
  if (!existsSync(paths.configFile)) {
    writeFileSync(paths.configFile, JSON.stringify(defaultConfig(), null, 2) + "\n", "utf8");
  }
  const assetsSrc = join(packageRoot(), "assets");
  if (existsSync(assetsSrc)) {
    cpSync(assetsSrc, join(paths.home, "assets"), { recursive: true });
  }
  process.stdout.write(
    [
      `Tempo initialized at ${paths.home}`,
      "",
      "Register the MCP server with Claude Code (user scope, all repos):",
      "  claude mcp add tempo -s user -- npx -y @milkyway-666/tempo mcp",
      "",
      `Behavior + rituals were copied to ${join(paths.home, "assets")}`,
      "  • assets/CLAUDE.md — add to your Claude Code memory",
      "  • assets/skills/rituals — the plan/standup/review/interrupt flows",
      "",
    ].join("\n"),
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
} else if (cmd === "check") {
  const e = new Engine();
  process.stdout.write(JSON.stringify(e.check(), null, 2) + "\n");
} else if (cmd === "mcp") {
  startMcp().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
} else {
  process.stderr.write(`unknown command: ${cmd}\nusage: tempo [init|check|mcp]\n`);
  process.exit(1);
}
