import { randomBytes, createHash, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IamAuth } from "../fnHost/iamAuth.ts";
import type { SessionData, SessionRead, SessionStore } from "../fnHost/sessionStore.ts";
import { readCookie, sessionCookie, clearSessionCookie, setSessionCookie } from "../fnHost/sessionCrypto.ts";

/** Where the sessions of one dev server are kept between restarts: an encrypted file, never the tokens in clear. */
export interface SessionPersistence {
  /** The store file (its folder is made with mode 700, the file is written with mode 600). */
  file: string;
  /** 32-byte AES-256-GCM key; derive it with sessionStoreKey(). */
  key: Buffer;
  /** Called with a short reason when the store cannot be read or written (never with session data). */
  warn?(reason: string): void;
}

const STORE_AAD = Buffer.from("madp-factory/blocks-sessions/v1");
const MAX_SESSIONS = 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;

/** A key for the session store, derived (HKDF-SHA256) from an existing server secret; null without one. */
export function sessionStoreKey(secret: string | undefined, tenant: string | undefined): Buffer | null {
  if (!secret || secret.length < 16) return null;
  return Buffer.from(hkdfSync("sha256", secret, `madp-factory:${tenant ?? ""}`, "blocks-sessions/v1", 32));
}

/** The store file for one app origin under ~/.config/madp-factory/ (two dev servers never share one). */
export function sessionStoreFile(appOrigin: string, home = homedir()): string {
  const tag = createHash("sha256").update(appOrigin).digest("hex").slice(0, 12);
  return join(home, ".config", "madp-factory", `blocks-sessions-${tag}.enc`);
}

const isText = (v: unknown): v is string => typeof v === "string";
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Only well-formed session rows are taken back; anything else is dropped. */
function sessionOf(v: unknown): SessionData | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (!isText(s.sid) || !/^[a-f0-9]{64}$/.test(s.sid)) return null;
  if (!isText(s.accessToken) || !s.accessToken || !isText(s.refreshToken) || !s.refreshToken || !isText(s.userId) || !s.userId) return null;
  if (!isTime(s.expiresAtMs) || !isTime(s.issuedAtMs) || !isTime(s.endsAtMs)) return null;
  if (s.refreshCookie !== undefined && !isText(s.refreshCookie)) return null;
  return {
    sid: s.sid, accessToken: s.accessToken, refreshToken: s.refreshToken, userId: s.userId,
    expiresAtMs: s.expiresAtMs, issuedAtMs: s.issuedAtMs, endsAtMs: s.endsAtMs,
    ...(isText(s.refreshCookie) && s.refreshCookie ? { refreshCookie: s.refreshCookie } : {}),
  };
}

function loadStore(p: SessionPersistence, nowMs: number): Map<string, SessionData> {
  const out = new Map<string, SessionData>();
  let raw: string;
  try { raw = readFileSync(p.file, "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") p.warn?.("session store unreadable; starting empty");
    return out;
  }
  try {
    const [version, iv, body, tag, extra] = raw.trim().split(".");
    if (version !== "v1" || extra !== undefined || !iv || !body || !tag) throw new Error("format");
    const decipher = createDecipheriv("aes-256-gcm", p.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(STORE_AAD);
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const json = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    const rows = JSON.parse(json) as unknown;
    if (!Array.isArray(rows)) throw new Error("format");
    for (const row of rows) {
      const s = sessionOf(row);
      if (s && s.endsAtMs > nowMs && out.size < MAX_SESSIONS) out.set(s.sid, s);
    }
  } catch {
    // A changed key or a damaged file: those sessions are gone (people sign in again), nothing is printed.
    p.warn?.("session store could not be opened; starting empty");
    out.clear();
  }
  return out;
}

function saveStore(p: SessionPersistence, entries: ReadonlyMap<string, SessionData>): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", p.key, iv);
  cipher.setAAD(STORE_AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify([...entries.values()]), "utf8"), cipher.final()]);
  const sealed = ["v1", iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  const dir = dirname(p.file);
  const tmp = `${p.file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(tmp, sealed, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, p.file);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    p.warn?.("session store could not be written; sessions stay in memory");
  }
}

/** Local Node BFF sessions. Tokens stay server-side: in memory and, when `persist` is given, in an AES-256-GCM
 * encrypted file (mode 600, replaced atomically) so a dev-server restart keeps people signed in. Only the cookie's
 * hash (the sid) is stored, never the cookie itself. Expiry, logout and revocation update the file too.
 * A production multi-instance deployment needs a shared revocable session store.
 */
export function createBlocksSessions(iam: Pick<IamAuth, "refresh">, now = Date.now, persist?: SessionPersistence): SessionStore {
  const entries = persist ? loadStore(persist, now()) : new Map<string, SessionData>();
  const inflight = new Map<string, Promise<SessionRead>>();
  const save = (): void => { if (persist) saveStore(persist, entries); };
  const drop = (id: string): void => { if (entries.delete(id)) save(); };
  const idOf = (req: IncomingMessage): string => {
    const raw = readCookie(req);
    return /^[a-f0-9]{64}$/.test(raw) ? createHash("sha256").update(raw).digest("hex") : "";
  };
  const clear = (res: ServerResponse) => setSessionCookie(res, clearSessionCookie({ secure: true }));
  const copy = (session: SessionData): SessionRead => ({ state: "ok", session: { ...session } });
  return {
    create(req, res, tokens) {
      for (const [id, value] of entries) if (value.endsAtMs <= now()) entries.delete(id);
      if (entries.size >= MAX_SESSIONS) throw new Error("session_capacity");
      entries.delete(idOf(req));
      const raw = randomBytes(32).toString("hex");
      const sid = createHash("sha256").update(raw).digest("hex");
      const data: SessionData = { ...tokens, sid, issuedAtMs: now(), endsAtMs: now() + SESSION_MS };
      entries.set(sid, data);
      save();
      setSessionCookie(res, sessionCookie(raw, { secure: true, maxAgeS: SESSION_MS / 1000 }));
      return { ...data };
    },
    async read(req, res) {
      const id = idOf(req);
      const session = entries.get(id);
      if (!session || session.endsAtMs <= now()) {
        drop(id);
        if (readCookie(req)) clear(res);
        return { state: "none" };
      }
      if (session.expiresAtMs - now() > 60_000) return copy(session);
      let pending = inflight.get(id);
      if (!pending) {
        pending = (async (): Promise<SessionRead> => {
          try {
            const result = await iam.refresh(session);
            if (!entries.has(id)) return { state: "ended" };
            if (!result.ok) {
              if (!result.refused && session.expiresAtMs > now()) return copy(session);
              if (!result.refused) return { state: "unavailable" };
              drop(id);
              return { state: "ended" };
            }
            if (result.tokens.userId !== session.userId) {
              drop(id);
              return { state: "ended" };
            }
            const next = { ...session, ...result.tokens };
            entries.set(id, next);
            save();
            return copy(next);
          } catch { return { state: "unavailable" }; }
          finally { inflight.delete(id); }
        })();
        inflight.set(id, pending);
      }
      const result = await pending;
      if (result.state === "ended") clear(res);
      return result;
    },
    end(req, res) {
      const id = idOf(req);
      const data = entries.get(id) ?? null;
      drop(id);
      clear(res);
      return data;
    },
    clear,
    revokeUser(userId) {
      let changed = false;
      for (const [id, session] of entries) if (session.userId === userId) { entries.delete(id); changed = true; }
      if (changed) save();
    },
  };
}
