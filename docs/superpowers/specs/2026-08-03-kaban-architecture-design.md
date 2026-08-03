# Kaban — Architecture & Core Decisions

> Status: **DRAFT — brainstorming.** Locked decisions are firm; open questions at the end are still
> open. From [USER_STORIES.md](../../../USER_STORIES.md) and [USE_CASES.md](../../../USE_CASES.md).
> Last updated: 2026-08-03

## Concept

A **local, personal work-management tool you drive by chatting with Claude Code.** You narrate what
you're doing; the agent records and organizes it. It manages your **overall work as a person** — one
store for everything; `project` is just a field on a task, never a separate log. State (time, board,
plan progress) is *derived* by replaying an append-only event log. The agent never edits data — it
goes through a typed MCP server that owns the schema and every number.

## Locked decisions

| Decision | Choice |
|---|---|
| Delivery | **Claude Code native** — chat in the terminal; behavior via CLAUDE.md + skill + typed tools. No custom UI. |
| Interface | **Local MCP server, typed tools** — schema-validated args, structured returns. |
| Truth | **Append-only JSONL event log** — state derived by replay; corrections/backfill/confidence fall out for free. |
| Engine | **JSONL, not SQLite** — zero deps, human-readable, clean git diffs. Personal scale → replay is instant. |
| Storage | **One global, git-backed store** (`~/.kaban/`) — free history, backup, multi-machine sync. |
| Runtime | **TypeScript / Node** — MCP SDK is TS-first; good date libs; `npx`-runnable. |
| Behavior | **Typed tools + rituals (CLAUDE.md + skill), no hard hook** — schemas force good input; agent never sees the log path. |

## How it fits together

```
You ⇄ Claude Code ── CLAUDE.md + rituals skill guide it
          │ calls mcp__kaban__* (typed)
          ▼
   kaban MCP server (Node/TS)   ← only reader/writer of work data
     • store       append/read events.jsonl
     • replay      fold events (sorted by `at`) → in-memory projection
     • time parse  "yesterday 14:00" / "-2h" → absolute ISO-8601+offset
     • git commit  after each append (best-effort)
          ▼
   ~/.kaban/  (git repo):  events.jsonl  ·  config.json (capacity/day, tz)
```

**Write:** utterance → tool → validate → parse time → append → commit → update projection → return.
**Read:** `board`/`report` compute from the projection — reproducible: same log → same numbers.

## Event schema (6 types)

One `events.jsonl`, one JSON per line. Every event: `at` (when it happened, required, often past),
`logged_at` (server-written), `type`, `source` (`live`|`backfill`). File is **not** ordered on disk;
readers sort by `at`.

| type | fields |
|---|---|
| `task.created` | `task` (id), `project`, `imp`, `tags`, `est`, `deadline?`, `parent?`, `period?` |
| `task.started` | `task`, `reason?` (∈ urgent/distraction/meeting… — set only when it interrupts) |
| `task.stopped` | `task`, `status` (done\|paused\|blocked), `reason?` |
| `note` | `task?`, `text`, `energy?` |
| `period.opened` | `period`, `start`, `end` |
| `period.closed` | `period` |

Derived, never stored: time spent (sum of started→stopped spans), board column, interruption count
(starts-while-another-active), plan burndown, quadrant. `estimate.revised` and a focus *stack* with
auto-resume are **deferred** — nesting is still recoverable from timestamps.

## Tool surface (~10)

- **Capture:** `add` (define a task, unstarted — planning/WBS) · `start` (begin/switch; creates
  inline for quick capture; `reason` when interrupting) · `stop` (`status` = done|paused|blocked) ·
  `note` · `log` (a past finished activity with `--dur`; backfill/meetings → expands to a
  started+stopped pair)
- **Plan:** `period` (open|close) — task definition reuses `add`
- **Views:** `board` · `report` (`--today|--week|--sprint`; on-track verdict + project/tag/quadrant
  distribution; `--adding <est>` for the interruption what-if) · `check` (schema, sort, overlaps)

## Integrity & errors

- Invalid args → typed error → Claude re-asks.
- Backfill contradicting a live event → **accept-and-flag** (append; `check` surfaces it —
  corrections are new events, never edits).
- Ambiguous time → stored as a range, not an invented instant.
- Git commit fails → append already succeeded; warn.

## v1 scope

The plan→work→track→analyze loop, and nothing else: the 6 events, the ~10 tools above, CLAUDE.md +
rituals skill, git-backed `~/.kaban/`. **Deferred (no schema change):** estimator/forecast,
ripple-diff, git-commit gap corroboration, auto-resume stack, `estimate.revised`, any SQLite cache.

## Open questions (brainstorming)

1. **Task identity** — *leaning:* human slug ids (`auth-bug`) + fuzzy resolution; server disambiguates
   ("`auth-bug` or `auth-refactor`?"). Readable log; natural for chat.
2. **WBS link** — `parent` field on `task.created` (leaning) vs a separate link event.
3. **Time attribution** — precise rule: a task accrues time from `started` to its next `stopped`;
   define gap/overlap handling.
4. **Multi-machine git merge** — append-only union-merge driver vs pull-before-write convention.
5. **Capacity** — fixed user-set focus-hours/day for v1 (learned later).
6. **Naming** — "kaban" real or placeholder?
