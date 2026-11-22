// The permission catalogue and the one resolver every op uses: broad keys bring the fine-grained ones, the super admin
// holds everything, a template's organization permissions never become platform rights.
import { describe, expect, it } from "vitest";
import {
  PERMISSION_DESCRIPTION, PLATFORM_PERMISSION, PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS, expandPlatformPermissions,
  permissionDescription,
} from "../../src/domain/permissions";
import { PERMISSION_LABEL, PLATFORM_PERMISSION_AREAS } from "../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE, checkOrgRoleTemplateChange, checkPlatformRoleChange, platformPermissionsFor } from "../../src/domain/roles";
import { resolvePlatformAccess, resolveWorkspaceAccess } from "../../src/domain/tenancy";

const role = (key: string, permissions: string[]) => ({ key, name: key, permissions, isBuiltIn: false });

describe("the permission catalogue", () => {
  it("names the keys the billing, engine and shell agents check", () => {
    expect(PLATFORM_PERMISSION).toMatchObject({
      billingManage: "platform.billing.manage",
      usageView: "platform.usage.view",
      engineView: "platform.engine.view",
      aiManage: "platform.ai.manage",
      rolesManage: "platform.roles.manage",
      orgsManage: "platform.orgs.manage",
      peopleManage: "platform.people.manage",
    });
    for (const p of Object.values(PLATFORM_PERMISSION)) expect(PLATFORM_PERMISSIONS).toContain(p);
  });

  it("gives every permission a label, a plain description and exactly one area", () => {
    for (const p of [...PLATFORM_PERMISSIONS, ...WORKSPACE_PERMISSIONS]) {
      expect((PERMISSION_LABEL as Record<string, string>)[p], p).toBeTruthy();
      expect(PERMISSION_DESCRIPTION[p], p).toMatch(/\.$/);
      expect(permissionDescription(p)).toBe(PERMISSION_DESCRIPTION[p]);
    }
    const inAreas = PLATFORM_PERMISSION_AREAS.flatMap((a) => a.permissions);
    expect([...inAreas].sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
    expect(new Set(inAreas).size).toBe(inAreas.length);
  });
});

describe("the resolver", () => {
  it("expands broad keys to the keys the existing ops check", () => {
    expect(expandPlatformPermissions(["platform.orgs.manage"])).toEqual([
      "platform.workspaces.view", "platform.workspaces.manage", "platform.orgs.manage", "platform.workspaceRoles.view",
    ]);
    expect(expandPlatformPermissions(["platform.people.manage"])).toEqual(["platform.users.view", "platform.users.manage", "platform.people.manage"]);
    expect(expandPlatformPermissions(["platform.billing.manage"])).toEqual(["platform.billing.manage", "platform.usage.view"]);
    expect(expandPlatformPermissions(["platform.ai.manage"])).toEqual(["platform.engine.view", "platform.ai.manage"]);
    expect(expandPlatformPermissions(["view", "made.up", "platform.audit.view"])).toEqual(["platform.audit.view"]);
  });

  it("the super admin and Platform admin hold every platform key, the new ones included", () => {
    expect(platformPermissionsFor({ isSuperAdmin: true, roleKeys: [], roles: [] })).toEqual([...PLATFORM_PERMISSIONS]);
    expect(platformPermissionsFor({ isSuperAdmin: false, roleKeys: [PLATFORM_ADMIN_ROLE.key], roles: [] })).toEqual([...PLATFORM_PERMISSIONS]);
  });

  it("only active assignments count, and a template's organization permissions grant no platform right", () => {
    const roles = [role("billing-desk", ["platform.billing.manage"]), role("reviewer", ["view", "comment", "members.manage"])];
    const a = resolvePlatformAccess({
      isSuperAdmin: false,
      assignments: [{ roleKey: "billing-desk", status: "revoked" }, { roleKey: "reviewer", status: "active" }],
      platformRoles: roles,
    });
    expect(a.permissions).toEqual([]);
    const b = resolvePlatformAccess({ isSuperAdmin: false, assignments: [{ roleKey: "billing-desk", status: "active" }], platformRoles: roles });
    expect(b.permissions).toEqual(["platform.billing.manage", "platform.usage.view"]);
  });

  it("platform.orgs.manage reaches into an organization the person is not a member of, as a manager only", () => {
    const platform = expandPlatformPermissions(["platform.orgs.manage"]);
    const w = resolveWorkspaceAccess({ isSuperAdmin: false, membership: null, customRoles: [], platformPermissions: platform });
    expect(w.viaPlatform).toBe(true);
    expect(w.permissions).toEqual(expect.arrayContaining(["members.manage", "roles.manage"]));
    expect(w.permissions).not.toContain("project.delete");
  });
});

describe("role rules", () => {
  const holder = { isSuperAdmin: false, permissions: expandPlatformPermissions(["platform.roles.manage"]) };
  it("a template holds organization permissions only and needs platform.roles.manage", () => {
    expect(checkOrgRoleTemplateChange({ key: "reviewer", name: "Reviewer", permissions: ["view", "comment"] }, holder)).toEqual({ ok: true });
    expect(checkOrgRoleTemplateChange({ key: "reviewer", name: "Reviewer", permissions: ["platform.audit.view"] }, holder)).toMatchObject({ ok: false, code: "unknown-permission" });
    expect(checkOrgRoleTemplateChange({ key: "owner", name: "Owner", permissions: ["view"] }, holder)).toMatchObject({ ok: false, code: "invalid-key" });
    expect(checkOrgRoleTemplateChange({ key: "reviewer", name: "Reviewer", permissions: [] }, holder)).toMatchObject({ ok: false, code: "no-permissions" });
    expect(checkOrgRoleTemplateChange({ key: "reviewer", name: "Reviewer", permissions: ["view"] }, { isSuperAdmin: false, permissions: ["platform.orgs.manage"] }))
      .toMatchObject({ ok: false, code: "not-held" });
  });

  it("platform.roles.manage stays super-admin-only to grant", () => {
    expect(checkPlatformRoleChange({ key: "role-desk", name: "Role desk", permissions: ["platform.roles.manage"] }, holder)).toMatchObject({ ok: false, code: "super-admin-only" });
    expect(checkPlatformRoleChange({ key: "role-desk", name: "Role desk", permissions: ["platform.roles.manage"] }, { isSuperAdmin: true, permissions: [] })).toEqual({ ok: true });
  });
});
