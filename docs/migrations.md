# Store migrations

Tempo's store (`.tempo/`) is versioned. Each version bump ships a **migration** that transforms an
older store forward, one step at a time. Your store records its version in `.tempo/version`, so on
upgrade Tempo knows exactly how many steps to run.

## How to upgrade

```bash
tempo upgrade         # run every pending step, in order, to the latest version
tempo check           # see your store version, the latest version, and steps behind
```

`tempo upgrade` backs up `events.jsonl`/`config.json` to `.tempo/backups/…` before touching anything,
advances `.tempo/version` after each step (so an interrupted run resumes), and prints each step's
guide. Then commit the changed `.tempo/` with your normal git workflow.

## Version history

### v1 → v2 — importance/urgency scores

Legacy tasks had a single 3-level `imp` (high/med/low). v2 replaced it with two 1–5 scores. The
migration maps `high→5`, `med→3`, `low→1` and drops `imp`. Nothing you need to do beyond
`tempo upgrade`.

### v2 → v3 — yes/no priority flags

The 1–5 `importance`/`urgency` scores became two yes/no flags, `important` and `urgent` (the four
Eisenhower categories A/B/C/D). The migration maps a score `≥4 → true`, `<4 → false`. Nothing you need
to do beyond `tempo upgrade`.
