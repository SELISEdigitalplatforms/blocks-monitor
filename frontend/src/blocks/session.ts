// The signed-in session. Hosted mode validates Blocks IAM's secure HttpOnly cookie through the SDK;
// the historical local adapter uses the same store contract through /api/auth/*. Neither stores
// tokens in browser storage. Only the sign-out coordination flag is persisted here.
// This store must not import from @/state or @/data (the app identity bridge is src/state/identity.ts).
import { create } from "zustand";
import { bindTokenSource } from "./client";
import { authCall } from "./http";
import { iamMessage, type LoginFailure } from "./iamResult";
import { queryClient } from "./queryClient";
import { hostedLoginEnabled } from "./config";
import { t } from "../i18n";

export type { LoginFailure };

export const SUPER_ADMIN_ROLE = "mf-super-admin";
export const USER_ROLE = "mf-user";
/** Where earlier versions kept a refresh token; it is deleted on app start. */
export const LEGACY_REFRESH_KEY = "madp-factory-blocks-refresh-v1";
/** Set while a sign-out has not been confirmed by IAM yet; the next boot treats it as signed out. */
export const SIGN_OUT_PENDING_KEY = "madp-factory-sign-out-pending-v1";
export const AUTH_CHANNEL = "madp-factory-auth";
export const MSG_SESSION_ENDED = "Your session ended. Please sign in again.";
export const MSG_SIGNED_OUT_ELSEWHERE = "You signed out in another tab.";

export type SessionStatus = "restoring" | "signed-out" | "signed-in";

export interface BlocksProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  /** True until the person replaces the temporary password an admin gave them (the server enforces it too). */
  mustChangePassword?: boolean;
  /** The person's language preference (their IAM profile), null when they never chose one. */
  language?: "en" | "de-CH" | null;
}

export interface SessionState {
  status: SessionStatus;
  profile: BlocksProfile | null;
  notice: string | null;
}

/** Check sessionStorage synchronously for a saved OIDC session so the very first render knows the user is signed in. */
function initialSessionState(): SessionState {
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    if (raw) {
      const data = JSON.parse(raw) as { accessToken?: string; profile?: Record<string, unknown>; expiresAtMs?: number };
      if (data.accessToken && data.profile && data.expiresAtMs && data.expiresAtMs > Date.now()) {
        const ttl = data.expiresAtMs - Date.now();
        if (typeof globalThis.setTimeout === "function") {
          globalThis.setTimeout(() => {
            globalThis.sessionStorage?.removeItem("madp-oidc-session-v1");
            globalThis.sessionStorage?.removeItem("madp-active-blocks-project-v1");
            window.location.href = "/";
          }, ttl);
        }
        const p = data.profile;
        return {
          status: "signed-in",
          profile: {
            userId: String(p.userId || ""),
            email: String(p.email || ""),
            firstName: String(p.firstName || ""),
            lastName: String(p.lastName || ""),
            displayName: String(p.displayName || ""),
            roles: Array.isArray(p.roles) ? p.roles : [],
            permissions: Array.isArray(p.permissions) ? p.permissions : [],
            isSuperAdmin: p.isSuperAdmin === true,
          },
          notice: null,
        };
      }
      // Token expired — clear stale session
      globalThis.sessionStorage.removeItem("madp-oidc-session-v1");
      globalThis.sessionStorage.removeItem("madp-active-blocks-project-v1");
    }
  } catch { /* no sessionStorage or invalid data */ }
  return { status: "restoring", profile: null, notice: null };
}

export const useSession = create<SessionState>(initialSessionState);

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<RefreshOutcome> | null = null;
let generation = 0;
let retryAttempt = 0;

type RefreshOutcome = "ok" | "refused" | "unreachable";
const RETRY_DELAYS_SEC = [2, 5, 15, 30, 60];
/** On app start an unreachable server is asked again after 2, 5, 15 and 30 s (about a minute) before giving up. */
export const RESTORE_RETRIES = 4;

/** The server was not reached on app start (no answer, a timeout, 408, 429 or 5xx): the session may well be fine. */
function unreachableOnStart(answer: { status: number } | null): boolean {
  return !answer || answer.status === 0 || answer.status === 408 || answer.status === 429 || answer.status >= 500;
}

/** The notice on the sign-in page when the session could not be resumed because the server was not reached. */
export function sessionUnreachableNotice(): string {
  return t("auth.signIn.sessionUnreachable", "The server could not be reached, so your session could not be resumed. Reload the page in a moment, or sign in again.");
}

/** Always undefined: session cookies are HttpOnly, never readable by the app. */
export function getAccessToken(): string | undefined {
  return undefined;
}

/** The embedded-login payload: IAM's EmbeddedLoginRequest takes username and password. */
export function loginRequest(email: string, password: string) {
  return { username: email.trim().toLowerCase(), password };
}

/** Delete a refresh token an earlier version stored in the browser. */
function dropLegacyTokens(): void {
  for (const kind of ["sessionStorage", "localStorage"] as const) {
    try {
      globalThis[kind]?.removeItem(LEGACY_REFRESH_KEY);
    } catch {
      /* ignore */
    }
  }
}

// A flag only (never a token, email or id): a sign-out started but IAM has not confirmed it yet. If the page
// reloads in that window, the next boot finishes the sign-out instead of resuming the session.
function markSignOutPending(): void {
  try {
    globalThis.localStorage?.setItem(SIGN_OUT_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

function clearSignOutPending(): void {
  try {
    globalThis.localStorage?.removeItem(SIGN_OUT_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function isSignOutPending(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIGN_OUT_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

const SIGN_OUT_WAIT_MS = 5_000;

// ---- server calls ----

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/** The server's {ok:true,data:{profile,expiresInSec}}; anything malformed is null (treated as unavailable). */
function readSession(body: unknown): { profile: BlocksProfile; expiresInSec: number } | null {
  if (!isObject(body) || body.ok !== true || !isObject(body.data)) return null;
  const p = body.data.profile;
  const exp = body.data.expiresInSec;
  if (!isObject(p) || typeof exp !== "number" || !Number.isFinite(exp)) return null;
  const roles = strings(p.roles);
  const permissions = strings(p.permissions);
  if (
    typeof p.userId !== "string" || !p.userId ||
    typeof p.email !== "string" || !p.email ||
    typeof p.firstName !== "string" ||
    typeof p.lastName !== "string" ||
    typeof p.displayName !== "string" ||
    typeof p.isSuperAdmin !== "boolean" ||
    !roles || !permissions
  ) {
    return null;
  }
  return {
    profile: {
      userId: p.userId,
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: p.displayName,
      roles,
      permissions,
      isSuperAdmin: p.isSuperAdmin,
      mustChangePassword: body.data.mustChangePassword === true,
      language: p.language === "en" || p.language === "de-CH" ? p.language : null,
    },
    expiresInSec: exp,
  };
}

/** Logout, waiting at most SIGN_OUT_WAIT_MS. True only when the server answered 200. Never throws. */
async function logoutWithin(): Promise<boolean> {
  let wait: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      authCall("POST", "logout", {}).then((a) => a?.status === 200),
      new Promise<boolean>((resolve) => {
        wait = setTimeout(() => resolve(false), SIGN_OUT_WAIT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (wait) clearTimeout(wait);
  }
}

// ---- cross-tab ----

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (!Ctor) return null;
  try {
    channel = new Ctor(AUTH_CHANNEL);
    if (typeof window !== "undefined") channel.onmessage = (e: MessageEvent) => handleAuthMessage(e.data);
  } catch {
    channel = null;
  }
  return channel;
}

function broadcastSignedOut(): void {
  try {
    getChannel()?.postMessage({ type: "signed-out" });
  } catch {
    /* ignore */
  }
}

/** Another tab signed out: end this tab's session without telling the others again. */
export function handleAuthMessage(data: unknown): void {
  if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== "signed-out") return;
  if (useSession.getState().status === "signed-out") return;
  clearLocal(MSG_SIGNED_OUT_ELSEWHERE, false);
}

// ---- local state ----

function stopTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function clearLocal(notice: string | null, broadcast: boolean): void {
  generation++;
  stopTimer();
  retryAttempt = 0;
  useSession.setState({ status: "signed-out", profile: null, notice });
  queryClient.clear(); // nothing from the previous person survives
  if (broadcast) broadcastSignedOut();
}

/** End the session locally with no server call. Skip when OIDC session is active (API failures don't mean signed out). */
export function endSession(notice: string | null): void {
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    if (raw) {
      const data = JSON.parse(raw) as { expiresAtMs?: number };
      if (data.expiresAtMs && data.expiresAtMs > Date.now()) return; // OIDC session is valid — don't sign out
    }
  } catch { /* ignore */ }
  clearLocal(notice, true);
}

export function setNotice(text: string | null): void {
  useSession.setState({ notice: text });
}

// ---- keep-alive ----

/** The server refreshes the IAM tokens when they are within 60 s of expiry; this ping keeps an open tab signed in. */
function scheduleRefresh(expiresInSec: number): void {
  stopTimer();
  const seconds = Math.max(5, expiresInSec - 45);
  timer = setTimeout(() => void refreshNow(), seconds * 1000);
}

/** After a failed ping: retry with backoff (the last delay repeats). Shares `timer`, so sign-out cancels it. */
function scheduleRetry(): void {
  stopTimer();
  const delay = RETRY_DELAYS_SEC[Math.min(retryAttempt, RETRY_DELAYS_SEC.length - 1)];
  retryAttempt++;
  timer = setTimeout(() => void refreshNow(), delay * 1000);
}

/** One session ping. Only a 401 refuses; a network error, timeout, 503 or malformed answer is "unreachable". */
async function callRefresh(): Promise<RefreshOutcome> {
  const gen = generation;
  const answer = await authCall("GET", "session");
  if (gen !== generation) return "refused"; // signed out or in again meanwhile
  if (!answer) return "unreachable";
  if (answer.status === 401) return "refused";
  const session = answer.status === 200 ? readSession(answer.body) : null;
  if (!session) return "unreachable";
  retryAttempt = 0;
  useSession.setState({ profile: session.profile });
  scheduleRefresh(session.expiresInSec);
  return "ok";
}

/** One ping at a time. */
function refreshOnce(): Promise<RefreshOutcome> {
  if (!inflight) {
    inflight = callRefresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Resolves when no refresh is in flight (a failed refresh also counts as settled). */
export function whenRefreshSettled(): Promise<void> {
  return inflight ? inflight.then(() => undefined, () => undefined) : Promise.resolve();
}

/**
 * Check the session with the server (one request at a time); the server refreshes the tokens itself.
 * A 401 ends the session with the calm message. Always resolves undefined (the browser holds no token).
 */
export async function refreshNow(): Promise<string | undefined> {
  // OIDC session: never end the session from a refresh failure — the OIDC token is the source of truth
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    if (raw) {
      const data = JSON.parse(raw) as { accessToken?: string; expiresAtMs?: number };
      if (data.accessToken && data.expiresAtMs && data.expiresAtMs > Date.now()) return data.accessToken;
    }
  } catch { /* ignore */ }
  const gen = generation;
  const outcome = await refreshOnce();
  if (gen !== generation) return undefined;
  if (outcome === "refused") endSession(MSG_SESSION_ENDED);
  else if (outcome === "unreachable") scheduleRetry(); // the server was not reached: keep the session, try again
  return undefined;
}

// A 401 gets one session check, but only for a signed-in session (not while restoring or signed out).
bindTokenSource({
  accessToken: () => undefined,
  onUnauthorized: async () => (useSession.getState().status === "signed-in" ? refreshNow() : undefined),
});

// ---- profile ----

/** Reload the profile (after an admin changes roles, for instance). */
export async function reloadProfile(): Promise<boolean> {
  const answer = await authCall("GET", "session");
  const session = answer?.status === 200 ? readSession(answer.body) : null;
  if (!session) return false;
  useSession.setState({ profile: session.profile });
  return true;
}

/** The person set their own password: clear the flag on the current profile (nothing when signed out). */
export function markPasswordChanged(): void {
  const profile = useSession.getState().profile;
  if (!profile) return;
  useSession.setState({ profile: { ...profile, mustChangePassword: false } });
}

// ---- public actions ----

const LOGIN_REASONS: readonly LoginFailure[] = ["credentials", "not-activated", "deactivated", "extra-step", "locked"];

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; profile: BlocksProfile } | { ok: false; reason: LoginFailure }> {
  const { username, password } = loginRequest(input.email, input.password);
  const answer = await authCall("POST", "login", { email: username, password });
  if (!answer) return { ok: false, reason: "unavailable" };
  if (answer.status === 200) {
    const session = readSession(answer.body);
    if (!session) return { ok: false, reason: "unavailable" };
    generation++;
    clearSignOutPending();
    retryAttempt = 0;
    useSession.setState({ status: "signed-in", profile: session.profile, notice: null });
    scheduleRefresh(session.expiresInSec);
    return { ok: true, profile: session.profile };
  }
  if (answer.status === 429) return { ok: false, reason: "locked" };
  if (answer.status === 401 && isObject(answer.body) && isObject(answer.body.error)) {
    const reason = answer.body.error.reason;
    const known = LOGIN_REASONS.find((r) => r === reason);
    if (known) return { ok: false, reason: known };
  }
  return { ok: false, reason: "unavailable" };
}

/** Resume a session from the server cookie (app start): GET /api/auth/session. Only a 401 (or an answer that is not a
 *  session) signs out at once; while the server is not reached the status stays "restoring" and it is asked again
 *  (RESTORE_RETRIES, the keep-alive's backoff), then the person is signed out here with a notice that says why. */
export async function restoreSession(afterCallback = false): Promise<void> {
  dropLegacyTokens();
  // Skip on the callback page — the OIDC callback handler sets the session directly.
  if (!afterCallback && globalThis.location?.pathname === "/login/callback") return;
  // If an OIDC session exists, use it directly — no /api/auth/session, no workspace bootstrap.
  // The OIDC token is the single source of truth for auth.
  try {
    const { readOidcSession } = await import("./oidcSession");
    const oidc = readOidcSession();
    if (oidc) {
      const p = oidc.profile;
      const session = readSession({ ok: true, data: { profile: p, expiresInSec: Math.round((oidc.expiresAtMs - Date.now()) / 1000) } });
      if (session) {
        generation++;
        clearSignOutPending();
        retryAttempt = 0;
        useSession.setState({ status: "signed-in", profile: session.profile, notice: null });
        // Don't schedule refresh — no /api/auth/session to ping. The OIDC token has its own expiry.
        return;
      }
    }
  } catch { /* oidcSession not available, continue normally */ }
  // A freshly validated hosted login supersedes an interrupted earlier sign-out.
  if (afterCallback) clearSignOutPending();
  if (isSignOutPending()) {
    // A sign-out was cut short (reload before the server answered): finish it, never resume the session.
    if (await logoutWithin()) clearSignOutPending();
    useSession.setState({ status: "signed-out", profile: null });
    return;
  }
  const gen = generation;
  let answer = await authCall("GET", "session");
  if (gen !== generation) return; // signed in or out meanwhile: that path already set the state
  for (let attempt = 0; unreachableOnStart(answer) && attempt < RESTORE_RETRIES; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_SEC[attempt] * 1000));
    if (gen !== generation) return;
    answer = await authCall("GET", "session");
    if (gen !== generation) return;
  }
  const session = answer?.status === 200 ? readSession(answer.body) : null;
  if (!session) {
    const notice = unreachableOnStart(answer) ? { notice: sessionUnreachableNotice() } : {};
    if (useSession.getState().status !== "signed-out") useSession.setState({ status: "signed-out", ...notice });
    return;
  }
  retryAttempt = 0;
  useSession.setState({ status: "signed-in", profile: session.profile, notice: null });
  scheduleRefresh(session.expiresInSec);
}

/** Sign out here. Local state is cleared first; the server clears the cookie and signs out of IAM, best-effort. */
export async function signOut(): Promise<void> {
  markSignOutPending();
  clearLocal(null, true);
  if (await logoutWithin()) clearSignOutPending();
}

/** Sign out of every device, then always end the local session. */
export async function signOutEverywhere(): Promise<{ ok: true } | { ok: false; error: string }> {
  let result: { ok: true } | { ok: false; error: string };
  markSignOutPending();
  const answer = await authCall("POST", "logout-all", {});
  const body = answer?.body;
  if (answer?.status === 200 && isObject(body) && body.ok === true) {
    result = { ok: true };
  } else {
    const msg = isObject(body) && isObject(body.error) ? body.error.message : undefined;
    result = { ok: false, error: typeof msg === "string" && msg ? msg : iamMessage(null) };
  }
  if (result.ok) clearSignOutPending();
  clearLocal(null, true);
  return result;
}

if (typeof window !== "undefined") {
  getChannel();
  const visible = () => {
    if (document.visibilityState === "visible" && useSession.getState().status === "signed-in") void refreshNow();
  };
  document.addEventListener("visibilitychange", visible);
  import.meta.hot?.dispose(() => document.removeEventListener("visibilitychange", visible));
}
