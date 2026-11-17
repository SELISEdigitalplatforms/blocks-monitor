// What the iam.* ops share: the role source setting, the Factory <-> Blocks OS IAM names (permission keys, role slugs,
// organizations), the Factory's expected IAM state and the plan that brings IAM in step with it, and IAM error codes.
import { BUILT_IN_ROLE_PERMISSIONS, PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS, WORKSPACE_ROLES, WORKSPACE_ROLE_LABEL, type PlatformPermission } from "../../../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE } from "../../../../src/domain/roles";
import { fail, type Caller } from "../../../workspace/ops/_shared/core";
import type { IamDirectory, IamDirectoryRole, OpAnswer, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, type MembershipRow, type PlatformRoleAssignmentRow, type PlatformRoleRow, type PlatformSettingRow, type WorkspaceRoleRow } from "../../../workspace/ops/_shared/records";

export const RBAC_SOURCE_KEY = "rbac.source";
export const IAM_SYNC_KEY = "iam.sync";
export const IAM_PARITY_KEY = "iam.parity";
export type RbacSource = "factory" | "iam";
export const isRbacSource = (v: unknown): v is RbacSource => v === "factory" || v === "iam";

/** Who may read the IAM status, roles and permissions. */
export const IAM_READ_PERMISSIONS: readonly PlatformPermission[] = ["platform.roles.manage", "platform.people.manage"];
/** The roles, permissions and organizations in IAM that the Factory owns carry this prefix and resource. */
export const IAM_RESOURCE = "madp-factory";
export const PERMISSION_CATALOG: readonly string[] = [...PLATFORM_PERMISSIONS, ...WORKSPACE_PERMISSIONS];
export const MAX_SYNC_PEOPLE = 300;

/** Platform admins (the super admin or a holder of the built-in Platform admin role) apply a sync and switch the source. */
export const isPlatformAdmin = (caller: Caller): boolean => caller.isSuperAdmin || caller.platform.roleKeys.includes(PLATFORM_ADMIN_ROLE.key);

// ---------------------------------------------------------------- names

export type RoleScope = "platform" | "template" | "organization";

/** The first 8 letters and digits of a workspace id: the organization part of an organization-only role slug. */
export const workspaceShortId = (workspaceId: string): string => workspaceId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();

export function roleSlug(scope: RoleScope, key: string, workspaceId?: string): string {
  if (scope === "platform") return key === PLATFORM_ADMIN_ROLE.key ? "mf-platform-admin" : `mf-platform-${key}`;
  if (scope === "template") return `mf-tpl-${key}`;
  if ((WORKSPACE_ROLES as readonly string[]).includes(key)) return `mf-org-${key}`;
  return `mf-org-${workspaceShortId(workspaceId ?? "")}-${key}`;
}

/** True for a role slug the Factory owns (identity roles such as mf-user stay outside). */
export const isFactoryRoleSlug = (slug: string): boolean => /^mf-(platform|org|tpl)-/.test(slug);

export interface ParsedSlug { scope: RoleScope; key: string; builtIn: boolean; workspaceId?: string }

/** Reads a Factory role slug back; organization-only roles name their organization by its short id. */
export function parseRoleSlug(slug: string, workspaceIds: readonly string[]): ParsedSlug | null {
  if (slug === "mf-platform-admin") return { scope: "platform", key: PLATFORM_ADMIN_ROLE.key, builtIn: true };
  if (slug.startsWith("mf-platform-")) return { scope: "platform", key: slug.slice(12), builtIn: false };
  if (slug.startsWith("mf-tpl-")) return { scope: "template", key: slug.slice(7), builtIn: false };
  if (!slug.startsWith("mf-org-")) return null;
  const rest = slug.slice(7);
  if ((WORKSPACE_ROLES as readonly string[]).includes(rest)) return { scope: "organization", key: rest, builtIn: true };
  const m = /^([a-z0-9]{1,8})-(.+)$/.exec(rest);
  if (!m) return null;
  const workspaceId = workspaceIds.find((id) => workspaceShortId(id) === m[1]);
  return { scope: "organization", key: m[2], builtIn: false, ...(workspaceId ? { workspaceId } : {}) };
}

/** IAM failures as plain answers. Never retried by the client: a 503 would be. */
export function iamCodeOf(e: unknown): "iam.unavailable" | "iam.forbidden" | "iam.notFound" {
  const raw = typeof e === "object" && e !== null ? (e as { code?: unknown; message?: unknown }) : {};
  const code = typeof raw.code === "string" ? raw.code : typeof raw.message === "string" ? raw.message : "";
  if (code === "iam.forbidden") return "iam.forbidden";
  if (code === "iam.notFound") return "iam.notFound";
  return "iam.unavailable";
}
export function iamFail(e: unknown): OpAnswer<never> {
  const key = iamCodeOf(e);
  return fail(key === "iam.forbidden" ? "forbidden" : key === "iam.notFound" ? "not_found" : "not_supported", key);
}
export const noIam = (): OpAnswer<never> => fail("not_supported", "iam.unavailable");
export const directoryOf = (deps: OpDeps): IamDirectory | null => deps.iamDirectory ?? null;

// ---------------------------------------------------------------- Factory reads

export const WORKSPACE_IAM_FIELDS = ["ItemId", "Name", "Status", "IamOrganizationId"] as const;
export interface WorkspaceIamRow { ItemId: string; Name: string; Status: string; IamOrganizationId?: string }

const SETTING_FIELDS = ["ItemId", "Key", "ValueJson"] as const;
export const settingsRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, {
    filter: { Key: { in: [RBAC_SOURCE_KEY, IAM_SYNC_KEY, IAM_PARITY_KEY] } },
    fields: SETTING_FIELDS,
  });

const parseJson = (v: string | undefined): unknown => {
  try { return v ? JSON.parse(v) : null; } catch { return null; }
};
export function sourceOf(rows: readonly PlatformSettingRow[]): RbacSource {
  const v = parseJson(rows.find((r) => r.Key === RBAC_SOURCE_KEY)?.ValueJson);
  return isRbacSource(v) ? v : "factory";
}
export function settingValue<T>(rows: readonly PlatformSettingRow[], key: string): T | null {
  const v = parseJson(rows.find((r) => r.Key === key)?.ValueJson);
  return v && typeof v === "object" ? (v as T) : null;
}

export async function writeSetting(deps: OpDeps, caller: Caller, rows: readonly PlatformSettingRow[], key: string, value: unknown, description: string): Promise<void> {
  const valueJson = JSON.stringify(value);
  const row = rows.find((r) => r.Key === key) ?? null;
  if (row) {
    await deps.gateway.update(SCHEMA.platformSetting, row.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
    return;
  }
  const res = await deps.gateway.insertOnce<PlatformSettingRow>(
    SCHEMA.platformSetting,
    { Key: key, Values: [], ValueJson: valueJson, ReaderIds: [], Description: description, CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId },
    `setting:${key}`,
  );
  if (!res.created) await deps.gateway.update(SCHEMA.platformSetting, res.item.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
}

export const workspacesRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<WorkspaceIamRow>(SCHEMA.workspace, { filter: {}, fields: WORKSPACE_IAM_FIELDS, maxItems: 5000 });

// ---------------------------------------------------------------- expected state and plan

export interface ExpectedRole { slug: string; scope: RoleScope; key: string; workspaceId?: string; name: string; description: string; permissions: string[] }

export interface FactoryState {
  platformRoles: readonly PlatformRoleRow[];
  workspaceRoles: readonly WorkspaceRoleRow[];
  workspaces: readonly WorkspaceIamRow[];
  assignments: readonly PlatformRoleAssignmentRow[];
  memberships: readonly MembershipRow[];
}

export const platformRolesRead = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: ["ItemId", "Key", "Name", "Description", "Permissions", "Scope"], maxItems: 1000 });

/** The custom roles of these workspaces (a WorkspaceRole read always names its workspaces). */
export const workspaceRolesOf = (deps: OpDeps, workspaceIds: readonly string[]): Promise<WorkspaceRoleRow[]> =>
  workspaceIds.length
    ? deps.gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, { filter: { WorkspaceId: { in: workspaceIds } }, fields: ["ItemId", "WorkspaceId", "Key", "Name", "Description", "Permissions"], maxItems: 5000 })
    : Promise.resolve([]);

export async function readFactoryState(deps: OpDeps): Promise<FactoryState> {
  const workspacesNow = workspacesRead(deps)();
  const [platformRoles, workspaceRoles, workspaces, assignments, memberships] = await Promise.all([
    platformRolesRead(deps)(),
    workspacesNow.then((ws) => workspaceRolesOf(deps, ws.map((w) => w.ItemId))),
    workspacesNow,
    deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, { filter: { Status: "active" }, fields: ["ItemId", "UserId", "RoleKey", "Status"], maxItems: 5000 }),
    deps.gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { Status: "active" }, fields: ["ItemId", "WorkspaceId", "UserId", "Email", "RoleKey", "Status"], maxItems: 20000 }),
  ]);
  return { platformRoles, workspaceRoles, workspaces, assignments, memberships };
}

const isTemplateRow = (r: PlatformRoleRow): boolean => (r as PlatformRoleRow & { Scope?: string }).Scope === "organization";

export function expectedRoles(s: Pick<FactoryState, "platformRoles" | "workspaceRoles" | "workspaces">): ExpectedRole[] {
  const names = new Map(s.workspaces.map((w) => [w.ItemId, w.Name]));
  const out: ExpectedRole[] = [
    { slug: roleSlug("platform", PLATFORM_ADMIN_ROLE.key), scope: "platform", key: PLATFORM_ADMIN_ROLE.key, name: PLATFORM_ADMIN_ROLE.name, description: "Every platform permission (built-in).", permissions: [...PLATFORM_PERMISSIONS] },
    ...WORKSPACE_ROLES.map((key): ExpectedRole => ({
      slug: roleSlug("organization", key), scope: "organization", key, name: WORKSPACE_ROLE_LABEL[key],
      description: "Built-in organization role.", permissions: [...BUILT_IN_ROLE_PERMISSIONS[key]],
    })),
  ];
  for (const r of s.platformRoles) {
    const scope: RoleScope = isTemplateRow(r) ? "template" : "platform";
    out.push({ slug: roleSlug(scope, r.Key), scope, key: r.Key, name: r.Name ?? r.Key, description: r.Description ?? "", permissions: [...(r.Permissions ?? [])] });
  }
  for (const r of s.workspaceRoles) {
    out.push({
      slug: roleSlug("organization", r.Key, r.WorkspaceId), scope: "organization", key: r.Key, workspaceId: r.WorkspaceId,
      name: r.Name ?? r.Key, description: `Role of the organization ${names.get(r.WorkspaceId) ?? r.WorkspaceId}.`, permissions: [...(r.Permissions ?? [])],
    });
  }
  return out;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
const factoryPermissions = (r: IamDirectoryRole): string[] => (r.permissions ?? []).filter((p) => PERMISSION_CATALOG.includes(p));

export interface GrantLine { userId: string; email: string; workspaceId?: string; organizationId?: string; roles: string[] }
export interface IamPlan {
  direction: "factory-to-iam" | "fill-missing";
  permissions: { create: string[] };
  roles: { create: { slug: string; name: string }[]; update: { slug: string; name: string; add: string[]; remove: string[] }[]; onlyInIam: string[] };
  organizations: { create: { workspaceId: string; name: string }[] };
  grants: { add: GrantLine[]; remove: GrantLine[]; peopleChecked: number; peopleNotChecked: number };
  drift: number;
}

/** Definitions only: permissions, roles and organizations (three IAM reads). */
export function planDefinitions(
  source: RbacSource,
  expected: readonly ExpectedRole[],
  workspaces: readonly WorkspaceIamRow[],
  iam: { permissions: readonly { name: string }[]; roles: readonly IamDirectoryRole[]; organizations: readonly { id: string }[] },
): Omit<IamPlan, "grants" | "drift"> & { definitionDrift: number } {
  const have = new Set(iam.permissions.map((p) => p.name));
  const createPerms = PERMISSION_CATALOG.filter((k) => !have.has(k));
  const bySlug = new Map(iam.roles.map((r) => [r.slug, r]));
  const create: IamPlan["roles"]["create"] = [];
  const update: IamPlan["roles"]["update"] = [];
  for (const e of expected) {
    const r = bySlug.get(e.slug);
    if (!r) { create.push({ slug: e.slug, name: e.name }); continue; }
    const now = factoryPermissions(r);
    if (!sameSet(now, e.permissions)) update.push({ slug: e.slug, name: e.name, add: e.permissions.filter((p) => !now.includes(p)), remove: now.filter((p) => !e.permissions.includes(p)) });
  }
  const expectedSlugs = new Set(expected.map((e) => e.slug));
  const onlyInIam = iam.roles.map((r) => r.slug).filter((s) => isFactoryRoleSlug(s) && !expectedSlugs.has(s)).sort();
  const orgIds = new Set(iam.organizations.map((o) => o.id));
  const createOrgs = workspaces
    .filter((w) => w.Status !== "archived" && (!w.IamOrganizationId || !orgIds.has(w.IamOrganizationId)))
    .map((w) => ({ workspaceId: w.ItemId, name: w.Name }));
  return {
    direction: source === "factory" ? "factory-to-iam" : "fill-missing",
    permissions: { create: createPerms },
    roles: { create, update, onlyInIam },
    organizations: { create: createOrgs },
    definitionDrift: createPerms.length + create.length + update.length + onlyInIam.length + createOrgs.length,
  };
}

/** What each person should hold in IAM, by organization ("" = platform-wide). */
export function expectedGrants(s: FactoryState): Map<string, { email: string; byOrg: Map<string, Set<string>> }> {
  const out = new Map<string, { email: string; byOrg: Map<string, Set<string>> }>();
  const roleScope = new Map(s.platformRoles.map((r) => [r.Key, isTemplateRow(r) ? "template" : "platform"]));
  const at = (userId: string, email: string, ws: string) => {
    const e = out.get(userId) ?? { email, byOrg: new Map<string, Set<string>>() };
    if (!e.email && email) e.email = email;
    out.set(userId, e);
    const set = e.byOrg.get(ws) ?? new Set<string>();
    e.byOrg.set(ws, set);
    return set;
  };
  for (const a of s.assignments) {
    if (a.Status !== "active") continue;
    if (a.RoleKey !== PLATFORM_ADMIN_ROLE.key && roleScope.get(a.RoleKey) !== "platform") continue;
    at(a.UserId, "", "").add(roleSlug("platform", a.RoleKey));
  }
  const live = new Set(s.workspaces.filter((w) => w.Status !== "archived").map((w) => w.ItemId));
  for (const m of s.memberships) {
    if (m.Status !== "active" || !live.has(m.WorkspaceId) || !m.UserId) continue;
    at(m.UserId, m.Email ?? "", m.WorkspaceId).add(roleSlug("organization", m.RoleKey, m.WorkspaceId));
  }
  return out;
}

/** Grants: one IAM read per person, at most MAX_SYNC_PEOPLE people per run. */
export async function planGrants(
  iam: IamDirectory,
  state: FactoryState,
  orgOf: (workspaceId: string) => string | undefined,
): Promise<IamPlan["grants"]> {
  const wanted = expectedGrants(state);
  const people = [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b));
  const checked = people.slice(0, MAX_SYNC_PEOPLE);
  const add: GrantLine[] = [];
  const remove: GrantLine[] = [];
  const workspaceOfOrg = new Map(state.workspaces.filter((w) => w.IamOrganizationId).map((w) => [w.IamOrganizationId as string, w.ItemId]));
  const accesses = await Promise.all(checked.map(([userId]) => iam.userAccess(userId)));
  checked.forEach(([userId, want], i) => {
    const have = accesses[i];
    const heldIn = (orgId: string): string[] => (orgId ? have.orgs[orgId]?.roles ?? [] : have.platform.roles).filter(isFactoryRoleSlug);
    const seen = new Set<string>();
    for (const [ws, roles] of want.byOrg) {
      const organizationId = ws ? orgOf(ws) : "";
      const held = organizationId ? heldIn(organizationId) : ws ? [] : heldIn("");
      if (organizationId) seen.add(organizationId);
      const missing = [...roles].filter((r) => !held.includes(r));
      const extra = held.filter((r) => !roles.has(r));
      const line = { userId, email: want.email, ...(ws ? { workspaceId: ws, ...(organizationId ? { organizationId } : {}) } : {}) };
      if (missing.length) add.push({ ...line, roles: missing.sort() });
      if (extra.length) remove.push({ ...line, roles: extra.sort() });
    }
    if (!want.byOrg.has("")) {
      const extra = heldIn("");
      if (extra.length) remove.push({ userId, email: want.email, roles: extra.sort() });
    }
    for (const [orgId, g] of Object.entries(have.orgs)) {
      if (seen.has(orgId)) continue;
      const extra = g.roles.filter(isFactoryRoleSlug);
      const ws = workspaceOfOrg.get(orgId);
      if (extra.length) remove.push({ userId, email: want.email, organizationId: orgId, ...(ws ? { workspaceId: ws } : {}), roles: extra.sort() });
    }
  });
  return { add, remove, peopleChecked: checked.length, peopleNotChecked: people.length - checked.length };
}
