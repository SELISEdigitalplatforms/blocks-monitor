// Admin -> People on the Blocks host (embedded sign-in, Host A): the admin function is served, the people.* ops run
// through the real router with the caller's own IAM token, and the IAM wire shapes are the real ones (organization-keyed
// roles, zero-based list page, required activation reason). A created account is handed over active.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ACTIVATION_REASON, createCallerIam, iamRoles, usersListBody } from "../../functions/_lib/callerIam";
import { fakeCtx, memoryGateway, runOp, type FakeCtx } from "../../functions/_lib/testing";
import type { SdkFactory } from "../../functions/_lib/sdk";
import { ADMIN_DEFS } from "../../functions/admin/ops";
import { BLOCKS_FUNCTIONS, isBlocksFunction } from "../../server/blocks/host";
import { HOST_A_FUNCTIONS } from "../../server/fnHost/middleware";
import { PASSWORD_NOTE, handOver } from "../../src/blocks/people";

const OWNER = { userId: "owner-1", email: "owner@example.org", roles: ["mf-user", "mf-super-admin"] };
type Body = Record<string, unknown>;

/** A Blocks IAM double: answers as the live IAM does (users list rows carry roles keyed by organization). */
function blocksIam(o: { createdActive?: boolean; activateOk?: boolean } = {}) {
  const users = [
    { itemId: "owner-1", email: "owner@example.org", firstName: "Owner", lastName: "One", roles: { default: ["mf-user", "mf-super-admin"] }, active: true, isVerified: true },
    { itemId: "user-2", email: "member@example.org", firstName: "Mia", lastName: "Member", roles: { default: ["mf-user"] }, active: true, isVerified: true },
  ];
  const calls: { method: string; body: Body }[] = [];
  const users_ = {
    list: vi.fn(async (body: Body) => {
      calls.push({ method: "list", body });
      const filter = (body.filter ?? {}) as { email?: string };
      const rows = filter.email ? users.filter((u) => u.email.includes(filter.email!)) : users;
      return { totalCount: rows.length, data: rows, errors: {} };
    }),
    create: vi.fn(async (body: Body) => {
      calls.push({ method: "create", body: { ...body, password: body.password ? "[set]" : undefined } });
      users.push({ itemId: "new-1", email: String(body.email), firstName: String(body.firstName), lastName: String(body.lastName), roles: { default: body.roles as string[] }, active: o.createdActive === true, isVerified: false });
      return { isSuccess: true, errors: {}, itemId: "new-1" };
    }),
    activate: vi.fn(async (body: Body) => {
      calls.push({ method: "activate", body });
      if (o.activateOk === false || typeof body.reason !== "string" || !body.reason) return { isSuccess: false, errors: { reason: "The Reason field is required." } };
      const u = users.find((x) => x.itemId === body.userId);
      if (u) u.active = true;
      return { isSuccess: true, errors: {} };
    }),
  };
  return { iam: { users: users_ }, calls, users };
}

/** The Blocks host's request context: an IAM identity (no Account mirror) and the caller's own token. */
function blocksCaller(iam: unknown, callerToken: string | null = "caller-access-token"): FakeCtx {
  const ctx = fakeCtx({ ...OWNER, iam, ...(callerToken ? { callerToken } : {}) });
  Object.assign(ctx.platformCtx.context as Body, { identitySource: "iam", displayName: "Owner One" });
  return ctx;
}

const call = (ctx: FakeCtx, op: string, args: Body, gateway = memoryGateway()) => runOp("admin", ADMIN_DEFS, { ctx, gateway, request: { op, args } });

describe("the Blocks host serves the admin function", () => {
  it("has a router for every function the /api/fn host accepts (admin was missing: its calls failed 500 internal)", () => {
    expect([...BLOCKS_FUNCTIONS].sort()).toEqual([...HOST_A_FUNCTIONS].sort());
    expect(isBlocksFunction("admin")).toBe(true);
    expect(isBlocksFunction("engine")).toBe(false);
  });
});

describe("people.list as the signed-in super admin", () => {
  it("lists IAM users with the caller's token and reads organization-keyed roles", async () => {
    const fake = blocksIam();
    const res = await call(blocksCaller(fake.iam), "people.list", { page: 1 });
    expect(res.status).toBe(200);
    const users = res.body.data.users as { userId: string; roles: string[]; active: boolean }[];
    expect(users.map((u) => u.userId)).toEqual(["owner-1", "user-2"]);
    expect(users[0].roles).toEqual(["mf-user", "mf-super-admin"]);
    expect(res.body.data.total).toBe(2);
    expect(fake.calls[0]).toEqual({ method: "list", body: { page: 0, pageSize: 20, filter: {} } });
  });

  it("sends page 2 as IAM's zero-based page 1 and a search as IAM's filter", async () => {
    const fake = blocksIam();
    await call(blocksCaller(fake.iam), "people.list", { page: 2, search: "member@" });
    expect(fake.calls[0].body).toEqual({ page: 1, pageSize: 20, filter: { email: "member@" } });
  });

  it("counts the active super admins from organization-keyed roles", async () => {
    const res = await call(blocksCaller(blocksIam().iam), "people.countSuperAdmins", {});
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  it("is not supported without the caller's token", async () => {
    const res = await call(blocksCaller(blocksIam().iam, null), "people.list", { page: 1 });
    expect(res.body.error.code).toBe("not_supported");
  });

  it("refuses a caller who is not a super admin", async () => {
    const ctx = fakeCtx({ userId: "user-2", email: "member@example.org", roles: ["mf-user"], iam: blocksIam().iam, callerToken: "t" });
    Object.assign(ctx.platformCtx.context as Body, { identitySource: "iam" });
    const res = await call(ctx, "people.list", { page: 1 });
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("forbidden");
  });
});

describe("people.createAccount hands over an active account", () => {
  const person = { email: "New.Person@Example.org", firstName: "New", lastName: "Person" };

  it("activates the user IAM created inactive, with the reason IAM requires, and never writes an Account mirror", async () => {
    const fake = blocksIam({ createdActive: false });
    const gateway = memoryGateway();
    const res = await call(blocksCaller(fake.iam), "people.createAccount", person, gateway);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ userId: "new-1", email: "new.person@example.org", active: true, mustChangePassword: false });
    expect(typeof res.body.data.temporaryPassword).toBe("string");
    expect(res.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    const activate = fake.calls.find((c) => c.method === "activate");
    expect(activate?.body.userId).toBe("new-1");
    expect(String(activate?.body.reason).length).toBeGreaterThan(0);
    expect(fake.users.find((u) => u.itemId === "new-1")?.active).toBe(true);
    expect(fake.calls.find((c) => c.method === "create")?.body).toMatchObject({ email: "new.person@example.org", roles: ["mf-user"], password: "[set]" });
    expect(gateway.rows("Account")).toEqual([]);
    // The one-time password never reaches the Operation record or the audit row.
    const stored = JSON.stringify([gateway.rows("Operation"), gateway.rows("AuditEvent")]);
    expect(stored).not.toContain(res.body.data.temporaryPassword);
  });

  it("does not activate a user IAM already created active", async () => {
    const fake = blocksIam({ createdActive: true });
    const res = await call(blocksCaller(fake.iam), "people.createAccount", person);
    expect(res.body.data.active).toBe(true);
    expect(fake.calls.some((c) => c.method === "activate")).toBe(false);
  });

  it("still shows the password, marked not active, when IAM refuses the activation", async () => {
    const fake = blocksIam({ createdActive: false, activateOk: false });
    const res = await call(blocksCaller(fake.iam), "people.createAccount", person);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
    expect(typeof res.body.data.temporaryPassword).toBe("string");
  });
});

describe("the caller IAM adapter speaks IAM's contract", () => {
  it("reads roles keyed by organization or as a flat list", () => {
    expect(iamRoles({ default: ["mf-user", "mf-super-admin"], other: ["mf-user"] })).toEqual(["mf-user", "mf-super-admin"]);
    expect(iamRoles(["mf-user", 3, "mf-user"])).toEqual(["mf-user"]);
    expect(iamRoles(null)).toEqual([]);
  });

  it("builds the users list request", () => {
    expect(usersListBody({ pageNo: 1, pageSize: 500 })).toEqual({ page: 0, pageSize: 100, filter: {} });
    expect(usersListBody({ pageNo: 3, pageSize: 20, search: " Mia " })).toEqual({ page: 2, pageSize: 20, filter: { name: "Mia" } });
  });

  it("always sends an activation reason", async () => {
    const activate = vi.fn(async () => ({ isSuccess: true, errors: {} }));
    const sdk = (() => ({ iam: { users: { activate } } })) as unknown as SdkFactory;
    const iam = createCallerIam({ sdk, apiUrl: "https://api.example", tenant: "T", token: "tok" });
    expect(await iam.activate("u1")).toEqual({ ok: true });
    expect(await iam.activate("u2", "  Back from leave ")).toEqual({ ok: true });
    expect(activate.mock.calls).toEqual([[{ userId: "u1", reason: DEFAULT_ACTIVATION_REASON }], [{ userId: "u2", reason: "Back from leave" }]]);
  });
});

describe("what the super admin is told after creating an account", () => {
  it("says when the account is not active yet", () => {
    expect(handOver("a@example.org", false, false).message).toMatch(/not active yet/);
  });
  it("only promises a forced password change where the host enforces it", () => {
    expect(handOver("a@example.org", true, true).note).toBe(PASSWORD_NOTE);
    expect(handOver("a@example.org", true, false).note).not.toMatch(/must change/);
    expect(handOver("a@example.org", true, false).message).toMatch(/ready to hand over/);
  });
});
