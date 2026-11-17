// workspaceRole.delete: remove a custom role. While people hold it, reassignTo says where they go.
import { checkAssignRole, workspacePermissionsFor } from "../../../../src/domain/roles";
import { checkOutranks, fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, builtInOrCustomRole, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { ensureIamOrgRole, linkedWorkspaceOrg, orgRoleSlug, setIamOrgRole } from "../../../workspace/ops/_shared/iamSync";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, WORKSPACE_ROLE_FIELDS, toRoleDef, type WorkspaceRoleRow } from "../../../workspace/ops/_shared/records";

export async function workspaceRoleDelete(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ key: string; reassigned: number }>> {
  const a = readArgs(args, { workspaceId: "string", key: "string", reassignTo: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, key } = a.value;
  const reassignTo = a.value.reassignTo?.trim() || null;

  const open = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId,
    permission: "roles.manage",
    loadTeam: true,
    extra: {
      roles: () =>
        deps.gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, {
          filter: { WorkspaceId: workspaceId, Key: key },
          fields: WORKSPACE_ROLE_FIELDS,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;

  if (builtInOrCustomRole(key, []) ) return fail("invalid_input", "tenancy.builtInRole");
  const row = (caller.extra.roles as WorkspaceRoleRow[]).find((r) => !r.IsBuiltIn) ?? null;
  if (!row) return fail("not_found");

  const holders = caller.team.filter((m) => m.RoleKey === key && m.Status !== "removed");
  if (holders.length > 0 && !reassignTo) return fail("conflict", "tenancy.roleInUse", { count: holders.length });
  if (reassignTo) {
    const target = reassignTo === key ? null : builtInOrCustomRole(reassignTo, caller.customRoles);
    if (!target) return fail("invalid_input", "tenancy.unknownRole");
    const bad = fromRoleCheck(checkAssignRole(target, caller.granter));
    if (!bad.ok) return failCheck(bad);
  }
  // Same rule as member.setRole, for every holder that moves: nobody is demoted by deleting their role.
  if (reassignTo && holders.length) {
    const roles = caller.customRoles.some((r) => r.key === key) ? caller.customRoles : [...caller.customRoles, toRoleDef(row)];
    for (const m of holders) {
      const outranks = checkOutranks({
        granterPermissions: caller.granter,
        targetPermissions: workspacePermissionsFor({ roleKey: m.RoleKey, customRoles: roles }),
        exempt: caller.isSuperAdmin || Boolean(caller.access?.viaPlatform),
      });
      if (!outranks.ok) return failCheck(outranks);
    }
  }

  // rbac.source "iam": IAM first, in the same order (the holders move, then the role goes).
  const iamFail = await iamFirst(deps, async (iam) => {
    const workspaceRow = caller.workspace!;
    const moving = holders.filter((m) => m.Status === "active" && m.UserId);
    if (reassignTo && moving.length) {
      const target = builtInOrCustomRole(reassignTo, caller.customRoles)!;
      const orgId = await linkedWorkspaceOrg(deps, workspaceId);
      if (orgId) await ensureIamOrgRole(iam, target, workspaceRow);
      if (orgId) for (const m of moving) await setIamOrgRole(iam, { userId: m.UserId!, organizationId: orgId, workspaceId, roleKey: reassignTo, previousKey: key });
    }
    await iam.deleteRole(orgRoleSlug(key, workspaceId));
  });
  if (iamFail) return iamFail;
  // Children first: the people move, then the role goes.
  if (reassignTo && holders.length) {
    await Promise.all(
      holders.map((m) => deps.gateway.update(SCHEMA.membership, m.ItemId, { RoleKey: reassignTo, UpdatedByUserId: caller.userId })),
    );
  }
  await deps.gateway.remove(SCHEMA.workspaceRole, row.ItemId);
  await rbacChanged(deps);
  await audit(deps, ctx, caller, {
    workspaceId,
    targetType: "workspace-role",
    targetId: key,
    details: { key, reassignTo, moved: holders.length },
    viaPlatform: Boolean(caller.access?.viaPlatform),
  });
  return ok({ key, reassigned: reassignTo ? holders.length : 0 });
}
