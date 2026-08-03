# Kaban — Design Notes

> Status: **brainstorm / draft.** Captured to discuss more later. Nothing built yet.
> Last updated: 2026-07-30

## One-line pitch

A git-backed, append-only event log that you **narrate to Claude instead of using a timer**.
Time is *derived* from event timestamps. From that one log you get a Kanban board, time
tracking, estimate-vs-actual, interruption ripple, a self-improvement dataset, and — once
history accumulates — a personal estimator that quotes honest ranges and simulates the cost
and risk of any change or reschedule before you commit.

## Why it's different

Most tools (Jira, Todoist, Toggl, sticky-note Kanban) do time-tracking and estimates fine.
Almost none show the **downstream cost of an interruption** or turn your own history into a
**predictive model of your throughput**. Those two things are the reason to build this.

The whole thing is *one coherent idea*, not a feature pile — every capability is a different
view of the same event log, and each addition reinforces the same core.

---

## Core principles

1. **No timer.** The interface is chatting with Claude. You never start/stop anything.
2. **Event-sourced.** Everything is a timestamped event appended to a log. State (time spent,
   schedule, board) is *computed* by replaying events — never edited directly.
3. **Plain text in git.** No daemon, no database. Storage is one `jsonl` file in a repo. The only
   code is a small CLI that appends to it and computes views from it.
4. **The log is written and read only through the CLI.** Claude never opens `log.jsonl` — not to
   append, not to read. It shells out to `kaban`. The append-only invariant, the schema, and every
   derived number are enforced by code, not by an LLM following instructions in `CLAUDE.md`.
5. **Event time ≠ logging time.** Every event carries the timestamp of *when the thing happened*,
   supplied at log time and often in the past. You narrate a meeting after it ends, or a day's work
   from a different machine.
6. **Derive what you can; ask for the minimum.** Time = arithmetic on timestamps. Urgency =
   function of the deadline. The only thing a human must supply is **importance** (set once) and
   consistent **tags/category**. That tagging discipline — not time tracking — is the real habit.
7. **Capture rich now, compute smart later.** Rich events are just text and cost nothing to
   record. The analytics/forecasting layers can switch on later with **no schema change**.
8. **Low overhead is a feature.** If narrating is a chore, the log gets gaps and everything
   downstream degrades. Keep the required payload tiny.

---

## The data model

Everything is a timestamped **event** appended to `log.jsonl` — one JSON object per line.
Chosen over human-readable lines because everything downstream is computation, and a parser for
ad-hoc text is a liability. Human-readability is the CLI's job, not the storage format's.

```jsonl
{"at":"2026-07-30T09:12+07:00","type":"task.created","task":"auth-bug","est":"2h","deadline":"2026-08-01","imp":"high","project":"api","tags":["bug"]}
{"at":"2026-07-30T09:13+07:00","type":"task.started","task":"auth-bug"}
{"at":"2026-07-30T10:40+07:00","type":"task.switched","from":"auth-bug","to":"prod-hotfix","reason":"urgent"}
{"at":"2026-07-30T11:25+07:00","type":"task.finished","task":"prod-hotfix"}
{"at":"2026-07-30T11:26+07:00","type":"task.resumed","task":"auth-bug"}
{"at":"2026-07-29T14:00+07:00","type":"task.started","task":"sprint-planning","logged_at":"2026-07-30T09:20+07:00","source":"backfill"}
```

From just this, `kaban` derives: auth-bug got 88min then was interrupted, hotfix took 45min,
auth-bug resumed — **no timer anywhere**. Time is just arithmetic on timestamps.

### Two timestamps, and why

| field | meaning |
|---|---|
| `at` | **when it happened.** The only timestamp any computation uses. Required. Often in the past. |
| `logged_at` | when the line was appended. Written by the CLI, never by hand. Diagnostics only. |

The last line above is the case that forces this: sprint planning happened yesterday afternoon, on
a laptop, with nothing committed to any repo. It gets narrated the next morning. Consequences:

- **Log lines are not ordered by `at`.** Every reader must sort. This is the single most likely
  source of bugs, which is another reason only the CLI touches the file.
- **`at` is written in full ISO-8601 with an offset.** Travel and DST otherwise corrupt durations
  silently, and the log outlives any assumption about a single timezone.
- The CLI accepts loose human input (`"yesterday 2pm"`, `"14:00"`, `"-2h"`) and resolves it to an
  absolute `at` before writing. Loose forms never reach the file.
- `at - logged_at` is a **freshness metric**: a log full of same-minute entries is high-confidence;
  a week backfilled on Friday is not. This feeds the confidence levels under *Data quality*.

### Event types (draft)

- `task.created` — id, title, estimate, deadline?, importance, category/tags, project
- `task.started`
- `task.switched` — from, to, **reason** (urgent / blocked / distraction / break / meeting)
- `task.paused` / `task.resumed`
- `task.blocked` — reason (distinct from paused: "can't" vs "chose not to")
- `task.finished`
- `estimate.revised` — new estimate, why
- `note` — free text tied to a task

### Fields that MUST be captured at event time (unrecoverable later)

- **`reason` on every switch** — you'll never reconstruct *why* you switched from timestamps.
- **`category`/`tags`** — so you can slice analysis ("bug" vs "feature" vs "meeting" vs "review").
  Also required for the future estimator to find reference classes.
- **`blocked` vs `paused`** distinction — completely different for analysis.
- **`at`** — a guessed timestamp is the one thing that silently poisons every derived number. If
  you genuinely don't know when something happened, the CLI should let you say so
  (`--at ~afternoon`, stored as a range) rather than invent a precise time.
- (optional) an energy/friction marker — "this felt hard" is gold, impossible to backfill.

### Off-repo work is first-class, not an afterthought

Meetings, reviews, calls, whiteboarding, and work done on another machine leave **no git trace**.
They're also exactly the Q3 firefighting the tool exists to measure, so they can't be second-class:

- They're ordinary events with an ordinary `at` — no separate concept.
- They're the main reason `at` is user-supplied: they're almost always narrated after the fact.
- `source` on an event (`live` / `backfill` / `git-corroborated`) records how it was captured, so
  data-quality reporting can distinguish "quiet day" from "day I forgot to narrate."

### The focus stack (interruptions)

Model interruptions as a **stack**: on A, urgent B interrupts → push B; finish B → pop back to A.
Naturally captures nested interruptions and lets you count context-switches.

---

## v1 — keep it dead simple

One data file and one script:

```
log.jsonl     append-only truth. ./kaban is the only reader and the only writer.
kaban         Node CLI (no deps). Appends events; computes every view and every report.
CLAUDE.md     teaches Claude which commands to run — not the file format.
```

No `board.md`. The board isn't a file to keep in sync, it's `kaban board` — a command whose output
is always correct by construction. That removes the whole class of "board drifted from the log" bugs
and answers the one-file-vs-two question by making it moot.

### Why Claude goes through the CLI

Letting an LLM append to and read the log seemed simpler, but it puts the invariants in the wrong
place:

- **Append-only is only real if it's enforced.** An `Edit` call can rewrite history; `kaban log
  <event>` structurally cannot.
- **Numbers must be reproducible.** Two runs of `kaban report` on the same log return the same
  answer. An LLM summing durations from raw lines does not — and quietly mis-sorting out-of-order
  `at` values is the exact bug that's hardest to notice.
- **Schema drift is what kills event logs.** A CLI that validates on write keeps ten months of data
  parseable. Prose rules in `CLAUDE.md` degrade.
- **The log will outgrow the context window.** `kaban report --week` stays cheap when the log is
  50k lines; pasting it in does not.
- Everything the forecasting layer needs is arithmetic and grouping. That's code's job. Claude's job
  is the part it's uniquely good at: turning "boss pulled me onto a hotfix" into the right command,
  and explaining what the output means.

### Interaction (all chat, no forms — Claude just picks the command)

| you say | Claude runs |
|---|---|
| "starting auth bug, about 2h" | `kaban start auth-bug --est 2h --imp high --tag bug` |
| "boss pulled me onto a hotfix, urgent" | `kaban switch prod-hotfix --reason urgent --est 45m` |
| "done" | `kaban done` → prints `prod-hotfix: 45m (est 45m, on target)` |
| "had a 1h sprint planning at 2pm yesterday" | `kaban log meeting sprint-planning --at "yesterday 14:00" --dur 1h` |
| "show board" | `kaban board` |
| "how'd today go" | `kaban report --today` |

The CLI prints human-readable text; Claude relays and interprets it. Claude never needs the raw log
to answer a question — if a question can't be answered by a command, that's a missing command, and
adding it is the fix.

### CLI surface (v1)

```
kaban start|switch|pause|resume|block|done|note|log     append events
kaban board                                            derived kanban view
kaban report [--today|--week]                           time, est-vs-actual, interruptions, quadrants
kaban tasks [--status ...]                              query
kaban check                                             validate the log (schema, ordering, overlaps)
```

Every append command takes `--at` (default: now). `kaban check` matters more than it looks: it's the
one thing standing between a backfill-heavy log and silently wrong analytics.

### What you get on day 1 (zero history, zero overhead)

- Quick **board view** on demand
- **Time per task**, derived from the log — no timer
- **Estimate vs actual** per task, the moment it's done
- **Interruptions captured** (the `switch … reason=urgent` lines) — you *see* your firefighting
- A one-line **EOD summary** ("5h logged, 2 interruptions, auth-bug ran 1.5× estimate")
- **Eisenhower at a glance** — importance is a tag you set; urgency read off deadlines

### The only v1 discipline

Narrate what you're doing, and tag importance + category. Everything smart is derived later.
Narrating late is fine and expected — `--at` exists for exactly that. Narrating *never* is the only
real failure mode.

---

## Two views of the same tasks

### Kanban (flow) — *what state is this in?*

`todo → doing → blocked → done`. Purely a **derived view of the log**. Rendered on demand as a
text table (or an HTML artifact later if you want it pretty). No separate state to maintain.

### Eisenhower (priority) — *which quadrant?*

Urgent×Important matrix. The two axes have different natures, and the design respects that:

- **Urgency is derivable** — a function of the deadline that *decays automatically over time*.
  A task slides from "not urgent" to "urgent" as its deadline approaches. Claude auto-places it;
  you never re-classify.
- **Importance is a human judgment** — set **once** at creation. This is the one classification
  you own.

### The payoff: measure whether you *live* in the right quadrant

Everyone's told to spend time in **Q2 (important, not urgent)** and minimize **Q3 (urgent, not
important = firefighting)**. Nobody measures it. The log can:

> "This week: 64% of tracked time went to urgent firefighting, 11% to Q2. Last week Q2 was 25%.
> You're drifting into reactive mode."

That is the most behavior-changing report the tool can produce — it measures intent vs reality.

**Interruptions are usually Q3.** So the *interruption ripple* and the *quadrant analysis* are two
views of one phenomenon. The tool can connect them: "the interruptions that cost you 6h of
reschedule this week were 80% Q3."

---

## Forward-looking layer (deferred — turns on as data accumulates)

The log becomes a **simulation model of your own throughput** that you query *before* committing
to work. None of this is built for v1; it switches on later with no schema change.

### Estimator — accurate feature estimation

Every finished task is a labeled data point (`features → actual time`). New estimates become
**reference-class forecasting**:

> "This feature looks like 6 past tasks; they took 3–9h, median 5h. So: 5h, 80% confidence under 8h."

- **Quote ranges, not points.** A distribution is honest and directly powers risk + scheduling.
- **Two loops stack:** (1) a *calibration multiplier* corrects systematic bias ("1.6× on bugs");
  (2) *reference-class* matching gives the range.
- **Cold-start:** worthless day 1, great day 90. v1 must be fully usable with zero history
  (manual estimate + tracked actuals); the predictive layer switches on quietly once there's
  enough clean, well-tagged data.

### Ripple / reschedule / cost-of-change / risk

- **Interruption ripple** (hero feature): when an urgent task lands, re-run the schedule and
  **diff** it — "auth-bug now finishes Fri 14:00 → misses Fri-noon deadline ⚠️; design review slips
  to Monday." You see the blast radius *before* accepting the interruption.
- **Cost of changing** — two flavors: *scope change* (feature grew → re-estimate remaining, re-run
  ripple) and *priority change* (this jumps the queue → the ripple diff in hours + broken deadlines).
- **Risk** = variance + dependency + tightness. Wide reference-class spread → high uncertainty;
  lots of historical `blocked/waiting` time → dependency risk; median finish near the deadline →
  schedule risk. Surface a per-task and per-plan risk score.
- **Reschedule** — given any change, re-run the schedule, show new projection + diff + which
  deadlines break + candidate mitigations (drop / defer / delegate / renegotiate the date).

### Scheduling engine ambition — decided: **later**

Start naive: pack remaining-estimates into daily capacity by priority, recompute finish dates,
diff. Simple, explainable, ~80% of the value — the *diff* is the insight. Upgrade to honor hard
deadlines / meetings / dependencies later, without changing the data.

---

## Data quality / gaps

- **Nudging — decided: passive + git corroboration.** Don't interrupt to ask "still on X?".
  Instead reconstruct gaps at EOD using your **real work-repo commit timestamps** as corroborating
  events, and confirm with you. Your actual coding commits are a free, honest event stream.
- **Git corroboration has a blind spot, and it's the interesting half.** Commits only cover coding,
  in a repo, on a machine you can reach. Meetings, reviews, and other-machine work produce a silent
  gap that looks identical to slacking off. So a gap with no commits is a **prompt to narrate**, not
  evidence of idleness — and `--at` backfill is the mechanism. Reconstruction can suggest, never
  assume.
- Mark derived time with a **confidence level** for low-signal spans (e.g. a 3h silent gap).
  Inputs: gap length, presence of corroborating commits, and `at - logged_at` lag. Backfilled spans
  are labeled as such rather than silently mixed with live-narrated time.
- Data-quality itself becomes a metric to watch, and `kaban check` is where it surfaces.

---

## Open questions (for next discussion)

1. **Task: first-class object or emergent tag?** First-class (own id/estimate/deadline/status)
   is cleaner to query; pure-emergent-from-events is simpler. Leaning first-class-lite.
2. **How does the estimator decide "similar"?** Category + size + project to start; refine later.
3. **Daily capacity** — the ripple needs a notion of available focus-hours/day. Fixed number?
   Learned from history?
4. **Naming** — is "kaban" the product name, or a placeholder?
5. **Backfill that contradicts live events** — you log a meeting at 14:00 yesterday, but a task was
   already `started` and never stopped across that window. Does `kaban` reject it, auto-split the
   span, or accept the overlap and let `kaban check` flag it? Leaning accept-and-flag: the log stays
   append-only, and a correction is a new event.
6. **Duration-shaped events.** `--dur 1h` (above) is a shortcut for a start/finish pair. Is that a
   real event type, or does the CLI expand it into two events on write? Leaning expand-on-write, so
   there's exactly one way to represent elapsed time.
7. **CLI implementation** — plain Node script, zero deps, committed to the repo? (Leaning yes;
   the timezone/relative-date parsing is the only place a dep is tempting.)

---

## Decisions locked so far

- No timer; chat-driven capture; git-backed plain text.
- **Storage is `log.jsonl`** — one JSON object per line. Not human-readable prose lines.
- **Claude never touches `log.jsonl`.** All writes and all reads go through the `kaban` CLI, which
  owns the schema, the append-only invariant, and every derived number.
- **Events carry `at` — when it happened — supplied by the user and frequently in the past.** The log
  is not chronologically ordered on disk; readers sort. `logged_at` is recorded separately for
  data-quality purposes only.
- **Off-repo work (meetings, other machines) is first-class.** No git trace ≠ no work; a silent gap
  is a prompt to narrate, never an inference of idleness.
- Importance set once by human; urgency derived from deadline; status/time derived from log.
- v1 = `log.jsonl` + `kaban` CLI + a small `CLAUDE.md`; no board file (the board is a command).
- Scheduler ambition: decide later (start naive).
- Nudging: passive + git-commit corroboration.
- Audience: me first, expand if it's good.
