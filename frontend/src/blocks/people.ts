/** Settings → People: the Blocks users admin. Every exported action checks isSuperAdmin before any SDK call. */
import type { BlocksUser } from "@seliseblocks/client";
import { iamMessage } from "@/blocks/iamResult";
import { FunctionError, callFunction } from "@/blocks/fn";
import { SUPER_ADMIN_ROLE, USER_ROLE, useSession } from "@/blocks/session";
import { refreshSessionAccess } from "@/blocks/sessionFreshness";

export const PEOPLE_PAGE_SIZE = 20;

export interface PersonRow {
  userId: string; email: string; firstName: string; lastName: string; displayName: string;
  roles: string[]; active: boolean; superAdmin: boolean;
}
export type AdminResult = { ok: true; message: string } | { ok: false; error: string };
export type CreateAccountResult =
  | { ok: true; email: string; temporaryPassword: string; active: boolean; mustChangePassword: boolean; message: string; note: string }
  | { ok: false; error: string };
export type ListResult = { ok: true; rows: PersonRow[]; total: number } | { ok: false; error: string };

export const MSG_NOT_ADMIN = "Only a Super admin can manage people.";
export const MSG_SELF_DEMOTE = "You can't remove your own Super admin role.";
export const MSG_SELF_DEACTIVATE = "You can't deactivate your own account.";
export const MSG_LAST_ADMIN = "MADP Factory needs at least one Super admin.";
export const MSG_COUNT_FAILED = "Couldn't confirm that another Super admin remains. Try again.";

/** The plain sentence for a people.* / tenancy.* message key an admin server op answered with; null when unknown. */
export function peopleMessage(key: string | undefined, params?: Record<string, unknown>): string | null {
  switch (key) {
    case "people.superAdminOnly": return MSG_NOT_ADMIN;
    case "tenancy.selfDeactivate": return MSG_SELF_DEACTIVATE;
    case "people.selfDemote": return MSG_SELF_DEMOTE;
    case "people.lastSuperAdmin": return MSG_LAST_ADMIN;
    case "people.countFailed": return MSG_COUNT_FAILED;
    case "people.userNotFound": return "That person was not found.";
    case "people.notSupported": return "Managing people isn't available on this server.";
    case "people.iamRefused": return iamMessage({ isSuccess: false, errors: params?.errors ?? {}, status: params?.status });
    case "people.accountExists": return "An account with this email already exists. Invite them instead, or ask them to use Forgot password.";
    case "people.flagNotSaved": return "The account was created, but MADP Factory couldn't record that the password must be changed, so the temporary password was not shown. Ask them to use Forgot password on the sign-in page.";
    case "audit.actorTooBroad": return "Too many people match. Type more of the name or email.";
    case "tenancy.invalidEmail": return "Enter a valid email address.";
    case "tenancy.invalidName": return params?.field === "lastName" ? "Enter a last name (1-60 characters)." : "Enter a first name (1-60 characters).";
    default: return null;
  }
}

/** A failed admin server op as the message shown to the person. */
export function peopleError(err: unknown): string {
  if (err instanceof FunctionError) return peopleMessage(err.messageKey, err.params) ?? err.message;
  return iamMessage(err);
}

type Me = { userId: string; email: string } | null | undefined;

export function toRow(u: BlocksUser): PersonRow | null {
  const userId = typeof u.itemId === "string" ? u.itemId : "";
  const email = typeof u.email === "string" ? u.email : "";
  if (!userId || !email) return null;
  const firstName = typeof u.firstName === "string" ? u.firstName : "";
  const lastName = typeof u.lastName === "string" ? u.lastName : "";
  const roles = Array.isArray(u.roles) ? u.roles.filter((r): r is string => typeof r === "string") : [];
  return {
    userId, email, firstName, lastName,
    displayName: `${firstName} ${lastName}`.trim() || email,
    roles, active: u.active !== false, superAdmin: roles.includes(SUPER_ADMIN_ROLE),
  };
}

export function requireSuperAdmin(): string | null {
  return useSession.getState().profile?.isSuperAdmin ? null : MSG_NOT_ADMIN;
}

export function isSelf(me: Me, row: { userId: string; email: string }): boolean {
  if (!me) return false;
  return (!!me.userId && me.userId === row.userId) || (!!me.email && me.email.toLowerCase() === row.email.toLowerCase());
}

type GuardArgs = { me: Me; target: PersonRow; superAdminCount: number };

export function demoteGuard({ me, target, superAdminCount }: GuardArgs): string | null {
  if (isSelf(me, target)) return MSG_SELF_DEMOTE;
  if (target.superAdmin && superAdminCount <= 1) return MSG_LAST_ADMIN;
  return null;
}

export function deactivateGuard({ me, target, superAdminCount }: GuardArgs): string | null {
  if (isSelf(me, target)) return MSG_SELF_DEACTIVATE;
  if (target.superAdmin && target.active && superAdminCount <= 1) return MSG_LAST_ADMIN;
  return null;
}

/** Active super admins across all pages (counted by the server), or null when it can't be confirmed (callers fail closed). */
export async function countActiveSuperAdmins(): Promise<number | null> {
  try {
    const res = await callFunction<{ count?: unknown }>("admin", "people.countSuperAdmins", {});
    const count = res.data?.count;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/** The list payload in one place, so it can be tuned against the live IAM. */
export function usersListPayload(page: number, search?: string) {
  const q = search?.trim();
  return { pageNo: page, pageSize: PEOPLE_PAGE_SIZE, search: q ? q : undefined };
}

type ListedUser = { userId?: unknown; email?: unknown; firstName?: unknown; lastName?: unknown; roles?: unknown; active?: unknown };

function listedRow(u: ListedUser): PersonRow | null {
  const userId = typeof u.userId === "string" ? u.userId : "";
  const email = typeof u.email === "string" ? u.email : "";
  if (!userId || !email) return null;
  const firstName = typeof u.firstName === "string" ? u.firstName : "";
  const lastName = typeof u.lastName === "string" ? u.lastName : "";
  const roles = Array.isArray(u.roles) ? u.roles.filter((r): r is string => typeof r === "string") : [];
  return {
    userId, email, firstName, lastName,
    displayName: `${firstName} ${lastName}`.trim() || email,
    roles, active: u.active !== false, superAdmin: roles.includes(SUPER_ADMIN_ROLE),
  };
}

export async function listPeople({ page, search }: { page: number; search?: string }): Promise<ListResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  try {
    const q = search?.trim();
    const res = await callFunction<{ users?: ListedUser[]; total?: number }>("admin", "people.list", { page, ...(q ? { search: q } : {}) });
    const needle = q?.toLowerCase() ?? "";
    const rows = (res.data?.users ?? []).map(listedRow).filter((r): r is PersonRow => !!r)
      .filter((r) => !needle || r.displayName.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle));
    const total = res.data?.total;
    return { ok: true, rows, total: typeof total === "number" ? total : rows.length };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function invitePerson(input: { email: string; firstName: string; lastName: string }): Promise<AdminResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Enter a valid email address." };
  if (firstName.length < 1 || firstName.length > 60) return { ok: false, error: "Enter a first name (1-60 characters)." };
  if (lastName.length < 1 || lastName.length > 60) return { ok: false, error: "Enter a last name (1-60 characters)." };
  try {
    // no password: IAM emails the activation link
    await callFunction("admin", "people.invite", { email, firstName, lastName });
    return { ok: true, message: `Invitation sent to ${email}. MADP Factory emails them an activation link.` };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

/** What the super admin is told after creating an account: the list message and the note under the password. */
export function handOver(email: string, active: boolean, mustChangePassword: boolean): { message: string; note: string } {
  if (!active) {
    return {
      message: `Account created for ${email}, but it is not active yet. Choose Activate next to it in the list before you hand it over.`,
      note: "The account is not active yet: activate it in the list, then share the password privately.",
    };
  }
  return mustChangePassword
    ? { message: `Account created for ${email}. They must change the temporary password when they first sign in.`, note: PASSWORD_NOTE }
    : { message: `Account created for ${email}. It is active and ready to hand over.`, note: "Share it privately and ask them to change it after they first sign in." };
}

export const PASSWORD_NOTE = "Share it privately; they must change it when they first sign in.";

/** Creates an account with a server-generated temporary password; the password is returned once and never logged. */
export async function createAccount(input: { email: string; firstName: string; lastName: string }): Promise<CreateAccountResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Enter a valid email address." };
  if (firstName.length < 1 || firstName.length > 60) return { ok: false, error: "Enter a first name (1-60 characters)." };
  if (lastName.length < 1 || lastName.length > 60) return { ok: false, error: "Enter a last name (1-60 characters)." };
  try {
    const res = await callFunction<{ temporaryPassword?: unknown; active?: unknown; mustChangePassword?: unknown }>("admin", "people.createAccount", { email, firstName, lastName });
    const temporaryPassword = res.data?.temporaryPassword;
    if (typeof temporaryPassword !== "string" || temporaryPassword.length < 16) {
      return { ok: false, error: "The server didn't return a temporary password. Try again." };
    }
    // Older servers did not report these: they activated nothing and always required the change.
    const active = res.data?.active !== false;
    const mustChangePassword = res.data?.mustChangePassword !== false;
    return { ok: true, email, temporaryPassword, active, mustChangePassword, ...handOver(email, active, mustChangePassword) };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

export async function resendInvite(row: PersonRow): Promise<AdminResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  try {
    await callFunction("admin", "people.resendActivation", { userId: row.userId });
    return { ok: true, message: `A new activation link is on its way to ${row.email}.` };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

export async function setActive(row: PersonRow, active: boolean): Promise<AdminResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  try {
    if (!active) {
      const me = useSession.getState().profile;
      const count = row.superAdmin ? await countActiveSuperAdmins() : 0;
      if (count === null) return { ok: false, error: MSG_COUNT_FAILED };
      const blocked = deactivateGuard({ me, target: row, superAdminCount: count });
      if (blocked) return { ok: false, error: blocked };
    }
    await callFunction("admin", "people.setActive", { userId: row.userId, active });
    return { ok: true, message: `${row.displayName} is ${active ? "active again" : "deactivated"}.` };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

/** The access payload in one place. */
export function accessPayload(row: PersonRow, on: boolean) {
  const roles = on
    ? [...new Set([...row.roles, USER_ROLE, SUPER_ADMIN_ROLE])]
    : [...new Set([...row.roles.filter((r) => r !== SUPER_ADMIN_ROLE), USER_ROLE])];
  return { userId: row.userId, roles };
}

export async function setSuperAdmin(row: PersonRow, on: boolean): Promise<AdminResult> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  try {
    if (!on) {
      const me = useSession.getState().profile;
      const count = row.superAdmin ? await countActiveSuperAdmins() : 0;
      if (count === null) return { ok: false, error: MSG_COUNT_FAILED };
      const blocked = demoteGuard({ me, target: row, superAdminCount: count });
      if (blocked) return { ok: false, error: blocked };
    }
    await callFunction("admin", "people.setRole", { userId: row.userId, role: SUPER_ADMIN_ROLE, grant: on });
    // the signed-in person's own flag and permissions follow at once (their own row, or a role they share)
    void refreshSessionAccess();
    return { ok: true, message: on ? `${row.displayName} is now a Super admin.` : `${row.displayName} is no longer a Super admin.` };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}
