// The iam.* admin ops through the real admin router with Blocks OS IAM held in memory: who may read the status, roles,
// permissions and a person's access (platform.roles.manage or platform.people.manage), who may change roles, check and
// apply a sync or switch the source (platform admins), and the plain answers when IAM is not there or can't be reached.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { ADMIN_DEFS } from "../../functions/admin/ops";
import type { IamDirectory, IamDirectoryRole } from "../../functions/workspace/ops/_shared/ports";
import { VIEW_OPS } from "../../src/blocks/fnKinds";

type Who = { userId: string; email: string; roles?: string[] };
const SUPER: Who = { userId: "super-1", email: "super@example.org", roles: ["mf-user", "mf-super-admin"] };
const PLATFORM_ADMIN: Who = { userId: "padmin-1", email: "padmin@example.org" };
const ROLES_DESK: Who = { userId: "rolesdesk-1", email: "rolesdesk@example.org" };
const PEOPLE_DESK: Who = { userId: "peopledesk-1", email: "peopledesk@example.org" };
const ORG_DESK: Who = { userId: "orgdesk-1", email: "orgdesk@example.org" };
const OWNER: Who = { userId: "owner-1", email: "owner@example.org" };
const MEMBER: Who = { userId: "member-1", email: "member@example.org" };
const NOBODY: Who = { userId: "nobody-1", email: "nobody@example.org" };

/** Blocks OS IAM in memory, with the calls it received. */
function memoryIam(o: { down?: boolean } = {}) {
  const permissions = new Map<string, { name: string; resource?: string }>();
  const roles = new Map<string, IamDirectoryRole>();
  const orgs = new Map<string, { id: string; name: string }>();
  const grants = new Map<string, Set<string>>(); // `${userId}|${orgId}` -> slugs
  const calls: string[] = [];
  const guard = <T>(name: string, f: () => T): Promise<T> => {
    calls.push(name);
    if (o.down) return Promise.reject(Object.assign(new Error("iam.unavailable"), { code: "iam.unavailable" }));
    return Promise.resolve(f());
  };
  const at = (u: string, org = "") => {
    const k = `${u}|${org}`;
    const s = grants.get(k) ?? new Set<string>();
    grants.set(k, s);
    return s;
  };
  const dir: IamDirectory = {
    listPermissions: () => guard("listPermissions", () => [...permissions.values()]),
    ensurePermissions: (keys) => guard("ensurePermissions", () => { for (const k of keys) permissions.set(k, { name: k, resource: "madp-factory" }); }),
    listRoles: () => guard("listRoles", () => [...roles.values()].map((r) => ({ ...r, permissions: [...r.permissions] }))),
    getRole: (slug) => guard("getRole", () => roles.get(slug) ?? null),
    upsertRole: (r) => guard("upsertRole", () => { roles.set(r.slug, { ...r, permissions: [...r.permissions] }); }),
    deleteRole: (slug) => guard("deleteRole", () => { roles.delete(slug); }),
    listOrganizations: () => guard("listOrganizations", () => [...orgs.values()]),
    ensureOrganization: (w) => guard("ensureOrganization", () => {
      const id = `org-${w.workspaceId}`;
      orgs.set(id, { id, name: w.name });
      return id;
    }),
    userAccess: (userId) => guard("userAccess", () => {
      const out = { platform: { roles: [...at(userId)], permissions: [] as string[] }, orgs: {} as Record<string, { roles: string[]; permissions: string[] }> };
      for (const [k, s] of grants) {
        const [u, org] = k.split("|");
        if (u === userId && org) out.orgs[org!] = { roles: [...s], permissions: [] };
      }
      return out;
    }),
    grant: (userId, g) => guard("grant", () => { for (const r of g.roles ?? []) at(userId, g.organizationId).add(r); }),
    revoke: (userId, g) => guard("revoke", () => { for (const r of g.roles ?? []) at(userId, g.organizationId).delete(r); }),
  };
  const writes = () => calls.filter((c) => ["ensurePermissions", "upsertRole", "deleteRole", "ensureOrganization", "grant", "revoke"].includes(c));
  return { dir, roles, orgs, grants, calls, writes, at };
}

function setup(iam: IamDirectory | null = memoryIam().dir) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { name: "Northwind", members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }] });
  for (const p of [SUPER, PLATFORM_ADMIN, ROLES_DESK, PEOPLE_DESK, ORG_DESK, NOBODY]) seedRow(gateway, "Account", { UserId: p.userId, Email: p.email, Status: "active" });
  const grant = (who: Who, key: string, permissions: string[] | null) => {
    if (permissions) seedRow(gateway, "PlatformRole", { ReaderIds: [], Key: key, Name: key, Permissions: permissions, IsBuiltIn: false });
    seedRow(gateway, "PlatformRoleAssignment", { ReaderIds: [], UserId: who.userId, RoleKey: key, Status: "active" });
  };
  grant(PLATFORM_ADMIN, "platform-admin", null);
  grant(ROLES_DESK, "roles-desk", ["platform.roles.manage"]);
  grant(PEOPLE_DESK, "people-desk", ["platform.people.manage"]);
  grant(ORG_DESK, "org-desk", ["platform.orgs.manage"]);
  const call = (who: Who, op: string, args: Record<string, unknown> = {}) => {
    const ctx = fakeCtx(who);
    if (iam) (ctx.platformCtx as { iamAdmin?: IamDirectory }).iamAdmin = iam;
    return runOp("admin", ADMIN_DEFS, { ctx, gateway, request: { op, args, requestId: randomUUID() } });
  };
  return { gateway, workspaceId, call };
}

const err = (body: unknown) => (body as { error: { code: string; messageKey?: string } }).error;
const data = <T>(body: unknown) => (body as { data: T }).data;

describe("who may read", () => {
  it("iam.status, iam.roles.list, iam.permissions.list: platform.roles.manage or platform.people.manage holders and the super admin", async () => {
    const t = setup();
    for (const op of ["iam.status", "iam.roles.list", "iam.permissions.list"]) {
      for (const who of [SUPER, ROLES_DESK, PEOPLE_DESK]) expect((await t.call(who, op)).status, `${op} ${who.userId}`).toBe(200);
      for (const who of [ORG_DESK, OWNER, NOBODY]) {
        const no = await t.call(who, op);
        expect(no.status, `${op} ${who.userId}`).toBe(403);
        expect(err(no.body).code).toBe("forbidden");
      }
    }
  });

  it("the reads are views, listed as read-only for the client", () => {
    for (const op of ["iam.status", "iam.roles.list", "iam.permissions.list", "iam.access.get"]) expect(VIEW_OPS.has(`admin:${op}`), op).toBe(true);
    for (const op of ["iam.roles.save", "iam.roles.delete", "iam.access.set", "iam.sync.run", "iam.source.set"]) expect(VIEW_OPS.has(`admin:${op}`), op).toBe(false);
  });

  it("status answers the source and the definitions out of step; the factory is the source by default", async () => {
    const t = setup();
    const s = data<{ source: string; available: boolean; drift: { total: number; permissions: number } }>((await t.call(ROLES_DESK, "iam.status")).body);
    expect(s.source).toBe("factory");
    expect(s.available).toBe(true);
    expect(s.drift.permissions).toBeGreaterThan(30);
    expect(s.drift.total).toBeGreaterThan(s.drift.permissions);
  });
});

describe("when Blocks OS IAM is not there", () => {
  it("status says so plainly; the other ops answer iam.unavailable and change nothing", async () => {
    const none = setup(null);
    const s = data<{ available: boolean; unavailable: string }>((await none.call(SUPER, "iam.status")).body);
    expect(s).toMatchObject({ available: false, unavailable: "not-connected" });
    const roles = await none.call(SUPER, "iam.roles.list");
    expect(err(roles.body)).toMatchObject({ code: "not_supported", messageKey: "iam.unavailable" });

    const down = memoryIam({ down: true });
    const t = setup(down.dir);
    expect(data<{ unavailable: string }>((await t.call(SUPER, "iam.status")).body).unavailable).toBe("unreachable");
    const save = await t.call(SUPER, "iam.roles.save", { scope: "platform", key: "billing-desk", name: "Billing desk", permissions: ["platform.billing.manage"] });
    expect(err(save.body).messageKey).toBe("iam.unavailable");
    expect(t.gateway.rows("PlatformRole").some((r) => r.Key === "billing-desk")).toBe(false);
    const sw = await t.call(SUPER, "iam.source.set", { source: "iam" });
    expect(err(sw.body).messageKey).toBe("iam.unavailable");
    expect(t.gateway.rows("PlatformSetting").some((r) => r.Key === "rbac.source")).toBe(false);
  });
});

describe("iam.roles.save / iam.roles.delete", () => {
  it("platform.roles.manage writes the role to IAM first, then the Factory; others are refused and nothing is written", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    const role = { scope: "platform", key: "billing-desk", name: "Billing desk", description: "Plans and credit", permissions: ["platform.billing.manage"] };
    for (const who of [PEOPLE_DESK, ORG_DESK, NOBODY]) expect((await t.call(who, "iam.roles.save", role)).status, who.userId).toBe(403);
    expect(iam.writes()).toEqual([]);

    const res = await t.call(SUPER, "iam.roles.save", role);
    expect(res.status).toBe(200);
    expect(iam.roles.get("mf-platform-billing-desk")).toMatchObject({ name: "Billing desk", permissions: ["platform.billing.manage"] });
    expect(iam.writes()).toEqual(["ensurePermissions", "upsertRole"]);
    expect(t.gateway.rows("PlatformRole").find((r) => r.Key === "billing-desk")).toMatchObject({ Permissions: ["platform.billing.manage"] });
    expect(t.gateway.rows("AuditEvent").some((r) => r.Action === "iam.roles.save" && r.TargetType === "iam-role")).toBe(true);

    const list = data<{ roles: { slug: string; scope: string; key: string }[] }>((await t.call(PEOPLE_DESK, "iam.roles.list")).body);
    expect(list.roles).toContainEqual(expect.objectContaining({ slug: "mf-platform-billing-desk", scope: "platform", key: "billing-desk" }));
  });

  it("built-in roles are locked", async () => {
    const t = setup();
    const admin = await t.call(SUPER, "iam.roles.save", { scope: "platform", key: "platform-admin", name: "x", permissions: [] });
    expect(err(admin.body).messageKey).toBe("tenancy.builtInRole");
    const owner = await t.call(SUPER, "iam.roles.save", { scope: "organization", key: "owner", name: "x", permissions: ["view"], workspaceId: t.workspaceId });
    expect(err(owner.body).messageKey).toBe("tenancy.builtInRole");
  });

  it("a template saves under mf-tpl-; deleting it removes it from the Factory and IAM", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    await t.call(SUPER, "iam.roles.save", { scope: "template", key: "reviewer", name: "Reviewer", permissions: ["view", "comment"] });
    expect(iam.roles.has("mf-tpl-reviewer")).toBe(true);
    expect(t.gateway.rows("PlatformRole").find((r) => r.Key === "reviewer")).toMatchObject({ Scope: "organization" });
    expect((await t.call(PEOPLE_DESK, "iam.roles.delete", { scope: "template", key: "reviewer" })).status).toBe(403);
    expect((await t.call(SUPER, "iam.roles.delete", { scope: "template", key: "reviewer" })).status).toBe(200);
    expect(iam.roles.has("mf-tpl-reviewer")).toBe(false);
    expect(t.gateway.rows("PlatformRole").some((r) => r.Key === "reviewer")).toBe(false);
  });
});

describe("iam.sync.run", () => {
  it("a check shows the plan and changes nothing in IAM; applying it is for platform admins; afterwards nothing is out of step", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    const check = await t.call(ROLES_DESK, "iam.sync.run", { dryRun: true });
    expect(check.status).toBe(200);
    const plan = data<{ plan: { drift: number; organizations: { create: unknown[] }; grants: { add: { roles: string[] }[] } } }>(check.body).plan;
    expect(plan.drift).toBeGreaterThan(0);
    expect(plan.organizations.create).toHaveLength(1);
    expect(plan.grants.add.flatMap((g) => g.roles)).toEqual(expect.arrayContaining(["mf-org-owner", "mf-org-member", "mf-platform-roles-desk", "mf-platform-admin"]));
    expect(iam.writes()).toEqual([]);
    expect((await t.call(PEOPLE_DESK, "iam.sync.run", { dryRun: true })).status).toBe(403);

    for (const who of [ROLES_DESK, PEOPLE_DESK]) {
      const no = await t.call(who, "iam.sync.run", { dryRun: false });
      expect(no.status, who.userId).toBe(403);
    }
    expect(iam.writes()).toEqual([]);

    const applied = await t.call(PLATFORM_ADMIN, "iam.sync.run", { dryRun: false });
    expect(applied.status).toBe(200);
    expect(data<{ failed: number; applied: number }>(applied.body)).toMatchObject({ failed: 0 });
    const ws = t.gateway.rows("Workspace").find((w) => w.ItemId === t.workspaceId)!;
    expect(ws.IamOrganizationId).toBe(`org-${t.workspaceId}`);
    expect([...iam.at(OWNER.userId, `org-${t.workspaceId}`)]).toEqual(["mf-org-owner"]);
    expect([...iam.at(ROLES_DESK.userId)]).toEqual(["mf-platform-roles-desk"]);

    const again = data<{ plan: { drift: number } }>((await t.call(ROLES_DESK, "iam.sync.run", {})).body);
    expect(again.plan.drift).toBe(0);
    const status = data<{ drift: { total: number }; sync: { syncedAt?: string; checkedAt?: string } }>((await t.call(PEOPLE_DESK, "iam.status")).body);
    expect(status.drift.total).toBe(0);
    expect(status.sync.syncedAt).toBeTruthy();
    expect(t.gateway.rows("AuditEvent").filter((r) => r.Action === "iam.sync.run")).toHaveLength(3);
  });
});

describe("iam.access.get / iam.access.set", () => {
  it("reads a person's IAM roles per organization; sets a member's organization role in IAM and says the Factory follows", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    await t.call(SUPER, "iam.sync.run", { dryRun: false });
    expect((await t.call(NOBODY, "iam.access.get", { userId: MEMBER.userId })).status).toBe(403);
    const got = data<{ organizations: { workspaceId: string; iamRoles: string[]; factoryRole: string; inStep: boolean }[] }>(
      (await t.call(PEOPLE_DESK, "iam.access.get", { userId: MEMBER.userId })).body,
    );
    expect(got.organizations).toEqual([expect.objectContaining({ workspaceId: t.workspaceId, iamRoles: ["member"], factoryRole: "member", inStep: true })]);

    // platform.workspaces.manage is needed for an organization role; platform.people.manage is not enough.
    expect((await t.call(ROLES_DESK, "iam.access.set", { userId: MEMBER.userId, workspaceId: t.workspaceId, roleKeys: ["viewer"] })).status).toBe(403);
    const set = await t.call(ORG_DESK, "iam.access.set", { userId: MEMBER.userId, workspaceId: t.workspaceId, roleKeys: ["viewer"] });
    expect(set.status).toBe(200);
    expect(data<{ factory: { needsUpdate: boolean; roleKey: string } }>(set.body).factory).toMatchObject({ needsUpdate: true, roleKey: "member" });
    expect([...iam.at(MEMBER.userId, `org-${t.workspaceId}`)]).toEqual(["mf-org-viewer"]);

    // The organization's last owner stays an owner: refused before IAM is touched.
    const before = iam.writes().length;
    const last = await t.call(SUPER, "iam.access.set", { userId: OWNER.userId, workspaceId: t.workspaceId, roleKeys: ["member"] });
    expect(err(last.body)).toMatchObject({ code: "conflict", messageKey: "tenancy.lastOwner" });
    expect(iam.writes().length).toBe(before);
  });

  it("platform roles: IAM first, then the Factory assignment; only the super admin hands out Platform admin", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    const desk = await t.call(PEOPLE_DESK, "iam.access.set", { userId: NOBODY.userId, roleKeys: ["people-desk"] });
    expect(desk.status).toBe(200);
    expect([...iam.at(NOBODY.userId)]).toEqual(["mf-platform-people-desk"]);
    expect(t.gateway.rows("PlatformRoleAssignment").some((r) => r.UserId === NOBODY.userId && r.RoleKey === "people-desk" && r.Status === "active")).toBe(true);
    // Refused by the Factory's own rules before IAM changes: Platform admin and roles that manage roles are the super
    // admin's, and nobody hands out permissions they do not hold.
    for (const roleKeys of [["people-desk", "platform-admin"], ["people-desk", "roles-desk"], ["people-desk", "org-desk"]]) {
      const no = await t.call(PEOPLE_DESK, "iam.access.set", { userId: NOBODY.userId, roleKeys });
      expect(err(no.body).code, roleKeys.join()).toBe("forbidden");
    }
    expect([...iam.at(NOBODY.userId)]).toEqual(["mf-platform-people-desk"]);
    expect((await t.call(SUPER, "iam.access.set", { userId: NOBODY.userId, roleKeys: ["roles-desk"] })).status).toBe(200);
    expect([...iam.at(NOBODY.userId)]).toEqual(["mf-platform-roles-desk"]);
    expect(t.gateway.rows("PlatformRoleAssignment").filter((r) => r.UserId === NOBODY.userId && r.Status === "active").map((r) => r.RoleKey)).toEqual(["roles-desk"]);
  });
});

describe("iam.source.set", () => {
  it("only platform admins switch the source; the switch is audited and status reports it", async () => {
    const iam = memoryIam();
    const t = setup(iam.dir);
    for (const who of [ROLES_DESK, PEOPLE_DESK, NOBODY]) expect((await t.call(who, "iam.source.set", { source: "iam" })).status, who.userId).toBe(403);
    // No lockout: a platform admin who would not be one in IAM cannot switch to it.
    expect((await t.call(PLATFORM_ADMIN, "iam.source.set", { source: "iam" })).status).toBe(409);
    iam.at(PLATFORM_ADMIN.userId).add("mf-platform-admin");
    expect((await t.call(PLATFORM_ADMIN, "iam.source.set", { source: "iam" })).status).toBe(200);
    // With IAM as the source, IAM decides who reads the status (the super admin by today's role, here).
    expect(data<{ source: string }>((await t.call(SUPER, "iam.status")).body).source).toBe("iam");
    expect(t.gateway.rows("AuditEvent").find((r) => r.Action === "iam.source.set")).toMatchObject({ TargetId: "rbac.source" });
    expect((await t.call(SUPER, "iam.source.set", { source: "factory" })).status).toBe(200);
    expect(data<{ source: string }>((await t.call(SUPER, "iam.status")).body).source).toBe("factory");
  });
});
