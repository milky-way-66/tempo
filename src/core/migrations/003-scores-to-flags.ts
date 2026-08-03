import { defineMigration } from "./types.js";

// v2 → v3: the priority model went from two 1–5 scores (importance, urgency) to
// two yes/no flags (important, urgent). A score of 4–5 maps to true, 1–3 to
// false — the same threshold the board used to derive the Eisenhower category.
const HI = 4;

export default defineMigration({
  from: 2,
  to: 3,
  describe: "replace 1–5 `importance`/`urgency` with yes/no `important`/`urgent`",
  apply(ctx) {
    const events = ctx.readEvents().map((e) => {
      if (e.type === "task.created" || e.type === "task.updated") {
        if ("importance" in e) {
          e.important = typeof e.importance === "number" ? e.importance >= HI : false;
          delete e.importance;
        }
        if ("urgency" in e) {
          e.urgent = typeof e.urgency === "number" ? e.urgency >= HI : false;
          delete e.urgency;
        }
      }
      return e;
    });
    ctx.writeEvents(events);
  },
});
