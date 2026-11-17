// people.setActive: deactivate or reactivate an IAM user with the caller's own token (super admin; Host A only).
import { IAM_SUPER_ADMIN_ROLE } from "../../../../src/domain/tenancy";
import { audit, fail, finishWith, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { iamRefused, isSelf, scanUsers } from "./shared";

export async function peopleSetActive(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ userId: string; active: boolean }>> {
  const a = readArgs(args, { userId: "string", active: "boolean" });
  if (!a.ok) return { ok: false, error: a.error };
  const userId = a.value.userId.trim();
  const { active } = a.value;

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  const iam = deps.iam;
  if (!iam) return fail("not_supported", "people.notSupported");

  if (!active) {
    if (isSelf(caller.userId, userId)) return fail("forbidden", "tenancy.selfDeactivate");
    const scan = await scanUsers(iam, userId);
    if (!scan) return fail("conflict", "people.countFailed");
    if (!scan.target) return fail("not_found", "people.userNotFound");
    if (scan.target.active && scan.target.roles.includes(IAM_SUPER_ADMIN_ROLE) && scan.activeSuperAdmins <= 1) {
      return fail("conflict", "people.lastSuperAdmin");
    }
  }
  const done = active ? await iam.activate(userId) : await iam.deactivate(userId);
  if (!done.ok) return iamRefused(done);
  await finishWith(deps, () => audit(deps, ctx, caller, { targetType: "iam-user", targetId: userId, details: { active } }));
  return ok({ userId, active });
}
