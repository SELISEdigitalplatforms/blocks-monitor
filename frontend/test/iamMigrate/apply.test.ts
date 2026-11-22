import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLinkWriter, factoryUserIds, readFactorySnapshot, readIamSnapshot } from "../../server/iam/migrate/adapter";
import { applyPlan } from "../../server/iam/migrate/apply";
import { migrateMain, parityMain } from "../../server/iam/migrate/main";
import { orgRoleSlug, platformRoleSlug } from "../../server/iam/migrate/model";
import { STEPS, planMigration } from "../../server/iam/migrate/plan";
import { WS_A, WS_B, factoryRows, fakeRaw, todaysIam } from "./fixtures";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "iam-migrate-"));

async function planFor(raw: ReturnType<typeof fakeRaw>, iam: ReturnType<typeof todaysIam>, o: { prune?: boolean } = {}) {
  const factory = await readFactorySnapshot(raw);
  const organizationIds = factory.workspaces.map((w) => w.iamOrganizationId).filter((x): x is string => !!x);
  return planMigration(factory, await readIamSnapshot(iam.port, factoryUserIds(factory), { allUsers: true, organizationIds }), o);
}

describe("apply", () => {
  it("runs permissions -> roles -> organizations -> organization grants -> link -> platform grants, and a rerun finds nothing left", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    const plan = await planFor(raw, iam);
    const writer = createLinkWriter(raw);
    const report = await applyPlan(plan, iam.port, { linkWorkspace: async (id, org) => { iam.calls.push(`link ${id}`); await writer.linkWorkspace(id, org); } }, { steps: [...STEPS] });
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);

    const firstOf = (prefix: string) => iam.calls.findIndex((c) => c.startsWith(prefix));
    const lastOf = (prefix: string) => iam.calls.map((c) => c.startsWith(prefix)).lastIndexOf(true);
    expect(firstOf("ensurePermissions")).toBe(0);
    expect(firstOf("upsertRole")).toBeGreaterThan(firstOf("ensurePermissions"));
    expect(firstOf("ensureOrganization")).toBeGreaterThan(lastOf("upsertRole"));
    expect(firstOf("grant")).toBeGreaterThan(lastOf("ensureOrganization"));
    // Every member's organization role before any link; platform grants last.
    const orgGrants = iam.calls.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("grant ") && !c.includes(" platform "));
    const platformGrants = iam.calls.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("grant ") && c.includes(" platform "));
    expect(Math.max(...orgGrants.map(([, i]) => i))).toBeLessThan(firstOf("link"));
    expect(Math.min(...platformGrants.map(([, i]) => i))).toBeGreaterThan(lastOf("link"));

    // Workspaces now carry their organization id.
    const linked = raw.rows.Workspace.map((w) => w.IamOrganizationId);
    expect(linked.every((x) => typeof x === "string" && x.startsWith("org-"))).toBe(true);
    // Other roles survive the replace-the-list grant.
    const admin = await iam.port.userAccess("u-admin");
    expect(admin.platform.roles).toEqual([platformRoleSlug("platform-admin"), "mf-user"].sort());
    const orgA = String(raw.rows.Workspace.find((w) => w.WorkspaceId === WS_A)?.IamOrganizationId);
    expect((await iam.port.userAccess("u-qa", { organizationIds: [orgA] })).orgs[orgA].roles).toEqual([orgRoleSlug("qa", WS_A)]);
    // Today's super admin also holds the IAM-mode super admin role.
    expect((await iam.port.userAccess("u-super")).platform.roles).toEqual(["mf-platform-super-admin", "mf-super-admin", "mf-user"]);

    const again = await planFor(raw, iam);
    expect(again.permissions.create).toEqual([]);
    expect(again.roles.create).toEqual([]);
    expect(again.roles.update).toEqual([]);
    expect(again.organizations).toEqual({ create: [], link: [], linked: 2 });
    expect(again.grants).toEqual([]);
    expect(again.blockers).toEqual([]);
  });

  it("with multi-organization mode off: permissions, roles and platform grants run; organization work is skipped, not failed", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam();
    const plan = await planFor(raw, iam);
    const report = await applyPlan(plan, iam.port, createLinkWriter(raw), { steps: [...STEPS] });
    expect(report.failed).toBe(0);
    expect(report.actions.filter((a) => a.skipped).map((a) => a.step).sort()).toEqual(["grants", "grants", "grants", "grants", "grants", "organizations", "organizations"]);
    expect((await iam.port.userAccess("u-bill")).platform.roles).toEqual(["mf-platform-billing-desk", "mf-user"]);
    expect(raw.rows.Workspace.some((w) => w.IamOrganizationId)).toBe(false);
  });

  it("--only runs just the steps asked for", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    const plan = await planFor(raw, iam);
    await applyPlan(plan, iam.port, createLinkWriter(raw), { steps: ["permissions"] });
    expect(iam.calls).toEqual(["ensurePermissions 40"]);
  });

  it("a failed call is recorded and the run goes on", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    const plan = await planFor(raw, iam);
    const port = { ...iam.port, upsertRole: async (r: { slug: string }) => {
      if (r.slug === "mf-tpl-reviewer") throw Object.assign(new Error("refused"), { code: "iam.forbidden" });
      return iam.port.upsertRole(r as never);
    } };
    const report = await applyPlan(plan, port, createLinkWriter(raw), { steps: [...STEPS] });
    expect(report.failed).toBe(1);
    expect(report.actions.find((a) => !a.ok && !a.skipped)).toMatchObject({ step: "roles", target: "mf-tpl-reviewer", error: "iam.forbidden: refused" });
    expect(report.actions.filter((a) => a.step === "grants" && a.ok)).toHaveLength(9);
  });

  it("--prune takes a managed role away and keeps the others", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    iam.give("u-old", "default", ["mf-platform-billing-desk"]);
    const plan = await planFor(raw, iam, { prune: true });
    await applyPlan(plan, iam.port, createLinkWriter(raw), { steps: [...STEPS] });
    expect((await iam.port.userAccess("u-old")).platform.roles).toEqual(["mf-user"]);
  });
});

describe("the commands", () => {
  it("a dry run prints the plan, writes only the local report, and changes nothing", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam();
    const lines: string[] = [];
    const report = path.join(tmp(), "plan.json");
    const code = await migrateMain(["--report", report], "/nowhere", { wiring: { raw, port: iam.port }, log: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(iam.calls).toEqual([]);
    expect(lines.some((l) => l.startsWith("dry run: nothing written"))).toBe(true);
    const body = JSON.parse(fs.readFileSync(report, "utf8"));
    expect(body).toMatchObject({ kind: "iam-migrate", mode: "dry-run", iam: { multiOrgEnabled: false }, counts: { permissionsToCreate: 40, rolesToCreate: 10 } });
  });

  it("--apply carries the plan out and parity then finds no difference", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    const dir = tmp();
    const quiet = () => {};
    expect(await parityMain(["--all-users"], "/nowhere", { wiring: { raw, port: iam.port }, log: quiet })).toBe(1);
    expect(await migrateMain(["--apply", "--report", path.join(dir, "a.json")], "/nowhere", { wiring: { raw, port: iam.port }, log: quiet })).toBe(0);
    const lines: string[] = [];
    const code = await parityMain(["--all-users", "--report", path.join(dir, "p.json")], "/nowhere", { wiring: { raw, port: iam.port }, log: (l) => lines.push(l) });
    expect(lines.filter((l) => l.startsWith("DIFF"))).toEqual([]);
    expect(code).toBe(0);
    expect(lines.some((l) => /^0 difference\(s\) in \d+ checks/.test(l))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "a.json"), "utf8")).result.failed).toBe(0);
    // The screens read the last check from PlatformSetting iam.parity.
    const setting = raw.rows.PlatformSetting.find((r) => r.Key === "iam.parity");
    expect(JSON.parse(String(setting?.ValueJson))).toEqual({ at: expect.any(String), ok: true, mismatches: 0, url: path.join(dir, "p.json") });
    expect(raw.rows.PlatformSetting).toHaveLength(1);
  });

  it("refuses unknown steps and --apply with --dry-run", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam();
    const lines: string[] = [];
    const w = { wiring: { raw, port: iam.port }, log: (l: string) => lines.push(l) };
    expect(await migrateMain(["--only", "roles,users"], "/nowhere", w)).toBe(1);
    expect(await migrateMain(["--apply", "--dry-run"], "/nowhere", w)).toBe(1);
    expect(iam.calls).toEqual([]);
    expect(WS_B).toBeTruthy();
  });
});

describe("linking waits for the members", () => {
  it("does not link a workspace while one of its members' grants failed, and a rerun finishes it", async () => {
    const raw = fakeRaw(factoryRows());
    const iam = todaysIam({ multiOrg: true });
    const plan = await planFor(raw, iam);
    const port = { ...iam.port, grant: async (u: string, g: { roles?: readonly string[]; organizationId?: string }) => {
      if (u === "u-qa" && g.organizationId) throw Object.assign(new Error("down"), { code: "iam.unavailable" });
      return iam.port.grant(u, g);
    } };
    const report = await applyPlan(plan, port, createLinkWriter(raw), { steps: [...STEPS] });
    expect(report.failed).toBe(1);
    expect(report.actions.find((a) => a.step === "link" && a.skipped)?.target).toBe(WS_A);
    expect(raw.rows.Workspace.find((w) => w.WorkspaceId === WS_A)?.IamOrganizationId).toBeUndefined();
    expect(raw.rows.Workspace.find((w) => w.WorkspaceId === WS_B)?.IamOrganizationId).toMatch(/^org-/);

    const again = await planFor(raw, iam);
    expect(again.organizations.link.map((l) => l.workspaceId)).toEqual([WS_A]);
    const second = await applyPlan(again, iam.port, createLinkWriter(raw), { steps: [...STEPS] });
    expect(second.failed).toBe(0);
    expect(raw.rows.Workspace.find((w) => w.WorkspaceId === WS_A)?.IamOrganizationId).toMatch(/^org-/);
  });
});
