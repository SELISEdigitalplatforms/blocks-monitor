// me.passwordChanged: clears the caller's own MustChangePassword flag after they set their own password.
// The op never takes a userId and cannot prove the password changed; the server host lets it through for a gated
// person only after IAM accepted the change.
// Round plan: round 1: the caller's own Account row; round 2 (only when flagged): the flag write, with the audit row.
import { audit, finishWith, findOne, ok, readArgs, type Caller } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import { SCHEMA, type AccountRow } from "../_shared/records";

export async function mePasswordChanged(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ cleared: boolean }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const c = ctx.context;
  if (!c.isAuthenticated || !c.userId) {
    return { ok: false, error: { code: "forbidden", messageKey: "tenancy.signInRequired" } };
  }
  const userId = c.userId;
  if (deps.identitySource === "iam") return ok({ cleared: false });
  const row = await findOne<AccountRow>(deps.gateway, SCHEMA.account, { UserId: userId }, [
    "ItemId", "UserId", "Email", "DisplayName", "Status", "MustChangePassword",
  ]);
  if (!row || row.MustChangePassword !== true) return ok({ cleared: false });

  const email = (c.email ?? "").trim().toLowerCase();
  const caller: Caller = {
    userId,
    email,
    isSuperAdmin: false,
    impersonated: Boolean(c.impersonated),
    account: row,
    actorName: row.DisplayName || email,
    platform: { permissions: [], roleKeys: [] },
    workspace: null,
    membership: null,
    team: [],
    customRoles: [],
    access: null,
    granter: [],
    extra: {},
  };
  await finishWith(deps, () =>
    deps.gateway.update(SCHEMA.account, row.ItemId, { MustChangePassword: false, UpdatedByUserId: userId }),
  );
  await audit(deps, ctx, caller, { targetType: "account", targetId: row.ItemId, details: { mustChangePassword: false } });
  return ok({ cleared: true });
}
