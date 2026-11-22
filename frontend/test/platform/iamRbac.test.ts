// Roles from Blocks IAM through the real routers (PlatformSetting rbac.source): the one resolver in both modes, the
// IAM-first write-through of role and access changes (a failed IAM write changes no Factory row), cache invalidation by
// Factory changes, and the no-lockout rule for today's super admin.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorise, type AccessService } from "../../functions/_lib/access";
import { createIamAdmin, orgRoleSlug } from "../../functions/_lib/iamAdmin";
import { createRbacCaches, rbacSettingOf } from "../../functions/_lib/rbacSource";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { ADMIN_DEFS } from "../../functions/admin/ops";
import { WORKSPACE_DEFS } from "../../functions/workspace/ops";
import { BUILT_IN_ROLE_PERMISSIONS, WORKSPACE_PERMISSIONS } from "../../src/domain/rbac";
import { fakeIamSdk, seedIamUser } from "./fakeIamSdk";

type Who = { userId: string; email: string; roles?: string[] };
const SUPER: Who = { userId: "super-1", email: "super@example.org", roles: ["mf-user", "mf-super-admin"] };
const OWNER: Who = { userId: "owner-1", email: "owner@example.org" };
const MEMBER: Who = { userId: "member-1", email: "member@example.org" };
const ROWS_AUDITOR: Who = { userId: "rows-auditor-1", email: "rowsauditor@example.org" };
const IAM_AUDITOR: Who = { userId: "iam-auditor-1", email: "iamauditor@example.org" };
const IAM_SUPER: Who = { userId: "iam-super-1", email: "iamsuper@example.org" };
const NEWCOMER: Who = { userId: "newcomer-1", email: "newcomer@example.org" };

async function setup(source: "factory" | "iam" = "iam") {
  const gateway = memoryGateway();
  const fake = fakeIamSdk();
  const iam = createIamAdmin({ client: fake.client });
  const caches = createRbacCaches();
  const { workspaceId, membershipIds } = seedWorkspace(gateway, {
    name: "Northwind",
    members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }],
  });
  const other = seedWorkspace(gateway, { name: "Elsewhere", members: [{ ...OWNER, roleKey: "owner" }] }).workspaceId;
  for (const p of [SUPER, ROWS_AUDITOR, IAM_AUDITOR, IAM_SUPER, NEWCOMER]) seedRow(gateway, "Account", { UserId: p.userId, Email: p.email, Status: "active" });
  seedRow(gateway, "PlatformRole", { ReaderIds: [], Key: "auditor", Name: "Auditor", Permissions: ["platform.audit.view"], IsBuiltIn: false });
  seedRow(gateway, "PlatformRoleAssignment", { ReaderIds: [], UserId: ROWS_AUDITOR.userId, RoleKey: "auditor", Status: "active" });
  if (source === "iam") {
    seedRow(gateway, "PlatformSetting", { Key: "rbac.source", ValueJson: JSON.stringify("iam"), Values: ["1"], ReaderIds: [], Description: "" });
  }
  // IAM: the built-in organization roles, a platform role, and Northwind linked to organization org-1.
  await iam.upsertRole({ slug: "mf-org-owner", name: "Owner", permissions: [...WORKSPACE_PERMISSIONS] });
  await iam.upsertRole({ slug: "mf-org-member", name: "Member", permissions: [...BUILT_IN_ROLE_PERMISSIONS.member] });
  await iam.upsertRole({ slug: "mf-org-viewer", name: "Viewer", permissions: [...BUILT_IN_ROLE_PERMISSIONS.viewer] });
  await iam.upsertRole({ slug: "mf-platform-auditor", name: "Auditor", permissions: ["platform.audit.view"] });
  await iam.upsertRole({ slug: "mf-platform-super-admin", name: "Super admin", permissions: [] });
  fake.state.orgs.push({ itemId: "org-1", name: "Northwind", description: `MADP Factory organization [mf-workspace:${workspaceId}]` });
  await gateway.update("Workspace", workspaceId, { IamOrganizationId: "org-1" });
  seedIamUser(fake.state, SUPER.userId, ["mf-user", "mf-super-admin"]);
  seedIamUser(fake.state, OWNER.userId, ["mf-user"], { "org-1": ["mf-org-owner"] });
  seedIamUser(fake.state, MEMBER.userId, ["mf-user"], { "org-1": ["mf-org-member"] });
  seedIamUser(fake.state, ROWS_AUDITOR.userId, ["mf-user"]);
  seedIamUser(fake.state, IAM_AUDITOR.userId, ["mf-user", "mf-platform-auditor"]);
  seedIamUser(fake.state, IAM_SUPER.userId, ["mf-user", "mf-platform-super-admin"]);
  seedIamUser(fake.state, NEWCOMER.userId, ["mf-user"]);
  fake.state.calls.length = 0;
  const call = (fn: "admin" | "workspace", who: Who, op: string, args: Record<string, unknown> = {}) =>
    runOp(fn, fn === "admin" ? ADMIN_DEFS : WORKSPACE_DEFS, {
      ctx: fakeCtx(who),
      gateway,
      iamAdmin: iam,
      rbacCaches: caches,
      request: { op, args, requestId: randomUUID() },
    });
  return { gateway, fake, iam, caches, workspaceId, other, memberMembershipId: membershipIds[1]!, call };
}

const errorOf = (body: unknown) => (body as { error: { code: string; messageKey: string } }).error;

describe("the resolver, factory mode", () => {
  it("the Factory rows decide and IAM is never asked", async () => {
    const t = await setup("factory");
    expect((await t.call("admin", ROWS_AUDITOR, "audit.list", {})).status).toBe(200);
    expect((await t.call("admin", IAM_AUDITOR, "audit.list", {})).status).toBe(403);
    expect((await t.call("admin", IAM_SUPER, "platformRole.list", {})).status).toBe(403);
    expect(t.fake.state.calls).toEqual([]);
  });
});

describe("the resolver, iam mode", () => {
  it("platform permissions and the super admin come from IAM only", async () => {
    const t = await setup();
    expect((await t.call("admin", IAM_AUDITOR, "audit.list", {})).status).toBe(200);
    const rows = await t.call("admin", ROWS_AUDITOR, "audit.list", {});
    expect(rows.status).toBe(403);
    expect((await t.call("admin", IAM_SUPER, "platformRole.list", {})).status).toBe(200);
  });

  it("a linked workspace's roles come from its IAM organization; an unlinked one is still decided by the rows", async () => {
    const t = await setup();
    // IAM makes the Factory "member" an owner of Northwind and the Factory "owner" a viewer.
    t.fake.state.access.get(MEMBER.userId)!["org-1"] = { roles: ["mf-org-owner"], permissions: [] };
    t.fake.state.access.get(OWNER.userId)!["org-1"] = { roles: ["mf-org-viewer"], permissions: [] };
    const role = { workspaceId: t.workspaceId, key: "reviewer", name: "Reviewer", permissions: ["view", "comment"] };
    expect(errorOf((await t.call("admin", OWNER, "workspaceRole.save", role)).body).code).toBe("forbidden");
    expect((await t.call("admin", MEMBER, "workspaceRole.save", role)).status).toBe(200);
    // Elsewhere has no IAM organization: its owner row still decides.
    expect((await t.call("admin", OWNER, "workspaceRole.save", { ...role, workspaceId: t.other })).status).toBe(200);
  });

  it("IAM down: an ordinary caller gets a plain refusal; today's super admin is never locked out and can switch back", async () => {
    const t = await setup();
    t.fake.state.failOn["*"] = { status: 503 };
    const res = await t.call("admin", IAM_AUDITOR, "audit.list", {});
    expect(res.status).toBe(503);
    expect(errorOf(res.body)).toMatchObject({ code: "unavailable", messageKey: "iam.unavailable" });
    expect((await t.call("admin", SUPER, "audit.list", {})).status).toBe(200);
    const back = await t.call("admin", SUPER, "iam.source.set", { source: "factory" });
    expect(back.status).toBe(200);
    expect(rbacSettingOf(t.gateway.rows("PlatformSetting").find((r) => r.Key === "rbac.source")!.ValueJson).source).toBe("factory");
    expect((await t.call("admin", ROWS_AUDITOR, "audit.list", {})).status).toBe(200);
  });

  it("authorise uses the IAM permissions of the workspace for routed (project) ops", async () => {
    const caller = { userId: "u", email: "", roles: [], isSuperAdmin: false, isEngine: false, impersonated: false, tenantId: "t" };
    const access: AccessService = { platformPermissions: async () => [], platformHolders: async () => [] };
    const bundle = {
      workspace: { ItemId: "w", Status: "active" },
      membership: { ItemId: "m", RoleKey: "owner", Status: "active" },
      roles: [],
      activeMemberUserIds: null,
    };
    const meta = { op: "x.y", kind: "command" as const, scope: "project" as const, permission: "build.run" };
    const viewer = { roleKey: "viewer", permissions: ["view" as const, "comment" as const], organizationId: "org-1" };
    await expect(authorise({ meta, caller, bundle, access, iamWorkspace: viewer })).rejects.toMatchObject({ code: "forbidden" });
    await expect(authorise({ meta, caller, bundle, access, iamWorkspace: { ...viewer, roleKey: null, permissions: [] } })).rejects.toMatchObject({ code: "not_member" });
    const ok = await authorise({ meta, caller, bundle, access, iamWorkspace: { roleKey: "member", permissions: ["build.run"], organizationId: "org-1" } });
    expect(ok.permissions).toEqual(["build.run"]);
    // Without an IAM answer (factory mode or an unlinked workspace) the Membership row decides.
    expect((await authorise({ meta, caller, bundle, access })).permissions).toContain("build.run");
  });
});

describe("write-through (iam mode)", () => {
  it("platformRole.assign writes IAM first, then the Factory row; a refused IAM write changes nothing", async () => {
    const t = await setup();
    const refused = await (async () => {
      t.fake.state.failOn["users.updateAccess"] = { refuse: true };
      const r = await t.call("admin", SUPER, "platformRole.assign", { userId: NEWCOMER.userId, roleKey: "auditor" });
      t.fake.state.failOn = {};
      return r;
    })();
    expect(refused.status).toBe(403);
    expect(errorOf(refused.body).messageKey).toBe("iam.forbidden");
    expect(t.gateway.rows("PlatformRoleAssignment").filter((r) => r.UserId === NEWCOMER.userId)).toHaveLength(0);
    expect(t.gateway.rows("AuditEvent").filter((r) => r.Action === "platformRole.assign")).toHaveLength(0);

    const ok = await t.call("admin", SUPER, "platformRole.assign", { userId: NEWCOMER.userId, roleKey: "auditor" });
    expect(ok.status).toBe(200);
    expect(t.fake.state.access.get(NEWCOMER.userId)!.default.roles).toEqual(["mf-user", "mf-platform-auditor"]);
    expect(t.gateway.rows("PlatformRoleAssignment").filter((r) => r.UserId === NEWCOMER.userId && r.Status === "active")).toHaveLength(1);
    // The change drops the cached access: the newcomer holds the permission at once.
    expect((await t.call("admin", NEWCOMER, "audit.list", {})).status).toBe(200);

    const off = await t.call("admin", SUPER, "platformRole.unassign", { userId: NEWCOMER.userId, roleKey: "auditor" });
    expect(off.status).toBe(200);
    expect(t.fake.state.access.get(NEWCOMER.userId)!.default.roles).toEqual(["mf-user"]);
    expect((await t.call("admin", NEWCOMER, "audit.list", {})).status).toBe(403);
  });

  it("platformRole.save keeps the IAM role's permissions exact", async () => {
    const t = await setup();
    const res = await t.call("admin", SUPER, "platformRole.save", { key: "billing-desk", name: "Billing desk", permissions: ["platform.billing.manage"] });
    expect(res.status).toBe(200);
    expect((await t.iam.getRole("mf-platform-billing-desk"))?.permissions).toEqual(["platform.billing.manage"]);
    const tpl = await t.call("admin", SUPER, "platformRole.save", { key: "reviewer", name: "Reviewer", permissions: ["view"], scope: "organization" });
    expect(tpl.status).toBe(200);
    expect((await t.iam.getRole("mf-tpl-reviewer"))?.permissions).toEqual(["view"]);
  });

  it("member.setRole and member.remove change the person's IAM organization access first", async () => {
    const t = await setup();
    t.fake.state.failOn["users.updateAccess"] = { status: 503 };
    const down = await t.call("workspace", OWNER, "member.setRole", { workspaceId: t.workspaceId, membershipId: t.memberMembershipId, roleKey: "viewer" });
    expect(errorOf(down.body).messageKey).toBe("iam.unavailable");
    expect(t.gateway.rows("Membership").find((m) => m.ItemId === t.memberMembershipId)!.RoleKey).toBe("member");
    t.fake.state.failOn = {};

    const set = await t.call("workspace", OWNER, "member.setRole", { workspaceId: t.workspaceId, membershipId: t.memberMembershipId, roleKey: "viewer" });
    expect(set.status).toBe(200);
    expect(t.fake.state.access.get(MEMBER.userId)!["org-1"].roles).toEqual(["mf-org-viewer"]);
    expect(t.gateway.rows("Membership").find((m) => m.ItemId === t.memberMembershipId)!.RoleKey).toBe("viewer");

    const gone = await t.call("workspace", OWNER, "member.remove", { workspaceId: t.workspaceId, membershipId: t.memberMembershipId });
    expect(gone.status).toBe(200);
    expect(t.fake.state.access.get(MEMBER.userId)!["org-1"]).toBeUndefined();
    expect(t.gateway.rows("Membership").find((m) => m.ItemId === t.memberMembershipId)!.Status).toBe("removed");
  });

  it("workspace.create makes the IAM organization and the owner's role, and links the workspace", async () => {
    const t = await setup();
    const res = await t.call("workspace", NEWCOMER, "workspace.create", { name: "Contoso" });
    expect(res.status).toBe(200);
    const wsId = res.body.data.workspace.ItemId as string;
    const org = t.fake.state.orgs.find((o) => o.description.includes(`[mf-workspace:${wsId}]`));
    expect(org).toBeTruthy();
    expect(t.fake.state.access.get(NEWCOMER.userId)![org!.itemId].roles).toEqual(["mf-org-owner"]);
    expect(t.gateway.rows("Workspace").find((w) => w.ItemId === wsId)!.IamOrganizationId).toBe(org!.itemId);
    // The owner manages the new workspace through IAM at once.
    const role = await t.call("admin", NEWCOMER, "workspaceRole.save", { workspaceId: wsId, key: "reviewer", name: "Reviewer", permissions: ["view"] });
    expect(role.status).toBe(200);
    expect((await t.iam.getRole(orgRoleSlug("reviewer", wsId)))?.permissions).toEqual(["view"]);
  });

  it("a Factory change moves the epoch so other processes drop their cached access", async () => {
    const t = await setup();
    const row = () => t.gateway.rows("PlatformSetting").find((r) => r.Key === "rbac.source")!;
    const epoch = () => rbacSettingOf(row().ValueJson, null, row().Values).epoch;
    expect(epoch()).toBe(1);
    await t.call("admin", SUPER, "platformRole.assign", { userId: NEWCOMER.userId, roleKey: "auditor" });
    expect(epoch()).toBeGreaterThan(1);
    // The source itself is untouched (the iam.* ops read the bare ValueJson).
    expect(row().ValueJson).toBe(JSON.stringify("iam"));
  });

  it("access read from IAM is cached per person until a Factory change drops it", async () => {
    const t = await setup();
    expect((await t.call("admin", IAM_AUDITOR, "audit.list", {})).status).toBe(200);
    const reads = () => t.fake.state.calls.filter((c) => c === "users.get").length;
    const n = reads();
    // Changed in IAM directly (not through the Factory): the cached answer stands for up to a minute.
    t.fake.state.access.get(IAM_AUDITOR.userId)!.default.roles = ["mf-user"];
    expect((await t.call("admin", IAM_AUDITOR, "audit.list", {})).status).toBe(200);
    expect(reads()).toBe(n);
    // Any role change made through the Factory drops it.
    await t.call("admin", SUPER, "platformRole.save", { key: "billing-desk", name: "Billing desk", permissions: ["platform.billing.manage"] });
    expect((await t.call("admin", IAM_AUDITOR, "audit.list", {})).status).toBe(403);
  });
});
