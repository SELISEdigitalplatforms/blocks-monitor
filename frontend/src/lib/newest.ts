/** Newest first, everywhere (the owner's rule, 11.11.2026): every list people see is ordered by its most meaningful
 *  recency, the newest on top: an item's last activity or update when that is what the list is about (projects by their
 *  latest activity, releases by release time), otherwise its creation time. One helper for every list, so the rule reads
 *  the same everywhere. Lists with a meaningful fixed order keep it and do not use this: board columns and the tickets
 *  inside a column (SortOrder), steps and phases, plan steps, conversations read top-down, numbered sequences.
 *  Pure: no React, DOM or store imports. */

/** A date as the records carry it: an ISO text, epoch milliseconds or a Date; empty or missing when unknown. */
export type DateLike = string | number | Date | null | undefined;

/** A date's epoch milliseconds; NaN when it is missing or not a date. */
export function timeOf(value: DateLike): number {
  if (value === null || value === undefined || value === "") return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/** The latest of several dates (an item's last activity), as epoch milliseconds; NaN when none is a date. */
export function latestTime(...values: readonly DateLike[]): number {
  let out = Number.NaN;
  for (const v of values) {
    const t = timeOf(v);
    if (!Number.isNaN(t) && (Number.isNaN(out) || t > out)) out = t;
  }
  return out;
}

/** The tie-break of two items with the same time: higher first (a higher number is the later one). */
export type TieBreak<T> = (item: T) => number | string | null | undefined;

function compareTie(a: number | string | null | undefined, b: number | string | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return b - a;
  const x = String(a);
  const y = String(b);
  return x < y ? 1 : x > y ? -1 : 0;
}

/** A comparator, newest first: the later date first; an item without a date after every dated one; the same time broken
 *  by `tie`, higher first (e.g. the number); otherwise equal, so a sort keeps their order (Array.prototype.sort is stable). */
export function compareNewest<T>(dateOf: (item: T) => DateLike, tie?: TieBreak<T>): (a: T, b: T) => number {
  return (a, b) => {
    const x = timeOf(dateOf(a));
    const y = timeOf(dateOf(b));
    const xs = !Number.isNaN(x);
    const ys = !Number.isNaN(y);
    if (xs && ys && x !== y) return y - x;
    if (xs !== ys) return xs ? -1 : 1;
    return tie ? compareTie(tie(a), tie(b)) : 0;
  };
}

/** A copy of the items, newest first (compareNewest); the input is never changed. Each item's date is read once. */
export function byNewest<T>(items: readonly T[], dateOf: (item: T) => DateLike, tie?: TieBreak<T>): T[] {
  const keyed = items.map((item, i) => ({ item, i, at: timeOf(dateOf(item)), tie: tie ? tie(item) : undefined }));
  keyed.sort((a, b) => {
    const xs = !Number.isNaN(a.at);
    const ys = !Number.isNaN(b.at);
    if (xs && ys && a.at !== b.at) return b.at - a.at;
    if (xs !== ys) return xs ? -1 : 1;
    return (tie ? compareTie(a.tie, b.tie) : 0) || a.i - b.i;
  });
  return keyed.map((k) => k.item);
}

/** Oldest first, only for logic that reads records in time order (a timeline, a ticket's path through the columns),
 *  never for a list people read: the earlier date first, an item without a date last, the same time by `tie` ascending,
 *  else in the given order. */
export function byOldest<T>(items: readonly T[], dateOf: (item: T) => DateLike, tie?: TieBreak<T>): T[] {
  const keyed = items.map((item, i) => ({ item, i, at: timeOf(dateOf(item)), tie: tie ? tie(item) : undefined }));
  keyed.sort((a, b) => {
    const xs = !Number.isNaN(a.at);
    const ys = !Number.isNaN(b.at);
    if (xs && ys && a.at !== b.at) return a.at - b.at;
    if (xs !== ys) return xs ? -1 : 1;
    return (tie ? compareTie(b.tie, a.tie) : 0) || a.i - b.i;
  });
  return keyed.map((k) => k.item);
}

/** A numbered list newest first, for records numbered as they are created (CR-007 after CR-006, D3 after D2): the
 *  number is their creation order, so the highest is on top. */
export function byNewestNumber<T>(items: readonly T[], numberOf: (item: T) => number): T[] {
  return byNewest(items, () => null, numberOf);
}
