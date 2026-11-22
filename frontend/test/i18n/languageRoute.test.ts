// The language as the signed-in person's preference: POST /api/auth/language (a session, one of the app's languages,
// saved on the person's own profile), the Blocks IAM profile update (the names kept), the local store, and the
// session profile's language.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../../server/fnHost/authRoutes";
import { createIpLimiter, createLoginLimiter } from "../../server/fnHost/loginLimiter";
import { IamRejected, profileFrom, type IamAuth } from "../../server/fnHost/iamAuth";
import type { SessionStore } from "../../server/fnHost/sessionStore";
import { createBlocksIam } from "../../server/blocks/iam";
import { openDb } from "../../server/local/db";
import { createLocalIamAuth } from "../../server/local/iam/auth";
import { createUser, issueTokens } from "../../server/local/iam/store";

const ORIGIN = "https://factory.example.org";
const HOST = "factory.example.org";

function setup(o: { session?: "ok" | "none" | "unavailable"; setLanguage?: IamAuth["setLanguage"] | null } = {}) {
  const saved: { token: string; language: string }[] = [];
  const ended: string[] = [];
  const iam: IamAuth = {
    login: async () => ({ ok: false, reason: "credentials" }),
    refresh: async () => ({ ok: false, refused: true }),
    logout: async () => true,
    logoutAll: async () => ({ isSuccess: true }),
    me: async () => { throw new Error("not used"); },
    relay: async () => ({ isSuccess: true }),
    ...(o.setLanguage === null ? {} : { setLanguage: o.setLanguage ?? (async (token, language) => { saved.push({ token, language }); return true; }) }),
  };
  const state = o.session ?? "ok";
  const sessions = {
    create: () => { throw new Error("not used"); },
    read: async () => (state === "ok" ? { state: "ok", session: { accessToken: "opaque-access", userId: "user-1", sid: "s1", expiresAtMs: Date.now() + 60_000 } } : { state }),
    end: () => { ended.push("ended"); return null; },
    revokeUser: () => undefined,
  } as unknown as SessionStore;
  const handler = createAuthMiddleware({
    appOrigin: ORIGIN, expectedHost: HOST, configured: { ok: true }, sessions, iam,
    limiter: createLoginLimiter(), flowLimiter: createIpLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  async function call(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const raw = Buffer.from(JSON.stringify(body));
    const req = Readable.from([raw]) as unknown as IncomingMessage & Record<string, unknown>;
    Object.assign(req, {
      method: "POST", url: "/language",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", "content-length": String(raw.length), "sec-fetch-site": "same-origin", ...headers },
      socket: { remoteAddress: "203.0.113.7" },
    });
    return new Promise<{ status: number; body: any }>((resolve) => {
      const res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader() {}, end(text: string) { resolve({ status: res.statusCode, body: JSON.parse(text) }); } };
      void handler(req, res as unknown as ServerResponse);
    });
  }
  return { call, saved, ended };
}

describe("POST /api/auth/language", () => {
  it("saves one of the app's languages on the signed-in person's profile", async () => {
    const t = setup();
    const r = await t.call({ language: "de-CH" });
    expect(r).toEqual({ status: 200, body: { ok: true, data: { language: "de-CH" } } });
    expect(t.saved).toEqual([{ token: "opaque-access", language: "de-CH" }]);
  });

  it("refuses anything else, a missing session and another origin", async () => {
    const t = setup();
    expect((await t.call({ language: "fr-CH" })).status).toBe(400);
    expect((await t.call({ language: "de-CH", extra: "x" })).status).toBe(400);
    expect((await t.call({})).status).toBe(400);
    expect((await t.call({ language: "de-CH" }, { origin: "https://evil.example.org" })).status).toBe(403);
    expect(t.saved).toEqual([]);
    expect((await setup({ session: "none" }).call({ language: "de-CH" })).status).toBe(401);
    expect((await setup({ session: "unavailable" }).call({ language: "de-CH" })).status).toBe(503);
  });

  it("ends a session IAM no longer accepts and answers 503 when the profile cannot be saved", async () => {
    const rejected = setup({ setLanguage: async () => { throw new IamRejected(401); } });
    expect((await rejected.call({ language: "en" })).status).toBe(401);
    expect(rejected.ended).toEqual(["ended"]);
    const down = setup({ setLanguage: async () => { throw new Error("upstream token xyz"); } });
    const r = await down.call({ language: "en" });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("xyz");
    expect((await setup({ setLanguage: null }).call({ language: "en" })).status).toBe(503);
  });
});

describe("the profile's language", () => {
  it("comes back as an app culture on the session profile", () => {
    const base = { itemId: "u", email: "a@example.org", firstName: "A", lastName: "B", displayName: "", roles: [], permissions: [], active: true };
    expect(profileFrom({ ...base, language: "de-CH" }).language).toBe("de-CH");
    expect(profileFrom({ ...base, language: "en-US" }).language).toBe("en");
    expect(profileFrom(base).language).toBeNull();
  });

  it("Blocks IAM: updates the person's own profile with the language and the names IAM holds", async () => {
    const user = { itemId: "user-1", email: "user@example.org", firstName: "Ada", lastName: "Lovelace", roles: [], permissions: [], active: true, language: "en-US" };
    const sent: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith("/iam/me") && (init?.method ?? "GET") === "GET") return Response.json({ data: user, errors: null });
      if (p.endsWith("/iam/me")) { sent.push(JSON.parse(String(init?.body))); return Response.json({ isSuccess: true, errors: null }); }
      throw new Error(`unexpected ${p}`);
    });
    const iam = createBlocksIam({ apiUrl: "https://blocksapi.example.org", tenant: "t", clientId: "c", clientSecret: "s" }, fetcher);
    expect(await iam.setLanguage!("opaque-access", "de-CH")).toBe(true);
    expect(sent).toEqual([{ firstName: "Ada", lastName: "Lovelace", language: "de-CH" }]);
    expect((await iam.me("opaque-access")).language).toBe("en-US");
  });

  it("local store: kept per person and read back by me()", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-i18n-local-"));
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
    const db = openDb(path.join(dir, "factory.db"));
    const u = createUser(db, { email: "ada@example.org", firstName: "Ada", lastName: "Lovelace", roles: ["mf-user"] });
    const { accessToken } = issueTokens(db, u.userId);
    const iam = createLocalIamAuth({ db, appOrigin: () => ORIGIN });
    expect((await iam.me(accessToken)).language).toBeUndefined();
    expect(await iam.setLanguage!(accessToken, "de-CH")).toBe(true);
    expect((await iam.me(accessToken)).language).toBe("de-CH");
    expect(await iam.setLanguage!(accessToken, "en")).toBe(true);
    expect(profileFrom(await iam.me(accessToken)).language).toBe("en");
    await expect(iam.setLanguage!("not-a-token", "en")).rejects.toMatchObject({ status: 401 });
  });
});
