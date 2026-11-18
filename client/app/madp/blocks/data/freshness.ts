// Which reads were last answered stale (the server's cached copy while Blocks is slow): drives the "Refreshing…" hint
// and re-asks the active queries a few times (2 s, 5 s, 10 s) so the screen catches up once Blocks answers again.
import { useSyncExternalStore } from "react";
import { queryClient } from "../queryClient";

export const STALE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

const staleKeys = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

export function isDataRefreshing(): boolean {
  return staleKeys.size > 0;
}

export function subscribeFreshness(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule(): void {
  if (timer !== null || staleKeys.size === 0 || attempts >= STALE_RETRY_DELAYS_MS.length) return;
  timer = setTimeout(() => {
    timer = null;
    attempts++;
    void queryClient.invalidateQueries({ refetchType: "active" }, { cancelRefetch: false });
    schedule();
  }, STALE_RETRY_DELAYS_MS[attempts]);
}

export function noteReadFreshness(readKey: string, stale: boolean): void {
  const before = isDataRefreshing();
  if (stale && attempts < STALE_RETRY_DELAYS_MS.length) staleKeys.add(readKey);
  else staleKeys.delete(readKey);
  if (staleKeys.size === 0) {
    clearTimer();
    attempts = 0;
  } else schedule();
  if (isDataRefreshing() !== before) [...listeners].forEach((l) => l());
}

export function useDataRefreshing(): boolean {
  return useSyncExternalStore(subscribeFreshness, isDataRefreshing, () => false);
}

export function resetFreshness(): void {
  clearTimer();
  staleKeys.clear();
  attempts = 0;
  listeners.clear();
}

// ---------------------------------------------------------------- freshness tiers
// How fresh each kind of data has to be, and so how often a screen reads it again (docs/FRESHNESS.md has the table):
//   live  — what someone watches move: the engine host card. Every 30 s while something runs (the engine's heartbeat
//           is 30 s, so faster reads show nothing new), every 60 s when nothing runs.
//   usage — what the agents' work has cost: tokens, credit used and left, agents working (the credit pill, the usage pill
//           of Build and the 3D office, Plan and usage, the platform's usage, overview and credit pages). Every 10 s
//           while an engine job runs (a lane's usage is written when the lane ends; the server keeps the answer 5 s),
//           every 60 s when nothing runs; a job that starts or ends is read at once (src/blocks/billing/usage.ts).
//   near  — figures that follow work with a short lag: overview tiles, AI accounts, purchase requests.
//           Every 60 s, every 120 s when the data says nothing runs.
//   calm  — what changes only when someone edits it: plans, coupons, settings, roles, organization lists. Every 5 min
//           (the edit itself refreshes the screen at once through the mutation's invalidation).
//   batch — what is produced, not watched: engine sample history, generated outputs, documents. Every 30 min, or
//           when the job that produces it ends (its completion invalidates the read).
// Every tier stops while the tab is hidden (a read is due again when the tab is shown and the data is older than
// the focus window) and backs off after failed reads: the interval doubles with each failure in a row (a 429 or a
// busy host answers as a failure), up to FRESHNESS_BACKOFF_MAX_MS, and returns to its pace with the next answer.

export type FreshnessTier = "live" | "usage" | "near" | "calm" | "batch";

/** The read-again interval of each tier: `busy` while something runs (or the caller cannot tell), `idle` otherwise. */
export const FRESHNESS_MS: Readonly<Record<FreshnessTier, Readonly<{ busy: number; idle: number }>>> = {
  live: { busy: 30_000, idle: 60_000 },
  usage: { busy: 10_000, idle: 60_000 },
  near: { busy: 60_000, idle: 120_000 },
  calm: { busy: 5 * 60_000, idle: 5 * 60_000 },
  batch: { busy: 30 * 60_000, idle: 30 * 60_000 },
};

/** The longest pause after failed reads (a tier slower than this keeps its own pace). */
export const FRESHNESS_BACKOFF_MAX_MS = 10 * 60_000;

/** What the interval function sees of a query (react-query's Query has these). */
export interface FreshnessQueryView<TData> {
  state: { data: TData | undefined; dataUpdatedAt: number; errorUpdatedAt: number; errorUpdateCount: number };
}

export interface FreshnessOptions<TData> {
  /** Whether something runs, from the data on screen (true: the tier's busy pace; false: its idle pace). Default true. */
  busy?: boolean | ((data: TData | undefined) => boolean);
}

/** The failures in a row each query has had: the errorUpdateCount at its last answer. */
const answeredAt = new WeakMap<object, number>();

/** Failed reads in a row of a query (0 after an answer). */
export function failuresInARow<TData>(q: FreshnessQueryView<TData>): number {
  const s = q.state;
  const failedLast = s.errorUpdateCount > 0 && s.errorUpdatedAt > s.dataUpdatedAt;
  if (!failedLast) {
    answeredAt.set(q, s.errorUpdateCount);
    return 0;
  }
  return Math.max(1, s.errorUpdateCount - (answeredAt.get(q) ?? 0));
}

/** The interval for a tier: its pace by `busy`, doubled per failure in a row up to the back-off cap. */
export function freshnessInterval(tier: FreshnessTier, busy: boolean, failures: number): number {
  const base = busy ? FRESHNESS_MS[tier].busy : FRESHNESS_MS[tier].idle;
  if (failures <= 0) return base;
  return Math.max(base, Math.min(FRESHNESS_BACKOFF_MAX_MS, base * 2 ** Math.min(failures, 10)));
}

/** Query options for a read at a tier's pace: spread into useQuery ({ queryKey, queryFn, ...freshnessQuery("near") }). */
export function freshnessQuery<TData = unknown>(tier: FreshnessTier, o: FreshnessOptions<TData> = {}) {
  const busyOf = (data: TData | undefined): boolean => (typeof o.busy === "function" ? o.busy(data) : o.busy ?? true);
  return {
    /** Half the pace: a screen opened again within it shows the cached answer without a read. */
    staleTime: tier === "batch" ? FRESHNESS_MS.batch.busy : FRESHNESS_MS[tier].busy / 2,
    refetchInterval: (q: FreshnessQueryView<TData>): number => freshnessInterval(tier, busyOf(q.state.data), failuresInARow(q)),
    /** Never while the tab is hidden. */
    refetchIntervalInBackground: false,
  } as const;
}
