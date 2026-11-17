// people.resendActivation: send the activation mail again with the caller's own token (super admin; Host A only).
import { audit, fail, finishWith, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { iamRefused } from "./shared";

export async function peopleResendActivation(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ userId: string }>> {
  const a = readArgs(args, { userId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const userId = a.value.userId.trim();

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  if (!deps.iam) return fail("not_supported", "people.notSupported");

  const done = await deps.iam.resendActivation(userId);
  if (!done.ok) return iamRefused(done);
  await finishWith(deps, () => audit(deps, ctx, caller, { targetType: "iam-user", targetId: userId, details: { resent: true } }));
  return ok({ userId });
}
