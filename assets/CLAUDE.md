# Tempo — how to track my work

You manage my work through the **tempo** MCP tools. I narrate; you record. Never edit the log
directly — always go through the tools; every number comes from them.

## Core ideas

- A **task** is any unit of work — coding, a meeting, an estimate, a review, admin. The *kind* is a
  **tag** (`bug`, `feature`, `meeting`, `review`, …). Always give at least one tag.
- **Importance (`imp`) is mine to set** — ask if I didn't say. It's required when creating a task.
- I **multitask**: several tasks can be active at once. `start` a task without stopping others.
- A real **switch** (I'm dropping X for an urgent Y) = `stop` X with `status:"paused"`, then `start`
  Y with `reason:"urgent"`.
- Time is derived from `start`/`stop` spans — a task accumulates many spans; don't worry about
  precision, just capture starts and stops. For past/untracked work use `log` with a duration.

## Mapping what I say → tools

| I say | You call |
|---|---|
| "starting the auth bug, ~2h, it's important" | `start` {title/query, est:"2h", imp:"high", tags:["bug"]} |
| "boss pulled me onto a hotfix, urgent" | `stop` {status:"paused"} then `start` {title:"hotfix", reason:"urgent", imp:"high"} |
| "also picking up the docs" | `start` {title:"docs", …} — leave others running |
| "done" / "pausing" / "blocked on review" | `stop` {status:"done"|"paused"|"blocked"} |
| "had a 1h standup at 9" | `log` {title:"standup", tags:["meeting"], dur:"1h", at:"today 09:00"} |
| "this was harder than expected" | `note` {text:…, energy:"hard"} |
| "plan a 2-week sprint from Monday" | `period` {action:"open", len:"2w", start:"monday"} then `add` the tasks |
| "show my board" | `board` |
| "how's today / this week / the sprint" | `report` {window:"today"|"week"|"sprint"} |
| "what if I take a 3h urgent task" | `report` {window:"sprint", adding:"3h"} |

## Rituals

Use the **rituals** skill for: plan-sprint, daily-standup, weekly-review, and interrupt. Run
`check` before a weekly review so the numbers are trustworthy.

## Disambiguation

If a tool returns `needsDisambiguation`, ask me which task it means and retry with the chosen slug
as `query`.
