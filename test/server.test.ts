import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server";
import { Engine } from "../src/core/engine";
import type { Paths } from "../src/core/config";

function tmpPaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-mcp-"));
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

async function connect() {
  const engine = new Engine(tmpPaths());
  const server = buildServer(engine);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client };
}

describe("MCP server", () => {
  it("exposes the tool surface", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["add", "board", "check", "log", "note", "period", "report", "start", "stop"].sort(),
    );
  });

  it("drives start → board over MCP", async () => {
    const { client } = await connect();
    const started = await client.callTool({
      name: "start",
      arguments: { title: "Write spec", imp: "high", tags: ["doc"] },
    });
    const startedText = (started.content as { type: string; text: string }[])[0].text;
    expect(startedText).toContain("write-spec");

    const board = await client.callTool({ name: "board", arguments: {} });
    const boardText = (board.content as { type: string; text: string }[])[0].text;
    expect(boardText).toContain("DOING");
    expect(boardText).toContain("write-spec");
  });

  it("rejects invalid arguments (missing required title on add)", async () => {
    const { client } = await connect();
    let errored = false;
    try {
      const r = await client.callTool({ name: "add", arguments: { imp: "high" } });
      errored = r.isError === true;
    } catch {
      errored = true;
    }
    expect(errored).toBe(true);
  });
});
