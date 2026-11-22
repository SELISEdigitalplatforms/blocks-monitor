// people.access: one person's access across the platform: their active platform roles and their memberships in
// every organization (platform.users.view; the platform.people.manage holder has it too). Audited, like workspace.inspect.
import { audit, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  MEMBERSHIP_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  SCHEMA,
  WORKSPACE_FIELDS,
  type MembershipRow,
  type PlatformRoleAssignmentRow,
  type WorkspaceRow,
} from "../../../workspace/ops/_shared/records";

export interface PersonAccess {
  userId: string;
  platformRoles: { roleKey: string; assignedAt: string }[];
  memberships: { membershipId: string; workspaceId: string; workspaceName: string; workspaceStatus: string; roleKey: string; status: string }[];
}

export async function peopleAccess(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<PersonAccess>> {
  const a = readArgs(args, { userId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { userId } = a.value;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.view",
    extra: {
      assignments: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { UserId: userId, Status: "active" },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
      memberships: () =>
        deps.gateway.listAll<MembershipRow>(SCHEMA.membership, {
          filter: { UserId: userId, Status: { ne: "removed" } },
          fields: MEMBERSHIP_FIELDS,
          maxItems: 500,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const memberships = caller.extra.memberships as MembershipRow[];
  const ids = [...new Set(memberships.map((m) => m.WorkspaceId))];
  const workspaces = ids.length
    ? await deps.gateway.listAll<WorkspaceRow>(SCHEMA.workspace, { filter: { ItemId: { in: ids } }, fields: WORKSPACE_FIELDS, maxItems: 500 })
    : [];
  const byId = new Map(workspaces.map((w) => [w.ItemId, w]));
  const answer: PersonAccess = {
    userId,
    platformRoles: (caller.extra.assignments as PlatformRoleAssignmentRow[]).map((r) => ({ roleKey: r.RoleKey, assignedAt: String(r.AssignedAt ?? "") })),
    memberships: memberships
      .map((m) => ({
        membershipId: m.ItemId,
        workspaceId: m.WorkspaceId,
        workspaceName: byId.get(m.WorkspaceId)?.Name ?? "",
        workspaceStatus: byId.get(m.WorkspaceId)?.Status ?? "",
        roleKey: m.RoleKey,
        status: m.Status,
      }))
      .sort((x, y) => x.workspaceName.localeCompare(y.workspaceName)),
  };
  await audit(deps, ctx, caller, {
    action: "people.access",
    targetType: "account",
    targetId: userId,
    details: { platformRoles: answer.platformRoles.length, memberships: answer.memberships.length },
  });
  return ok(answer);
}
