// The super admin gate of every seed op. The router already checked the token, the account and the platform permission;
// a platform role holding the same permission is NOT enough to seed: only the (not impersonated) super admin is.
// A seed must never run twice concurrently.
import type { OpCtx, OpDeps } from "../../../_lib";

/** Null for the super admin acting as themselves; otherwise forbidden / seed.superAdminOnly (deps.fail throws). */
export function requireSuperAdmin(ctx: Pick<OpCtx, "caller">, deps: Pick<OpDeps, "fail">): null {
  if (ctx.caller.isSuperAdmin === true && ctx.caller.impersonated === false) return null;
  return deps.fail("forbidden", "seed.superAdminOnly");
}
