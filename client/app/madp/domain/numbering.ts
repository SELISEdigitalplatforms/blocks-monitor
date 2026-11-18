/**
 * Pure helpers for gap-tolerant record numbers (ticket, change request, item
 * version, release version). Server functions use them as "read max, then
 * insert max+1 behind a real compound unique index, retry on a duplicate key".
 * No imports: this file must bundle into the Logic Functions unchanged.
 */

/** Next record number: the largest positive safe integer plus one, or 1 when there is none. */
export function nextNumber(existing: Iterable<number | null | undefined>): number {
  let max = 0;
  for (const v of existing) {
    if (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v > max) max = v;
  }
  return max + 1;
}

/** Thrown when every insert attempt hit a duplicate key. */
export class NumberingConflictError extends Error {
  readonly code = "conflict";
  readonly attempts: number;
  constructor(attempts: number) {
    super(`Could not allocate a record number after ${attempts} attempts`);
    this.name = "NumberingConflictError";
    this.attempts = attempts;
  }
}

/**
 * Allocates max+1 and inserts it. A duplicate-key error triggers a retry with a
 * fresh `readMax`; any other error is rethrown at once. No timers: the caller
 * decides any delay. `maxAttempts` defaults to 5 and must be 1-20.
 */
export async function insertWithNextNumber<T>(opts: {
  readMax: () => Promise<number | null>;
  insert: (n: number) => Promise<T>;
  isDuplicateKey: (e: unknown) => boolean;
  maxAttempts?: number;
}): Promise<{ number: number; value: T; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new RangeError("maxAttempts must be an integer from 1 to 20");
  }
  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    const n = ((await opts.readMax()) ?? 0) + 1;
    try {
      const value = await opts.insert(n);
      return { number: n, value, attempts };
    } catch (e) {
      if (!opts.isDuplicateKey(e)) throw e;
    }
  }
  throw new NumberingConflictError(maxAttempts);
}

function isPositiveInt(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

/** Formats a prefixed number, e.g. ("T", 12) gives "T-12". */
export function formatNumber(prefix: string, n: number): string {
  if (typeof prefix !== "string" || !/^[A-Z]{1,4}$/.test(prefix)) {
    throw new TypeError("prefix must be 1-4 capital letters");
  }
  if (!isPositiveInt(n)) throw new TypeError("n must be a positive integer");
  return `${prefix}-${n}`;
}

/** Item version label, e.g. 3 gives "v3". */
export function itemVersionLabel(n: number): string {
  if (!isPositiveInt(n)) throw new TypeError("n must be a positive integer");
  return `v${n}`;
}

/** Parses "v3" or "V3" to 3; anything else gives null. */
export function parseItemVersionLabel(label: string): number | null {
  if (typeof label !== "string") return null;
  const m = /^[vV]([1-9][0-9]*)$/.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/** Semantic version parts. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parses "1.2.3" or "v1.2.3" (no leading zeros); anything else gives null. */
export function parseVersion(s: string): SemVer | null {
  if (typeof s !== "string") return null;
  const m = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(s);
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

/** Formats a version as "1.2.3". */
export function formatVersion(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function mustParse(s: string): SemVer {
  const v = parseVersion(s);
  if (!v) throw new TypeError(`Invalid version: ${String(s)}`);
  return v;
}

/** Version label, e.g. "1.2.3" gives "v1.2.3"; throws on invalid input. */
export function versionLabel(s: string): string {
  return `v${formatVersion(mustParse(s))}`;
}

/** Negative, 0 or positive like a sort comparator; throws on invalid input. */
export function compareVersions(a: string, b: string): number {
  const x = mustParse(a);
  const y = mustParse(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/** Next release version: null gives "1.0.0"; major resets minor and patch, minor resets patch. */
export function bumpVersion(prev: string | null, kind: "major" | "minor" | "patch"): string {
  if (prev === null) return "1.0.0";
  const v = mustParse(prev);
  if (kind === "major") return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
  if (kind === "minor") return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
  return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1 });
}
