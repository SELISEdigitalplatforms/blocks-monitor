// member.remove {workspaceId, membershipId}: remove, cancel an invitation, or leave (self).
import { emailDomainOf } from "../../../../src/domain/emailDomains";
import { workspacePermissionsFor } from "../../../../src/domain/roles";
import { checkLastOwner, checkOutranks } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs, reducesOwners, takeOwnerGuard } from "../_shared/core";
import { linkedWorkspaceOrg, workspaceRoleSlugs } from "../_shared/iamSync";
import type { OpHandler } from "../_shared/ports";
import { deactivatedAccounts, restampWorkspace } from "../_shared/restamp";
import { INVITATION_FIELDS, SCHEMA, type AccountRow, type InvitationRow, type MembershipRow } from "../_shared/records";

export const memberRemove: OpHandler<{ membership: MembershipRow; readerCount: number }> = async (ctx, args, deps) => {
  const parsed = readArgs(args, { workspaceId: "string", membershipId: "string" });
  if (!parsed.ok) {
    return ctx.context.isAuthenticated && ctx.context.userId
      ? { ok: false, error: parsed.error }
      : fail("forbidden", "tenancy.signInRequired");
  }
  const a = parsed.value;
  const opened = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId: a.workspaceId,
    permission: null,
    loadTeam: true,
    extra: {
      invitations: () =>
        deps.gateway.listAll<InvitationRow>(SCHEMA.invitation, {
          filter: { MembershipId: a.membershipId, Status: "pending" },
          fields: INVITATION_FIELDS,
        }),
      // Read in round 1 so the restamp needs no read of its own.
      deactivated: () => deactivatedAccounts(deps),
    },
  });
  if (!opened.ok) return { ok: false, error: opened.error };
  const { caller } = opened;
  const workspace = caller.workspace!;
  const access = caller.access!;

  const found = caller.team.find((m) => m.ItemId === a.membershipId);
  if (!found) return fail("not_found");
  const deactivatedUserIds = (caller.extra.deactivated as AccountRow[]).map((x) => x.UserId);
  const known = (team: readonly MembershipRow[]) => ({ workspaceStatus: workspace.Status, memberships: team, deactivatedUserIds });
  const invitations = caller.extra.invitations as InvitationRow[];
  const cancelInvitations = (now: string) =>
    invitations.map((i) =>
      deps.gateway.update(SCHEMA.invitation, i.ItemId, {
        Status: "cancelled",
        ResolvedByUserId: caller.userId,
        ResolvedAt: now,
        UpdatedByUserId: caller.userId,
      }),
    );
  // Removed by this same caller: a retry after a partial failure only has the invitations and the restamp left to do.
  if (found.Status === "removed") {
    if (found.UpdatedByUserId !== caller.userId) return fail("not_found");
    const [{ readerCount }] = await Promise.all([restampWorkspace(deps, workspace.ItemId, known(caller.team)), ...cancelInvitations(deps.clock.now())]);
    return ok({ membership: found, readerCount });
  }
  const target = found;
  const self = Boolean(target.UserId) && target.UserId === caller.userId;

  if (!self) {
    if (!access.permissions.includes("members.manage")) {
      return fail("forbidden", "tenancy.notHeld", { permissions: ["members.manage"] });
    }
    const outranks = checkOutranks({
      granterPermissions: caller.granter,
      targetPermissions: workspacePermissionsFor({ roleKey: target.RoleKey, customRoles: caller.customRoles }),
      exempt: caller.isSuperAdmin || access.viaPlatform,
    });
    if (!outranks.ok) return failCheck(outranks);
  }
  const last = checkLastOwner({
    target: { membershipId: target.ItemId, roleKey: target.RoleKey, status: target.Status },
    next: { kind: "remove" },
    activeOwners: caller.team
      .filter((m) => m.Status === "active" && m.RoleKey === "owner")
      .map((m) => ({ membershipId: m.ItemId })),
  });
  if (!last.ok) return failCheck(last);

  const now = deps.clock.now();
  const set = { Status: "removed" as const, RemovedAt: now, UpdatedByUserId: caller.userId };
  // One write round: the invitations, the state change and (for an active member, the only kind that was a reader)
  // the restamp, which already knows the reader list without the target.
  const nextTeam = caller.team.map((m) => (m.ItemId === target.ItemId ? { ...m, ...set } : m));
  // The audit row goes first, so a fault after the first write never loses it (the state change is what a retry redoes).
  const entry = {
    workspaceId: workspace.ItemId,
    targetType: "membership",
    targetId: target.ItemId,
    details: { emailDomain: emailDomainOf(target.Email), previousStatus: target.Status, self },
    viaPlatform: access.viaPlatform && !self,
  };
  // An owner leaving the owner set takes the guard row first: a racing request on the same snapshot is refused before any write.
  const guarded = reducesOwners(target, null);
  if (guarded) {
    const refused = await takeOwnerGuard(deps, ctx, caller, entry, workspace.ItemId);
    if (refused) return refused;
  }
  // rbac.source "iam": the person's access to the workspace's IAM organization goes first (an active member only).
  if (target.Status === "active" && target.UserId) {
    const iamFail = await iamFirst(deps, async (iam) => {
      const orgId = await linkedWorkspaceOrg(deps, workspace.ItemId);
      if (!orgId) return;
      await iam.revoke(target.UserId!, { roles: workspaceRoleSlugs(workspace.ItemId, target.RoleKey), organizationId: orgId });
    });
    if (iamFail) return iamFail;
    await rbacChanged(deps, [target.UserId]);
  }
  const [, readerCount] = await Promise.all([
    guarded ? Promise.resolve() : audit(deps, ctx, caller, entry),
    target.Status === "active"
      ? restampWorkspace(deps, workspace.ItemId, known(nextTeam)).then((r) => r.readerCount)
      : Promise.resolve((workspace.ReaderIds ?? []).length),
    deps.gateway.update(SCHEMA.membership, target.ItemId, set),
    ...cancelInvitations(now),
  ]).then(([a, r]) => [a, r] as const);
  return ok({ membership: { ...target, ...set }, readerCount });
};
