// me.access: the caller's own platform access exactly as every op resolves it (openOp, scope "self"): the super admin flag
// and the platform permissions with the roles they come from (PlatformRoleAssignment and PlatformRole rows, or IAM with
// rbac.source "iam"). A view: nothing is written and no invitation is accepted (unlike me.bootstrap), so the shell can
// ask it while a session runs and a platform role granted or removed shows without signing in again.
// Round plan: one round (the Account row, the caller's active assignments and the platform roles, IAM alongside).
import { ok, openOp, readArgs } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";

export interface MeAccessResult {
  isSuperAdmin: boolean;
  platformPermissions: string[];
  platformRoleKeys: string[];
}

export async function meAccess(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<MeAccessResult>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, { scope: "self" });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  return ok({
    isSuperAdmin: caller.isSuperAdmin,
    platformPermissions: [...caller.platform.permissions],
    platformRoleKeys: [...caller.platform.roleKeys],
  });
}
