# Kaban — Use Cases

> Status: **draft.** Derived from [USER_STORIES.md](USER_STORIES.md). Each use case is a concrete
> actor-goal flow that realizes one or more stories. These feed the app design next.
> Last updated: 2026-08-03

## Conventions

- **Actor** — the human (Planner / Narrator / Analyst — all the same solo developer in different
  modes). The **System** is the `kaban` CLI; **Claude** is the conversational front end that
  translates the actor's words into `kaban` commands and relays the output.
- **Interaction model (applies to every use case).** The actor speaks in natural language to Claude;
  Claude picks and runs a `kaban` command; the System appends events and/or computes a view and
  prints text; Claude relays and interprets it. **Claude never reads or writes `log.jsonl` directly.**
- Steps are written as `Actor → Claude → System` so the design can see exactly where each
  responsibility sits.
- **Story trace** links each use case back to the stories it satisfies.

## Use-case map (by the 4-beat workflow)

| # | Use case | Beat | Story trace |
|---|---|---|---|
| UC-1 | Plan a week / sprint (WBS + estimates + capacity) | Plan | P1–P4 |
| UC-2 | Capture live work | Work | A1, A3, A4, A6 |
| UC-3 | Absorb an urgent interruption mid-sprint | Work | P7, A2 |
| UC-4 | Backfill off-repo / past work | Work | A5, A7 |
| UC-5 | Daily check-in — am I on track? | Track | C0, B1, B2, P5 |
| UC-6 | Weekly review — where did my time go? | Analyze | C1–C5 |
| UC-7 | Close the sprint (retro) | Analyze | P6 |
| UC-8 | Trust the log — validate & reconcile gaps | Cross-cutting | D1–D4 |
| UC-9 | Forecast & reschedule *(deferred)* | Analyze | E1–E5 |

---

## UC-1 — Plan a week / sprint

- **Actor:** Planner
- **Goal:** Commit to a realistic, estimated, broken-down plan for the coming period.
- **Trigger:** Start of a week or 2-week sprint.
- **Preconditions:** None (works with zero history).
- **Postcondition:** A period exists with committed, estimated leaf tasks; capacity fit is known.

**Main flow**
1. Actor → Claude: "Let's plan this sprint, two weeks from Monday."
2. Claude → System: `kaban plan open --sprint --from mon --len 2w` → appends `period.opened`.
3. Actor → Claude: brain-dumps the work ("ship auth, fix the billing bug, write Q3 doc…").
4. Claude → System: for each item, `kaban add <task> --imp <…> --tag <…>` → `task.created` events.
5. Actor → Claude: breaks big items down ("auth = login API + token refresh + tests").
6. Claude → System: creates child leaves linked to the parent (WBS) with `--est` on each leaf.
7. Actor → Claude: "does that fit?"
8. Claude → System: `kaban plan status` → System sums leaf estimates vs period capacity.
9. System → Claude → Actor: `committed 68h vs ~50h capacity → 18h over; 3 leaves at risk`.

**Alternate flows**
- **3a. Over-committed (step 9 shows over):** Actor drops/defers leaves; Claude logs the removals as
  events; re-run `plan status` until it fits or the actor accepts the risk.
- **5a. No breakdown needed:** small items stay as single leaves.
- **6a. Estimator active (deferred):** Claude offers an E1 range as a suggestion; actor still sets
  the committed number.

**Exceptions**
- **2e. A period is already open:** System refuses to open an overlapping period; actor closes the
  prior one (UC-7) or plans into the existing one.

---

## UC-2 — Capture live work

- **Actor:** Narrator
- **Goal:** Record what I'm working on as I do it, with zero timer overhead.
- **Trigger:** Starting, pausing, blocking, or finishing a task.
- **Preconditions:** None. Task may or may not have been planned in UC-1.
- **Postcondition:** The log reflects current reality; time is derivable from timestamps.

**Main flow (start → finish)**
1. Actor → Claude: "starting the auth login API, about 2h."
2. Claude → System: `kaban start login-api --est 2h` (attaches to the planned leaf if it exists;
   else creates it). Appends `task.started`.
3. …work happens…
4. Actor → Claude: "done."
5. Claude → System: `kaban done` → appends `task.finished`.
6. System → Claude → Actor: `login-api: 1h50m (est 2h, on target)`.

**Alternate flows**
- **Pause/resume:** "taking a break" → `kaban pause`; "back on it" → `kaban resume`.
- **Blocked:** "can't continue, waiting on review" → `kaban block --reason waiting` (distinct from
  pause: "can't" vs "chose not to").
- **Nested interruption:** handled by UC-3; finishing the interrupter pops back automatically.

**Exceptions**
- **2e. Starting a second task without closing the first:** System auto-pushes the current task onto
  the focus stack (treats it as a switch) rather than silently overlapping; `kaban check` would flag
  a true overlap.

---

## UC-3 — Absorb an urgent interruption mid-sprint

- **Actor:** Narrator/Planner (under pressure)
- **Goal:** Understand a new urgent task's impact on the plan, then accept it cleanly.
- **Trigger:** Boss (or reality) drops urgent work during the period.
- **Preconditions:** A period with committed work exists (UC-1).
- **Postcondition:** If accepted, the switch is logged with a reason and the interrupted task is
  preserved on the stack; the actor knows the plan impact.

**Main flow**
1. Actor → Claude: "boss wants a prod hotfix now, ~1h. What does that do to my sprint?"
2. Claude → System: quick-check — `kaban plan impact --est 1h` (read-only): compares
   `remaining committed + 1h` vs `remaining capacity`.
3. System → Claude → Actor: `+1h urgent → sprint now 4h over; "Q3 doc" (Q2) likely slips`.
4. Actor decides.
5a. **Accept:** Claude → System: `kaban switch prod-hotfix --reason urgent --est 1h` → `task.switched`;
    current task pushed to stack.
5b. **Decline:** nothing is logged (the check wrote nothing).
6. When hotfix done: `kaban done` → pops back to the interrupted task.

**Alternate flows**
- **Full ripple (deferred, UC-9/E2):** instead of a capacity delta, show a schedule **diff** with
  moved dates and broken deadlines, plus mitigations (drop/defer/delegate/renegotiate).

**Exceptions**
- **2e. No open period:** impact check falls back to "no plan to compare against"; the switch can
  still be logged as ordinary capture (UC-2).

---

## UC-4 — Backfill off-repo / past work

- **Actor:** Narrator
- **Goal:** Record work that left no live trace (meetings, other-machine work, forgotten spans).
- **Trigger:** Remembering/After a meeting, or reconstructing a gap.
- **Preconditions:** None.
- **Postcondition:** Event lands at the time it *happened*, marked as backfill.

**Main flow**
1. Actor → Claude: "had a 1h sprint planning at 2pm yesterday."
2. Claude → System: `kaban log meeting sprint-planning --at "yesterday 14:00" --dur 1h`.
3. System: resolves loose time to absolute ISO-8601+offset; expands `--dur` into a start/finish pair;
   sets `source=backfill`, `logged_at=now`; appends.
4. System → Claude → Actor: confirmation with the resolved absolute time.

**Exceptions**
- **3e. Backfill overlaps a live event** (e.g. a task was "started" across that window): System
  **accepts and flags** — appends the event; `kaban check` reports the overlap (a correction is a
  new event, never an edit).
- **1e. Actor unsure of the time:** allow an imprecise marker (`--at ~afternoon`) stored as a range
  rather than inventing a precise timestamp.

---

## UC-5 — Daily check-in: am I on track?

- **Actor:** Analyst
- **Goal:** One-glance read on progress and deadline risk, with a verdict.
- **Trigger:** Once a day (morning or EOD).
- **Preconditions:** Some events exist for the period.
- **Postcondition:** Actor knows what's in flight, what's blocked, what remains, and on-track status.

**Main flow**
1. Actor → Claude: "how's it going / show me where I'm at."
2. Claude → System: `kaban standup` (or `board` + `plan status`).
3. System computes from the log: in-flight task(s), blocked items, completed today/period, remaining
   planned leaves + estimates; projects remaining estimate vs remaining capacity.
4. System → Claude → Actor: board view + verdict — `on track` or `~4h behind → deadline at risk;
   pressure = 3h of interruptions this week`.

**Alternate flows**
- **Behind:** Claude surfaces the pressure source (scope added vs estimates over) and offers the
  UC-3/UC-9 replan path.
- **Just the board:** "show board" → `kaban board` (todo/doing/blocked/done) with planned-not-started
  in todo.

---

## UC-6 — Weekly review: where did my time go?

- **Actor:** Analyst
- **Goal:** See how time was distributed and judge effectiveness (high- vs low-value work).
- **Trigger:** End of the week.
- **Preconditions:** A week of events.
- **Postcondition:** Actor has a distribution + value verdict to adjust next week.

**Main flow**
1. Actor → Claude: "let's review the week."
2. Claude → System: `kaban report --week`.
3. System computes (events sorted by `at`): total tracked time broken down by **project**, **tag/
   category**, and **Eisenhower quadrant** — hours and % each; plus est-vs-actual and interruption
   count.
4. System → Claude → Actor: distribution + **value verdict** — `Q2 11% vs 25% last week → drifting
   reactive; 64% went to Q3 firefighting; auth-bug ran 1.5× estimate`.

**Alternate flows**
- **Drill-down:** actor asks "what ate the most time?" → Claude re-queries by tag/task.
- **Visual (optional, later):** render distribution as an HTML/chart artifact instead of text.

---

## UC-7 — Close the sprint (retro)

- **Actor:** Analyst
- **Goal:** Score the period and carry lessons into the next plan.
- **Trigger:** End of the period.
- **Preconditions:** An open period (UC-1).
- **Postcondition:** Period closed; planned-vs-actual and bias summarized.

**Main flow**
1. Actor → Claude: "close out the sprint."
2. Claude → System: `kaban plan close` → appends `period.closed`.
3. System → Claude → Actor: planned-vs-completed leaves, aggregate est-vs-actual bias, and % of the
   period spent on unplanned/interrupt work.

**Alternate flows**
- **Carryover:** unfinished leaves can be rolled into the next period during UC-1.

---

## UC-8 — Trust the log: validate & reconcile gaps

- **Actor:** Analyst
- **Goal:** Ensure derived numbers are trustworthy.
- **Trigger:** Anytime; especially before a review, or at EOD.
- **Preconditions:** None.
- **Postcondition:** Known data-quality state; gaps reconstructed with consent.

**Main flow (validate)**
1. Actor → Claude: "check my log."
2. Claude → System: `kaban check` → validates schema, sort-ability, overlapping spans; reports
   data-quality state (including confidence-labeled spans).

**Main flow (reconcile gaps)**
1. At EOD, Claude → System: reconstruct silent spans using work-repo **commit timestamps** as
   corroboration.
2. System → Claude → Actor: *suggests* fills — "9–11am gap, 3 commits on `api` → log 2h coding?"
3. Actor confirms/edits → Claude logs backfill events (UC-4). Reconstruction **suggests, never
   assumes**.

**Exceptions**
- **Gap with no commits:** treated as a prompt to narrate (meeting/other machine), **not** evidence
  of idleness.

---

## UC-9 — Forecast & reschedule *(deferred — turns on with clean history)*

- **Actor:** Future-me
- **Goal:** Estimate new work from history and see the cost of changes before committing.
- **Trigger:** Planning (UC-1), or an interruption/scope change (UC-3).
- **Preconditions:** Enough clean, well-tagged history; **no schema change** from v1.
- **Postcondition:** Range estimates, ripple diffs, risk scores, reschedule options.

**Capabilities (each a story: E1–E5)**
- **E1** reference-class range estimate for a new task (`like 6 past tasks, 3–9h, median 5h`).
- **E2** interruption ripple as a schedule **diff** (dates move, deadlines break).
- **E3** cost of a scope or priority change (hours + broken deadlines).
- **E4** per-task / per-plan risk score (variance + dependency + tightness).
- **E5** reschedule with mitigations (drop / defer / delegate / renegotiate).

---

## Open questions carried into design

1. Task as first-class object vs emergent from events (leaning first-class-lite; WBS parent/child
   pushes that way). — affects UC-1, UC-2.
2. Is a period first-class (`period.opened`/`period.closed`) or just a date range on reports? —
   affects UC-1, UC-5, UC-7.
3. WBS link representation: `parent` field on `task.created` vs a separate `task.linked` event? —
   affects UC-1.
4. Daily capacity: fixed user-set number vs learned from history? — affects UC-1, UC-3, UC-5, UC-9.
5. Backfill-vs-live conflict: accept-and-flag (current lean). — affects UC-4.
6. Is `plan impact` (UC-3) a distinct read-only command, or a mode of `plan status`?
