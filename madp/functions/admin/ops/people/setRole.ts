// people.setRole: grant or revoke an IAM role with the caller's own token (super admin; Host A only).
import { IAM_SUPER_ADMIN_ROLE } from "../../../../src/domain/tenancy";
import { audit, fail, finishWith, ok, openOp, readArgs, superAdminGuardKey, takeGuard } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA } from "../../../workspace/ops/_shared/records";
import { IAM_PLATFORM_USERS_ROLE, IAM_USER_ROLE, iamRefused, isSelf, scanUsers, unique } from "./shared";

const ROLES: readonly string[] = [IAM_SUPER_ADMIN_ROLE, IAM_PLATFORM_USERS_ROLE];

export async function peopleSetRole(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ userId: string; roles: string[] }>> {
  const a = readArgs(args, { userId: "string", role: "string", grant: "boolean" });
  if (!a.ok) return { ok: false, error: a.error };
  const userId = a.value.userId.trim();
  const { role, grant } = a.value;
  if (!ROLES.includes(role)) return fail("invalid_input", "tenancy.invalidArgs");

  // The newest people.setRole AuditEvent is the guard epoch; it rides in openOp's round.
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.users.manage",
    extra: {
      epoch: async () =>
        (
          await deps.gateway.list<{ ItemId: string }>(SCHEMA.auditEvent, {
            filter: { Action: "people.setRole" },
            fields: ["ItemId", "At"],
            sort: { field: "At", dir: "desc" },
            page: 1,
            pageSize: 1,
          })
        ).items[0]?.ItemId ?? "",
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  const iam = deps.iam;
  if (!iam) return fail("not_supported", "people.notSupported");

  if (!grant && role === IAM_SUPER_ADMIN_ROLE && isSelf(caller.userId, userId)) return fail("forbidden", "people.selfDemote");
  const scan = await scanUsers(iam, userId);
  if (!scan) return fail("conflict", "people.countFailed");
  if (!scan.target) return fail("not_found", "people.userNotFound");
  if (!grant && role === IAM_SUPER_ADMIN_ROLE && scan.target.active && scan.target.roles.includes(role) && scan.activeSuperAdmins <= 1) {
    return fail("conflict", "people.lastSuperAdmin");
  }
  const roles = grant
    ? unique([...scan.target.roles, IAM_USER_ROLE, role])
    : unique([...scan.target.roles.filter((r) => r !== role), IAM_USER_ROLE]);
  const demotes = !grant && role === IAM_SUPER_ADMIN_ROLE && scan.target.active && scan.target.roles.includes(role);
  if (demotes) {
    // Two demotions at once read the same super admins and epoch, so they share one guard key: the second is refused.
    const guardEntry = { targetType: "iam-user", targetId: userId, details: { role, grant, guard: "lastSuperAdmin" } };
    const epoch = String(caller.extra.epoch ?? "");
    const refused = await takeGuard(deps, ctx, caller, guardEntry, superAdminGuardKey(scan.superAdminIds, epoch));
    if (refused) return fail("conflict", "people.lastSuperAdmin");
  }
  const done = await iam.updateAccess(userId, roles);
  if (!done.ok) return iamRefused(done);
  if (demotes) {
    // Fallback when two requests passed the guard (different epochs): never leave zero super admins.
    const after = await scanUsers(iam, userId);
    if (after && after.activeSuperAdmins === 0) {
      const back = await iam.updateAccess(userId, scan.target.roles);
      if (!back.ok) return iamRefused(back);
      return fail("conflict", "people.lastSuperAdmin");
    }
    return ok({ userId, roles }); // the guard row is this op's audit
  }
  await finishWith(deps, () => audit(deps, ctx, caller, { targetType: "iam-user", targetId: userId, details: { role, grant } }));
  return ok({ userId, roles });
}
