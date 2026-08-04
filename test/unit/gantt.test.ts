import { describe, it, expect } from "vitest";
import { ganttModel } from "../../src/core/board_html";
import { replay } from "../../src/core/replay";
import { ConfigSchema } from "../../src/core/config";
import type { Event } from "../../src/types";

// The 3-week window is [start-of-last-week, start-of-next-next-week): for a
// Monday-anchored "now" the window is 21 days wide, so each day is 100/21 %.
const config = ConfigSchema.parse({ timezone: "UTC", capacityHoursPerDay: 8 });
const DAY_PCT = 100 / 21;

function created(o: Partial<Event> & { task: string; title: string }): Event {
  return {
    id: "c-" + o.task,
    at: "2026-08-03T09:00:00Z",
    logged_at: "2026-08-03T09:00:00Z",
    source: "live",
    type: "task.created",
    important: false,
    urgent: false,
    tags: [],
    ...o,
  } as unknown as Event;
}

// "now" = Wed 2026-08-05; week starts Mon 2026-08-03, so the window runs
// Mon 2026-07-27 (day 0) → Mon 2026-08-17 (day 21).
const now = "2026-08-05T10:00:00Z";

describe("ganttModel — positioning", () => {
  it("backward-schedules an estimated task from its deadline at capacity", () => {
    // 16h at 8h/day = 2 working days; deadline Aug 8 → bar ends end-of-Aug-8.
    const p = replay([created({ task: "big", title: "Big", estMin: 960, deadline: "2026-08-08" })]);
    const [row] = ganttModel(p, config, now).rows;
    // Aug 8 is day index 12 from Jul 27; end-of-day rolls to the Aug 9 boundary (day 13).
    const endDay = 13;
    expect(row.widthPct).toBeCloseTo(2 * DAY_PCT, 3); // 2 working days wide
    expect(row.leftPct + row.widthPct).toBeCloseTo(endDay * DAY_PCT, 1);
    expect(row.progress).toBe(0);
    expect(row.overdue).toBe(false);
    expect(row.dlPct).not.toBeNull(); // deadline sits inside the window
  });

  it("floors a sub-day estimate to one calendar day so it stays visible", () => {
    const p = replay([created({ task: "tiny", title: "Tiny", estMin: 60, deadline: "2026-08-06" })]);
    const [row] = ganttModel(p, config, now).rows;
    expect(row.widthPct).toBeCloseTo(DAY_PCT, 3); // 1h → floored to a full day
  });

  it("flags an open task past its deadline as overdue", () => {
    const p = replay([created({ task: "late", title: "Late", estMin: 120, deadline: "2026-08-01" })]);
    const [row] = ganttModel(p, config, now).rows;
    expect(row.overdue).toBe(true);
  });

  it("marks a deadline outside the window as dlPct null", () => {
    const p = replay([created({ task: "far", title: "Far", estMin: 120, deadline: "2026-12-01" })]);
    const [row] = ganttModel(p, config, now).rows;
    expect(row.dlPct).toBeNull();
  });

  it("indents children under their parent in WBS order", () => {
    const p = replay([
      created({ task: "parent", title: "Parent", estMin: 120, deadline: "2026-08-07" }),
      created({ task: "child", title: "Child", estMin: 60, deadline: "2026-08-06", parent: "parent" }),
    ]);
    const rows = ganttModel(p, config, now).rows;
    expect(rows.map((r) => r.id)).toEqual(["parent", "child"]); // parent first, then child
    expect(rows[0].depth).toBe(0);
    expect(rows[1].depth).toBe(1);
  });

  it("places the today line inside the window and clamps bars into it", () => {
    const p = replay([created({ task: "t", title: "T", estMin: 120, deadline: "2026-08-07" })]);
    const m = ganttModel(p, config, now);
    expect(m.todayPct).toBeGreaterThan(0);
    expect(m.todayPct).toBeLessThan(100);
    expect(m.days).toHaveLength(21);
    for (const r of m.rows) {
      expect(r.leftPct).toBeGreaterThanOrEqual(0);
      expect(r.leftPct + r.widthPct).toBeLessThanOrEqual(100 + 1e-6);
    }
  });
});
