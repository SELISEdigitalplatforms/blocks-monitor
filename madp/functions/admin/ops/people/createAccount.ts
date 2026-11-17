// people.createAccount: create the IAM user WITH a server-generated temporary password (super admin; Host A only).
// The password is returned once in the answer; it is never logged, audited, stored or recorded.
// The account is handed over ACTIVE: Blocks IAM creates a user inactive until activated, so it is activated here, in
// the same flow. On the local host the Account row's MustChangePassword makes the first sign-in change the password;
// the Blocks host has no Account mirror (identity is IAM only), so there the answer says the change is not enforced.
import { emailDomainOf } from "../../../../src/domain/emailDomains";
import { displayNameOf } from "../../../../src/domain/tenancy";
import { audit, fail, finishWith, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, type AccountRow } from "../../../workspace/ops/_shared/records";
import { IAM_USER_ROLE, iamRefused } from "./shared";
import { generateTemporaryPassword } from "./temporaryPassword";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function peopleCreateAccount(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ userId: string | null; email: string; temporaryPassword: string; active: boolean; mustChangePassword: boolean }>> {
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

  const temporaryPassword = generateTemporaryPassword();
  const made = await deps.iam.createUser({ email, firstName, lastName, roles: [IAM_USER_ROLE], password: temporaryPassword });
  if (!made.ok) {
    const errors: Record<string, string> = {};
    for (const [k, v] of Object.entries(made.errors)) errors[k] = v.split(temporaryPassword).join("[redacted]");
    const refused = { ...made, errors };
    if (Object.values(errors).some((t) => /exist|duplicate|already/i.test(t))) {
      const base = iamRefused(refused);
      return base.ok ? base : { ok: false, error: { ...base.error, messageKey: "people.accountExists" } };
    }
    return iamRefused(refused);
  }

  // The new user as IAM lists it: its id (when create did not return one) and whether it is active yet.
  const found = await deps.iam.listUsers({ pageNo: 1, pageSize: 5, search: email });
  const listed = found.ok ? (found.users.find((u) => (made.userId ? u.userId === made.userId : u.email.toLowerCase() === email)) ?? null) : null;
  const userId = made.userId ?? listed?.userId ?? null;
  let active = listed?.active === true;
  if (userId && !active) {
    const on = await deps.iam.activate(userId, "Account created by a super admin with a temporary password");
    if (on.ok) active = true;
    else {
      // A refused activation of a user that is already active (the list read above failed) is still an active account.
      const again = await deps.iam.listUsers({ pageNo: 1, pageSize: 5, search: email });
      active = again.ok && again.users.some((u) => u.userId === userId && u.active);
    }
  }

  const cloudIam = deps.identitySource === "iam";
  let flagSaved = cloudIam;
  if (userId && !cloudIam) {
    try {
      const now = deps.clock.now();
      const { item, created } = await deps.gateway.insertOnce<AccountRow>(
        SCHEMA.account,
        {
          UserId: userId,
          Email: email,
          DisplayName: displayNameOf(`${firstName} ${lastName}`),
          Status: "active",
          MustChangePassword: true,
          TemporaryPasswordSetAt: now,
          CreatedByUserId: caller.userId,
          UpdatedByUserId: caller.userId,
        },
        `account:${userId}`,
      );
      if (!created) {
        await deps.gateway.update(SCHEMA.account, item.ItemId, {
          MustChangePassword: true,
          TemporaryPasswordSetAt: now,
          UpdatedByUserId: caller.userId,
        });
      }
      flagSaved = true;
    } catch {
      flagSaved = false;
    }
  }
  if (!flagSaved) {
    await finishWith(deps, () =>
      audit(deps, ctx, caller, { targetType: "iam-user", targetId: userId ?? "unknown", details: { flagSaved: false, active } }),
    );
    return fail("unavailable", "people.flagNotSaved");
  }

  const mustChangePassword = !cloudIam;
  await finishWith(deps, () =>
    audit(deps, ctx, caller, {
      targetType: "iam-user",
      targetId: userId ?? "unknown",
      details: { roles: [IAM_USER_ROLE], emailDomain: emailDomainOf(email), temporaryPassword: true, mustChangePassword, active },
    }),
  );
  return ok({ userId, email, temporaryPassword, active, mustChangePassword });
}
