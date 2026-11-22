/**
 * Custom workspace roles and platform role rules. Pure: shared with the
 * server functions, so no React, DOM, store or SDK imports.
 */
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PERMISSION_LABEL,
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_AREAS,
  ROLE_HINT,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_PERMISSION_AREAS,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_LABEL,
  isPlatformPermission,
  isWorkspacePermission,
  isWorkspaceRole,
  expandPlatformPermissions,
  type PlatformPermission,
  type WorkspacePermission,
} from "./rbac";

/** Most custom roles one workspace can have. */
export const MAX_CUSTOM_ROLES = 5;

/** Allowed shape of a role key. */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

const RESERVED_KEYS: readonly string[] = ["owner", "member", "viewer"];
const MAX_NAME_LENGTH = 60;

/** A role as stored: built-in or custom, workspace or platform. */
export interface RoleDef {
  key: string;
  name: string;
  description?: string;
  permissions: readonly string[];
  isBuiltIn: boolean;
}

/** Why a role rule refused an action. */
export type RoleRuleCode =
  | "limit-reached"
  | "invalid-key"
  | "key-taken"
  | "name-required"
  | "no-permissions"
  | "unknown-permission"
  | "not-held"
  | "built-in"
  | "super-admin-only"
  | "in-use"
  | "last-admin"
  | "self";

/** Result of a role rule check. */
export type RoleCheck =
  | { ok: true }
  | { ok: false; code: RoleRuleCode; message: string; permissions?: readonly string[] };

export interface Granter {
  isSuperAdmin: boolean;
  permissions: readonly string[];
}

const OK: RoleCheck = { ok: true };

function fail(code: RoleRuleCode, message: string, permissions?: readonly string[]): RoleCheck {
  return permissions ? { ok: false, code, message, permissions } : { ok: false, code, message };
}

function nameCheck(name: string): RoleCheck {
  const n = name.trim();
  if (!n || n.length > MAX_NAME_LENGTH) {
    return fail("name-required", "Give the role a name of up to 60 characters.");
  }
  return OK;
}

function notHeld(wanted: readonly string[], held: readonly string[]): RoleCheck {
  const missing = wanted.filter((p) => !held.includes(p));
  return missing.length
    ? fail("not-held", "You can only grant permissions you hold yourself.", missing)
    : OK;
}

function unknownWorkspace(perms: readonly string[]): RoleCheck {
  const bad = perms.filter((p) => !isWorkspacePermission(p));
  return bad.length ? fail("unknown-permission", "Some permissions are not recognised.", bad) : OK;
}

/** The workspace permissions in catalogue order that the granter holds. */
export function grantablePermissions(held: readonly string[]): WorkspacePermission[] {
  return WORKSPACE_PERMISSIONS.filter((p) => held.includes(p));
}

/** Checks whether a new custom workspace role may be created. */
export function checkCreateCustomRole(
  input: { key: string; name: string; permissions: readonly string[] },
  ctx: { existing: readonly RoleDef[]; granterPermissions: readonly string[] },
): RoleCheck {
  if (ctx.existing.filter((r) => !r.isBuiltIn).length >= MAX_CUSTOM_ROLES) {
    return fail("limit-reached", `A workspace can have at most ${MAX_CUSTOM_ROLES} custom roles.`);
  }
  if (!ROLE_KEY_PATTERN.test(input.key) || RESERVED_KEYS.includes(input.key)) {
    return fail(
      "invalid-key",
      "Use a key of 2 to 32 lowercase letters, digits or dashes, starting with a letter.",
    );
  }
  const lower = input.key.toLowerCase();
  if (ctx.existing.some((r) => r.key.toLowerCase() === lower)) {
    return fail("key-taken", "A role with this key already exists.");
  }
  const name = nameCheck(input.name);
  if (!name.ok) return name;
  if (input.permissions.length === 0) {
    return fail("no-permissions", "Pick at least one permission.");
  }
  const unknown = unknownWorkspace(input.permissions);
  if (!unknown.ok) return unknown;
  return notHeld(input.permissions, ctx.granterPermissions);
}

/** Checks whether a custom workspace role may be changed. Removing is always allowed. */
export function checkUpdateCustomRole(
  prev: RoleDef,
  next: { name: string; permissions: readonly string[] },
  granterPermissions: readonly string[],
): RoleCheck {
  if (prev.isBuiltIn) return fail("built-in", "Built-in roles can't be edited.");
  const name = nameCheck(next.name);
  if (!name.ok) return name;
  if (next.permissions.length === 0) {
    return fail("no-permissions", "Pick at least one permission.");
  }
  const unknown = unknownWorkspace(next.permissions);
  if (!unknown.ok) return unknown;
  return notHeld(
    next.permissions.filter((p) => !prev.permissions.includes(p)),
    granterPermissions,
  );
}

/** Checks whether the granter may give this role to someone. */
export function checkAssignRole(role: RoleDef, granterPermissions: readonly string[]): RoleCheck {
  return notHeld(role.permissions, granterPermissions);
}

/** The workspace permissions a member has, deduped, in catalogue order. */
export function workspacePermissionsFor(m: {
  roleKey: string | null | undefined;
  isSuperAdmin?: boolean;
  customRoles?: readonly RoleDef[];
}): WorkspacePermission[] {
  if (m.isSuperAdmin) return [...WORKSPACE_PERMISSIONS];
  const key = m.roleKey;
  if (!key) return [];
  let granted: readonly string[] = [];
  if (isWorkspaceRole(key)) {
    granted = BUILT_IN_ROLE_PERMISSIONS[key];
  } else {
    const custom = m.customRoles?.find((r) => !r.isBuiltIn && r.key === key);
    if (custom) granted = custom.permissions;
  }
  return WORKSPACE_PERMISSIONS.filter((p) => granted.includes(p));
}

/** The built-in platform role that holds every platform permission. */
export const PLATFORM_ADMIN_ROLE: RoleDef = {
  key: "platform-admin",
  name: "Platform admin",
  permissions: [...PLATFORM_PERMISSIONS],
  isBuiltIn: true,
};

/** The platform permissions a person has, deduped, in catalogue order. */
export function platformPermissionsFor(p: {
  isSuperAdmin: boolean;
  roleKeys: readonly string[];
  roles: readonly RoleDef[];
}): PlatformPermission[] {
  if (p.isSuperAdmin || p.roleKeys.includes(PLATFORM_ADMIN_ROLE.key)) {
    return [...PLATFORM_PERMISSIONS];
  }
  const granted = new Set<string>();
  for (const r of p.roles) {
    if (!p.roleKeys.includes(r.key)) continue;
    for (const perm of r.permissions) if (isPlatformPermission(perm)) granted.add(perm);
  }
  // A broad key brings the keys it implies (platform.orgs.manage holds platform.workspaces.manage, …).
  return expandPlatformPermissions([...granted]);
}

/** Checks whether a custom platform role may be created or changed. */
export function checkPlatformRoleChange(
  role: { key: string; name: string; permissions: readonly string[] },
  granter: Granter,
): RoleCheck {
  if (role.key === PLATFORM_ADMIN_ROLE.key) {
    return fail("built-in", "Built-in roles can't be edited.");
  }
  if (!granter.isSuperAdmin && !granter.permissions.includes("platform.roles.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", [
      "platform.roles.manage",
    ]);
  }
  if (!granter.isSuperAdmin && role.permissions.includes("platform.roles.manage")) {
    return fail("super-admin-only", "Only the super admin can grant this.", [
      "platform.roles.manage",
    ]);
  }
  if (!ROLE_KEY_PATTERN.test(role.key)) {
    return fail(
      "invalid-key",
      "Use a key of 2 to 32 lowercase letters, digits or dashes, starting with a letter.",
    );
  }
  const name = nameCheck(role.name);
  if (!name.ok) return name;
  const bad = role.permissions.filter((p) => !isPlatformPermission(p));
  if (bad.length) return fail("unknown-permission", "Some permissions are not recognised.", bad);
  if (!granter.isSuperAdmin) return notHeld(role.permissions, granter.permissions);
  return OK;
}

/** Checks whether an organization role template may be created or changed (platform.roles.manage or super admin). */
export function checkOrgRoleTemplateChange(
  role: { key: string; name: string; permissions: readonly string[] },
  granter: Granter,
): RoleCheck {
  if (!granter.isSuperAdmin && !granter.permissions.includes("platform.roles.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", ["platform.roles.manage"]);
  }
  if (!ROLE_KEY_PATTERN.test(role.key) || [...RESERVED_KEYS, PLATFORM_ADMIN_ROLE.key].includes(role.key)) {
    return fail(
      "invalid-key",
      "Use a key of 2 to 32 lowercase letters, digits or dashes, starting with a letter.",
    );
  }
  const name = nameCheck(role.name);
  if (!name.ok) return name;
  if (role.permissions.length === 0) return fail("no-permissions", "Pick at least one permission.");
  return unknownWorkspace(role.permissions);
}

/** Checks whether the granter may give this platform role to someone. */
export function checkAssignPlatformRole(role: RoleDef, granter: Granter): RoleCheck {
  if (
    !granter.isSuperAdmin &&
    (role.key === PLATFORM_ADMIN_ROLE.key || role.permissions.includes("platform.roles.manage"))
  ) {
    return fail("super-admin-only", "Only the super admin can grant this.");
  }
  if (granter.isSuperAdmin) return OK;
  if (!granter.permissions.includes("platform.users.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", [
      "platform.users.manage",
    ]);
  }
  return notHeld(role.permissions, granter.permissions);
}

const MAX_KEY_LENGTH = 32;
const RESERVED_ROLE_KEYS: readonly string[] = [...RESERVED_KEYS, "platform-admin"];

/** A valid, free role key made from a role name. */
export function roleKeyFromName(name: string, takenKeys: readonly string[]): string {
  let base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base && !/^[a-z]/.test(base)) base = `role-${base}`;
  base = base.slice(0, MAX_KEY_LENGTH).replace(/-+$/, "");
  if (base.length < 2) base = "role";
  const taken = new Set([...RESERVED_ROLE_KEYS, ...takenKeys.map((k) => k.toLowerCase())]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_KEY_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The three built-in workspace roles as role definitions. */
export function builtInWorkspaceRoles(): RoleDef[] {
  return WORKSPACE_ROLES.map((key) => ({
    key,
    name: WORKSPACE_ROLE_LABEL[key],
    description: ROLE_HINT[key],
    permissions: BUILT_IN_ROLE_PERMISSIONS[key],
    isBuiltIn: true,
  }));
}

export interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  reason: string | null;
}

export interface ChecklistArea {
  key: string;
  name: string;
  items: ChecklistItem[];
}

const NOT_HELD_REASON = "You don't hold this permission, so you can't grant it.";
const KEEP_ONLY_REASON = "You don't hold this permission: once removed, you can't add it back.";

function checklist(
  areas: readonly { key: string; name: string; permissions: readonly string[] }[],
  selected: readonly string[],
  stateFor: (perm: string, checked: boolean) => { disabled: boolean; reason: string | null },
): ChecklistArea[] {
  return areas.map((a) => ({
    key: a.key,
    name: a.name,
    items: a.permissions.map((perm) => {
      const checked = selected.includes(perm);
      const { disabled, reason } = stateFor(perm, checked);
      return {
        key: perm,
        label: PERMISSION_LABEL[perm as keyof typeof PERMISSION_LABEL] ?? perm,
        checked,
        disabled,
        reason,
      };
    }),
  }));
}

function heldState(
  perm: string,
  checked: boolean,
  held: readonly string[],
  prev: readonly string[],
): { disabled: boolean; reason: string | null } {
  if (held.includes(perm)) return { disabled: false, reason: null };
  if (checked && prev.includes(perm)) return { disabled: false, reason: KEEP_ONLY_REASON };
  return { disabled: true, reason: NOT_HELD_REASON };
}

/** The workspace permission checklist, with what the granter may not grant disabled. */
export function workspaceChecklist(
  selected: readonly string[],
  granterPermissions: readonly string[],
  prevPermissions: readonly string[] = [],
): ChecklistArea[] {
  return checklist(WORKSPACE_PERMISSION_AREAS, selected, (perm, checked) =>
    heldState(perm, checked, granterPermissions, prevPermissions),
  );
}

/** The platform permission checklist; platform.roles.manage is for the super admin only. */
export function platformChecklist(
  selected: readonly string[],
  granter: Granter,
  prevPermissions: readonly string[] = [],
): ChecklistArea[] {
  return checklist(PLATFORM_PERMISSION_AREAS, selected, (perm, checked) => {
    if (granter.isSuperAdmin) return { disabled: false, reason: null };
    if (perm === "platform.roles.manage") {
      return { disabled: true, reason: "Only the super admin can grant this." };
    }
    return heldState(perm, checked, granter.permissions, prevPermissions);
  });
}

function people(n: number): string {
  return n === 1 ? "1 person holds" : `${n} people hold`;
}

/** Checks whether a custom workspace role may be deleted, once its members are moved. */
export function checkDeleteCustomRole(
  role: RoleDef,
  ctx: { memberCount: number; reassignTo: string | null; existing: readonly RoleDef[] },
): RoleCheck {
  if (role.isBuiltIn) return fail("built-in", "Built-in roles can't be deleted.");
  if (ctx.memberCount > 0) {
    if (!ctx.reassignTo) {
      return fail("in-use", `${people(ctx.memberCount)} this role. Move them to another role first.`);
    }
    if (ctx.reassignTo === role.key || !ctx.existing.some((r) => r.key === ctx.reassignTo)) {
      return fail("in-use", "Pick another role to move them to.");
    }
  }
  return OK;
}

/** Checks whether someone's workspace role may be changed to another. */
export function checkSetMemberRole(input: {
  currentRoleKey: string | null;
  next: RoleDef;
  granterPermissions: readonly string[];
  workspaceAdminCount: number;
}): RoleCheck {
  if (!input.granterPermissions.includes("members.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", ["members.manage"]);
  }
  if (input.currentRoleKey === "owner" && input.next.key !== "owner" && input.workspaceAdminCount <= 1) {
    return fail("last-admin", "A workspace needs at least one Workspace admin.");
  }
  return checkAssignRole(input.next, input.granterPermissions);
}

/** Checks whether a platform role may be deleted. */
export function checkDeletePlatformRole(
  role: RoleDef,
  ctx: { holderCount: number; granter: Granter },
): RoleCheck {
  if (role.isBuiltIn || role.key === PLATFORM_ADMIN_ROLE.key) {
    return fail("built-in", "Built-in roles can't be deleted.");
  }
  if (!ctx.granter.isSuperAdmin && !ctx.granter.permissions.includes("platform.roles.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", ["platform.roles.manage"]);
  }
  if (ctx.holderCount > 0) {
    return fail(
      "in-use",
      ctx.holderCount === 1
        ? "Remove this role from the 1 person who holds it first."
        : `Remove this role from the ${ctx.holderCount} people who hold it first.`,
    );
  }
  return OK;
}

/** Checks whether a platform role may be taken away from someone. */
export function checkUnassignPlatformRole(
  role: RoleDef,
  ctx: { granter: Granter; holderCount: number; isSelf: boolean },
): RoleCheck {
  const isAdminRole = role.key === PLATFORM_ADMIN_ROLE.key;
  const { granter } = ctx;
  if (!granter.isSuperAdmin && (isAdminRole || role.permissions.includes("platform.roles.manage"))) {
    return fail("super-admin-only", "Only the super admin can grant this.");
  }
  if (!granter.isSuperAdmin && !granter.permissions.includes("platform.users.manage")) {
    return fail("not-held", "You can only grant permissions you hold yourself.", ["platform.users.manage"]);
  }
  if (isAdminRole) {
    if (ctx.isSelf && !granter.isSuperAdmin) {
      return fail("self", "You can't remove your own Platform admin role.");
    }
    if (ctx.holderCount <= 1) {
      return fail("last-admin", "MADP Factory needs at least one Platform admin.");
    }
  }
  return OK;
}

/** The workspace permissions the acting person may grant in a workspace. */
export function workspaceGranterPermissions(p: {
  isSuperAdmin: boolean;
  platformPermissions: readonly string[];
  memberPermissions: readonly string[];
  crossWorkspace: boolean;
}): WorkspacePermission[] {
  if (p.isSuperAdmin) return [...WORKSPACE_PERMISSIONS];
  if (p.crossWorkspace && p.platformPermissions.includes("platform.workspaces.manage")) {
    return [...WORKSPACE_PERMISSIONS];
  }
  return WORKSPACE_PERMISSIONS.filter((x) => p.memberPermissions.includes(x));
}
