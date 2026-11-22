// Roles & permissions through the real admin router: who may define organization role templates, that a template is
// never held as a platform role, copying a template into an organization, one person's access, and broad keys reaching
// the older ops. Every refusal leaves the data untouched; every change is audited.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace, type MemoryGateway } from "../../functions/_lib/testing";
import { ADMIN_DEFS } from "../../functions/admin/ops";

type Who = { userId: string; email: string; roles?: string[] };
const SUPER: Who = { userId: "super-1", email: "super@example.org", roles: ["mf-user", "mf-super-admin"] };
const OWNER: Who = { userId: "owner-1", email: "owner@example.org" };
const MEMBER: Who = { userId: "member-1", email: "member@example.org" };
const OUTSIDER: Who = { userId: "outsider-1", email: "outsider@example.org" };
const ORG_DESK: Who = { userId: "orgdesk-1", email: "orgdesk@example.org" };
const PEOPLE_DESK: Who = { userId: "peopledesk-1", email: "peopledesk@example.org" };
const NOBODY: Who = { userId: "nobody-1", email: "nobody@example.org" };

function setup() {
  const gateway = memoryGateway();
  const { workspaceId, membershipIds } = seedWorkspace(gateway, {
    name: "Northwind",
    members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }],
  });
  seedWorkspace(gateway, { name: "Elsewhere", members: [{ ...OUTSIDER, roleKey: "owner" }] });
  for (const p of [SUPER, ORG_DESK, PEOPLE_DESK, NOBODY]) seedRow(gateway, "Account", { UserId: p.userId, Email: p.email, Status: "active" });
  const grant = (who: Who, key: string, permissions: string[]) => {
    seedRow(gateway, "PlatformRole", { ReaderIds: [], Key: key, Name: key, Permissions: permissions, IsBuiltIn: false });
    seedRow(gateway, "PlatformRoleAssignment", { ReaderIds: [], UserId: who.userId, RoleKey: key, Status: "active" });
  };
  grant(ORG_DESK, "org-desk", ["platform.orgs.manage"]);
  grant(PEOPLE_DESK, "people-desk", ["platform.people.manage"]);
  const call = (who: Who, op: string, args: Record<string, unknown>) =>
    runOp("admin", ADMIN_DEFS, { ctx: fakeCtx(who), gateway, request: { op, args, requestId: randomUUID() } });
  return { gateway, workspaceId, memberMembershipId: membershipIds[1]!, call };
}

const code = (body: unknown) => (body as { error: { code: string } }).error.code;
const templates = (gw: MemoryGateway) => gw.rows("PlatformRole").filter((r) => r.Scope === "organization");
const audits = (gw: MemoryGateway, action: string) => gw.rows("AuditEvent").filter((r) => r.Action === action);
const REVIEWER = { key: "reviewer", name: "Reviewer", description: "Reads and comments", permissions: ["view", "comment"], scope: "organization" };

describe("organization role templates", () => {
  it("the super admin defines one; the list answers it apart from the platform roles; the change is audited", async () => {
    const t = setup();
    const res = await t.call(SUPER, "platformRole.save", REVIEWER);
    expect(res.status).toBe(200);
    expect(templates(t.gateway)).toHaveLength(1);
    expect(audits(t.gateway, "platformRole.save")[0]).toMatchObject({ TargetType: "org-role-template", TargetId: "reviewer" });
    const list = await t.call(SUPER, "platformRole.list", {});
    expect(list.body.data.templates.map((r: { key: string }) => r.key)).toEqual(["reviewer"]);
    expect(list.body.data.roles.map((r: { key: string }) => r.key)).not.toContain("reviewer");
  });

  it("refuses people without platform.roles.manage, organization owners included, and writes nothing", async () => {
    const t = setup();
    for (const who of [ORG_DESK, OWNER, NOBODY]) {
      const no = await t.call(who, "platformRole.save", REVIEWER);
      expect(no.status, who.userId).toBe(403);
      expect(code(no.body)).toBe("forbidden");
    }
    expect(templates(t.gateway)).toHaveLength(0);
    expect(audits(t.gateway, "platformRole.save")).toHaveLength(0);
  });

  it("refuses platform permissions in a template and a key already used by a platform role", async () => {
    const t = setup();
    const bad = await t.call(SUPER, "platformRole.save", { ...REVIEWER, permissions: ["platform.audit.view"] });
    expect(bad.status).toBe(400);
    const taken = await t.call(SUPER, "platformRole.save", { ...REVIEWER, key: "org-desk" });
    expect(code(taken.body)).toBe("conflict");
    expect(templates(t.gateway)).toHaveLength(0);
  });

  it("a template is never held as a platform role", async () => {
    const t = setup();
    await t.call(SUPER, "platformRole.save", REVIEWER);
    const no = await t.call(SUPER, "platformRole.assign", { userId: NOBODY.userId, roleKey: "reviewer" });
    expect(no.status).toBe(404);
    expect(t.gateway.rows("PlatformRoleAssignment").filter((r) => r.RoleKey === "reviewer")).toHaveLength(0);
  });

  it("is copied into an organization by its owner or the super admin; never by people who lack its permissions", async () => {
    const t = setup();
    await t.call(SUPER, "platformRole.save", REVIEWER);
    const member = await t.call(MEMBER, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "reviewer" });
    expect(code(member.body)).toBe("forbidden");
    const outsider = await t.call(OUTSIDER, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "reviewer" });
    expect(code(outsider.body)).toBe("not_member");
    const nobody = await t.call(NOBODY, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "reviewer" });
    expect(code(nobody.body)).toBe("not_member");
    expect(t.gateway.rows("WorkspaceRole")).toHaveLength(0);

    // platform.orgs.manage reaches the organization as a manager, but nobody hands out permissions they do not hold.
    const desk = await t.call(ORG_DESK, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "reviewer" });
    expect(code(desk.body)).toBe("forbidden");
    expect(t.gateway.rows("WorkspaceRole")).toHaveLength(0);

    const ok = await t.call(OWNER, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "reviewer" });
    expect(ok.status).toBe(200);
    const rows = t.gateway.rows("WorkspaceRole");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ WorkspaceId: t.workspaceId, Key: "reviewer", Name: "Reviewer", Permissions: ["view", "comment"] });
    expect(audits(t.gateway, "workspaceRole.applyTemplate")).toHaveLength(1);

    const missing = await t.call(SUPER, "workspaceRole.applyTemplate", { workspaceId: t.workspaceId, templateKey: "org-desk" });
    expect(missing.status).toBe(404);
    const elsewhere = t.gateway.rows("Workspace").find((w) => w.Name === "Elsewhere")!.ItemId as string;
    const bySuper = await t.call(SUPER, "workspaceRole.applyTemplate", { workspaceId: elsewhere, templateKey: "reviewer" });
    expect(bySuper.status).toBe(200);
    expect(t.gateway.rows("WorkspaceRole").map((r) => r.WorkspaceId).sort()).toEqual([elsewhere, t.workspaceId].sort());
  });
});

describe("people.access", () => {
  it("answers a person's platform roles and organizations to the super admin and a platform.people.manage holder, audited", async () => {
    const t = setup();
    for (const who of [SUPER, PEOPLE_DESK]) {
      const res = await t.call(who, "people.access", { userId: ORG_DESK.userId });
      expect(res.status, who.userId).toBe(200);
      expect(res.body.data.platformRoles.map((r: { roleKey: string }) => r.roleKey)).toEqual(["org-desk"]);
    }
    const member = await t.call(SUPER, "people.access", { userId: MEMBER.userId });
    expect(member.body.data.memberships).toEqual([
      expect.objectContaining({ workspaceId: t.workspaceId, workspaceName: "Northwind", roleKey: "member", status: "active" }),
    ]);
    expect(audits(t.gateway, "people.access")).toHaveLength(3);
  });

  it("refuses everyone else", async () => {
    const t = setup();
    for (const who of [OWNER, ORG_DESK, NOBODY]) {
      const no = await t.call(who, "people.access", { userId: MEMBER.userId });
      expect(no.status, JSON.stringify(no.body)).toBe(403);
    }
    expect(audits(t.gateway, "people.access")).toHaveLength(0);
  });
});

describe("broad keys reach the existing ops", () => {
  it("platform.orgs.manage lists, suspends and resumes organizations; platform.people.manage does not", async () => {
    const t = setup();
    const list = await t.call(ORG_DESK, "workspace.list", {});
    expect(list.status).toBe(200);
    // every organization (newest first, by CreatedDate: test/ordering/platformLists.test.ts; these seeds carry no date)
    expect(list.body.data.items.map((w: { name: string; planKey: string | null }) => [w.name, w.planKey])).toEqual(expect.arrayContaining([["Elsewhere", null], ["Northwind", null]]));
    expect(list.body.data.items).toHaveLength(2);
    const no = await t.call(PEOPLE_DESK, "workspace.suspend", { workspaceId: t.workspaceId, suspended: true });
    expect(no.status).toBe(403);
    const yes = await t.call(ORG_DESK, "workspace.suspend", { workspaceId: t.workspaceId, suspended: true });
    expect(yes.status).toBe(200);
    expect(t.gateway.rows("Workspace").find((w) => w.ItemId === t.workspaceId)?.Status).toBe("suspended");
  });
});
