// Server-side session store for the sealed `mf_session` cookie: create, read (with single-flight
// refresh and a rotation grace window), end and revoke. No tokens are ever logged or used as keys.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IamAuth, IamTokens } from "./iamAuth.ts";
import { SESSION_COOKIE, clearSessionCookie, open, readCookie, seal, sessionCookie, setSessionCookie } from "./sessionCrypto.ts";

export const REFRESH_AHEAD_MS = 60_000;
export const SESSION_MAX_AGE_MS = 86_400_000;
export const REFRESH_GRACE_MS = 60_000;

export interface SessionData {
  sid: string;
  accessToken: string;
  refreshToken: string;
  refreshCookie?: string;
  expiresAtMs: number;
  userId: string;
  issuedAtMs: number;
  endsAtMs: number;
}

export type SessionRead =
  | { state: "ok"; session: SessionData }
  | { state: "none" }
  | { state: "ended" }
  | { state: "unavailable" };

export interface SessionStore {
  create(req: IncomingMessage, res: ServerResponse, tokens: IamTokens): SessionData;
  read(req: IncomingMessage, res: ServerResponse): Promise<SessionRead>;
  end(req: IncomingMessage, res: ServerResponse): SessionData | null;
  clear(res: ServerResponse): void;
  revokeUser(userId: string): void;
}

type RefreshOutcome = { kind: "ok"; data: SessionData } | { kind: "refused" } | { kind: "transport" };
interface Grace {
  oldHash: Buffer;
  data: SessionData;
  untilMs: number;
}

const sha256 = (s: string): Buffer => createHash("sha256").update(s).digest();

export function createSessionStore(o: {
  keys: readonly Buffer[];
  secure: boolean;
  iam: { refresh: IamAuth["refresh"] };
  now?(): number;
  log?(line: string): void;
  maxEntries?: number;
}): SessionStore {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const max = o.maxEntries ?? 10_000;
  const revokedSids = new Map<string, number>(); // sid -> forget-at
  const revokedUsers = new Map<string, { atMs: number; forgetAtMs: number }>();
  const graces = new Map<string, Grace>(); // sid -> rotation grace
  const inflight = new Map<string, Promise<RefreshOutcome>>();

  function prune<V>(m: Map<string, V>, expiry: (v: V) => number): void {
    const t = now();
    for (const [k, v] of m) if (expiry(v) <= t) m.delete(k);
    while (m.size >= max) {
      const first = m.keys().next();
      if (first.done) break;
      m.delete(first.value);
    }
  }
  function revokeSid(sid: string, untilMs: number): void {
    prune(revokedSids, (v) => v);
    revokedSids.set(sid, untilMs);
    graces.delete(sid);
  }

  function write(res: ServerResponse, data: SessionData): void {
    const t = now();
    try {
      const value = seal(o.keys[0]!, data, data.endsAtMs);
      const maxAgeS = Math.max(0, Math.ceil((data.endsAtMs - t) / 1000));
      setSessionCookie(res, sessionCookie(value, { secure: o.secure, maxAgeS }));
    } catch (e) {
      if (e instanceof RangeError) throw new Error("session_too_large");
      throw e;
    }
  }
  function clear(res: ServerResponse): void {
    setSessionCookie(res, clearSessionCookie({ secure: o.secure }));
  }
  function openCookie(req: IncomingMessage): SessionData | null {
    const raw = readCookie(req, SESSION_COOKIE);
    return raw ? open<SessionData>(o.keys, raw, now()) : null;
  }

  async function refreshShared(s: SessionData): Promise<RefreshOutcome> {
    const running = inflight.get(s.sid);
    if (running) return running;
    const p = (async (): Promise<RefreshOutcome> => {
      try {
        const r = await o.iam.refresh({ refreshToken: s.refreshToken, refreshCookie: s.refreshCookie });
        if (!r.ok) return r.refused ? { kind: "refused" } : { kind: "transport" };
        const data: SessionData = {
          ...s,
          accessToken: r.tokens.accessToken,
          refreshToken: r.tokens.refreshToken,
          refreshCookie: r.tokens.refreshCookie,
          expiresAtMs: r.tokens.expiresAtMs,
        };
        prune(graces, (g) => g.untilMs);
        graces.set(s.sid, { oldHash: sha256(s.refreshToken), data, untilMs: now() + REFRESH_GRACE_MS });
        return { kind: "ok", data };
      } catch {
        return { kind: "transport" };
      } finally {
        inflight.delete(s.sid);
      }
    })();
    inflight.set(s.sid, p);
    return p;
  }

  return {
    create(req, res, tokens) {
      const t = now();
      const old = openCookie(req);
      if (old) revokeSid(old.sid, old.endsAtMs);
      const data: SessionData = {
        sid: randomBytes(16).toString("base64url"),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(tokens.refreshCookie !== undefined ? { refreshCookie: tokens.refreshCookie } : {}),
        expiresAtMs: tokens.expiresAtMs,
        userId: tokens.userId,
        issuedAtMs: t,
        endsAtMs: t + SESSION_MAX_AGE_MS,
      };
      write(res, data);
      return data;
    },

    async read(req, res) {
      if (!readCookie(req, SESSION_COOKIE)) return { state: "none" };
      const s = openCookie(req);
      if (!s) {
        clear(res);
        return { state: "none" };
      }
      const t = now();
      const ru = revokedUsers.get(s.userId);
      if (revokedSids.has(s.sid) || (ru && ru.atMs >= s.issuedAtMs)) {
        clear(res);
        return { state: "ended" };
      }
      if (s.expiresAtMs - t > REFRESH_AHEAD_MS) return { state: "ok", session: s };

      const refused = (): SessionRead => {
        log("[auth] session refresh refused");
        revokeSid(s.sid, s.endsAtMs);
        clear(res);
        return { state: "ended" };
      };
      if (!s.refreshToken) return refused();

      const g = graces.get(s.sid);
      if (g && g.untilMs > t) {
        const h = sha256(s.refreshToken);
        if (h.length === g.oldHash.length && timingSafeEqual(h, g.oldHash)) {
          write(res, g.data);
          return { state: "ok", session: g.data };
        }
      }

      const out = await refreshShared(s);
      if (out.kind === "ok") {
        // A session ended while the refresh was in flight stays ended.
        if (revokedSids.has(s.sid)) {
          clear(res);
          return { state: "ended" };
        }
        try {
          write(res, out.data);
        } catch {
          return refused();
        }
        return { state: "ok", session: out.data };
      }
      if (out.kind === "refused") return refused();
      log("[auth] session refresh unavailable");
      if (now() < s.expiresAtMs) return { state: "ok", session: s };
      return { state: "unavailable" };
    },

    end(req, res) {
      const s = openCookie(req);
      if (s) revokeSid(s.sid, s.endsAtMs);
      clear(res);
      return s;
    },

    clear,

    revokeUser(userId) {
      prune(revokedUsers, (v) => v.forgetAtMs);
      const t = now();
      revokedUsers.set(userId, { atMs: t, forgetAtMs: t + SESSION_MAX_AGE_MS });
    },
  };
}
