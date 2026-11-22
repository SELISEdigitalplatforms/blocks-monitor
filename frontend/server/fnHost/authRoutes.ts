// Same-origin /api/auth/* endpoints (connect middleware mounted at '/api/auth'). The browser never sees a token:
// the sealed `mf_session` cookie is written by the session store; this file only routes, checks and shapes answers.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authBodyOk, iamMessage } from "../../src/blocks/iamResult.ts";
import * as iamModule from "./iamAuth.ts";
import type { AccountFlow, IamAuth } from "./iamAuth.ts";
import type { IpLimiter, LoginLimiter } from "./loginLimiter.ts";
import { SECURITY_HEADERS } from "./middleware.ts";
import { isAppCulture } from "../../src/i18n/modules.ts";
import type { SessionStore } from "./sessionStore.ts";
import { parseAccountLink } from "./accountLink.ts";
import type { PasswordGate, PasswordGateState } from "./passwordGate.ts";
import { SignupRefused, type SignupBackend, type SignupFlows } from "./signup.ts";
import { checkPassword, FORM_MIN_MS, FORM_TTL_MS, type SignupMode } from "../../src/domain/signup.ts";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { createIpLimiter } from "./loginLimiter.ts";

export interface AuthDeps {
  appOrigin: string;
  expectedHost?: string;
  configured: { ok: true } | { ok: false; reason: string };
  sessions: SessionStore;
  iam: IamAuth;
  limiter: LoginLimiter;
  flowLimiter: IpLimiter;
  now?(): number;
  log?(line: string): void;
  bodyTimeoutMs?: number;
  passwordGate?: Pick<PasswordGate, "check" | "markChanged">;
  accountLinkHosts?: readonly string[];
  /** Public sign-up, e-mail verification and the reset follow-ups; without it those routes answer 503. */
  signup?: SignupDeps;
}

export interface SignupDeps {
  flows: SignupFlows;
  mode: SignupBackend["mode"];
  /** Key of the form ticket (HMAC); derived from the host's session secret, never sent anywhere. */
  ticketKey: Buffer;
  /** Sign-ups per address (an office behind one address still gets through). */
  signupIpLimiter: IpLimiter;
  /** Every e-mail the routes may cause to one address (sign-up, new link, reset), keyed by the address. */
  mailLimiter: IpLimiter;
  /** New verification links per address. */
  resendIpLimiter: IpLimiter;
  /** Answers that could reveal whether an account exists take at least this long (default 1200 ms, above the usual
   *  IAM create + Data Gateway write + mail hand-over time, so a new address does not answer measurably slower). */
  minAnswerMs?: number;
  /** Signs the person out on every device after a reset (the host's session store). */
  revokeSessions?(userId: string): void;
}

// profileFrom / sanitizeIamBody are pure helpers; an injected IamAuth may carry its own copies.
type Helpers = { profileFrom(u: unknown): unknown; sanitizeIamBody(b: unknown): unknown };
const helpersOf = (iam: IamAuth): Helpers => {
  const mod = iamModule as unknown as Partial<Helpers>;
  const own = iam as unknown as Partial<Helpers>;
  return {
    profileFrom: (own.profileFrom ?? mod.profileFrom) as Helpers["profileFrom"],
    sanitizeIamBody: (own.sanitizeIamBody ?? mod.sanitizeIamBody) as Helpers["sanitizeIamBody"],
  };
};
const isRejected = (e: unknown): boolean =>
  e instanceof iamModule.IamRejected ||
  (e instanceof Error && e.name === "IamRejected" && typeof (e as { status?: unknown }).status === "number");

export const AUTH_MAX_BODY_BYTES = 16384;
const BODY_TIMEOUT_MS = 10_000;

const CAPS: Record<string, number> = {
  email: 254,
  password: 256,
  oldPassword: 256,
  newPassword: 256,
  code: 512,
  link: 2048,
  activationCode: 512,
  userId: 128,
  firstName: 60,
  lastName: 60,
  name: 120,
  organization: 80,
  plan: 32,
  ticket: 200,
  website: 200,
  terms: 8,
  language: 8,
  token: 300,
};

interface RouteDef {
  method: "GET" | "POST";
  required: string[];
  optional?: string[];
}

const ROUTES: Record<string, RouteDef> = {
  "/login": { method: "POST", required: ["email", "password"] },
  "/session": { method: "GET", required: [] },
  "/logout": { method: "POST", required: [] },
  "/logout-all": { method: "POST", required: [] },
  "/password/forgot": { method: "POST", required: ["email"] },
  "/password/reset": { method: "POST", required: ["code", "password"] },
  "/password/change": { method: "POST", required: ["oldPassword", "newPassword"] },
  "/language": { method: "POST", required: ["language"] },
  "/link/parse": { method: "POST", required: ["link"] },
  "/activation/resend": { method: "POST", required: ["userId"] },
  "/activation/validate": { method: "POST", required: ["activationCode"] },
  "/activation/complete": { method: "POST", required: ["code", "password"], optional: ["firstName", "lastName"] },
  "/signup/form": { method: "GET", required: [] },
  "/signup": { method: "POST", required: ["name", "email", "password", "ticket", "terms"], optional: ["organization", "plan", "website"] },
  "/verify": { method: "POST", required: ["token"] },
  "/verify/resend": { method: "POST", required: [], optional: ["email", "token"] },
};

/** The form ticket: when the sign-up form was shown, signed, so a scripted post cannot skip the wait. */
export function formTicket(key: Buffer, issuedAtMs: number): string {
  const t = String(Math.trunc(issuedAtMs));
  return `${t}.${createHmac("sha256", key).update(`signup-form:${t}`).digest("base64url")}`;
}

/** Age of a valid ticket in ms, or null when it is forged or malformed. */
export function ticketAge(key: Buffer, ticket: string, nowMs: number): number | null {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  if (!m) return null;
  const expected = Buffer.from(formTicket(key, Number(m[1])).split(".")[1], "utf8");
  const given = Buffer.from(m[2], "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return nowMs - Number(m[1]);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sign-ups per address and hour: an office or a school behind one address still gets through. */
export const SIGNUP_PER_IP_HOUR = 20;
/** E-mails the public routes may cause to one address per hour (sign-up, new link, reset link). */
export const MAILS_PER_ADDRESS_HOUR = 5;
/** New verification links per address and hour. */
export const RESENDS_PER_IP_HOUR = 30;

/** The sign-up deps with the default budgets; the ticket key is derived from the host's secret (never the secret itself). */
export function createSignupDeps(o: {
  flows: SignupFlows;
  mode: SignupBackend["mode"];
  ticketKey: Buffer;
  revokeSessions?(userId: string): void;
  now?(): number;
  minAnswerMs?: number;
}): SignupDeps {
  const hour = 60 * 60_000;
  return {
    flows: o.flows,
    mode: o.mode,
    ticketKey: Buffer.from(hkdfSync("sha256", o.ticketKey, "madp-factory", "mf_signup_form/v1", 32)),
    signupIpLimiter: createIpLimiter({ limit: SIGNUP_PER_IP_HOUR, windowMs: hour, now: o.now }),
    mailLimiter: createIpLimiter({ limit: MAILS_PER_ADDRESS_HOUR, windowMs: hour, now: o.now }),
    resendIpLimiter: createIpLimiter({ limit: RESENDS_PER_IP_HOUR, windowMs: hour, now: o.now }),
    ...(o.minAnswerMs !== undefined ? { minAnswerMs: o.minAnswerMs } : {}),
    ...(o.revokeSessions ? { revokeSessions: o.revokeSessions } : {}),
  };
}

const RELAY_FLOW: Record<string, AccountFlow> = {
  "/activation/resend": "resendActivation",
  "/activation/validate": "validateActivation",
  "/activation/complete": "activate",
};

class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function readBody(req: IncomingMessage, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new BodyError(408, "timeout"))), timeoutMs);
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > AUTH_MAX_BODY_BYTES) return finish(() => reject(new BodyError(413, "too_large")));
      chunks.push(c);
    });
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
    req.on("error", () => finish(() => reject(new BodyError(400, "invalid_input"))));
    req.on("aborted", () => finish(() => reject(new BodyError(400, "invalid_input"))));
  });
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthMiddleware(
  deps: AuthDeps,
): (req: IncomingMessage, res: ServerResponse, next?: (e?: unknown) => void) => Promise<void> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
  const helpers = helpersOf(deps.iam);
  const minAnswerMs = deps.signup?.minAnswerMs ?? 1200;

  return async (req, res) => {
    const started = now();
    const path = (req.url ?? "").split("?")[0] || "/";
    const method = req.method ?? "GET";
    let status = 0;
    let note = "";

    const send = (st: number, body: unknown, extra?: Record<string, string>, tag?: string) => {
      status = st;
      if (tag) note = tag;
      res.statusCode = st;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(JSON.stringify(body));
    };
    const fail = (st: number, code: string, reason?: string, extra?: Record<string, string>, message?: string) =>
      send(
        st,
        { ok: false, error: { code, ...(reason ? { reason } : {}), ...(message ? { message } : {}) } },
        extra,
        reason ? `${code}/${reason}` : code,
      );
    // answers that must not tell an existing account from a new one take the same minimum time
    const padAnswer = async () => {
      const left = minAnswerMs - Math.max(0, now() - started);
      if (left > 0) await sleep(left);
    };
    const finish = () => {
      try {
        deps.log?.(`[auth] ${method} ${path} ${status} ${Math.max(0, now() - started)}ms${note ? ` ${note}` : ""}`);
      } catch {
        /* logging never breaks a request */
      }
    };

    try {
      await handle();
    } catch (e) {
      if (!res.headersSent && !res.writableEnded) {
        if (e instanceof BodyError) fail(e.status, e.code);
        else fail(503, "unavailable");
      }
    }
    finish();

    async function handle(): Promise<void> {
      const def = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
      if (!def) return fail(404, "not_found");
      if (method !== def.method) return fail(405, "invalid_input", undefined, { allow: def.method });
      if (!deps.configured.ok) return fail(503, "host_not_configured");
      if (deps.expectedHost) {
        const host = headerOf(req, ":authority") ?? headerOf(req, "host");
        if (host !== deps.expectedHost) return fail(403, "forbidden");
      }
      const site = headerOf(req, "sec-fetch-site");
      if (site !== undefined && site !== "same-origin") return fail(403, "forbidden");

      let body: Record<string, string> = {};
      if (def.method === "POST") {
        const origin = headerOf(req, "origin");
        const seen = origin !== undefined ? originOf(origin) : originOf(headerOf(req, "referer"));
        if (seen === null || seen !== deps.appOrigin) return fail(403, "forbidden");
        const ct = (headerOf(req, "content-type") ?? "").split(";")[0].trim().toLowerCase();
        const enc = (headerOf(req, "content-encoding") ?? "identity").trim().toLowerCase();
        if (ct !== "application/json" || enc !== "identity") return fail(400, "invalid_input");
        const len = Number(headerOf(req, "content-length"));
        if (Number.isFinite(len) && len > AUTH_MAX_BODY_BYTES) return fail(413, "too_large");
        const raw = await readBody(req, timeoutMs);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch {
          return fail(400, "invalid_input");
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail(400, "invalid_input");
        const obj = parsed as Record<string, unknown>;
        const allowed = new Set([...def.required, ...(def.optional ?? [])]);
        for (const [k, v] of Object.entries(obj)) {
          if (!allowed.has(k) || typeof v !== "string" || v.length > (CAPS[k] ?? 0)) return fail(400, "invalid_input");
        }
        for (const k of def.required) if (typeof obj[k] !== "string" || obj[k] === "") return fail(400, "invalid_input");
        body = obj as Record<string, string>;
      }

      const ip = req.socket?.remoteAddress ?? "";
      let meUserId = "";
      const profileAnswer = async (accessToken: string, expiresAtMs: number) => {
        const user = await deps.iam.me(accessToken);
        meUserId = typeof user.itemId === "string" ? user.itemId : "";
        if (!user.active) return null;
        return {
          profile: helpers.profileFrom(user),
          expiresInSec: Math.max(0, Math.round((expiresAtMs - now()) / 1000)),
        };
      };

      // Gate state for a signed-in person; without a gate nobody is blocked. Runs beside the profile lookup when the id is known.
      const gateOf = async (accessToken: string, sessionUserId: string, profile: Promise<unknown>): Promise<PasswordGateState> => {
        if (!deps.passwordGate) return "open";
        if (sessionUserId) {
          const [state] = await Promise.all([deps.passwordGate.check(sessionUserId, accessToken), profile]);
          return state;
        }
        await profile;
        return meUserId ? deps.passwordGate.check(meUserId, accessToken) : "unavailable";
      };
      // A failed flag read never fails a sign-in or a session check: the person continues as not forced.
      const gateSafe = (accessToken: string, sessionUserId: string, profile: Promise<unknown>): Promise<PasswordGateState> =>
        gateOf(accessToken, sessionUserId, profile).catch(() => "unavailable" as const);

      // Without a gate the answer is exactly as before (a missing flag reads as false).
      const withFlag = <T extends object>(answer: T, state: PasswordGateState) =>
        deps.passwordGate ? { ...answer, mustChangePassword: state === "blocked" } : answer;

      switch (path) {
        case "/login": {
          const email = body.email.trim();
          const key = email.toLowerCase();
          const gate = deps.limiter.check(ip, key);
          if (!gate.ok) return fail(429, "login_failed", "locked", { "retry-after": String(gate.retryAfterS) });
          const result = await deps.iam.login(email, body.password);
          if (!result.ok) {
            if (result.reason === "credentials" || result.reason === "not-activated") deps.limiter.fail(ip, key);
            return fail(result.reason === "unavailable" ? 503 : 401, "login_failed", result.reason);
          }
          let session;
          try {
            session = deps.sessions.create(req, res, result.tokens);
          } catch {
            return fail(503, "login_failed", "unavailable");
          }
          let answer: Awaited<ReturnType<typeof profileAnswer>> = null;
          let state: PasswordGateState = "open";
          try {
            const profile = profileAnswer(session.accessToken, session.expiresAtMs);
            const settled = profile.catch(() => undefined);
            [answer, state] = await Promise.all([profile, gateSafe(session.accessToken, session.userId, settled)]);
          } catch (error) {
            answer = null;
            if (isRejected(error)) {
              deps.sessions.end(req, res);
              try { await deps.iam.logout(session); } catch { /* never expose credentials or IAM text */ }
              return fail(401, "login_failed", "deactivated");
            }
          }
          if (!answer) {
            deps.sessions.end(req, res);
            return fail(503, "login_failed", "unavailable");
          }
          deps.limiter.succeed(ip, key);
          return send(200, { ok: true, data: withFlag(answer, state) });
        }
        case "/session": {
          const read = await deps.sessions.read(req, res);
          if (read.state === "none" || read.state === "ended") return fail(401, "unauthenticated");
          if (read.state === "unavailable") return fail(503, "unavailable", undefined, { "retry-after": "2" });
          try {
            const profile = profileAnswer(read.session.accessToken, read.session.expiresAtMs);
            const settled = profile.catch(() => undefined);
            const [answer, state] = await Promise.all([profile, gateSafe(read.session.accessToken, read.session.userId, settled)]);
            if (!answer) {
              deps.sessions.end(req, res);
              return fail(401, "unauthenticated");
            }
            return send(200, { ok: true, data: withFlag(answer, state) });
          } catch (e) {
            if (isRejected(e)) {
              deps.sessions.end(req, res);
              return fail(401, "unauthenticated");
            }
            return fail(503, "unavailable");
          }
        }
        case "/logout": {
          const ended = deps.sessions.end(req, res);
          let iam = false;
          if (ended) {
            try {
              iam = (await deps.iam.logout(ended)) === true;
            } catch {
              iam = false;
            }
          }
          return send(200, { ok: true, data: { iam } });
        }
        case "/logout-all": {
          const read = await deps.sessions.read(req, res);
          if (read.state === "none" || read.state === "ended") return fail(401, "unauthenticated");
          if (read.state === "unavailable") return fail(503, "unavailable", undefined, { "retry-after": "2" });
          let iamBody: unknown;
          try {
            iamBody = await deps.iam.logoutAll(read.session.accessToken);
          } catch {
            deps.sessions.end(req, res);
            return fail(503, "unavailable");
          }
          deps.sessions.end(req, res);
          if (authBodyOk(iamBody)) return send(200, { ok: true });
          return fail(200, "iam_refused", undefined, undefined, iamMessage(iamBody));
        }
        case "/password/forgot": {
          const gate = deps.flowLimiter.take(ip);
          const email = body.email.trim().toLowerCase();
          // the per-address budget is taken only for a well-formed address, and its verdict never changes the answer
          const byAddress = gate.ok && EMAIL_SHAPE.test(email) ? (deps.signup?.mailLimiter.take(email) ?? { ok: true as const }) : { ok: false as const };
          if (byAddress.ok) {
            try {
              await deps.iam.relay("recover", { email });
            } catch {
              /* neutral answer */
            }
          }
          await padAnswer();
          return send(200, { ok: true });
        }
        case "/password/reset": {
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          const policy = checkPassword(body.password);
          if (!policy.ok) return send(200, { ok: true, iam: { isSuccess: false, errors: { password: policy.message } } });
          let iamBody: unknown;
          try {
            iamBody = await deps.iam.relay("resetPassword", body);
          } catch {
            return fail(503, "unavailable");
          }
          const clean = helpers.sanitizeIamBody(iamBody) as Record<string, unknown> | null;
          if (authBodyOk(iamBody)) {
            const userId = typeof clean?.userId === "string" ? clean.userId : "";
            if (userId) {
              try {
                deps.signup?.revokeSessions?.(userId);
              } catch {
                /* IAM already ended its sessions; ours end at their next refresh */
              }
              await deps.signup?.flows.passwordChanged(userId).catch(() => undefined);
            } else {
              note = "reset/no-user-id";
            }
          }
          return send(200, { ok: true, iam: clean });
        }
        case "/signup/form": {
          if (!deps.signup) return fail(503, "unavailable");
          const mode = await deps.signup.mode().catch((): SignupMode | null => null);
          if (!mode) return fail(503, "unavailable");
          return send(200, { ok: true, data: { mode, ticket: mode === "open" ? formTicket(deps.signup.ticketKey, now()) : null } });
        }
        case "/signup": {
          const s = deps.signup;
          if (!s) return fail(503, "unavailable");
          const email = body.email.trim().toLowerCase();
          if (!EMAIL_SHAPE.test(email) || email.length > 254) return fail(400, "invalid_input", "email");
          const byIp = s.signupIpLimiter.take(ip);
          if (!byIp.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(byIp.retryAfterS) });
          const mode = await s.mode().catch((): SignupMode | null => null);
          if (!mode) return fail(503, "unavailable");
          if (mode !== "open") return fail(403, "signup_closed");
          const age = ticketAge(s.ticketKey, body.ticket, now());
          if (age === null || age > FORM_TTL_MS) return fail(400, "invalid_input", "form_expired");
          // a filled hidden field or a form sent faster than a person can: answered like a real sign-up, nothing happens
          if ((body.website ?? "") !== "" || age < FORM_MIN_MS) {
            note = "signup/dropped";
            await padAnswer();
            return send(200, { ok: true, data: { mail: "sent" } });
          }
          if (body.terms !== "yes") return fail(400, "invalid_input", "terms");
          if (!body.name.trim()) return fail(400, "invalid_input", "name");
          const policy = checkPassword(body.password, email);
          if (!policy.ok) return fail(400, "invalid_input", "password_policy", undefined, policy.message ?? undefined);
          const byAddress = s.mailLimiter.take(email);
          if (!byAddress.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(byAddress.retryAfterS) });
          let outcome;
          try {
            outcome = await s.flows.signup({ name: body.name, email, password: body.password, organization: body.organization ?? "", plan: body.plan ?? "" });
          } catch (e) {
            if (e instanceof SignupRefused && e.reason === "password") {
              return fail(400, "invalid_input", "password_policy", undefined, "This password was not accepted. Choose another one.");
            }
            return fail(503, "unavailable");
          }
          await padAnswer();
          if (outcome === "mail-failed") return send(200, { ok: true, data: { mail: "not-sent" } });
          return send(200, { ok: true, data: { mail: "sent" } });
        }
        case "/verify": {
          const s = deps.signup;
          if (!s) return fail(503, "unavailable");
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          const r = await s.flows.verify(body.token).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
          if (!r.ok) return r.reason === "unavailable" ? fail(503, "unavailable") : fail(200, "verify_failed", r.reason);
          return send(200, { ok: true, data: { email: r.email, organizationName: r.organizationName, plan: r.planKey, firstName: r.firstName } });
        }
        case "/verify/resend": {
          const s = deps.signup;
          if (!s) return fail(503, "unavailable");
          const email = (body.email ?? "").trim().toLowerCase();
          const token = body.token ?? "";
          if ((email === "") === (token === "")) return fail(400, "invalid_input");
          if (email && !EMAIL_SHAPE.test(email)) return fail(400, "invalid_input", "email");
          const byIp = s.resendIpLimiter.take(ip);
          if (!byIp.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(byIp.retryAfterS) });
          let outcome: "sent" | "mail-failed" | "none" = "none";
          // the address budget is spent only when there is an address; a token names its own row
          const byAddress = email ? s.mailLimiter.take(email) : { ok: true as const };
          if (byAddress.ok) {
            try {
              outcome = await s.flows.resend(email ? { email } : { token });
            } catch {
              return fail(503, "unavailable");
            }
          }
          await padAnswer();
          // the same answer whether or not the address has an account; only a refused mail service is reported
          return send(200, { ok: true, data: { mail: outcome === "mail-failed" ? "not-sent" : "sent" } });
        }
        case "/password/change": {
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          const policy = checkPassword(body.newPassword);
          if (!policy.ok) return send(200, { ok: true, iam: { isSuccess: false, errors: { newPassword: policy.message } } });
          const read = await deps.sessions.read(req, res);
          if (read.state === "none" || read.state === "ended") return fail(401, "unauthenticated");
          if (read.state === "unavailable") return fail(503, "unavailable", undefined, { "retry-after": "2" });
          try {
            const iamBody = await deps.iam.relay("changePassword", body, read.session.accessToken);
            if (authBodyOk(iamBody)) deps.passwordGate?.markChanged(read.session.userId);
            return send(200, { ok: true, iam: helpers.sanitizeIamBody(iamBody) });
          } catch {
            return fail(503, "unavailable");
          }
        }
        case "/language": {
          // the signed-in person's language preference, on their own IAM profile (the session's profile.language)
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          if (!isAppCulture(body.language)) return fail(400, "invalid_input");
          const read = await deps.sessions.read(req, res);
          if (read.state === "none" || read.state === "ended") return fail(401, "unauthenticated");
          if (read.state === "unavailable") return fail(503, "unavailable", undefined, { "retry-after": "2" });
          if (!deps.iam.setLanguage) return fail(503, "unavailable");
          try {
            const saved = await deps.iam.setLanguage(read.session.accessToken, body.language);
            return saved ? send(200, { ok: true, data: { language: body.language } }) : fail(503, "unavailable");
          } catch (e) {
            if (isRejected(e)) {
              deps.sessions.end(req, res);
              return fail(401, "unauthenticated");
            }
            return fail(503, "unavailable");
          }
        }
        case "/link/parse": {
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          const r = parseAccountLink(body.link, deps.accountLinkHosts ?? []);
          if (!r.ok) return fail(200, "invalid_link", r.error, undefined, r.message);
          return send(200, { ok: true, data: r.link });
        }
        default: {
          const gate = deps.flowLimiter.take(ip);
          if (!gate.ok) return fail(429, "rate_limited", undefined, { "retry-after": String(gate.retryAfterS) });
          if (path === "/activation/complete") {
            const policy = checkPassword(body.password);
            if (!policy.ok) return send(200, { ok: true, iam: { isSuccess: false, errors: { password: policy.message } } });
          }
          try {
            const iamBody = await deps.iam.relay(RELAY_FLOW[path], body);
            return send(200, { ok: true, iam: helpers.sanitizeIamBody(iamBody) });
          } catch {
            return fail(503, "unavailable");
          }
        }
      }
    }
  };
}
