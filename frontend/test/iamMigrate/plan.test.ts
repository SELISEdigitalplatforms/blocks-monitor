import { describe, expect, it } from "vitest";
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS } from "../../src/domain/rbac";
import { readFactorySnapshot, readIamSnapshot, factoryUserIds } from "../../server/iam/migrate/adapter";
import { FACTORY_PERMISSION_KEYS, orgRoleSlug, platformRoleSlug, workspaceShortId, type FactorySnapshot } from "../../server/iam/migrate/model";
import { describePlan, desiredRoles, planCounts, planMigration } from "../../server/iam/migrate/plan";
import { WS_A, WS_B, factoryRows, fakeRaw, todaysIam } from "./fixtures";

async function snapshots(o: { multiOrg?: boolean; noLinkField?: boolean } = {}) {
  const rows = factoryRows();
  const raw = fakeRaw(rows, o.noLinkField ? { unknownFields: { Workspace: ["IamOrganizationId"] } } : {});
  const factory = await readFactorySnapshot(raw);
  const iam = todaysIam({ multiOrg: o.multiOrg });
  const snap = await readIamSnapshot(iam.port, factoryUserIds(factory), { allUsers: true });
  return { rows, raw, factory, iam, snap };
}

describe("reading today's Factory rows", () => {
  it("reads roles with their scope, active assignments only, every membership, and the link field when the schema has it", async () => {
    const { factory } = await snapshots();
    expect(factory.platformRoles.map((r) => `${r.key}:${r.scope}`).sort()).toEqual(["billing-desk:platform", "people-desk:platform", "reviewer:organization"]);
    expect(factory.assignments.map((a) => a.userId).sort()).toEqual(["u-admin", "u-bill", "u-bill", "u-people"]);
    expect(factory.memberships).toHaveLength(8);
    expect(factory.workspaceLinkFieldReady).toBe(true);
  });

  it("falls back without IamOrganizationId on a tenant whose schema lacks it, and the link step is blocked", async () => {
    const { factory, snap } = await snapshots({ noLinkField: true, multiOrg: true });
    expect(factory.workspaceLinkFieldReady).toBe(false);
    expect(factory.workspaces).toHaveLength(2);
    const plan = planMigration(factory, snap);
    expect(plan.blockers.some((b) => b.startsWith("link:"))).toBe(true);
  });
});

describe("the plan for today's tenant", () => {
  it("creates every Factory permission once, named by its key", async () => {
    const { factory, snap } = await snapshots();
    const plan = planMigration(factory, snap);
    expect(plan.permissions.create.map((p) => p.key)).toEqual([...PLATFORM_PERMISSIONS, ...WORKSPACE_PERMISSIONS]);
    expect(plan.permissions.create.find((p) => p.key === "members.manage")?.description).toBe("Invite, suspend and remove members, and change their roles.");
    expect(plan.permissions.existing).toBe(0);
  });

  it("creates the platform, template and organization roles with their permissions and slugs", async () => {
    const { factory, snap } = await snapshots();
    const plan = planMigration(factory, snap);
    const bySlug = Object.fromEntries(plan.roles.create.map((r) => [r.slug, r]));
    const short = workspaceShortId(WS_A);
    expect(Object.keys(bySlug).sort()).toEqual(
      [
        "mf-platform-super-admin",
        platformRoleSlug("platform-admin"),
        "mf-platform-billing-desk",
        "mf-platform-people-desk",
        "mf-tpl-reviewer",
        "mf-org-owner",
        "mf-org-member",
        "mf-org-viewer",
        `mf-org-${short}-qa`,
        `mf-org-${workspaceShortId(WS_B)}-qa`,
      ].sort(),
    );
    expect(short).toMatch(/^a1b2c3d4/);
    expect(bySlug[platformRoleSlug("platform-admin")].permissions).toEqual([...PLATFORM_PERMISSIONS]);
    expect(bySlug["mf-platform-super-admin"].permissions).toEqual([...PLATFORM_PERMISSIONS]);
    // Raw keys, not expanded: the resolver expands broad keys on both sides.
    expect(bySlug["mf-platform-people-desk"].permissions).toEqual(["platform.people.manage", "platform.workspaces.manage"]);
    expect(bySlug["mf-tpl-reviewer"].permissions).toEqual(["release.approve", "comment", "view"]);
    expect(bySlug["mf-org-owner"].permissions).toEqual([...WORKSPACE_PERMISSIONS]);
    expect(bySlug["mf-org-viewer"]).toMatchObject({ name: "Viewer", description: "Built-in organization role.", permissions: ["release.approve", "comment", "view"] });
    // Labels as iam.sync expects them (functions/admin/ops/iam/shared.ts expectedRoles), so its drift check agrees.
    expect(bySlug["mf-platform-admin"]).toMatchObject({ name: "Platform admin", description: "Every platform permission (built-in)." });
    expect(bySlug["mf-platform-people-desk"]).toMatchObject({ name: "People desk", description: "" });
    expect(bySlug[`mf-org-${short}-qa`]).toMatchObject({ name: "QA", permissions: ["build.run", "comment", "view"], workspaceId: WS_A });
    expect(bySlug[`mf-org-${short}-qa`].description).toBe("Role of the organization Acme.");
    expect(plan.roles.update).toEqual([]);
  });

  it("with multi-organization mode off: organizations are blocked, organization grants wait, platform grants keep every other role", async () => {
    const { factory, snap } = await snapshots();
    expect(snap.multiOrgEnabled).toBe(false);
    const plan = planMigration(factory, snap);
    expect(plan.blockers.some((b) => b.startsWith("organizations:") && b.includes("multi-organization mode is off"))).toBe(true);
    expect(plan.organizations.create.map((c) => c.name)).toEqual(["Acme", "Beta"]);
    const platform = plan.grants.filter((g) => g.workspaceId === null);
    expect(platform.map((g) => [g.userId, g.roles])).toEqual([
      ["u-admin", [platformRoleSlug("platform-admin"), "mf-user"]],
      ["u-bill", ["mf-platform-billing-desk", "mf-user"]],
      ["u-people", ["mf-platform-people-desk", "mf-user"]],
      // Today's super admin also gets the IAM-mode super admin role; the safety role stays.
      ["u-super", ["mf-platform-super-admin", "mf-super-admin", "mf-user"]],
    ]);
    const org = plan.grants.filter((g) => g.workspaceId !== null);
    expect(org.every((g) => g.organizationId === null)).toBe(true);
    expect(org.map((g) => `${g.userId}@${g.workspaceId === WS_A ? "A" : "B"}=${g.roles.join(",")}`)).toEqual([
      "u-admin@B=mf-org-owner",
      "u-mem@A=mf-org-member",
      "u-mem@B=mf-org-viewer",
      "u-owner@A=mf-org-owner",
      `u-qa@A=mf-org-${workspaceShortId(WS_A)}-qa`,
    ]);
    // Unknown roles give nothing today and are reported, not granted.
    expect(plan.warnings.some((w) => w.includes('"gone-role"'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes('"ghost"'))).toBe(true);
    expect(planCounts(plan)).toMatchObject({ permissionsToCreate: 40, rolesToCreate: 10, organizationsToCreate: 2, platformGrants: 4, organizationGrants: 5 });
    expect(describePlan(plan).some((l) => l.startsWith("BLOCKED organizations:"))).toBe(true);
  });

  it("links a workspace to the organization that already carries its marker, and keeps an existing link", async () => {
    const { factory, iam } = await snapshots({ multiOrg: true });
    const orgA = await iam.port.ensureOrganization({ workspaceId: WS_A, name: "Acme" });
    const linked: FactorySnapshot = { ...factory, workspaces: factory.workspaces.map((w) => (w.workspaceId === WS_B ? { ...w, iamOrganizationId: "org-b" } : w)) };
    iam.orgs.push({ id: "org-b", name: "Beta", description: "" });
    const plan = planMigration(linked, await readIamSnapshot(iam.port, factoryUserIds(linked), { organizationIds: ["org-b"] }));
    expect(plan.organizations).toEqual({ create: [], link: [{ workspaceId: WS_A, workspaceItemId: "w1", organizationId: orgA }], linked: 1 });
    expect(plan.grants.filter((g) => g.workspaceId === WS_A).every((g) => g.organizationId === orgA)).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  it("updates a managed role whose Factory permissions drifted, leaving non-Factory permissions alone", async () => {
    const { factory, snap } = await snapshots();
    snap.roles.push({ slug: "mf-platform-billing-desk", name: "Billing desk", description: "Plans and credit", permissions: ["platform.usage.view", "Create Data Source"] });
    const plan = planMigration(factory, snap);
    const u = plan.roles.update.find((x) => x.spec.slug === "mf-platform-billing-desk");
    expect(u).toMatchObject({ add: ["platform.billing.manage"], remove: ["platform.usage.view"], relabel: false });
  });

  it("only takes away managed roles the Factory no longer gives with --prune", async () => {
    const { factory, snap } = await snapshots();
    snap.access["u-old"] = { platform: { roles: ["mf-platform-billing-desk", "mf-user"], permissions: [] }, orgs: {} };
    const keep = planMigration(factory, snap);
    expect(keep.grants.some((g) => g.userId === "u-old")).toBe(false);
    expect(keep.warnings.some((w) => w.includes("u-old") && w.includes("--prune"))).toBe(true);
    const prune = planMigration(factory, snap, { prune: true });
    expect(prune.grants.find((g) => g.userId === "u-old")).toMatchObject({ add: [], remove: ["mf-platform-billing-desk"], roles: ["mf-user"] });
  });

  it("refuses two roles on one slug (a custom platform role keyed super-admin would become the super admin role)", async () => {
    const { factory, snap } = await snapshots();
    factory.platformRoles.push({ key: "super-admin", name: "Not quite", description: "", permissions: ["platform.audit.view"], isBuiltIn: false, scope: "platform" });
    const { blockers } = desiredRoles(factory);
    expect(blockers[0]).toMatch(/^roles: mf-platform-super-admin would stand for both/);
    expect(planMigration(factory, snap).blockers).toEqual(expect.arrayContaining([expect.stringMatching(/^roles: mf-platform-super-admin/)]));
  });
});

describe("slugs and IAM shapes", () => {
  it("names roles with iam-core's slug functions (one source for the migration, the ops and the resolver)", () => {
    expect(platformRoleSlug("billing-desk")).toBe("mf-platform-billing-desk");
    expect(orgRoleSlug("viewer", WS_A)).toBe("mf-org-viewer");
    expect(orgRoleSlug("qa", WS_A)).toBe(`mf-org-${workspaceShortId(WS_A)}-qa`);
    expect(workspaceShortId(WS_A)).toMatch(/^a1b2c3d4/);
    expect(FACTORY_PERMISSION_KEYS).toHaveLength(PLATFORM_PERMISSIONS.length + WORKSPACE_PERMISSIONS.length);
  });
});
