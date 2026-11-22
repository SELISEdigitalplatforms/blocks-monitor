// The migration plan: what Blocks IAM must gain so it holds today's Factory roles, permissions and grants.
// Pure: computed from a FactorySnapshot and an IamSnapshot; apply.ts carries it out.
//
// What it maps (the shared IAM contract):
//   every Factory permission key            -> an IAM permission named by the key (resource madp-factory)
//   super admin (today's IAM role mf-super-admin) -> also mf-platform-super-admin, the IAM-mode super admin role
//   built-in Platform admin / platform roles -> mf-platform-admin / mf-platform-<key>, their permissions
//   organization role templates             -> mf-tpl-<key>
//   built-in organization roles             -> mf-org-owner | mf-org-member | mf-org-viewer
//   an organization's custom roles          -> mf-org-<first 8 letters/digits of the workspace id>-<key>
// Slugs come from functions/_lib/iamAdmin.ts; names and descriptions from the iam.sync op's expectedRoles
// (functions/admin/ops/iam/shared.ts), so the migration, iam.sync and iam.status agree on every role.
//   every workspace                         -> one IAM organization, linked through Workspace.IamOrganizationId
//   active platform role assignments        -> the user's platform-wide (no organization) IAM roles
//   active memberships                      -> the user's IAM roles in the workspace's organization
// Roles outside the mf-platform-/mf-org-/mf-tpl- names (mf-super-admin, mf-user, clouduser, ...) are never touched:
// IAM's access call replaces a whole list, so every grant sends what the user holds now plus what they gain.
import { expectedRoles } from "../../../functions/admin/ops/iam/shared";
import type { PlatformRoleRow, WorkspaceRoleRow } from "../../../functions/workspace/ops/_shared/records";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_LABEL,
  isPlatformPermission,
  isWorkspacePermission,
  isWorkspaceRole,
} from "../../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE } from "../../../src/domain/roles";
import { PERMISSION_DESCRIPTION } from "../../../src/domain/permissions";
import {
  FACTORY_PERMISSION_KEYS,
  IAM_SUPER_ADMIN_SLUG,
  SUPER_ADMIN_SLUG,
  FACTORY_RESOURCE_GROUP,
  isManagedSlug,
  orgRoleSlug,
  platformRoleSlug,
  sortedUnique,
  templateRoleSlug,
  workspaceIdOfOrganization,
  workspaceShortId,
  type FactorySnapshot,
  type IamAccessSet,
  type IamPermissionRecord,
  type IamSnapshot,
} from "./model";

/** The steps in the order they run (grants: organization grants before link, platform grants after it). */
export const STEPS = ["permissions", "roles", "organizations", "grants", "link"] as const;
export type Step = (typeof STEPS)[number];

export function isStep(x: unknown): x is Step {
  return typeof x === "string" && (STEPS as readonly string[]).includes(x);
}

export type RoleSource = "super-admin" | "platform-builtin" | "platform" | "template" | "org-builtin" | "org-custom";

export interface RoleSpec {
  slug: string;
  name: string;
  description: string;
  /** Factory permission keys, catalogue order. */
  permissions: string[];
  source: RoleSource;
  workspaceId?: string;
  /** The Factory role key the slug was made from. */
  key: string;
}

export interface RoleUpdate {
  spec: RoleSpec;
  add: string[];
  remove: string[];
  /** Name or description differ from IAM's. */
  relabel: boolean;
}

export interface OrgCreate {
  workspaceId: string;
  workspaceItemId: string;
  name: string;
}

export interface OrgLink {
  workspaceId: string;
  workspaceItemId: string;
  organizationId: string;
}

export interface GrantPlan {
  userId: string;
  /** null = platform-wide. */
  workspaceId: string | null;
  /** IAM organization id; null for platform-wide, or while the workspace's organization is still to be created. */
  organizationId: string | null;
  /** Roles the user holds there now. */
  current: string[];
  /** Managed roles to give. */
  add: string[];
  /** Managed roles the Factory no longer gives (taken away only with prune). */
  remove: string[];
  /** The whole list sent to IAM: current + add (- remove when pruning). */
  roles: string[];
}

export interface MigrationPlan {
  /** Reasons a step cannot run; each names the step first ("organizations: ..."). */
  blockers: string[];
  warnings: string[];
  permissions: { create: { key: string; description: string }[]; existing: number; stale: string[] };
  roles: { create: RoleSpec[]; update: RoleUpdate[]; unchanged: string[] };
  organizations: { create: OrgCreate[]; link: OrgLink[]; linked: number };
  grants: GrantPlan[];
  prune: boolean;
}

/** True when an IAM permission is one of the Factory's (by name, in the Factory's resource group or resource). */
export function isFactoryPermissionRecord(p: IamPermissionRecord): boolean {
  if (!FACTORY_PERMISSION_KEYS.includes(p.name)) return false;
  if (p.resourceGroup === FACTORY_RESOURCE_GROUP) return true;
  const r = p.resource ?? "";
  return r === FACTORY_RESOURCE_GROUP || r.startsWith(`${FACTORY_RESOURCE_GROUP}::`);
}

const catalogueOrder = (keys: Iterable<string>): string[] => {
  const set = new Set(keys);
  return FACTORY_PERMISSION_KEYS.filter((k) => set.has(k));
};

/** A role's name and description as iam-core's upsertRole stores them (trimmed, at most 120 / 300 characters). */
const label = (slug: string, name: string, description: string) => ({
  name: name.trim().slice(0, 120) || slug,
  description: description.slice(0, 300),
});

/** Every role IAM must hold, by slug; a second role on the same slug is a blocker. */
export function desiredRoles(f: FactorySnapshot): { roles: Map<string, RoleSpec>; blockers: string[] } {
  const roles = new Map<string, RoleSpec>();
  const blockers: string[] = [];
  const add = (spec: RoleSpec) => {
    const had = roles.get(spec.slug);
    if (had) {
      blockers.push(`roles: ${spec.slug} would stand for both ${had.source} "${had.key}"${had.workspaceId ? ` (${had.workspaceId})` : ""} and ${spec.source} "${spec.key}"${spec.workspaceId ? ` (${spec.workspaceId})` : ""}`);
      return;
    }
    roles.set(spec.slug, spec);
  };

  add({
    slug: IAM_SUPER_ADMIN_SLUG,
    key: "super-admin",
    ...label(IAM_SUPER_ADMIN_SLUG, "Super admin", "Top of everything: every platform permission, and every organization permission by rule."),
    permissions: [...PLATFORM_PERMISSIONS],
    source: "super-admin",
  });
  const adminSlug = platformRoleSlug(PLATFORM_ADMIN_ROLE.key);
  add({
    slug: adminSlug,
    key: PLATFORM_ADMIN_ROLE.key,
    ...label(adminSlug, PLATFORM_ADMIN_ROLE.name, PLATFORM_ADMIN_ROLE.description ?? ""),
    permissions: catalogueOrder(PLATFORM_ADMIN_ROLE.permissions),
    source: "platform-builtin",
  });
  for (const r of f.platformRoles) {
    if (r.scope === "organization") {
      const slug = templateRoleSlug(r.key);
      add({ slug, key: r.key, ...label(slug, r.name, r.description), permissions: catalogueOrder(r.permissions.filter(isWorkspacePermission)), source: "template" });
    } else if (r.key !== PLATFORM_ADMIN_ROLE.key) {
      const slug = platformRoleSlug(r.key);
      add({ slug, key: r.key, ...label(slug, r.name, r.description), permissions: catalogueOrder(r.permissions.filter(isPlatformPermission)), source: "platform" });
    }
  }
  for (const key of WORKSPACE_ROLES) {
    const slug = orgRoleSlug(key, "");
    add({
      slug,
      key,
      ...label(slug, WORKSPACE_ROLE_LABEL[key] || key, `Organization role ${key} (all organizations)`),
      permissions: catalogueOrder(BUILT_IN_ROLE_PERMISSIONS[key]),
      source: "org-builtin",
    });
  }
  const shortIds = new Map<string, string>();
  for (const w of f.workspaces) {
    const s = workspaceShortId(w.workspaceId);
    const other = shortIds.get(s);
    if (other && other !== w.workspaceId) blockers.push(`roles: workspaces ${other} and ${w.workspaceId} share the short id ${s}`);
    shortIds.set(s, w.workspaceId);
  }
  for (const r of f.workspaceRoles) {
    if (r.isBuiltIn || isWorkspaceRole(r.key)) continue;
    const slug = orgRoleSlug(r.key, r.workspaceId);
    add({
      slug,
      key: r.key,
      workspaceId: r.workspaceId,
      ...label(slug, r.name || r.key, r.description),
      permissions: catalogueOrder(r.permissions.filter(isWorkspacePermission)),
      source: "org-custom",
    });
  }
  // Names and descriptions exactly as iam.sync expects them (its drift check compares them).
  const expected = expectedRoles({
    platformRoles: f.platformRoles.map((r) => ({ Key: r.key, Name: r.name, Description: r.description, Permissions: r.permissions, IsBuiltIn: r.isBuiltIn, ...(r.scope === "organization" ? { Scope: "organization" } : {}) }) as unknown as PlatformRoleRow),
    workspaceRoles: f.workspaceRoles
      .filter((r) => !r.isBuiltIn && !isWorkspaceRole(r.key))
      .map((r) => ({ WorkspaceId: r.workspaceId, Key: r.key, Name: r.name, Description: r.description, Permissions: r.permissions, IsBuiltIn: false }) as unknown as WorkspaceRoleRow),
    workspaces: f.workspaces.map((w) => ({ ItemId: w.workspaceId, WorkspaceId: w.workspaceId, Name: w.name, Status: w.status })) as never,
  });
  for (const e of expected) {
    const spec = roles.get(e.slug);
    if (spec) Object.assign(spec, label(e.slug, e.name, e.description));
  }
  return { roles, blockers };
}

function diffAccess(current: IamAccessSet | undefined, wanted: string[], managed: (slug: string) => boolean, prune: boolean) {
  const cur = sortedUnique(current?.roles ?? []);
  const add = wanted.filter((s) => !cur.includes(s));
  const remove = cur.filter((s) => managed(s) && !wanted.includes(s));
  const roles = sortedUnique([...cur.filter((s) => !(prune && remove.includes(s))), ...add]);
  return { current: cur, add, remove, roles };
}

/** The whole plan. `prune` also takes managed roles away that the Factory no longer gives. */
export function planMigration(f: FactorySnapshot, iam: IamSnapshot, o: { prune?: boolean } = {}): MigrationPlan {
  const prune = o.prune === true;
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. permissions
  const factoryPerms = iam.permissions.filter(isFactoryPermissionRecord);
  const have = new Set(factoryPerms.map((p) => p.name));
  const permissions = {
    create: FACTORY_PERMISSION_KEYS.filter((k) => !have.has(k)).map((key) => ({
      key,
      description: (PERMISSION_DESCRIPTION as Record<string, string>)[key] ?? key,
    })),
    existing: have.size,
    stale: [] as string[],
  };
  const named = iam.permissions.filter((p) => FACTORY_PERMISSION_KEYS.includes(p.name) && !isFactoryPermissionRecord(p));
  for (const p of named) warnings.push(`permissions: IAM already has a permission named "${p.name}" outside ${FACTORY_RESOURCE_GROUP} (${p.resource ?? "no resource"}); a separate one is created`);

  // 2. roles
  const { roles: wanted, blockers: roleBlockers } = desiredRoles(f);
  blockers.push(...roleBlockers);
  const iamRoles = new Map(iam.roles.map((r) => [r.slug, r]));
  const roles: MigrationPlan["roles"] = { create: [], update: [], unchanged: [] };
  for (const spec of wanted.values()) {
    const cur = iamRoles.get(spec.slug);
    if (!cur) {
      roles.create.push(spec);
      continue;
    }
    const held = cur.permissions.filter((p) => FACTORY_PERMISSION_KEYS.includes(p));
    const add = spec.permissions.filter((p) => !held.includes(p));
    const remove = catalogueOrder(held.filter((p) => !spec.permissions.includes(p)));
    const relabel = cur.name !== spec.name || (cur.description ?? "") !== spec.description;
    if (add.length || remove.length || relabel) roles.update.push({ spec, add, remove, relabel });
    else roles.unchanged.push(spec.slug);
  }
  for (const r of iam.roles) {
    if (isManagedSlug(r.slug) && !wanted.has(r.slug)) warnings.push(`roles: IAM role ${r.slug} has no Factory role any more (left as it is)`);
  }

  // 3. organizations and 4. link
  if (!iam.multiOrgEnabled) {
    blockers.push("organizations: multi-organization mode is off on this tenant (read live from IAM's organization config); turn it on first (one-way: blocks iam organizations config save --multi-org-enabled --consent-for-multi-org-enable), then rerun");
  }
  if (!f.workspaceLinkFieldReady) {
    blockers.push("link: the tenant's Workspace schema has no IamOrganizationId field yet; apply the additive schema change first");
  }
  const orgById = new Map(iam.organizations.map((o2) => [o2.id, o2]));
  const orgByWorkspace = new Map<string, string>();
  for (const org of iam.organizations) {
    const ws = workspaceIdOfOrganization(org);
    if (ws && !orgByWorkspace.has(ws)) orgByWorkspace.set(ws, org.id);
  }
  const organizations: MigrationPlan["organizations"] = { create: [], link: [], linked: 0 };
  /** Workspace id -> IAM organization id, for the ones that exist now. */
  const orgOf = new Map<string, string>();
  for (const w of f.workspaces) {
    if (w.iamOrganizationId && (orgById.has(w.iamOrganizationId) || !iam.multiOrgEnabled)) {
      orgOf.set(w.workspaceId, w.iamOrganizationId);
      organizations.linked += 1;
      continue;
    }
    if (w.iamOrganizationId) warnings.push(`organizations: workspace ${w.workspaceId} is linked to ${w.iamOrganizationId}, which IAM does not list; it is linked again`);
    const found = orgByWorkspace.get(w.workspaceId);
    if (found) {
      orgOf.set(w.workspaceId, found);
      organizations.link.push({ workspaceId: w.workspaceId, workspaceItemId: w.itemId, organizationId: found });
    } else {
      organizations.create.push({ workspaceId: w.workspaceId, workspaceItemId: w.itemId, name: w.name || w.workspaceId });
    }
  }

  // 5. grants
  const grants: GrantPlan[] = [];
  const platformKeys = new Set([PLATFORM_ADMIN_ROLE.key, ...f.platformRoles.filter((r) => r.scope !== "organization").map((r) => r.key)]);
  const platformWanted = new Map<string, Set<string>>();
  for (const a of f.assignments) {
    if (a.status !== "active" || !a.userId) continue;
    if (!platformKeys.has(a.roleKey)) {
      warnings.push(`grants: ${a.userId} holds platform role "${a.roleKey}", which does not exist (gives nothing today; skipped)`);
      continue;
    }
    const set = platformWanted.get(a.userId) ?? new Set<string>();
    set.add(platformRoleSlug(a.roleKey));
    platformWanted.set(a.userId, set);
  }
  // Today's super admins also get the IAM-mode super admin role (the safety role on the token stays as it is).
  for (const [userId, acc] of Object.entries(iam.access)) {
    if (!acc.platform.roles.includes(SUPER_ADMIN_SLUG)) continue;
    const set = platformWanted.get(userId) ?? new Set<string>();
    set.add(IAM_SUPER_ADMIN_SLUG);
    platformWanted.set(userId, set);
  }
  const platformUsers = sortedUnique([
    ...platformWanted.keys(),
    ...Object.entries(iam.access)
      .filter(([, acc]) => acc.platform.roles.some((s) => s.startsWith("mf-platform-")))
      .map(([u]) => u),
  ]);
  for (const userId of platformUsers) {
    const want = sortedUnique(platformWanted.get(userId) ?? []);
    const d = diffAccess(iam.access[userId]?.platform, want, (s) => s.startsWith("mf-platform-"), prune);
    if (d.add.length || (d.remove.length && prune)) grants.push({ userId, workspaceId: null, organizationId: null, ...d });
    else if (d.remove.length) warnings.push(`grants: ${userId} still holds ${d.remove.join(", ")} platform-wide in IAM (run with --prune to take it away)`);
  }

  const customKeys = new Map<string, Set<string>>();
  for (const r of f.workspaceRoles) {
    if (r.isBuiltIn || isWorkspaceRole(r.key)) continue;
    const set = customKeys.get(r.workspaceId) ?? new Set<string>();
    set.add(r.key);
    customKeys.set(r.workspaceId, set);
  }
  const known = new Set(f.workspaces.map((w) => w.workspaceId));
  /** "userId|workspaceId" -> wanted slug. */
  const orgWanted = new Map<string, string>();
  for (const m of f.memberships) {
    if (m.status !== "active" || !m.userId) continue;
    if (!known.has(m.workspaceId)) {
      warnings.push(`grants: ${m.userId} is a member of workspace ${m.workspaceId}, which has no Workspace row (skipped)`);
      continue;
    }
    if (!isWorkspaceRole(m.roleKey) && !customKeys.get(m.workspaceId)?.has(m.roleKey)) {
      warnings.push(`grants: ${m.userId} holds role "${m.roleKey}" in ${m.workspaceId}, which does not exist there (gives nothing today; skipped)`);
      continue;
    }
    orgWanted.set(`${m.userId}|${m.workspaceId}`, orgRoleSlug(m.roleKey, m.workspaceId));
  }
  const wsOfOrg = new Map<string, string>([...orgOf].map(([ws, org]) => [org, ws]));
  const pairs = new Set(orgWanted.keys());
  for (const [userId, acc] of Object.entries(iam.access)) {
    for (const [orgId, set] of Object.entries(acc.orgs)) {
      const ws = wsOfOrg.get(orgId);
      if (ws && set.roles.some((s) => s.startsWith("mf-org-"))) pairs.add(`${userId}|${ws}`);
    }
  }
  for (const pair of [...pairs].sort()) {
    const [userId, workspaceId] = pair.split("|");
    const organizationId = orgOf.get(workspaceId) ?? null;
    const want = orgWanted.has(pair) ? [orgWanted.get(pair) as string] : [];
    const current = organizationId ? iam.access[userId]?.orgs[organizationId] : undefined;
    const d = diffAccess(current, want, (s) => s.startsWith("mf-org-"), prune);
    if (d.add.length || (d.remove.length && prune)) grants.push({ userId, workspaceId, organizationId, ...d });
    else if (d.remove.length) warnings.push(`grants: ${userId} still holds ${d.remove.join(", ")} in ${workspaceId} in IAM (run with --prune to take it away)`);
  }

  return { blockers, warnings, permissions, roles, organizations, grants, prune };
}

/** The blockers that stop a step (organization grants also wait for their organization; platform grants do not). */
export function blockersOf(plan: MigrationPlan, step: Step): string[] {
  return plan.blockers.filter((b) => b.startsWith(`${step}:`));
}

/** Plain-text summary lines, for the console. */
export function describePlan(plan: MigrationPlan): string[] {
  const out: string[] = [];
  const platformGrants = plan.grants.filter((g) => g.workspaceId === null);
  const orgGrants = plan.grants.filter((g) => g.workspaceId !== null);
  out.push(`permissions: ${plan.permissions.create.length} to create, ${plan.permissions.existing} already in IAM`);
  for (const p of plan.permissions.create) out.push(`  + ${p.key}`);
  out.push(`roles: ${plan.roles.create.length} to create, ${plan.roles.update.length} to update, ${plan.roles.unchanged.length} unchanged`);
  for (const r of plan.roles.create) out.push(`  + ${r.slug} "${r.name}" [${r.source}] ${r.permissions.length} permissions: ${r.permissions.join(", ")}`);
  for (const u of plan.roles.update) {
    const bits = [u.add.length ? `+${u.add.join(" +")}` : "", u.remove.length ? `-${u.remove.join(" -")}` : "", u.relabel ? "name/description" : ""].filter(Boolean);
    out.push(`  ~ ${u.spec.slug}: ${bits.join("; ")}`);
  }
  out.push(`organizations: ${plan.organizations.create.length} to create, ${plan.organizations.link.length} to link, ${plan.organizations.linked} already linked`);
  for (const o of plan.organizations.create) out.push(`  + "${o.name}" for workspace ${o.workspaceId}`);
  for (const l of plan.organizations.link) out.push(`  = workspace ${l.workspaceId} -> ${l.organizationId}`);
  const users = new Set(plan.grants.map((g) => g.userId)).size;
  out.push(`grants: ${platformGrants.length} platform-wide, ${orgGrants.length} in organizations (${users} people)${plan.prune ? ", pruning" : ""}`);
  for (const g of plan.grants) {
    const where = g.workspaceId === null ? "platform" : `${g.workspaceId}${g.organizationId ? ` (${g.organizationId})` : " (organization still to create)"}`;
    const bits = [g.add.length ? `+${g.add.join(" +")}` : "", g.remove.length ? `-${g.remove.join(" -")}${plan.prune ? "" : " (kept: no --prune)"}` : ""].filter(Boolean);
    out.push(`  ${g.userId} @ ${where}: ${bits.join(" ")} -> [${g.roles.join(", ")}]`);
  }
  for (const b of plan.blockers) out.push(`BLOCKED ${b}`);
  for (const w of plan.warnings) out.push(`note ${w}`);
  return out;
}

/** Counts for the report and the console's last line. */
export function planCounts(plan: MigrationPlan) {
  return {
    permissionsToCreate: plan.permissions.create.length,
    rolesToCreate: plan.roles.create.length,
    rolesToUpdate: plan.roles.update.length,
    organizationsToCreate: plan.organizations.create.length,
    workspacesToLink: plan.organizations.link.length + plan.organizations.create.length,
    platformGrants: plan.grants.filter((g) => g.workspaceId === null).length,
    organizationGrants: plan.grants.filter((g) => g.workspaceId !== null).length,
    blockers: plan.blockers.length,
    warnings: plan.warnings.length,
  };
}
