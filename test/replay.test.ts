import { describe, it, expect } from "vitest";
import type { Event } from "../src/types";
import {
  replay,
  taskGrossMin,
  collectIntervals,
  unionMinutes,
} from "../src/core/replay";

let seq = 0;
function ev(e: Partial<Event> & { type: Event["type"]; at: string }): Event {
  seq++;
  return {
    id: `e${seq}`,
    source: "live",
    logged_at: e.at,
    ...e,
  } as Event;
}

const NOW = "2026-08-03T23:59:00+07:00";

describe("replay — spans & status", () => {
  it("computes one span and a finished status", () => {
    const log: Event[] = [
      ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "auth", title: "Auth", important: true, tags: ["bug"] }),
      ev({ type: "task.started", at: "2026-08-03T09:00:00+07:00", task: "auth" }),
      ev({ type: "task.stopped", at: "2026-08-03T10:30:00+07:00", task: "auth", status: "done" }),
    ];
    const p = replay(log);
    const t = p.tasks.get("auth")!;
    expect(t.status).toBe("done");
    expect(taskGrossMin(t, NOW)).toBe(90);
  });

  it("sums many spans across interruptions", () => {
    const log: Event[] = [
      ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "a", title: "A", important: false, tags: [] }),
      ev({ type: "task.started", at: "2026-08-03T09:00:00+07:00", task: "a" }),
      ev({ type: "task.stopped", at: "2026-08-03T10:00:00+07:00", task: "a", status: "paused" }),
      ev({ type: "task.started", at: "2026-08-03T11:00:00+07:00", task: "a" }),
      ev({ type: "task.stopped", at: "2026-08-03T11:30:00+07:00", task: "a", status: "done" }),
    ];
    const t = replay(log).tasks.get("a")!;
    expect(t.spans.length).toBe(2);
    expect(taskGrossMin(t, NOW)).toBe(90);
  });
});

describe("replay — determinism", () => {
  it("is order-independent (shuffled log ⇒ same gross)", () => {
    const log: Event[] = [
      ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "a", title: "A", important: false, tags: [] }),
      ev({ type: "task.started", at: "2026-08-03T09:00:00+07:00", task: "a" }),
      ev({ type: "task.stopped", at: "2026-08-03T10:00:00+07:00", task: "a", status: "paused" }),
      ev({ type: "task.started", at: "2026-08-03T11:00:00+07:00", task: "a" }),
      ev({ type: "task.stopped", at: "2026-08-03T11:30:00+07:00", task: "a", status: "done" }),
    ];
    const shuffled = [...log].reverse();
    const g1 = taskGrossMin(replay(log).tasks.get("a")!, NOW);
    const g2 = taskGrossMin(replay(shuffled).tasks.get("a")!, NOW);
    expect(g2).toBe(g1);
    expect(g2).toBe(90);
  });

  it("drops duplicate ids (merge safety)", () => {
    const created = ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "a", title: "A", important: false, tags: [] });
    const p = replay([created, created]);
    expect(p.tasks.size).toBe(1);
  });
});

describe("replay — multitasking gross vs net", () => {
  it("counts gross per task but net once", () => {
    const log: Event[] = [
      ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "a", title: "A", important: false, tags: [] }),
      ev({ type: "task.created", at: "2026-08-03T09:00:00+07:00", task: "b", title: "B", important: false, tags: [] }),
      ev({ type: "task.started", at: "2026-08-03T09:00:00+07:00", task: "a" }),
      ev({ type: "task.started", at: "2026-08-03T09:30:00+07:00", task: "b", reason: "urgent" }),
      ev({ type: "task.stopped", at: "2026-08-03T10:00:00+07:00", task: "a", status: "done" }),
      ev({ type: "task.stopped", at: "2026-08-03T10:30:00+07:00", task: "b", status: "done" }),
    ];
    const p = replay(log);
    const gross =
      taskGrossMin(p.tasks.get("a")!, NOW) + taskGrossMin(p.tasks.get("b")!, NOW);
    const net = unionMinutes(collectIntervals(p.tasks.values(), NOW));
    expect(gross).toBe(120); // 60 + 60
    expect(net).toBe(90); // 09:00–10:30 union
    expect(p.interruptions).toBe(1); // b started with a reason
  });
});
