import { createHash } from "node:crypto";
import { f } from "../../functions/_lib/filter.ts";
import type { RawGateway, Row } from "../../functions/_lib/gateway.ts";
import { capKey } from "../../functions/_lib/ids.ts";
import type { WorkspacePermission } from "../../src/domain/rbac.ts";
import { PROJECT_FIELDS, projectFromRow } from "../../src/blocks/projects/records.ts";
import { shellPermissions } from "./permissions.ts";
import type { ShellIdentity } from "./assertion.ts";
import { ShellRefused } from "./assertion.ts";

export interface ShellScope {
  identity: ShellIdentity;
  workspaceId: string;
  projectId: string;
  permissions: WorkspacePermission[];
  workspace: Row;
  membership: Row;
  role: Row;
  project: Row;
}
const workspaceFields = ["ItemId", "WorkspaceId", "Name", "Status", "CreatedDate", "RequestKey"];
const membershipFields = ["ItemId", "WorkspaceId", "UserId", "Email", "DisplayName", "RoleKey", "Status", "JoinedAt", "RequestKey"];
const roleFields = ["ItemId", "WorkspaceId", "Key", "Name", "Permissions", "IsBuiltIn", "RequestKey"];
const str = (r: Row, k: string) => typeof r[k] === "string" ? r[k] as string : "";

/** Inserts through the real service gateway, whose RequestKey unique indexes make concurrent imports idempotent. */
async function ensure(raw: RawGateway, schema: string, key: string, row: Row, fields: readonly string[]): Promise<Row> {
  const find = () => raw.find(schema, { where: f.eq("RequestKey", key), fields: [...new Set([...fields, "RequestKey"])], pageSize: 1 }).then((p) => p.items[0]);
  let existing: Row | undefined = await find();
  if (existing) return existing;
  const created = await raw.insert(schema, { ...row, RequestKey: key });
  if (created.itemId) existing = await raw.get(schema, created.itemId, fields) ?? undefined;
  existing ??= await find();
  if (!existing) throw new ShellRefused(503, "metadata_unavailable");
  return existing;
}

/** No IAM users, organization or tenant are created here. These rows store only MADP workflow metadata. */
export function createShellOnboarding(raw: RawGateway, now = Date.now, configuredWritePermissions: readonly string[] = []) {
  const pending = new Map<string, Promise<ShellScope>>();
  return async (identity: ShellIdentity): Promise<ShellScope> => {
    const key = `${identity.tenantId.toLowerCase()}:${identity.userId}:${shellPermissions(identity, configuredWritePermissions).join(",")}`;
    const running = pending.get(key);
    if (running) return running;
    const promise = importMetadata(identity);
    pending.set(key, promise);
    try { return await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
  };
  async function importMetadata(identity: ShellIdentity): Promise<ShellScope> {
    const tenant = identity.tenantId.toLowerCase();
    const permissions = shellPermissions(identity, configuredWritePermissions);
    const stamp = new Date(now()).toISOString();
    const actor = { CreatedByUserId: identity.userId, UpdatedByUserId: identity.userId, ReaderIds: [identity.userId] };
    const linked = await raw.find("Project", { where: f.eq("BlocksProjectRef", identity.tenantId), fields: [...PROJECT_FIELDS, "RequestKey"], pageSize: 2 });
    if (linked.items.length > 1) throw new ShellRefused(409, "ambiguous_project_mapping");
    let project = linked.items[0];
    let workspace = project ? await raw.get("Workspace", str(project, "WorkspaceId"), workspaceFields) : null;
    if (project && !workspace) throw new ShellRefused(409, "invalid_project_mapping");
    workspace ??= await ensure(raw, "Workspace", `blocks-shell:workspace:${tenant}`, {
      ...actor, Name: "Blocks project", Status: "active", IsExample: false,
    }, workspaceFields);
    const workspaceId = str(workspace, "ItemId");
    if (!workspaceId) throw new ShellRefused(409, "invalid_project_mapping");
    if (str(workspace, "WorkspaceId") !== workspaceId) {
      await raw.update("Workspace", workspaceId, { WorkspaceId: workspaceId });
      workspace = { ...workspace, WorkspaceId: workspaceId };
    }
    if (workspace.Status !== "active") throw new ShellRefused(403, "workspace_inactive");
    const roleKey = `blocks-${createHash("sha256").update(permissions.join(",")).digest("hex").slice(0, 16)}`;
    const role = await ensure(raw, "WorkspaceRole", `blocks-shell:role:${workspaceId}:${roleKey}`, {
      ...actor, WorkspaceId: workspaceId, Key: roleKey, Name: permissions.includes("project.edit") ? "Blocks project contributor" : "Blocks project reader", Permissions: permissions, IsBuiltIn: false,
    }, roleFields);
    let membership = (await raw.find("Membership", { where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("UserId", identity.userId)), fields: membershipFields, pageSize: 1 })).items[0];
    const memberPatch = { RoleKey: roleKey, Status: "active", Email: identity.email, DisplayName: identity.displayName, UpdatedByUserId: identity.userId };
    if (!membership) membership = await ensure(raw, "Membership", capKey(`blocks-shell:member:${workspaceId}:${identity.userId}`), {
      ...actor, ...memberPatch, WorkspaceId: workspaceId, UserId: identity.userId, JoinedAt: stamp,
    }, membershipFields);
    else if (!str(membership, "RequestKey").startsWith("blocks-shell:member:")) {
      if (membership.Status !== "active") throw new ShellRefused(403, "membership_inactive");
    } else if (Object.entries(memberPatch).some(([k, v]) => membership![k] !== v)) {
      await raw.update("Membership", str(membership, "ItemId"), memberPatch);
      membership = { ...membership, ...memberPatch };
    }
    project ??= await ensure(raw, "Project", `blocks-shell:project:${tenant}`, {
      ...actor, WorkspaceId: workspaceId, Name: "Blocks project", Status: "active", Stage: "business", RepoMode: "new", RepoProvider: "factory",
      BlocksProjectRef: identity.tenantId, BlocksProvisioningStatus: "ready", AssigneeUserId: "", SetupStatus: "draft", SetupAnswers: "{}",
    }, [...PROJECT_FIELDS, "RequestKey"]);
    if (str(project, "BlocksProjectRef").toLowerCase() !== tenant || str(project, "WorkspaceId") !== workspaceId || project.Status === "deleting") throw new ShellRefused(409, "invalid_project_mapping");
    return { identity, permissions, workspaceId, projectId: str(project, "ItemId"), workspace, membership, role, project };
  }
}

export function shellBootstrap(scope: ShellScope) {
  const { identity, workspaceId, permissions, membership, role, project, workspace } = scope;
  return {
    tenantId: identity.tenantId,
    profile: { userId: identity.userId, email: identity.email, firstName: "", lastName: "", displayName: identity.displayName, roles: [], permissions, isSuperAdmin: false },
    workspace: { id: workspaceId, name: str(workspace, "Name"), createdAt: str(workspace, "CreatedDate"), role: permissions.includes("project.edit") ? "member" : "viewer", roleKey: str(role, "Key"), roleName: str(role, "Name"), status: "active", membershipId: str(membership, "ItemId"), viaPlatform: false },
    member: { id: identity.userId, userId: identity.userId, workspaceId, name: identity.displayName, email: identity.email, role: permissions.includes("project.edit") ? "member" : "viewer", roleKey: str(role, "Key"), roleName: str(role, "Name"), permissions, isCustomRole: true, status: "active", invitedAt: null, joinedAt: str(membership, "JoinedAt"), membershipId: str(membership, "ItemId") },
    customRole: { key: str(role, "Key"), name: str(role, "Name"), permissions, isBuiltIn: false },
    project: projectFromRow(project), rawProject: project,
  };
}
