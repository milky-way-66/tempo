import type { Migration } from "./types.js";

/**
 * The ordered chain of store-format migrations, one entry per version step.
 *
 * `MIGRATIONS[i]` upgrades a store from version `i + 1` to `i + 2`, so the array
 * must be contiguous starting at v1 and its length must equal `STORE_VERSION - 1`
 * (the runner asserts this). To add a new format version:
 *
 *   1. Put the step in its own file, e.g. `002-rename-est-field.ts`:
 *
 *        import { defineMigration } from "./types.js";
 *        export default defineMigration({
 *          from: 1,
 *          to: 2,
 *          describe: "rename task `estMin` → `estimateMinutes`",
 *          apply(ctx) {
 *            const events = ctx.readEvents().map((e) => {
 *              if (e.type === "task.created" && "estMin" in e) {
 *                e.estimateMinutes = e.estMin;
 *                delete e.estMin;
 *              }
 *              return e;
 *            });
 *            ctx.writeEvents(events);
 *          },
 *        });
 *
 *   2. Import it and append it below (order matters — lowest `from` first).
 *   3. Bump `STORE_VERSION` in ../version.ts to the new `to`.
 *
 * Steps run sequentially from the user's current version up to STORE_VERSION,
 * so a user two versions behind runs both steps in order.
 */
import m002 from "./002-imp-to-scores.js";
import m003 from "./003-scores-to-flags.js";

export const MIGRATIONS: Migration[] = [m002, m003];
