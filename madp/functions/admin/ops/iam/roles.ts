// iam.roles.list / iam.roles.save / iam.roles.delete: the Factory's roles as Blocks OS IAM holds them.
// list: platform.roles.manage or platform.people.manage; IAM is only read, not audited.
// save: platform.roles.manage (organization roles: platform.workspaces.manage too, checked by workspaceRole.save). IAM is
//   written first (the permissions it needs, then the role); the Factory row is then kept in step by the existing op,
//   which checks and audits the change as it always has. Built-in roles are locked.
// delete: the Factory op runs first (it refuses a role still in use), then the IAM role goes. Audited.
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS, WORKSPACE_ROLES } from "../../../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE, checkOrgRoleTemplateChange, checkPlatformRoleChange } from "../../../../src/domain/roles";
import { cleanText, fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { platformRoleDelete } from "../platformRole/delete";
import { platformRoleSave } from "../platformRole/save";
import { workspaceRoleDelete } from "../workspaceRole/delete";
import { workspaceRoleSave } from "../workspaceRole/save";
import {
  IAM_READ_PERMISSIONS, PERMISSION_CATALOG, directoryOf, iamFail, noIam, parseRoleSlug, roleSlug, isFactoryRoleSlug, workspacesRead,
  type RoleScope, type WorkspaceIamRow,
} from "./shared";

export interface IamRoleView {
  slug: string;
  scope: RoleScope;
  key: string;
  builtIn: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  name: string;
  description: string;
  permissions: string[];
}

const SCOPES: readonly RoleScope[] = ["platform", "template", "organization"];
const isScope = (v: unknown): v is RoleScope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);

export async function iamRolesList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ roles: IamRoleView[] }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: IAM_READ_PERMISSIONS, extra: { workspaces: workspacesRead(deps) } });
  if (!open.ok) return { ok: false, error: open.error };
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  let listed;
  try { listed = await iam.listRoles(); } catch (e) { return iamFail(e); }
  const workspaces = open.caller.extra.workspaces as WorkspaceIamRow[];
  const names = new Map(workspaces.map((w) => [w.ItemId, w.Name]));
  const ids = workspaces.map((w) => w.ItemId);
  const roles: IamRoleView[] = [];
  for (const r of listed) {
    if (!isFactoryRoleSlug(r.slug)) continue;
    const p = parseRoleSlug(r.slug, ids);
    if (!p) continue;
    roles.push({
      slug: r.slug, scope: p.scope, key: p.key, builtIn: p.builtIn,
      workspaceId: p.workspaceId ?? null, workspaceName: p.workspaceId ? names.get(p.workspaceId) ?? null : null,
      name: r.name || p.key, description: r.description ?? "",
      permissions: (r.permissions ?? []).filter((x) => PERMISSION_CATALOG.includes(x)),
    });
  }
  const order: Record<RoleScope, number> = { platform: 0, template: 1, organization: 2 };
  roles.sort((x, y) => order[x.scope] - order[y.scope] || Number(y.builtIn) - Number(x.builtIn) || x.name.localeCompare(y.name));
  return ok({ roles });
}

export async function iamRolesSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { scope: "string", key: "string", name: "string", description: "string?", permissions: "string[]", workspaceId: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { scope, workspaceId } = a.value;
  if (!isScope(scope) || (scope === "organization" && !workspaceId)) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["scope", "workspaceId"] });
  const key = a.value.key.trim();
  const name = cleanText(a.value.name);
  const description = cleanText(a.value.description ?? "").slice(0, 300);
  const permissions = [...new Set(a.value.permissions)];
  const allowed: readonly string[] = scope === "platform" ? PLATFORM_PERMISSIONS : WORKSPACE_PERMISSIONS;
  if (!key || permissions.some((p) => !allowed.includes(p))) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["key", "permissions"] });
  // Built-in roles are locked, and no custom key may take a built-in role's slug.
  if (key === PLATFORM_ADMIN_ROLE.key || (scope === "platform" && roleSlug("platform", key) === roleSlug("platform", PLATFORM_ADMIN_ROLE.key))
    || (scope === "organization" && (WORKSPACE_ROLES as readonly string[]).includes(key))) {
    return fail("invalid_input", "tenancy.builtInRole");
  }
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.roles.manage", extra: { workspaces: workspacesRead(deps) } });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const granter = { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions };
  if (scope !== "organization") {
    const bad = fromRoleCheck(scope === "template" ? checkOrgRoleTemplateChange({ key, name, permissions }, granter) : checkPlatformRoleChange({ key, name, permissions }, granter));
    if (!bad.ok) return failCheck(bad);
  } else if (!(caller.extra.workspaces as WorkspaceIamRow[]).some((w) => w.ItemId === workspaceId)) {
    return fail("not_found");
  }
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  const slug = roleSlug(scope, key, workspaceId);
  let before: { permissions: string[] } | null;
  try {
    before = await iam.getRole(slug);
    await iam.ensurePermissions(permissions);
    await iam.upsertRole({ slug, name, description, permissions });
  } catch (e) {
    return iamFail(e);
  }
  // The Factory row in step (switching the source back stays safe); its own op checks and audits as before.
  const factory = scope === "organization"
    ? await workspaceRoleSave(ctx, { workspaceId, key, name, description, permissions }, deps)
    : await platformRoleSave(ctx, { key, name, description, permissions, scope: scope === "template" ? "organization" : "platform" }, deps);
  await audit(deps, ctx, caller, {
    targetType: "iam-role",
    targetId: slug,
    details: { scope, role: key, before: before ? { permissions: before.permissions } : null, after: { name, permissions }, factoryInStep: factory.ok },
  });
  if (!factory.ok) return factory;
  return ok({ role: { slug, scope, key, name, description, permissions, workspaceId: workspaceId ?? null } });
}

export async function iamRolesDelete(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { scope: "string", key: "string", workspaceId: "string?", reassignTo: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { scope, key, workspaceId, reassignTo } = a.value;
  if (!isScope(scope) || (scope === "organization" && !workspaceId)) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["scope", "workspaceId"] });
  if (key === PLATFORM_ADMIN_ROLE.key || (scope === "organization" && (WORKSPACE_ROLES as readonly string[]).includes(key))) return fail("invalid_input", "tenancy.builtInRole");
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.roles.manage" });
  if (!open.ok) return { ok: false, error: open.error };
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  const factory = scope === "organization"
    ? await workspaceRoleDelete(ctx, { workspaceId, key, ...(reassignTo ? { reassignTo } : {}) }, deps)
    : await platformRoleDelete(ctx, { key }, deps);
  if (!factory.ok && factory.error.code !== "not_found") return factory;
  const slug = roleSlug(scope, key, workspaceId);
  try {
    await iam.deleteRole(slug);
  } catch (e) {
    const failed = iamFail(e);
    if (failed.ok || failed.error.messageKey !== "iam.notFound") {
      await audit(deps, ctx, open.caller, { targetType: "iam-role", targetId: slug, details: { scope, role: key, deletedInIam: false } });
      return failed;
    }
  }
  await rbacChanged(deps);
  await audit(deps, ctx, open.caller, { targetType: "iam-role", targetId: slug, details: { scope, role: key, deletedInIam: true } });
  return ok({ slug, deleted: true });
}
