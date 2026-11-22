import { BlocksApiError } from "@seliseblocks/client";
import { blocks } from "./client";
import { blocksConfig, hostedLoginEnabled } from "./config";
import { oidcReturnTo, profileFromOidc } from "./oidcProfile";
import type { AuthAnswer } from "./http";

const ATTEMPT_KEY = "madp-factory-oidc-attempt-v1";
const MAX_AGE_MS = 10 * 60 * 1000;
const CALLBACK_ERROR = "We couldn't finish signing you in. Please try again.";

export async function startHostedLogin(returnTo?: string | null): Promise<void> {
  if (!hostedLoginEnabled()) throw new Error("Sign-in is not configured.");
  if (window.location.protocol !== "https:") throw new Error("Open MADP Factory on its configured HTTPS address to sign in.");
  completion = null;
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ returnTo: oidcReturnTo(returnTo), at: Date.now() }));
  try { await blocks.auth.idp.redirectToProvider(); }
  catch (error) { sessionStorage.removeItem(ATTEMPT_KEY); throw error; }
}

let completion: Promise<string> | null = null;

/** Shared by Strict Mode mounts: the authorization code is exchanged at most once. */
export function completeHostedLogin(callbackUrl: string): Promise<string> {
  completion ??= finish(callbackUrl);
  return completion;
}

async function finish(callbackUrl: string): Promise<string> {
  const raw = sessionStorage.getItem(ATTEMPT_KEY);
  sessionStorage.removeItem(ATTEMPT_KEY);
  const url = new URL(callbackUrl);
  if (url.origin !== window.location.origin || !url.searchParams.get("code") || !url.searchParams.get("state") || url.searchParams.has("error") || !raw) {
    throw new Error(CALLBACK_ERROR);
  }
  let attempt: { returnTo?: string; at?: number };
  try { attempt = JSON.parse(raw); } catch { throw new Error(CALLBACK_ERROR); }
  if (!attempt || typeof attempt.at !== "number" || Date.now() - attempt.at > MAX_AGE_MS || attempt.at > Date.now()) throw new Error(CALLBACK_ERROR);
  const response = await blocks.auth.idp.callback(callbackUrl);
  if (!response || response.error || response.isSuccess === false) throw new Error(CALLBACK_ERROR);
  // A successful callback alone is not proof that the secure session cookie landed.
  const profile = profileFromOidc(await blocks.auth.userInfo());
  if (!profile) throw new Error(CALLBACK_ERROR);
  return oidcReturnTo(attempt.returnTo);
}

/** Preserve the existing session-store contract while replacing local IAM with the SDK. */
export async function hostedAuthCall(method: "GET" | "POST", path: string, payload?: unknown): Promise<AuthAnswer | null> {
  try {
    if (method === "GET" && path === "session") {
      const profile = profileFromOidc(await blocks.auth.userInfo());
      return profile
        ? { status: 200, body: { ok: true, data: { profile, expiresInSec: 300 } } }
        : { status: 401, body: { ok: false } };
    }
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (method !== "POST") return { status: 405, body: { ok: false } };
    if (path === "link/parse") {
      try {
        const link = new URL(String(body.link ?? ""));
        const trusted = [new URL(blocksConfig().oidcUrl).origin, window.location.origin];
        if (link.protocol !== "https:" || link.username || link.password || !trusted.includes(link.origin)) throw new Error();
        const kind = /^\/(oidc\/)?activate\/?$/.test(link.pathname) ? "activation"
          : /^\/(oidc\/)?resetpassword\/?$/.test(link.pathname) ? "reset" : null;
        const code = link.searchParams.get("code") ?? link.searchParams.get("activationCode");
        if (!kind || !code || code.length > 512 || /\s/.test(code)) throw new Error();
        return { status: 200, body: { ok: true, data: { kind, code } } };
      } catch { return { status: 400, body: { ok: false, error: { message: "Use the activation or password-reset link from your email." } } }; }
    }
    let result: Record<string, unknown>;
    switch (path) {
      case "logout": result = await blocks.auth.logout(); break;
      case "logout-all": result = await blocks.auth.logoutAll(); break;
      case "password/forgot": result = await blocks.auth.recover(body); break;
      case "password/reset": result = await blocks.auth.resetPassword(body); break;
      case "password/change": result = await blocks.auth.changePassword(body); break;
      case "activation/resend": result = await blocks.auth.resendActivation(body); break;
      case "activation/validate": result = await blocks.auth.validateActivation(body); break;
      case "activation/complete": result = await blocks.auth.activate(body); break;
      default: return { status: 410, body: { ok: false, error: { code: "hosted_login_required" } } };
    }
    if (!result || result.isSuccess === false || result.error) return { status: 400, body: { ok: false } };
    return { status: 200, body: { ok: true, iam: result } };
  } catch (error) {
    if (error instanceof BlocksApiError) return { status: error.status, body: { ok: false } };
    return null;
  }
}
