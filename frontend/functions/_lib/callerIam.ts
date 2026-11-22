// IAM with the caller's OWN verified bearer token (never the service credential), so IAM enforces the caller's own
// IAM permissions. The token is never logged, stored or put in a result.
import type { SdkFactory } from "./sdk";

export type IamFailure = { ok: false; status: number | null; errors: Record<string, string> };
export type IamOutcome = { ok: true } | IamFailure;
export interface IamUserRow { userId: string; email: string; roles: string[]; active: boolean; firstName?: string; lastName?: string }

export interface CallerIam {
  /** Does an IAM user with this email exist? userId is null when the answer is a definitive no. */
  exists(email: string): Promise<{ ok: true; userId: string | null } | IamFailure>;
  listUsers(q: { pageNo: number; pageSize: number; search?: string }): Promise<{ ok: true; users: IamUserRow[]; totalCount: number | null } | IamFailure>;
  createUser(u: { email: string; firstName: string; lastName: string; roles: string[]; password?: string }): Promise<{ ok: true; userId: string | null } | IamFailure>;
  /** IAM refuses an activation without a reason (ActivateUserByAdminRequest.Reason is required). */
  activate(userId: string, reason?: string): Promise<IamOutcome>;
  deactivate(userId: string): Promise<IamOutcome>;
  updateAccess(userId: string, roles: string[]): Promise<IamOutcome>;
  resendActivation(userId: string): Promise<IamOutcome>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : []);

/** Why an activation happened when the op gives no reason of its own (IAM records it). */
export const DEFAULT_ACTIVATION_REASON = "Activated by a MADP Factory super admin";

/**
 * A user's roles from an IAM users list row. IAM keys them by organization ({ "default": ["mf-user", ...] }); a flat
 * list is read as it is. The Factory uses one organization, so the roles of every organization are merged.
 */
export function iamRoles(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(strings(v))];
  if (!isObject(v)) return [];
  return [...new Set(Object.values(v).flatMap(strings))];
}

/**
 * IAM's users list request (POST /iam/v4/iam/users, GetUsersQuery): `page` counts from 0, the search goes in `filter`
 * (`email` or `name`, both matched as a part of the value). The op's page counts from 1.
 */
export function usersListBody(q: { pageNo: number; pageSize: number; search?: string }): Record<string, unknown> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(q.pageSize) || 1));
  const page = Math.max(0, (Math.trunc(q.pageNo) || 1) - 1);
  const search = q.search?.trim();
  const filter = search ? (search.includes("@") ? { email: search } : { name: search }) : {};
  return { page, pageSize, filter };
}

function sanitized(errors: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(errors)) return out;
  for (const [k, v] of Object.entries(errors)) {
    if (Object.keys(out).length >= 10) break;
    if (typeof v === "string") out[k] = v.slice(0, 200);
  }
  return out;
}

const failed = (body: unknown): IamFailure => ({
  ok: false,
  status: isObject(body) && typeof body.status === "number" && Number.isFinite(body.status) ? body.status : null,
  errors: sanitized(isObject(body) ? body.errors : undefined),
});

function thrown(err: unknown): IamFailure {
  const s = isObject(err) ? err.status : undefined;
  return { ok: false, status: typeof s === "number" && Number.isFinite(s) ? s : null, errors: {} };
}

export function createCallerIam(o: { sdk: SdkFactory; apiUrl: string; tenant: string; token: string }): CallerIam {
  const client = o.sdk({ apiUrl: o.apiUrl, xBlocksKey: o.tenant, accessToken: o.token }) as any;
  const outcome = async (call: () => Promise<unknown>, strict = false): Promise<IamOutcome> => {
    try {
      const res = await call();
      if (isObject(res) && res.isSuccess === false) return failed(res);
      if (strict && isObject(res) && isObject(res.errors) && Object.keys(res.errors).length > 0) return failed(res);
      return { ok: true };
    } catch (err) {
      return thrown(err);
    }
  };
  return {
    async listUsers(q) {
      try {
        const res = await client.iam.users.list(usersListBody(q));
        if (isObject(res) && res.isSuccess === false) return failed(res);
        const data = isObject(res) && Array.isArray(res.data) ? res.data : [];
        const users: IamUserRow[] = [];
        for (const u of data) {
          if (!isObject(u) || typeof u.itemId !== "string" || !u.itemId || typeof u.email !== "string" || !u.email) continue;
          const roles = iamRoles(u.roles);
          users.push({
            userId: u.itemId, email: u.email, roles, active: u.active !== false,
            firstName: typeof u.firstName === "string" ? u.firstName : "", lastName: typeof u.lastName === "string" ? u.lastName : "",
          });
        }
        const total = isObject(res) && typeof res.totalCount === "number" ? res.totalCount : null;
        return { ok: true, users, totalCount: total };
      } catch (err) {
        return thrown(err);
      }
    },
    async exists(email) {
      try {
        const res = await client.iam.users.exists(email);
        if (isObject(res) && res.isSuccess === false) return failed(res);
        const data = isObject(res) ? (isObject(res.data) ? res.data : res) : {};
        if (!("userId" in data) || (data.userId !== null && typeof data.userId !== "string")) return failed(res);
        const id = typeof data.userId === "string" && data.userId ? data.userId : null;
        return { ok: true, userId: id };
      } catch (err) {
        return thrown(err);
      }
    },
    async createUser(u) {
      try {
        const res = await client.iam.users.create({
          email: u.email, firstName: u.firstName, lastName: u.lastName, roles: u.roles, ...(u.password ? { password: u.password } : {}),
        });
        if (isObject(res) && res.isSuccess === false) return failed(res);
        const id = isObject(res) ? (isObject(res.data) ? res.data.itemId ?? res.data.userId : res.itemId ?? res.userId) : undefined;
        return { ok: true, userId: typeof id === "string" && id ? id : null };
      } catch (err) {
        return thrown(err);
      }
    },
    activate: (userId, reason) => outcome(() => client.iam.users.activate({ userId, reason: reason?.trim() || DEFAULT_ACTIVATION_REASON })),
    deactivate: (userId) => outcome(() => client.iam.users.deactivate({ userId })),
    updateAccess: (userId, roles) => outcome(() => client.iam.users.updateAccess({ userId, roles })),
    resendActivation: (userId) => outcome(() => client.auth.resendActivation({ userId }), true),
  };
}
