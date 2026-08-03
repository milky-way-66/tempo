# Tempo — Implementation Plan

> Status: **DRAFT.** Turns [the detailed design](../specs/2026-08-03-tempo-detailed-design.md) into
> ordered, buildable milestones. Name: **Tempo** (npm `@milkyway/tempo`, command `tempo`).
> Last updated: 2026-08-03

## Approach

- **Vertical slice first.** Get a usable end-to-end path (narrate → append → `board`) working in
  Claude Code by M4, then add breadth. Avoids a big-bang integration at the end.
- **Pure core, TDD'd.** `time`, `replay`, `resolve`, `report` are pure functions with no I/O — unit-
  and property-tested in isolation. `tools/*` are thin adapters over them; `store`/`git` are the only
  side-effecting modules.
- **Ship small.** Each milestone ends green (tests pass) and leaves the tool more useful than before.
- **No schema churn.** The 6-event schema is fixed; deferred features (estimator, ripple, sync) plug
  in later without migration.

## Dependency order

```
M0 scaffold
  └─ M1 types+store+config
       ├─ M2 time parser
       └─ M3 replay engine
            └─ M4 VERTICAL SLICE (server: start/stop/board)   ← usable in Claude Code
                 └─ M5 capture (add/note/log + fuzzy resolve)
                      ├─ M6 periods + planning
                      ├─ M7 reports (report/standup/what-if)
                      └─ M8 check (integrity)
                           └─ M9 git + `tempo init`
                                └─ M10 behavior assets (CLAUDE.md + rituals skill)
                                     └─ M11 npm distribution + docs
```

## Milestones

### M0 — Scaffold
- **Goal:** an installable, testable TS package skeleton.
- **Work:** `package.json` (ESM, `type: module`, `bin: { tempo: dist/bin.js }`, `engines.node>=20`),
  `tsconfig`, Vitest, ESLint/Prettier, `src/bin.ts` stub routing `init|check|mcp` (default `mcp`),
  dep `@modelcontextprotocol/sdk` + a date lib (e.g. Luxon).
- **Done:** `npm run build` emits `dist/`; `npx . mcp` starts and cleanly no-ops; `npm test` runs.

### M1 — Types, store, config
- **Goal:** append/read the log and load config.
- **Work:** `types.ts` (Event union + projection types); `store.ts` (`append(event)`, `readAll()` over
  `events.jsonl`, creating the dir if absent); `config.ts` (load/validate/default `~/.tempo/config.json`,
  `capacityHoursPerDay: 8`, tz, workDays).
- **Tests:** append→readAll roundtrip; malformed line surfaces an error; config defaults applied.
- **Done:** can persist and reload events; config validated.

### M2 — Time parser
- **Goal:** loose human time → absolute ISO-8601 **with offset**.
- **Work:** `time.ts`: `now`, `"-2h"`, `"90m"`, `"14:00"`, `"yesterday 14:00"`, plain dates; resolve
  against config tz; parse duration `"2h"`→minutes; range marker for `~afternoon`.
- **Tests:** offset always present; DST boundary; relative vs absolute; duration parse; reject garbage.
- **Done:** every parsed instant carries an offset; loose forms never leak unresolved.

### M3 — Replay engine
- **Goal:** events → projection with the concurrent-span model.
- **Work:** `replay.ts`: sort by `(at,logged_at,id)`, dedup by `id`; per-task spans; `grossMin`,
  `netMin` (interval union), `multitaskFactor`; statuses (todo/doing/paused/blocked/done);
  period-level interruption count (starts with `reason`).
- **Tests:** multi-span sum; **property: order-independent** (shuffled log → identical projection);
  overlapping spans counted once in `net`; open span counts to "now".
- **Done:** deterministic projection; gross/net correct under multitasking fixtures.

### M4 — Vertical slice (server: start / stop / board) ⭐
- **Goal:** a working tool you can drive from Claude Code.
- **Work:** `server.ts` (MCP over stdio, in-memory projection updated per append); tools `start`,
  `stop`, `board`. `start` creates-inline (title/imp/tags/est) and opens a span; `stop` closes with a
  verdict (`est` vs actual). No git yet — plain `~/.tempo/`.
- **Tests:** integration — drive `start→stop→board`, assert structured returns and the board columns.
- **Done:** `claude mcp add tempo -- npx . mcp`; narrate two tasks and see the board. **First dogfood.**

### M5 — Capture breadth + fuzzy resolve
- **Goal:** the full capture surface with natural task references.
- **Work:** `resolve.ts` (deterministic fuzzy match + `needsDisambiguation`); tools `add`, `note`,
  `log` (expands `--dur` → started+stopped, `source:backfill`); wire `reason` on interrupting `start`;
  `query` vs exact `task`.
- **Tests:** resolve ranking + disambiguation contract; `log` span expansion; backfill `source`/`at`.
- **Done:** can add/plan tasks, backfill meetings, and refer to tasks by phrase.

### M6 — Periods + planning
- **Goal:** the plan ritual's data.
- **Work:** `period` tool (open|close, `len` 1w/2w, optional capacity override); `add` honors
  `period`+`parent` (WBS); projection tracks period membership and parent rollups (estimate sum).
- **Tests:** period open/close; parent rollup of child estimates; leaf vs parent.
- **Done:** can open a sprint, brain-dump a WBS with estimates under it.

### M7 — Reports
- **Goal:** track + analyze.
- **Work:** `report.ts` (est-vs-actual, distribution `by` project/tag/quadrant, on-track verdict vs
  net capacity, `--adding` what-if, gross/net + multitaskFactor, week-over-week Q2/Q3); tools `report`
  (`--today|--week|--sprint`); `standup` = `report --today`.
- **Tests:** golden reports over fixture logs; verdict thresholds; what-if delta; quadrant/urgency decay.
- **Done:** daily on-track, weekly distribution, and interruption what-if all produce stable text.

### M8 — Integrity (`check`)
- **Goal:** trustworthy numbers.
- **Work:** `check` tool — schema validation, sortability, **impossible states** (stop w/o open span,
  double-start), data-quality (`backfillPct`, freshness from `at−logged_at`, `multitaskFactor`).
  Overlaps are *not* errors.
- **Tests:** each impossible-state detector; quality metrics on mixed live/backfill fixtures.
- **Done:** `check` cleanly separates real problems from normal multitasking.

### M9 — Git + `tempo init`
- **Goal:** durable, syncable store.
- **Work:** `git.ts` (init repo, write `.gitattributes` `events.jsonl merge=union`, best-effort commit
  per append with `"<type> <task> @<at>"`); `tempo init` bootstraps `~/.tempo/` (repo, config, assets).
- **Tests:** init idempotent; commit-after-append; commit failure warns but append persists; union
  merge + `id` dedup on a simulated two-branch merge.
- **Done:** every change is committed; simulated multi-machine merge replays cleanly.

### M10 — Behavior assets
- **Goal:** the agent follows the rituals.
- **Work:** `assets/CLAUDE.md` (when to `add` vs `start`; always set `imp`; `reason` on interrupt;
  prefer `log` for past/meetings; run `check` before weekly review; relay tool output); rituals skill
  `assets/skills/rituals/` (plan-sprint, daily-standup, weekly-review, interrupt); `tempo init`
  installs them.
- **Tests:** manual dogfood scripts (plan → work+interrupt → daily → weekly) produce sane sessions.
- **Done:** a fresh install guides the full plan→work→track→analyze loop.

### M11 — npm distribution + docs
- **Goal:** install anywhere.
- **Work:** finalize `package.json` (`files: [dist, assets]`, `prepublishOnly: build`), README with
  `npx @milkyway/tempo init` + `claude mcp add tempo -s user -- npx -y @milkyway/tempo mcp`;
  `npm publish --access public`; tag `v0.1.0`.
- **Done:** clean-machine install works end-to-end from npm.

## Testing strategy (per design §14)

- **Unit (pure):** time, replay, resolve, report.
- **Property:** replay order-independence.
- **Golden:** fixture logs → expected `report`/`board` text.
- **Integration:** boot the MCP server; drive plan→work→review; assert structured returns.

## Milestone summary

| M | Deliverable | Unlocks |
|---|---|---|
| M0 | Scaffold | build/test |
| M1 | types/store/config | persistence |
| M2 | time parser | correct `at` |
| M3 | replay engine | derived state |
| **M4** | **slice: start/stop/board** | **dogfood** |
| M5 | capture + resolve | full capture |
| M6 | periods + WBS | planning |
| M7 | reports | track/analyze |
| M8 | check | trust |
| M9 | git + init | durability/sync |
| M10 | behavior assets | rituals |
| M11 | npm publish | install anywhere |

## Out of scope for this plan (deferred)

Estimator/forecast, interruption-ripple diff, git-commit gap corroboration, auto-resume focus stack,
`estimate.revised`, `tempo sync`, SQLite read-cache.
