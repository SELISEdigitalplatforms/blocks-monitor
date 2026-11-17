// Shared by the people.* ops: IAM people administration with the caller's own token (FL-PLN-104 / C4).
import { IAM_SUPER_ADMIN_ROLE } from "../../../../src/domain/tenancy";
import { fail } from "../../../workspace/ops/_shared/core";
import type { IamAdmin, IamFailure, IamUserRow, OpAnswer } from "../../../workspace/ops/_shared/ports";

export const IAM_USER_ROLE = "mf-user";
export const IAM_PLATFORM_USERS_ROLE = "mf-platform-users";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export const unique = (list: readonly string[]): string[] => [...new Set(list)];
export const isSelf = (callerUserId: string, userId: string): boolean => callerUserId === userId;

/** An IAM refusal as an op answer; only the status and the error map travel, never a token. */
export function iamRefused(r: IamFailure): OpAnswer<never> {
  const status = r.status ?? null;
  return fail(status === 401 || status === 403 ? "forbidden" : "invalid_input", "people.iamRefused", { status, errors: r.errors });
}

/** Pages through the IAM users: finds the target and counts the active super admins. null when a page failed or there were too many. */
export async function scanUsers(
  iam: IamAdmin,
  userId: string,
): Promise<{ target: IamUserRow | null; activeSuperAdmins: number; superAdminIds: string[] } | null> {
  let target: IamUserRow | null = null;
  let activeSuperAdmins = 0;
  const superAdminIds: string[] = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const page = await iam.listUsers({ pageNo, pageSize: PAGE_SIZE });
    if (!page.ok) return null;
    for (const u of page.users) {
      if (u.userId === userId) target = u;
      if (u.active && u.roles.includes(IAM_SUPER_ADMIN_ROLE)) {
        activeSuperAdmins += 1;
        superAdminIds.push(u.userId);
      }
    }
    if (page.users.length < PAGE_SIZE || (page.totalCount !== null && pageNo * PAGE_SIZE >= page.totalCount)) {
      return { target, activeSuperAdmins, superAdminIds: superAdminIds.sort() };
    }
  }
  return null;
}
