/**
 * Workspace and platform roles and what each may do. The Logic Functions
 * enforce roles and permissions on the server; the UI only mirrors them.
 * Release promotions do have approvals (stage and production); the approver
 * list on a project's policy scopes the release.approve permission.
 *
 * Pure module: no imports, so the server functions can bundle it unchanged.
 */
export type WorkspaceRole = "owner" | "member" | "viewer";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["owner", "member", "viewer"];

export type RbacAction =
  | "workspace.manage"
  | "members.manage"
  | "project.create"
  | "project.edit"
  | "project.run"
  | "project.delete"
  | "project.assign"
  | "share"
  | "comment"
  | "view";

export const ROLE_NAME: Record<WorkspaceRole, string> = {
  owner: "Owner",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: "Manages the workspace, its members and roles, and every project",
  member: "Creates, edits and runs projects, shares and comments",
  viewer: "Opens projects and shared items, and comments",
};

export const VIEWER_TIP = "Viewers can't edit";
export const OWNER_TIP = "Only an Owner manages the workspace and its members";

/** Every workspace-level permission key (project.edit and project.run stay for today's screens). */
export const WORKSPACE_PERMISSIONS = [
  "workspace.manage",
  "members.manage",
  "roles.manage",
  "project.create",
  "project.edit",
  "project.run",
  "project.delete",
  "project.assign",
  "business.edit",
  "sanitization.edit",
  "requirements.edit",
  "design.edit",
  "scope.lock",
  "milestones.edit",
  "board.edit",
  "build.run",
  "release.request",
  "release.approve",
  "release.manage-approvals",
  "release.promote",
  "wiki.edit",
  "share",
  "items.shareExternal",
  "comment",
  "view",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

/**
 * Platform-level permission keys, held through platform roles. The catalogue with plain descriptions and the named
 * constants other modules reference is src/domain/permissions.ts.
 */
export const PLATFORM_PERMISSIONS = [
  "platform.users.view",
  "platform.users.manage",
  "platform.people.manage",
  "platform.workspaces.view",
  "platform.workspaces.manage",
  "platform.orgs.manage",
  "platform.roles.manage",
  "platform.workspaceRoles.view",
  "platform.audit.view",
  "platform.settings.manage",
  "platform.engine.view",
  "platform.engine.manage",
  "platform.ai.manage",
  "platform.billing.manage",
  "platform.usage.view",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * What a broad platform permission brings with it. Holding the key on the left grants every key on the right too
 * (one level; the lists are complete), so the older fine-grained keys keep working in every op that checks them.
 */
export const PLATFORM_PERMISSION_IMPLIES: Readonly<Partial<Record<PlatformPermission, readonly PlatformPermission[]>>> = {
  "platform.people.manage": ["platform.users.view", "platform.users.manage"],
  "platform.users.manage": ["platform.users.view"],
  "platform.orgs.manage": ["platform.workspaces.view", "platform.workspaces.manage", "platform.workspaceRoles.view"],
  "platform.workspaces.manage": ["platform.workspaces.view"],
  "platform.billing.manage": ["platform.usage.view"],
  "platform.engine.manage": ["platform.engine.view"],
  "platform.ai.manage": ["platform.engine.view"],
};

/** The held platform keys plus everything they imply, in catalogue order. Unknown keys are dropped. */
export function expandPlatformPermissions(held: readonly string[]): PlatformPermission[] {
  const out = new Set<string>();
  for (const p of held) {
    if (!isPlatformPermission(p)) continue;
    out.add(p);
    for (const q of PLATFORM_PERMISSION_IMPLIES[p] ?? []) out.add(q);
  }
  return PLATFORM_PERMISSIONS.filter((x) => out.has(x));
}

export type Permission = WorkspacePermission | PlatformPermission;

export function isWorkspacePermission(x: unknown): x is WorkspacePermission {
  return typeof x === "string" && (WORKSPACE_PERMISSIONS as readonly string[]).includes(x);
}

export function isPlatformPermission(x: unknown): x is PlatformPermission {
  return typeof x === "string" && (PLATFORM_PERMISSIONS as readonly string[]).includes(x);
}

/** What each built-in workspace role holds. Owner is the Workspace admin. */
export const BUILT_IN_ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly WorkspacePermission[]>> = {
  owner: WORKSPACE_PERMISSIONS,
  member: [
    "project.create",
    "project.edit",
    "project.run",
    "project.delete",
    "project.assign",
    "share",
    "items.shareExternal",
    "comment",
    "view",
    "business.edit",
    "sanitization.edit",
    "requirements.edit",
    "design.edit",
    "scope.lock",
    "milestones.edit",
    "board.edit",
    "build.run",
    "release.request",
    "release.approve",
    "release.promote",
    "wiki.edit",
  ],
  // Approvers may hold any role; the policy's approver list scopes release.approve.
  viewer: ["comment", "view", "release.approve"],
};

export function isWorkspaceRole(x: unknown): x is WorkspaceRole {
  return typeof x === "string" && (WORKSPACE_ROLES as readonly string[]).includes(x);
}

/** Permissions of a built-in role; empty for an unknown role. */
export function permissionsForRole(role: unknown): readonly WorkspacePermission[] {
  return isWorkspaceRole(role) ? BUILT_IN_ROLE_PERMISSIONS[role] : [];
}

/**
 * An array is the person's held permissions; a string is a built-in role.
 * Anything else is denied. Built-in roles never hold platform.* keys.
 */
export function can(subject: WorkspaceRole | readonly string[] | null | undefined, action: Permission): boolean {
  if (Array.isArray(subject)) return (subject as readonly string[]).includes(action);
  if (!isWorkspaceRole(subject)) return false;
  return (BUILT_IN_ROLE_PERMISSIONS[subject] as readonly string[]).includes(action);
}

export function deniedTip(role: WorkspaceRole | null | undefined, action: WorkspacePermission): string | null {
  if (can(role, action)) return null;
  if (!isWorkspaceRole(role)) return "Sign in to a workspace first";
  if (role === "viewer") return VIEWER_TIP;
  return OWNER_TIP;
}

/** What a built-in workspace role is called in the role screens (ROLE_NAME stays for today's screens). */
export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Workspace admin",
  member: "Member",
  viewer: "Viewer",
};

/** A short plain-English label for every permission key. */
export const PERMISSION_LABEL: Readonly<Record<Permission, string>> = {
  "workspace.manage": "Manage the workspace",
  "members.manage": "Invite and remove members",
  "roles.manage": "Manage roles",
  "project.create": "Create projects",
  "project.edit": "Edit projects",
  "project.run": "Run projects",
  "project.delete": "Delete projects",
  "project.assign": "Assign people to projects",
  "business.edit": "Edit the business context",
  "sanitization.edit": "Edit the project understanding",
  "requirements.edit": "Edit requirements",
  "design.edit": "Edit screens and design",
  "scope.lock": "Confirm and lock the scope",
  "milestones.edit": "Edit milestones",
  "board.edit": "Edit the board",
  "build.run": "Run builds",
  "release.request": "Request release promotions",
  "release.approve": "Approve release promotions",
  "release.manage-approvals": "Configure release approvals",
  "release.promote": "Promote releases",
  "wiki.edit": "Edit the wiki",
  share: "Share projects and items",
  "items.shareExternal": "Share items by external link",
  comment: "Comment",
  view: "Open projects and shared items",
  "platform.users.view": "See people",
  "platform.users.manage": "Manage people and their platform roles",
  "platform.people.manage": "Manage everyone's accounts and access",
  "platform.workspaces.view": "See every organization",
  "platform.workspaces.manage": "Change any organization's members and roles",
  "platform.orgs.manage": "Manage organizations",
  "platform.roles.manage": "Manage roles and permissions",
  "platform.workspaceRoles.view": "See organization custom roles",
  "platform.audit.view": "See the audit log",
  "platform.settings.manage": "Manage platform settings",
  "platform.engine.view": "See the engine and its capacity",
  "platform.engine.manage": "Manage how the agent team is connected",
  "platform.ai.manage": "Manage model accounts",
  "platform.billing.manage": "Manage plans, credits and coupons",
  "platform.usage.view": "See usage and costs",
};

/** A group of permissions shown together in a role checklist. */
export interface PermissionArea<P extends string = string> {
  key: string;
  name: string;
  permissions: readonly P[];
}

/** Workspace permissions grouped by journey area, in display order. */
export const WORKSPACE_PERMISSION_AREAS: readonly PermissionArea<WorkspacePermission>[] = [
  {
    key: "business",
    name: "Project setup",
    permissions: ["view", "comment", "project.create", "project.edit", "project.delete", "project.assign", "business.edit"],
  },
  { key: "sanitization", name: "Understanding your project", permissions: ["sanitization.edit"] },
  { key: "requirements", name: "Goals, requirements & design", permissions: ["requirements.edit", "design.edit"] },
  { key: "scope", name: "Scope, success & milestones", permissions: ["scope.lock", "milestones.edit"] },
  { key: "board", name: "Build", permissions: ["board.edit", "build.run", "project.run"] },
  {
    key: "release",
    name: "Release & approvals",
    permissions: ["release.request", "release.approve", "release.manage-approvals", "release.promote"],
  },
  { key: "wiki", name: "Wiki", permissions: ["wiki.edit"] },
  {
    key: "members",
    name: "Members & roles",
    permissions: ["workspace.manage", "members.manage", "roles.manage", "share", "items.shareExternal"],
  },
];

/** Platform permissions grouped by area, in display order. */
export const PLATFORM_PERMISSION_AREAS: readonly PermissionArea<PlatformPermission>[] = [
  { key: "people", name: "People", permissions: ["platform.people.manage", "platform.users.view", "platform.users.manage"] },
  {
    key: "workspaces",
    name: "Organizations",
    permissions: ["platform.orgs.manage", "platform.workspaces.view", "platform.workspaces.manage", "platform.workspaceRoles.view"],
  },
  { key: "roles", name: "Roles & permissions", permissions: ["platform.roles.manage"] },
  { key: "billing", name: "Plans, credits & usage", permissions: ["platform.billing.manage", "platform.usage.view"] },
  { key: "engine", name: "Engine & model accounts", permissions: ["platform.engine.view", "platform.engine.manage", "platform.ai.manage"] },
  { key: "oversight", name: "Settings & audit", permissions: ["platform.settings.manage", "platform.audit.view"] },
];

/** True when the list holds at least one platform permission. */
export function hasAnyPlatformPermission(perms: readonly string[]): boolean {
  return perms.some((p) => isPlatformPermission(p));
}
