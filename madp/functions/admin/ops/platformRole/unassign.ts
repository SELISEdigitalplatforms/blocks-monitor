// platformRole.unassign: take a platform role away from a person (platform.users.manage).
import { checkUnassignPlatformRole } from "../../../../src/domain/roles";
import { fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { platformRoleSlug } from "../../../workspace/ops/_shared/iamSync";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  SCHEMA,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
} from "../../../workspace/ops/_shared/records";
import { activeAssignmentsRead, allRolesRead, allSettingsRead, holdsUsersManage, platformReaders, roleDefOf, stampPlatformReaders } from "./assign";

export async function platformRoleUnassign(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { userId: "string", roleKey: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { userId, roleKey } = a.value;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.manage",
    extra: {
      targetAssignments: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { UserId: userId },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
      roleAssignments: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { RoleKey: roleKey, Status: "active" },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
      roles: allRolesRead(deps),
      active: activeAssignmentsRead(deps),
      settings: allSettingsRead(deps),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const targetAssignments = caller.extra.targetAssignments as PlatformRoleAssignmentRow[];
  const holderCount = (caller.extra.roleAssignments as PlatformRoleAssignmentRow[]).length;
  const roles = caller.extra.roles as PlatformRoleRow[];
  const granter = { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions };
  const isSelf = userId === caller.userId;
  if (isSelf && !caller.isSuperAdmin) return fail("forbidden", "tenancy.selfChange");
  const role = roleDefOf(roleKey, roles.find((r) => r.Key === roleKey) ?? null);
  if (!role) return fail("not_found", "tenancy.roleNotFound");
  const bad = fromRoleCheck(checkUnassignPlatformRole(role, { granter, holderCount, isSelf }));
  if (!bad.ok) return failCheck(bad);

  const row = targetAssignments.find((r) => r.RoleKey === roleKey && r.Status === "active");
  if (!row) return fail("not_found", "tenancy.assignmentNotFound");
  const beforeKeys = targetAssignments.filter((r) => r.Status === "active").map((r) => r.RoleKey);
  const before = holdsUsersManage(beforeKeys, roles);
  const after = holdsUsersManage(beforeKeys.filter((k) => k !== roleKey), roles);

  // rbac.source "iam": IAM first; a failure leaves the assignment as it is.
  const iamFail = await iamFirst(deps, (iam) => iam.revoke(userId, { roles: [platformRoleSlug(roleKey)] }));
  if (iamFail) return iamFail;
  const readerIds = platformReaders((caller.extra.active as PlatformRoleAssignmentRow[]).filter((r) => r.ItemId !== row.ItemId), roles);
  await Promise.all([
    deps.gateway.update(SCHEMA.platformRoleAssignment, row.ItemId, {
      Status: "revoked",
      RevokedAt: deps.clock.now(),
      UpdatedByUserId: caller.userId,
    }),
    stampPlatformReaders(deps, readerIds, caller.extra),
  ]);
  await rbacChanged(deps, [userId]);
  const assignment = { userId, roleKey, status: "revoked" };
  await audit(deps, ctx, caller, {
    targetType: "platform-role-assignment",
    targetId: `${userId}:${roleKey}`,
    details: { before: { holdsUsersManage: before, roleKey }, after: { holdsUsersManage: after } },
  });
  return ok(before !== after ? { assignment, iamRoleChange: { userId, role: "mf-platform-users", grant: after } } : { assignment });
}
