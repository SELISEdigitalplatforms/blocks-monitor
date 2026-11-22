// The IAM side of the role and access changes (rbac.source "iam"): IAM is written first, then the op writes the Factory
// rows (so switching the source back to "factory" is safe). Every helper here throws IamAdminError (or OpError) on a
// failure; the ops call them inside iamFirst (core.ts), which turns that into a plain refusal before any Factory write.
import {
  BUILT_IN_ORG_ROLE_KEYS,
  IAM_ORG_OWNER,
  orgRoleSlug,
  platformRoleSlug,
  templateRoleSlug,
  type IamAdminApi,
} from "../../../_lib/iamAdmin";
import { permissionDescription } from "../../../../src/domain/permissions";
import type { OpDeps } from "./ports";
import { SCHEMA } from "./records";

export { IAM_ORG_OWNER, orgRoleSlug, platformRoleSlug, templateRoleSlug };

/** Creates the missing permissions and sets the role's permissions exactly (the role is created when missing). */
export async function upsertIamRole(
  iam: IamAdminApi,
  r: { slug: string; name: string; description: string; permissions: readonly string[] },
): Promise<void> {
  await iam.ensurePermissions(r.permissions, permissionDescription);
  await iam.upsertRole({ slug: r.slug, name: r.name, description: r.description, permissions: r.permissions });
}

/** A platform role (scope "platform") or an organization role template (scope "organization"). */
export function platformRoleIamSlug(key: string, scope: "platform" | "organization"): string {
  return scope === "organization" ? templateRoleSlug(key) : platformRoleSlug(key);
}

/** The description an organization's own role carries in IAM (names the organization). */
export function orgRoleDescription(description: string, workspace: { ItemId: string; Name?: string }): string {
  const where = `Organization ${workspace.Name ?? ""} (${workspace.ItemId})`.replace(/\s+/g, " ");
  return (description ? `${description} - ${where}` : where).slice(0, 300);
}

/**
 * The IAM organization a workspace is linked to (Workspace.IamOrganizationId), or null. A workspace without one is
 * decided by the Factory rows even in "iam" mode, so a change there writes no IAM (the sync links it with all members).
 */
export async function linkedWorkspaceOrg(deps: OpDeps, workspaceId: string): Promise<string | null> {
  const view = deps.rbac ? await deps.rbac.view() : null;
  const linked = view ? await view.workspace(workspaceId) : null;
  return linked ? linked.organizationId : null;
}

/**
 * The IAM organization of a workspace: the linked one, else found by its marker or created; a new link is stored on the
 * Workspace row (IamOrganizationId) and remembered by the roles source. Linking hands the workspace's access to IAM, so
 * only a new workspace (one member) or the sync (every member granted first) may link one.
 */
export async function ensureWorkspaceOrg(deps: OpDeps, iam: IamAdminApi, workspace: { ItemId: string; Name?: string }): Promise<string> {
  const view = deps.rbac ? await deps.rbac.view() : null;
  const linked = view ? await view.workspace(workspace.ItemId) : null;
  if (linked) return linked.organizationId;
  const orgId = await iam.ensureOrganization({ workspaceId: workspace.ItemId, name: workspace.Name ?? "" });
  await deps.gateway.update(SCHEMA.workspace, workspace.ItemId, { IamOrganizationId: orgId });
  deps.rbac?.rememberOrg(workspace.ItemId, orgId);
  return orgId;
}

/** Every IAM role slug that can mean a role in this workspace (built-ins and the given custom key). */
export function workspaceRoleSlugs(workspaceId: string, ...keys: readonly string[]): string[] {
  return [...new Set([...BUILT_IN_ORG_ROLE_KEYS.map((k) => orgRoleSlug(k, workspaceId)), ...keys.filter(Boolean).map((k) => orgRoleSlug(k, workspaceId))])];
}

/** Sets a person's one role in the organization: the new role first, then the others are taken off. */
export async function setIamOrgRole(iam: IamAdminApi, o: { userId: string; organizationId: string; workspaceId: string; roleKey: string; previousKey?: string }): Promise<void> {
  const slug = orgRoleSlug(o.roleKey, o.workspaceId);
  await iam.grant(o.userId, { roles: [slug], organizationId: o.organizationId });
  const others = workspaceRoleSlugs(o.workspaceId, o.previousKey ?? "").filter((s) => s !== slug);
  await iam.revoke(o.userId, { roles: others, organizationId: o.organizationId });
}

/** Makes sure an organization role exists in IAM with the Factory's permissions (built-in or this workspace's custom role). */
export async function ensureIamOrgRole(
  iam: IamAdminApi,
  role: { key: string; name: string; description?: string; permissions: readonly string[] },
  workspace: { ItemId: string; Name?: string },
): Promise<void> {
  const builtIn = (BUILT_IN_ORG_ROLE_KEYS as readonly string[]).includes(role.key);
  await upsertIamRole(iam, {
    slug: orgRoleSlug(role.key, workspace.ItemId),
    name: role.name || role.key,
    description: builtIn ? `Organization role ${role.key} (all organizations)` : orgRoleDescription(role.description ?? "", workspace),
    permissions: role.permissions,
  });
}
