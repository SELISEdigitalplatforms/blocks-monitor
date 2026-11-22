// The function host's token check: an access token from the session cookie is looked up in the account store and turned
// into the caller context (ctx.context). An unknown or expired token, or a deactivated account, is refused.
import type { DatabaseSync } from "node:sqlite";
import type { FnContext } from "../../fnHost/verifyToken.ts";
import { LOCAL_TENANT } from "../runtime.ts";
import { userOfAccessToken } from "./store.ts";

export function createLocalVerifier(db: DatabaseSync, applicationDomain: string): (token: string) => Promise<FnContext> {
  return async (token) => {
    const u = userOfAccessToken(db, token);
    if (!u || !u.active || !u.activated) throw new Error("token");
    return {
      tenantId: LOCAL_TENANT,
      userId: u.userId,
      organizationId: "",
      roles: [...u.roles],
      permissions: [],
      email: u.email,
      isAuthenticated: true,
      impersonated: false,
      applicationDomain,
    };
  };
}
