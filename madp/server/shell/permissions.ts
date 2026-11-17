import { WORKSPACE_PERMISSIONS, type WorkspacePermission } from "../../src/domain/rbac.ts";
import type { ShellIdentity } from "./assertion.ts";

// Project selection proves view access. Writes require an explicit permission on the validated Genesis identity.
// Blocks remains the owner of people, tenancy, roles and repository authorization.
const EXCLUDED = new Set<WorkspacePermission>(["workspace.manage", "members.manage", "roles.manage", "project.create", "project.delete", "project.assign", "items.shareExternal", "release.manage-approvals"]);
export function shellPermissions(identity: Pick<ShellIdentity, "permissions" | "roles">, configuredWritePermissions: readonly string[] = []): WorkspacePermission[] {
  const held = new Set(identity.permissions);
  const writer = held.has("madp.write") || held.has("madp.manage") || held.has("blocks-madp::project::write") || held.has("blocks-madp::project::manage") || configuredWritePermissions.some((p) => held.has(p));
  return WORKSPACE_PERMISSIONS.filter((p) => p === "view" || (!EXCLUDED.has(p) && (writer || held.has(`madp.${p}`) || held.has(p))));
}
