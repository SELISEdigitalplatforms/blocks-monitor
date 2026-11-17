// workspaceRole.save: create or update a custom role of one workspace (roles.manage there, or viaPlatform).
// Built-in roles are code-defined and never stored. Served by mf-admin only.
import { checkCreateCustomRole, checkUpdateCustomRole, builtInWorkspaceRoles, MAX_CUSTOM_ROLES } from "../../../../src/domain/roles";
import { cleanText, fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, builtInOrCustomRole, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { ensureIamOrgRole } from "../../../workspace/ops/_shared/iamSync";
import { isDuplicate, type OpAnswer, type OpCtx, type OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, WORKSPACE_ROLE_FIELDS, type WorkspaceRoleRow } from "../../../workspace/ops/_shared/records";

export async function workspaceRoleSave(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ role: WorkspaceRoleRow; created: boolean }>> {
  const a = readArgs(args, {
    workspaceId: "string",
    key: "string",
    name: "string",
    description: "string?",
    permissions: "string[]",
  });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId } = a.value;
  const key = a.value.key.trim();
  const name = cleanText(a.value.name);
  const description = cleanText(a.value.description ?? "").slice(0, 300);
  const permissions = [...new Set(a.value.permissions)];

  const open = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId,
    permission: "roles.manage",
    extra: {
      roles: () =>
        deps.gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, {
          filter: { WorkspaceId: workspaceId },
          fields: WORKSPACE_ROLE_FIELDS,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const rows = caller.extra.roles as WorkspaceRoleRow[];
  const viaPlatform = Boolean(caller.access?.viaPlatform);
  const existing = rows.find((r) => !r.IsBuiltIn && r.Key === key) ?? null;
  const { gateway } = deps;
  // rbac.source "iam": the organization's own role in IAM (slug mf-org-<workspace>-<key>), written before the Factory row.
  const workspaceRow = caller.workspace!;
  const toIam = () => iamFirst(deps, (iam) => ensureIamOrgRole(iam, { key, name, description, permissions }, workspaceRow));

  if (existing) {
    const prev = builtInOrCustomRole(key, caller.customRoles);
    if (!prev) return fail("not_found");
    const bad = fromRoleCheck(checkUpdateCustomRole(prev, { name, permissions }, caller.granter));
    if (!bad.ok) return failCheck(bad);
    const iamFail = await toIam();
    if (iamFail) return iamFail;
    await gateway.update(SCHEMA.workspaceRole, existing.ItemId, {
      Name: name,
      Description: description,
      Permissions: permissions,
      UpdatedByUserId: caller.userId,
    });
    await rbacChanged(deps);
    const role: WorkspaceRoleRow = { ...existing, Name: name, Description: description, Permissions: permissions, UpdatedByUserId: caller.userId };
    await audit(deps, ctx, caller, {
      workspaceId,
      targetType: "workspace-role",
      targetId: key,
      details: { before: { name: existing.Name, permissions: existing.Permissions }, after: { name, permissions } },
      viaPlatform,
    });
    return ok({ role, created: false });
  }

  const bad = fromRoleCheck(
    checkCreateCustomRole({ key, name, permissions }, { existing: [...builtInWorkspaceRoles(), ...caller.customRoles], granterPermissions: caller.granter }),
  );
  if (!bad.ok) return failCheck(bad);
  const iamFail = await toIam();
  if (iamFail) return iamFail;

  let inserted: { item: WorkspaceRoleRow; created: boolean };
  try {
    inserted = await gateway.insertOnce<WorkspaceRoleRow>(
      SCHEMA.workspaceRole,
      {
        WorkspaceId: workspaceId,
        ReaderIds: caller.workspace!.ReaderIds,
        Key: key,
        Name: name,
        Description: description,
        Permissions: permissions,
        IsBuiltIn: false,
        CreatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      },
      `workspaceRole:${workspaceId}:${key}`,
    );
  } catch (e) {
    if (isDuplicate(e)) return fail("conflict", "tenancy.roleKeyTaken");
    throw e;
  }
  if (!inserted.created) {
    if (inserted.item.CreatedByUserId !== caller.userId) return fail("conflict", "tenancy.roleKeyTaken");
    return ok({ role: inserted.item, created: false });
  }

  await rbacChanged(deps);
  await audit(deps, ctx, caller, {
    workspaceId,
    targetType: "workspace-role",
    targetId: key,
    details: { before: null, after: { name, permissions } },
    viaPlatform,
  });
  // Concurrent creates can both pass the count above: re-count and withdraw this insert when over the limit. On the router
  // the check runs in its bookkeeping round (no read-back round); the loser then gets "unavailable" and its retry meets the limit.
  const withdrawIfOver = async (): Promise<boolean> => {
    const after = await gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, {
      filter: { WorkspaceId: workspaceId, IsBuiltIn: false },
      fields: WORKSPACE_ROLE_FIELDS,
    });
    if (after.length <= MAX_CUSTOM_ROLES) return false;
    await gateway.remove(SCHEMA.workspaceRole, inserted.item.ItemId);
    return true;
  };
  if (deps.after) {
    deps.after(async () => {
      if (await withdrawIfOver()) throw new Error("role limit reached concurrently");
    });
  } else if (await withdrawIfOver()) {
    return fail("limit_reached", "tenancy.roleLimit");
  }
  return ok({ role: inserted.item, created: true });
}
