# Kaban — Detailed Design

> Status: **DRAFT.** Builds on [the architecture spec](2026-08-03-kaban-architecture-design.md).
> Resolves the open questions and specifies schema, projection, algorithms, every tool, git,
> config, distribution (npm), and the behavior layer.
> Last updated: 2026-08-03

## Resolved decisions

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Task identity | **Human slug id + fuzzy resolution** | Readable log/diffs; natural for chat; server disambiguates when unsure. |
| 2 | WBS link | **`parent` field on `task.created`** | Simplest; re-parenting is a rare correction, handled by a later `task.created`-style amend if ever needed. |
| 3 | Time attribution | **Span model: `started`→next `stopped`** | Deterministic, order-independent after sort; overlaps only from backfill → flagged by `check`. |
| 4 | Multi-machine merge | **`events.jsonl merge=union` + dedup by event `id`** | Append-only unions cleanly; replay dedups and sorts, so order/dupes never corrupt numbers. |
| 5 | Capacity | **Fixed `capacityHoursPerDay` in config** (learned later) | Enough for `report`/what-if; no cold-start dependency. |
| 6 | Name | **"kaban" = working codename** | Revisit before publish; package name TBD (e.g. `@you/kaban`). |

---

## 1. Package & source layout

Published as an npm package; the MCP server runs via `npx`.

```
kaban/
  package.json          bin: { "kaban": "dist/bin.js" }, exports the server
  tsconfig.json
  src/
    bin.ts              CLI: `kaban init` | `kaban check` | `kaban mcp` (default: mcp)
    server.ts           MCP server over stdio (@modelcontextprotocol/sdk)
    types.ts            event + projection types
    core/
      store.ts          append/read events.jsonl (only file toucher)
      replay.ts         events -> projection (pure)
      time.ts           loose-time -> absolute ISO-8601+offset
      resolve.ts        fuzzy task resolution (pure)
      report.ts         metrics/distribution/verdict (pure)
      git.ts            init, commit, .gitattributes
      config.ts         load/validate config.json
    tools/*.ts          one handler per MCP tool
  assets/
    CLAUDE.md           behavior guidance (installed by `kaban init`)
    skills/rituals/     ritual flows (installed by `kaban init`)
    gitattributes       shipped -> ~/.kaban/.gitattributes
  test/                 fixtures + golden report tests
```

`core/*` is pure and unit-tested in isolation; `tools/*` are thin adapters over `core`.

## 2. Data store layout (`~/.kaban/`)

```
~/.kaban/               its own git repo (created by `kaban init`)
  events.jsonl          append-only source of truth
  config.json           { timezone, capacityHoursPerDay, workDays }
  .gitattributes        events.jsonl merge=union
```

## 3. Event model

Common envelope + a discriminated union. `id` is `crypto.randomUUID()` (zero-dep) and doubles as the
git-merge dedup key. Durations stored as **minutes (number)**; dates as `YYYY-MM-DD`; instants as
ISO-8601 with offset.

```ts
type Importance = "high" | "med" | "low";
type Reason     = "urgent" | "blocked" | "distraction" | "break" | "meeting";
type StopStatus = "done" | "paused" | "blocked";
type Source     = "live" | "backfill";

interface Base {
  id: string;         // uuid — identity + dedup on merge
  at: string;         // when it happened (required, often past)
  logged_at: string;  // when appended (server-written)
  source: Source;
}

type Event =
  | Base & { type: "task.created"; task: string; title: string; imp: Importance;
             project?: string; tags?: string[]; estMin?: number;
             deadline?: string; parent?: string; period?: string }
  | Base & { type: "task.started"; task: string; reason?: Reason }   // reason only when interrupting
  | Base & { type: "task.stopped"; task: string; status: StopStatus; reason?: string }
  | Base & { type: "note";         task?: string; text: string; energy?: "hard" | "easy" }
  | Base & { type: "period.opened"; period: string; start: string; end: string }
  | Base & { type: "period.closed"; period: string };
```

**Slug rules:** `title` → kebab, lowercased, non-alnum→`-`, collapsed; collision → append `-2`,`-3`.
Slug is stable once minted (renames change `title`, never `task`).

**Example log:**
```jsonl
{"id":"a1","type":"task.created","task":"auth-bug","title":"Auth bug","imp":"high","project":"api","tags":["bug"],"estMin":120,"at":"2026-08-03T09:12+07:00","logged_at":"2026-08-03T09:12+07:00","source":"live"}
{"id":"a2","type":"task.started","task":"auth-bug","at":"2026-08-03T09:13+07:00","logged_at":"2026-08-03T09:13+07:00","source":"live"}
{"id":"a3","type":"task.started","task":"prod-hotfix","reason":"urgent","at":"2026-08-03T10:40+07:00","logged_at":"2026-08-03T10:40+07:00","source":"live"}
{"id":"a4","type":"task.stopped","task":"prod-hotfix","status":"done","at":"2026-08-03T11:25+07:00","logged_at":"2026-08-03T11:25+07:00","source":"live"}
```

## 4. Projection model

Rebuilt on server start; updated incrementally on each append.

```ts
interface Span { start: string; end?: string }       // end open ⇒ currently active
interface Task {
  id: string; title: string; imp: Importance;
  project?: string; tags: string[]; estMin?: number; deadline?: string;
  parent?: string; period?: string;
  spans: Span[]; actualMin: number; interruptions: number;
  status: "todo" | "doing" | "paused" | "blocked" | "done";
}
interface Period { id: string; start: string; end: string; open: boolean }
interface Projection { tasks: Map<string,Task>; periods: Map<string,Period>; active: string | null }
```

## 5. Time-attribution algorithm (the load-bearing one)

```
sort events by (at, logged_at, id)          // total order; merge dupes removed by id
active = null
for e in events:
  task.created  -> create Task (status=todo)
  task.started(T):
     if active && active != T:
        closeOpenSpan(active, e.at); tasks[active].status = "paused"
        if e.reason: tasks[active].interruptions += 1     // A was interrupted
     openSpan(T, e.at); tasks[T].status = "doing"; active = T
  task.stopped(T, status):
     closeOpenSpan(T, e.at)
     tasks[T].status = (status=="done") ? "done" : status   // paused | blocked
     if active == T: active = null
  note / period.* -> update side state
actualMin(T) = Σ (span.end - span.start) over closed spans   // open span counts to "now" in live views
```

- **Order-independent:** sorting first makes replay deterministic regardless of on-disk order or
  backfill — satisfies reproducibility.
- **No live overlaps:** starting a task auto-closes the previous span. Overlaps arise only from
  backfill (e.g. a meeting logged inside an unclosed span) → **detected by `check`, accepted as-is**
  (correction = new event).
- **Board column** = task.status; `todo` = created, never started.

## 6. Fuzzy task resolution (`core/resolve.ts`)

Input: a phrase ("the auth bug"). Deterministic (no randomness).

```
candidates = tasks where status != done, ordered by recency (active, paused, blocked, todo)
             + recently-done tasks (for notes/reopen)
score(task) = weighted( slug/title token overlap, normalized substring, tag hits )
if top score strong and clear leader  -> resolve to it
if several within a small margin      -> return { needsDisambiguation: [{id,title}, …] }
if none                               -> start: signal "create new"; stop/note: error "no match"
```

Tools that target a task accept either an exact `task` slug (skips fuzzy) or a `query` phrase.
On `needsDisambiguation`, the tool returns the candidate list and Claude asks you to pick.

## 7. Tool catalog (~10)

All tools validate with a JSON schema (zod); all accept optional `at` (loose time, default now) and
return structured JSON. `verdict` strings are computed, never model-authored.

**Capture**

| Tool | Key params | Behavior / returns |
|---|---|---|
| `add` | `title`*, `imp`*, `project?`, `tags?`, `est?`, `deadline?`, `parent?`, `period?` | Define a task, unstarted (planning/WBS). → `{task}` |
| `start` | `query?`\|`title?`, plus create fields, `reason?`, `at?` | Resolve; create-if-new; if another active, interrupt it. → `{task, interrupted?}` or `{needsDisambiguation}` |
| `stop` | `query?` (default active), `status?`=done, `reason?`, `at?` | Close active span. → `{task, actual:"1h50m", est?:"2h", verdict}` |
| `note` | `text`*, `query?` (default active), `energy?`, `at?` | Attach note. → `{ok}` |
| `log` | `title?`\|`query?`, `dur`*, `at`*, create fields | Past finished activity → expands to started+stopped. → `{task, logged}` |

**Plan**

| Tool | Key params | Returns |
|---|---|---|
| `period` | `action`=open\|close, `name?`, `start?`, `len?`=1w\|2w | Period info; open sets the deadline horizon. |

Task creation during planning reuses `add` (with `period`, `parent`, `est`).

**Views**

| Tool | Key params | Returns |
|---|---|---|
| `board` | `project?` | Columns todo/doing/paused/blocked/done. |
| `report` | `window`=today\|week\|sprint, `by?`=project\|tag\|quadrant, `adding?`=est | Totals, est-vs-actual, interruptions, distribution %, **on-track verdict**; `adding` runs the interruption what-if. |
| `check` | — | `{issues:[…], quality:{backfillPct, freshness}}` — schema, sort, overlaps. |

## 8. Reports detail

- **on-track verdict** (window has an open period): `remaining = Σ estMin of unfinished period leaves`;
  `capacity = capacityHoursPerDay*60 * workdays_left`; verdict `on track` if `remaining ≤ capacity`
  else `~Xh behind → deadline at risk`, naming the pressure source (interruptions vs over-estimate).
- **what-if (`adding`)**: recompute verdict with `remaining + est`; list leaves that no longer fit.
- **distribution (`by`)**: time split by project / tag / **quadrant**; quadrant = importance (set) ×
  urgency (derived). Week-over-week delta for Q2 vs Q3.
- **urgency (derived):** function of `deadline − now`, decaying toward "urgent" as it nears; tasks
  auto-place, never re-classified.
- **est-vs-actual verdict:** `on target` within ±10%, else `N×` (e.g. `1.5× estimate`).

## 9. Config (`~/.kaban/config.json`)

```json
{ "timezone": "Asia/Ho_Chi_Minh", "capacityHoursPerDay": 5, "workDays": ["mon","tue","wed","thu","fri"] }
```
`timezone` fills the offset when loose time lacks one; `capacityHoursPerDay` drives plan math.

## 10. Git integration

- **`kaban init`**: create `~/.kaban/`, `git init`, write `config.json` + `.gitattributes`
  (`events.jsonl merge=union`), initial commit.
- **On append**: `git add -A && git commit -m "<type> <task> @<at>"` — best-effort; failure warns but
  the append already persisted.
- **Multi-machine**: user pulls/pushes (a `kaban sync` helper can come later). `merge=union`
  concatenates both sides' appends; replay **dedups by `id`** and **sorts by `at`**, so concurrent
  edits never corrupt numbers. Worst case is a duplicate line, which dedup removes.

## 11. Behavior layer

- **CLAUDE.md** (installed to the project/user by `kaban init`): when to `add` vs `start`; always set
  `imp` at creation and `reason` on an interrupting `start`; prefer `log` for past/meetings with
  `at`; run `check` before the weekly review; relay tool output rather than reasoning over raw data.
- **Rituals skill** (`assets/skills/rituals/`):
  - *plan-sprint*: `period open` → brain-dump `add`s (est+imp+parent) → `report --sprint` capacity check.
  - *daily-standup*: `report --today` (board + on-track).
  - *weekly-review*: `check` → `report --week --by project|tag|quadrant`.
  - *interrupt*: `report --sprint --adding <est>` → `start --reason urgent`.
- No hard hook in v1; the agent never receives the log path.

## 12. Distribution (npm — install anywhere)

- **package.json**: `"bin": { "kaban": "dist/bin.js" }`, `"files": ["dist","assets"]`, ESM,
  `engines.node >= 20`, dep `@modelcontextprotocol/sdk` + a small date lib; `prepublishOnly: tsc`.
- **Build & publish**: `npm run build` (tsc → `dist/`) → `npm publish --access public` (scoped
  `@you/kaban`).
- **Install anywhere**:
  ```bash
  npx @you/kaban init            # creates ~/.kaban, installs CLAUDE.md + rituals skill
  ```
  Register the MCP server with Claude Code (user scope, works in every repo):
  ```bash
  claude mcp add kaban -s user -- npx -y @you/kaban mcp
  ```
  or `.mcp.json`:
  ```json
  { "mcpServers": { "kaban": { "command": "npx", "args": ["-y", "@you/kaban", "mcp"] } } }
  ```
- `bin.ts` subcommands: `init`, `check`, `mcp` (default). The server reads `~/.kaban/`, so it's
  machine-global regardless of which project you're chatting from.

## 13. Server lifecycle

Start → load config → full replay of `events.jsonl` into the projection (empty if none) → serve
tools over stdio. Each mutating tool: validate → parse time → `store.append` → `git.commit`
(best-effort) → update projection → return. A corrupt/unparseable line makes the server refuse to
serve numbers and point at `check` (never silently wrong).

## 14. Testing

- **Unit (pure core):** `time` (loose→absolute, DST/offset), `resolve` (disambiguation), `replay`
  (span math), `report` (verdicts/distribution).
- **Property:** replay is order-independent — shuffling the log yields identical projection.
- **Golden:** fixture logs → expected `report`/`board` text.
- **Integration:** spin the MCP server, drive a plan→work→review sequence, assert structured returns.

## 15. Deferred (unchanged, no schema change)

Estimator/forecast, ripple-diff, git-commit gap corroboration, auto-resume focus stack,
`estimate.revised`, `kaban sync`, SQLite read-cache.
