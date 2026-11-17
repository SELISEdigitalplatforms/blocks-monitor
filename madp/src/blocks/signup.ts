// Public sign-up, e-mail verification and new verification links: the browser only calls the same-origin /api/auth
// server (server/fnHost/authRoutes.ts), which creates the Blocks IAM identity and sends the e-mails. No password or
// link secret is kept beyond the call that needs it.
import { authCall } from "./http";
import { SIGNUP_MESSAGES, type SignupMode } from "@/domain/signup";

type Body = { ok?: unknown; data?: Record<string, unknown> | null; error?: { code?: unknown; reason?: unknown; message?: unknown } } | null;

const bodyOf = (b: unknown): Body => (b && typeof b === "object" ? (b as Body) : null);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The sign-up form's state: whether sign-up is open and the signed form ticket (when open). */
export type SignupForm =
  | { state: "open"; ticket: string; issuedAt: number }
  | { state: "invite-only" }
  | { state: "unavailable"; message: string };

export async function loadSignupForm(): Promise<SignupForm> {
  const res = await authCall("GET", "signup/form");
  const body = bodyOf(res?.body);
  // hosted sign-in (OIDC) has no sign-up of its own here: people get access by invitation
  if (res?.status === 410) return { state: "invite-only" };
  if (!res || res.status !== 200 || body?.ok !== true || !body.data) return { state: "unavailable", message: SIGNUP_MESSAGES.unavailable };
  const mode = body.data.mode as SignupMode;
  if (mode === "invite-only") return { state: "invite-only" };
  const ticket = text(body.data.ticket);
  return ticket ? { state: "open", ticket, issuedAt: Date.now() } : { state: "unavailable", message: SIGNUP_MESSAGES.unavailable };
}

export interface SignupFields {
  name: string;
  email: string;
  password: string;
  organization: string;
  plan: string;
  /** The hidden field people never see; anything in it marks a script. */
  website: string;
  acceptedTerms: boolean;
}

export type SignupAnswer =
  | { ok: true; mail: "sent" | "not-sent" }
  | { ok: false; reason: "closed" | "form-expired" | "rate-limited" | "invalid" | "unavailable"; field?: "email" | "password" | "name" | "terms"; message: string };

export async function submitSignup(ticket: string, f: SignupFields): Promise<SignupAnswer> {
  const payload: Record<string, string> = {
    name: f.name.trim(),
    email: f.email.trim().toLowerCase(),
    password: f.password,
    ticket,
    terms: f.acceptedTerms ? "yes" : "no",
  };
  if (f.organization.trim()) payload.organization = f.organization.trim();
  if (f.plan) payload.plan = f.plan;
  if (f.website) payload.website = f.website;
  const res = await authCall("POST", "signup", payload);
  const body = bodyOf(res?.body);
  if (!res) return { ok: false, reason: "unavailable", message: SIGNUP_MESSAGES.unavailable };
  if (res.status === 200 && body?.ok === true) return { ok: true, mail: body.data?.mail === "not-sent" ? "not-sent" : "sent" };
  const code = text(body?.error?.code);
  const reason = text(body?.error?.reason);
  if (res.status === 429) return { ok: false, reason: "rate-limited", message: SIGNUP_MESSAGES.rateLimited };
  if (code === "signup_closed" || res.status === 410) return { ok: false, reason: "closed", message: SIGNUP_MESSAGES.closed };
  if (reason === "form_expired") return { ok: false, reason: "form-expired", message: SIGNUP_MESSAGES.formExpired };
  if (res.status === 400) {
    if (reason === "password_policy") return { ok: false, reason: "invalid", field: "password", message: text(body?.error?.message) || "Choose another password." };
    if (reason === "email") return { ok: false, reason: "invalid", field: "email", message: "Enter a valid work email." };
    if (reason === "name") return { ok: false, reason: "invalid", field: "name", message: "Enter your name." };
    if (reason === "terms") return { ok: false, reason: "invalid", field: "terms", message: "Accept the terms and the privacy policy to continue." };
  }
  return { ok: false, reason: "unavailable", message: SIGNUP_MESSAGES.unavailable };
}

export type VerifyAnswer =
  | { ok: true; email: string; organizationName: string; plan: string; firstName: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "rate-limited" | "unavailable" };

export async function verifyEmail(token: string): Promise<VerifyAnswer> {
  const res = await authCall("POST", "verify", { token });
  const body = bodyOf(res?.body);
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 429) return { ok: false, reason: "rate-limited" };
  if (res.status === 200 && body?.ok === true && body.data) {
    return {
      ok: true,
      email: text(body.data.email),
      organizationName: text(body.data.organizationName),
      plan: text(body.data.plan),
      firstName: text(body.data.firstName),
    };
  }
  const reason = text(body?.error?.reason);
  if (res.status === 200 && (reason === "invalid" || reason === "expired" || reason === "used")) return { ok: false, reason };
  if (res.status === 400) return { ok: false, reason: "invalid" };
  return { ok: false, reason: "unavailable" };
}

/** A new verification link, by address (sign-in page) or by the old link (expired). The answer never says whether the address has an account. */
export async function resendVerification(by: { email: string } | { token: string }): Promise<{ ok: boolean; message: string }> {
  const res = await authCall("POST", "verify/resend", by);
  const body = bodyOf(res?.body);
  if (!res) return { ok: false, message: SIGNUP_MESSAGES.unavailable };
  if (res.status === 429) return { ok: false, message: SIGNUP_MESSAGES.rateLimited };
  if (res.status === 200 && body?.ok === true) {
    return body.data?.mail === "not-sent" ? { ok: false, message: SIGNUP_MESSAGES.mailUnavailable } : { ok: true, message: SIGNUP_MESSAGES.resent };
  }
  return { ok: false, message: SIGNUP_MESSAGES.unavailable };
}
