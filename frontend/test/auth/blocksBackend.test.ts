// The Blocks host's sign-up backend over a fake SDK: the service identity creates the IAM user with the person's role,
// reads it back by exact address, activates it with a reason, sends mail by purpose, and turns every refusal into an
// honest answer (taken address, password refused, IAM or mail unavailable) without the password in any log line.
import { describe, expect, it } from "vitest";
import { createBlocksSignupBackend } from "../../server/blocks/signup";
import type { RawGateway } from "../../functions/_lib/gateway";
import { resetServiceTokens } from "../../functions/_lib/serviceToken";

const ENV = { apiUrl: "https://api.example.org", tenant: "TENANT", clientId: "svc", clientSecret: "svc-secret-value-123" };

function fakeSdk(o: { create?: unknown; list?: unknown[]; activate?: unknown; mail?: unknown; mailThrows?: boolean } = {}) {
  const calls: { what: string; body: unknown }[] = [];
  const sdk = (() => ({
    auth: { oidc: { clientCredentials: async () => ({ access_token: "aaa.bbb.ccc", expires_in: 300 }) } },
    iam: {
      users: {
        create: async (b: unknown) => { calls.push({ what: "create", body: b }); return o.create ?? { isSuccess: true, data: { itemId: "u-1" } }; },
        list: async (b: unknown) => { calls.push({ what: "list", body: b }); return { isSuccess: true, data: o.list ?? [] }; },
        activate: async (b: unknown) => { calls.push({ what: "activate", body: b }); return o.activate ?? { isSuccess: true }; },
        get: async (id: string) => ({ isSuccess: true, data: { itemId: id, email: "Ada@Example.org", firstName: "Ada" } }),
      },
    },
    mail: {
      send: async (b: unknown) => {
        calls.push({ what: "mail", body: b });
        if (o.mailThrows) throw Object.assign(new Error("x"), { status: 403 });
        return o.mail ?? { isSuccess: true };
      },
    },
  })) as never;
  return { sdk, calls };
}

function fakeGateway(rows: Record<string, unknown>[] = []): RawGateway & { finds: number } {
  const g = {
    finds: 0,
    get: async () => null,
    find: async () => { g.finds += 1; return { items: rows, totalCount: rows.length }; },
    findAll: async () => [],
    insert: async () => ({ created: true, itemId: "row-1" }),
    insertMany: async () => ({ created: 0, existing: 0 }),
    update: async () => undefined,
    updateMany: async () => ({ matched: 0 }),
    remove: async () => undefined,
  };
  return g;
}

describe("Blocks sign-up backend", () => {
  it("creates the IAM user with the person's role and password, by the service identity", async () => {
    resetServiceTokens();
    const f = fakeSdk();
    const b = createBlocksSignupBackend(ENV, { sdk: f.sdk, gateway: fakeGateway() });
    expect(await b.createUser({ email: "ada@example.org", firstName: "Ada", lastName: "Lovelace", password: "violet harbor lantern" })).toEqual({ ok: true, userId: "u-1" });
    expect(f.calls[0]).toEqual({ what: "create", body: { email: "ada@example.org", firstName: "Ada", lastName: "Lovelace", roles: ["mf-user"], password: "violet harbor lantern" } });
  });

  it("maps IAM refusals: taken address, refused password, anything else unavailable (logged without the password)", async () => {
    const logs: string[] = [];
    for (const [errors, reason] of [[{ email: "User already exists" }, "exists"], [{ password: "Password too weak" }, "password"], [{ x: "Forbidden" }, "unavailable"]] as const) {
      resetServiceTokens();
      const f = fakeSdk({ create: { isSuccess: false, status: 403, errors } });
      const b = createBlocksSignupBackend(ENV, { sdk: f.sdk, gateway: fakeGateway(), log: (l) => logs.push(l) });
      expect(await b.createUser({ email: "a@example.org", firstName: "A", lastName: "", password: "violet harbor lantern" })).toEqual({ ok: false, reason });
    }
    expect(logs.join("\n")).not.toContain("violet harbor lantern");
  });

  it("finds a user by the exact address only, and activates with a reason", async () => {
    resetServiceTokens();
    const f = fakeSdk({ list: [{ itemId: "u-2", email: "ada.lovelace@example.org", active: true }, { itemId: "u-1", email: "Ada@example.org", active: false, firstName: "Ada" }] });
    const b = createBlocksSignupBackend(ENV, { sdk: f.sdk, gateway: fakeGateway() });
    expect(await b.findUser("ada@example.org")).toEqual({ userId: "u-1", active: false, firstName: "Ada" });
    expect(await b.activateUser("u-1")).toBe(true);
    expect(f.calls.find((c) => c.what === "activate")?.body).toEqual({ userId: "u-1", reason: "Email address verified at sign-up" });
    expect(await b.userById("u-1")).toEqual({ email: "ada@example.org", firstName: "Ada" });
  });

  it("sends mail by purpose and says false when Blocks Mail refuses or fails", async () => {
    resetServiceTokens();
    const ok = fakeSdk();
    const mail = { template: "mf-verify-email" as const, to: "ada@example.org", subject: {}, body: { name: "Ada", link: "https://x/activate?token=a.b", validFor: "24 hours" } };
    expect(await createBlocksSignupBackend(ENV, { sdk: ok.sdk, gateway: fakeGateway() }).sendMail(mail)).toBe(true);
    expect(ok.calls.at(-1)).toEqual({ what: "mail", body: { to: ["ada@example.org"], purpose: "mf-verify-email", language: "en-US", subjectDataContext: {}, bodyDataContext: mail.body } });
    resetServiceTokens();
    expect(await createBlocksSignupBackend(ENV, { sdk: fakeSdk({ mail: { isSuccess: false, errors: { config: "No default" } } }).sdk, gateway: fakeGateway() }).sendMail(mail)).toBe(false);
    resetServiceTokens();
    const logs: string[] = [];
    expect(await createBlocksSignupBackend(ENV, { sdk: fakeSdk({ mailThrows: true }).sdk, gateway: fakeGateway(), log: (l) => logs.push(l) }).sendMail(mail)).toBe(false);
    expect(logs).toEqual(["[auth] Blocks Mail did not take the mf-verify-email e-mail (status 403)"]);
  });

  it("reads the sign-up mode once per 15 seconds", async () => {
    resetServiceTokens();
    let t = 0;
    const g = fakeGateway([{ ItemId: "s", Key: "auth.signup", ValueJson: "\"invite-only\"" }]);
    const b = createBlocksSignupBackend(ENV, { sdk: fakeSdk().sdk, gateway: g, now: () => t });
    expect(await b.mode()).toBe("invite-only");
    expect(await b.mode()).toBe("invite-only");
    expect(g.finds).toBe(1);
    t += 15_001;
    await b.mode();
    expect(g.finds).toBe(2);
  });
});
