/**
 * The permission catalogue: every permission string the platform knows, with a plain description, grouped by area.
 * One source for the ops (functions/**) and the screens. Pure module: no React, DOM, store or SDK imports.
 *
 * Ops reference the named constants, e.g.
 *   openOp(ctx, deps, { scope: "platform", platformPermission: PLATFORM_PERMISSION.billingManage })
 * The resolver (resolvePlatformAccess / platformPermissionsFor) expands broad keys through PLATFORM_PERMISSION_IMPLIES,
 * and the super admin (IAM role mf-super-admin) always holds every platform permission.
 */
import {
  PERMISSION_LABEL,
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_AREAS,
  PLATFORM_PERMISSION_IMPLIES,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_PERMISSION_AREAS,
  expandPlatformPermissions,
  isPlatformPermission,
  isWorkspacePermission,
  type PermissionArea,
  type PlatformPermission,
  type WorkspacePermission,
} from "./rbac";

export {
  PLATFORM_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  PLATFORM_PERMISSION_AREAS,
  WORKSPACE_PERMISSION_AREAS,
  PLATFORM_PERMISSION_IMPLIES,
  expandPlatformPermissions,
  isPlatformPermission,
  isWorkspacePermission,
};
export type { PlatformPermission, WorkspacePermission, PermissionArea };

/** Named platform permission strings. */
export const PLATFORM_PERMISSION = {
  /** Plans, credits, coupons, purchase approvals and adjustments. */
  billingManage: "platform.billing.manage",
  /** Usage and cost reports across the platform. */
  usageView: "platform.usage.view",
  /** Engine hosts, capacity and running work (read only). */
  engineView: "platform.engine.view",
  /** How the agent team (engine) is connected. */
  engineManage: "platform.engine.manage",
  /** Model accounts and their rotation. */
  aiManage: "platform.ai.manage",
  /** Platform roles, organization role templates and their permissions. Granted by the super admin only. */
  rolesManage: "platform.roles.manage",
  /** Organizations: members, roles, suspend and reactivate. Implies the workspaces.* keys. */
  orgsManage: "platform.orgs.manage",
  /** People: accounts, platform roles, deactivate. Implies the users.* keys. */
  peopleManage: "platform.people.manage",
  usersView: "platform.users.view",
  usersManage: "platform.users.manage",
  workspacesView: "platform.workspaces.view",
  workspacesManage: "platform.workspaces.manage",
  workspaceRolesView: "platform.workspaceRoles.view",
  auditView: "platform.audit.view",
  settingsManage: "platform.settings.manage",
} as const satisfies Record<string, PlatformPermission>;

/** Named organization (workspace) permission strings for the ones ops check most. */
export const ORG_PERMISSION = {
  manage: "workspace.manage",
  membersManage: "members.manage",
  rolesManage: "roles.manage",
  projectCreate: "project.create",
  view: "view",
} as const satisfies Record<string, WorkspacePermission>;

/** One plain sentence per permission: what holding it lets a person do. */
export const PERMISSION_DESCRIPTION: Readonly<Record<PlatformPermission | WorkspacePermission, string>> = {
  "platform.users.view": "Open the list of people on the platform.",
  "platform.users.manage": "Give and take away platform roles, and handle access requests.",
  "platform.people.manage": "Everything about people: accounts, platform roles, deactivating and reactivating.",
  "platform.workspaces.view": "Open every organization, its members and its roles.",
  "platform.workspaces.manage": "Change the members and roles of any organization, and suspend or reactivate it.",
  "platform.orgs.manage": "Everything about organizations: members, roles, suspending and reactivating.",
  "platform.roles.manage": "Create and change platform roles and organization role templates.",
  "platform.workspaceRoles.view": "See the custom roles each organization has made.",
  "platform.audit.view": "Read the audit log of every change.",
  "platform.settings.manage": "Change platform settings such as who may sign up.",
  "platform.engine.view": "See the engine hosts, their load and the work running now.",
  "platform.engine.manage": "Change how the agent team is connected.",
  "platform.ai.manage": "Add, pause and order the model accounts the engine uses.",
  "platform.billing.manage": "Edit plans, grant credit, create coupons and approve purchases.",
  "platform.usage.view": "See usage and costs by organization, project, person and model.",
  "workspace.manage": "Rename the organization and change its settings.",
  "members.manage": "Invite, suspend and remove members, and change their roles.",
  "roles.manage": "Create and change the organization's custom roles.",
  "project.create": "Start new projects.",
  "project.edit": "Change a project's details.",
  "project.run": "Start agent work on a project.",
  "project.delete": "Delete projects.",
  "project.assign": "Choose who works on a project.",
  "business.edit": "Edit the business context of a project.",
  "sanitization.edit": "Edit the project understanding.",
  "requirements.edit": "Edit goals and requirements.",
  "design.edit": "Edit screens and design.",
  "scope.lock": "Confirm and lock the scope.",
  "milestones.edit": "Edit milestones.",
  "board.edit": "Edit the build board.",
  "build.run": "Start builds.",
  "release.request": "Ask for a release to move ahead.",
  "release.approve": "Approve a release when named as an approver.",
  "release.manage-approvals": "Choose who approves releases.",
  "release.promote": "Move a release to the next environment.",
  "wiki.edit": "Edit the wiki.",
  share: "Share projects and items with other members.",
  "items.shareExternal": "Share items with people outside by link.",
  comment: "Comment on projects and items.",
  view: "Open projects and shared items.",
};

/** The short label of any permission key (the key itself when unknown). */
export function permissionLabel(key: string): string {
  return (PERMISSION_LABEL as Record<string, string>)[key] ?? key;
}

/** The plain description of any permission key (empty when unknown). */
export function permissionDescription(key: string): string {
  return (PERMISSION_DESCRIPTION as Record<string, string>)[key] ?? "";
}

/** What a held set of platform permissions is called when it holds every key. */
export function holdsEveryPlatformPermission(held: readonly string[]): boolean {
  const all = expandPlatformPermissions(held);
  return PLATFORM_PERMISSIONS.every((p) => all.includes(p));
}

/** Platform permissions only the super admin may grant (a holder could otherwise raise their own rights). */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly PlatformPermission[] = ["platform.roles.manage"];

/** Where a role definition applies: across the platform, or as a template copied into organizations. */
export type RoleScope = "platform" | "organization";

export function isRoleScope(x: unknown): x is RoleScope {
  return x === "platform" || x === "organization";
}
