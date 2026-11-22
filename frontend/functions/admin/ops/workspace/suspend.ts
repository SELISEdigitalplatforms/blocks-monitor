// workspace.suspend: suspend or resume a whole workspace (platform.workspaces.manage).
// A suspended workspace has ReaderIds [] so its members lose their reads; resuming restores them.
import { audit, fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { activeMemberships, deactivatedAccounts, restampWorkspace } from "../../../workspace/ops/_shared/restamp";
import { MEMBERSHIP_FIELDS, SCHEMA, type AccountRow, type MembershipRow, type WorkspaceRow } from "../../../workspace/ops/_shared/records";

export async function workspaceSuspend(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ workspace: WorkspaceRow; readerCount: number }>> {
  const a = readArgs(args, { workspaceId: "string", suspended: "boolean", reason: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, suspended } = a.value;
  const reason = (a.value.reason ?? "").slice(0, 300);

  // What the restamp needs (the members and the deactivated people) is read with the permission round, so the status
  // write and the restamp share one round afterwards.
  const open = await openOp(ctx, deps, {
    scope: "platform",
    workspaceId,
    platformPermission: "platform.workspaces.manage",
    extra: {
      members: () => activeMemberships(deps, workspaceId, MEMBERSHIP_FIELDS),
      deactivated: () => deactivatedAccounts(deps),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const workspace = caller.workspace!;
  if (workspace.Status === "archived") return fail("invalid_input", "tenancy.invalidArgs", { keys: ["workspaceId"] });

  const status = suspended ? "suspended" : "active";
  const [, { readerCount }] = await Promise.all([
    deps.gateway.update(SCHEMA.workspace, workspace.ItemId, { Status: status, UpdatedByUserId: caller.userId }),
    restampWorkspace(deps, workspaceId, {
      workspaceStatus: status,
      memberships: caller.extra.members as MembershipRow[],
      deactivatedUserIds: (caller.extra.deactivated as AccountRow[]).map((a) => a.UserId),
    }),
  ]);
  await audit(deps, ctx, caller, {
    workspaceId,
    targetType: "workspace",
    targetId: workspaceId,
    details: { suspended, reason, before: { status: workspace.Status }, after: { status } },
    viaPlatform: true,
  });
  return ok({ workspace: { ...workspace, Status: status }, readerCount });
}
