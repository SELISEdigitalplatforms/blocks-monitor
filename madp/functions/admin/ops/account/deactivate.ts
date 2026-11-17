// account.deactivate: cut a person's data access at once (platform.users.manage).
// Membership "suspended" means only this; every affected workspace is restamped.
import { audit, finishWith, fail, findOne, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { deactivatedAccounts, restampWorkspace } from "../../../workspace/ops/_shared/restamp";
import {
  ACCOUNT_FIELDS,
  ACCOUNT_SUPER_ADMIN_FIELD,
  MEMBERSHIP_FIELDS,
  SCHEMA,
  WORKSPACE_FIELDS,
  type AccountRow,
  type MembershipRow,
  type WorkspaceRow,
} from "../../../workspace/ops/_shared/records";

export async function accountDeactivate(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<
  OpAnswer<{ account: AccountRow; suspendedMemberships: number; ownerlessWorkspaces: { workspaceId: string; name: string }[] }>
> {
  const a = readArgs(args, { userId: "string", reason: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const userId = a.value.userId.trim();
  const reason = (a.value.reason ?? "").slice(0, 300);
  const { gateway } = deps;

  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.manage",
    extra: {
      target: () =>
        findOne<AccountRow>(
          gateway,
          SCHEMA.account,
          { UserId: userId },
          ACCOUNT_SUPER_ADMIN_FIELD ? [...ACCOUNT_FIELDS, ACCOUNT_SUPER_ADMIN_FIELD] : ACCOUNT_FIELDS,
        ),
      // The person's memberships, then (chained, still inside the permission round) everything the restamp and the
      // ownerless warning need about their workspaces.
      world: async () => {
        const memberships = await gateway.listAll<MembershipRow>(SCHEMA.membership, {
          filter: { UserId: userId, Status: "active" },
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
  const { memberships, workspaces } = world;

  if (userId === caller.userId) return fail("forbidden", "tenancy.selfDeactivate");
  if (!target) return fail("not_found", "tenancy.targetNoAccount");
  // Fail-safe: while the account mirror has no super-admin flag, only a super admin may deactivate anyone.
  const targetIsSuper = ACCOUNT_SUPER_ADMIN_FIELD ? Boolean(target[ACCOUNT_SUPER_ADMIN_FIELD]) : null;
  if ((targetIsSuper === null || targetIsSuper) && !caller.isSuperAdmin) return fail("forbidden", "tenancy.superAdminOnly");
  if (target.Status === "deactivated") {
    return ok({ account: target, suspendedMemberships: 0, ownerlessWorkspaces: [] });
  }

  const workspaceIds = [...new Set(memberships.map((m) => m.WorkspaceId))];
  const ownerless = workspaceIds.filter((id) => !world.members.some((o) => o.WorkspaceId === id && o.RoleKey === "owner" && o.UserId !== userId));

  const at = deps.clock.now();
  // Memberships, account and reader lists are the op's last writes, handed to the router's bookkeeping round;
  // the restamp is handed what it
  // would read (the other active members, the deactivated people including this one).
  const deactivatedUserIds = [...new Set([...world.deactivated.map((x) => x.UserId), userId])];
  await finishWith(deps, () =>
    Promise.all([
      ...memberships.map((m) =>
        gateway.update(SCHEMA.membership, m.ItemId, { Status: "suspended", SuspendedAt: at, UpdatedByUserId: caller.userId }),
      ),
      gateway.update(SCHEMA.account, target.ItemId, {
        Status: "deactivated",
        DeactivatedAt: at,
        DeactivatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      }),
      ...workspaceIds.map((id) =>
        restampWorkspace(deps, id, {
          workspaceStatus: workspaces.find((w) => w.ItemId === id)?.Status ?? "archived",
          memberships: world.members.filter((m) => m.WorkspaceId === id && m.UserId !== userId),
          deactivatedUserIds,
        }),
      ),
    ]),
  );

  const ownerlessWorkspaces = ownerless.map((id) => ({
    workspaceId: id,
    name: workspaces.find((w) => w.ItemId === id)?.Name ?? "",
  }));
  await audit(deps, ctx, caller, {
    targetType: "account",
    targetId: userId,
    details: { before: { status: target.Status }, after: { status: "deactivated", reason, workspaces: workspaceIds, ownerless } },
  });
  return ok({
    account: { ...target, Status: "deactivated", DeactivatedAt: at, DeactivatedByUserId: caller.userId },
    suspendedMemberships: memberships.length,
    ownerlessWorkspaces,
  });
}
