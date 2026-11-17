// iam.access.get / iam.access.set: one person's roles in Blocks OS IAM, platform-wide and per organization.
// get: platform.users.view (platform.people.manage brings it) or platform.roles.manage. Audited, like people.access.
// set: platform-wide roles need platform.users.manage; a role in one organization needs platform.workspaces.manage.
//   IAM is written first. Platform roles: the Factory assignments are then kept in step by platformRole.assign /
//   platformRole.unassign (their own checks and audit). Organization role: the answer says which Factory role the screen
//   sets next through the organization's member op (owner guard, reader stamps), so switching the source back stays safe.
import { PLATFORM_ADMIN_ROLE, checkAssignPlatformRole, checkUnassignPlatformRole } from "../../../../src/domain/roles";
import { fromRoleCheck } from "../../../../src/domain/tenancy";
import { WORKSPACE_ROLES } from "../../../../src/domain/rbac";
import { audit, fail, failCheck, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import type { IamDirectoryAccess, OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, type MembershipRow, type PlatformRoleAssignmentRow, type PlatformRoleRow, type WorkspaceRoleRow } from "../../../workspace/ops/_shared/records";
import { platformRoleAssign, roleDefOf } from "../platformRole/assign";
import { platformRoleUnassign } from "../platformRole/unassign";
import { directoryOf, iamFail, isFactoryRoleSlug, noIam, parseRoleSlug, roleSlug, workspacesRead, type WorkspaceIamRow } from "./shared";

export interface IamPersonAccess {
  userId: string;
  platformRoles: string[];
  organizations: {
    workspaceId: string;
    workspaceName: string;
    workspaceStatus: string;
    organizationId: string | null;
    membershipId: string | null;
    iamRoles: string[];
    factoryRole: string | null;
    inStep: boolean;
  }[];
  /** IAM organizations with Factory roles that no workspace links to. */
  unlinked: { organizationId: string; roles: string[] }[];
}

const keysIn = (slugs: readonly string[], workspaceIds: readonly string[]): string[] =>
  slugs.filter(isFactoryRoleSlug).map((s) => parseRoleSlug(s, workspaceIds)?.key ?? s);

export async function iamAccessGet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<IamPersonAccess>> {
  const a = readArgs(args, { userId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const { userId } = a.value;
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: ["platform.users.view", "platform.roles.manage"],
    extra: {
      workspaces: workspacesRead(deps),
      memberships: () => deps.gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { UserId: userId, Status: { ne: "removed" } }, fields: ["ItemId", "WorkspaceId", "UserId", "RoleKey", "Status"], maxItems: 500 }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  let access: IamDirectoryAccess;
  try { access = await iam.userAccess(userId); } catch (e) { return iamFail(e); }
  const workspaces = open.caller.extra.workspaces as WorkspaceIamRow[];
  const ids = workspaces.map((w) => w.ItemId);
  const memberships = open.caller.extra.memberships as MembershipRow[];
  const byWs = new Map(memberships.map((m) => [m.WorkspaceId, m]));
  const seen = new Set<string>();
  const organizations: IamPersonAccess["organizations"] = [];
  for (const w of workspaces) {
    const orgId = w.IamOrganizationId || null;
    const m = byWs.get(w.ItemId) ?? null;
    const iamRoles = orgId ? keysIn(access.orgs[orgId]?.roles ?? [], ids) : [];
    if (orgId) seen.add(orgId);
    if (!m && iamRoles.length === 0) continue;
    const factoryRole = m && m.Status === "active" ? m.RoleKey : null;
    organizations.push({
      workspaceId: w.ItemId, workspaceName: w.Name, workspaceStatus: w.Status, organizationId: orgId, membershipId: m?.ItemId ?? null,
      iamRoles, factoryRole,
      inStep: factoryRole ? iamRoles.length === 1 && iamRoles[0] === factoryRole : iamRoles.length === 0,
    });
  }
  organizations.sort((x, y) => x.workspaceName.localeCompare(y.workspaceName));
  const unlinked = Object.entries(access.orgs)
    .filter(([id, g]) => !seen.has(id) && g.roles.some(isFactoryRoleSlug))
    .map(([organizationId, g]) => ({ organizationId, roles: g.roles.filter(isFactoryRoleSlug) }));
  await audit(deps, ctx, open.caller, { targetType: "account", targetId: userId, details: { source: "iam" } });
  return ok({ userId, platformRoles: keysIn(access.platform.roles, ids), organizations, unlinked });
}

export async function iamAccessSet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { userId: "string", workspaceId: "string?", roleKeys: "string[]" });
  if (!a.ok) return { ok: false, error: a.error };
  const { userId, workspaceId } = a.value;
  const wanted = [...new Set(a.value.roleKeys)];
  if (workspaceId && wanted.length !== 1) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["roleKeys"] });
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: workspaceId ? "platform.workspaces.manage" : "platform.users.manage",
    extra: workspaceId
      ? {
          workspaces: () => deps.gateway.listAll<WorkspaceIamRow>(SCHEMA.workspace, { filter: { ItemId: workspaceId }, fields: ["ItemId", "Name", "Status", "IamOrganizationId"], maxItems: 1 }),
          roles: () => deps.gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, { filter: { WorkspaceId: workspaceId }, fields: ["ItemId", "WorkspaceId", "Key"], maxItems: 200 }),
          team: () => deps.gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { WorkspaceId: workspaceId, Status: "active" }, fields: ["ItemId", "WorkspaceId", "UserId", "RoleKey", "Status"], maxItems: 5000 }),
        }
      : {
          roles: () => deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: ["ItemId", "Key", "Name", "Description", "Permissions", "Scope"], maxItems: 1000 }),
          assignments: () => deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, { filter: { UserId: userId, Status: "active" }, fields: ["ItemId", "UserId", "RoleKey", "Status"] }),
          admins: () => deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, { filter: { RoleKey: PLATFORM_ADMIN_ROLE.key, Status: "active" }, fields: ["ItemId", "UserId", "RoleKey", "Status"] }),
        },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  if (userId === caller.userId && !caller.isSuperAdmin) return fail("forbidden", "tenancy.selfChange");

  if (workspaceId) {
    const ws = (caller.extra.workspaces as WorkspaceIamRow[])[0];
    if (!ws) return fail("not_found");
    const roleKey = wanted[0]!;
    const custom = (caller.extra.roles as WorkspaceRoleRow[]).map((r) => r.Key);
    if (!(WORKSPACE_ROLES as readonly string[]).includes(roleKey) && !custom.includes(roleKey)) return fail("not_found", "tenancy.roleNotFound");
    const team = caller.extra.team as MembershipRow[];
    const member = team.find((m) => m.UserId === userId) ?? null;
    if (!member) return fail("not_found", "tenancy.targetNoAccount");
    // The organization's last owner stays an owner (the member op refuses it too; checked here so IAM is not changed first).
    if (member.RoleKey === "owner" && roleKey !== "owner" && !team.some((m) => m.UserId !== userId && m.RoleKey === "owner")) {
      return fail("conflict", "tenancy.lastOwner");
    }
    const slug = roleSlug("organization", roleKey, workspaceId);
    let organizationId = ws.IamOrganizationId || "";
    let revoked: string[] = [];
    try {
      if (!organizationId) {
        organizationId = await iam.ensureOrganization({ workspaceId, name: ws.Name });
        await deps.gateway.update(SCHEMA.workspace, workspaceId, { IamOrganizationId: organizationId, UpdatedByUserId: caller.userId });
      }
      const held = (await iam.userAccess(userId)).orgs[organizationId]?.roles ?? [];
      revoked = held.filter((s) => isFactoryRoleSlug(s) && s !== slug);
      if (revoked.length) await iam.revoke(userId, { roles: revoked, organizationId });
      if (!held.includes(slug)) await iam.grant(userId, { roles: [slug], organizationId });
    } catch (e) {
      return iamFail(e);
    }
    // The person's cached roles are dropped at once (functions/_lib/rbacSource.ts).
    await rbacChanged(deps, [userId]);
    await audit(deps, ctx, caller, {
      targetType: "membership", targetId: member.ItemId, workspaceId,
      details: { source: "iam", userId, before: member.RoleKey, after: roleKey, revoked: revoked.length },
    });
    return ok({ userId, workspaceId, organizationId, roleKeys: [roleKey], factory: { membershipId: member.ItemId, roleKey: member.RoleKey, needsUpdate: member.RoleKey !== roleKey } });
  }

  // Platform-wide roles: Factory platform roles (never templates) and the built-in Platform admin.
  const rows = caller.extra.roles as (PlatformRoleRow & { Scope?: string })[];
  const known = new Set([PLATFORM_ADMIN_ROLE.key, ...rows.filter((r) => r.Scope !== "organization").map((r) => r.Key)]);
  if (wanted.some((k) => !known.has(k))) return fail("not_found", "tenancy.roleNotFound");
  const factoryHeld = (caller.extra.assignments as PlatformRoleAssignmentRow[]).map((r) => r.RoleKey);
  // The Factory's own assign / unassign rules, checked before IAM changes, so the two never part ways on a refusal.
  const granter = { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions };
  const defOf = (k: string) => roleDefOf(k, rows.find((r) => r.Key === k) ?? null);
  for (const k of wanted.filter((k) => !factoryHeld.includes(k))) {
    const role = defOf(k);
    const bad = role ? fromRoleCheck(checkAssignPlatformRole(role, granter)) : null;
    if (!role) return fail("not_found", "tenancy.roleNotFound");
    if (bad && !bad.ok) return failCheck(bad);
  }
  for (const k of factoryHeld.filter((k) => !wanted.includes(k))) {
    const role = defOf(k);
    if (!role) continue;
    const holderCount = k === PLATFORM_ADMIN_ROLE.key ? (caller.extra.admins as PlatformRoleAssignmentRow[]).length : 2;
    const bad = fromRoleCheck(checkUnassignPlatformRole(role, { granter, holderCount, isSelf: userId === caller.userId }));
    if (!bad.ok) return failCheck(bad);
  }
  const slugs = wanted.map((k) => roleSlug("platform", k));
  let added: string[] = [];
  let removed: string[] = [];
  try {
    const held = (await iam.userAccess(userId)).platform.roles.filter((s) => s.startsWith("mf-platform-"));
    added = slugs.filter((s) => !held.includes(s));
    removed = held.filter((s) => !slugs.includes(s));
    if (removed.length) await iam.revoke(userId, { roles: removed });
    if (added.length) await iam.grant(userId, { roles: added });
  } catch (e) {
    return iamFail(e);
  }
  // The Factory assignments in step, each through its own op.
  const refused: string[] = [];
  for (const k of wanted.filter((k) => !factoryHeld.includes(k))) {
    const r = await platformRoleAssign(ctx, { userId, roleKey: k }, deps);
    if (!r.ok) refused.push(k);
  }
  for (const k of factoryHeld.filter((k) => !wanted.includes(k))) {
    const r = await platformRoleUnassign(ctx, { userId, roleKey: k }, deps);
    if (!r.ok) refused.push(k);
  }
  await rbacChanged(deps, [userId]);
  await audit(deps, ctx, caller, {
    targetType: "account", targetId: userId,
    details: { source: "iam", added, removed, factoryNotInStep: refused },
  });
  return ok({ userId, roleKeys: wanted, factoryInStep: refused.length === 0 });
}
