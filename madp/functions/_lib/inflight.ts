// Requests that share (function, caller, requestId) share one run. A save that passes the router's soft deadline still
// lands in the background; its retry joins that run and gets its outcome instead of running the handler again.
import { OpError } from "./errors";
import { DETERMINISTIC_REFUSALS } from "./operation";

export type InflightOutcome = { ok: true; data: unknown } | { ok: false; error: OpError };

export interface InflightRegistry {
  join(
    key: string,
    op: string,
  ):
    | { first: true; settle(o: InflightOutcome, keep?: boolean): void; track(o: { deadlineAt: number; pending: () => number }): void }
    | { first: false; sameOp: boolean; stale: boolean; outcome: Promise<InflightOutcome> };
  /** Drops the run under `key` when it is stale (past its deadline, nothing in flight) and answers its waiters with a timeout. */
  abandon(key: string): boolean;
}

interface Entry {
  op: string;
  createdAt: number;
  settledAt: number | null;
  outcome: Promise<InflightOutcome>;
  resolve: (o: InflightOutcome) => void;
  deadlineAt: number | null;
  pending: (() => number) | null;
}


export function createInflight(o: { ttlMs?: number; maxEntries?: number; maxPendingMs?: number; now?: () => number } = {}): InflightRegistry {
  const ttlMs = o.ttlMs ?? 120_000;
  const maxEntries = o.maxEntries ?? 2000;
  const maxPendingMs = o.maxPendingMs ?? 300_000;
  const now = o.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const sweep = (): void => {
    const t = now();
    for (const [key, e] of entries) {
      if (e.settledAt !== null) {
        if (t - e.settledAt >= ttlMs) entries.delete(key);
      } else if (t - e.createdAt >= maxPendingMs) {
        entries.delete(key);
        e.resolve({ ok: false, error: new OpError("timeout") });
      }
    }
    if (entries.size > maxEntries) {
      for (const [key, e] of entries) {
        if (entries.size <= maxEntries) break;
        if (e.settledAt !== null) entries.delete(key);
      }
    }
  };

  const isStale = (e: Entry): boolean => e.settledAt === null && e.deadlineAt !== null && e.pending !== null && now() >= e.deadlineAt && e.pending() === 0;

  return {
    abandon(key) {
      const e = entries.get(key);
      if (!e || !isStale(e)) return false;
      entries.delete(key);
      e.settledAt = now();
      e.resolve({ ok: false, error: new OpError("timeout") });
      return true;
    },
    join(key, op) {
      sweep();
      const existing = entries.get(key);
      if (existing) return { first: false, sameOp: existing.op === op, stale: isStale(existing), outcome: existing.outcome };
      let resolve: (x: InflightOutcome) => void = () => undefined;
      const outcome = new Promise<InflightOutcome>((res) => {
        resolve = res;
      });
      const entry: Entry = { op, createdAt: now(), settledAt: null, outcome, resolve, deadlineAt: null, pending: null };
      entries.set(key, entry);
      return {
        first: true,
        track(t) {
          entry.deadlineAt = t.deadlineAt;
          entry.pending = t.pending;
        },
        settle(out, keep = true) {
          if (entry.settledAt !== null) return;
          entry.settledAt = now();
          // An answer that is not stored (record() said false) is shared with callers already waiting, never replayed later.
          if (!keep && entries.get(key) === entry) entries.delete(key);
          // A failure a retry could get past is not kept: the next request runs the handler for real.
          if (!out.ok && !DETERMINISTIC_REFUSALS.includes(out.error.code) && entries.get(key) === entry) entries.delete(key);
          resolve(out);
        },
      };
    },
  };
}

export const processInflight: InflightRegistry = createInflight();
