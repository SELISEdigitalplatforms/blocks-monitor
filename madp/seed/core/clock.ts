// Seed time: every date is relative to target.now, so the data always looks recent.
//
// A `When` is "-<n>d[@hh:mm][+<k>m|+<k>h]":
//   "-0d@09:15"   day 0 at 09:15 Zurich time (clamped to a few minutes before now). Day 0 is today on a working day
//                 from 07:30, else the previous working day, so a reset at night or at the weekend still looks right
//   "-3d@14:30"   three working days ago (weekends are skipped), 14:30 Zurich time
//   "-3d@14:30+25m" the same plus 25 minutes (engine work that follows a person's action)
//   "-90m", "-5h" minutes / hours before now
// Working days keep people's actions on Monday to Friday whatever day the reset runs.

export type When = string;

const WHEN = /^-(\d+)d(?:@(\d{1,2}):(\d{2}))?(?:\+(\d+)([mh]))?$/;
const AGO = /^-(\d+)([mh])$/;
const MIN = 60_000;

/** Minutes east of UTC that Europe/Zurich has at this instant (60 in winter, 120 in summer). */
function zurichOffsetMin(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((local - Math.floor(utcMs / MIN) * MIN) / MIN);
}

/** The Zurich calendar date (y, m, d) of an instant. */
function zurichDate(utcMs: number): { y: number; m: number; d: number } {
  const local = new Date(utcMs + zurichOffsetMin(utcMs) * MIN);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

export class Clock {
  readonly nowMs: number;
  /** Day 0 (Zurich date): today on a working day from 07:30, else the previous working day (no work at night or at weekends). */
  private readonly day0: { y: number; m: number; d: number };
  constructor(now: Date) {
    this.nowMs = now.getTime();
    const today = zurichDate(this.nowMs);
    const local = new Date(this.nowMs + zurichOffsetMin(this.nowMs) * MIN);
    const wd = new Date(Date.UTC(today.y, today.m, today.d)).getUTCDay();
    const working = wd !== 0 && wd !== 6 && local.getUTCHours() * 60 + local.getUTCMinutes() >= 7 * 60 + 30;
    this.day0 = working ? today : Clock.back(today, 1);
  }

  /** The Zurich date `n` working days before `from` (n = 1 from a weekend day gives the Friday before). */
  private static back(from: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number } {
    let { y, m, d } = from;
    let left = n;
    while (left > 0) {
      const probe = new Date(Date.UTC(y, m, d - 1));
      ({ y, m, d } = { y: probe.getUTCFullYear(), m: probe.getUTCMonth(), d: probe.getUTCDate() });
      const wd = probe.getUTCDay();
      if (wd !== 0 && wd !== 6) left -= 1;
    }
    return { y, m, d };
  }

  /** ISO time of a When, never later than two minutes before now. */
  at(w: When): string {
    return new Date(this.ms(w)).toISOString();
  }

  ms(w: When): number {
    const ago = AGO.exec(w);
    if (ago) return this.nowMs - Number(ago[1]) * (ago[2] === "h" ? 60 : 1) * MIN;
    const m = WHEN.exec(w);
    if (!m) throw new TypeError(`bad seed time "${w}"`);
    // Walk back that many working days from day 0, in Zurich time.
    const { y, m: mo, d } = Clock.back(this.day0, Number(m[1]));
    const hh = m[2] !== undefined ? Number(m[2]) : 10;
    const mm = m[3] !== undefined ? Number(m[3]) : 0;
    const guess = Date.UTC(y, mo, d, hh, mm);
    let utc = guess - zurichOffsetMin(guess) * MIN;
    utc = guess - zurichOffsetMin(utc) * MIN;
    if (m[4] !== undefined) utc += Number(m[4]) * (m[5] === "h" ? 60 : 1) * MIN;
    return Math.min(utc, this.nowMs - 2 * MIN);
  }

  /** An ISO time some minutes after another (clamped to before now). */
  plus(iso: string, minutes: number): string {
    return new Date(Math.min(Date.parse(iso) + minutes * MIN, this.nowMs - MIN)).toISOString();
  }

  /** Minutes between two ISO times. */
  static minutesBetween(a: string, b: string): number {
    return (Date.parse(b) - Date.parse(a)) / MIN;
  }
}
