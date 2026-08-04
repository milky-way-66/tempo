import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Engine } from "./core/engine.js";

const reason = z.enum(["urgent", "blocked", "distraction", "break", "meeting"]);
const stopStatus = z.enum(["done", "paused", "blocked"]);
const energy = z.enum(["hard", "easy"]);
const windowKind = z.enum(["today", "week", "sprint"]);
const byDim = z.enum(["project", "tag", "quadrant"]);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(result: unknown): ToolResult {
  const r = result as { text?: string };
  const text = typeof r?.text === "string" ? r.text : JSON.stringify(result);
  return { content: [{ type: "text", text }] };
}

function run(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (e) {
    return { content: [{ type: "text", text: `error: ${(e as Error).message}` }], isError: true };
  }
}

export function buildServer(engine: Engine): McpServer {
  const server = new McpServer({ name: "tempo", version: "0.1.0" });

  server.tool(
    "add",
    "Define a task without starting it (planning / WBS). important (yes/no) is required; urgent (yes/no) defaults to false. Together they set the Eisenhower category (A both · B important · C urgent · D neither). A task is any unit of work — coding, meeting, review — categorized by tags.",
    {
      title: z.string(),
      important: z.boolean().describe("high value/impact?"),
      urgent: z.boolean().optional().describe("time-pressured? (default false)"),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
      est: z.string().optional().describe('estimate, e.g. "2h", "90m"'),
      deadline: z.string().optional().describe("YYYY-MM-DD"),
      parent: z.string().optional().describe("WBS parent task slug; omit (or pass empty) for a top-level task"),
      period: z.string().optional(),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.add(a)),
  );

  server.tool(
    "start",
    "Begin (or switch to) a task; creates it inline if new. Other active tasks keep running (multitasking). Set reason when this start is an urgent interruption.",
    {
      query: z.string().optional().describe("phrase to resolve an existing task"),
      title: z.string().optional().describe("title for a new task"),
      important: z.boolean().optional().describe("high value/impact? (required if creating)"),
      urgent: z.boolean().optional().describe("time-pressured? (default false)"),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
      est: z.string().optional(),
      deadline: z.string().optional(),
      period: z.string().optional(),
      reason: reason.optional(),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.start(a)),
  );

  server.tool(
    "stop",
    "Stop a task. status: done (default), paused (chose to stop), or blocked (can't continue). Defaults to the single active task if no query.",
    {
      query: z.string().optional(),
      status: stopStatus.optional(),
      reason: z.string().optional(),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.stop(a)),
  );

  server.tool(
    "note",
    "Attach a free-text note (and optional energy marker) to a task, defaulting to the active one.",
    {
      text: z.string(),
      query: z.string().optional(),
      energy: energy.optional(),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.note(a)),
  );

  server.tool(
    "log",
    "Record a past finished activity with a duration (meetings, untracked work). Expands to a started+stopped span.",
    {
      dur: z.string().describe('duration, e.g. "1h", "45m"'),
      at: z.string().describe("when it started, e.g. \"yesterday 14:00\""),
      title: z.string().optional(),
      query: z.string().optional(),
      important: z.boolean().optional().describe("high value/impact? (required if creating)"),
      urgent: z.boolean().optional().describe("time-pressured? (default false)"),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
    },
    async (a) => run(() => engine.log(a)),
  );

  server.tool(
    "period",
    "Open or close a planning period (week / sprint). len like \"1w\" or \"2w\".",
    {
      action: z.enum(["open", "close"]),
      name: z.string().optional(),
      start: z.string().optional(),
      len: z.string().optional(),
      capacity: z.number().optional().describe("focus-hours/day override"),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.period(a)),
  );

  server.tool(
    "board",
    "Show the kanban board (todo/doing/paused/blocked/done), optionally filtered by project.",
    { project: z.string().optional() },
    async (a) => run(() => engine.board(a.project)),
  );

  server.tool(
    "edit",
    "Edit an existing task's fields: rename its title, or change important/urgent (yes/no)/estimate/deadline/parent/project/tags. Pass only the fields that change; use clear to unset optional fields, or pass an empty string for an optional field to unset it. Re-renders the board live. For renaming a project across many tasks, use rename instead.",
    {
      query: z.string().describe("phrase to resolve the task to edit"),
      title: z.string().optional(),
      important: z.boolean().optional().describe("high value/impact?"),
      urgent: z.boolean().optional().describe("time-pressured?"),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
      est: z.string().optional().describe('estimate, e.g. "2h", "90m"'),
      deadline: z.string().optional().describe("YYYY-MM-DD"),
      parent: z.string().optional().describe("WBS parent task slug or phrase; pass empty to detach from its parent"),
      period: z.string().optional(),
      clear: z
        .array(z.enum(["project", "est", "deadline", "parent", "period"]))
        .optional()
        .describe("optional fields to unset"),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.edit(a)),
  );

  server.tool(
    "archive",
    "Archive a task you won't do (soft-remove: it's hidden from the board but kept in the log). Set restore:true to bring an archived task back. Append-only — nothing is deleted.",
    {
      query: z.string().describe("phrase to resolve the task"),
      restore: z.boolean().optional().describe("un-archive instead of archive"),
      reason: z.string().optional(),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.archive(a)),
  );

  server.tool(
    "rename",
    "Rename a project across every task that carries it (bulk fix for a mistyped project name). The live board reflects it immediately — no need to edit events.jsonl.",
    {
      project: z.string().describe("current project name"),
      to: z.string().describe("new project name"),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.rename(a)),
  );

  server.tool(
    "report",
    "Time report for a window: net vs gross hours, interruptions, distribution (by project/tag/quadrant), est-vs-actual, and on-track verdict for a sprint. Use adding for an interruption what-if.",
    {
      window: windowKind,
      by: byDim.optional(),
      adding: z.string().optional().describe("what-if: add this estimate to the sprint"),
      at: z.string().optional(),
    },
    async (a) => run(() => engine.report(a)),
  );

  server.tool(
    "check",
    "Validate the log: schema, impossible states, and data-quality metrics. Overlaps (multitasking) are not errors.",
    {},
    async () => run(() => engine.check()),
  );

  return server;
}
