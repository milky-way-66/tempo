import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, loadConfig, defaultConfig, type Paths } from "../../src/core/config";

function tmpPaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), "tempo-cfg-"));
  return { home, eventsFile: join(home, "events.jsonl"), configFile: join(home, "config.json"), gitattributesFile: join(home, ".gitattributes") };
}

describe("ConfigSchema", () => {
  it("applies defaults for an empty config", () => {
    const c = ConfigSchema.parse({});
    expect(c.timezone).toBe("system");
    expect(c.capacityHoursPerDay).toBe(8);
    expect(c.workDays).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("accepts a valid override", () => {
    const c = ConfigSchema.parse({ timezone: "Asia/Bangkok", capacityHoursPerDay: 6, workDays: ["mon", "tue"] });
    expect(c.timezone).toBe("Asia/Bangkok");
    expect(c.capacityHoursPerDay).toBe(6);
    expect(c.workDays).toEqual(["mon", "tue"]);
  });

  it("rejects a non-positive capacity and an unknown work day", () => {
    expect(() => ConfigSchema.parse({ capacityHoursPerDay: 0 })).toThrow();
    expect(() => ConfigSchema.parse({ capacityHoursPerDay: -3 })).toThrow();
    expect(() => ConfigSchema.parse({ workDays: ["funday"] })).toThrow();
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    expect(loadConfig(tmpPaths())).toEqual(defaultConfig());
  });

  it("reads and validates an on-disk config", () => {
    const paths = tmpPaths();
    writeFileSync(paths.configFile, JSON.stringify({ timezone: "UTC", capacityHoursPerDay: 5 }), "utf8");
    const c = loadConfig(paths);
    expect(c.timezone).toBe("UTC");
    expect(c.capacityHoursPerDay).toBe(5);
    expect(c.workDays).toEqual(["mon", "tue", "wed", "thu", "fri"]); // default fills in
  });
});
