import { describe, expect, it } from "vitest";
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS } from "../../src/domain/rbac";
import { PLATFORM_MANAGER_WORKSPACE_PERMISSIONS } from "../../src/domain/tenancy";
import { createLinkWriter, factoryUserIds, readFactorySnapshot, readIamSnapshot } from "../../server/iam/migrate/adapter";
import { applyPlan } from "../../server/iam/migrate/apply";
import { computeParity, describeParity, iamRawPermissions } from "../../server/iam/migrate/parity";
import { STEPS, planMigration } from "../../server/iam/migrate/plan";
import { WS_A, WS_B, factoryRows, fakeRaw, todaysIam } from "./fixtures";

async function migrated() {
  const raw = fakeRaw(factoryRows());
  const iam = todaysIam({ multiOrg: true });
  const factory0 = await readFactorySnapshot(raw);
  const plan = planMigration(factory0, await readIamSnapshot(iam.port, factoryUserIds(factory0)));
  await applyPlan(plan, iam.port, createLinkWriter(raw), { steps: [...STEPS] });
  const factory = await readFactorySnapshot(raw);
  const organizationIds = factory.workspaces.map((w) => w.iamOrganizationId).filter((x): x is string => !!x);
  const snap = await readIamSnapshot(iam.port, factoryUserIds(factory), { allUsers: true, organizationIds });
  return { raw, iam, factory, snap };
}

const row = (r: ReturnType<typeof computeParity>, userId: string, scope: string) => r.rows.find((x) => x.userId === userId && x.scope === scope);

describe("parity", () => {
  it("before the migration every platform grant is missing in IAM; unlinked workspaces are still decided by the Factory rows", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam();
    const factory = await readFactorySnapshot(raw);
    const r = computeParity(factory, await readIamSnapshot(iam.port, factoryUserIds(factory)));
    expect(row(r, "u-bill", "platform")?.missingInIam).toEqual(["platform.billing.manage", "platform.usage.view"]);
    expect(row(r, "u-owner", WS_A)).toMatchObject({ factory: [...WORKSPACE_PERMISSIONS], iam: [...WORKSPACE_PERMISSIONS] });
    expect(r.unlinkedWorkspaces).toEqual([WS_A, WS_B]);
    expect(r.differences.length).toBeGreaterThan(0);
    expect(describeParity(r).at(-1)).toMatch(/^\d+ difference\(s\) in \d+ checks/);
  });

  it("after the migration both sides agree for every person and organization", async () => {
    const { factory, snap } = await migrated();
    const r = computeParity(factory, snap);
    expect(r.differences).toEqual([]);
    expect(r.unlinkedWorkspaces).toEqual([]);
    // Broad keys expand the same way on both sides.
    expect(row(r, "u-people", "platform")?.iam).toEqual(
      PLATFORM_PERMISSIONS.filter((p) => ["platform.users.view", "platform.users.manage", "platform.people.manage", "platform.workspaces.view", "platform.workspaces.manage"].includes(p)),
    );
    // The super admin holds everything on both sides.
    expect(row(r, "u-super", "platform")?.iam).toEqual([...PLATFORM_PERMISSIONS]);
    // A suspended member has nothing on either side.
    expect(row(r, "u-qa", WS_B)).toMatchObject({ factory: [], iam: [] });
    // Organization custom roles keep their own permissions per organization.
    expect(row(r, "u-qa", WS_A)?.iam).toEqual(["build.run", "comment", "view"]);
  });

  it("a platform manager outside an organization gets the same platform route on both sides", async () => {
    const { factory, snap } = await migrated();
    factory.memberships.push({ workspaceId: WS_A, userId: "u-people", roleKey: "member", status: "suspended" });
    const r = computeParity(factory, snap);
    expect(row(r, "u-people", WS_A)).toMatchObject({ factory: [...PLATFORM_MANAGER_WORKSPACE_PERMISSIONS].sort((a, b) => WORKSPACE_PERMISSIONS.indexOf(a) - WORKSPACE_PERMISSIONS.indexOf(b)), missingInIam: [], extraInIam: [] });
  });

  it("finds grants only IAM has, ignores an IAM grant without a membership (fail closed), and sees a Factory change IAM has not followed", async () => {
    const { iam, factory, snap: before } = await migrated();
    const orgA = String(factory.workspaces.find((w) => w.workspaceId === WS_A)?.iamOrganizationId);
    const orgB = String(factory.workspaces.find((w) => w.workspaceId === WS_B)?.iamOrganizationId);
    iam.give("u-mem", orgA, ["mf-org-owner"]);
    iam.give("u-mem", "default", ["mf-platform-billing-desk"]);
    iam.give("u-owner", orgB, ["mf-org-member"]);
    const orgIds = factory.workspaces.map((w) => w.iamOrganizationId as string);
    const snap = await readIamSnapshot(iam.port, factoryUserIds(factory), { allUsers: true, organizationIds: orgIds });
    const r = computeParity(factory, snap);
    expect(r.differences.map((d) => `${d.userId}@${d.scope}`).sort()).toEqual([`u-mem@${WS_A}`, "u-mem@platform"].sort());
    expect(row(r, "u-mem", WS_A)?.extraInIam).toContain("workspace.manage");
    expect(row(r, "u-mem", "platform")?.extraInIam).toEqual(["platform.billing.manage", "platform.usage.view"]);
    expect(row(r, "u-owner", WS_B)).toMatchObject({ factory: [], iam: [] });

    const changed = { ...factory, memberships: factory.memberships.map((m) => (m.userId === "u-mem" && m.workspaceId === WS_A ? { ...m, roleKey: "viewer" } : m)) };
    const d = computeParity(changed, before).differences;
    expect(d.map((x) => `${x.userId}@${x.scope}`)).toEqual([`u-mem@${WS_A}`]);
    expect(d[0].missingInIam).toEqual([]);
    expect(d[0].extraInIam).toContain("project.edit");
  });

  it("counts direct permissions and role permissions on the IAM side", () => {
    const idx = new Map([["r1", new Set(["view", "comment"])]]);
    expect(iamRawPermissions({ roles: ["r1", "unknown"], permissions: ["build.run"] }, idx).sort()).toEqual(["build.run", "comment", "view"]);
    expect(iamRawPermissions(undefined, idx)).toEqual([]);
  });
});
