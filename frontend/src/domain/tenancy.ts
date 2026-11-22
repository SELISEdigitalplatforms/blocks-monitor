/**
 * Tenancy rules: workspace access, last-owner, outranking, invitations and
 * reader ids. Pure: shared with the server functions, so no React, DOM,
 * store or SDK imports.
 */
import {
  WORKSPACE_PERMISSIONS,
  type PlatformPermission,
  type WorkspacePermission,
} from "./rbac";
import {
  PLATFORM_ADMIN_ROLE,
  platformPermissionsFor,
  workspacePermissionsFor,
  type RoleCheck,
  type RoleDef,
} from "./roles";

/** The IAM role of the super admin (top of everything). */
export const IAM_SUPER_ADMIN_ROLE = "mf-super-admin";

export const MEMBERSHIP_STATUSES = ["pending-account", "invited", "active", "suspended", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const WORKSPACE_STATUSES = ["active", "suspended", "archived"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const MAX_WORKSPACE_NAME = 60;
export const MAX_DISPLAY_NAME = 120;
export const MAX_ACCESS_REQUEST_RECIPIENTS = 50;

/** What a platform manager may do inside a workspace they are not a member of. */
export const PLATFORM_MANAGER_WORKSPACE_PERMISSIONS: readonly WorkspacePermission[] = [
  "workspace.manage",
  "members.manage",
  "roles.manage",
  "view",
];

export const TENANCY_MESSAGE_KEYS = [
  "tenancy.signInRequired",
  "tenancy.lastOwner",
  "tenancy.notHeld",
  "tenancy.outranked",
  "tenancy.domainNotAllowed",
  "tenancy.wouldLockOut",
  "tenancy.noDomains",
  "tenancy.roleInUse",
  "tenancy.roleLimit",
  "tenancy.roleKeyTaken",
  "tenancy.unknownRole",
  "tenancy.builtInRole",
  "tenancy.superAdminOnly",
  "tenancy.selfChange",
  "tenancy.selfDeactivate",
  "tenancy.alreadyMember",
  "tenancy.inviteeInactive",
  "tenancy.membershipSuspended",
  "tenancy.targetNoAccount",
  "tenancy.invalidName",
  "tenancy.invalidWorkspaceName",
  "tenancy.workspaceRenamed",
  "tenancy.invalidEmail",
  "tenancy.invalidArgs",
  "fn.workspaceInactive",
] as const;
export type TenancyMessageKey = (typeof TENANCY_MESSAGE_KEYS)[number];

export type TenancyErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "rate_limited"
  | "too_large";

export type TenancyCheck =
  | { ok: true }
  | { ok: false; code: TenancyErrorCode; messageKey: TenancyMessageKey; params?: Record<string, unknown> };

const OK: TenancyCheck = { ok: true };

function refuse(
  code: TenancyErrorCode,
  messageKey: TenancyMessageKey,
  params?: Record<string, unknown>,
): TenancyCheck {
  return params ? { ok: false, code, messageKey, params } : { ok: false, code, messageKey };
}

/** Maps a roles.ts check onto the function error vocabulary. */
export function fromRoleCheck(c: RoleCheck): TenancyCheck {
  if (c.ok) return OK;
  switch (c.code) {
    case "limit-reached":
      return refuse("limit_reached", "tenancy.roleLimit");
    case "key-taken":
      return refuse("conflict", "tenancy.roleKeyTaken");
    case "not-held":
      return refuse("forbidden", "tenancy.notHeld", { permissions: c.permissions ?? [] });
    case "built-in":
      return refuse("invalid_input", "tenancy.builtInRole");
    case "super-admin-only":
      return refuse("forbidden", "tenancy.superAdminOnly");
    case "in-use":
      return refuse("conflict", "tenancy.roleInUse");
    case "last-admin":
      return refuse("conflict", "tenancy.lastOwner");
    case "self":
      return refuse("forbidden", "tenancy.selfChange");
    default:
      return refuse("invalid_input", "tenancy.invalidArgs", {
        reason: c.code,
        ...(c.permissions ? { permissions: c.permissions } : {}),
      });
  }
}

export interface WorkspaceAccess {
  permissions: WorkspacePermission[];
  viaPlatform: boolean;
  roleKey: string | null;
}

/** What a person may do in one workspace. */
export function resolveWorkspaceAccess(i: {
  isSuperAdmin: boolean;
  membership: { roleKey: string; status: string } | null;
  customRoles: readonly RoleDef[];
  platformPermissions: readonly string[];
}): WorkspaceAccess {
  const active = i.membership && i.membership.status === "active" ? i.membership : null;
  if (i.isSuperAdmin) {
    return {
      permissions: [...WORKSPACE_PERMISSIONS],
      viaPlatform: !active,
      roleKey: active ? active.roleKey : "owner",
    };
  }
  if (active) {
    return {
      permissions: workspacePermissionsFor({ roleKey: active.roleKey, customRoles: i.customRoles }),
      viaPlatform: false,
      roleKey: active.roleKey,
    };
  }
  if (i.platformPermissions.includes("platform.workspaces.manage")) {
    return { permissions: [...PLATFORM_MANAGER_WORKSPACE_PERMISSIONS], viaPlatform: true, roleKey: null };
  }
  return { permissions: [], viaPlatform: false, roleKey: null };
}

/** What a person may do on the platform, through active assignments. */
export function resolvePlatformAccess(i: {
  isSuperAdmin: boolean;
  assignments: readonly { roleKey: string; status: string }[];
  platformRoles: readonly RoleDef[];
}): { permissions: PlatformPermission[]; roleKeys: string[] } {
  const roleKeys = [...new Set(i.assignments.filter((a) => a.status === "active").map((a) => a.roleKey))];
  const permissions = platformPermissionsFor({
    isSuperAdmin: i.isSuperAdmin,
    roleKeys,
    roles: [PLATFORM_ADMIN_ROLE, ...i.platformRoles],
  });
  return { permissions, roleKeys };
}

/** The permissions a person may hand on: only the ones they hold; the super admin grants every one. */
export function granterPermissions(a: WorkspaceAccess & { isSuperAdmin: boolean }): WorkspacePermission[] {
  return a.isSuperAdmin ? [...WORKSPACE_PERMISSIONS] : [...a.permissions];
}

/** Never remove, demote or suspend the last active owner (an owner leaving included). */
export function checkLastOwner(i: {
  target: { membershipId: string; roleKey: string; status: string };
  next: { kind: "role"; roleKey: string } | { kind: "remove" } | { kind: "suspend" };
  activeOwners: readonly { membershipId: string }[];
}): TenancyCheck {
  if (i.target.roleKey !== "owner" || i.target.status !== "active") return OK;
  if (i.next.kind === "role" && i.next.roleKey === "owner") return OK;
  const others = i.activeOwners.filter((o) => o.membershipId !== i.target.membershipId);
  return others.length > 0 ? OK : refuse("conflict", "tenancy.lastOwner");
}

/** Nobody changes or removes someone who holds a permission they lack. */
export function checkOutranks(i: {
  granterPermissions: readonly string[];
  targetPermissions: readonly string[];
  exempt: boolean;
}): TenancyCheck {
  if (i.exempt) return OK;
  const missing = i.targetPermissions.filter((p) => !i.granterPermissions.includes(p));
  return missing.length ? refuse("forbidden", "tenancy.outranked", { permissions: missing }) : OK;
}

export type InvitePath = "invite" | "pending-account" | "reinvite-invited" | "reinvite-pending";
export type InviteRefusal = "already_member" | "invitee_inactive" | "suspended";

export function invitePath(i: {
  existingMembership: { status: string } | null;
  account: { status: string } | null;
}): { ok: true; path: InvitePath } | { ok: false; reason: InviteRefusal } {
  const existing = i.existingMembership?.status ?? null;
  if (existing === "invited" || existing === "active" || existing === "pending-account") {
    return { ok: false, reason: "already_member" };
  }
  if (existing === "suspended") return { ok: false, reason: "suspended" };
  if (i.account && i.account.status === "deactivated") return { ok: false, reason: "invitee_inactive" };
  if (existing === "removed") {
    return { ok: true, path: i.account ? "reinvite-invited" : "reinvite-pending" };
  }
  return { ok: true, path: i.account ? "invite" : "pending-account" };
}

export function invitePathRefusal(reason: InviteRefusal): TenancyCheck {
  switch (reason) {
    case "already_member":
      return refuse("conflict", "tenancy.alreadyMember");
    case "invitee_inactive":
      return refuse("invalid_input", "tenancy.inviteeInactive");
    default:
      return refuse("conflict", "tenancy.membershipSuspended");
  }
}

/** The user ids that may read a workspace's rows. */
export function readerIdsFor(i: {
  workspaceStatus: string;
  memberships: readonly { userId: string; status: string }[];
  deactivatedUserIds: readonly string[];
}): string[] {
  if (i.workspaceStatus !== "active") return [];
  const off = new Set(i.deactivatedUserIds);
  const ids = new Set<string>();
  for (const m of i.memberships) {
    if (m.status === "active" && m.userId && !off.has(m.userId)) ids.add(m.userId);
  }
  return [...ids].sort();
}

export function workspaceWritable(status: string | null | undefined): boolean {
  return status === "active";
}

/** A C0 or C1 control character (tab, line breaks, escape, ...). */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARACTERS = new RegExp(CONTROL_CHARACTER.source, "g");

/** Trims and removes control characters; never truncates. */
export function cleanText(raw: unknown, _max?: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARACTERS, "").trim();
}

export const MIN_WORKSPACE_NAME = 2;

/** Why a new workspace name is refused (the `rule` param of `tenancy.invalidWorkspaceName`). */
export type WorkspaceNameRule = "type" | "control" | "min" | "max";

export type WorkspaceRenameCheck =
  | { ok: true; value: string }
  | { ok: false; code: "invalid_input"; messageKey: "tenancy.invalidWorkspaceName"; params: { field: "name"; rule: WorkspaceNameRule } };

/**
 * The name a workspace is renamed to: trimmed, MIN_WORKSPACE_NAME to MAX_WORKSPACE_NAME characters, and no control
 * characters. Unlike creation (which strips them silently) a rename refuses them, so the admin sees exactly what is saved.
 * Shared by the rename form and the workspace.rename op.
 */
export function checkWorkspaceRename(raw: unknown): WorkspaceRenameCheck {
  const no = (rule: WorkspaceNameRule): WorkspaceRenameCheck => ({
    ok: false, code: "invalid_input", messageKey: "tenancy.invalidWorkspaceName", params: { field: "name", rule },
  });
  if (typeof raw !== "string") return no("type");
  const value = raw.trim();
  if (CONTROL_CHARACTER.test(value)) return no("control");
  if (value.length < MIN_WORKSPACE_NAME) return no("min");
  if (value.length > MAX_WORKSPACE_NAME) return no("max");
  return { ok: true, value };
}

export function checkWorkspaceName(raw: unknown): { ok: true; value: string } | (TenancyCheck & { ok: false }) {
  const value = cleanText(raw, MAX_WORKSPACE_NAME);
  if (value.length < 1 || value.length > MAX_WORKSPACE_NAME) {
    return refuse("invalid_input", "tenancy.invalidName") as TenancyCheck & { ok: false };
  }
  return { ok: true, value };
}

export function displayNameOf(raw: unknown): string {
  return cleanText(raw, MAX_DISPLAY_NAME).slice(0, MAX_DISPLAY_NAME).trim();
}

