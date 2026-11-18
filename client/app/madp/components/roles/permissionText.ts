// Permission and role-area texts in the current language. The English catalogues (PERMISSION_LABEL,
// PERMISSION_DESCRIPTION, the permission areas, the built-in roles) stay pure for the server; the screens read them
// through these helpers at render time. Every key is written out as a t() call so npm run i18n:push finds it; a test
// checks the English here matches the catalogues.
import { t } from "@/madp/i18n";
import { WORKSPACE_ROLE_LABEL, isWorkspaceRole, type PermissionArea } from "@/madp/domain/rbac";

type Texts = Readonly<Record<string, () => string>>;

const LABEL: Texts = {
  "workspace.manage": () => t("platform.permissions.label.workspaceManage", "Manage the workspace"),
  "members.manage": () => t("platform.permissions.label.membersManage", "Invite and remove members"),
  "roles.manage": () => t("platform.permissions.label.rolesManage", "Manage roles"),
  "project.create": () => t("platform.permissions.label.projectCreate", "Create projects"),
  "project.edit": () => t("platform.permissions.label.projectEdit", "Edit projects"),
  "project.run": () => t("platform.permissions.label.projectRun", "Run projects"),
  "project.delete": () => t("platform.permissions.label.projectDelete", "Delete projects"),
  "project.assign": () => t("platform.permissions.label.projectAssign", "Assign people to projects"),
  "business.edit": () => t("platform.permissions.label.businessEdit", "Edit the business context"),
  "sanitization.edit": () => t("platform.permissions.label.sanitizationEdit", "Edit the project understanding"),
  "requirements.edit": () => t("platform.permissions.label.requirementsEdit", "Edit requirements"),
  "design.edit": () => t("platform.permissions.label.designEdit", "Edit screens and design"),
  "scope.lock": () => t("platform.permissions.label.scopeLock", "Confirm and lock the scope"),
  "milestones.edit": () => t("platform.permissions.label.milestonesEdit", "Edit milestones"),
  "board.edit": () => t("platform.permissions.label.boardEdit", "Edit the board"),
  "build.run": () => t("platform.permissions.label.buildRun", "Run builds"),
  "release.request": () => t("platform.permissions.label.releaseRequest", "Request release promotions"),
  "release.approve": () => t("platform.permissions.label.releaseApprove", "Approve release promotions"),
  "release.manage-approvals": () => t("platform.permissions.label.releaseManageApprovals", "Configure release approvals"),
  "release.promote": () => t("platform.permissions.label.releasePromote", "Promote releases"),
  "wiki.edit": () => t("platform.permissions.label.wikiEdit", "Edit the wiki"),
  "share": () => t("platform.permissions.label.share", "Share projects and items"),
  "items.shareExternal": () => t("platform.permissions.label.itemsShareExternal", "Share items by external link"),
  "comment": () => t("platform.permissions.label.comment", "Comment"),
  "view": () => t("platform.permissions.label.view", "Open projects and shared items"),
  "platform.users.view": () => t("platform.permissions.label.platformUsersView", "See people"),
  "platform.users.manage": () => t("platform.permissions.label.platformUsersManage", "Manage people and their platform roles"),
  "platform.people.manage": () => t("platform.permissions.label.platformPeopleManage", "Manage everyone's accounts and access"),
  "platform.workspaces.view": () => t("platform.permissions.label.platformWorkspacesView", "See every organization"),
  "platform.workspaces.manage": () => t("platform.permissions.label.platformWorkspacesManage", "Change any organization's members and roles"),
  "platform.orgs.manage": () => t("platform.permissions.label.platformOrgsManage", "Manage organizations"),
  "platform.roles.manage": () => t("platform.permissions.label.platformRolesManage", "Manage roles and permissions"),
  "platform.workspaceRoles.view": () => t("platform.permissions.label.platformWorkspaceRolesView", "See organization custom roles"),
  "platform.audit.view": () => t("platform.permissions.label.platformAuditView", "See the audit log"),
  "platform.settings.manage": () => t("platform.permissions.label.platformSettingsManage", "Manage platform settings"),
  "platform.engine.view": () => t("platform.permissions.label.platformEngineView", "See the engine and its capacity"),
  "platform.engine.manage": () => t("platform.permissions.label.platformEngineManage", "Manage how the agent team is connected"),
  "platform.ai.manage": () => t("platform.permissions.label.platformAiManage", "Manage model accounts"),
  "platform.billing.manage": () => t("platform.permissions.label.platformBillingManage", "Manage plans, credits and coupons"),
  "platform.usage.view": () => t("platform.permissions.label.platformUsageView", "See usage and costs"),
};

const DESCRIPTION: Texts = {
  "platform.users.view": () => t("platform.permissions.description.platformUsersView", "Open the list of people on the platform."),
  "platform.users.manage": () => t("platform.permissions.description.platformUsersManage", "Give and take away platform roles, and handle access requests."),
  "platform.people.manage": () => t("platform.permissions.description.platformPeopleManage", "Everything about people: accounts, platform roles, deactivating and reactivating."),
  "platform.workspaces.view": () => t("platform.permissions.description.platformWorkspacesView", "Open every organization, its members and its roles."),
  "platform.workspaces.manage": () => t("platform.permissions.description.platformWorkspacesManage", "Change the members and roles of any organization, and suspend or reactivate it."),
  "platform.orgs.manage": () => t("platform.permissions.description.platformOrgsManage", "Everything about organizations: members, roles, suspending and reactivating."),
  "platform.roles.manage": () => t("platform.permissions.description.platformRolesManage", "Create and change platform roles and organization role templates."),
  "platform.workspaceRoles.view": () => t("platform.permissions.description.platformWorkspaceRolesView", "See the custom roles each organization has made."),
  "platform.audit.view": () => t("platform.permissions.description.platformAuditView", "Read the audit log of every change."),
  "platform.settings.manage": () => t("platform.permissions.description.platformSettingsManage", "Change platform settings such as who may sign up."),
  "platform.engine.view": () => t("platform.permissions.description.platformEngineView", "See the engine hosts, their load and the work running now."),
  "platform.engine.manage": () => t("platform.permissions.description.platformEngineManage", "Change how the agent team is connected."),
  "platform.ai.manage": () => t("platform.permissions.description.platformAiManage", "Add, pause and order the model accounts the engine uses."),
  "platform.billing.manage": () => t("platform.permissions.description.platformBillingManage", "Edit plans, grant credit, create coupons and approve purchases."),
  "platform.usage.view": () => t("platform.permissions.description.platformUsageView", "See usage and costs by organization, project, person and model."),
  "workspace.manage": () => t("platform.permissions.description.workspaceManage", "Rename the organization and change its settings."),
  "members.manage": () => t("platform.permissions.description.membersManage", "Invite, suspend and remove members, and change their roles."),
  "roles.manage": () => t("platform.permissions.description.rolesManage", "Create and change the organization's custom roles."),
  "project.create": () => t("platform.permissions.description.projectCreate", "Start new projects."),
  "project.edit": () => t("platform.permissions.description.projectEdit", "Change a project's details."),
  "project.run": () => t("platform.permissions.description.projectRun", "Start agent work on a project."),
  "project.delete": () => t("platform.permissions.description.projectDelete", "Delete projects."),
  "project.assign": () => t("platform.permissions.description.projectAssign", "Choose who works on a project."),
  "business.edit": () => t("platform.permissions.description.businessEdit", "Edit the business context of a project."),
  "sanitization.edit": () => t("platform.permissions.description.sanitizationEdit", "Edit the project understanding."),
  "requirements.edit": () => t("platform.permissions.description.requirementsEdit", "Edit goals and requirements."),
  "design.edit": () => t("platform.permissions.description.designEdit", "Edit screens and design."),
  "scope.lock": () => t("platform.permissions.description.scopeLock", "Confirm and lock the scope."),
  "milestones.edit": () => t("platform.permissions.description.milestonesEdit", "Edit milestones."),
  "board.edit": () => t("platform.permissions.description.boardEdit", "Edit the build board."),
  "build.run": () => t("platform.permissions.description.buildRun", "Start builds."),
  "release.request": () => t("platform.permissions.description.releaseRequest", "Ask for a release to move ahead."),
  "release.approve": () => t("platform.permissions.description.releaseApprove", "Approve a release when named as an approver."),
  "release.manage-approvals": () => t("platform.permissions.description.releaseManageApprovals", "Choose who approves releases."),
  "release.promote": () => t("platform.permissions.description.releasePromote", "Move a release to the next environment."),
  "wiki.edit": () => t("platform.permissions.description.wikiEdit", "Edit the wiki."),
  "share": () => t("platform.permissions.description.share", "Share projects and items with other members."),
  "items.shareExternal": () => t("platform.permissions.description.itemsShareExternal", "Share items with people outside by link."),
  "comment": () => t("platform.permissions.description.comment", "Comment on projects and items."),
  "view": () => t("platform.permissions.description.view", "Open projects and shared items."),
};

const PLATFORM_AREA: Texts = {
  "people": () => t("platform.permissions.area.platform.people", "People"),
  "workspaces": () => t("platform.permissions.area.platform.workspaces", "Organizations"),
  "roles": () => t("platform.permissions.area.platform.roles", "Roles & permissions"),
  "billing": () => t("platform.permissions.area.platform.billing", "Plans, credits & usage"),
  "engine": () => t("platform.permissions.area.platform.engine", "Engine & model accounts"),
  "oversight": () => t("platform.permissions.area.platform.oversight", "Settings & audit"),
};

const WORKSPACE_AREA: Texts = {
  "business": () => t("platform.permissions.area.workspace.business", "Project setup"),
  "sanitization": () => t("platform.permissions.area.workspace.sanitization", "Understanding your project"),
  "requirements": () => t("platform.permissions.area.workspace.requirements", "Goals, requirements & design"),
  "scope": () => t("platform.permissions.area.workspace.scope", "Scope, success & milestones"),
  "board": () => t("platform.permissions.area.workspace.board", "Build"),
  "release": () => t("platform.permissions.area.workspace.release", "Release & approvals"),
  "wiki": () => t("platform.permissions.area.workspace.wiki", "Wiki"),
  "members": () => t("platform.permissions.area.workspace.members", "Members & roles"),
};

const ROLE_NAME: Texts = {
  "owner": () => t("platform.permissions.workspaceRole.owner", "Workspace admin"),
  "member": () => t("platform.permissions.workspaceRole.member", "Member"),
  "viewer": () => t("platform.permissions.workspaceRole.viewer", "Viewer"),
};

const ROLE_HINT: Texts = {
  "owner": () => t("platform.permissions.workspaceRoleHint.owner", "Manages the workspace, its members and roles, and every project"),
  "member": () => t("platform.permissions.workspaceRoleHint.member", "Creates, edits and runs projects, shares and comments"),
  "viewer": () => t("platform.permissions.workspaceRoleHint.viewer", "Opens projects and shared items, and comments"),
};

const own = (texts: Texts, key: string): (() => string) | undefined => (Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : undefined);

/** The short label of any permission key (the key itself when unknown). */
export function permissionLabelText(key: string): string {
  return own(LABEL, key)?.() ?? key;
}

/** The plain sentence of what a permission lets a person do (empty when unknown). */
export function permissionDescriptionText(key: string): string {
  return own(DESCRIPTION, key)?.() ?? "";
}

/** Every permission's label in the current language, keyed like PERMISSION_LABEL (for the role checklists). */
export function permissionLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(LABEL)) out[k] = permissionLabelText(k);
  return out;
}

/** The name of a permission area (People, Build, …) in the current language; an unknown area keeps its name. */
export function permissionAreaName(area: Pick<PermissionArea, "key" | "name">, scope: "platform" | "workspace"): string {
  return own(scope === "platform" ? PLATFORM_AREA : WORKSPACE_AREA, area.key)?.() ?? area.name;
}

/** The areas with their names in the current language. */
export function localizedAreas<P extends string>(areas: readonly PermissionArea<P>[], scope: "platform" | "workspace"): PermissionArea<P>[] {
  return areas.map((a) => ({ ...a, name: permissionAreaName(a, scope) }));
}

/** A built-in organization role's name (owner, member, viewer) in the current language; other roles keep their name. */
export function builtInRoleName(key: string, english: string): string {
  return own(ROLE_NAME, key)?.() ?? english;
}

/** A built-in organization role's one-line hint in the current language; other roles keep their description. */
export function builtInRoleHint(key: string, english: string): string {
  return own(ROLE_HINT, key)?.() ?? english;
}

/** Roles with the built-in ones named in the current language (custom roles are data and stay as they are). */
export function localizedRoles<R extends { key: string; name: string; description?: string }>(roles: readonly R[]): R[] {
  return roles.map((r) => ({ ...r, name: builtInRoleName(r.key, r.name), ...(r.description ? { description: builtInRoleHint(r.key, r.description) } : {}) }));
}

/** The platform admin role's name in the current language. */
export function platformAdminRoleName(english: string): string {
  return english === "Platform admin" ? t("platform.permissions.platformAdminRole", "Platform admin") : english;
}

/** The custom roles a role key is looked up in (the open workspace's, as in the workspace store). */
type CustomRoleNames = readonly { key: string; name: string; isBuiltIn?: boolean }[];

/** The role on the account button under the person's name and as the chip in the account menu's head: "Super admin" for
 *  a platform super admin; else their role in the open workspace, read from the same membership role key and custom roles
 *  their permissions there come from (a built-in role by its name in the current language, a custom role by its own
 *  name). Null until the workspaces have loaded, and without an open workspace. */
export function accountRoleLine(a: { isSuperAdmin: boolean; ready: boolean; roleKey: string | null; customRoles: CustomRoleNames }): string | null {
  if (a.isSuperAdmin) return t("shell.account.superAdmin", "Super admin");
  if (!a.ready || !a.roleKey) return null;
  if (isWorkspaceRole(a.roleKey)) return builtInRoleName(a.roleKey, WORKSPACE_ROLE_LABEL[a.roleKey]);
  const custom = a.customRoles.find((r) => !r.isBuiltIn && r.key === a.roleKey);
  return custom?.name.trim() || t("shell.account.customRole", "Custom role");
}

/** My role in one workspace of a workspace list (the account menu's, the switcher's), named like the account button's
 *  line: a built-in role in the current language, a custom role by its own name. A platform super admin may do
 *  everything in every workspace, so each row says Workspace admin, as the workspace store resolves it. */
export function workspaceRoleLabel(w: { roleKey: string; roleName: string }, c: { isSuperAdmin: boolean; customRoles: CustomRoleNames }): string {
  const roleKey = c.isSuperAdmin ? "owner" : w.roleKey;
  return accountRoleLine({ isSuperAdmin: false, ready: true, roleKey, customRoles: c.customRoles }) ?? w.roleName;
}
