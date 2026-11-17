// people.countSuperAdmins: the active super admins across all IAM pages, so the web can guard the last one. A view, not audited.
import { fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps, OpError } from "../../../workspace/ops/_shared/ports";
import { IMPERSONATION_MESSAGE_KEY } from "../../../../src/domain/security";
import { scanUsers } from "./shared";

export async function peopleCountSuperAdmins(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ count: number }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  if (ctx.context.impersonated) return fail("forbidden", IMPERSONATION_MESSAGE_KEY);

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  if (!open.caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  if (!deps.iam) return fail("not_supported", "people.notSupported");

  const scan = await scanUsers(deps.iam, "");
  // the router passes any FnErrorCode through; "unavailable" (503) is not in the tenancy code union
  if (!scan) return fail("unavailable" as OpError["code"], "people.countFailed");
  return ok({ count: scan.activeSuperAdmins });
}
