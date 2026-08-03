# Tempo

A personal, chat-driven work tracker. You **narrate your work to Claude Code**; Tempo records it as
an append-only event log and derives your board, time, estimates, and plans. No timer, no forms —
just talk. Runs as a local [MCP](https://modelcontextprotocol.io) server.

- **One store for all your work** — `~/.tempo/` (git-backed). `project` is a field on a task, not a
  separate log.
- **A task is any unit of work** — coding, a meeting, an estimate, a review — categorized by tags.
- **Multitasking is first-class** — many tasks can run at once; time is reported gross (per task)
  and net (real wall-clock).
- **State is derived, not edited** — every number comes from replaying the log; the agent goes
  through typed tools, never the raw file.

## Install

```bash
npx @milkyway-666/tempo init                 # creates ~/.tempo (git repo + config + rituals)
claude mcp add tempo -s user -- npx -y @milkyway-666/tempo mcp
```

Then add `~/.tempo/assets/CLAUDE.md` to your Claude Code memory so the agent knows the rituals.

## Talk to it

| You say | What happens |
|---|---|
| "starting the auth bug, ~2h, important" | creates + starts `auth-bug` (est 2h, imp high, tag bug) |
| "boss pulled me onto a hotfix, urgent" | pauses the current task, starts `hotfix` as an interruption |
| "also picking up the docs" | starts `docs` alongside — multitasking |
| "done" | closes the task with an est-vs-actual verdict |
| "had a 1h standup at 9" | backfills a finished 1h meeting span |
| "plan a 2-week sprint from Monday" | opens a period; add tasks with estimates under it |
| "how's the sprint?" | on-track verdict: remaining estimate vs capacity |
| "what if I take a 3h urgent task?" | interruption what-if on the sprint |
| "show my board" / "how was this week?" | board / weekly time distribution by project·tag·quadrant |

## Tools

`add` · `start` · `stop` · `note` · `log` · `period` · `board` · `report` · `check`

## Data

Everything lives in `~/.tempo/events.jsonl` (one JSON event per line), committed to git after each
change. `.gitattributes` sets `merge=union` so multiple machines merge cleanly; replay dedups by
event id and sorts by time, so order and duplicates never corrupt the numbers. Override the location
with `TEMPO_HOME`.

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsup → dist/bin.js
npm run typecheck
```

Design docs live in [`docs/superpowers/`](docs/superpowers/) (specs + implementation plan).

## License

MIT
