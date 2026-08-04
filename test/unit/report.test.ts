import { describe, it, expect } from "vitest";
import { replay } from "../../src/core/replay";
import { board, boardText, report, reportText, quadrant, windowFor, stopVerdict } from "../../src/core/report";
import { ConfigSchema } from "../../src/core/config";
import type { Event, Task } from "../../src/types";

const config = ConfigSchema.parse({ timezone: "UTC", capacityHoursPerDay: 8 });
const now = "2026-08-05T12:00:00Z"; // Wednesday; week starts Mon 2026-08-03

let seq = 0;
function ev(o: Partial<Event> & { type: Event["type"]; at: string; task?: string }): Event {
  seq++;
  return { id: `e${seq}`, source: "live", logged_at: o.at, ...o } as Event;
}

// Two tasks worked today: A (important+urgent, api, done, est 2h) and
// B (neither, docs, started as an urgent interruption).
const events: Event[] = [
  ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "a", title: "A", important: true, urgent: true, tags: ["bug"], project: "api", estMin: 120 } as never),
  ev({ type: "task.started", at: "2026-08-05T09:00:00Z", task: "a" } as never),
  ev({ type: "task.stopped", at: "2026-08-05T11:00:00Z", task: "a", status: "done" } as never),
  ev({ type: "task.created", at: "2026-08-05T11:00:00Z", task: "b", title: "B", important: false, urgent: false, tags: [], project: "docs" } as never),
  ev({ type: "task.started", at: "2026-08-05T11:00:00Z", task: "b", reason: "urgent" } as never),
  ev({ type: "task.stopped", at: "2026-08-05T11:30:00Z", task: "b", status: "paused" } as never),
];
const proj = replay(events);

describe("quadrant", () => {
  const mk = (important: boolean, urgent: boolean) => ({ important, urgent }) as Task;
  it("maps the two axes to A/B/C/D quadrants", () => {
    expect(quadrant(mk(true, true))).toBe("Q1");
    expect(quadrant(mk(true, false))).toBe("Q2");
    expect(quadrant(mk(false, true))).toBe("Q3");
    expect(quadrant(mk(false, false))).toBe("Q4");
  });
});

describe("board", () => {
  it("buckets tasks by status", () => {
    const cols = board(proj);
    expect(cols.done.map((t) => t.id)).toEqual(["a"]);
    expect(cols.paused.map((t) => t.id)).toEqual(["b"]);
    expect(cols.todo).toEqual([]);
  });

  it("filters by project and excludes archived", () => {
    const p2 = replay([
      ...events,
      ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "z", title: "Z", important: false, tags: [], project: "api" } as never),
      ev({ type: "task.archived", at: "2026-08-05T09:30:00Z", task: "z", archived: true } as never),
    ]);
    const cols = board(p2, "api");
    const ids = Object.values(cols).flat().map((t) => t.id);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b"); // different project
    expect(ids).not.toContain("z"); // archived
  });

  it("renders a text board with category letters", () => {
    const txt = boardText(proj);
    expect(txt).toContain("DONE (1)");
    expect(txt).toContain("a — A [api] (A)");
    expect(txt).toContain("PAUSED (1)");
  });
});

describe("windowFor", () => {
  it("labels the today and week windows", () => {
    expect(windowFor("today", proj, now, config).label).toBe("today");
    expect(windowFor("week", proj, now, config).label).toBe("this week");
  });
  it("falls back to this week when no sprint is open", () => {
    expect(windowFor("sprint", proj, now, config).label).toContain("no open sprint");
  });
});

describe("report", () => {
  it("computes gross/net/multitask and distribution by project", () => {
    const r = report(proj, config, now, { window: "today", by: "project" });
    expect(r.grossMin).toBe(150); // 120 + 30
    expect(r.netMin).toBe(150); // no overlap
    expect(r.multitaskFactor).toBeCloseTo(1, 5);
    expect(r.interruptions).toBe(1); // b started with a reason, inside the window
    expect(r.distribution).toEqual([
      ["api", 120],
      ["docs", 30],
    ]);
  });

  it("splits by tag and by quadrant", () => {
    expect(report(proj, config, now, { window: "today", by: "tag" }).distribution).toEqual(
      expect.arrayContaining([
        ["bug", 120],
        ["(untagged)", 30],
      ]),
    );
    expect(report(proj, config, now, { window: "today", by: "quadrant" }).distribution).toEqual(
      expect.arrayContaining([
        ["Q1", 120],
        ["Q4", 30],
      ]),
    );
  });

  it("reports estimate-vs-actual for finished, estimated tasks", () => {
    const r = report(proj, config, now, { window: "today" });
    expect(r.eva).toEqual([{ id: "a", est: 120, actual: 120, ratio: 1 }]);
  });

  it("renders a text report", () => {
    const txt = reportText(proj, config, now, { window: "today", by: "project" });
    expect(txt).toContain("today: net 2h30m worked");
    expect(txt).toContain("by project:");
    expect(txt).toContain("api: 2h");
  });
});

describe("report — sprint on-track", () => {
  const withSprint = replay([
    ev({ type: "period.opened", at: "2026-08-03T00:00:00Z", period: "s1", start: "2026-08-03", end: "2026-08-14", capacityHoursPerDay: 8 } as never),
    ev({ type: "task.created", at: "2026-08-05T09:00:00Z", task: "big", title: "Big", important: true, tags: [], period: "s1", estMin: 120 } as never),
  ]);

  it("is on track when remaining fits capacity", () => {
    const r = report(withSprint, config, now, { window: "sprint" });
    expect(r.onTrack?.remainingMin).toBe(120);
    expect(r.onTrack?.verdict).toBe("on track");
  });

  it("flags over-capacity via the adding what-if", () => {
    const r = report(withSprint, config, now, { window: "sprint", addingMin: 100000 });
    expect(r.onTrack?.verdict).toContain("over capacity");
  });
});

describe("stopVerdict", () => {
  const t = (estMin: number | undefined, spans: { start: string; end?: string }[]) =>
    ({ estMin, spans } as Task);
  it("says on target within 10%", () => {
    expect(stopVerdict(t(120, [{ start: "2026-08-05T09:00:00Z", end: "2026-08-05T11:00:00Z" }]), now)).toContain("on target");
  });
  it("reports the ratio when off", () => {
    expect(stopVerdict(t(60, [{ start: "2026-08-05T09:00:00Z", end: "2026-08-05T11:00:00Z" }]), now)).toContain("2.0× estimate");
  });
  it("just reports actual with no estimate", () => {
    expect(stopVerdict(t(undefined, [{ start: "2026-08-05T09:00:00Z", end: "2026-08-05T10:00:00Z" }]), now)).toBe("1h");
  });
});
