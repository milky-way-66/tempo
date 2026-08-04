import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/server";
import { Engine } from "../../src/core/engine";
import type { Paths } from "../../src/core/config";

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
      ["add", "archive", "board", "check", "edit", "log", "note", "period", "rename", "report", "start", "stop"].sort(),
    );
  });

  it("drives start → board over MCP", async () => {
    const { client } = await connect();
    const started = await client.callTool({
      name: "start",
      arguments: { title: "Write spec", important: true, tags: ["doc"] },
    });
    const startedText = (started.content as { type: string; text: string }[])[0].text;
    expect(startedText).toContain("write-spec");

    const board = await client.callTool({ name: "board", arguments: {} });
    const boardText = (board.content as { type: string; text: string }[])[0].text;
    expect(boardText).toContain("DOING");
    expect(boardText).toContain("write-spec");
  });

  it("accepts an empty parent over MCP (bug: parent id \"\") and edits reflect", async () => {
    const { client } = await connect();
    // Empty parent must not error — it means "top-level task".
    const added = await client.callTool({
      name: "add",
      arguments: { title: "Root task", important: true, parent: "" },
    });
    expect(added.isError).not.toBe(true);
    const addedText = (added.content as { type: string; text: string }[])[0].text;
    expect(addedText).toContain("root-task");

    // A multi-field edit that also passes parent:"" must apply the rename, not abort.
    const edited = await client.callTool({
      name: "edit",
      arguments: { query: "root task", title: "Root renamed", important: false, parent: "" },
    });
    expect(edited.isError).not.toBe(true);
    const editedText = (edited.content as { type: string; text: string }[])[0].text;
    expect(editedText).not.toContain("error:");

    const board = await client.callTool({ name: "board", arguments: {} });
    const boardText = (board.content as { type: string; text: string }[])[0].text;
    expect(boardText).toContain("root-task");
  });

  it("rejects invalid arguments (missing required title on add)", async () => {
    const { client } = await connect();
    let errored = false;
    try {
      const r = await client.callTool({ name: "add", arguments: { important: true } });
      errored = r.isError === true;
    } catch {
      errored = true;
    }
    expect(errored).toBe(true);
  });
});
