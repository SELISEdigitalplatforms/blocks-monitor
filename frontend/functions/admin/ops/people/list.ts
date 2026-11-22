// people.list: one page of the IAM users with the caller's own token (super admin; Host A only). A view, audited once per successful read (counts and filters only).
import { audit, fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { IMPERSONATION_MESSAGE_KEY } from "../../../../src/domain/security";
import { iamRefused } from "./shared";

export interface PeopleListUser { userId: string; email: string; firstName: string; lastName: string; roles: string[]; active: boolean }

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH = 100;

export async function peopleList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ users: PeopleListUser[]; total: number }>> {
  const a = readArgs(args, { page: "number?", pageSize: "number?", search: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  if (ctx.context.impersonated) return fail("forbidden", IMPERSONATION_MESSAGE_KEY);
  const page = a.value.page ?? 0; // page is required: a missing one fails the integer check below
  const pageSize = a.value.pageSize ?? DEFAULT_PAGE_SIZE;
  const search = a.value.search === undefined ? undefined : a.value.search.trim();
  const bad: string[] = [];
  if (!Number.isInteger(page) || page < 1) bad.push("page");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) bad.push("pageSize");
  if (search !== undefined && search.length > MAX_SEARCH) bad.push("search");
  if (bad.length) return fail("invalid_input", "tenancy.invalidArgs", { keys: bad.sort() });

  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.users.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  if (!open.caller.isSuperAdmin) return fail("forbidden", "people.superAdminOnly");
  if (!deps.iam) return fail("not_supported", "people.notSupported");

  const res = await deps.iam.listUsers({ pageNo: page, pageSize, ...(search ? { search } : {}) });
  if (!res.ok) return iamRefused(res);
  const users = res.users.map((u) => ({
    userId: u.userId,
    email: u.email,
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    roles: u.roles,
    active: u.active,
  }));
  const total = res.totalCount ?? users.length;
  await audit(deps, ctx, open.caller, { targetType: "iam-user", targetId: "directory", details: { page, pageSize, searched: Boolean(search), count: users.length, total } });
  return ok({ users, total });
}
