// acl.restamp: recompute the reader list and set it on every workspace-owned schema.
import { audit, ok, openOp, readArgs } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import type { AccountRow } from "../_shared/records";
import { deactivatedAccounts, restampWorkspace } from "../_shared/restamp";

export async function aclRestamp(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ readerCount: number; schemas: string[]; rows: number }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const wsId = a.value.workspaceId;
  // Round 1 reads everything the restamp needs (the workspace, every membership, the deactivated accounts); round 2 writes.
  const op = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId: wsId,
    permission: "workspace.manage",
    loadTeam: true,
    extra: { deactivated: () => deactivatedAccounts(deps) },
  });
  if (!op.ok) return { ok: false, error: op.error };
  const res = await restampWorkspace(deps, wsId, {
    workspaceStatus: op.caller.workspace!.Status,
    memberships: op.caller.team,
    deactivatedUserIds: (op.caller.extra.deactivated as AccountRow[]).map((x) => x.UserId),
  });
  await audit(deps, ctx, op.caller, {
    workspaceId: wsId,
    targetType: "workspace",
    targetId: wsId,
    details: { readerCount: res.readerCount, schemas: res.schemas.length, rows: res.rows },
    viaPlatform: Boolean(op.caller.access?.viaPlatform),
  });
  return ok(res);
}
