// Pure helpers that read SELISE Blocks IAM responses. No state, no network.
import { BlocksApiError } from "@seliseblocks/client";

export type LoginFailure = "credentials" | "locked" | "not-activated" | "deactivated" | "extra-step" | "unavailable";

export const LOGIN_MESSAGES: Record<LoginFailure, string> = {
  credentials: "That email and password don't match. Check them and try again.",
  "extra-step": "This account needs an extra sign-in step that this app does not support yet.",
  locked: "Too many wrong attempts. Your account is locked for 5 minutes. Try again after that.",
  "not-activated":
    "Confirm your email address first: open the link in the newest email from MADP Factory (sign-up or invitation).",
  deactivated: "This account has been deactivated. Ask a platform admin to reactivate it.",
  unavailable: "Sign-in is not available right now. Check your connection and try again.",
};

const DEFAULT_LIFETIME_SEC = 900;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The single success rule for auth.* bodies (auth calls never throw on non-2xx). */
export function authBodyOk(body: unknown): boolean {
  if (!isObject(body)) return false;
  if (body.error) return false;
  if (body.isSuccess === false) return false;
  const errors = body.errors;
  if (errors === undefined || errors === null) return true;
  if (Array.isArray(errors)) return errors.length === 0;
  if (isObject(errors)) return Object.keys(errors).length === 0;
  return !errors;
}

/**
 * True when a failed auth body reports a server-side failure (HTTP 5xx / 408 / 429, or OAuth server_error /
 * temporarily_unavailable) rather than an explicit refusal such as invalid_grant or 400/401.
 */
export function isServerFailure(body: unknown): boolean {
  if (!isObject(body)) return false;
  for (const k of ["status", "statusCode", "httpStatus"]) {
    const n = Number(body[k]);
    if (Number.isInteger(n) && (n >= 500 || n === 429 || n === 408)) return true;
  }
  const code = typeof body.error === "string" ? body.error.toLowerCase() : "";
  return code === "server_error" || code === "temporarily_unavailable";
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/** Tokens from a login / refresh body (top level or under `data`). */
export function readTokens(
  body: unknown,
): { accessToken: string; refreshToken: string | null; expiresInSec: number } | null {
  if (!isObject(body)) return null;
  const layers = isObject(body.data) ? [body, body.data] : [body];
  let access: unknown;
  let refresh: unknown;
  let expires: unknown;
  for (const l of layers) {
    access ??= pick(l, "access_token", "accessToken");
    refresh ??= pick(l, "refresh_token", "refreshToken");
    expires ??= pick(l, "expires_in", "expiresIn");
  }
  if (typeof access !== "string" || !access) return null;
  const exp = typeof expires === "number" ? expires : Number(expires);
  return {
    accessToken: access,
    refreshToken: typeof refresh === "string" && refresh ? refresh : null,
    expiresInSec: Number.isFinite(exp) && exp > 0 ? exp : DEFAULT_LIFETIME_SEC,
  };
}

/** True for IAM's cookie-session answer: the session is in HttpOnly cookies and the body carries no tokens. */
export function isCookieSession(body: unknown): boolean {
  return isObject(body) && body.cookie_set === true;
}

/** Seconds until the session expires, from `expires_in` or `expires_utc` (top level or under `data`). */
export function readLifetimeSec(body: unknown, now: number = Date.now()): number {
  if (!isObject(body)) return DEFAULT_LIFETIME_SEC;
  for (const l of isObject(body.data) ? [body, body.data] : [body]) {
    const inSec = Number(pick(l, "expires_in", "expiresIn"));
    if (Number.isFinite(inSec) && inSec > 0) return inSec;
    const utc = pick(l, "expires_utc", "expiresUtc");
    const at = typeof utc === "string" || typeof utc === "number" ? new Date(utc).getTime() : NaN;
    if (Number.isFinite(at) && at > now) return Math.round((at - now) / 1000);
  }
  return DEFAULT_LIFETIME_SEC;
}

/** Sort a failed login into the cases the sign-in screen distinguishes. */
export function classifyLogin(bodyOrError: unknown): LoginFailure {
  if (bodyOrError instanceof Error || !isObject(bodyOrError)) return "unavailable";
  // A cookie-session answer without an error is a success, never "wrong credentials".
  if (isCookieSession(bodyOrError) && authBodyOk(bodyOrError)) return "unavailable";
  const parts: string[] = [];
  for (const k of ["error", "error_description", "message"]) {
    if (typeof bodyOrError[k] === "string") parts.push(bodyOrError[k] as string);
  }
  const errors = bodyOrError.errors;
  if (typeof errors === "string") parts.push(errors);
  else if (Array.isArray(errors) || isObject(errors)) {
    for (const v of Object.values(errors)) if (typeof v === "string") parts.push(v);
  }
  const text = parts.join(" ").toLowerCase();
  if (/captcha|mfa|two.?factor|\botp\b|verification code/.test(text)) return "extra-step";
  if (/lock|too many/.test(text)) return "locked";
  if (/not ?activ|inactive|activat|not ?verified|unverified/.test(text)) return "not-activated";
  return "credentials";
}

const FALLBACK = "MADP Factory did not accept the request.";

/** A short plain-text message from an IAM error or body; secrets are masked. */
export function iamMessage(errOrBody: unknown, secrets: string[] = []): string {
  const body = errOrBody instanceof BlocksApiError ? errOrBody.body : errOrBody;
  let text: string | undefined;
  if (typeof body === "string") text = body;
  else if (isObject(body)) {
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
    const errs = body.errors;
    let firstErr: string | undefined;
    if (typeof errs === "string") firstErr = str(errs);
    else if (Array.isArray(errs) || isObject(errs)) {
      firstErr = Object.values(errs).map(str).find(Boolean);
    }
    text = str(body.message) ?? str(body.error_description) ?? firstErr ?? str(body.error);
  }
  if (!text || !text.trim()) return FALLBACK;
  for (const s of secrets) if (s) text = text.split(s).join("•••");
  text = text.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : FALLBACK;
}
