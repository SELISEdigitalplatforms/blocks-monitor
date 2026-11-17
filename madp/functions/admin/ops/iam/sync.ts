// iam.sync.run: brings Blocks OS IAM in step with the Factory. dryRun (the default) only answers the plan: permissions,
// roles and organizations IAM is missing or holds differently, and the grants each person lacks or holds beyond their
// Factory roles (at most MAX_SYNC_PEOPLE people per run). A check needs platform.roles.manage; applying it needs a
// platform admin. While the Factory is the source the plan is applied in full; once IAM is the source only what IAM
// is missing is added (IAM wins on differences). Audited with the counts; the last check and sync are kept in iam.sync.
import { audit, fail, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import type { IamDirectory, OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, type PlatformSettingRow } from "../../../workspace/ops/_shared/records";
import {
  IAM_SYNC_KEY, directoryOf, expectedRoles, iamFail, isPlatformAdmin, noIam, planDefinitions, planGrants, readFactoryState,
  settingValue, settingsRead, sourceOf, writeSetting, type IamPlan,
} from "./shared";
import type { IamSyncRecord } from "./status";

export interface IamSyncAnswer { dryRun: boolean; source: "factory" | "iam"; plan: IamPlan; applied: number; failed: number }

export async function iamSyncRun(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<IamSyncAnswer>> {
  const a = readArgs(args, { dryRun: "boolean?" });
  if (!a.ok) return { ok: false, error: a.error };
  const dryRun = a.value.dryRun !== false;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.roles.manage",
    extra: { settings: settingsRead(deps), state: () => readFactoryState(deps) },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!dryRun && !isPlatformAdmin(caller)) return fail("forbidden", "tenancy.superAdminOnly");
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  const settings = caller.extra.settings as PlatformSettingRow[];
  const source = sourceOf(settings);
  const state = caller.extra.state as Awaited<ReturnType<typeof readFactoryState>>;

  let plan: IamPlan;
  try {
    const [permissions, roles, organizations] = await Promise.all([iam.listPermissions(), iam.listRoles(), iam.listOrganizations()]);
    const expected = expectedRoles(state);
    const defs = planDefinitions(source, expected, state.workspaces, { permissions, roles, organizations });
    const orgIds = new Set(organizations.map((o) => o.id));
    const orgOf = (ws: string) => {
      const id = state.workspaces.find((w) => w.ItemId === ws)?.IamOrganizationId;
      return id && orgIds.has(id) ? id : undefined;
    };
    const grants = await planGrants(iam, state, orgOf);
    const { definitionDrift, ...rest } = defs;
    plan = { ...rest, grants, drift: definitionDrift + grants.add.length + grants.remove.length };
  } catch (e) {
    return iamFail(e);
  }

  let applied = 0;
  let failed = 0;
  if (!dryRun) {
    const result = await apply(iam, deps, caller.userId, source, plan, expectedRoles(state));
    applied = result.applied;
    failed = result.failed;
  }
  const before = settingValue<IamSyncRecord>(settings, IAM_SYNC_KEY) ?? {};
  const now = deps.clock.now();
  const record: IamSyncRecord = dryRun
    ? { ...before, checkedAt: now, drift: plan.drift }
    : { ...before, checkedAt: now, drift: remaining(plan, source, failed), syncedAt: now, syncedBy: caller.userId, applied, failed };
  await writeSetting(deps, caller, settings, IAM_SYNC_KEY, record, "The last Blocks OS IAM check and sync of roles and permissions.");
  if (!dryRun) await rbacChanged(deps);
  await audit(deps, ctx, caller, {
    targetType: "iam-sync",
    targetId: dryRun ? "check" : "sync",
    details: {
      source, dryRun, drift: plan.drift, applied, failed,
      permissions: plan.permissions.create.length, rolesCreate: plan.roles.create.length, rolesUpdate: plan.roles.update.length,
      organizations: plan.organizations.create.length, grantsAdd: plan.grants.add.length, grantsRemove: plan.grants.remove.length,
    },
  });
  return ok({ dryRun, source, plan, applied, failed });
}

/** What a sync leaves out of step: failed steps, roles only IAM holds (never deleted here) and, once IAM is the source,
 * the differences IAM wins. */
function remaining(plan: IamPlan, source: "factory" | "iam", failed: number): number {
  return failed + plan.roles.onlyInIam.length + (source === "iam" ? plan.roles.update.length + plan.grants.remove.length : 0);
}

async function apply(
  iam: IamDirectory,
  deps: OpDeps,
  userId: string,
  source: "factory" | "iam",
  plan: IamPlan,
  expected: ReturnType<typeof expectedRoles>,
): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  const step = async (work: () => Promise<unknown>, count = 1) => {
    try { await work(); applied += count; } catch { failed += count; }
  };
  const push = source === "factory";
  if (plan.permissions.create.length) await step(() => iam.ensurePermissions(plan.permissions.create), plan.permissions.create.length);
  const bySlug = new Map(expected.map((e) => [e.slug, e]));
  const roleWrites = [...plan.roles.create.map((r) => r.slug), ...(push ? plan.roles.update.map((r) => r.slug) : [])];
  for (const slug of roleWrites) {
    const e = bySlug.get(slug);
    if (e) await step(() => iam.upsertRole({ slug, name: e.name, description: e.description, permissions: e.permissions }));
  }
  // New organizations: the workspace keeps the IAM id, and its members' grants follow below.
  const created = new Map<string, string>();
  for (const o of plan.organizations.create) {
    await step(async () => {
      const id = await iam.ensureOrganization(o);
      created.set(o.workspaceId, id);
      await deps.gateway.update(SCHEMA.workspace, o.workspaceId, { IamOrganizationId: id, UpdatedByUserId: userId });
    });
  }
  for (const g of plan.grants.add) {
    const organizationId = g.organizationId ?? (g.workspaceId ? created.get(g.workspaceId) : undefined);
    if (g.workspaceId && !organizationId) { failed += 1; continue; }
    await step(() => iam.grant(g.userId, { roles: g.roles, ...(organizationId ? { organizationId } : {}) }));
  }
  if (push) {
    for (const g of plan.grants.remove) {
      await step(() => iam.revoke(g.userId, { roles: g.roles, ...(g.organizationId ? { organizationId: g.organizationId } : {}) }));
    }
  }
  return { applied, failed };
}
