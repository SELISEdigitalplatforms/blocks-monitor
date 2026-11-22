// accessRequest.list: people invited without an account yet, across workspaces (platform.users.manage). Audited.
import { audit, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import {
  ACCOUNT_FIELDS,
  INVITATION_FIELDS,
  SCHEMA,
  WORKSPACE_FIELDS,
  type AccountRow,
  type InvitationRow,
  type WorkspaceRow,
} from "../../../workspace/ops/_shared/records";

const PAGE_SIZE = 50;

export interface AccessRequestItem {
  invitationId: string;
  membershipId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  invitedByUserId: string;
  invitedByName: string;
  invitedAt: string;
}

export async function accessRequestList(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ items: AccessRequestItem[]; totalCount: number; page: number; pageSize: number }>> {
  const a = readArgs(args, { page: "number?" });
  if (!a.ok) return { ok: false, error: a.error };
  const page = Math.max(1, Math.floor(a.value.page ?? 1));

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;

  const res = await deps.gateway.list<InvitationRow>(SCHEMA.invitation, {
    filter: { Kind: "pending-account", Status: "pending" },
    fields: INVITATION_FIELDS,
    sort: { field: "InvitedAt", dir: "desc" },
    page,
    pageSize: PAGE_SIZE,
  });
  const workspaceIds = [...new Set(res.items.map((i) => i.WorkspaceId))];
  const inviterIds = [...new Set(res.items.map((i) => i.InvitedByUserId).filter(Boolean))];
  const [workspaces, inviters] = await Promise.all([
    workspaceIds.length
      ? deps.gateway.listAll<WorkspaceRow>(SCHEMA.workspace, { filter: { ItemId: { in: workspaceIds } }, fields: WORKSPACE_FIELDS })
      : Promise.resolve([] as WorkspaceRow[]),
    inviterIds.length
      ? deps.gateway.listAll<AccountRow>(SCHEMA.account, { filter: { UserId: { in: inviterIds } }, fields: ACCOUNT_FIELDS })
      : Promise.resolve([] as AccountRow[]),
  ]);
  const items = res.items.map((i) => {
    const inviter = inviters.find((x) => x.UserId === i.InvitedByUserId);
    return {
      invitationId: i.ItemId,
      membershipId: i.MembershipId,
      email: i.Email,
      workspaceId: i.WorkspaceId,
      workspaceName: workspaces.find((w) => w.ItemId === i.WorkspaceId)?.Name ?? "",
      invitedByUserId: i.InvitedByUserId,
      invitedByName: inviter ? inviter.DisplayName || inviter.Email : "",
      invitedAt: i.InvitedAt,
    };
  });
  await audit(deps, ctx, caller, { action: "accessRequest.list", targetType: "invitation", targetId: "pending-account", details: { page } });
  return ok({ items, totalCount: res.totalCount, page, pageSize: PAGE_SIZE });
}
