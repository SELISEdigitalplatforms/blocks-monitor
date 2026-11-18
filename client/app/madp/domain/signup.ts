// Public sign-up: the rules the sign-up page shows live and the server enforces (one copy, no I/O).
// The password policy, the name and organization defaults, the plan carried from the pricing page, the
// verification-link format and the PlatformSetting `auth.signup` ("open" | "invite-only").
import { isCommonPassword } from "./commonPasswords";

/** PlatformSetting key that opens or closes the public sign-up. */
export const SIGNUP_SETTING_KEY = "auth.signup";
export type SignupMode = "open" | "invite-only";
export const DEFAULT_SIGNUP_MODE: SignupMode = "open";

/** The mode stored in PlatformSetting.ValueJson (a JSON string); anything unreadable is the default. */
export function signupModeOf(valueJson: unknown): SignupMode {
  if (typeof valueJson !== "string" || !valueJson) return DEFAULT_SIGNUP_MODE;
  try {
    const v = JSON.parse(valueJson) as unknown;
    return v === "invite-only" ? "invite-only" : v === "open" ? "open" : DEFAULT_SIGNUP_MODE;
  } catch {
    return DEFAULT_SIGNUP_MODE;
  }
}

export const isSignupMode = (v: unknown): v is SignupMode => v === "open" || v === "invite-only";

// ---------------------------------------------------------------- password policy

/** Shortest accepted password for a new or reset password. A phrase of a few words reaches it easily. */
export const SIGNUP_PASSWORD_MIN = 12;
/** Blocks IAM accepts at most 64 characters. */
export const SIGNUP_PASSWORD_MAX = 64;

export interface PolicyCheck {
  key: "length" | "common" | "email";
  label: string;
  met: boolean;
}

export interface PolicyResult {
  ok: boolean;
  checks: PolicyCheck[];
  /** The first unmet rule as a sentence, or null. */
  message: string | null;
}

const MESSAGES: Record<PolicyCheck["key"], string> = {
  length: `Use at least ${SIGNUP_PASSWORD_MIN} characters (at most ${SIGNUP_PASSWORD_MAX}). A phrase of a few words works well.`,
  common: "This password is too common or too easy to guess. Choose another one.",
  email: "Don't use your email address as your password.",
};

function looksLikeEmail(password: string, email: string): boolean {
  const p = password.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (p === e) return true;
  const local = e.slice(0, e.indexOf("@"));
  // the address without its domain, alone or with a few digits or symbols around it
  return local.length >= 4 && p.replace(/[^a-z]/g, "") === local.replace(/[^a-z]/g, "") && /[a-z]/.test(local);
}

/** The policy for a new password: length, not a common or guessable one, not the email address. */
export function checkPassword(password: string, email = ""): PolicyResult {
  const length = password.length >= SIGNUP_PASSWORD_MIN && password.length <= SIGNUP_PASSWORD_MAX;
  const common = password.length > 0 && !isCommonPassword(password);
  const notEmail = password.length > 0 && !looksLikeEmail(password, email);
  const checks: PolicyCheck[] = [
    { key: "length", label: `At least ${SIGNUP_PASSWORD_MIN} characters, or a phrase of a few words`, met: length },
    { key: "common", label: "Not a common or easy-to-guess password", met: common },
    { key: "email", label: "Not your email address", met: notEmail },
  ];
  const first = checks.find((c) => !c.met);
  return { ok: !first, checks, message: first ? MESSAGES[first.key] : null };
}

// ---------------------------------------------------------------- names, organization, plan

export const NAME_MAX = 120;
export const ORGANIZATION_MAX = 80;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The name as typed, trimmed, single-spaced, without control characters; "" when unusable. */
export function cleanName(raw: string): string {
  const v = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return v.length <= NAME_MAX ? v : "";
}

/** IAM keeps a first and a last name: the last word is the last name, a single word is the first name only. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const v = cleanName(name);
  const at = v.lastIndexOf(" ");
  if (at <= 0) return { firstName: v.slice(0, 60), lastName: "" };
  return { firstName: v.slice(0, at).slice(0, 60).trim(), lastName: v.slice(at + 1).slice(0, 60) };
}

/** "<first name>'s organization" when the person leaves the organization name empty. */
export function defaultOrganizationName(name: string): string {
  const first = splitName(name).firstName || "My";
  const owner = /s$/i.test(first) ? `${first}'` : `${first}'s`;
  return `${owner} organization`.slice(0, ORGANIZATION_MAX);
}

export function cleanOrganizationName(raw: string, name: string): string {
  const v = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, ORGANIZATION_MAX);
  return v || defaultOrganizationName(name);
}

/** A plan key from ?plan= (pricing page); anything else is dropped. Free and Enterprise are not bought at checkout. */
export function cleanPlanKey(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(v) ? v : "";
}

/** True when the plan goes through checkout after the first sign-in (a paid plan the person picked). */
export function planNeedsCheckout(plan: string): boolean {
  const key = cleanPlanKey(plan);
  return key !== "" && key !== "free" && key !== "enterprise";
}

/** Where a newly verified person goes after the first sign-in: a paid plan to checkout, Enterprise to the prefilled
 *  contact-sales request in Settings (Plan and usage), Free or no plan to Home with a short welcome. */
export function afterSignupPath(plan: string): string {
  const key = cleanPlanKey(plan);
  if (key === "enterprise") return "/settings?plan=enterprise#plan";
  return planNeedsCheckout(key) ? `/billing/checkout?plan=${encodeURIComponent(key)}` : "/dashboard?welcome=1";
}

// ---------------------------------------------------------------- verification link

/** A verification link is valid for 24 hours, and only once. */
export const VERIFY_TTL_MS = 24 * 60 * 60_000;
/** The form must have been on screen this long before it is sent (people do not fill four fields in under 3 s). */
export const FORM_MIN_MS = 3_000;
/** A form older than this asks for a fresh form ticket. */
export const FORM_TTL_MS = 2 * 60 * 60_000;

const PART = /^[A-Za-z0-9_-]{8,128}$/;

/** "<sign-up id>.<secret>": both halves URL-safe. null when the token is malformed. */
export function parseVerifyToken(raw: string | null | undefined): { id: string; secret: string } | null {
  const v = (raw ?? "").trim();
  if (v.length > 300) return null;
  const dot = v.indexOf(".");
  if (dot <= 0 || dot !== v.lastIndexOf(".")) return null;
  const id = v.slice(0, dot);
  const secret = v.slice(dot + 1);
  return PART.test(id) && PART.test(secret) ? { id, secret } : null;
}

export const SIGNUP_MESSAGES = {
  sent: "Check your email. We sent a link to confirm your address. It is valid for 24 hours.",
  mailUnavailable: "We couldn't send the email right now. Please try again in a few minutes.",
  closed: "New accounts are by invitation right now. Ask your administrator for an invitation, or request access below.",
  rateLimited: "Too many attempts. Please wait a few minutes and try again.",
  formExpired: "This form was open for a long time. Please send it again.",
  unavailable: "MADP Factory can't be reached right now. Check your connection and try again.",
  resent: "If this address has an account waiting for confirmation, a new link is on its way.",
  verifyInvalid: "This link isn't valid. Use the newest email from MADP Factory, or ask for a new link.",
  verifyExpired: "This link has expired. Send yourself a new one.",
  verifyUsed: "Your email address is already confirmed. Sign in to continue.",
} as const;
