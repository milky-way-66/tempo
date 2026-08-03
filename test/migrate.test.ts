import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upgradeStore } from "../src/core/migrate";
import { readStoreVersion, writeStoreVersion } from "../src/core/version";
import { defineMigration } from "../src/core/migrations/types";
import type { Paths } from "../src/core/config";

function tmpStore(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-mig-"));
  return {
    home,
    eventsFile: join(home, "events.jsonl"),
    configFile: join(home, "config.json"),
    gitattributesFile: join(home, ".gitattributes"),
  };
}

function seed(paths: Paths, version: number, events: object[]): void {
  writeFileSync(paths.eventsFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  writeStoreVersion(paths, version);
}

// v1 → v2 renames `kind` to `type`; v2 → v3 adds `v: 3` to every event.
const m1to2 = defineMigration({
  from: 1,
  to: 2,
  describe: "rename `kind` → `type`",
  apply(ctx) {
    ctx.writeEvents(
      ctx.readEvents().map((e) => {
        e.type = e.kind;
        delete e.kind;
        return e;
      }),
    );
  },
});
const m2to3 = defineMigration({
  from: 2,
  to: 3,
  describe: "stamp `v: 3`",
  apply(ctx) {
    ctx.writeEvents(ctx.readEvents().map((e) => ({ ...e, v: 3 })));
  },
});

describe("upgradeStore", () => {
  it("runs every step in sequence from the store's version up to target", () => {
    const paths = tmpStore();
    seed(paths, 1, [{ id: "a", kind: "task.created" }]);

    const r = upgradeStore(paths, { migrations: [m1to2, m2to3], target: 3, backup: false });

    expect(r.from).toBe(1);
    expect(r.to).toBe(3);
    expect(r.applied.map((s) => `${s.from}->${s.to}`)).toEqual(["1->2", "2->3"]);
    const events = readFileSync(paths.eventsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events[0]).toEqual({ id: "a", type: "task.created", v: 3 });
    expect(readStoreVersion(paths)).toBe(3);
  });

  it("starts from the user's current version, skipping already-applied steps", () => {
    const paths = tmpStore();
    seed(paths, 2, [{ id: "a", type: "task.created" }]); // already at v2

    const r = upgradeStore(paths, { migrations: [m1to2, m2to3], target: 3, backup: false });

    expect(r.applied.map((s) => s.to)).toEqual([3]); // only 2->3 ran
    expect(readStoreVersion(paths)).toBe(3);
  });

  it("is a no-op when already at target", () => {
    const paths = tmpStore();
    seed(paths, 3, [{ id: "a" }]);
    const r = upgradeStore(paths, { migrations: [m1to2, m2to3], target: 3, backup: false });
    expect(r.applied).toEqual([]);
  });

  it("throws on a gap in the migration chain", () => {
    const paths = tmpStore();
    seed(paths, 1, [{ id: "a" }]);
    expect(() =>
      upgradeStore(paths, { migrations: [m1to2 /* no 2->3 */], target: 3, backup: false }),
    ).toThrow(/no migration from store v2/);
  });

  it("refuses to downgrade a store newer than the binary understands", () => {
    const paths = tmpStore();
    seed(paths, 5, [{ id: "a" }]);
    expect(() =>
      upgradeStore(paths, { migrations: [m1to2, m2to3], target: 3, backup: false }),
    ).toThrow(/store is at v5/);
  });

  it("advances the version after each step so a crash mid-chain is resumable", () => {
    const paths = tmpStore();
    seed(paths, 1, [{ id: "a", kind: "task.created" }]);
    const boom = defineMigration({ from: 2, to: 3, describe: "explodes", apply() { throw new Error("boom"); } });

    expect(() =>
      upgradeStore(paths, { migrations: [m1to2, boom], target: 3, backup: false }),
    ).toThrow(/boom/);

    // 1->2 committed before 2->3 blew up: version is at 2, and re-running finishes it.
    expect(readStoreVersion(paths)).toBe(2);
    const resumed = upgradeStore(paths, { migrations: [m1to2, m2to3], target: 3, backup: false });
    expect(resumed.from).toBe(2);
    expect(readStoreVersion(paths)).toBe(3);
  });

  it("writes a pre-migration backup by default", () => {
    const paths = tmpStore();
    seed(paths, 1, [{ id: "a", kind: "task.created" }]);
    const r = upgradeStore(paths, { migrations: [m1to2], target: 2, stamp: "test" });
    expect(r.backup).toBeDefined();
    expect(existsSync(join(r.backup!, "events.jsonl"))).toBe(true);
    // the backup holds the pre-migration bytes
    expect(readFileSync(join(r.backup!, "events.jsonl"), "utf8")).toContain('"kind"');
  });
});

describe("real migration chain v1 → v3 (imp → scores → flags)", () => {
  it("maps legacy imp all the way to yes/no important/urgent flags", async () => {
    const { MIGRATIONS } = await import("../src/core/migrations/index");
    const { replay } = await import("../src/core/replay");
    const paths = tmpStore();
    seed(paths, 1, [
      { id: "c1", at: "2026-08-03T09:00:00Z", logged_at: "2026-08-03T09:00:00Z", source: "live", type: "task.created", task: "a", title: "A", imp: "high", tags: [] },
      { id: "c2", at: "2026-08-03T09:00:00Z", logged_at: "2026-08-03T09:00:00Z", source: "live", type: "task.created", task: "b", title: "B", imp: "low", tags: [] },
      { id: "u1", at: "2026-08-03T10:00:00Z", logged_at: "2026-08-03T10:00:00Z", source: "live", type: "task.updated", task: "b", imp: "med" },
    ]);
    // v1 → v2 (imp→importance 5/3/1) → v3 (importance≥4 → important flag)
    const r = upgradeStore(paths, { migrations: MIGRATIONS, target: 3, backup: false });
    expect(r.to).toBe(3);

    const raw = readFileSync(paths.eventsFile, "utf8");
    expect(raw).not.toContain('"imp"');
    expect(raw).not.toContain('"importance"');
    expect(raw).toContain('"important":true');

    const p = replay(JSON.parse("[" + raw.trim().split("\n").join(",") + "]"));
    expect(p.tasks.get("a")!.important).toBe(true); // high(5) ≥ 4
    expect(p.tasks.get("a")!.urgent).toBe(false); // defaulted, no urgency
    expect(p.tasks.get("b")!.important).toBe(false); // low(1)→med(3), still < 4
  });
});
