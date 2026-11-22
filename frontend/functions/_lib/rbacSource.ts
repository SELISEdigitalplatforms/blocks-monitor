// Where roles and permissions come from: PlatformSetting `rbac.source` = "factory" (default: the Factory's own
// PlatformRole / PlatformRoleAssignment / WorkspaceRole / Membership rows) or "iam" (Blocks IAM decides; the Factory rows
// are kept in step by the ops so switching back is safe). This module is the one place that turns the switch into what
// a caller may do: the router and openOp (functions/workspace/ops/_shared/core.ts) both ask the view built here.
//
// Super admin in "iam" mode: the IAM role mf-platform-super-admin, OR today's IAM role mf-super-admin on the caller's
// verified token. The second is the no-lockout safety: whoever is super admin by today's setup stays super admin in
// both modes, needs no IAM read to be so (an IAM outage cannot lock them out) and can always switch the source back.
//
// Caching (per process): the source 5 s; a person's IAM access 60 s per user (per organization within it); a
// workspace's IAM organization id 60 s. Any role or access change made through the Factory drops the affected entries
// at once in this process and moves the setting's epoch, which drops every older entry in other processes within the
// source cache time.
import {
  PLATFORM_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  expandPlatformPermissions,
  type PlatformPermission,
  type WorkspacePermission,
} from "../../src/domain/rbac";
import { OpError } from "./errors";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import {
  BUILT_IN_ORG_ROLE_KEYS,
  IAM_PLATFORM_SUPER_ADMIN,
  PLATFORM_ADMIN_KEY,
  isIamAdminError,
  orgRoleKeyOf,
  platformRoleKeyOf,
  type IamAccessSet,
  type IamAdminApi,
} from "./iamAdmin";

export const RBAC_SOURCE_KEY = "rbac.source";
export type RbacSource = "factory" | "iam";
export const RBAC_SOURCES: readonly RbacSource[] = ["factory", "iam"];
export const isRbacSource = (v: unknown): v is RbacSource => v === "factory" || v === "iam";
/** Today's super admin role on the verified token: super admin in both modes (the no-lockout safety). */
export const SAFETY_SUPER_ADMIN_ROLE = "mf-super-admin";

export const SOURCE_TTL_MS = 5_000;
export const ACCESS_TTL_MS = 60_000;

export interface RbacSetting {
  source: RbacSource;
  /** Moves on every role or access change made through the Factory; cache entries older than it are dropped. */
  epoch: number;
  /** The PlatformSetting row, when there is one. */
  itemId: string | null;
}

/**
 * The setting row: ValueJson is the JSON string `"factory"` or `"iam"` (anything else, or no row, is "factory"); the
 * epoch is kept in the row's Values (`["<epoch>"]`), so the source's own writers never have to know about it.
 */
export function rbacSettingOf(valueJson: unknown, itemId: string | null = null, values?: unknown): RbacSetting {
  let v: unknown = valueJson;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      /* a bare word */
    }
  }
  const first = Array.isArray(values) ? Number(values[0]) : NaN;
  const epoch = Number.isFinite(first) ? first : 0;
  return { source: isRbacSource(v) ? v : "factory", epoch, itemId };
}

/** The ValueJson of a source. */
export const rbacSourceJson = (source: RbacSource): string => JSON.stringify(source);

// ---------------------------------------------------------------- caches

interface UserEntry {
  at: number;
  epoch: number;
  platform: Promise<IamAccessSet> | null;
  orgs: Map<string, Promise<IamAccessSet>>;
}

export interface RbacCaches {
  setting: { at: number; value: Promise<RbacSetting> } | null;
  users: Map<string, UserEntry>;
  orgOf: Map<string, { at: number; orgId: string | null }>;
}

export function createRbacCaches(): RbacCaches {
  return { setting: null, users: new Map(), orgOf: new Map() };
}

/** The process-wide caches (Host A: one process serves every function; Host B: one per function sandbox). */
export const processRbacCaches: RbacCaches = createRbacCaches();

/** Drops cached access: of these people, or of everyone. The source is read again as well. */
export function invalidateRbac(caches: RbacCaches, o: { userIds?: readonly string[] } = {}): void {
  caches.setting = null;
  if (o.userIds) for (const id of o.userIds) caches.users.delete(id);
  else caches.users.clear();
}

/** Remembers a workspace's IAM organization (set right after the Factory stores it). */
export function rememberWorkspaceOrg(caches: RbacCaches, workspaceId: string, orgId: string | null, now = Date.now()): void {
  caches.orgOf.set(workspaceId, { at: now, orgId });
}

const SETTING_FIELDS = ["ItemId", "Key", "ValueJson", "Values"] as const;

/** The switch, cached SOURCE_TTL_MS. A read failure counts as "factory" only when no row could be read at all. */
export function readRbacSetting(raw: Pick<RawGateway, "find">, caches: RbacCaches, now: number): Promise<RbacSetting> {
  const hit = caches.setting;
  if (hit && now - hit.at < SOURCE_TTL_MS) return hit.value;
  const value = raw
    .find("PlatformSetting", { where: f.eq("Key", RBAC_SOURCE_KEY), fields: [...SETTING_FIELDS], page: 1, pageSize: 1 })
    .then((res) => {
      const row = (res?.items ?? [])[0] as Row | undefined;
      return rbacSettingOf(row?.ValueJson, typeof row?.ItemId === "string" ? row.ItemId : null, row?.Values);
    });
  caches.setting = { at: now, value };
  value.catch(() => {
    if (caches.setting?.value === value) caches.setting = null;
  });
  return value;
}

// ---------------------------------------------------------------- the view

export interface IamWorkspaceAccess {
  /** The Factory role key IAM gives the person in this organization (owner > admin > member > viewer > custom). */
  roleKey: string | null;
  permissions: WorkspacePermission[];
  organizationId: string;
}

export interface RbacView {
  source: RbacSource;
  /** The effective super admin flag (both modes). */
  isSuperAdmin: boolean;
  /** "iam" mode: the platform access IAM gives; null in "factory" mode (the Factory rows decide). */
  platform: { permissions: PlatformPermission[]; roleKeys: string[] } | null;
  /**
   * "iam" mode: the person's access to this workspace's IAM organization. null when the source is "factory" or the
   * workspace has no IAM organization yet (not migrated: the Factory rows decide for that workspace).
   */
  workspace(workspaceId: string): Promise<IamWorkspaceAccess | null>;
}

export interface RbacHandle {
  view(): Promise<RbacView>;
  /** Drops the cached access of these people (or of everyone) and moves the epoch so other processes drop theirs. */
  changed(o?: { userIds?: readonly string[] }): Promise<void>;
  /** Remembers a workspace's IAM organization the op just stored. */
  rememberOrg(workspaceId: string, orgId: string): void;
  /** The IAM admin module (service identity); null when the host has none. */
  iam: IamAdminApi | null;
}

const ROLE_RANK = [...BUILT_IN_ORG_ROLE_KEYS];
const rank = (k: string): number => {
  const i = ROLE_RANK.indexOf(k as (typeof ROLE_RANK)[number]);
  return i === -1 ? ROLE_RANK.length : i;
};

function unavailable(e: unknown): never {
  if (e instanceof OpError) throw e;
  const code = isIamAdminError(e) ? e.code : "iam.unavailable";
  throw new OpError(code === "iam.forbidden" ? "forbidden" : "unavailable", code);
}

/** What the platform access from IAM grants (the super admin and platform-admin hold every platform permission). */
export function platformFromIam(set: IamAccessSet, isSuperAdmin: boolean): { permissions: PlatformPermission[]; roleKeys: string[] } {
  const roleKeys = set.roles.map(platformRoleKeyOf).filter((k): k is string => k !== null);
  if (isSuperAdmin || roleKeys.includes(PLATFORM_ADMIN_KEY)) return { permissions: [...PLATFORM_PERMISSIONS], roleKeys };
  return { permissions: expandPlatformPermissions(set.permissions), roleKeys };
}

/** What an organization's IAM access grants in the workspace. */
export function workspaceFromIam(set: IamAccessSet, workspaceId: string, organizationId: string): IamWorkspaceAccess {
  const keys = set.roles.map((s) => orgRoleKeyOf(s, workspaceId)).filter((k): k is string => k !== null);
  const roleKey = keys.length ? [...keys].sort((a, b) => rank(a) - rank(b))[0] : null;
  const held = new Set(set.permissions);
  return { roleKey, permissions: roleKey ? WORKSPACE_PERMISSIONS.filter((p) => held.has(p)) : [], organizationId };
}

export function createRbacHandle(o: {
  raw: RawGateway;
  caches: RbacCaches;
  iam: IamAdminApi | null;
  caller: { userId: string; roles: readonly string[] };
  now: () => number;
}): RbacHandle {
  const { raw, caches, iam, caller, now } = o;
  const safety = caller.roles.includes(SAFETY_SUPER_ADMIN_ROLE);
  let memo: Promise<RbacView> | null = null;

  const entryFor = (userId: string, epoch: number): UserEntry => {
    const hit = caches.users.get(userId);
    if (hit && hit.epoch === epoch && now() - hit.at < ACCESS_TTL_MS) return hit;
    const fresh: UserEntry = { at: now(), epoch, platform: null, orgs: new Map() };
    caches.users.set(userId, fresh);
    return fresh;
  };
  const kept = <T>(p: Promise<T>, drop: () => void): Promise<T> => {
    p.catch(drop);
    return p;
  };

  async function orgIdOf(workspaceId: string): Promise<string | null> {
    const hit = caches.orgOf.get(workspaceId);
    if (hit && now() - hit.at < ACCESS_TTL_MS) return hit.orgId;
    let orgId: string | null = null;
    try {
      const row = await raw.get("Workspace", workspaceId, ["ItemId", "IamOrganizationId"]);
      orgId = typeof row?.IamOrganizationId === "string" && row.IamOrganizationId ? row.IamOrganizationId : null;
    } catch {
      // A tenant without the field (not migrated): no organization, the Factory rows decide for this workspace.
      orgId = null;
    }
    caches.orgOf.set(workspaceId, { at: now(), orgId });
    return orgId;
  }

  async function build(): Promise<RbacView> {
    const setting = await readRbacSetting(raw, caches, now());
    if (setting.source !== "iam") {
      return { source: "factory", isSuperAdmin: safety, platform: null, workspace: async () => null };
    }
    if (!iam) throw new OpError("unavailable", "iam.unavailable");
    const entry = entryFor(caller.userId, setting.epoch);
    let platform: { permissions: PlatformPermission[]; roleKeys: string[] };
    let isSuperAdmin = safety;
    if (safety) {
      // The safety super admin needs no IAM read: an IAM outage never locks them out.
      platform = { permissions: [...PLATFORM_PERMISSIONS], roleKeys: [] };
    } else {
      entry.platform ??= kept(
        iam.userAccess(caller.userId).then((a) => a.platform),
        () => {
          entry.platform = null;
        },
      );
      let set: IamAccessSet;
      try {
        set = await entry.platform;
      } catch (e) {
        unavailable(e);
      }
      isSuperAdmin = set.roles.includes(IAM_PLATFORM_SUPER_ADMIN);
      platform = platformFromIam(set, isSuperAdmin);
    }
    return {
      source: "iam",
      isSuperAdmin,
      platform,
      async workspace(workspaceId) {
        const orgId = await orgIdOf(workspaceId);
        if (!orgId) return null;
        let p = entry.orgs.get(orgId);
        if (!p) {
          p = kept(
            iam.userAccess(caller.userId, { organizationIds: [orgId] }).then((a) => a.orgs[orgId] ?? { roles: [], permissions: [] }),
            () => entry.orgs.delete(orgId),
          );
          entry.orgs.set(orgId, p);
        }
        try {
          return workspaceFromIam(await p, workspaceId, orgId);
        } catch (e) {
          unavailable(e);
        }
      },
    };
  }

  return {
    iam,
    view() {
      memo ??= build().catch((e) => {
        memo = null;
        throw e;
      });
      return memo;
    },
    async changed(opts = {}) {
      invalidateRbac(caches, opts);
      memo = null;
      // Other processes: move the epoch on the setting row (only in "iam" mode, where the row exists).
      let setting: RbacSetting;
      try {
        setting = await readRbacSetting(raw, caches, now());
      } catch {
        return;
      }
      if (setting.source !== "iam" || !setting.itemId) return;
      const epoch = Math.max(now(), setting.epoch + 1);
      try {
        await raw.update("PlatformSetting", setting.itemId, { Values: [String(epoch)] });
      } catch {
        // The in-process caches are already dropped; other processes catch up within ACCESS_TTL_MS.
      }
      caches.setting = null;
    },
    rememberOrg(workspaceId, orgId) {
      rememberWorkspaceOrg(caches, workspaceId, orgId, now());
    },
  };
}
