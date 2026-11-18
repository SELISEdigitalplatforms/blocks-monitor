import { authCall } from "./http";
import { callFunction } from "./fn";
import { authBodyOk, iamMessage } from "./iamResult";
import { markPasswordChanged } from "./session";
import { SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_MIN, checkPassword } from "@/madp/domain/signup";
import { t } from "../i18n";

/** Account flows on SELISE Blocks IAM (forgot, reset, activate, change password). IAM is the authority; the browser only calls the same-origin /api/auth server. */

export const PASSWORD_MIN = SIGNUP_PASSWORD_MIN;
export const PASSWORD_MAX = SIGNUP_PASSWORD_MAX;

/** The shared new-password policy (src/domain/signup.ts; the server checks the same), then the confirmation. */
export function newPasswordError(password: string, confirm: string, email = ""): string | null {
  const policy = checkPassword(password, email);
  if (!policy.ok) {
    const first = policy.checks.find((c) => !c.met);
    return first ? passwordRuleMessage(first.key) : policy.message;
  }
  if (password !== confirm) return t("auth.password.mismatch", "The two passwords don't match.");
  return null;
}

/** The sentence for the first unmet password rule (domain/signup's MESSAGES), in the chosen language. */
export function passwordRuleMessage(key: string): string {
  switch (key) {
    case "length": return t("auth.password.ruleLength", "Use at least {min} characters (at most {max}). A phrase of a few words works well.", { min: SIGNUP_PASSWORD_MIN, max: SIGNUP_PASSWORD_MAX });
    case "common": return t("auth.password.ruleCommon", "This password is too common or too easy to guess. Choose another one.");
    case "email": return t("auth.password.ruleEmail", "Don't use your email address as your password.");
    default: return t("auth.password.ruleOther", "Choose another password.");
  }
}

/** The checklist line of a password rule (domain/signup's checks), in the chosen language. */
export function passwordCheckLabel(key: string, english: string): string {
  switch (key) {
    case "length": return t("auth.password.checkLength", "At least {min} characters, or a phrase of a few words", { min: SIGNUP_PASSWORD_MIN });
    case "common": return t("auth.password.checkCommon", "Not a common or easy-to-guess password");
    case "email": return t("auth.password.checkEmail", "Not your email address");
    default: return english;
  }
}

/** The trimmed code from a link, or null when it is missing, too long or contains whitespace. */
export function validCode(raw: string | null): string | null {
  if (raw === null) return null;
  const code = raw.trim();
  return code.length >= 1 && code.length <= 512 && !/\s/.test(code) ? code : null;
}

export type AccountLink = { kind: "reset" | "activation"; code: string };

/** The server reads a pasted reset or activation link (host check, code); the browser never judges it and never logs the code. */
export async function parseAccountLink(raw: string): Promise<{ ok: true; link: AccountLink } | { ok: false; message: string }> {
  const text = raw.trim();
  if (!text) return { ok: false, message: t("auth.password.pasteLink", "Paste the link from your email.") };
  const res = await authCall("POST", "link/parse", { link: text.slice(0, 2048) });
  const json = res?.body as { ok?: unknown; data?: { kind?: unknown; code?: unknown }; error?: { message?: unknown } } | null | undefined;
  if (res && res.status === 200 && json?.ok === true && (json.data?.kind === "reset" || json.data?.kind === "activation") && typeof json.data.code === "string") {
    return { ok: true, link: { kind: json.data.kind, code: json.data.code } };
  }
  if (typeof json?.error?.message === "string") return { ok: false, message: json.error.message };
  return { ok: false, message: msgUnavailable() };
}


/** After IAM accepted the person's own password: the server clears the must-change flag, then the app does too. */
export async function finishFirstPasswordChange(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await callFunction("workspace", "me.passwordChanged", {});
  } catch {
    return { ok: false, message: t("auth.password.finishFailed", "Your password was changed, but MADP Factory couldn't finish setting up. Try again.") };
  }
  markPasswordChanged();
  return { ok: true };
}

/** POSTs JSON to the same-origin server; resolves to the sanitized IAM body, throws on any non-200 answer, network error or timeout. */
async function post(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await authCall("POST", path.replace(/^\/api\/auth\//, ""), payload);
  if (!res || res.status !== 200) throw new Error("status " + (res ? res.status : "none"));
  const json = res.body as { ok?: unknown; iam?: unknown } | null;
  if (!json || json.ok !== true) throw new Error("refused");
  return json.iam ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MSG_RESET_SENT = "If an account exists for that email, a reset link is on its way.";
export const MSG_ACTIVATION_SENT = "A new activation link is on its way to your email.";
const msgUnavailable = () => t("auth.password.unavailable", "MADP Factory can't be reached right now. Check your connection and try again.");

export async function requestPasswordReset(email: string): Promise<{ ok: true; message: string }> {
  if (EMAIL_RE.test(email.trim())) {
    try {
      await post("/api/auth/password/forgot", { email: email.trim().toLowerCase() });
    } catch {
      /* always neutral */
    }
  }
  return { ok: true, message: t("auth.password.resetSent", "If an account exists for that email, a reset link is on its way.") };
}

/** Sends a new activation link for a known user id (IAM takes the id, not the email). */
export async function resendActivationLink(userId: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  let body: unknown;
  try {
    body = await post("/api/auth/activation/resend", { userId });
  } catch {
    return { ok: false, message: msgUnavailable() };
  }
  if (!authBodyOk(body)) return { ok: false, message: iamMessage(body) };
  return { ok: true, message: t("auth.password.activationSent", "A new activation link is on its way to your email.") };
}

export type CodeFailure = "invalid-code" | "password-rejected" | "unavailable";
export type FlowResult = { ok: true } | { ok: false; reason: CodeFailure; message: string };

function bodyText(body: unknown): string {
  try {
    return JSON.stringify(body).toLowerCase();
  } catch {
    return "";
  }
}

/** A throw or a non-object body is "unavailable"; a password complaint is "password-rejected"; the rest is a bad code. */
export function classifyCodeFailure(bodyOrError: unknown): CodeFailure {
  if (bodyOrError instanceof Error) return "unavailable";
  if (typeof bodyOrError !== "object" || bodyOrError === null) return "unavailable";
  return /password|weak|policy|length|character|complex/.test(bodyText(bodyOrError)) ? "password-rejected" : "invalid-code";
}

function failure(reason: CodeFailure, invalidMsg: string, body: unknown, secrets: string[]): FlowResult {
  if (reason === "unavailable") return { ok: false, reason, message: msgUnavailable() };
  if (reason === "password-rejected") {
    return { ok: false, reason, message: t("auth.password.notAccepted", "This password was not accepted: {reason}", { reason: iamMessage(body, secrets) }) };
  }
  return { ok: false, reason, message: invalidMsg };
}

async function run(call: () => Promise<unknown>, invalidMsg: string, secrets: string[]): Promise<FlowResult> {
  let body: unknown;
  try {
    body = await call();
  } catch (e) {
    return failure(classifyCodeFailure(e instanceof Error ? e : new Error("network")), invalidMsg, e, secrets);
  }
  if (typeof body === "object" && body !== null && authBodyOk(body)) return { ok: true };
  return failure(classifyCodeFailure(body), invalidMsg, body, secrets);
}

const msgResetInvalid = () => t("auth.password.resetInvalid", "This reset link has expired or was already used. Request a new one.");
const msgActivationInvalid = () => t("auth.password.activationInvalid", "This activation link has expired or was already used. Send yourself a new one.");

export function resetPassword(code: string, password: string): Promise<FlowResult> {
  return run(() => post("/api/auth/password/reset", { code, password }), msgResetInvalid(), [password]);
}

export type ActivationCheck =
  | { state: "valid"; userId: string; firstName: string; lastName: string }
  | { state: "expired"; userId: string }
  | { state: "already-active" | "invalid" }
  | { state: "unavailable"; message: string };

/** validate-activation always answers 200; the verdict is in `status`. */
export async function checkActivationCode(code: string): Promise<ActivationCheck> {
  let body: unknown;
  try {
    body = await post("/api/auth/activation/validate", { activationCode: code });
  } catch {
    return { state: "unavailable", message: msgUnavailable() };
  }
  if (typeof body !== "object" || body === null) return { state: "unavailable", message: msgUnavailable() };
  const b = body as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  if (b.status === "AlreadyActivated") return { state: "already-active" };
  if (b.status === "Expired") return { state: "expired", userId: text(b.userId) };
  if (b.status === "Valid" && authBodyOk(body)) {
    return { state: "valid", userId: text(b.userId), firstName: text(b.firstName).trim(), lastName: text(b.lastName).trim() };
  }
  return { state: "invalid" };
}

export async function activateAccount(
  code: string,
  password: string,
  name?: { firstName: string; lastName: string },
): Promise<FlowResult> {
  let body: unknown;
  try {
    body = await post("/api/auth/activation/complete", { code, password, ...(name ? { firstName: name.firstName, lastName: name.lastName } : {}) });
  } catch (e) {
    return failure("unavailable", msgActivationInvalid(), e, [password]);
  }
  if (typeof body === "object" && body !== null && authBodyOk(body)) return { ok: true };
  const reason = classifyCodeFailure(body);
  return failure(reason, iamMessage(body, [password]), body, [password]);
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong-current" | "password-rejected" | "unavailable"; message: string };

export async function changeMyPassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const secrets = [oldPassword, newPassword];
  let body: unknown;
  try {
    body = await post("/api/auth/password/change", { oldPassword, newPassword });
  } catch {
    return { ok: false, reason: "unavailable", message: msgUnavailable() };
  }
  if (typeof body !== "object" || body === null) return { ok: false, reason: "unavailable", message: msgUnavailable() };
  if (authBodyOk(body)) return { ok: true };
  const text = bodyText(body);
  if (/current|old|incorrect|wrong|mismatch/.test(text)) {
    return { ok: false, reason: "wrong-current", message: t("auth.password.wrongCurrent", "Your current password is not right.") };
  }
  if (/password|weak|policy|length|character/.test(text)) {
    return { ok: false, reason: "password-rejected", message: t("auth.password.notAccepted", "This password was not accepted: {reason}", { reason: iamMessage(body, secrets) }) };
  }
  return { ok: false, reason: "password-rejected", message: t("auth.password.changeNotAccepted", "This change was not accepted: {reason}", { reason: iamMessage(body, secrets) }) };
}
