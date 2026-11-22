// Blocks OS IAM administration for the Factory's roles, permissions, organizations and access grants, server side, on
// the platform's SERVICE identity (the one sign-up uses, server/blocks/signup.ts). The implementation is
// functions/_lib/iamAdmin.ts (the function bundle carries the same module: the routers reach it as deps.iamAdmin and
// deps.rbac.iam); this file gives server code the contract's functions by name, on one process-wide instance.
//
// The instance: configureIamAdmin(env) (server/blocks/host.ts does, with the host's own FnEnv), else built on first use
// from the process env the function host reads (MF_BLOCKS_API_URL, MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID,
// MF_SVC_CLIENT_SECRET). A missing setting answers iam.unavailable. Errors: IamAdminError, code (and message) exactly
// iam.unavailable | iam.forbidden | iam.notFound. Never logs or returns a token.
import type { FnEnv } from "../../functions/_lib/env.ts";
import {
  IamAdminError,
  createIamAdmin,
  processIamAdminCache,
  type IamAdminApi,
  type IamGrant,
  type IamOrganization,
  type IamPermission,
  type IamRole,
  type IamUserAccess,
} from "../../functions/_lib/iamAdmin.ts";
import { defaultSdk, type SdkFactory } from "../../functions/_lib/sdk.ts";
import { serviceClient, serviceTokens } from "../../functions/_lib/serviceToken.ts";

export * from "../../functions/_lib/iamAdmin.ts";
export {
  RBAC_SOURCE_KEY,
  SAFETY_SUPER_ADMIN_ROLE,
  createRbacCaches,
  invalidateRbac,
  isRbacSource,
  processRbacCaches,
  rbacSettingOf,
  rbacSourceJson,
  type RbacSetting,
  type RbacSource,
} from "../../functions/_lib/rbacSource.ts";

const DEFAULT_API_URL = "https://api.seliseblocks.com";

/** The IAM admin module on the service identity of this env (a fresh instance; the catalogue cache is per process). */
export function createServerIamAdmin(env: FnEnv, o: { sdk?: SdkFactory; now?: () => number } = {}): IamAdminApi {
  const sdk = o.sdk ?? defaultSdk;
  const tokens = serviceTokens(env, sdk, o.now);
  return createIamAdmin({ client: serviceClient(env, sdk, tokens), cache: processIamAdminCache, ...(o.now ? { now: o.now } : {}) });
}

let instance: IamAdminApi | null = null;

/** Sets the process-wide instance (the host calls it with its own env; tests may pass a fake). */
export function configureIamAdmin(envOrAdmin: FnEnv | IamAdminApi | null, o: { sdk?: SdkFactory; now?: () => number } = {}): void {
  if (envOrAdmin === null) instance = null;
  else if ("userAccess" in envOrAdmin) instance = envOrAdmin;
  else instance = createServerIamAdmin(envOrAdmin, o);
}

function current(): IamAdminApi {
  if (instance) return instance;
  const e = process.env;
  const env: FnEnv = {
    apiUrl: (e.MF_BLOCKS_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, ""),
    tenant: e.MF_BLOCKS_TENANT || e.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: e.MF_SVC_CLIENT_ID || "",
    clientSecret: e.MF_SVC_CLIENT_SECRET || "",
  };
  if (!env.tenant || !env.clientId || !env.clientSecret || !/^https:\/\/[^\s/]+/.test(env.apiUrl)) throw new IamAdminError("iam.unavailable");
  instance = createServerIamAdmin(env);
  return instance;
}

const run = async <T>(work: (iam: IamAdminApi) => Promise<T>): Promise<T> => work(current());

// The contract's functions, by name.
export const listPermissions = (): Promise<IamPermission[]> => run((i) => i.listPermissions());
export const ensurePermissions = (keys: readonly string[], describe?: (key: string) => string): Promise<{ created: string[] }> =>
  run((i) => i.ensurePermissions(keys, describe));
export const listRoles = (): Promise<IamRole[]> => run((i) => i.listRoles());
export const getRole = (slug: string): Promise<IamRole | null> => run((i) => i.getRole(slug));
export const upsertRole = (r: { slug: string; name: string; description?: string; permissions: readonly string[] }): Promise<IamRole> =>
  run((i) => i.upsertRole(r));
export const deleteRole = (slug: string): Promise<void> => run((i) => i.deleteRole(slug));
export const listOrganizations = (): Promise<IamOrganization[]> => run((i) => i.listOrganizations());
export const ensureOrganization = (w: { workspaceId: string; name: string; iamOrganizationId?: string | null }): Promise<string> =>
  run((i) => i.ensureOrganization(w));
export const userAccess = (userId: string, o?: { organizationIds?: readonly string[] }): Promise<IamUserAccess> =>
  run((i) => i.userAccess(userId, o));
export const grant = (userId: string, g: IamGrant): Promise<void> => run((i) => i.grant(userId, g));
export const revoke = (userId: string, g: IamGrant): Promise<void> => run((i) => i.revoke(userId, g));
