// platformRole.assign: give a platform role to a person (platform.users.manage).
// A revoked assignment is reactivated on the same row. The answer carries iamRoleChange
// when the person gains or loses platform.users.manage; the super admin applies it with their own token.
import {
  PLATFORM_ADMIN_ROLE,
  checkAssignPlatformRole,
  platformPermissionsFor,
  type RoleDef,
} from "../../../../src/domain/roles";
import { fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, holdersOf, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { platformRoleSlug, upsertIamRole } from "../../../workspace/ops/_shared/iamSync";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  ACCOUNT_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  PLATFORM_ROLE_FIELDS,
  PLATFORM_SETTING_FIELDS,
  SCHEMA,
  toRoleDef,
  type AccountRow,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
  type PlatformSettingRow,
} from "../../../workspace/ops/_shared/records";
import { stampPlatformRows } from "../../../workspace/ops/_shared/restamp";
import { isTemplate, readScopedRoles } from "./scope";

/** A stored PlatformRole row as a RoleDef (the built-in platform-admin is code-defined). */
export function roleDefOf(key: string, row: PlatformRoleRow | null): RoleDef | null {
  if (key === PLATFORM_ADMIN_ROLE.key) return PLATFORM_ADMIN_ROLE;
  if (!row) return null;
  return { key, name: row.Name ?? "", description: row.Description ?? "", permissions: row.Permissions ?? [], isBuiltIn: false };
}

/** Whether the person holds platform.users.manage through these active role keys. */
export function holdsUsersManage(roleKeys: readonly string[], roleRows: readonly PlatformRoleRow[]): boolean {
  const roles = roleRows.map((r) => roleDefOf(r.Key, r)).filter((r): r is RoleDef => r !== null);
  return platformPermissionsFor({ isSuperAdmin: false, roleKeys, roles }).includes("platform.users.manage");
}

/**
 * The platform restamp's reads, issued with the op's first round (they do not depend on the change being made). Every
 * assignment is read (the reader set ignores revoked ones) so the restamp can also fix a revoked row's ReaderIds.
 */
export const activeAssignmentsRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, { filter: {}, fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS });
export const allRolesRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: PLATFORM_ROLE_FIELDS });
export const allSettingsRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, { filter: {}, fields: PLATFORM_SETTING_FIELDS });

/** Whoever holds any platform permission once the change lands; computed in memory so the write and the restamp share a round. */
export const platformReaders = (assignments: readonly PlatformRoleAssignmentRow[], roles: readonly PlatformRoleRow[]): string[] =>
  holdersOf(assignments, roles.map(toRoleDef), null);

/** Stamps the reader list on the platform rows that differ, from the rows the op read in its first round. */
export const stampPlatformReaders = (
  deps: OpDeps,
  readerIds: readonly string[],
  extra: Record<string, unknown>,
): Promise<void> =>
  stampPlatformRows(deps, readerIds, {
    roles: extra.roles as PlatformRoleRow[],
    assignments: extra.active as PlatformRoleAssignmentRow[],
    settings: extra.settings as PlatformSettingRow[],
  });

export async function platformRoleAssign(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { userId: "string", roleKey: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { userId, roleKey } = a.value;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.manage",
    extra: {
      accounts: () => deps.gateway.listAll<AccountRow>(SCHEMA.account, { filter: { UserId: userId }, fields: ACCOUNT_FIELDS, maxItems: 1 }),
      assignments: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { UserId: userId },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
      roles: allRolesRead(deps),
      active: activeAssignmentsRead(deps),
      settings: allSettingsRead(deps),
      target: () => readScopedRoles(deps, { Key: roleKey }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  // An organization role template is copied into organizations; it is never held as a platform role.
  if ((caller.extra.target as PlatformRoleRow[]).some(isTemplate)) return fail("not_found", "tenancy.roleNotFound");
  const account = (caller.extra.accounts as AccountRow[])[0] ?? null;
  const assignments = caller.extra.assignments as PlatformRoleAssignmentRow[];
  const roles = caller.extra.roles as PlatformRoleRow[];
  const granter = { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions };

  if (userId === caller.userId && !caller.isSuperAdmin) return fail("forbidden", "tenancy.selfChange");
  if (!account) return fail("not_found", "tenancy.targetNoAccount");
  const role = roleDefOf(roleKey, roles.find((r) => r.Key === roleKey) ?? null);
  if (!role) return fail("not_found", "tenancy.roleNotFound");
  const bad = fromRoleCheck(checkAssignPlatformRole(role, granter));
  if (!bad.ok) return failCheck(bad);

  const activeKeys = (list: readonly PlatformRoleAssignmentRow[]) => list.filter((r) => r.Status === "active").map((r) => r.RoleKey);
  const beforeKeys = activeKeys(assignments);
  const before = holdsUsersManage(beforeKeys, roles);
  const afterKeys = beforeKeys.includes(roleKey) ? beforeKeys : [...beforeKeys, roleKey];
  const after = holdsUsersManage(afterKeys, roles);

  const existing = assignments.find((r) => r.RoleKey === roleKey) ?? null;
  // rbac.source "iam": IAM first (the role as the Factory defines it, then the person's platform access).
  const iamFail = await iamFirst(deps, async (iam) => {
    const slug = platformRoleSlug(roleKey);
    await upsertIamRole(iam, { slug, name: role.name, description: role.description ?? "", permissions: role.permissions });
    await iam.grant(userId, { roles: [slug] });
  });
  if (iamFail) return iamFail;
  const now = deps.clock.now();
  // The reader list after this change: every active assignment, plus the one being made.
  const active = (caller.extra.active as PlatformRoleAssignmentRow[]).filter((r) => !(r.UserId === userId && r.RoleKey === roleKey));
  const readerIds = platformReaders([...active, { UserId: userId, RoleKey: roleKey, Status: "active" } as PlatformRoleAssignmentRow], roles);
  const write =
    existing && existing.Status !== "active"
      ? deps.gateway.update(SCHEMA.platformRoleAssignment, existing.ItemId, {
          Status: "active",
          AssignedByUserId: caller.userId,
          AssignedAt: now,
          RevokedAt: "",
          UpdatedByUserId: caller.userId,
        })
      : !existing
        ? deps.gateway.insertOnce(
            SCHEMA.platformRoleAssignment,
            {
              UserId: userId,
              RoleKey: roleKey,
              Status: "active",
              AssignedByUserId: caller.userId,
              AssignedAt: now,
              ReaderIds: readerIds,
              CreatedByUserId: caller.userId,
              UpdatedByUserId: caller.userId,
            },
            `pra:${userId}:${roleKey}`,
          )
        : Promise.resolve();
  await Promise.all([write, stampPlatformReaders(deps, readerIds, caller.extra)]);
  await rbacChanged(deps, [userId]);
  const assignment = { userId, roleKey, status: "active" };
  await audit(deps, ctx, caller, {
    targetType: "platform-role-assignment",
    targetId: `${userId}:${roleKey}`,
    details: { before: { holdsUsersManage: before }, after: { holdsUsersManage: after, roleKey } },
  });
  return ok(before !== after ? { assignment, iamRoleChange: { userId, role: "mf-platform-users", grant: after } } : { assignment });
}
