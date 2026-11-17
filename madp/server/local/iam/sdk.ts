// The platform client the routers get (HostAdapters.sdk): the service identity's token, and IAM administration with the
// CALLER's own token (people list / create / activate / deactivate / roles, resend activation), all on the local account
// store. IAM checks the caller's own rights, as the real IAM does: only super admins (and platform user managers for the
// list) may administer people. Data and Storage never go through here: the router gets the local gateway and files.
import type { DatabaseSync } from "node:sqlite";
import { sendActivationMail } from "./auth.ts";
import {
  EmailTaken,
  IAM_SUPER_ADMIN_ROLE,
  IAM_USER_ROLE,
  createUser,
  getUser,
  hashPassword,
  listUsers,
  setActive,
  setRoles,
  userOfAccessToken,
} from "./store.ts";

const PLATFORM_USERS_ROLE = "mf-platform-users";

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");

/** The service identity's token: only its claims are ever read (exp, roles). It never leaves the process. */
function serviceToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + 3600;
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "factory-service", roles: ["mf-service"], exp })}.local`;
}

class IamHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "BlocksApiError";
  }
}

function notHere(path: string): unknown {
  return new Proxy(function () {}, {
    get: (_t, key) => notHere(`${path}.${String(key)}`),
    apply: () => {
      throw new Error(`${path} is not available on the local host`);
    },
  });
}

export function createLocalSdk(o: { db: DatabaseSync; appOrigin: () => string; log?: (line: string) => void }) {
  const { db } = o;
  return (opts: { accessToken?: string }) => {
    const caller = () => {
      const u = opts.accessToken ? userOfAccessToken(db, opts.accessToken) : null;
      if (!u || !u.active || !u.activated) throw new IamHttpError(401);
      return u;
    };
    const admin = (alsoUserManagers = false) => {
      const u = caller();
      const ok = u.roles.includes(IAM_SUPER_ADMIN_ROLE) || (alsoUserManagers && u.roles.includes(PLATFORM_USERS_ROLE));
      if (!ok) throw new IamHttpError(403);
      return u;
    };
    const userOrFail = (userId: unknown) => {
      const u = typeof userId === "string" ? getUser(db, userId) : null;
      return u;
    };
    return {
      auth: {
        oidc: {
          clientCredentials: async () => ({ access_token: serviceToken(), expires_in: 3600, token_type: "Bearer" }),
        },
        resendActivation: async (r: { userId?: string }) => {
          admin();
          const u = userOrFail(r.userId);
          if (!u) return { isSuccess: false, errors: { userId: "No account has this id." } };
          if (u.activated) return { isSuccess: false, errors: { userId: "This account is already activated." } };
          sendActivationMail(db, o.appOrigin(), u, o.log);
          return { isSuccess: true, errors: {} };
        },
      },
      iam: {
        users: {
          // IAM's request: `page` counts from 0 and the search is `filter.email` / `filter.name` (functions/_lib/callerIam.ts).
          list: async (q: { page?: number; pageSize?: number; filter?: { email?: unknown; name?: unknown } }) => {
            admin(true);
            const pageNo = Math.max(0, Math.trunc(Number(q.page) || 0)) + 1;
            const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize) || 20)));
            const term = [q.filter?.email, q.filter?.name].find((t): t is string => typeof t === "string" && t.trim() !== "");
            const { users, totalCount } = listUsers(db, { pageNo, pageSize, ...(term ? { search: term.trim() } : {}) });
            return {
              isSuccess: true,
              totalCount,
              data: users.map((u) => ({ itemId: u.userId, email: u.email, firstName: u.firstName, lastName: u.lastName, displayName: u.displayName, roles: u.roles, active: u.active, isVerified: u.activated })),
            };
          },
          create: async (u: { email: string; firstName: string; lastName: string; roles?: string[]; password?: string }) => {
            admin();
            try {
              const made = createUser(db, {
                email: u.email,
                firstName: u.firstName,
                lastName: u.lastName,
                roles: u.roles?.length ? u.roles : [IAM_USER_ROLE],
                passwordHash: u.password ? await hashPassword(u.password) : null,
              });
              // Without a password the person activates the account from the e-mail link.
              if (!u.password) sendActivationMail(db, o.appOrigin(), made, o.log);
              return { isSuccess: true, errors: {}, data: { itemId: made.userId } };
            } catch (e) {
              if (e instanceof EmailTaken) return { isSuccess: false, errors: { email: "A user with this email already exists." } };
              throw e;
            }
          },
          activate: async (r: { userId: string; reason?: unknown }) => {
            admin();
            // As IAM: ActivateUserByAdminRequest.Reason is required.
            if (typeof r.reason !== "string" || !r.reason.trim()) return { isSuccess: false, errors: { reason: "The Reason field is required." } };
            return setActive(db, r.userId, true) ? { isSuccess: true, errors: {} } : { isSuccess: false, errors: { userId: "No account has this id." } };
          },
          deactivate: async (r: { userId: string }) => {
            admin();
            return setActive(db, r.userId, false) ? { isSuccess: true, errors: {} } : { isSuccess: false, errors: { userId: "No account has this id." } };
          },
          updateAccess: async (r: { userId: string; roles: string[] }) => {
            admin();
            return setRoles(db, r.userId, Array.isArray(r.roles) ? r.roles : [])
              ? { isSuccess: true, errors: {} }
              : { isSuccess: false, errors: { userId: "No account has this id." } };
          },
        },
        me: async () => {
          const u = caller();
          return { itemId: u.userId, email: u.email, firstName: u.firstName, lastName: u.lastName, displayName: u.displayName, roles: u.roles, active: u.active };
        },
      },
      data: notHere("data"),
    };
  };
}
