// workspaceRole.applyTemplate: copy an organization role template into one organization as its custom role
// (roles.manage there, or the platform route: the super admin / platform.orgs.manage). The copy goes through
// workspaceRole.save, so the same rules hold: only permissions the caller holds, the per-organization role limit,
// and an audit entry (Action workspaceRole.applyTemplate). Later template edits do not change copies already made.
import { fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import type { PlatformRoleRow } from "../../../workspace/ops/_shared/records";
import { isTemplate, readScopedRoles } from "../platformRole/scope";
import { workspaceRoleSave } from "./save";

export async function workspaceRoleApplyTemplate(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { workspaceId: "string", templateKey: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, templateKey } = a.value;
  // The permission is checked before the template is looked at, so nobody can probe template keys.
  const open = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId,
    permission: "roles.manage",
    extra: { template: () => readScopedRoles(deps, { Key: templateKey }) },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const template = (open.caller.extra.template as PlatformRoleRow[]).find(isTemplate) ?? null;
  if (!template) return fail("not_found", "tenancy.roleNotFound");
  const saved = await workspaceRoleSave(
    ctx,
    {
      workspaceId,
      key: template.Key,
      name: template.Name ?? "",
      description: template.Description ?? "",
      permissions: template.Permissions ?? [],
    },
    deps,
  );
  if (!saved.ok) return saved;
  return ok({ ...saved.data, templateKey });
}
