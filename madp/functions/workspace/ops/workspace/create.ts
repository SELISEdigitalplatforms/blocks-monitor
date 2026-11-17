// workspace.create {name}: any authenticated, active account makes a workspace and becomes its owner.
import { builtInWorkspaceRoles } from "../../../../src/domain/roles";
import { checkWorkspaceName } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, finishWith, iamFirst, ok, openOp, rbacChanged, readArgs } from "../_shared/core";
import { ensureIamOrgRole, IAM_ORG_OWNER } from "../_shared/iamSync";
import type { OpHandler } from "../_shared/ports";
import { SCHEMA, type MembershipRow, type WorkspaceRow } from "../_shared/records";
import { grantSignup } from "../../../billing/ops/shared";

export interface WorkspaceCreateResult {
  workspace: WorkspaceRow;
  membership: MembershipRow;
}

export const workspaceCreate: OpHandler<WorkspaceCreateResult> = async (ctx, args, deps) => {
  const parsed = readArgs(args, { name: "string" });
  if (!parsed.ok) {
    return ctx.context.isAuthenticated && ctx.context.userId
      ? { ok: false, error: parsed.error }
      : fail("forbidden", "tenancy.signInRequired");
  }
  const opened = await openOp(ctx, deps, { scope: "self", allowMissingAccount: true });
  if (!opened.ok) return { ok: false, error: opened.error };
  const { caller } = opened;

  const name = checkWorkspaceName(parsed.value.name);
  if (!name.ok) return failCheck(name);
  if (!caller.email) return fail("invalid_input", "tenancy.invalidEmail");

  const { gateway, clock } = deps;
  const now = clock.now();
  const readers = [caller.userId];

  // One round trip for both inserts: each carries the request's placeholder id, and the second round trip (the
  // router's, together with the audit and Operation writes) points both rows at the new workspace id. A retry finds
  // both rows by their keys and repeats that second step.
  const placeholder = `pending:${ctx.requestId}`;
  const [created, member] = await Promise.all([
    gateway.insertOnce<WorkspaceRow>(
      SCHEMA.workspace,
      {
        WorkspaceId: placeholder,
        ReaderIds: readers,
        Name: name.value,
        Status: "active",
        CreatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      },
      `workspace:${ctx.requestId}`,
    ),
    gateway.insertOnce<MembershipRow>(
      SCHEMA.membership,
      {
        WorkspaceId: placeholder,
        ReaderIds: readers,
        UserId: caller.userId,
        Email: caller.email,
        DisplayName: caller.actorName,
        RoleKey: "owner",
        Status: "active",
        InvitedByUserId: caller.userId,
        InvitedAt: now,
        JoinedAt: now,
        CreatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      },
      `membership:${ctx.requestId}:${caller.email}`,
    ),
  ]);
  const wsId = created.item.ItemId;

  // rbac.source "iam": the workspace's IAM organization and the owner's role there come first. Until the step below
  // points both rows at the new id they are not a usable workspace, so a failure leaves no half state (the retry,
  // with the same requestId, finds the rows and the marked organization and finishes).
  let iamOrgId: string | null = null;
  const iamFail = await iamFirst(deps, async (iam) => {
    const owner = builtInWorkspaceRoles().find((r) => r.key === "owner")!;
    await ensureIamOrgRole(iam, owner, { ItemId: wsId, Name: name.value });
    const orgId = await iam.ensureOrganization({ workspaceId: wsId, name: name.value });
    await iam.grant(caller.userId, { roles: [IAM_ORG_OWNER], organizationId: orgId });
    iamOrgId = orgId;
  });
  if (iamFail) return iamFail;
  if (iamOrgId) {
    deps.rbac?.rememberOrg(wsId, iamOrgId);
    await rbacChanged(deps, [caller.userId]);
  }
  const link: Record<string, string> = iamOrgId ? { IamOrganizationId: iamOrgId } : {};

  await Promise.all([
    audit(deps, ctx, caller, { workspaceId: wsId, targetType: "workspace", targetId: wsId, details: { name: name.value } }),
    finishWith(deps, () =>
      Promise.all([
        gateway.update(SCHEMA.workspace, wsId, { WorkspaceId: wsId, ...link, UpdatedByUserId: caller.userId }),
        gateway.update(SCHEMA.membership, member.item.ItemId, { WorkspaceId: wsId, UpdatedByUserId: caller.userId }),
        // A new organization starts on Free; the sign-up credit is granted once per person (billing/ops/shared.ts).
        grantSignup(deps, { workspaceId: wsId, userId: caller.userId }),
      ]),
    ),
  ]);

  return ok({ workspace: { ...created.item, WorkspaceId: wsId }, membership: { ...member.item, WorkspaceId: wsId } });
};
