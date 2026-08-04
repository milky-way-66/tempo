import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { parseInstant, parseDurationMin, formatMin } from "../../src/core/time";

const now = DateTime.fromISO("2026-08-03T10:00:00+07:00", { setZone: true });
const opts = { now, zone: "Asia/Bangkok" }; // +07:00, no DST

describe("parseInstant", () => {
  it("resolves now with an offset", () => {
    expect(parseInstant("", opts)).toBe("2026-08-03T10:00:00+07:00");
    expect(parseInstant("now", opts)).toBe("2026-08-03T10:00:00+07:00");
  });

  it("handles relative offsets", () => {
    expect(parseInstant("-2h", opts)).toBe("2026-08-03T08:00:00+07:00");
    expect(parseInstant("+30m", opts)).toBe("2026-08-03T10:30:00+07:00");
    expect(parseInstant("-1d", opts)).toBe("2026-08-02T10:00:00+07:00");
  });

  it("handles day words and bare times", () => {
    expect(parseInstant("yesterday 14:00", opts)).toBe("2026-08-02T14:00:00+07:00");
    expect(parseInstant("today at 09:15", opts)).toBe("2026-08-03T09:15:00+07:00");
    expect(parseInstant("14:00", opts)).toBe("2026-08-03T14:00:00+07:00");
  });

  it("always carries an offset", () => {
    expect(parseInstant("-2h", opts)).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("preserves the instant of an ISO input", () => {
    const r = parseInstant("2026-01-01T00:00:00+09:00", opts);
    expect(DateTime.fromISO(r).toMillis()).toBe(
      DateTime.fromISO("2026-01-01T00:00:00+09:00").toMillis(),
    );
  });

  it("throws on garbage", () => {
    expect(() => parseInstant("someday", opts)).toThrow();
  });
});

describe("parseDurationMin", () => {
  it("parses common forms", () => {
    expect(parseDurationMin("2h")).toBe(120);
    expect(parseDurationMin("90m")).toBe(90);
    expect(parseDurationMin("1h30m")).toBe(90);
    expect(parseDurationMin("1.5h")).toBe(90);
    expect(parseDurationMin("45")).toBe(45);
  });
  it("throws on garbage", () => {
    expect(() => parseDurationMin("soon")).toThrow();
  });
});

describe("formatMin", () => {
  it("formats", () => {
    expect(formatMin(110)).toBe("1h50m");
    expect(formatMin(120)).toBe("2h");
    expect(formatMin(45)).toBe("45m");
  });
});
