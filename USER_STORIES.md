# Kaban — User Stories

> Status: **draft — the starting point.** This document is now the anchor for the app: use cases
> and design will be derived from these stories. Written to pin down *what the tool must let a person
> do* before any code exists. Ordering follows the user's own workflow: plan the period, then
> capture the work, then read back what happened; the forward-looking layer comes last.
> Last updated: 2026-08-03

## What the app is (one paragraph)

A git-backed, event-sourced time/task tracker you **narrate to Claude instead of using a timer.**
Everything is a timestamped event appended to one `log.jsonl`; state (time spent, board, plan
progress) is *computed* by replaying events, never edited directly. Claude never reads or writes the
log itself — it shells out to a small `kaban` CLI that owns the schema, the append-only invariant,
and every derived number. From that one log you get planning, a Kanban board, time tracking,
estimate-vs-actual, interruption impact, and — later, as history accumulates — a personal estimator
and reschedule/ripple engine.

## Primary workflow (the lived cadence)

The stories exist to serve one continuous loop:

1. **Plan** the week / 2-week sprint and break it into a WBS with estimates. → *P1–P4*
2. **Work** through it, narrating as I go — and absorb **new urgent work** that lands mid-week,
   checking its impact before I commit. → *A1–A6, P7*
3. **Keep track of the overall** at any moment — what I'm doing, what's blocking, what remains — so I
   know if I'm on track for the deadline. → *C0, B1, P5*
4. **Analyze** the work from the data — time distribution, effectiveness, estimate accuracy — to
   improve the next cycle. → *C1–C5, later Epic E*

Everything below is a detailed telling of these four beats. If a story doesn't serve one of them,
question whether it belongs.

## How to read this

Stories are grouped by capability, not by screen (there are no screens — the interface is chat).
Each story is `As … I want … so that …`, and the load-bearing ones carry **acceptance criteria**
phrased against observable CLI behavior, since the CLI — not the LLM — owns every invariant.

**Personas.**
- **Planner** — the person at the start of a week or 2-week sprint, deciding what to take on and
  breaking it down. Same human as the Narrator, different mindset: forward-looking, batch, not live.
- **Narrator** — the primary live user. A solo developer narrating their day to Claude. Owns
  nothing but the story of what they're doing.
- **Analyst** — the *same person* on Friday afternoon, asking the log what happened. Split out
  because the mindset (and the failure modes) differ from live capture.
- **Future-me** — the same person weeks later, when enough clean history exists to forecast. Every
  Future-me story is **deferred**: it must add zero burden to the Narrator today.

A cross-cutting non-negotiable, true of every story below: **Claude never reads or writes
`log.jsonl` directly — it shells out to `kaban`.** Where that constraint is testable, it appears in
the criteria.

---

## Epic P — Plan the period (start-of-week / sprint ritual)

> The user's own first story: *"At the start of each week — or each 2-week sprint — I plan what needs
> doing in this period, estimate the items, break them into a WBS, and commit to finishing them
> within the window."* This is a **batch, forward-looking** ritual, distinct from live capture.

### P1 — Open a planning horizon (week or sprint)
**As a** Planner, **I want** to declare the period I'm planning for — a week, or a 2-week sprint —
**so that** everything I commit to has a shared deadline horizon to be measured against.

**Acceptance**
- A period is created with a start and end (e.g. `kaban plan open --sprint --from mon --len 2w`),
  recorded as an event, not a hand-edited file.
- The period's end date becomes the default deadline horizon for tasks planned into it (urgency in
  B2 decays toward it).
- Multiple periods can exist historically; exactly one is "current" for reporting.

### P2 — Brain-dump the work, then break it down (WBS)
**As a** Planner, **I want** to list what needs doing this period and split big items into a
work-breakdown of smaller tasks, **so that** each leaf is small enough to estimate honestly.

**Acceptance**
- Tasks can be created in bulk during planning (`task.created` events), each with importance and
  tags set at creation — the one human-owned classification.
- A task can carry a parent/child relationship so a top-level item decomposes into leaves; the WBS
  is a **derived view** of those relationships, not a stored tree file.
- Leaves are what get estimated and tracked; parents roll up their children's estimates and actuals.
- Planning activity is itself narratable as work (the meta-case: "1h sprint planning") so the ritual
  shows up in the log like anything else.

### P3 — Estimate each item at plan time
**As a** Planner, **I want** to attach an estimate to every leaf as I break it down, **so that** I
have a baseline the tool can later score my actuals against.

**Acceptance**
- Each leaf gets an `est` at creation; parents show the summed estimate.
- Estimates are the plan-time baseline for est-vs-actual (Epic C) and, later, the labeled data the
  estimator learns from (Epic E).
- If the deferred estimator (E1) is active, it may *suggest* a range, but the human still owns the
  committed number in v1.

### P4 — Commit the plan against capacity, see if it fits
**As a** Planner, **I want** to see whether my committed estimates fit the focus-hours available in
the period, **so that** I commit to a realistic amount instead of overloading the sprint.

**Acceptance**
- The tool sums committed leaf estimates and compares them to the period's available focus-hours.
- It flags over-commitment (e.g. `committed 68h vs ~50h capacity → 18h over`) rather than silently
  accepting an impossible plan.
- Capacity source is an open question (fixed number vs learned from history — see Open Questions);
  v1 may start with a fixed, user-set focus-hours/day.

### P5 — Track the plan burning down through the period
**As an** Analyst, **I want** a mid-period view of what's done, in progress, and untouched against
the plan, **so that** I know whether the sprint is on track before it ends.

**Acceptance**
- `kaban plan status` (or `report --sprint`) shows planned vs completed leaves and estimate burned
  vs remaining, derived entirely from events.
- Interruptions and unplanned work that landed in the period are visible as *scope added* against the
  original commitment (this connects the plan to the interruption-ripple story, E2).

### P6 — Close the period and learn from it
**As an** Analyst, **I want** an end-of-period retro number, **so that** each sprint sharpens the
next plan.

**Acceptance**
- Closing a period reports planned-vs-actual completion, aggregate est-vs-actual bias, and how much
  of the period went to unplanned/interrupt work.
- These become the reference points the forward-looking layer (E1/E4) later builds on — no schema
  change required.

### P7 — Interruption hits: quick-check the impact, decide whether to replan
**As a** Planner (mid-week, under pressure), **I want** a fast read on what a new urgent task does to
my committed plan — before or right as I accept it — **so that** I can tell whether I can absorb it
or whether I need to replan / reschedule / renegotiate.

> The user's third story: *"During the work week the boss asks me to do some urgent work; I need a
> quick check on how it affects the plan and whether I need to replan or reschedule."* This is the
> **live decision-support** moment. It reuses the interruption capture (A2) and answers the question
> A2 leaves open: *so what?*

**Acceptance (v1 — naive, buildable without the scheduler)**
- Given a new task with an estimate, the tool compares `remaining committed estimate + new estimate`
  against `remaining capacity in the period` and states a plain verdict — e.g.
  `+3h urgent → sprint now 6h over capacity; 2 planned leaves won't fit`.
- It lists, concretely, which planned leaves are now at risk of slipping (by priority order), so the
  "what gives" conversation has specifics.
- Accepting the interruption is a normal `task.switched` event (A2, `reason=urgent`) — the check
  itself writes nothing; it is a read over the log plus the proposed new task.
- If declined, nothing is logged — the quick-check must be cheap enough to run *before* committing.

**Acceptance (deferred — full ripple, when history + scheduler exist)**
- Upgrades to the E2 interruption-ripple diff (re-run schedule, show which *dates* move and which
  deadlines break) and E3 cost-of-change, using the estimator's ranges instead of a single number.
- Surfaces E5 mitigations: drop / defer / delegate / renegotiate the date.
- No schema change between the naive and full versions — same events, richer computation.

---

## Epic A — Capture (near-zero overhead; the daily habit)

### A1 — Start work by narrating it
**As a** Narrator, **I want** to say "starting the auth bug, about 2h, it's important" and have it
recorded, **so that** I never touch a timer or a form.

**Acceptance**
- Claude maps the utterance to `kaban start auth-bug --est 2h --imp high --tag bug` and runs it.
- A `task.created` (if new) and `task.started` event are appended with `at` defaulting to now and a
  CLI-written `logged_at`.
- If the task was planned in P2, `start` attaches to the existing task rather than creating a
  duplicate.
- The utterance never causes Claude to open or edit `log.jsonl`.

### A2 — Switch tasks and record *why*
**As a** Narrator, **I want** "boss pulled me onto a hotfix, urgent" to both switch my active task
and capture the reason, **so that** my firefighting is visible later instead of lost.

**Acceptance**
- Produces a `task.switched` event with `from`, `to`, and a **required** `reason` from the
  controlled set (urgent / blocked / distraction / break / meeting).
- The interrupted task is pushed onto the focus stack, not discarded (see A6).
- `reason` is mandatory at capture time — it is explicitly called out as unrecoverable later.

### A3 — Finish and see the verdict immediately
**As a** Narrator, **I want** "done" to close the current task and instantly tell me estimate vs
actual, **so that** I get a feedback signal at the moment it's cheapest to reflect on.

**Acceptance**
- Appends `task.finished`; prints one line like `prod-hotfix: 45m (est 45m, on target)`.
- Actual time is computed from event timestamps only — no stored duration.
- Over/under is expressed against the original estimate (e.g. `1.5× estimate`).

### A4 — Pause vs block are different things
**As a** Narrator, **I want** to distinguish "I stopped working on this" from "I *can't* work on
this," **so that** waiting-on-others time is analyzable separately from choosing to stop.

**Acceptance**
- `pause`/`resume` and `block` are distinct events; `block` carries a reason.
- Reports can later isolate blocked/waiting time (needed for dependency-risk analysis).

### A5 — Backfill work that already happened
**As a** Narrator, **I want** to say "had a 1h sprint planning at 2pm yesterday" and have it land at
the right time, **so that** meetings and other-machine work are first-class, not lost.

**Acceptance**
- Accepts loose time input (`"yesterday 14:00"`, `"-2h"`, `"14:00"`) and resolves it to an absolute
  ISO-8601 `at` with offset **before** writing; loose forms never reach the file.
- `at` reflects when it happened; `logged_at` reflects now; `source` is `backfill`.
- A duration shortcut (`--dur 1h`) is expanded on write into a start/finish pair, so there is
  exactly one representation of elapsed time.
- Backfilled events sort into place even though the file is not chronologically ordered on disk.

### A6 — Nested interruptions just work
**As a** Narrator, **I want** an interruption on top of an interruption to resolve back correctly,
**so that** I can count context-switches without bookkeeping.

**Acceptance**
- Interruptions model as a stack: finishing B pops back to A automatically.
- The number of context-switches in a period is derivable from the events.

### A7 — Record "this felt hard" in the moment
**As a** Narrator, **I want** to attach an energy/friction marker or a free note to a task, **so
that** signal that's impossible to reconstruct later is captured now.

**Acceptance**
- A `note` event ties free text to a task; an optional energy/friction marker is capturable at event
  time.
- Never required — capture stays low-overhead.

---

## Epic B — Views (always correct by construction, computed on demand)

### B1 — Kanban board on demand
**As a** Narrator, **I want** `show board` to render `todo → doing → blocked → done` from the log,
**so that** there is no board file to drift out of sync.

**Acceptance**
- `kaban board` output is a pure function of the current log; no separate state is stored or edited.
- A task's column is derived from its latest relevant event.
- Planned-but-not-started tasks (from Epic P) appear in `todo`.

### B2 — Eisenhower quadrants with auto-decaying urgency
**As a** Narrator, **I want** tasks placed in the urgent×important matrix without me re-classifying
them, **so that** priority reflects reality as deadlines approach.

**Acceptance**
- Importance is read from the once-set human value; urgency is computed from the deadline (the
  period horizon from P1 by default) and **decays automatically** over time.
- No user action re-classifies a task after creation.

---

## Epic C — Reports (the behavior-changing payoff)

### C0 — Daily check-in: am I on track for the deadline?
**As an** Analyst, **I want** a single daily view showing how the work is progressing — what's in
flight, what's done, what's left, and whether I'm ahead or behind — **so that** I catch slippage
early enough to change course and still hit the deadline.

> The user's second story: *"Every day I check the board and see how work is progressing — the
> current work and what's left — so I can tell if I'm late or need to change something to keep the
> deadline."* This is the **daily** companion to the per-sprint burndown (P5): a fast, one-glance
> "on track?" answer, composed from views + plan + a deadline projection.

**Acceptance**
- One command (`kaban standup` / `kaban day`) shows, from the log alone: current task(s) in flight,
  completed today/this period, and remaining planned leaves with their estimates.
- It projects remaining estimate against remaining capacity in the period and states a verdict —
  e.g. `on track` / `~4h behind → deadline at risk` — rather than leaving the arithmetic to the
  human.
- When behind, it names the pressure source (scope added by interruptions vs estimates running
  over) so the "what to change" decision has evidence (drop / defer / renegotiate — see E5).
- Every number is derived and reproducible; two runs on the same log agree.
- Composes B1 (board), P5 (burndown), and B2 (urgency/deadline) — it is a lens over them, not new
  stored state.

### C1 — End-of-day summary
**As an** Analyst, **I want** a one-line EOD summary, **so that** I close the day with a signal
without reading raw data.

**Acceptance**
- `kaban report --today` prints e.g. `5h logged, 2 interruptions, auth-bug ran 1.5× estimate`.
- Every number is reproducible: two runs on the same log return identical output.

### C2 — Estimate vs actual over a period
**As an** Analyst, **I want** est-vs-actual across a day, week, or sprint, **so that** I can see my
systematic bias forming.

**Acceptance**
- `kaban report [--today|--week|--sprint]` reports per-task and aggregate est-vs-actual.
- Out-of-order `at` values are sorted before any duration is computed.

### C3 — See my firefighting
**As an** Analyst, **I want** interruptions surfaced as first-class report content, **so that** the
cost of being pulled around is visible instead of felt.

**Acceptance**
- Interruptions (the `switch … reason=urgent` lines) are counted and attributable.
- Reports can connect interruptions to the quadrant they landed in and to the plan they disrupted.

### C4 — Am I living in the right quadrant?
**As an** Analyst, **I want** the split of tracked time across quadrants, week over week, **so
that** I can tell whether I'm drifting into reactive mode.

**Acceptance**
- Report states e.g. `64% urgent firefighting, 11% Q2; last week Q2 was 25%`.
- Q2 (important/not-urgent) and Q3 (urgent/not-important) are called out by name — this is the
  intent-vs-reality measure the tool exists to produce.

### C5 — Weekly review: where did my time actually go?
**As an** Analyst, **I want** to sit down at the end of the week and see how my time was
*distributed* — across projects, tags/categories, and value (high-value vs low-value / firefighting)
— **so that** I can judge whether the week was effective or whether too much went to low-value work,
and adjust next week.

> The user's fourth story: *"After each week I want to sit down, look at what I did, analyze it, and
> see how my work was laid out — was it effective, or did I spend too much time on low-value work? I
> want to see how my work time was distributed."* This is **reflection**, not live status: the
> behavior-changing report the whole tool exists to produce.

**Acceptance**
- `kaban report --week` shows total tracked time broken down by at least: **project**, **tag/
  category** (bug / feature / meeting / review / …), and **Eisenhower quadrant** — each as hours and
  as a percentage of the week.
- It surfaces the **value verdict** explicitly: how much time went to Q2 (important/not-urgent,
  high-value) vs Q3 (urgent/not-important, firefighting/low-value), and how that compares to the
  prior week (e.g. `Q2 11% vs 25% last week → drifting reactive`).
- It highlights time concentrations worth questioning — e.g. the single tag or task that consumed
  the most time, and time spent on tasks that ran well over estimate.
- Distribution is computed only from events (sorted by `at`), and is reproducible run-to-run.
- Presentation is text by default; a richer visual (chart / HTML artifact) is an optional later
  add-on, not required for the story.

---

## Epic D — Trust the log (data quality)

### D1 — Validate the log
**As an** Analyst, **I want** `kaban check` to catch schema violations, ordering problems, and
overlapping spans, **so that** I can trust every derived number.

**Acceptance**
- `kaban check` validates schema, sort-ability, and span overlaps, and reports data-quality state.
- It is the guard between a backfill-heavy log and silently wrong analytics.

### D2 — Reconstruct gaps from real commits, without nagging
**As an** Analyst, **I want** silent gaps reconstructed at EOD using my work-repo commit
timestamps, confirmed by me, **so that** I'm never interrupted mid-flow to answer "still on X?".

**Acceptance**
- Nudging is passive; reconstruction **suggests**, never assumes.
- Commit timestamps corroborate coding spans; a gap with **no** commits is treated as a prompt to
  narrate (meeting / other machine), not evidence of idleness.

### D3 — Know how much to trust a span
**As an** Analyst, **I want** derived time marked with a confidence level, **so that** I don't mix a
live-narrated hour with a Friday-backfilled guess.

**Acceptance**
- Confidence is a function of gap length, presence of corroborating commits, and the
  `at − logged_at` lag.
- Backfilled spans are labeled as such, never silently blended with live-narrated time.

### D4 — Corrections are new events, not edits
**As a** Narrator, **I want** a backfill that contradicts a live event to be accepted and flagged
rather than silently rewriting history, **so that** the log stays append-only and auditable.

**Acceptance**
- An overlapping/contradictory event is appended, not merged; `kaban check` flags the conflict.
- No command rewrites or deletes an existing line.

---

## Epic E — Forward-looking (DEFERRED — turns on as clean history accumulates)

> None of these are v1. They must switch on with **no schema change** and add **zero** capture
> burden today. Cold-start honesty is a requirement: worthless on day 1, valuable by day 90. This is
> where the plan-then-track loop (Epic P + Epic C) pays off — every closed period is training data.

### E1 — Honest range estimates for new work *(Future-me)*
**As** Future-me, **I want** a new task estimated as a *range* from similar past tasks, **so that** I
commit to work with calibrated confidence instead of a wishful point — and my sprint planning (P3)
starts from evidence.

**Acceptance**
- Output is a distribution, e.g. `like 6 past tasks (3–9h, median 5h) → 5h, 80% under 8h`.
- Combines a calibration multiplier (systematic-bias correction) with reference-class matching.
- Returns a clearly-marked low-confidence result, not silence, before enough history exists.

### E2 — See the blast radius of an interruption *before* accepting it *(Future-me)*
**As** Future-me, **I want** an incoming urgent task to re-run my sprint schedule and **diff** it,
**so that** I see which deadlines break before I say yes.

**Acceptance**
- Produces a before/after diff: e.g. `auth-bug now finishes Fri 14:00 → misses Fri-noon deadline ⚠️;
  design review slips to Monday`.
- The *diff* — not the absolute schedule — is the deliverable insight.

### E3 — Cost of a scope or priority change *(Future-me)*
**As** Future-me, **I want** to see the hour-and-deadline cost of a feature growing or of jumping
the queue, **so that** change decisions are made with their downstream cost visible.

**Acceptance**
- Scope change re-estimates remaining work and re-runs the ripple; priority change shows the queue
  ripple in hours plus broken deadlines.

### E4 — Per-task and per-plan risk score *(Future-me)*
**As** Future-me, **I want** a risk score from variance + dependency + schedule tightness, **so
that** I can spot a fragile sprint plan early.

**Acceptance**
- Wide reference-class spread → uncertainty risk; historical blocked/waiting time → dependency risk;
  median finish near deadline → schedule risk.

### E5 — Reschedule with mitigations *(Future-me)*
**As** Future-me, **I want** any change to yield a new projection, a diff, the deadlines it breaks,
and candidate mitigations, **so that** I renegotiate from evidence.

**Acceptance**
- Surfaces mitigation options: drop / defer / delegate / renegotiate the date.

---

## Non-goals for v1 (explicit, to protect the core)

- No timer, no daemon, no database — one `log.jsonl` and one `kaban` CLI.
- No board file, no separately-maintained state — including the plan and the WBS, which are
  **derived views**, not editable trees.
- No automatic scheduling engine yet (Epic E is deferred; P4 capacity check starts naive with a
  fixed focus-hours number).
- No LLM-authored numbers — every reported figure comes from reproducible CLI computation.

## Open questions (affect story acceptance)

1. Is a task a first-class object (own id/estimate/deadline/status) or emergent from events?
   (Leaning first-class-lite — affects P2/B1/B2. A WBS parent/child relationship pushes toward
   first-class-lite.)
2. How does the estimator decide "similar"? (Category + size + project to start — affects E1/E4.)
3. Where does *daily capacity* come from — fixed or learned? (Blocks P4 and E2/E3/E5 scheduling.)
4. Product name — is "Kaban" final or a placeholder?
5. Backfill-vs-live conflict — reject, auto-split, or accept-and-flag? (Leaning accept-and-flag —
   this is why D4 is worded as it is.)
6. **New:** How is a WBS parent/child link modeled in an append-only log — a field on
   `task.created` (`parent`), or a separate `task.linked` event? (Affects P2.)
7. **New:** Is a sprint/period a first-class event stream (`period.opened`/`period.closed`) or just
   a date range passed to reports? (Affects all of Epic P.)
