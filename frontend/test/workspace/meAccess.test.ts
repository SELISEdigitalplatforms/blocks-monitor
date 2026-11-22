// me.access through the real router: the signed-in person's own platform access exactly as the ops resolve it (the
// super admin flag, the permissions of the platform roles they hold now), read-only (nothing written, no invitation
// accepted, unlike me.bootstrap), listed as a read for the client.
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { WORKSPACE_DEFS } from "../../functions/workspace/ops/index";
import { opKind } from "../../src/blocks/fnKinds";
import { PLATFORM_PERMISSIONS } from "../../src/domain/rbac";

const PERSON = { userId: "person-1", email: "person@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-user", "mf-super-admin"] };

function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { name: "Acme", members: [{ ...PERSON, roleKey: "member" }] });
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  seedRow(gateway, "PlatformRole", { ReaderIds: [], Key: "auditor", Name: "Auditor", Permissions: ["platform.audit.view"], IsBuiltIn: false });
  seedRow(gateway, "PlatformRole", { ReaderIds: [], Key: "usage", Name: "Usage", Permissions: ["platform.usage.view"], IsBuiltIn: false });
  let n = 0;
  const call = (who: { userId: string; email: string; roles?: string[] }, args?: Record<string, unknown>) =>
    runOp("workspace", WORKSPACE_DEFS, { ctx: fakeCtx(who), gateway, request: { op: "me.access", ...(args ? { args } : {}), requestId: `req-access-${++n}-abcdefghijklmnop` } });
  const grant = (key: string, status = "active") =>
    seedRow(gateway, "PlatformRoleAssignment", { ReaderIds: [], UserId: PERSON.userId, RoleKey: key, Status: status });
  return { gateway, workspaceId, call, grant };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as { isSuperAdmin: boolean; platformPermissions: string[]; platformRoleKeys: string[] };
};

describe("me.access", () => {
  it("is registered in mf-workspace as a read", async () => {
    expect(await listRegisteredOps("workspace")).toContain("me.access");
    expect(opKind("workspace", "me.access")).toBe("read");
    expect(opKind("workspace", "me.bootstrap")).toBe("write");
  });

  it("answers the platform roles the person holds now: none, one granted, then the other", async () => {
    const t = setup();
    expect(data(await t.call(PERSON))).toEqual({ isSuperAdmin: false, platformPermissions: [], platformRoleKeys: [] });
    t.grant("auditor");
    expect(data(await t.call(PERSON))).toMatchObject({ isSuperAdmin: false, platformPermissions: ["platform.audit.view"], platformRoleKeys: ["auditor"] });
    // a revoked assignment no longer counts; another active one does
    const t2 = setup();
    t2.grant("auditor", "revoked");
    t2.grant("usage");
    expect(data(await t2.call(PERSON))).toMatchObject({ platformPermissions: ["platform.usage.view"], platformRoleKeys: ["usage"] });
  });

  it("answers every platform permission for the super admin", async () => {
    const t = setup();
    const a = data(await t.call(SUPER));
    expect(a.isSuperAdmin).toBe(true);
    expect([...a.platformPermissions].sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
  });

  it("writes nothing and accepts no invitation", async () => {
    const t = setup();
    const other = seedWorkspace(t.gateway, { name: "Invites", members: [{ userId: "owner-2", email: "owner2@example.org", roleKey: "owner" }] }).workspaceId;
    seedRow(t.gateway, "Membership", { WorkspaceId: other, ReaderIds: [], UserId: "", Email: PERSON.email, RoleKey: "member", Status: "invited" });
    const before = JSON.stringify(["Account", "Membership", "Invitation", "AuditEvent", "Operation", "PlatformRoleAssignment"].map((s) => t.gateway.rows(s)));
    data(await t.call(PERSON));
    expect(JSON.stringify(["Account", "Membership", "Invitation", "AuditEvent", "Operation", "PlatformRoleAssignment"].map((s) => t.gateway.rows(s)))).toBe(before);
    const writes = t.gateway.calls.filter((c) => !["get", "find", "findAll", "list", "listAll", "count"].includes(c.method));
    expect(writes).toEqual([]);
  });

  it("takes no arguments", async () => {
    const t = setup();
    expect((await t.call(PERSON, { userId: "someone-else" })).status).toBe(400);
  });
});
