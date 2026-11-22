// Parity: for every person, platform-wide and in every organization, the permissions today's Factory resolver gives and
// the ones the resolver gives once rbac.source is "iam". The differences must be zero before switching the source.
//
// Factory side: src/domain/tenancy (resolvePlatformAccess / resolveWorkspaceAccess) over the Factory rows; super admin =
// today's IAM role mf-super-admin. IAM side: iam-core's own reading of IAM (functions/_lib/rbacSource.ts):
//   super admin   = mf-super-admin (the safety role) or mf-platform-super-admin;
//   platform      = platformFromIam (mf-platform-platform-admin holds all; else the held permissions, broad keys expanded);
//   organization  = only for a workspace linked through Workspace.IamOrganizationId (an unlinked one is still decided
//                   by the Factory rows); a member needs an active Membership row AND an IAM organization role there
//                   (fail closed, functions/_lib/access.ts iamBundle), and holds workspaceFromIam's permissions;
//   not a member  = the same platform route as today (super admin, or a platform manager's fixed set).
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS, isPlatformPermission, isWorkspacePermission } from "../../../src/domain/rbac";
import type { RoleDef } from "../../../src/domain/roles";
import { resolvePlatformAccess, resolveWorkspaceAccess } from "../../../src/domain/tenancy";
import { platformFromIam, workspaceFromIam } from "../../../functions/_lib/rbacSource";
import { IAM_SUPER_ADMIN_SLUG, SUPER_ADMIN_SLUG, sortedUnique, type FactorySnapshot, type IamAccessSet, type IamSnapshot } from "./model";

export interface ParityRow {
  userId: string;
  /** "platform" or a workspace id. */
  scope: string;
  organizationId: string | null;
  factory: string[];
  iam: string[];
  missingInIam: string[];
  extraInIam: string[];
}

export interface ParityResult {
  rows: ParityRow[];
  differences: ParityRow[];
  /** Workspaces with no IAM organization: everyone's access there can only come from platform permissions in IAM. */
  unlinkedWorkspaces: string[];
  people: number;
}

const IAM_KEY = "__iam__";

/** Workspace id -> IAM organization id, as the resolver sees it: only the Workspace link counts. */
export function organizationOfWorkspace(f: FactorySnapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of f.workspaces) if (w.iamOrganizationId) out.set(w.workspaceId, w.iamOrganizationId);
  return out;
}

function rolePermissionIndex(iam: IamSnapshot): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (slug: string, perm: string) => {
    const set = idx.get(slug) ?? new Set<string>();
    set.add(perm);
    idx.set(slug, set);
  };
  for (const r of iam.roles) for (const p of r.permissions) add(r.slug, p);
  for (const p of iam.permissions) for (const slug of p.roles ?? []) add(slug, p.name);
  return idx;
}

/** Raw Factory keys an IAM access set gives: direct permissions plus the permissions of its roles. */
export function iamRawPermissions(set: IamAccessSet | undefined, idx: Map<string, Set<string>>): string[] {
  if (!set) return [];
  const out = new Set<string>(set.permissions);
  for (const slug of set.roles) for (const p of idx.get(slug) ?? []) out.add(p);
  return [...out];
}

const roleDef = (r: { key: string; name: string; description?: string; permissions: string[]; isBuiltIn: boolean }): RoleDef => ({
  key: r.key,
  name: r.name,
  description: r.description,
  permissions: r.permissions,
  isBuiltIn: r.isBuiltIn,
});

function diff(userId: string, scope: string, organizationId: string | null, factory: string[], iamSide: string[]): ParityRow {
  return {
    userId,
    scope,
    organizationId,
    factory,
    iam: iamSide,
    missingInIam: factory.filter((p) => !iamSide.includes(p)),
    extraInIam: iamSide.filter((p) => !factory.includes(p)),
  };
}

export function computeParity(f: FactorySnapshot, iam: IamSnapshot): ParityResult {
  const idx = rolePermissionIndex(iam);
  const orgOf = organizationOfWorkspace(f);
  const wsOfOrg = new Map([...orgOf].map(([ws, org]) => [org, ws]));
  const platformRoles = f.platformRoles.map(roleDef);
  const customRoles = new Map<string, RoleDef[]>();
  for (const r of f.workspaceRoles) {
    const list = customRoles.get(r.workspaceId) ?? [];
    list.push(roleDef(r));
    customRoles.set(r.workspaceId, list);
  }

  const people = sortedUnique([...f.assignments.map((a) => a.userId), ...f.memberships.map((m) => m.userId), ...Object.keys(iam.access)]);
  const rows: ParityRow[] = [];

  for (const userId of people) {
    const acc = iam.access[userId];
    const platformRoles0 = acc?.platform.roles ?? [];
    const isSuperAdmin = platformRoles0.includes(SUPER_ADMIN_SLUG);
    const iamSuperAdmin = isSuperAdmin || platformRoles0.includes(IAM_SUPER_ADMIN_SLUG);
    const resolvedSet = (set: IamAccessSet | undefined): IamAccessSet => ({ roles: set?.roles ?? [], permissions: iamRawPermissions(set, idx) });

    const factoryPlatform = resolvePlatformAccess({
      isSuperAdmin,
      assignments: f.assignments.filter((a) => a.userId === userId).map((a) => ({ roleKey: a.roleKey, status: a.status })),
      platformRoles,
    }).permissions;
    const iamPlatform = platformFromIam(resolvedSet(acc?.platform), iamSuperAdmin).permissions.filter(isPlatformPermission);
    rows.push(diff(userId, "platform", null, [...factoryPlatform], [...iamPlatform]));

    const workspaces = new Set<string>(f.memberships.filter((m) => m.userId === userId).map((m) => m.workspaceId));
    for (const orgId of Object.keys(acc?.orgs ?? {})) {
      const ws = wsOfOrg.get(orgId);
      if (ws) workspaces.add(ws);
    }
    for (const workspaceId of [...workspaces].sort()) {
      const rowsHere = f.memberships.filter((m) => m.userId === userId && m.workspaceId === workspaceId);
      const membership = rowsHere.find((m) => m.status === "active") ?? rowsHere[0] ?? null;
      const factory = resolveWorkspaceAccess({
        isSuperAdmin,
        membership: membership ? { roleKey: membership.roleKey, status: membership.status } : null,
        customRoles: customRoles.get(workspaceId) ?? [],
        platformPermissions: factoryPlatform,
      }).permissions;

      const organizationId = orgOf.get(workspaceId) ?? null;
      let iamSide: string[];
      if (!organizationId) {
        // Not linked: the Factory rows still decide here, with the platform access from IAM.
        iamSide = resolveWorkspaceAccess({
          isSuperAdmin: iamSuperAdmin,
          membership: membership ? { roleKey: membership.roleKey, status: membership.status } : null,
          customRoles: customRoles.get(workspaceId) ?? [],
          platformPermissions: iamPlatform,
        }).permissions;
      } else {
        const fromIam = workspaceFromIam(resolvedSet(acc?.orgs[organizationId]), workspaceId, organizationId);
        const member = membership?.status === "active" && fromIam.roleKey !== null;
        iamSide = resolveWorkspaceAccess({
          isSuperAdmin: iamSuperAdmin,
          membership: member ? { roleKey: IAM_KEY, status: "active" } : null,
          customRoles: [{ key: IAM_KEY, name: IAM_KEY, permissions: fromIam.permissions.filter(isWorkspacePermission), isBuiltIn: false }],
          platformPermissions: iamPlatform,
        }).permissions;
      }
      rows.push(diff(userId, workspaceId, organizationId, [...factory], [...iamSide]));
    }
  }

  return {
    rows,
    differences: rows.filter((r) => r.missingInIam.length || r.extraInIam.length),
    unlinkedWorkspaces: f.workspaces.filter((w) => !orgOf.has(w.workspaceId)).map((w) => w.workspaceId),
    people: people.length,
  };
}

/** Plain-text lines for the console. */
export function describeParity(r: ParityResult, o: { verbose?: boolean } = {}): string[] {
  const out: string[] = [];
  const shown = o.verbose ? r.rows : r.differences;
  for (const row of shown) {
    const where = row.scope === "platform" ? "platform" : `${row.scope}${row.organizationId ? ` (${row.organizationId})` : " (no IAM organization)"}`;
    if (!row.missingInIam.length && !row.extraInIam.length) {
      out.push(`same  ${row.userId} @ ${where}: ${row.factory.length} permissions`);
      continue;
    }
    const bits = [
      row.missingInIam.length ? `missing in IAM: ${row.missingInIam.join(", ")}` : "",
      row.extraInIam.length ? `only in IAM: ${row.extraInIam.join(", ")}` : "",
    ].filter(Boolean);
    out.push(`DIFF  ${row.userId} @ ${where}: ${bits.join("; ")}`);
  }
  if (r.unlinkedWorkspaces.length) out.push(`note  ${r.unlinkedWorkspaces.length} workspace(s) have no IAM organization yet`);
  out.push(
    `${r.differences.length} difference(s) in ${r.rows.length} checks (${r.people} people; ${PLATFORM_PERMISSIONS.length} platform and ${WORKSPACE_PERMISSIONS.length} organization permission keys)`,
  );
  return out;
}
