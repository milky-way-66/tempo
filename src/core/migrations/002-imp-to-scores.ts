import { defineMigration } from "./types.js";

// v1 → v2: the priority model moved from a single 3-level `imp` (high/med/low)
// to two independent 1–5 axes, `importance` and `urgency`. Map the old level
// onto importance (high→5, med→3, low→1) and drop `imp`. `urgency` is left
// unset here so replay applies its default of 3.
const IMP_TO_SCORE: Record<string, number> = { high: 5, med: 3, low: 1 };

export default defineMigration({
  from: 1,
  to: 2,
  describe: "replace task `imp` (high/med/low) with `importance` (1–5); urgency defaults to 3",
  apply(ctx) {
    const events = ctx.readEvents().map((e) => {
      if ((e.type === "task.created" || e.type === "task.updated") && "imp" in e) {
        const level = typeof e.imp === "string" ? e.imp : "med";
        e.importance = IMP_TO_SCORE[level] ?? 3;
        delete e.imp;
      }
      return e;
    });
    ctx.writeEvents(events);
  },
});
