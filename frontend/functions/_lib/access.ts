import {
  PLATFORM_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  expandPlatformPermissions,
  isWorkspacePermission,
  type PlatformPermission,
  type WorkspacePermission,
} from "../../src/domain/rbac";
import {
  PLATFORM_ADMIN_ROLE,
  platformPermissionsFor,
  workspacePermissionsFor,
  type RoleDef,
} from "../../src/domain/roles";
import type { Caller } from "./caller";
import { OpError } from "./errors";
import { LIB_FIELDS } from "./fields";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import type { IamWorkspaceAccess, RbacHandle, RbacView } from "./rbacSource";

/** What one parallel round trip learns about a workspace. */
export interface WorkspaceBundle {
  workspace: Row | null;
  /** The caller's active membership here. */
  membership: Row | null;
  /** WorkspaceRole rows of the workspace. */
  roles: Row[];
  /** Active member user ids; loaded for commands only. */
  activeMemberUserIds: string[] | null;
}

/** Rows of a find answer, whether the gateway returns an array or a page object. */
function rowsOf(res: unknown): Row[] {
  if (Array.isArray(res)) return res as Row[];
  const items = (res as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Row[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** One parallel round trip: workspace, caller's membership, roles, and (commands) active members. */
export async function loadWorkspaceBundle(
  raw: RawGateway,
  workspaceId: string,
  callerUserId: string,
  o: { command: boolean },
): Promise<WorkspaceBundle> {
  const [workspace, membership, roles, members] = await Promise.all([
    raw.find("Workspace", {
      where: f.eq("WorkspaceId", workspaceId),
      fields: LIB_FIELDS.Workspace,
      pageSize: 1,
    }),
    raw.find("Membership", {
      where: f.and(
        f.eq("WorkspaceId", workspaceId),
        f.eq("UserId", callerUserId),
        f.eq("Status", "active"),
      ),
      fields: LIB_FIELDS.Membership,
      pageSize: 1,
    }),
    raw.findAll("WorkspaceRole", {
      where: f.eq("WorkspaceId", workspaceId),
      fields: LIB_FIELDS.WorkspaceRole,
      max: 50,
    }),
    o.command
      ? raw.findAll("Membership", {
          where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("Status", "active")),
          fields: LIB_FIELDS.Membership,
          max: 5000,
        })
      : Promise.resolve(null),
  ]);
  return {
    workspace: rowsOf(workspace)[0] ?? null,
    membership: rowsOf(membership)[0] ?? null,
    roles: rowsOf(roles),
    activeMemberUserIds: members
      ? rowsOf(members)
          .map((r) => str(r.UserId))
          .filter(Boolean)
      : null,
  };
}

function toRoleDef(r: Row): RoleDef {
  return {
    key: str(r.Key),
    name: str(r.Name),
    description: str(r.Description),
    permissions: strings(r.Permissions),
    isBuiltIn: r.IsBuiltIn === true,
  };
}

/** The workspace permissions the caller holds here. The super admin counts as owner. */
export function workspacePermissionsOf(
  bundle: WorkspaceBundle,
  caller: Pick<Caller, "isSuperAdmin">,
): WorkspacePermission[] {
  return workspacePermissionsFor({
    roleKey: bundle.membership ? str(bundle.membership.RoleKey) : null,
    isSuperAdmin: caller.isSuperAdmin,
    customRoles: bundle.roles.map(toRoleDef),
  });
}

export interface AccessService {
  /** The caller's platform permissions; lazy and memoized. */
  platformPermissions(): Promise<PlatformPermission[]>;
  /** User ids whose active assignments grant the permission, sorted, at most `max` (50). */
  platformHolders(permission: PlatformPermission, o?: { max?: number }): Promise<string[]>;
}

export function createAccess(o: { raw: RawGateway; caller: Caller; rbac?: Pick<RbacHandle, "view"> | null }): AccessService {
  const { raw, caller } = o;
  let memo: Promise<PlatformPermission[]> | null = null;

  const load = async (): Promise<PlatformPermission[]> => {
    if (caller.isSuperAdmin) return [...PLATFORM_PERMISSIONS];
    // rbac.source "iam": IAM decides (functions/_lib/rbacSource.ts); "factory": the PlatformRoleAssignment rows below.
    const view = o.rbac ? await o.rbac.view() : null;
    if (view && view.source === "iam") return view.isSuperAdmin ? [...PLATFORM_PERMISSIONS] : [...(view.platform?.permissions ?? [])];
    // One round trip: the assignments and the roles (built-in and custom, as platformHolders reads them); the keys filter here.
    const [assigned, roleGroups] = await Promise.all([
      raw.findAll("PlatformRoleAssignment", {
        where: f.and(f.eq("UserId", caller.userId), f.eq("Status", "active")),
        fields: LIB_FIELDS.PlatformRoleAssignment,
        max: 200,
      }),
      Promise.all(
        [true, false].map((isBuiltIn) =>
          raw.findAll("PlatformRole", {
            where: f.eq("IsBuiltIn", isBuiltIn),
            fields: LIB_FIELDS.PlatformRole,
            max: 200,
          }),
        ),
      ),
    ]);
    const roleKeys = [...new Set(rowsOf(assigned).map((r) => str(r.RoleKey)).filter(Boolean))];
    if (roleKeys.length === 0) return [];
    const roles = roleGroups.flat().filter((r) => roleKeys.includes(str(r.Key)));
    return platformPermissionsFor({ isSuperAdmin: false, roleKeys, roles: roles.map(toRoleDef) });
  };

  return {
    platformPermissions() {
      memo ??= load().catch((e) => {
        memo = null;
        throw e;
      });
      return memo;
    },
    async platformHolders(permission, opts) {
      const max = Math.max(1, Math.min(opts?.max ?? 50, 500));
      // The filter builder has no "all rows" filter, so read built-in and custom roles separately.
      // The roles and the active assignments are read in one round trip; the role filter is applied here.
      const [roleGroups, assignments] = await Promise.all([
        Promise.all(
          [true, false].map((isBuiltIn) =>
            raw.findAll("PlatformRole", {
              where: f.eq("IsBuiltIn", isBuiltIn),
              fields: LIB_FIELDS.PlatformRole,
              max: 200,
            }),
          ),
        ),
        raw.findAll("PlatformRoleAssignment", {
          where: f.eq("Status", "active"),
          fields: LIB_FIELDS.PlatformRoleAssignment,
          max: 5000,
        }),
      ]);
      const keys = new Set<string>([PLATFORM_ADMIN_ROLE.key]);
      for (const r of roleGroups.flat()) {
        // A broad key counts for the keys it implies (platform.people.manage holders hold platform.users.manage).
        if (expandPlatformPermissions(strings(r.Permissions)).includes(permission)) keys.add(str(r.Key));
      }
      const ids = new Set(
        rowsOf(assignments)
          .filter((r) => keys.has(str(r.RoleKey)))
          .map((r) => str(r.UserId))
          .filter(Boolean),
      );
      return [...ids].sort().slice(0, max);
    },
  };
}

export type OpScope = "self" | "workspace" | "project" | "platform" | "engine";

/** What the authoriser needs to know about an op. */
export interface OpAccessMeta {
  op: string;
  kind: "command" | "view";
  scope: OpScope;
  /** A permission, "membership", or a list meaning "any of these". */
  permission?: string | readonly string[];
  platformOverride?: PlatformPermission;
}

export interface Authorisation {
  permissions: WorkspacePermission[];
  platformPermissions: PlatformPermission[] | null;
  viaPlatform: boolean;
}

function wanted(permission: OpAccessMeta["permission"]): string[] {
  if (permission === undefined) return [];
  return typeof permission === "string" ? [permission] : [...permission];
}

/**
 * The caller as rbac.source "iam" sees them: the super admin flag IAM gives (or today's safety role), and the IAM
 * super admin carried as today's role name so every older check of `roles` agrees. "factory": the caller unchanged.
 */
export function effectiveCaller(caller: Caller, view: RbacView | null): Caller {
  if (!view || view.source !== "iam") return caller;
  const roles = view.isSuperAdmin && !caller.roles.includes("mf-super-admin") ? [...caller.roles, "mf-super-admin"] : caller.roles;
  return { ...caller, roles, isSuperAdmin: view.isSuperAdmin };
}

/**
 * rbac.source "iam": the bundle as IAM sees it. The membership stays only when IAM gives the person a role in the
 * workspace's organization (its RoleKey becomes IAM's); both IAM and an active Membership row are needed (fail closed).
 */
export function iamBundle(bundle: WorkspaceBundle, iam: IamWorkspaceAccess | null): WorkspaceBundle {
  if (!iam) return bundle;
  const membership = bundle.membership && iam.roleKey ? { ...bundle.membership, RoleKey: iam.roleKey } : null;
  return { ...bundle, membership };
}

/** Decides whether the caller may run the op here. Throws not_member / forbidden / not_found. */
export async function authorise(a: {
  meta: OpAccessMeta;
  caller: Caller;
  bundle: WorkspaceBundle;
  access: AccessService;
  /** rbac.source "iam": the caller's permissions in this workspace from IAM (null: the Factory rows decide). */
  iamWorkspace?: IamWorkspaceAccess | null;
}): Promise<Authorisation> {
  const { meta, caller, access } = a;
  const bundle = iamBundle(a.bundle, a.iamWorkspace ?? null);
  const none: Authorisation = { permissions: [], platformPermissions: null, viaPlatform: false };

  if (meta.scope === "self") return none;

  if (meta.scope === "engine") {
    if (!caller.isEngine) throw new OpError("forbidden");
    return none;
  }

  const need = wanted(meta.permission);

  if (meta.scope === "platform") {
    const held = await access.platformPermissions();
    if (need.length === 0 || !need.some((p) => (held as readonly string[]).includes(p))) {
      throw new OpError("forbidden");
    }
    return { permissions: [], platformPermissions: held, viaPlatform: false };
  }

  // workspace / project scope
  let platformPermissions: PlatformPermission[] | null = null;
  const holdsOverride = async (): Promise<boolean> => {
    if (!meta.platformOverride) return false;
    platformPermissions = await access.platformPermissions();
    return platformPermissions.includes(meta.platformOverride);
  };

  const { workspace, membership } = bundle;
  if (!workspace) {
    if (caller.isSuperAdmin || (await holdsOverride())) throw new OpError("not_found");
    throw new OpError("not_member");
  }

  let permissions: WorkspacePermission[];
  let viaPlatform = false;

  if (membership) {
    permissions = a.iamWorkspace && !caller.isSuperAdmin ? [...a.iamWorkspace.permissions] : workspacePermissionsOf(bundle, caller);
    const ok =
      need.includes("membership") || need.some((p) => (permissions as string[]).includes(p));
    if (!ok) throw new OpError("forbidden");
  } else if (caller.isSuperAdmin) {
    permissions = [...WORKSPACE_PERMISSIONS];
    viaPlatform = true;
  } else if (await holdsOverride()) {
    permissions = need.filter(isWorkspacePermission);
    viaPlatform = true;
  } else {
    throw new OpError("not_member");
  }

  if (meta.kind === "command" && str(workspace.Status) !== "active") {
    throw new OpError("forbidden", "fn.workspaceInactive");
  }
  return { permissions, platformPermissions, viaPlatform };
}

/** A deactivated account is refused unless the op allows it; a missing row counts as active. */
export function checkAccount(account: Row | null, allowInactive: boolean): void {
  if (account && str(account.Status) === "deactivated" && !allowInactive) {
    throw new OpError("account_inactive");
  }
}
