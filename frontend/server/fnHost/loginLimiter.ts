import { createHash } from "node:crypto";

export const EMAIL_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;
export const FAILURE_WINDOW_MS = 900_000;
export const LOCK_MS = 300_000;
const DEFAULT_MAX_KEYS = 10_000;

type Verdict = { ok: true } | { ok: false; retryAfterS: number };

export interface LoginLimiter {
  check(ip: string, email: string): Verdict;
  fail(ip: string, email: string): void;
  succeed(ip: string, email: string): void;
  size(): number;
}

export interface IpLimiter {
  take(ip: string): Verdict;
  size(): number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

const retryAfter = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Evicts expired keys first, then the oldest, until there is room for one more key. */
function makeRoom<V>(map: Map<string, V>, maxKeys: number, expired: (v: V) => boolean): void {
  if (map.size < maxKeys) return;
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  for (const k of map.keys()) {
    if (map.size < maxKeys) break;
    map.delete(k);
  }
}

export function createLoginLimiter(o: { now?(): number; maxKeys?: number } = {}): LoginLimiter {
  const now = o.now ?? Date.now;
  const maxKeys = o.maxKeys ?? DEFAULT_MAX_KEYS;
  const emails = new Map<string, Entry>();
  const ips = new Map<string, Entry>();
  const emailKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const idle = (e: Entry, t: number) => e.lockedUntil <= t && !e.failures.some((x) => x > t - FAILURE_WINDOW_MS);

  function locked(map: Map<string, Entry>, key: string, t: number): number {
    const e = map.get(key);
    if (!e) return 0;
    if (e.lockedUntil > t) return e.lockedUntil - t;
    if (idle(e, t)) map.delete(key);
    return 0;
  }

  function record(map: Map<string, Entry>, key: string, max: number): void {
    const t = now();
    const prev = map.get(key);
    if (!prev) makeRoom(map, maxKeys, (e) => idle(e, t));
    const failures = [...(prev?.failures ?? []).filter((x) => x > t - FAILURE_WINDOW_MS), t];
    let lockedUntil = prev && prev.lockedUntil > t ? prev.lockedUntil : 0;
    let kept = failures;
    if (failures.length >= max && !lockedUntil) {
      lockedUntil = t + LOCK_MS;
      kept = [];
    }
    map.delete(key);
    map.set(key, { failures: kept, lockedUntil });
  }

  return {
    check(ip, email) {
      const t = now();
      const ms = Math.max(locked(emails, emailKey(email), t), locked(ips, ip, t));
      return ms > 0 ? { ok: false, retryAfterS: retryAfter(ms) } : { ok: true };
    },
    fail(ip, email) {
      record(emails, emailKey(email), EMAIL_MAX_FAILURES);
      record(ips, ip, IP_MAX_FAILURES);
    },
    succeed(_ip, email) {
      emails.delete(emailKey(email));
    },
    size: () => emails.size + ips.size,
  };
}

export function createIpLimiter(o: { limit: number; windowMs: number; now?(): number; maxKeys?: number }): IpLimiter {
  const now = o.now ?? Date.now;
  const maxKeys = o.maxKeys ?? DEFAULT_MAX_KEYS;
  const hits = new Map<string, number[]>();
  const live = (list: number[], t: number) => list.filter((x) => x > t - o.windowMs);
  return {
    take(ip) {
      const t = now();
      const prev = hits.get(ip);
      if (!prev) makeRoom(hits, maxKeys, (l) => !l.some((x) => x > t - o.windowMs));
      const list = live(prev ?? [], t);
      if (list.length >= o.limit) {
        hits.set(ip, list);
        return { ok: false, retryAfterS: retryAfter(list[0] + o.windowMs - t) };
      }
      list.push(t);
      hits.delete(ip);
      hits.set(ip, list);
      return { ok: true };
    },
    size: () => hits.size,
  };
}

/** POST /api/data and the Blocks bridge: a ceiling per IP address before any session work (abuse: a flood without a
 *  session never reaches the session store), then a budget per signed-in session, so two people behind one address
 *  (an office, a VPN) never use up each other's reads. One page of the app stays far below the session budget (its
 *  live clock reads at most about 12 times a minute while a build runs, src/blocks/data/livePoll.ts); a second tab of
 *  the same session shares it. */
export const DATA_LIMIT_PER_IP = 600;
export const DATA_LIMIT_PER_SESSION = 120;
export const DATA_LIMIT_WINDOW_MS = 60_000;

export interface DataLimiter {
  /** Before the session is read: the address's ceiling. */
  address(ip: string): Verdict;
  /** Once the session is known: its own budget (keyed by the session id, never the cookie). */
  session(sid: string): Verdict;
}

export function createDataLimiter(o: { perIp?: number; perSession?: number; windowMs?: number; now?(): number } = {}): DataLimiter {
  const windowMs = o.windowMs ?? DATA_LIMIT_WINDOW_MS;
  const ips = createIpLimiter({ limit: o.perIp ?? DATA_LIMIT_PER_IP, windowMs, now: o.now });
  const sessions = createIpLimiter({ limit: o.perSession ?? DATA_LIMIT_PER_SESSION, windowMs, now: o.now });
  return { address: (ip) => ips.take(ip), session: (sid) => sessions.take(`sid:${sid}`) };
}
