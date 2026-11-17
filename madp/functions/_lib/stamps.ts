// Optimistic-concurrency stamps without a read-back: the date an op issues is the date it expects to find later.

/** The LastUpdatedDate an op writes as its own stamp. */
export function issuedStamp(now: Date): string {
  return now.toISOString();
}

/** The platform stamps LastUpdatedDate itself a little after the write: the caller's own write may land up to this much later (or earlier, clock skew). */
const SKEW_BEFORE_MS = 5_000;
const SKEW_AFTER_MS = 30_000;

/** True when the stored row is the one the caller saw: the same stamp, or the caller's own write a moment later. */
export function isFreshStamp(i: {
  expected: string;
  stored: { LastUpdatedDate?: unknown; UpdatedByUserId?: unknown };
  callerUserId: string;
}): boolean {
  const { expected, stored } = i;
  if (expected === stored.LastUpdatedDate) return true;
  if (stored.UpdatedByUserId !== i.callerUserId) return false;
  if (typeof stored.LastUpdatedDate !== "string") return false;
  const was = Date.parse(expected);
  const now = Date.parse(stored.LastUpdatedDate);
  if (!Number.isFinite(was) || !Number.isFinite(now)) return false;
  const diff = now - was;
  return diff >= -SKEW_BEFORE_MS && diff <= SKEW_AFTER_MS;
}

/** Deep equality for stored values against request values: arrays in order, objects by key (undefined entries ignored), null only equals null. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameValue(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && sameValue(ao[k], bo[k]));
}

/**
 * True when a version conflict is really the caller's own earlier save that landed after the client gave up: the row was
 * last written by the same user and already holds the request's values (or carries the request's RequestKey chain).
 */
export function isOwnLandedWrite(i: {
  stored: Record<string, unknown>;
  callerUserId: string;
  values?: Record<string, unknown>;
  requestKey?: string;
  /** The stamp the caller holds: one older than the row itself cannot be a version of it. */
  expected?: string;
}): boolean {
  const { stored, callerUserId } = i;
  if (callerUserId === "") return false;
  if (i.expected !== undefined && typeof stored.CreatedDate === "string") {
    const was = Date.parse(i.expected);
    const born = Date.parse(stored.CreatedDate);
    if (Number.isFinite(was) && Number.isFinite(born) && was < born) return false;
  }
  const writer = typeof stored.UpdatedByUserId === "string" && stored.UpdatedByUserId !== "" ? stored.UpdatedByUserId : stored.CreatedByUserId;
  if (writer !== callerUserId) return false;
  const defined = Object.entries(i.values ?? {}).filter(([, val]) => val !== undefined);
  if (defined.length > 0 && defined.every(([k, val]) => stored[k] !== undefined && sameValue(stored[k], val))) return true;
  return !!i.requestKey && i.requestKey === stored.RequestKey && stored.CreatedByUserId === callerUserId;
}
