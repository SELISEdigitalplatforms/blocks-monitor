import { OpError } from "./errors";

/** The signed-in actor, read only from the platform-validated token context. */
export interface Caller {
  userId: string;
  /** Lower-case. */
  email: string;
  displayName?: string;
  identitySource?: "iam";
  roles: readonly string[];
  isSuperAdmin: boolean;
  isEngine: boolean;
  impersonated: boolean;
  tenantId: string;
}

const SUPER_ADMIN_ROLE = "mf-super-admin";
const ENGINE_ROLE = "mf-engine";

/** Builds the caller from `ctx.context` alone. Ids in the args never identify the actor. */
export function readCaller(context: unknown, tenant: string): Caller {
  if (!context || typeof context !== "object") throw new OpError("unauthenticated");
  const c = context as Record<string, unknown>;
  if (c.isAuthenticated !== true) throw new OpError("unauthenticated");
  if (typeof c.userId !== "string" || c.userId.trim() === "") throw new OpError("unauthenticated");
  if (
    typeof c.tenantId !== "string" ||
    tenant === "" ||
    c.tenantId.toLowerCase() !== tenant.toLowerCase()
  ) {
    throw new OpError("unauthenticated");
  }
  // Blocks subjects can arrive as "<provider>|<userId>"; the plain id identifies the actor.
  const userId = c.userId.trim().replace(/^[^|]+\|/, "");
  if (userId === "") throw new OpError("unauthenticated");
  // roles is a string for a single role, an array for several (or a JSON-encoded array).
  let rawRoles: unknown = c.roles;
  if (typeof rawRoles === "string" && rawRoles.trim().startsWith("[")) {
    try {
      rawRoles = JSON.parse(rawRoles);
    } catch {
      // not JSON: a single role name
    }
  }
  const roles = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === "string" && r !== "")
    : typeof rawRoles === "string" && rawRoles !== ""
      ? [rawRoles]
      : [];
  return {
    userId,
    email: typeof c.email === "string" ? c.email.trim().toLowerCase() : "",
    displayName: typeof c.displayName === "string" ? c.displayName : "",
    identitySource: c.identitySource === "iam" ? "iam" : undefined,
    roles,
    isSuperAdmin: roles.includes(SUPER_ADMIN_ROLE),
    isEngine: roles.includes(ENGINE_ROLE),
    impersonated: c.impersonated === true,
    tenantId: c.tenantId,
  };
}
