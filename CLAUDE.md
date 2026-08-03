# Tempo — repo rules

## Store changes require a migration

The store (`.tempo/`) is **append-only and versioned**. Any change that alters the
**on-disk format** — the shape/fields of `events.jsonl` events, `config.json`, or the set of
files present in `.tempo/` — **MUST ship a migration** in the same change. Never change the
format silently: an existing user's store would break on load.

When such a change is made:

1. Add a step `src/core/migrations/NNN-<slug>.ts` exporting
   `defineMigration({ from, to, describe, guide, apply })`. Transform the raw log/config through
   `ctx` (never import the current typed schema — it's a moving target).
2. Write a clear, **user-facing `describe`** (one line) AND a **`guide`** — how to migrate / what
   changed, a sentence or a pointer to `docs/migrations.md` (or a script). Both are printed by
   `tempo upgrade`, so the user learns how many steps they're behind and what each does. Also add a
   per-version note to `docs/migrations.md`.
3. Register it in `src/core/migrations/index.ts` and bump `STORE_VERSION` in `src/core/version.ts`
   by exactly 1 (migrations count must equal `STORE_VERSION - 1`).
4. Add a migration test.

Users upgrade with **`tempo upgrade`** (runs each pending step in order, backs up, advances
`.tempo/version`); **`tempo check`** shows their version, the latest, and how many steps behind. The
store records its own version, so the number of steps is derived automatically.

Adding a **new** event type or an **optional** field is backward-compatible (old logs still load,
replay defaults it) and does **not** need a migration or a version bump — but still note it in the
changelog/PR so users know the new capability exists.

See `README.md` → "Store versioning & migrations" and the worked example in `migrations/index.ts`.
