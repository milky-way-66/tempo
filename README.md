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
git add .tempo CLAUDE.md && git commit -m "tempo: init"
```

`.tempo/` is plain tracked files inside your repo — Tempo never creates its own git repo and never
commits for you; you commit and push `.tempo/` with your normal git workflow. The MCP server finds
the store by walking up from its working directory (like `git` finds `.git`), so it works from any
subfolder of the repo.

`init` also wires the rituals into memory: Claude Code only auto-loads a `CLAUDE.md` at the repo root,
so Tempo adds `@.tempo/assets/CLAUDE.md` to your root `CLAUDE.md` (creating it if absent). Because it's
an `@import`, the rituals stay in sync when Tempo updates them — no manual copy step. `tempo check`
warns if that link is ever missing.

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

`.tempo/board.md` is a live Markdown dashboard, **regenerated after every logged change** — open it in
your editor to watch it update as you narrate your work. It holds a kanban of your tasks
(To Do · Doing · Done) plus a metrics section: today/this-week time totals with multitask factor,
time distribution by project and by Eisenhower quadrant (with bars), an open-sprint plan check, and
estimate-vs-actual for finished tasks.

`.tempo/version` records the on-disk store format version. `tempo migrate` upgrades an older store to
the current version, reporting each step; `tempo check` prints the current `storeVersion`. Override
the store location with `TEMPO_HOME`.

### Store versioning & migrations

The store carries a format version in `.tempo/version` (`STORE_VERSION` in `src/core/version.ts`).
Upgrades are a chain of **single-step migrations**, one per version, kept in
[`src/core/migrations/`](src/core/migrations/). `upgradeStore` reads the store's own version and runs
every step from there up to the current version **in order**, so a user two versions behind runs both
steps sequentially. It is safe by construction:

- **Sequential & contiguous** — steps go `vN → vN+1`; a gap in the chain aborts rather than skipping a
  transform.
- **Backed up** — the pre-migration `events.jsonl`/`config.json` are copied to `.tempo/backups/…`
  before anything is rewritten.
- **Resumable** — `.tempo/version` is advanced after each successful step, so an interrupted run
  continues from the last completed version.
- **Forward-safe** — a store newer than the running Tempo refuses to migrate and tells you to update.

To add a format version: drop a `NNN-*.ts` file in `src/core/migrations/` exporting a
`defineMigration({ from, to, describe, apply })`, register it in `migrations/index.ts`, and bump
`STORE_VERSION`. See the worked example in `migrations/index.ts`.

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
