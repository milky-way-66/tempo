---
name: tempo-rituals
description: The Tempo work-tracking rituals — plan a sprint, run a daily standup, do a weekly review, and handle an interruption. Use when the user wants to plan/track/review their work with Tempo, or when they mention a sprint, standup, weekly review, or an urgent interruption.
---

# Tempo Rituals

Drive these through the `tempo` MCP tools. Keep it conversational; capture the minimum.

## Plan a sprint (start of week / 2-week sprint)

1. `period` {action:"open", len:"2w", start:<Monday>} — open the horizon.
2. For each item the user brain-dumps: `add` {title, imp (ask!), tags, est, period:<name>, parent?}.
   Break big items into child leaves via `parent`.
3. `report` {window:"sprint"} — show the on-track verdict (committed estimate vs capacity). If
   over capacity, help drop/defer until it fits.

## Daily standup

1. `report` {window:"today"} — net hours, interruptions, and the on-track verdict.
2. `board` — what's in flight, blocked, and left.
3. Surface risk plainly: if behind, say so and name the pressure (interruptions vs over-estimate).

## Weekly review

1. `check` — make sure the numbers are trustworthy; mention any issues.
2. `report` {window:"week", by:"quadrant"} — where time went (Q2 high-value vs Q3 firefighting).
3. `report` {window:"week", by:"project"} and `by:"tag"` for the breakdown.
4. Reflect: was the week effective, or did low-value work dominate? Suggest one adjustment.

## Closing a task (marking work done)

1. **Recheck the result before recording `done`** — run the tests/build, re-run the flow, confirm the
   bug is gone or the change is live. Work can fail; `done` must mean verified.
2. If it holds: `stop` {query, status:"done"}. Share the est-vs-actual verdict the tool returns.
3. If it didn't: `stop` {status:"blocked"} (or leave it running) with a `reason`, and `note` what
   failed — never record `done` for unverified work.

## Interruption (urgent work lands mid-sprint)

1. `report` {window:"sprint", adding:<estimate>} — show the impact before accepting.
2. If accepted: `stop` {status:"paused"} the current task, then `start` the urgent task with
   `reason:"urgent"`.
3. If it breaks the sprint, tell the user which planned work no longer fits.
