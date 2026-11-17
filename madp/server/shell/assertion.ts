import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export interface ShellIdentity {
  v: 1; iat: number; exp: number; nonce: string;
  userId: string; email: string; displayName: string; tenantId: string;
  roles: string[]; permissions: string[];
}
export class ShellRefused extends Error {
  constructor(readonly status: number, readonly code = "forbidden") { super(code); }
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const field = (h: IncomingHttpHeaders, key: string): string => typeof h[key] === "string" ? h[key] as string : "";
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 512 && v.every((s) => typeof s === "string" && s.length <= 256);
const safeText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

/** One assertion is valid for exactly one HTTP request, including its body and selected tenant. */
export function createAssertionVerifier(key: string, now = Date.now) {
  if (Buffer.byteLength(key, "utf8") < 32) throw new Error("MF_BLOCKS_SHELL_KEY must contain at least 32 bytes");
  const nonces = new Map<string, number>();
  return (method: string, path: string, headers: IncomingHttpHeaders, body: Buffer): ShellIdentity => {
    const encoded = field(headers, "x-madp-context");
    const signature = field(headers, "x-madp-signature");
    const bodyHash = field(headers, "x-madp-body-sha256");
    if (!/^[A-Za-z0-9_-]{1,32768}$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !/^[a-f0-9]{64}$/.test(bodyHash)) throw new ShellRefused(401, "unauthenticated");
    const hash = createHash("sha256").update(body).digest("hex");
    if (hash !== bodyHash) throw new ShellRefused(401, "invalid_assertion");
    const canonical = `${method.toUpperCase()}\n${path}\n${bodyHash}\n${encoded}`;
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", key).update(canonical).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ShellRefused(401, "invalid_assertion");
    let claims: unknown;
    try { claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new ShellRefused(401, "invalid_assertion"); }
    if (!isRecord(claims) || claims.v !== 1 || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || !safeText(claims.userId, 256) || !safeText(claims.tenantId, 128) || !safeText(claims.email, 254)
      || typeof claims.displayName !== "string" || claims.displayName.length > 256 || !texts(claims.roles) || !texts(claims.permissions)
      || typeof claims.nonce !== "string" || !/^[a-f0-9]{32}$/i.test(claims.nonce)) throw new ShellRefused(401, "invalid_assertion");
    const epoch = Math.floor(now() / 1000);
    const iat = claims.iat as number; const exp = claims.exp as number;
    if (iat > epoch + 5 || exp <= epoch || exp - iat > 45 || exp <= iat || epoch - iat > 45) throw new ShellRefused(401, "expired_assertion");
    for (const [nonce, expires] of nonces) if (expires <= epoch) nonces.delete(nonce);
    if (nonces.has(claims.nonce) || nonces.size >= 100_000) throw new ShellRefused(401, "replayed_assertion");
    nonces.set(claims.nonce, exp);
    return claims as unknown as ShellIdentity;
  };
}
