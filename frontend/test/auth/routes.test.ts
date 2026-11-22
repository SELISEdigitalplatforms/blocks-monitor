// The /api/auth sign-up, verification and reset routes over a fake IAM and a fake sign-up backend (in memory):
// rate limits per address and per e-mail, the same answer for new and existing addresses, single-use links that expire
// after 24 h, the form ticket and the hidden field, the shared password policy, the invite-only setting, an honest
// answer when the mail service refuses, and logs that never carry an address, a password or a link secret.
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware, createSignupDeps, formTicket, ticketAge, MAILS_PER_ADDRESS_HOUR, SIGNUP_PER_IP_HOUR } from "../../server/fnHost/authRoutes";
import { createIpLimiter, createLoginLimiter } from "../../server/fnHost/loginLimiter";
import { createSignupFlows, sha256, type SignupBackend, type SignupMail, type SignupRecord } from "../../server/fnHost/signup";
import type { IamAuth } from "../../server/fnHost/iamAuth";
import type { SessionStore } from "../../server/fnHost/sessionStore";
import { FORM_MIN_MS, VERIFY_TTL_MS, type SignupMode } from "../../src/domain/signup";

const ORIGIN = "https://factory.example.org";
const HOST = "factory.example.org";
const GOOD = "violet harbor lantern 42";

interface User { userId: string; email: string; firstName: string; active: boolean; password: string }

function fakeBackend(o: { mode?: SignupMode; mailWorks?: boolean } = {}) {
  const users = new Map<string, User>();
  const rows = new Map<string, SignupRecord>();
  const mails: SignupMail[] = [];
  const audits: { action: string; targetId: string; details: Record<string, unknown> }[] = [];
  const state = { mode: o.mode ?? ("open" as SignupMode), mailWorks: o.mailWorks ?? true, n: 0 };
  const backend: SignupBackend = {
    mode: async () => state.mode,
    findUser: async (email) => {
      const u = [...users.values()].find((x) => x.email === email);
      return u ? { userId: u.userId, active: u.active, firstName: u.firstName } : null;
    },
    createUser: async (u) => {
      if ([...users.values()].some((x) => x.email === u.email)) return { ok: false, reason: "exists" };
      const userId = `user-${++state.n}`;
      users.set(userId, { userId, email: u.email, firstName: u.firstName, active: false, password: u.password });
      return { ok: true, userId };
    },
    activateUser: async (userId) => {
      const u = users.get(userId);
      if (!u) return false;
      u.active = true;
      return true;
    },
    userById: async (userId) => {
      const u = users.get(userId);
      return u ? { email: u.email, firstName: u.firstName } : null;
    },
    signups: {
      get: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
      byEmail: async (email) => {
        const list = [...rows.values()].filter((r) => r.email === email);
        return list.length ? { ...list[list.length - 1] } : null;
      },
      create: async (r) => {
        const id = `signup${String(++state.n).padStart(6, "0")}`;
        rows.set(id, { ...r, id });
        return id;
      },
      update: async (id, patch) => {
        rows.set(id, { ...rows.get(id)!, ...patch });
      },
    },
    sendMail: async (m) => {
      if (!state.mailWorks) return false;
      mails.push(m);
      return true;
    },
    audit: async (e) => {
      audits.push({ action: e.action, targetId: e.targetId, details: e.details });
    },
  };
  return { backend, users, rows, mails, audits, state };
}

function fakeIam(relayAnswers: Record<string, unknown> = {}) {
  const calls: { flow: string; payload: Record<string, unknown> }[] = [];
  const iam: IamAuth = {
    login: async () => ({ ok: false, reason: "credentials" }),
    refresh: async () => ({ ok: false, refused: true }),
    logout: async () => true,
    logoutAll: async () => ({ isSuccess: true }),
    me: async () => { throw new Error("not used"); },
    relay: async (flow, payload) => {
      calls.push({ flow, payload });
      return relayAnswers[flow] ?? { isSuccess: true };
    },
  };
  return { iam, calls };
}

const sessions = { create: () => { throw new Error("not used"); }, read: async () => ({ state: "none" }), end: () => null, revokeUser: () => undefined } as unknown as SessionStore;

function setup(o: { mode?: SignupMode; mailWorks?: boolean; relay?: Record<string, unknown> } = {}) {
  let clock = Date.parse("2026-11-09T10:00:00.000Z");
  const now = () => clock;
  const fake = fakeBackend(o);
  const { iam, calls } = fakeIam(o.relay);
  const logs: string[] = [];
  const revoked: string[] = [];
  const key = Buffer.alloc(32, 7);
  const signup = createSignupDeps({
    flows: createSignupFlows({ backend: fake.backend, appOrigin: ORIGIN, now, log: (l) => logs.push(l) }),
    mode: fake.backend.mode,
    ticketKey: key,
    now,
    minAnswerMs: 0,
    revokeSessions: (id) => revoked.push(id),
  });
  const handler = createAuthMiddleware({
    appOrigin: ORIGIN, expectedHost: HOST, configured: { ok: true }, sessions, iam,
    limiter: createLoginLimiter({ now }), flowLimiter: createIpLimiter({ limit: 1000, windowMs: 60_000, now }),
    now, log: (l) => logs.push(l), signup,
  });
  async function call(method: "GET" | "POST", path: string, body?: Record<string, unknown>, ip = "203.0.113.7") {
    const raw = Buffer.from(body ? JSON.stringify(body) : "");
    const req = Readable.from(method === "POST" ? [raw] : []) as unknown as IncomingMessage & Record<string, unknown>;
    Object.assign(req, {
      method, url: path,
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", "content-length": String(raw.length), "sec-fetch-site": "same-origin" },
      socket: { remoteAddress: ip },
    });
    return new Promise<{ status: number; body: any }>((resolve) => {
      const res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader() {}, end(text: string) { resolve({ status: res.statusCode, body: JSON.parse(text) }); } };
      void handler(req, res as unknown as ServerResponse);
    });
  }
  /** A form shown long enough ago that a person could have filled it. */
  const ticket = () => formTicket(signup.ticketKey, now() - FORM_MIN_MS - 1000);
  const form = (over: Record<string, unknown> = {}) => ({
    name: "Ada Lovelace", email: "ada@example.org", password: GOOD, ticket: ticket(), terms: "yes", ...over,
  });
  const linkOf = (m: SignupMail) => ("link" in m.body ? m.body.link : "");
  const tokenOf = (m: SignupMail) => new URL(linkOf(m)).searchParams.get("token") ?? "";
  return { ...fake, calls, logs, revoked, call, form, ticket, tokenOf, linkOf, advance: (ms: number) => { clock += ms; }, now, signup };
}

describe("sign-up form", () => {
  it("hands out a signed form ticket while sign-up is open, none when it is invite-only", async () => {
    const t = setup();
    const r = await t.call("GET", "/signup/form");
    expect(r.status).toBe(200);
    expect(r.body.data.mode).toBe("open");
    expect(ticketAge(t.signup.ticketKey, r.body.data.ticket, t.now())).toBe(0);
    t.state.mode = "invite-only";
    const closed = await t.call("GET", "/signup/form");
    expect(closed.body.data).toEqual({ mode: "invite-only", ticket: null });
  });

  it("refuses a forged or stale ticket, so a script cannot skip the form", async () => {
    const t = setup();
    expect(ticketAge(t.signup.ticketKey, "1762682400000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", t.now())).toBeNull();
    const forged = await t.call("POST", "/signup", t.form({ ticket: "1762682400000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }));
    expect(forged.status).toBe(400);
    expect(forged.body.error.reason).toBe("form_expired");
    const old = await t.call("POST", "/signup", t.form({ ticket: formTicket(t.signup.ticketKey, t.now() - 3 * 60 * 60_000) }));
    expect(old.body.error.reason).toBe("form_expired");
    expect(t.users.size).toBe(0);
  });
});

describe("sign-up", () => {
  it("creates the identity inactive, stores only the link's hash and mails a 24-hour link", async () => {
    const t = setup();
    const r = await t.call("POST", "/signup", t.form({ organization: "Analytical Engines", plan: "classic" }));
    expect(r).toEqual({ status: 200, body: { ok: true, data: { mail: "sent" } } });
    const [user] = [...t.users.values()];
    expect(user).toMatchObject({ email: "ada@example.org", firstName: "Ada", active: false });
    const [row] = [...t.rows.values()];
    expect(row).toMatchObject({ userId: user.userId, status: "pending", organizationName: "Analytical Engines", planKey: "classic", sentCount: 1 });
    expect(Date.parse(row.tokenExpiresAt) - t.now()).toBe(VERIFY_TTL_MS);
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0].template).toBe("mf-verify-email");
    expect(t.linkOf(t.mails[0]).startsWith(`${ORIGIN}/activate?token=`)).toBe(true);
    const secret = t.tokenOf(t.mails[0]).split(".")[1];
    expect(row.tokenHash).toBe(sha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(t.audits.map((a) => a.action)).toEqual(["signup.created"]);
  });

  it("gives the default organization name and drops an unknown-shaped plan", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form({ name: "James", plan: "<script>" }));
    expect([...t.rows.values()][0]).toMatchObject({ organizationName: "James' organization", planKey: "" });
  });

  it("answers an existing address exactly like a new one and tells only the owner of the address", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    await t.call("POST", "/verify", { token: t.tokenOf(t.mails[0]) });
    const again = await t.call("POST", "/signup", t.form({ name: "Someone Else", password: "another long passphrase 7" }));
    expect(again).toEqual({ status: 200, body: { ok: true, data: { mail: "sent" } } });
    expect(t.users.size).toBe(1);
    expect(t.mails.at(-1)!.template).toBe("mf-account-exists");
    expect(t.mails.at(-1)!.to).toBe("ada@example.org");
    expect([...t.users.values()][0].password).toBe(GOOD);
  });

  it("sends a fresh link instead when an unconfirmed sign-up is repeated, and the older link stops working", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    const first = t.tokenOf(t.mails[0]);
    await t.call("POST", "/signup", t.form());
    expect(t.users.size).toBe(1);
    expect(t.mails.map((m) => m.template)).toEqual(["mf-verify-email", "mf-verify-email"]);
    expect((await t.call("POST", "/verify", { token: first })).body.error.reason).toBe("invalid");
    expect((await t.call("POST", "/verify", { token: t.tokenOf(t.mails[1]) })).body.ok).toBe(true);
  });

  it("drops a filled hidden field or a too-fast form silently, with the normal answer", async () => {
    const t = setup();
    const bot = await t.call("POST", "/signup", t.form({ website: "https://spam.example" }));
    expect(bot).toEqual({ status: 200, body: { ok: true, data: { mail: "sent" } } });
    const fast = await t.call("POST", "/signup", t.form({ ticket: formTicket(t.signup.ticketKey, t.now() - 500) }));
    expect(fast.body).toEqual({ ok: true, data: { mail: "sent" } });
    expect(t.users.size).toBe(0);
    expect(t.mails).toHaveLength(0);
    expect(t.logs.some((l) => l.includes("signup/dropped"))).toBe(true);
  });

  it("enforces the password policy on the server: length, common passwords, the e-mail address", async () => {
    const t = setup();
    for (const password of ["short", "password1234!", "123456789012", "qwertyuiopas", "ada.lovelace@example.org", "Ada.Lovelace2026"]) {
      const r = await t.call("POST", "/signup", t.form({ email: "ada.lovelace@example.org", password }));
      expect(r.status, password).toBe(400);
      expect(r.body.error.reason).toBe("password_policy");
      expect(typeof r.body.error.message).toBe("string");
    }
    expect(t.users.size).toBe(0);
  });

  it("needs the terms accepted, a name and a valid address", async () => {
    const t = setup();
    expect((await t.call("POST", "/signup", t.form({ terms: "no" }))).body.error.reason).toBe("terms");
    expect((await t.call("POST", "/signup", t.form({ name: "   " }))).body.error.reason).toBe("name");
    expect((await t.call("POST", "/signup", t.form({ email: "not-an-address" }))).body.error.reason).toBe("email");
    expect(t.users.size).toBe(0);
  });

  it("is closed while the platform is invite-only", async () => {
    const t = setup({ mode: "invite-only" });
    const r = await t.call("POST", "/signup", t.form());
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("signup_closed");
    expect(t.users.size).toBe(0);
  });

  it("limits sign-ups per address and e-mails per e-mail address", async () => {
    const t = setup();
    for (let i = 0; i < MAILS_PER_ADDRESS_HOUR; i++) expect((await t.call("POST", "/signup", t.form())).status).toBe(200);
    const sixth = await t.call("POST", "/signup", t.form());
    expect(sixth.status).toBe(429);
    expect(Number(sixth.body.error ? 1 : 0)).toBe(1);

    const u = setup();
    for (let i = 0; i < SIGNUP_PER_IP_HOUR; i++) {
      expect((await u.call("POST", "/signup", u.form({ email: `p${i}@example.org` }))).status).toBe(200);
    }
    const over = await u.call("POST", "/signup", u.form({ email: "late@example.org" }));
    expect(over.status).toBe(429);
    expect((await u.call("POST", "/signup", u.form({ email: "late@example.org" }), "198.51.100.9")).status).toBe(200);
    u.advance(60 * 60_000 + 1);
    expect((await u.call("POST", "/signup", u.form({ email: "later@example.org" }))).status).toBe(200);
  });

  it("says plainly when the mail service refuses, and logs it without the address", async () => {
    const t = setup({ mailWorks: false });
    const r = await t.call("POST", "/signup", t.form());
    expect(r.body).toEqual({ ok: true, data: { mail: "not-sent" } });
    expect(t.logs.some((l) => l.includes("not accepted by the mail service") && l.includes("example.org"))).toBe(true);
    for (const l of t.logs) {
      expect(l).not.toContain("ada@");
      expect(l).not.toContain(GOOD);
    }
  });
});

describe("verification link", () => {
  it("activates once; a second use is 'used' and never activates again", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form({ plan: "speed", organization: "Engines" }));
    const token = t.tokenOf(t.mails[0]);
    const r = await t.call("POST", "/verify", { token });
    expect(r.body).toEqual({ ok: true, data: { email: "ada@example.org", organizationName: "Engines", plan: "speed", firstName: "Ada" } });
    expect([...t.users.values()][0].active).toBe(true);
    expect([...t.rows.values()][0]).toMatchObject({ status: "verified", tokenHash: "" });
    const again = await t.call("POST", "/verify", { token });
    expect(again.body.error).toMatchObject({ code: "verify_failed", reason: "used" });
    expect(t.audits.map((a) => a.action)).toEqual(["signup.created", "signup.verified"]);
  });

  it("expires after 24 hours; the expired link can ask for a new one, which works", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    const token = t.tokenOf(t.mails[0]);
    t.advance(VERIFY_TTL_MS + 1);
    expect((await t.call("POST", "/verify", { token })).body.error.reason).toBe("expired");
    expect([...t.users.values()][0].active).toBe(false);
    const resent = await t.call("POST", "/verify/resend", { token });
    expect(resent.body).toEqual({ ok: true, data: { mail: "sent" } });
    expect((await t.call("POST", "/verify", { token })).body.error.reason).toBe("invalid");
    expect((await t.call("POST", "/verify", { token: t.tokenOf(t.mails[1]) })).body.ok).toBe(true);
  });

  it("refuses a wrong secret, an unknown id and a malformed token alike", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    const [id] = t.tokenOf(t.mails[0]).split(".");
    for (const token of [`${id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, "signup999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "nonsense"]) {
      const r = await t.call("POST", "/verify", { token });
      expect(r.body.error.reason, token).toBe("invalid");
    }
    expect([...t.users.values()][0].active).toBe(false);
  });

  it("keeps the link when IAM cannot activate, so the person can try again", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    const token = t.tokenOf(t.mails[0]);
    const activate = t.backend.activateUser;
    t.backend.activateUser = async () => false;
    expect((await t.call("POST", "/verify", { token })).status).toBe(503);
    t.backend.activateUser = activate;
    expect((await t.call("POST", "/verify", { token })).body.ok).toBe(true);
  });
});

describe("new verification link by address", () => {
  it("answers the same for an unknown address, a confirmed one and a waiting one; only the waiting one gets mail", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    await t.call("POST", "/signup", t.form({ email: "grace@example.org", name: "Grace Hopper" }));
    await t.call("POST", "/verify", { token: t.tokenOf(t.mails[1]) });
    const before = t.mails.length;
    const unknown = await t.call("POST", "/verify/resend", { email: "nobody@example.org" });
    const confirmed = await t.call("POST", "/verify/resend", { email: "grace@example.org" });
    const waiting = await t.call("POST", "/verify/resend", { email: "ada@example.org" });
    expect(unknown.body).toEqual(waiting.body);
    expect(confirmed.body).toEqual(waiting.body);
    expect(t.mails.length - before).toBe(1);
    expect(t.mails.at(-1)!.to).toBe("ada@example.org");
  });

  it("takes either an address or a link, never both or none", async () => {
    const t = setup();
    expect((await t.call("POST", "/verify/resend", {})).status).toBe(400);
    expect((await t.call("POST", "/verify/resend", { email: "a@example.org", token: "x" })).status).toBe(400);
  });

  it("limits new links per e-mail address without saying so to anyone else", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    for (let i = 1; i < MAILS_PER_ADDRESS_HOUR; i++) await t.call("POST", "/verify/resend", { email: "ada@example.org" });
    const sent = t.mails.length;
    const over = await t.call("POST", "/verify/resend", { email: "ada@example.org" });
    expect(over.body).toEqual({ ok: true, data: { mail: "sent" } });
    expect(t.mails.length).toBe(sent);
  });
});

describe("forgot and reset password", () => {
  it("answers 'ok' for every address and limits reset mails per address silently", async () => {
    const t = setup();
    for (let i = 0; i < MAILS_PER_ADDRESS_HOUR + 2; i++) {
      expect((await t.call("POST", "/password/forgot", { email: "ada@example.org" })).body).toEqual({ ok: true });
    }
    expect(t.calls.filter((c) => c.flow === "recover")).toHaveLength(MAILS_PER_ADDRESS_HOUR);
    expect((await t.call("POST", "/password/forgot", { email: "nobody@example.org" })).body).toEqual({ ok: true });
  });

  it("checks the policy before IAM sees the new password", async () => {
    const t = setup();
    const r = await t.call("POST", "/password/reset", { code: "reset-code-1", password: "password1234" });
    expect(r.body.iam.isSuccess).toBe(false);
    expect(Object.keys(r.body.iam.errors)).toEqual(["password"]);
    expect(t.calls).toHaveLength(0);
  });

  it("after a reset: signs the person out everywhere, mails the notice and audits it", async () => {
    const t = setup({ relay: { resetPassword: { isSuccess: true, userId: "user-1" } } });
    await t.call("POST", "/signup", t.form());
    await t.call("POST", "/verify", { token: t.tokenOf(t.mails[0]) });
    const r = await t.call("POST", "/password/reset", { code: "reset-code-1", password: "a brand new passphrase" });
    expect(r.body.ok).toBe(true);
    expect(r.body.iam.isSuccess).toBe(true);
    expect(t.revoked).toEqual(["user-1"]);
    const notice = t.mails.at(-1)!;
    expect(notice).toMatchObject({ template: "mf-password-changed", to: "ada@example.org" });
    expect(t.audits.at(-1)!.action).toBe("account.passwordReset");
  });

  it("a refused reset changes nothing else", async () => {
    const t = setup({ relay: { resetPassword: { isSuccess: false, errors: { code: "expired" } } } });
    const r = await t.call("POST", "/password/reset", { code: "old-code", password: "a brand new passphrase" });
    expect(r.body.iam.isSuccess).toBe(false);
    expect(t.revoked).toEqual([]);
    expect(t.mails).toHaveLength(0);
  });
});

describe("answer time", () => {
  it("pads the answers that could tell a new address from a taken one", async () => {
    const fake = fakeBackend();
    const { iam } = fakeIam();
    const handler = createAuthMiddleware({
      appOrigin: ORIGIN, expectedHost: HOST, configured: { ok: true }, sessions, iam,
      limiter: createLoginLimiter(), flowLimiter: createIpLimiter({ limit: 100, windowMs: 60_000 }),
      signup: createSignupDeps({ flows: createSignupFlows({ backend: fake.backend, appOrigin: ORIGIN }), mode: fake.backend.mode, ticketKey: Buffer.alloc(32, 1), minAnswerMs: 120 }),
    });
    const raw = Buffer.from(JSON.stringify({ email: "nobody@example.org" }));
    const req = Readable.from([raw]) as unknown as IncomingMessage;
    Object.assign(req, { method: "POST", url: "/password/forgot", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" }, socket: { remoteAddress: "203.0.113.9" } });
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader() {}, end() { resolve(); } };
      void handler(req, res as unknown as ServerResponse);
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });
});

describe("logs", () => {
  it("never carry an address, a password or a link", async () => {
    const t = setup();
    await t.call("POST", "/signup", t.form());
    const token = t.tokenOf(t.mails[0]);
    await t.call("POST", "/verify", { token });
    await t.call("POST", "/verify/resend", { email: "ada@example.org" });
    await t.call("POST", "/password/forgot", { email: "ada@example.org" });
    const text = t.logs.join("\n");
    expect(text).not.toContain("ada@example.org");
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain(token.split(".")[1]);
  });
});
