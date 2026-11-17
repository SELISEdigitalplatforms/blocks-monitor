// Short-lived answers of the billing views that every open screen asks again and again: billing.summary (the credit
// pill, the usage pills, the usage card, the account menu: per organization), billing.usage.report (Usage & costs and
// the Platform overview: per period and grouping) and billing.balances.list (Credits & coupons). Each one reads every
// credit entry of its organization, period or the platform, so a repeat within the window is answered from here
// instead of the Data Gateway. The window (5 s) is half the fastest pace the screens read at (10 s while an engine job
// runs, src/blocks/billing/usage.ts): it joins the surfaces, tabs and people that ask at the same moment, and never
// holds an answer longer than the screens' own refresh.
//
// Correctness:
//   - only the computed answer is kept, and only after the caller's own access check passed (the handler checks
//     membership or the platform permission first, every time): a cached answer is never handed to someone who may
//     not read it;
//   - any billing write (a credit or usage entry, a coupon, a purchase request, a plan or subscription change) drops
//     what it can affect before it answers, and a read that was in flight during the write never fills the cache;
//   - writes made by another process (the engine host charging a job's usage as each lane ends) are seen when the
//     window ends: at most 5 s, within the pace those screens read at anyway (docs/FRESHNESS.md);
//   - entries are bounded (oldest dropped first) and copied out, so a caller can never change the held answer.

import type { PlanView } from "../../../src/domain/billing";

/** The window of every usage view: half the 10 s the screens read at while an engine job runs. */
export const USAGE_VIEW_CACHE_MS = 5_000;
export const SUMMARY_CACHE_MS = USAGE_VIEW_CACHE_MS;
export const USAGE_REPORT_CACHE_MS = USAGE_VIEW_CACHE_MS;
/** billing.balances.list (Credits & coupons, the paywall card: every organization's balance from every entry). */
export const BALANCES_CACHE_MS = USAGE_VIEW_CACHE_MS;
const MAX_ENTRIES = 500;

export interface ReadCache<V> {
  /** The held answer when younger than the window, else `load()` (one load per key at a time; it fills the cache only
   *  when no write dropped the key meanwhile). */
  read(key: string, load: () => Promise<V>, keep?: (v: V) => boolean): Promise<V>;
  /** Drops one key, or every key that starts with `prefix` when it ends with "*". */
  drop(key: string): void;
  clear(): void;
  size(): number;
}

const copy = <T>(x: T): T => (typeof structuredClone === "function" ? structuredClone(x) : (JSON.parse(JSON.stringify(x)) as T));

export function createReadCache<V>(o: { ttlMs: number; now?: () => number; max?: number }): ReadCache<V> {
  const now = o.now ?? (() => Date.now());
  const max = o.max ?? MAX_ENTRIES;
  const held = new Map<string, { v: V; at: number }>();
  const pending = new Map<string, Promise<V>>();
  // A load fills the cache only when its key was not dropped since it started: clear() bumps the epoch, drop(key) the
  // key's own count.
  let epoch = 0;
  const drops = new Map<string, number>();
  const stamp = (key: string): string => `${epoch}:${drops.get(key) ?? 0}`;

  const dropOne = (key: string): void => {
    held.delete(key);
    if (pending.delete(key) || drops.has(key)) drops.set(key, (drops.get(key) ?? 0) + 1);
  };

  return {
    async read(key, load, keep = () => true) {
      const hit = held.get(key);
      if (hit && now() - hit.at < o.ttlMs) return copy(hit.v);
      const inflight = pending.get(key);
      if (inflight) return inflight.then(copy);
      const started = stamp(key);
      // a key with a load in flight is tracked, so a drop meanwhile is seen when the load ends
      if (!drops.has(key)) drops.set(key, 0);
      const p = load().then((v) => {
        if (stamp(key) === started && keep(v)) {
          held.delete(key);
          held.set(key, { v: copy(v), at: now() });
          while (held.size > max) {
            const oldest = held.keys().next().value;
            if (oldest === undefined) break;
            held.delete(oldest);
          }
        }
        return v;
      });
      pending.set(key, p);
      const done = (): void => {
        if (pending.get(key) === p) pending.delete(key);
        if (!pending.has(key) && drops.get(key) === 0) drops.delete(key);
      };
      p.then(done, done);
      return p.then(copy);
    },
    drop(key) {
      if (key === "*") return this.clear();
      if (!key.endsWith("*")) return dropOne(key);
      const prefix = key.slice(0, -1);
      for (const k of new Set([...held.keys(), ...pending.keys()])) if (k.startsWith(prefix)) dropOne(k);
    },
    clear() {
      epoch += 1;
      held.clear();
      pending.clear();
    },
    size: () => held.size,
  };
}

/** billing.summary per organization (key: the workspace id). */
export const summaryCache = createReadCache<unknown>({ ttlMs: SUMMARY_CACHE_MS });
/** billing.usage.report per period and grouping (key: usageReportKey). */
export const usageReportCache = createReadCache<unknown>({ ttlMs: USAGE_REPORT_CACHE_MS });
/** billing.balances.list (one key: "all"). A new or renamed organization shows when the window ends. */
export const balancesCache = createReadCache<unknown>({ ttlMs: BALANCES_CACHE_MS });

/** The Blocks Utilities plan catalogue (billing.source "blocks-utilities"; one key: "plans"). A plan written here drops
 *  it at once; one changed in the Utilities console shows when the window ends. */
export const CATALOGUE_CACHE_MS = 30_000;
export const catalogueCache = createReadCache<PlanView[]>({ ttlMs: CATALOGUE_CACHE_MS });

/** How far from the server's clock a period's end may be and still count as "now" (a browser's clock and the request's
 *  way here differ by a few seconds; the answer itself is still never older than USAGE_REPORT_CACHE_MS). */
export const REPORT_NOW_MS = 60_000;

/** The report's cache key. A period that ends "now" (within REPORT_NOW_MS either side: the overview asks up to the
 *  present moment, a new instant every time) is one key per start and grouping, so those repeats share one answer. */
export function usageReportKey(fromIso: string, toIso: string, groupBy: string, nowMs: number): string {
  const to = Date.parse(toIso);
  const end = Math.abs(to - nowMs) < REPORT_NOW_MS ? "now" : toIso;
  return `${fromIso}|${end}|${groupBy}`;
}

/** A billing write happened: the summaries it can affect (one organization's, or all without one) and every usage
 *  report are read afresh next time. */
export function noteBillingWrite(workspaceId?: string | null): void {
  if (workspaceId) summaryCache.drop(workspaceId);
  else {
    summaryCache.clear();
    catalogueCache.clear();
  }
  usageReportCache.clear();
  balancesCache.clear();
}
