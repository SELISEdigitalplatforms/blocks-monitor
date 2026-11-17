// workspace.inspect: the platform view of one workspace's members and custom roles. Audited.
import { audit, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  MEMBERSHIP_FIELDS,
  SCHEMA,
  WORKSPACE_ROLE_FIELDS,
  type MembershipRow,
  type WorkspaceRoleRow,
  type WorkspaceRow,
} from "../../../workspace/ops/_shared/records";

export async function workspaceInspect(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ workspace: WorkspaceRow; members: MembershipRow[]; customRoles: WorkspaceRoleRow[] }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId } = a.value;

  const open = await openOp(ctx, deps, {
    scope: "platform",
    workspaceId,
    platformPermission: ["platform.workspaces.view", "platform.workspaceRoles.view"],
    extra: {
      members: () =>
        deps.gateway.listAll<MembershipRow>(SCHEMA.membership, {
          filter: { WorkspaceId: workspaceId, Status: { ne: "removed" } },
          fields: MEMBERSHIP_FIELDS,
          maxItems: 1000,
        }),
      roles: () =>
        deps.gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, {
          filter: { WorkspaceId: workspaceId },
          fields: WORKSPACE_ROLE_FIELDS,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const members = caller.extra.members as MembershipRow[];
  const customRoles = (caller.extra.roles as WorkspaceRoleRow[]).filter((r) => !r.IsBuiltIn);
  await audit(deps, ctx, caller, {
    action: "workspace.inspect",
    workspaceId,
    targetType: "workspace",
    targetId: workspaceId,
    details: { members: members.length, customRoles: customRoles.length },
    viaPlatform: true,
  });
  return ok({ workspace: caller.workspace!, members, customRoles });
}
