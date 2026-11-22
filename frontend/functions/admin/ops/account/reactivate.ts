// account.reactivate: give a person their data access back (platform.users.manage).
import { audit, finishWith, fail, findOne, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { deactivatedAccounts, restampWorkspace } from "../../../workspace/ops/_shared/restamp";
import { ACCOUNT_FIELDS, MEMBERSHIP_FIELDS, SCHEMA, WORKSPACE_FIELDS, type AccountRow, type MembershipRow, type WorkspaceRow } from "../../../workspace/ops/_shared/records";

export async function accountReactivate(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ account: AccountRow; restoredMemberships: number }>> {
  const a = readArgs(args, { userId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const userId = a.value.userId.trim();
  const { gateway } = deps;

  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.manage",
    extra: {
      target: () => findOne<AccountRow>(gateway, SCHEMA.account, { UserId: userId }, ACCOUNT_FIELDS),
      // The suspended memberships, then (chained, still inside the permission round) what the restamp needs about their workspaces.
      world: async () => {
        const memberships = await gateway.listAll<MembershipRow>(SCHEMA.membership, {
          filter: { UserId: userId, Status: "suspended" },
          fields: MEMBERSHIP_FIELDS,
        });
        const ids = [...new Set(memberships.map((m) => m.WorkspaceId))];
        if (ids.length === 0) return { memberships, members: [] as MembershipRow[], workspaces: [] as WorkspaceRow[], deactivated: [] as AccountRow[] };
        const [members, workspaces, deactivated] = await Promise.all([
          gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { WorkspaceId: { in: ids }, Status: "active" }, fields: MEMBERSHIP_FIELDS }),
          gateway.listAll<WorkspaceRow>(SCHEMA.workspace, { filter: { ItemId: { in: ids } }, fields: WORKSPACE_FIELDS }),
          deactivatedAccounts(deps),
        ]);
        return { memberships, members, workspaces, deactivated };
      },
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const target = caller.extra.target as AccountRow | null;
  const world = caller.extra.world as { memberships: MembershipRow[]; members: MembershipRow[]; workspaces: WorkspaceRow[]; deactivated: AccountRow[] };
  const { memberships } = world;
  if (!target) return fail("not_found", "tenancy.targetNoAccount");

  // Memberships, account and reader lists are the op's last writes, handed to the router's bookkeeping round;
  // the restamp is handed what it
  // would read (the active members including the restored ones, the deactivated people without this one).
  const workspaceIds = [...new Set(memberships.map((m) => m.WorkspaceId))];
  const deactivatedUserIds = world.deactivated.map((x) => x.UserId).filter((id) => id !== userId);
  await finishWith(deps, () =>
    Promise.all([
      ...memberships.map((m) =>
        gateway.update(SCHEMA.membership, m.ItemId, { Status: "active", SuspendedAt: "", UpdatedByUserId: caller.userId }),
      ),
      gateway.update(SCHEMA.account, target.ItemId, {
        Status: "active",
        DeactivatedAt: "",
        DeactivatedByUserId: "",
        UpdatedByUserId: caller.userId,
      }),
      ...workspaceIds.map((id) =>
        restampWorkspace(deps, id, {
          workspaceStatus: world.workspaces.find((w) => w.ItemId === id)?.Status ?? "archived",
          memberships: [
            ...world.members.filter((m) => m.WorkspaceId === id && m.UserId !== userId),
            ...memberships.filter((m) => m.WorkspaceId === id).map((m) => ({ ...m, Status: "active" })),
          ],
          deactivatedUserIds,
        }),
      ),
    ]),
  );
  await audit(deps, ctx, caller, {
    targetType: "account",
    targetId: userId,
    details: { before: { status: target.Status }, after: { status: "active", workspaces: workspaceIds } },
  });
  return ok({
    account: { ...target, Status: "active", DeactivatedAt: "", DeactivatedByUserId: "" },
    restoredMemberships: memberships.length,
  });
}
