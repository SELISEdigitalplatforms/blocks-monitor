// iam.source.set: where roles and permissions are read from, PlatformSetting rbac.source "factory" | "iam". Platform
// admins only. Switching to "iam" needs IAM to answer; switching back is always allowed (the Factory rows are kept in
// step by every change made through the Factory). Audited with before and after.
// No lockout: switching to "iam" is refused unless the caller stays a platform admin there (today's mf-super-admin on
// the token, or mf-platform-super-admin / mf-platform-admin in IAM). The switch drops the cached roles at once.
import { IAM_PLATFORM_ADMIN, IAM_PLATFORM_SUPER_ADMIN } from "../../../_lib/iamAdmin";
import { SAFETY_SUPER_ADMIN_ROLE } from "../../../_lib/rbacSource";
import { audit, fail, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import type { PlatformSettingRow } from "../../../workspace/ops/_shared/records";
import { RBAC_SOURCE_KEY, directoryOf, iamFail, isPlatformAdmin, isRbacSource, noIam, settingsRead, sourceOf, writeSetting, type RbacSource } from "./shared";

export async function iamSourceSet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ source: RbacSource }>> {
  const a = readArgs(args, { source: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const next = a.value.source;
  if (!isRbacSource(next)) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["source"] });
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.roles.manage", extra: { settings: settingsRead(deps) } });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!isPlatformAdmin(caller)) return fail("forbidden", "tenancy.superAdminOnly");
  const settings = caller.extra.settings as PlatformSettingRow[];
  const before = sourceOf(settings);
  if (before === next) return ok({ source: next });
  if (next === "iam") {
    const iam = directoryOf(deps);
    if (!iam) return noIam();
    try {
      await iam.listRoles();
      if (!(ctx.context.roles ?? []).includes(SAFETY_SUPER_ADMIN_ROLE)) {
        const held = (await iam.userAccess(caller.userId)).platform.roles;
        if (!held.includes(IAM_PLATFORM_SUPER_ADMIN) && !held.includes(IAM_PLATFORM_ADMIN)) return fail("conflict", "tenancy.wouldLockOut");
      }
    } catch (e) { return iamFail(e); }
  }
  await writeSetting(deps, caller, settings, RBAC_SOURCE_KEY, next, "Where roles and permissions are read from: factory or iam (Blocks OS IAM).");
  await rbacChanged(deps);
  await audit(deps, ctx, caller, { targetType: "platform-setting", targetId: RBAC_SOURCE_KEY, details: { before, after: next } });
  return ok({ source: next });
}
