// iam.status: where roles and permissions are read from (rbac.source), whether Blocks OS IAM answers, what it holds for
// the Factory, how far it is out of step on definitions (permissions, roles, organizations), the last check and sync,
// and the last parity check. platform.roles.manage or platform.people.manage. Not audited; IAM is only read.
import { ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import type { PlatformRoleRow, PlatformSettingRow } from "../../../workspace/ops/_shared/records";
import {
  IAM_PARITY_KEY, IAM_READ_PERMISSIONS, IAM_SYNC_KEY, directoryOf, expectedRoles, iamCodeOf, isFactoryRoleSlug, isPlatformAdmin,
  planDefinitions, platformRolesRead, settingValue, settingsRead, sourceOf, workspaceRolesOf, workspacesRead, type RbacSource, type WorkspaceIamRow,
} from "./shared";

export interface IamSyncRecord { checkedAt?: string; drift?: number; syncedAt?: string; syncedBy?: string; applied?: number; failed?: number }
export interface IamParityRecord { at?: string; ok?: boolean; mismatches?: number; url?: string }

export interface IamStatus {
  source: RbacSource;
  canSync: boolean;
  available: boolean;
  unavailable: null | "not-connected" | "unreachable" | "refused";
  counts: { permissions: number; roles: number; organizations: number } | null;
  drift: { permissions: number; roles: number; organizations: number; total: number } | null;
  sync: IamSyncRecord | null;
  parity: IamParityRecord | null;
}

export async function iamStatus(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<IamStatus>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: IAM_READ_PERMISSIONS,
    extra: {
      settings: settingsRead(deps),
      workspaces: workspacesRead(deps),
      platformRoles: platformRolesRead(deps),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const settings = caller.extra.settings as PlatformSettingRow[];
  const base = {
    source: sourceOf(settings),
    canSync: isPlatformAdmin(caller),
    sync: settingValue<IamSyncRecord>(settings, IAM_SYNC_KEY),
    parity: settingValue<IamParityRecord>(settings, IAM_PARITY_KEY),
  };
  const iam = directoryOf(deps);
  if (!iam) return ok({ ...base, available: false, unavailable: "not-connected", counts: null, drift: null });
  try {
    const workspaces = caller.extra.workspaces as WorkspaceIamRow[];
    const [permissions, roles, organizations, workspaceRoles] = await Promise.all([
      iam.listPermissions(), iam.listRoles(), iam.listOrganizations(), workspaceRolesOf(deps, workspaces.map((w) => w.ItemId)),
    ]);
    const expected = expectedRoles({ platformRoles: caller.extra.platformRoles as PlatformRoleRow[], workspaceRoles, workspaces });
    const plan = planDefinitions(base.source, expected, workspaces, { permissions, roles, organizations });
    const factoryRoles = roles.filter((r) => isFactoryRoleSlug(r.slug));
    const linked = new Set(workspaces.map((w) => w.IamOrganizationId).filter(Boolean));
    const drift = {
      permissions: plan.permissions.create.length,
      roles: plan.roles.create.length + plan.roles.update.length + plan.roles.onlyInIam.length,
      organizations: plan.organizations.create.length,
      total: plan.definitionDrift,
    };
    return ok({
      ...base,
      available: true,
      unavailable: null,
      counts: { permissions: permissions.length, roles: factoryRoles.length, organizations: organizations.filter((o) => linked.has(o.id)).length },
      drift,
    });
  } catch (e) {
    const code = iamCodeOf(e);
    return ok({ ...base, available: false, unavailable: code === "iam.forbidden" ? "refused" : "unreachable", counts: null, drift: null });
  }
}
