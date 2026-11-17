/**
 * Sealed session cookie: AES-256-GCM over {e: expiresAtMs, d: data}, node:crypto only.
 * Format: v1.<iv>.<ciphertext>.<tag> (all base64url). Nothing here logs.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE = "mf_session";
export const MAX_COOKIE_BYTES = 3900;

const VERSION = "v1";
const AAD = Buffer.from("mf_session/v1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Decode MF_SESSION_SECRET (hex when all hex and >= 64 chars, else base64url/base64) into a 32-byte key. */
export function parseSessionSecret(raw: string | undefined): Buffer | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let secret: Buffer;
  if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 64) {
    if (text.length % 2 !== 0) return null;
    secret = Buffer.from(text, "hex");
  } else {
    if (!/^[A-Za-z0-9_-]+={0,2}$|^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
    secret = Buffer.from(text, "base64");
  }
  if (secret.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", secret, "madp-factory", "mf_session/v1", 32));
}

export function seal(key: Buffer, data: unknown, expiresAtMs: number): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const plain = Buffer.from(JSON.stringify({ e: expiresAtMs, d: data }), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = [
    VERSION,
    iv.toString("base64url"),
    ct.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
  if (out.length > MAX_COOKIE_BYTES) {
    throw new RangeError(`sealed session exceeds ${MAX_COOKIE_BYTES} bytes`);
  }
  return out;
}

export function open<T>(keys: Buffer | readonly Buffer[], sealed: string, nowMs: number): T | null {
  try {
    if (typeof sealed !== "string" || sealed.length > MAX_COOKIE_BYTES) return null;
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv = Buffer.from(parts[1], "base64url");
    const ct = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const list = Buffer.isBuffer(keys) ? [keys] : keys;
    for (const key of list) {
      let plain: Buffer;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        plain = Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(plain.toString("utf8"));
      } catch {
        return null;
      }
      if (!parsed || typeof parsed !== "object") return null;
      const { e, d } = parsed as { e?: unknown; d?: unknown };
      if (typeof e !== "number" || !Number.isFinite(e) || nowMs >= e) return null;
      return d as T;
    }
    return null;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, o: { secure: boolean; maxAgeS: number }): string {
  return (
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(o.maxAgeS))}` +
    (o.secure ? "; Secure" : "")
  );
}

export function clearSessionCookie(o: { secure: boolean }): string {
  return (
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT` +
    (o.secure ? "; Secure" : "")
  );
}

export function readCookie(req: IncomingMessage, name: string = SESSION_COOKIE): string {
  const header = req.headers.cookie;
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return "";
}

/** Add a Set-Cookie to the response, replacing an earlier mf_session entry and keeping all others. */
export function setSessionCookie(res: ServerResponse, cookie: string): void {
  const current = res.getHeader("set-cookie");
  const existing = Array.isArray(current) ? current : current === undefined ? [] : [String(current)];
  const kept = existing.filter((c) => !c.trimStart().startsWith(`${SESSION_COOKIE}=`));
  res.setHeader("Set-Cookie", [...kept, cookie]);
}
