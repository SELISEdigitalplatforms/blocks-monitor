// platformRole.delete: remove a custom platform role that nobody holds (platform.roles.manage).
import { checkDeletePlatformRole, PLATFORM_ADMIN_ROLE } from "../../../../src/domain/roles";
import { fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { platformRoleIamSlug } from "../../../workspace/ops/_shared/iamSync";
import { isTemplate, readScopedRoles } from "./scope";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  SCHEMA,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
} from "../../../workspace/ops/_shared/records";

export async function platformRoleDelete(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ key: string }>> {
  const a = readArgs(args, { key: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { key } = a.value;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.roles.manage",
    extra: {
      roles: () => readScopedRoles(deps, { Key: key }),
      holders: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { RoleKey: key, Status: "active" },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (key === PLATFORM_ADMIN_ROLE.key) return fail("invalid_input", "tenancy.builtInRole");
  const role = (caller.extra.roles as PlatformRoleRow[])[0] ?? null;
  const holders = (caller.extra.holders as PlatformRoleAssignmentRow[]).length;
  if (!role) return fail("not_found", "tenancy.roleNotFound");
  if (holders > 0) return fail("conflict", "tenancy.roleInUse", { count: holders });
  const bad = fromRoleCheck(
    checkDeletePlatformRole(
      { key, name: role.Name ?? "", permissions: role.Permissions ?? [], isBuiltIn: false },
      { holderCount: holders, granter: { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions } },
    ),
  );
  if (!bad.ok) return failCheck(bad);

  // rbac.source "iam": IAM first (IAM has no role delete: the role loses every permission and is marked removed).
  const iamFail = await iamFirst(deps, (iam) => iam.deleteRole(platformRoleIamSlug(key, isTemplate(role) ? "organization" : "platform")));
  if (iamFail) return iamFail;
  await deps.gateway.remove(SCHEMA.platformRole, role.ItemId);
  await rbacChanged(deps);
  await audit(deps, ctx, caller, {
    targetType: "platform-role",
    targetId: key,
    details: { before: { name: role.Name, permissions: role.Permissions }, after: null },
  });
  return ok({ key });
}
