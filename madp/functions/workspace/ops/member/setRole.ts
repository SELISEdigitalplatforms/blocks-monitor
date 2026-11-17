// member.setRole {workspaceId, membershipId, roleKey} (members.manage).
import { checkAssignRole, workspacePermissionsFor } from "../../../../src/domain/roles";
import { checkLastOwner, checkOutranks, fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, builtInOrCustomRole, fail, failCheck, finishWith, iamFirst, ok, openOp, rbacChanged, readArgs, reducesOwners, takeOwnerGuard } from "../_shared/core";
import { ensureIamOrgRole, linkedWorkspaceOrg, setIamOrgRole } from "../_shared/iamSync";
import type { OpHandler } from "../_shared/ports";
import { INVITATION_FIELDS, SCHEMA, type InvitationRow, type MembershipRow } from "../_shared/records";

export const memberSetRole: OpHandler<{ membership: MembershipRow }> = async (ctx, args, deps) => {
  const parsed = readArgs(args, { workspaceId: "string", membershipId: "string", roleKey: "string" });
  if (!parsed.ok) {
    return ctx.context.isAuthenticated && ctx.context.userId
      ? { ok: false, error: parsed.error }
      : fail("forbidden", "tenancy.signInRequired");
  }
  const a = parsed.value;
  const opened = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId: a.workspaceId,
    permission: "members.manage",
    loadTeam: true,
    extra: {
      invitations: () =>
        deps.gateway.listAll<InvitationRow>(SCHEMA.invitation, {
          filter: { MembershipId: a.membershipId, Status: "pending" },
          fields: INVITATION_FIELDS,
        }),
    },
  });
  if (!opened.ok) return { ok: false, error: opened.error };
  const { caller } = opened;
  const workspace = caller.workspace!;
  const access = caller.access!;

  const target = caller.team.find((m) => m.ItemId === a.membershipId && m.Status !== "removed");
  if (!target) return fail("not_found");
  const role = builtInOrCustomRole(a.roleKey, caller.customRoles);
  if (!role) return fail("invalid_input", "tenancy.unknownRole");

  const assign = fromRoleCheck(checkAssignRole(role, caller.granter));
  if (!assign.ok) return failCheck(assign);
  const outranks = checkOutranks({
    granterPermissions: caller.granter,
    targetPermissions: workspacePermissionsFor({ roleKey: target.RoleKey, customRoles: caller.customRoles }),
    exempt: caller.isSuperAdmin || access.viaPlatform,
  });
  if (!outranks.ok) return failCheck(outranks);
  const last = checkLastOwner({
    target: { membershipId: target.ItemId, roleKey: target.RoleKey, status: target.Status },
    next: { kind: "role", roleKey: role.key },
    activeOwners: caller.team
      .filter((m) => m.Status === "active" && m.RoleKey === "owner")
      .map((m) => ({ membershipId: m.ItemId })),
  });
  if (!last.ok) return failCheck(last);

  if (target.RoleKey === role.key) return ok({ membership: target });

  const invitations = caller.extra.invitations as InvitationRow[];
  const set = { RoleKey: role.key, UpdatedByUserId: caller.userId };
  const entry = {
    workspaceId: workspace.ItemId,
    targetType: "membership",
    targetId: target.ItemId,
    details: { before: target.RoleKey, after: role.key },
    viaPlatform: access.viaPlatform,
  };
  // rbac.source "iam": the person's role in the workspace's IAM organization is set first (an active member only: an
  // invitation gets its IAM role when it is accepted). A failure leaves the Factory rows as they are.
  const toIam = () =>
    target.Status === "active" && target.UserId
      ? iamFirst(deps, async (iam) => {
          const orgId = await linkedWorkspaceOrg(deps, workspace.ItemId);
          if (!orgId) return;
          await ensureIamOrgRole(iam, role, workspace);
          await setIamOrgRole(iam, { userId: target.UserId!, organizationId: orgId, workspaceId: workspace.ItemId, roleKey: role.key, previousKey: target.RoleKey });
        })
      : Promise.resolve(null);
  if (reducesOwners(target, role.key)) {
    // The guard audit row goes first alone: a racing request on the same owner snapshot is refused before any write.
    const refused = await takeOwnerGuard(deps, ctx, caller, entry, workspace.ItemId);
    if (refused) return refused;
    const iamFail = await toIam();
    if (iamFail) return iamFail;
    if (target.UserId) await rbacChanged(deps, [target.UserId]);
    await finishWith(deps, () =>
      Promise.all([
        ...invitations.map((i) => deps.gateway.update(SCHEMA.invitation, i.ItemId, set)),
        deps.gateway.update(SCHEMA.membership, target.ItemId, set),
      ]),
    );
    return ok({ membership: { ...target, ...set } });
  }
  const iamFail = await toIam();
  if (iamFail) return iamFail;
  if (target.UserId) await rbacChanged(deps, [target.UserId]);
  // The state change comes last, so a retry still sees the old role and replays the children.
  await Promise.all([...invitations.map((i) => deps.gateway.update(SCHEMA.invitation, i.ItemId, set)), audit(deps, ctx, caller, entry)]);
  await finishWith(deps, () => deps.gateway.update(SCHEMA.membership, target.ItemId, set));
  return ok({ membership: { ...target, ...set } });
};
