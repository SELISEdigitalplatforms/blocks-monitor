// people.invite: create the IAM user with the caller's own token (super admin; Host A only).
import { emailDomainOf } from "../../../../src/domain/emailDomains";
import { audit, fail, finishWith, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { IAM_USER_ROLE, iamRefused } from "./shared";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function peopleInvite(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ userId: string | null; email: string }>> {
  const a = readArgs(args, { email: "string", firstName: "string", lastName: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const email = a.value.email.trim().toLowerCase();
  const firstName = a.value.firstName.trim();
  const lastName = a.value.lastName.trim();

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (!caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  if (!deps.iam) return fail("not_supported", "people.notSupported");

  if (!EMAIL.test(email) || email.length > 254) return fail("invalid_input", "tenancy.invalidEmail");
  if (firstName.length < 1 || firstName.length > 60) return fail("invalid_input", "tenancy.invalidName", { field: "firstName" });
  if (lastName.length < 1 || lastName.length > 60) return fail("invalid_input", "tenancy.invalidName", { field: "lastName" });

  const made = await deps.iam.createUser({ email, firstName, lastName, roles: [IAM_USER_ROLE] });
  if (!made.ok) return iamRefused(made);
  await finishWith(deps, () =>
    audit(deps, ctx, caller, { targetType: "iam-user", targetId: made.userId ?? "unknown", details: { roles: [IAM_USER_ROLE], emailDomain: emailDomainOf(email) } }),
  );
  return ok({ userId: made.userId, email });
}
