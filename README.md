# Tempo

A personal, chat-driven work tracker. You **narrate your work to Claude Code**; Tempo records it as
an append-only event log and derives your board, time, estimates, and plans. No timer, no forms —
just talk. Runs as a local [MCP](https://modelcontextprotocol.io) server.

- **The store lives in your repo** — `.tempo/` inside the management repo you run it from, versioned
  right alongside your work. `project` is a field on a task, not a separate log.
- **A task is any unit of work** — coding, a meeting, an estimate, a review — categorized by tags.
- **Multitasking is first-class** — many tasks can run at once; time is reported gross (per task)
  and net (real wall-clock).
- **State is derived, not edited** — every number comes from replaying the log; the agent goes
  through typed tools, never the raw file.

## Install

Run this from inside the git repo you want to track your work in (your "management repo"):

```bash
npx @milkyway-666/tempo init                 # creates ./.tempo (config + rituals) in this repo
claude mcp add tempo -- npx -y @milkyway-666/tempo mcp
git add .tempo && git commit -m "tempo: init"
```

`.tempo/` is plain tracked files inside your repo — Tempo never creates its own git repo and never
commits for you; you commit and push `.tempo/` with your normal git workflow. The MCP server finds
the store by walking up from its working directory (like `git` finds `.git`), so it works from any
subfolder of the repo.

Then add `.tempo/assets/CLAUDE.md` to your Claude Code memory so the agent knows the rituals.

### Migrating from an older global store

Earlier versions kept a single store at `~/.tempo`. To move it into your management repo, run from
the repo root:

```bash
npx @milkyway-666/tempo migrate              # copies ~/.tempo → ./.tempo, then upgrades the format
```

It reports the store version and any format steps applied, and leaves the old `~/.tempo` untouched
so you can verify before deleting it.

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

CLI subcommands: `tempo init` · `tempo migrate` · `tempo check` · `tempo mcp`.

## Data

Everything lives in `.tempo/events.jsonl` (one JSON event per line) inside your repo. Tempo appends
to the log; **you** commit `.tempo/` whenever you commit your work. `.gitattributes` sets
`merge=union` so multiple machines merge cleanly; replay dedups by event id and sorts by time, so
order and duplicates never corrupt the numbers.

`.tempo/version` records the on-disk store format version. `tempo migrate` upgrades an older store to
the current version, reporting each step; `tempo check` prints the current `storeVersion`. Override
the store location with `TEMPO_HOME`.

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
