import { DateTime } from "luxon";

export interface TimeOpts {
  zone?: string; // "system" or IANA zone; from config
  now?: DateTime; // injectable for tests
}

function zoneOf(opts: TimeOpts): string | undefined {
  return !opts.zone || opts.zone === "system" ? undefined : opts.zone;
}

function base(opts: TimeOpts): DateTime {
  const zone = zoneOf(opts);
  let dt = opts.now ?? DateTime.now();
  if (zone) dt = dt.setZone(zone);
  return dt;
}

function iso(dt: DateTime): string {
  const s = dt.toISO({ suppressMilliseconds: true });
  if (!s) throw new Error("Invalid date");
  return s;
}

/**
 * Resolve loose human time to an absolute ISO-8601 string WITH offset.
 * Supported: "" / "now"; relative "-2h" "+30m" "-1d"; "yesterday|today|tomorrow [HH:mm]";
 * bare "HH:mm" (today); ISO strings; "YYYY-MM-DD".
 */
export function parseInstant(input: string | undefined, opts: TimeOpts = {}): string {
  const now = base(opts);
  const raw = (input ?? "").trim().toLowerCase();
  if (raw === "" || raw === "now") return iso(now);

  const rel = raw.match(/^([+-]?)(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)$/);
  if (rel) {
    const sign = rel[1] === "-" ? -1 : 1;
    const n = parseFloat(rel[2]) * sign;
    const u = rel[3][0];
    const dur = u === "h" ? { hours: n } : u === "d" ? { days: n } : { minutes: n };
    return iso(now.plus(dur));
  }

  const dayWord = raw.match(/^(yesterday|today|tomorrow)(?:\s+(?:at\s+)?(\d{1,2}):(\d{2}))?$/);
  if (dayWord) {
    let d = now;
    if (dayWord[1] === "yesterday") d = d.minus({ days: 1 });
    else if (dayWord[1] === "tomorrow") d = d.plus({ days: 1 });
    d =
      dayWord[2] !== undefined
        ? d.set({ hour: +dayWord[2], minute: +dayWord[3], second: 0, millisecond: 0 })
        : d.startOf("day");
    return iso(d);
  }

  const time = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (time) {
    return iso(now.set({ hour: +time[1], minute: +time[2], second: 0, millisecond: 0 }));
  }

  const zone = zoneOf(opts);
  const parsed = DateTime.fromISO((input ?? "").trim(), zone ? { zone } : {});
  if (parsed.isValid) return iso(parsed);

  throw new Error(`Could not parse time: "${input}"`);
}

/** Parse a duration to whole minutes. Forms: "2h", "90m", "1h30m", "1.5h", "45", bare = minutes. */
export function parseDurationMin(input: string): number {
  const raw = input.trim().toLowerCase();
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    matched = true;
    const n = parseFloat(m[1]);
    total += m[2].startsWith("h") ? n * 60 : n;
  }
  if (!matched) {
    const bare = raw.match(/^(\d+(?:\.\d+)?)$/);
    if (bare) return Math.round(parseFloat(bare[1]));
    throw new Error(`Could not parse duration: "${input}"`);
  }
  return Math.round(total);
}

/** Minutes between two ISO instants. */
export function minutesBetween(startISO: string, endISO: string): number {
  const a = DateTime.fromISO(startISO);
  const b = DateTime.fromISO(endISO);
  return b.diff(a, "minutes").minutes;
}

/** Human-format minutes: 110 -> "1h50m", 45 -> "45m", 120 -> "2h". */
export function formatMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}
