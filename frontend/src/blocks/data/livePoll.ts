// One clock for every list that follows live work (the Board, Build, Queue and Release pages, the job lists of every
// step). A list says how it follows live work in its query options (meta.live); this clock, not each component,
// decides when it is read again:
//   - one read per list per tick, however many components show it (the cache key is the unit, never the component);
//   - every list due on a tick is asked in the same turn, so the data transport sends them as ONE POST /api/data;
//   - how often follows what the records say: fast while a job runs, slower while a person is asked to act elsewhere
//     (a pending approval), slowest when nothing happens; settings that change only by someone's own action (approval
//     policies, feature names) are never on the clock: the action that changes them, the bell and a return to the tab
//     read them again;
//   - nothing is read while the tab is hidden; coming back reads what is due at once;
//   - after the server's 429 or 503 nothing is asked until its pause is over (the transport's back-off).
// A screen that must follow one record closely for a while (a change request whose analysis or build runs) holds a
// boost on its keys: they are read on every fast tick while it is held. A read that needs its own pace for a while (the
// scope's outputs while a scope job runs, a project being set up) says so with `every`: still one read per key, on the
// same ticks, in the same request.
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { partialMatchKey } from "@tanstack/react-query";
import { queryClient } from "../queryClient";
import { dataPausedUntil } from "./transport";

/** How a list follows live work: "jobs" (the engine job list: its own data says whether work runs), "work" (what a
 *  running job writes as it goes: tickets and their moves) and "records" (what changes when a job ends or a person
 *  acts: change requests, milestones, previews, releases, approval requests). */
export type LiveClass = "jobs" | "work" | "records";

/** What the lists on screen say: a job runs, a person is asked to act elsewhere (a pending approval), or neither. */
export type LiveMode = "running" | "waiting" | "idle";

/** meta.live of a query's options: the class it follows (or `every`: its own pace in ms, whatever the mode), and
 *  `busy`, which reads the list's own data for the mode (a job list: running; the approval requests: waiting). */
export interface LiveMeta {
  follows?: LiveClass;
  every?: number;
  busy?: (data: unknown) => LiveMode | null;
}

/** How long a list is left before it is read again, by mode (null: not on the clock in that mode). */
export const LIVE_MS: Readonly<Record<LiveClass, Readonly<Record<LiveMode, number | null>>>> = {
  jobs: { running: 5_000, waiting: 60_000, idle: 60_000 },
  work: { running: 10_000, waiting: null, idle: null },
  records: { running: 30_000, waiting: 30_000, idle: 120_000 },
};

/** A boosted key is read on every fast tick. */
export const BOOST_MS = LIVE_MS.jobs.running!;

/** A list read this much before its time is due on the tick anyway (half the fastest tick): reads that came back a
 *  moment late keep to the same ticks instead of slipping one tick each time. */
export const DUE_SLACK_MS = 2_500;

/** Ticks come up to 10 % of the fastest interval late, at random, so open tabs and people do not ask in step. */
export const TICK_JITTER = 0.1;

/** Never two ticks closer than this. */
export const MIN_TICK_MS = 1_000;

export interface LivePollerDeps {
  client: QueryClient;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
  /** True while the tab is hidden. */
  hidden?: () => boolean;
  /** Calls back when the tab is shown again; returns the unsubscribe. */
  onVisible?: (fn: () => void) => () => void;
  /** Until when the read path pauses after a 429 or 503 (epoch ms). */
  pausedUntil?: () => number;
}

export interface LivePoller {
  /** Follows the cache (idempotent). */
  start(): void;
  stop(): void;
  /** Reads the given keys (prefixes) on every fast tick until the returned release is called. */
  boost(keys: readonly QueryKey[]): () => void;
  /** What the lists on screen say now. */
  mode(): LiveMode;
  /** One tick now (tests). */
  tick(): void;
}

const isLiveMeta = (m: unknown): m is LiveMeta => {
  if (typeof m !== "object" || m === null) return false;
  const { follows, every } = m as { follows?: unknown; every?: unknown };
  return (typeof follows === "string" && Object.prototype.hasOwnProperty.call(LIVE_MS, follows))
    || (typeof every === "number" && Number.isFinite(every) && every > 0);
};

/** The live meta of a query, or null. */
export function liveMetaOf(q: Pick<Query, "options">): LiveMeta | null {
  const m = (q.options as { meta?: unknown } | undefined)?.meta;
  const live = typeof m === "object" && m !== null ? (m as { live?: unknown }).live : undefined;
  return isLiveMeta(live) ? live : null;
}

/** Query options meta for a live list. */
export function liveMeta(follows: LiveClass, busy?: LiveMeta["busy"]): { live: LiveMeta } {
  return { live: busy ? { follows, busy } : { follows } };
}

/** Query options meta for a read at its own pace (ms) on the live clock; none for `false` (not on the clock now). */
export function liveEvery(ms: number | false): { live: LiveMeta } | undefined {
  return ms ? { live: { every: ms } } : undefined;
}

export function createLivePoller(d: LivePollerDeps): LivePoller {
  const now = d.now ?? (() => Date.now());
  const setTimer = d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const random = d.random ?? (() => Math.random());
  const hidden = d.hidden ?? (() => false);
  const pausedUntil = d.pausedUntil ?? (() => 0);
  const boosts = new Map<number, readonly QueryKey[]>();
  let nextBoost = 0;
  let timer: unknown = null;
  let dueAt = Infinity;
  let asleep = false;
  let current: LiveMode = "idle";
  let unsubscribeCache: (() => void) | null = null;
  let unsubscribeVisible: (() => void) | null = null;

  const boosted = (q: Query): boolean => {
    for (const keys of boosts.values()) for (const k of keys) if (partialMatchKey(q.queryKey, k)) return true;
    return false;
  };

  /** The lists on screen that follow live work (a list nobody shows, or a disabled one, is never read by the clock). */
  const onScreen = (): Query[] => d.client.getQueryCache().getAll().filter((q) => q.isActive() && (liveMetaOf(q) !== null || boosted(q)));

  const modeOf = (qs: readonly Query[]): LiveMode => {
    let m: LiveMode = "idle";
    for (const q of qs) {
      const b = liveMetaOf(q)?.busy?.(q.state.data) ?? null;
      if (b === "running") return "running";
      if (b === "waiting") m = "waiting";
    }
    return m;
  };

  const intervalOf = (q: Query, mode: LiveMode): number | null => {
    if (boosted(q)) return BOOST_MS;
    const meta = liveMetaOf(q);
    if (!meta) return null;
    return meta.every ?? (meta.follows ? LIVE_MS[meta.follows][mode] : null);
  };

  const clear = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    dueAt = Infinity;
  };

  /** Arms the clock for the next tick, only ever earlier than it is armed already: when the first list on screen is due
   *  (its last read plus its interval), a little later at random so open tabs do not ask in step. */
  const plan = (): void => {
    if (!unsubscribeCache || asleep) return;
    const qs = onScreen();
    current = modeOf(qs);
    const t = now();
    let next = Infinity;
    let fastest = Infinity;
    for (const q of qs) {
      const iv = intervalOf(q, current);
      if (iv === null) continue;
      fastest = Math.min(fastest, iv);
      // a list being read now is due an interval from now at the earliest
      const from = q.state.fetchStatus === "idle" ? Math.max(q.state.dataUpdatedAt, q.state.errorUpdatedAt) : t;
      next = Math.min(next, from + iv);
    }
    if (next === Infinity) return clear();
    // during the server's pause: right when it ends (the pause has its own jitter), with the reads the pause held back
    const paused = pausedUntil() - t;
    const wait = paused >= next - t && paused > 0 ? paused : Math.max(MIN_TICK_MS, next - t) + Math.round(random() * TICK_JITTER * fastest);
    if (timer !== null && dueAt <= t + wait) return;
    clear();
    dueAt = t + wait;
    timer = setTimer(tick, wait);
  };

  function tick(): void {
    timer = null;
    dueAt = Infinity;
    if (!unsubscribeCache) return;
    if (hidden()) {
      asleep = true;
      return;
    }
    const t = now();
    if (pausedUntil() > t) return plan();
    const qs = onScreen();
    current = modeOf(qs);
    const due = new Set<Query>();
    for (const q of qs) {
      const iv = intervalOf(q, current);
      if (iv === null || q.state.fetchStatus !== "idle") continue;
      const last = Math.max(q.state.dataUpdatedAt, q.state.errorUpdatedAt);
      if (t - last >= iv - DUE_SLACK_MS) due.add(q);
    }
    // every due list in the same turn: the transport sends them as one request
    if (due.size > 0) void d.client.refetchQueries({ predicate: (q) => due.has(q) }, { cancelRefetch: false });
    plan();
  }

  /** The cache's events come in bursts (every render sets each observer's options again): one plan per burst. */
  let planQueued = false;
  const planSoon = (): void => {
    if (planQueued) return;
    planQueued = true;
    queueMicrotask(() => {
      planQueued = false;
      plan();
    });
  };

  const wake = (): void => {
    if (!asleep) return;
    asleep = false;
    clear();
    // after the cache's own refetch on focus, in the next turn: its reads and these leave together
    timer = setTimer(tick, 0);
    dueAt = now();
  };

  return {
    start() {
      if (unsubscribeCache) return;
      unsubscribeCache = d.client.getQueryCache().subscribe((e) => {
        if (e.type === "observerAdded" || e.type === "observerOptionsUpdated" || (e.type === "updated" && e.action.type === "success")) planSoon();
      });
      unsubscribeVisible = d.onVisible?.(wake) ?? null;
      plan();
    },
    stop() {
      unsubscribeCache?.();
      unsubscribeVisible?.();
      unsubscribeCache = unsubscribeVisible = null;
      asleep = false;
      clear();
    },
    boost(keys) {
      const id = nextBoost++;
      boosts.set(id, [...keys]);
      plan();
      return () => {
        boosts.delete(id);
      };
    },
    mode: () => current,
    tick,
  };
}

const documentHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

function onDocumentVisible(fn: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const listener = () => {
    if (document.visibilityState !== "hidden") fn();
  };
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/** The app's clock over the app's data cache. */
export const livePoller = createLivePoller({
  client: queryClient,
  hidden: documentHidden,
  onVisible: onDocumentVisible,
  pausedUntil: dataPausedUntil,
});
livePoller.start();
