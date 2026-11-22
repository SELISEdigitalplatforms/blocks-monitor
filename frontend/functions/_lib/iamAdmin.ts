// Blocks IAM administration for the Factory's roles and permissions (the IAM-backed RBAC): the permission catalogue,
// roles and their permissions, organizations and one person's access, through the official SDK (the same IAM API the
// `blocks iam ...` commands call) with the platform's SERVICE identity, the one sign-up uses. Every failure is an
// IamAdminError with a plain code; nothing here audits (the calling op does) and no token or secret is ever logged.
//
// IAM behaviour this module relies on (read from the CLI's own commands):
//   - POST /iam/v4/iam/users/access REPLACES an organization's whole roles (or permissions) list when one is sent, and
//     keeps it when it is omitted or empty, so grant/revoke read the current lists and write the merged list.
//   - POST /iam/v4/iam/users/revoke-access {userId, organizationId} removes the person's access to that organization.
//   - POST /iam/v4/iam/roles/assign-permissions takes permission item ids (addPermissions / removePermissions).
//   - A permission row lists the role slugs that hold it (`roles`); that is how a role's permissions are read.
//   - IAM has no role delete: deleteRole removes every permission from the role and marks its name as removed.
// Error codes are exactly iam.unavailable (IAM not reached / failed), iam.forbidden (IAM refused: rights or rules) and
// iam.notFound; the code is also the error message.
import type { SdkClient } from "./sdk";

export type IamErrorCode = "iam.unavailable" | "iam.forbidden" | "iam.notFound";

/** A failed IAM call. `code` is all a caller may show; nothing of IAM's own answer is kept. */
export class IamAdminError extends Error {
  readonly code: IamErrorCode;
  readonly status: number | null;
  constructor(code: IamErrorCode, status: number | null = null) {
    super(code);
    this.name = "IamAdminError";
    this.code = code;
    this.status = status;
  }
}

export const isIamAdminError = (e: unknown): e is IamAdminError => e instanceof IamAdminError;

/** The IAM resource every Factory permission is filed under. */
export const IAM_RESOURCE = "madp-factory";
/** IAM files each permission under a unique resource of its group, like its own ("blocks-iam::iam::roles"). */
export const iamResourceOf = (key: string): string => `${IAM_RESOURCE}::${key.startsWith("platform.") ? "platform" : "organization"}::${key}`;
/** A permission the Factory created (today's per-key resources and the first single-resource form). */
export const isFactoryResource = (resource: string): boolean => resource === IAM_RESOURCE || resource.startsWith(`${IAM_RESOURCE}::`);
/** The IAM role that makes a person the Factory super admin when roles come from IAM. */
export const IAM_PLATFORM_SUPER_ADMIN = "mf-platform-super-admin";
/** The built-in organization owner role in IAM. */
export const IAM_ORG_OWNER = "mf-org-owner";
/** Built-in organization roles (Factory keys, src/domain/rbac.ts WORKSPACE_ROLES) that have one tenant-wide IAM role each. */
export const BUILT_IN_ORG_ROLE_KEYS = ["owner", "member", "viewer"] as const;
/** The built-in platform role that holds every platform permission (src/domain/roles.ts PLATFORM_ADMIN_ROLE) and its slug. */
export const PLATFORM_ADMIN_KEY = "platform-admin";
export const IAM_PLATFORM_ADMIN = "mf-platform-admin";
/** Where IAM files the access granted without an organization. */
export const IAM_DEFAULT_ORG = "default";

const SLUG_PART = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A Factory platform role key as an IAM role slug ("platform-admin" -> "mf-platform-admin", "x" -> "mf-platform-x"). */
export function platformRoleSlug(key: string): string {
  if (key === PLATFORM_ADMIN_KEY) return IAM_PLATFORM_ADMIN;
  return `mf-platform-${key}`;
}

/** The Factory key of an IAM platform role slug, or null when the slug is not one (the super admin is not a role key). */
export function platformRoleKeyOf(slug: string): string | null {
  if (slug === IAM_PLATFORM_ADMIN) return PLATFORM_ADMIN_KEY;
  if (slug === IAM_PLATFORM_SUPER_ADMIN || !slug.startsWith("mf-platform-")) return null;
  const key = slug.slice("mf-platform-".length);
  return SLUG_PART.test(key) ? key : null;
}

/** The short form of a workspace id used inside IAM role slugs: its first 8 letters and digits, lower case. */
export function workspaceShortId(workspaceId: string): string {
  return workspaceId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
}

/** An organization role as an IAM slug: built-ins are tenant-wide, custom roles carry the organization. */
export function orgRoleSlug(roleKey: string, workspaceId: string): string {
  if ((BUILT_IN_ORG_ROLE_KEYS as readonly string[]).includes(roleKey)) return `mf-org-${roleKey}`;
  return `mf-org-${workspaceShortId(workspaceId)}-${roleKey}`;
}

/** An organization role template as an IAM slug. */
export function templateRoleSlug(key: string): string {
  return `mf-tpl-${key}`;
}

/** The Factory role key of an IAM organization role slug in this workspace, or null when it belongs elsewhere. */
export function orgRoleKeyOf(slug: string, workspaceId: string): string | null {
  if (!slug.startsWith("mf-org-")) return null;
  const rest = slug.slice("mf-org-".length);
  if ((BUILT_IN_ORG_ROLE_KEYS as readonly string[]).includes(rest)) return rest;
  const prefix = `${workspaceShortId(workspaceId)}-`;
  if (!rest.startsWith(prefix)) return null;
  const key = rest.slice(prefix.length);
  return key ? key : null;
}

/** The marker an IAM organization of a Factory workspace carries in its description (the idempotency key). */
export function workspaceMarker(workspaceId: string): string {
  return `[mf-workspace:${workspaceId}]`;
}

export interface IamPermission {
  id: string;
  name: string;
  resource: string;
  description: string;
  /** Role slugs that hold this permission. */
  roles: string[];
}

export interface IamRole {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Permission names the role holds. */
  permissions: string[];
}

export interface IamOrganization {
  id: string;
  name: string;
  description: string;
}

export interface IamAccessSet {
  roles: string[];
  /** The person's permissions here: the ones granted directly and the ones of their roles. */
  permissions: string[];
}

export interface IamUserAccess {
  platform: IamAccessSet;
  orgs: Record<string, IamAccessSet>;
}

export interface IamGrant {
  roles?: readonly string[];
  permissions?: readonly string[];
  /** Absent: the platform-wide access (IAM's default organization). */
  organizationId?: string;
}

export interface IamAdminApi {
  listPermissions(): Promise<IamPermission[]>;
  /** Creates the missing permissions (name = key, resource madp-factory); answers the names it created. */
  ensurePermissions(keys: readonly string[], describe?: (key: string) => string): Promise<{ created: string[] }>;
  listRoles(): Promise<IamRole[]>;
  getRole(slug: string): Promise<IamRole | null>;
  /** Creates or changes the role and sets exactly these permissions on it (missing permissions are created first). */
  upsertRole(r: { slug: string; name: string; description?: string; permissions: readonly string[] }): Promise<IamRole>;
  deleteRole(slug: string): Promise<void>;
  listOrganizations(): Promise<IamOrganization[]>;
  /** The IAM organization of a workspace: the known id when it still exists, else the marked one, else a new one. */
  ensureOrganization(w: { workspaceId: string; name: string; iamOrganizationId?: string | null }): Promise<string>;
  /** One person's platform access and their access in the named organizations. */
  userAccess(userId: string, o?: { organizationIds?: readonly string[] }): Promise<IamUserAccess>;
  grant(userId: string, g: IamGrant): Promise<void>;
  revoke(userId: string, g: IamGrant): Promise<void>;
}

// ---------------------------------------------------------------- helpers

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
const uniq = (list: readonly string[]): string[] => [...new Set(list)];

const PAGE = 100;
const MAX_PAGES = 50;

function statusOf(e: unknown): number | null {
  if (!isRec(e) && !(e instanceof Error)) return null;
  const s = (e as { status?: unknown }).status;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

function codeOfStatus(status: number | null): IamErrorCode {
  if (status === 404) return "iam.notFound";
  // 401/403 and any other 4xx: IAM answered and said no.
  if (status !== null && status >= 400 && status < 500) return "iam.forbidden";
  return "iam.unavailable";
}

/** IAM answers 200 with isSuccess:false (and an error map) for a refusal. */
function refusal(res: unknown): IamAdminError | null {
  if (!isRec(res)) return null;
  const errors = isRec(res.errors) ? Object.values(res.errors).filter((v) => typeof v === "string") : [];
  if (res.isSuccess !== false && errors.length === 0) return null;
  const status = typeof res.status === "number" ? res.status : null;
  if (status !== null && status !== 200) return new IamAdminError(codeOfStatus(status), status);
  const said = errors.join(" ").toLowerCase();
  if (/not.?found|does not exist|no .* with/.test(said)) return new IamAdminError("iam.notFound", status);
  return new IamAdminError("iam.forbidden", status);
}

const dataOf = (res: unknown): Rec => (isRec(res) ? (isRec(res.data) ? res.data : res) : {});

function rowsOf(res: unknown, keys: readonly string[]): Rec[] {
  if (Array.isArray(res)) return res.filter(isRec);
  if (!isRec(res)) return [];
  for (const k of keys) if (Array.isArray(res[k])) return (res[k] as unknown[]).filter(isRec);
  return [];
}

const idOf = (r: Rec): string => text(r.itemId) || text(r.id) || text(r._id) || text(r.ItemId);

/** A user record's roles or permissions for one organization; IAM may key them by organization id. */
function listFor(v: unknown, orgKey: string): string[] {
  if (Array.isArray(v)) return strings(v);
  if (isRec(v)) return strings(v[orgKey]);
  return [];
}

// ---------------------------------------------------------------- the module

/** The permission catalogue cache; shared by every module instance of a process (each request builds its own). */
export interface IamAdminCache {
  perms: { at: number; rows: Promise<IamPermission[]> } | null;
}
export const createIamAdminCache = (): IamAdminCache => ({ perms: null });
export const processIamAdminCache: IamAdminCache = createIamAdminCache();

export function createIamAdmin(o: {
  client: () => Promise<SdkClient>;
  now?: () => number;
  cacheMs?: number;
  cache?: IamAdminCache;
}): IamAdminApi {
  const now = o.now ?? Date.now;
  const cacheMs = o.cacheMs ?? 60_000;
  const cache = o.cache ?? createIamAdminCache();

  /** Runs one IAM call: a thrown error or a refusal becomes an IamAdminError. */
  async function call<T>(work: (iam: SdkClient["iam"]) => Promise<T>): Promise<T> {
    let iam: SdkClient["iam"];
    try {
      iam = (await o.client()).iam;
    } catch (e) {
      throw new IamAdminError(codeOfStatus(statusOf(e)), statusOf(e));
    }
    let res: T;
    try {
      res = await work(iam);
    } catch (e) {
      if (isIamAdminError(e)) throw e;
      throw new IamAdminError(codeOfStatus(statusOf(e)), statusOf(e));
    }
    const no = refusal(res);
    if (no) throw no;
    return res;
  }

  async function fetchPermissions(): Promise<IamPermission[]> {
    const out: IamPermission[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await call((iam) => iam.permissions.list({ filter: { search: "", isBuiltIn: "" }, page, pageSize: PAGE }));
      const rows = rowsOf(res, ["data", "items", "permissions"]);
      for (const r of rows) {
        const id = idOf(r);
        const name = text(r.name);
        if (!id || !name) continue;
        out.push({ id, name, resource: text(r.resource), description: text(r.description), roles: strings(r.roles) });
      }
      const total = isRec(res) && typeof res.totalCount === "number" ? res.totalCount : null;
      if (rows.length < PAGE || (total !== null && (page + 1) * PAGE >= total)) break;
    }
    return out;
  }

  function permissions(fresh = false): Promise<IamPermission[]> {
    const hit = cache.perms;
    if (!fresh && hit && now() - hit.at < cacheMs) return hit.rows;
    const rows = fetchPermissions();
    cache.perms = { at: now(), rows };
    rows.catch(() => {
      if (cache.perms?.rows === rows) cache.perms = null;
    });
    return rows;
  }

  const forget = (): void => {
    cache.perms = null;
  };

  function permissionsOfRole(all: readonly IamPermission[], slug: string): string[] {
    return uniq(all.filter((p) => p.roles.includes(slug)).map((p) => p.name));
  }

  async function ensurePermissions(keys: readonly string[], describe?: (key: string) => string): Promise<{ created: string[] }> {
    const wanted = uniq(keys.filter(Boolean));
    if (wanted.length === 0) return { created: [] };
    const have = new Set((await permissions()).map((p) => p.name));
    const missing = wanted.filter((k) => !have.has(k));
    for (const name of missing) {
      await call((iam) =>
        iam.permissions.create({
          name,
          resource: iamResourceOf(name),
          resourceGroup: IAM_RESOURCE,
          // IAM refuses a permission without a type; 1 is the type of every permission IAM ships.
          type: 1,
          description: (describe?.(name) ?? name).slice(0, 300),
          tags: [IAM_RESOURCE],
          isBuiltIn: false,
        }),
      );
    }
    if (missing.length) forget();
    return { created: missing };
  }

  async function findRole(slug: string): Promise<Rec | null> {
    const res = await call((iam) => iam.roles.list({ filter: { search: "", slugs: [slug] }, page: 0, pageSize: 10 }));
    return rowsOf(res, ["data", "items", "roles"]).find((r) => text(r.slug) === slug) ?? null;
  }

  const roleOf = (r: Rec, all: readonly IamPermission[]): IamRole => ({
    id: idOf(r),
    slug: text(r.slug),
    name: text(r.name),
    description: text(r.description),
    permissions: permissionsOfRole(all, text(r.slug)),
  });

  async function setRolePermissions(slug: string, wanted: readonly string[]): Promise<void> {
    await ensurePermissions(wanted);
    const all = await permissions();
    const current = new Set(permissionsOfRole(all, slug));
    const want = new Set(wanted);
    const idsOf = (names: string[]) => names.map((n) => all.find((p) => p.name === n)?.id).filter((x): x is string => !!x);
    const add = idsOf([...want].filter((n) => !current.has(n)));
    // Only Factory permissions are ever taken off a role; anything else on it was put there by someone else.
    const remove = idsOf([...current].filter((n) => !want.has(n) && all.some((p) => p.name === n && isFactoryResource(p.resource))));
    if (add.length === 0 && remove.length === 0) return;
    await call((iam) =>
      iam.roles.assignPermissions({ slug, ...(add.length ? { addPermissions: add } : {}), ...(remove.length ? { removePermissions: remove } : {}) }),
    );
    forget();
  }

  async function accessOf(userId: string, organizationId?: string): Promise<{ roles: string[]; permissions: string[] }> {
    const res = await call((iam) => iam.users.get(userId, organizationId ? { organizationId } : {}));
    const data = dataOf(res);
    // An answer for another organization than the one asked (a fallback) grants nothing here.
    const answeredOrg = text(data.organizationId);
    if (organizationId && answeredOrg && answeredOrg !== organizationId && !isRec(data.roles)) return { roles: [], permissions: [] };
    const key = organizationId ?? IAM_DEFAULT_ORG;
    return { roles: listFor(data.roles, key), permissions: listFor(data.permissions, key) };
  }

  async function resolved(set: { roles: string[]; permissions: string[] }): Promise<IamAccessSet> {
    if (set.roles.length === 0) return { roles: [], permissions: uniq(set.permissions) };
    const all = await permissions();
    const viaRoles = all.filter((p) => p.roles.some((r) => set.roles.includes(r))).map((p) => p.name);
    return { roles: uniq(set.roles), permissions: uniq([...set.permissions, ...viaRoles]) };
  }

  async function writeAccess(userId: string, organizationId: string | undefined, next: { roles?: string[]; permissions?: string[] }): Promise<void> {
    await call((iam) =>
      iam.users.updateAccess({
        userId,
        ...(organizationId ? { organizationId } : {}),
        ...(next.roles ? { roles: next.roles } : {}),
        ...(next.permissions ? { permissions: next.permissions } : {}),
      }),
    );
  }

  async function listOrganizations(): Promise<IamOrganization[]> {
    const out: IamOrganization[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await call((iam) => iam.organizations.list({ Page: page, PageSize: PAGE }));
      const rows = rowsOf(res, ["organizations", "data", "items"]);
      for (const r of rows) {
        const id = idOf(r);
        if (id) out.push({ id, name: text(r.name), description: text(r.description) });
      }
      const total = isRec(res) && typeof res.totalCount === "number" ? res.totalCount : null;
      if (rows.length < PAGE || (total !== null && (page + 1) * PAGE >= total)) break;
    }
    return out;
  }

  return {
    listPermissions: () => permissions(),
    ensurePermissions,

    async listRoles() {
      const all = await permissions();
      const out: IamRole[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await call((iam) => iam.roles.list({ filter: { search: "" }, page, pageSize: PAGE }));
        const rows = rowsOf(res, ["data", "items", "roles"]);
        for (const r of rows) if (text(r.slug)) out.push(roleOf(r, all));
        const total = isRec(res) && typeof res.totalCount === "number" ? res.totalCount : null;
        if (rows.length < PAGE || (total !== null && (page + 1) * PAGE >= total)) break;
      }
      return out;
    },

    async getRole(slug) {
      const row = await findRole(slug);
      return row ? roleOf(row, await permissions()) : null;
    },

    async upsertRole(r) {
      const slug = r.slug.trim();
      if (!/^mf-[a-z0-9-]{1,96}$/.test(slug)) throw new IamAdminError("iam.forbidden");
      const name = r.name.trim().slice(0, 120) || slug;
      const description = (r.description ?? "").slice(0, 300);
      const current = await findRole(slug);
      if (!current) {
        await call((iam) => iam.roles.create({ name, slug, description }));
      } else if (text(current.name) !== name || text(current.description) !== description) {
        // POST /roles/update sets every field it is sent: carry what the role has today.
        await call((iam) =>
          iam.roles.update({
            itemId: idOf(current),
            name,
            description,
            ...(text(current.parentRoleSlug) ? { parentRoleSlug: text(current.parentRoleSlug) } : {}),
            canCreateOwn: current.canCreateOwn === true,
          }),
        );
      }
      await setRolePermissions(slug, uniq([...r.permissions]));
      const after = (await findRole(slug)) ?? { slug, name, description };
      return roleOf(after, await permissions());
    },

    async deleteRole(slug) {
      const current = await findRole(slug);
      if (!current) return;
      await setRolePermissions(slug, []);
      const name = text(current.name);
      if (!name.startsWith("[removed] ")) {
        await call((iam) =>
          iam.roles.update({
            itemId: idOf(current),
            name: `[removed] ${name}`.slice(0, 120),
            description: text(current.description),
            ...(text(current.parentRoleSlug) ? { parentRoleSlug: text(current.parentRoleSlug) } : {}),
            canCreateOwn: current.canCreateOwn === true,
          }),
        );
      }
    },

    listOrganizations,

    async ensureOrganization(w) {
      const marker = workspaceMarker(w.workspaceId);
      if (w.iamOrganizationId) {
        try {
          const res = await call((iam) => iam.organizations.get(w.iamOrganizationId as string));
          if (idOf(dataOf(res)) || isRec(res)) return w.iamOrganizationId;
        } catch (e) {
          if (!isIamAdminError(e) || e.code !== "iam.notFound") throw e;
        }
      }
      const found = (await listOrganizations()).find((org) => org.description.includes(marker));
      if (found) return found.id;
      const name = w.name.trim().slice(0, 100) || "Organization";
      const res = await call((iam) => iam.organizations.create({ name, description: `MADP Factory organization ${marker}` }));
      const made = idOf(dataOf(res)) || (isRec(res) ? text(res.itemId) || text(res.organizationId) : "");
      if (made) return made;
      const again = (await listOrganizations()).find((org) => org.description.includes(marker));
      if (!again) throw new IamAdminError("iam.unavailable");
      return again.id;
    },

    async userAccess(userId, opts) {
      const orgIds = uniq((opts?.organizationIds ?? []).filter(Boolean));
      // IAM refuses a per-organization read for an organization the person is not in, so only the
      // organizations their own record names are asked; every other one grants nothing.
      const base = dataOf(await call((iam) => iam.users.get(userId, {})));
      const listed = Array.isArray(base.organizationIds) ? new Set(strings(base.organizationIds)) : null;
      const platform = await resolved({ roles: listFor(base.roles, IAM_DEFAULT_ORG), permissions: listFor(base.permissions, IAM_DEFAULT_ORG) });
      const none: IamAccessSet = { roles: [], permissions: [] };
      const orgs: Record<string, IamAccessSet> = {};
      await Promise.all(
        orgIds.map(async (id) => {
          if (listed && !listed.has(id)) {
            orgs[id] = none;
            return;
          }
          try {
            orgs[id] = await resolved(await accessOf(userId, id));
          } catch (e) {
            // Without the record's list (older IAM answers), a refusal for one organization means "not a member there".
            if (!listed && e instanceof IamAdminError && (e.code === "iam.forbidden" || e.code === "iam.notFound")) orgs[id] = none;
            else throw e;
          }
        }),
      );
      return { platform, orgs };
    },

    async grant(userId, g) {
      const roles = uniq([...(g.roles ?? [])]);
      const perms = uniq([...(g.permissions ?? [])]);
      if (roles.length === 0 && perms.length === 0) return;
      const current = await accessOf(userId, g.organizationId);
      const nextRoles = uniq([...current.roles, ...roles]);
      const nextPerms = uniq([...current.permissions, ...perms]);
      const changeRoles = nextRoles.length !== current.roles.length;
      const changePerms = nextPerms.length !== current.permissions.length;
      if (!changeRoles && !changePerms) return;
      await writeAccess(userId, g.organizationId, { ...(changeRoles ? { roles: nextRoles } : {}), ...(changePerms ? { permissions: nextPerms } : {}) });
    },

    async revoke(userId, g) {
      const roles = new Set(g.roles ?? []);
      const perms = new Set(g.permissions ?? []);
      const current = await accessOf(userId, g.organizationId);
      const nextRoles = current.roles.filter((r) => !roles.has(r));
      const nextPerms = current.permissions.filter((p) => !perms.has(p));
      const changeRoles = nextRoles.length !== current.roles.length;
      const changePerms = nextPerms.length !== current.permissions.length;
      if (!changeRoles && !changePerms) return;
      // IAM keeps a list that is sent empty: an emptied list means removing the access as a whole.
      const emptied = (changeRoles && nextRoles.length === 0) || (changePerms && nextPerms.length === 0);
      if (!emptied) {
        await writeAccess(userId, g.organizationId, { ...(changeRoles ? { roles: nextRoles } : {}), ...(changePerms ? { permissions: nextPerms } : {}) });
        return;
      }
      // Platform access is never revoked as a whole (the person would lose the base user role and could not sign in).
      if (!g.organizationId) throw new IamAdminError("iam.forbidden");
      await call((iam) => iam.users.revokeAccess({ userId, organizationId: g.organizationId }));
      if (nextRoles.length || nextPerms.length) {
        await writeAccess(userId, g.organizationId, { ...(nextRoles.length ? { roles: nextRoles } : {}), ...(nextPerms.length ? { permissions: nextPerms } : {}) });
      }
    },
  };
}
