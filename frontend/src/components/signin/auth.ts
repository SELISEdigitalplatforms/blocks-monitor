import { isSameAppPath } from "@/blocks/guard";
import { afterSignupPath, cleanPlanKey } from "@/domain/signup";
import type { LoginFailure } from "@/blocks/iamResult";
import { t } from "@/i18n";

/** Cinematic hand-off after signing in, in ms. */
export const HANDOFF_MS = 450;
/** Cross-fade between the sign-in and sign-up panes, in ms. */
export const SWITCH_MS = 200;

/** The English of the invalid-email message (emailError shows it in the current language). */
export const MSG_EMAIL = "Enter a valid work email.";

/** MSG_EMAIL (in the current language) when the trimmed email is empty or malformed, else null. */
export function emailError(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : t("auth.email.invalid", "Enter a valid work email.");
}

/** Why a sign-in failed, said to the person in the current language (the English is LOGIN_MESSAGES in @/blocks/iamResult). */
export function loginMessage(reason: LoginFailure): string {
  switch (reason) {
    case "credentials": return t("auth.login.credentials", "That email and password don't match. Check them and try again.");
    case "extra-step": return t("auth.login.extraStep", "This account needs an extra sign-in step that this app does not support yet.");
    case "locked": return t("auth.login.locked", "Too many wrong attempts. Your account is locked for 5 minutes. Try again after that.");
    case "not-activated": return t("auth.login.notActivated", "Confirm your email address first: open the link in the newest email from MADP Factory (sign-up or invitation).");
    case "deactivated": return t("auth.login.deactivated", "This account has been deactivated. Ask a platform admin to reactivate it.");
    case "unavailable": return t("auth.login.unavailable", "Sign-in is not available right now. Check your connection and try again.");
  }
}

/** Only same-app paths are followed after sign-in (one leading "/", no control characters or backslashes, still same-origin after URL normalisation); anything else goes to /dashboard. */
export function safeNext(raw: string | null | undefined): string {
  return raw && isSameAppPath(raw) ? raw : "/dashboard";
}

/** Old localStorage key of the remembered email; only ever removed now (the email is no longer stored). */
export const REMEMBER_KEY = "madp-factory-sign-in-email-v1";
export type KeyStore = Pick<Storage, "removeItem">;

/** Removes the key the old sign-in used to remember the email; storage failures are ignored. */
export function forgetRememberedEmail(store?: KeyStore | null): void {
  try {
    const s = store === undefined ? globalThis.localStorage : store;
    s?.removeItem(REMEMBER_KEY);
  } catch {
    /* storage blocked: nothing to forget */
  }
}

export type AuthMode = "signin" | "signup";
/** The screens of the auth card: the two tabs plus the e-mail-link pages. */
export type AuthScreenMode = AuthMode | "activate" | "reset";

export interface AuthViewProps {
  /** the hand-off has started: every control is disabled */
  leaving: boolean;
  /** the person is signed in: run the hand-off */
  onSignedIn: () => void;
  /** a sign-in request is in flight */
  onPending: (on: boolean) => void;
}

/** Router state passed by links that switch between /sign-in and /sign-up. */
export const AUTH_SWITCH = { authSwitch: true } as const;

export function isAuthSwitch(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { authSwitch?: unknown }).authSwitch === true;
}

/** Where a person who picked a plan on the pricing page goes after signing in to an existing account (null: Home). */
export function planNext(plan: string | null | undefined): string | null {
  const key = cleanPlanKey(plan);
  return key && key !== "free" ? afterSignupPath(key) : null;
}

/** The /sign-in or /sign-up path, with the safe `next`, a valid email and the pricing plan as query. */
export function authHref(mode: AuthMode, opts: { next?: string | null; email?: string; plan?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.next && safeNext(opts.next) === opts.next && opts.next !== "/dashboard") q.set("next", opts.next);
  const email = opts.email?.trim();
  if (email && !emailError(email)) q.set("email", email);
  const plan = cleanPlanKey(opts.plan);
  if (plan) q.set("plan", plan);
  const qs = q.toString();
  return (mode === "signin" ? "/sign-in" : "/sign-up") + (qs ? `?${qs}` : "");
}
