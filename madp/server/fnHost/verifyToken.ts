// The caller context every function receives (ctx.context), the shape Blocks Logic Functions build, so the same routers
// run on every host. The local host fills it from the account store (server/local/iam/verify.ts).

export interface FnContext {
  tenantId: string;
  userId: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
  email: string;
  displayName?: string;
  identitySource?: "iam";
  isAuthenticated: true;
  impersonated: boolean;
  applicationDomain: string;
}
