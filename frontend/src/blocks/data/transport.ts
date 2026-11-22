// The browser's only read path: reads issued in the same tick leave as ONE POST /api/data (same-origin, session cookie).
// The server validates, batches and runs them with the signed-in person's own token; the browser holds no key or gateway URL.
// When the server says "not now" (429, 503) the request fails as a whole and nothing more leaves until the pause it asked
// for (Retry-After) or the back-off is over; the reads asked for meanwhile then leave together.
import type { FilterCondition } from "../../domain/gatewayFilter";
import { recoverUnauthorized } from "../client";
import { toBlocksError } from "./errors";
import { noteReadFreshness } from "./freshness";
import { hostedLoginEnabled } from "../config";

export interface DataRead {
  schema: string;
  fields: string[];
  filter?: FilterCondition[];
  sort?: { field: string; dir: "asc" | "desc" }[];
  pageNo: number;
  pageSize: number;
}

export interface DataPage {
  items: Record<string, unknown>[];
  totalCount: number;
  pageNo: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface DataTransport {
  read(read: DataRead): Promise<DataPage>;
  /** Until when (epoch ms) the server asked the browser to pause (429 or 503); 0 when it did not. Reads asked for
   *  meanwhile wait and leave together once the pause is over. */
  pausedUntil?(): number;
}

export const DATA_ENDPOINT = "/api/data";
export const MAX_READS_PER_REQUEST = 40;

/** The pause after a refused request (429 too many requests, 503 unavailable): its Retry-After when the server sends
 *  one, else 2 s doubling with each refusal in a row up to 60 s; spread by ±20 % so open tabs do not come back in step,
 *  never shorter than the server asked for. One answered request ends the run of refusals. */
export const BACKOFF_FIRST_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
/** A Retry-After longer than this is read as this (a pause is never longer). */
export const RETRY_AFTER_MAX_MS = 120_000;
const PAUSE_STATUSES = new Set([429, 503]);

/** The pause after the n-th refusal in a row (n ≥ 1); `retryAfterS` from the answer's header; `random` in [0, 1). */
export function backoffMs(n: number, retryAfterS: number | null, random: number): number {
  const told = retryAfterS !== null && Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(RETRY_AFTER_MAX_MS, retryAfterS * 1000) : 0;
  const doubled = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, n - 1));
  const base = Math.max(told, doubled);
  return Math.max(told, Math.round(base * (0.8 + 0.4 * random)));
}

/** The Retry-After header in seconds (a number of seconds or an HTTP date), or null. */
function retryAfterOf(res: Response, now: number): number | null {
  const raw = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : null;
}

interface Entry {
  key: string;
  read: DataRead;
  waiters: { resolve: (p: DataPage) => void; reject: (e: unknown) => void }[];
}

type WireResult =
  | ({ ok: true; stale?: boolean } & DataPage)
  | { ok: false; error?: { code?: string; messageKey?: string; retryable?: boolean } };

/** The SDK's error shape, so toBlocksError gives the same kinds and messages as before. */
function apiError(status: number, body: unknown): unknown {
  return toBlocksError(Object.assign(new Error(`HTTP ${status}`), { name: "BlocksApiError", status, body }));
}

export function createDataTransport(o: {
  fetch: typeof fetch;
  schedule?: (fn: () => void) => void;
  onUnauthorized?: () => Promise<string | undefined>;
  onFreshness?: (readKey: string, stale: boolean) => void;
  /** The clock, the timer that ends a pause and the jitter source (tests pass their own). */
  now?: () => number;
  later?: (fn: () => void, ms: number) => void;
  random?: () => number;
}): DataTransport {
  const onFreshness = o.onFreshness ?? noteReadFreshness;
  const schedule = o.schedule ?? ((fn: () => void) => void setTimeout(fn, 0));
  const now = o.now ?? (() => Date.now());
  const later = o.later ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const random = o.random ?? (() => Math.random());
  let queue = new Map<string, Entry>();
  // the server's "not now" (429, 503): refusals in a row, and until when nothing is sent
  let refusals = 0;
  let pauseUntil = 0;
  let resumeArmed = false;

  /** A refused request: pause (its Retry-After, else the doubling back-off with jitter). */
  function pauseAfter(res: Response): void {
    refusals += 1;
    const t = now();
    pauseUntil = Math.max(pauseUntil, t + backoffMs(refusals, retryAfterOf(res, t), random()));
  }

  /** Sends the queue now, or once the pause is over (one timer, however many reads wait); at the end of a pause the
   *  queue waits the usual moment more, so reads asked for right then leave with the ones held back. */
  function flushWhenAllowed(): void {
    const wait = pauseUntil - now();
    if (wait <= 0) return flush();
    if (resumeArmed) return;
    resumeArmed = true;
    later(() => {
      resumeArmed = false;
      schedule(flushWhenAllowed);
    }, wait);
  }

  async function post(reads: DataRead[]): Promise<Response> {
    return o.fetch(DATA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ reads }),
    });
  }

  /** Reads (schema + fields) the server refused as a whole request: a field its catalogue does not know yet (a new
   *  field before the server reloads its schemas). They leave alone from then on, so they never take a batch down. */
  const refused = new Set<string>();
  const shapeOf = (read: DataRead) => `${read.schema}:${[...read.fields].sort().join(",")}`;

  async function send(entries: Entry[]): Promise<void> {
    const rejectAll = (e: unknown) => entries.forEach((en) => en.waiters.forEach((w) => w.reject(e)));
    try {
      const reads = entries.map((e) => e.read);
      let res = await post(reads);
      if (res.status === 401 && o.onUnauthorized) {
        const token = await o.onUnauthorized();
        if (token !== undefined) res = await post(reads);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      // the server refuses a whole request when one read is invalid: split it so only that read fails (halves, so a
      // batch of n costs about 2·log2(n) more requests, once: the refused read leaves alone afterwards)
      if (res.status === 400 && entries.length > 1) {
        const half = Math.ceil(entries.length / 2);
        await Promise.all([send(entries.slice(0, half)), send(entries.slice(half))]);
        return;
      }
      if (res.status === 400 && entries.length === 1) refused.add(shapeOf(entries[0].read));
      // too many requests or unavailable: the whole request fails (never split) and nothing more leaves for a while
      if (PAUSE_STATUSES.has(res.status)) pauseAfter(res);
      if (res.status !== 200) return rejectAll(apiError(res.status, body));
      refusals = 0;
      const results = (body as { results?: WireResult[] } | undefined)?.results;
      if (!Array.isArray(results) || results.length !== entries.length) return rejectAll(apiError(500, body));
      entries.forEach((en, i) => {
        const r = results[i];
        if (r && r.ok === true) {
          const page: DataPage = {
            items: r.items,
            totalCount: r.totalCount,
            pageNo: r.pageNo,
            pageSize: r.pageSize,
            hasNextPage: r.hasNextPage,
          };
          onFreshness(en.key, r.stale === true);
          en.waiters.forEach((w) => w.resolve(page));
        } else {
          const err = apiError(r && r.error?.retryable ? 503 : 500, r);
          en.waiters.forEach((w) => w.reject(err));
        }
      });
    } catch (e) {
      rejectAll(toBlocksError(e));
    }
  }

  function flush(): void {
    const entries = [...queue.values()];
    queue = new Map();
    for (let i = 0; i < entries.length; i += MAX_READS_PER_REQUEST) {
      void send(entries.slice(i, i + MAX_READS_PER_REQUEST));
    }
  }

  return {
    pausedUntil: () => (pauseUntil > now() ? pauseUntil : 0),
    read(read) {
      return new Promise<DataPage>((resolve, reject) => {
        const key = JSON.stringify(read);
        const existing = queue.get(key);
        if (existing) {
          existing.waiters.push({ resolve, reject });
          return;
        }
        if (refused.has(shapeOf(read))) {
          void send([{ key, read, waiters: [{ resolve, reject }] }]);
          return;
        }
        const first = queue.size === 0;
        queue.set(key, { key, read, waiters: [{ resolve, reject }] });
        if (first) schedule(flushWhenAllowed);
      });
    },
  };
}

/** Reads mounted by the app's first React commit join the start-up request. */
export const STARTUP_WINDOW_MS = 50;

/** First flush waits the start-up window; later ones wait two macrotasks so a read that waits one still joins. */
export function coalescingSchedule(o: { startupWindowMs?: number } = {}): (fn: () => void) => void {
  let first = true;
  return (fn) => {
    if (first) {
      first = false;
      setTimeout(fn, o.startupWindowMs ?? STARTUP_WINDOW_MS);
    } else setTimeout(() => setTimeout(fn, 0), 0);
  };
}

let configured: DataTransport | null = null;
let fallback: DataTransport | null = null;

export function configureDataTransport(t: DataTransport | null): void {
  configured = t;
}

function inBrowser(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return !!loc && (loc.protocol === "http:" || loc.protocol === "https:");
}

export function activeDataTransport(): DataTransport | null {
  if (configured) return configured;
  // queryPage already has a typed SDK GraphQL path. Cloud mode must not use /api/data.
  if (hostedLoginEnabled()) return null;
  if (import.meta.env.MODE === "test" || !inBrowser()) return null;
  fallback ??= createDataTransport({
    fetch: globalThis.fetch.bind(globalThis),
    schedule: coalescingSchedule(),
    onUnauthorized: recoverUnauthorized,
  });
  return fallback;
}

/** Until when the active read path pauses after the server's 429 or 503 (epoch ms; 0 when it does not). */
export function dataPausedUntil(): number {
  return activeDataTransport()?.pausedUntil?.() ?? 0;
}
