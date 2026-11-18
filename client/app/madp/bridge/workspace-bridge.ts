/**
 * Workspace bridge: maps genesis-os project/impersonation context into MADP's useWorkspaces store.
 * Resolves the MADP workspace ID from the Blocks project, since they're different systems.
 */
import { useProjectStore, useAuthStore } from "@seliseblocks/genesis-os/store";
import { useWorkspaces } from "../blocks/workspaces/store";
import { getOrCreateWorkspace } from "./provision";

let unsubProject: (() => void) | null = null;
let unsubAuth: (() => void) | null = null;
let resolving = false;

export function startWorkspaceBridge() {
  if (unsubProject) return;
  syncWorkspaceState();
  unsubProject = useProjectStore.subscribe(syncWorkspaceState);
  unsubAuth = useAuthStore.subscribe(syncWorkspaceState);
}

function syncWorkspaceState() {
  const { selectedProject } = useProjectStore.getState();
  const { user, isAuthenticated } = useAuthStore.getState();

  if (!isAuthenticated || !user) {
    useWorkspaces.setState({ ready: true });
    return;
  }

  const blocksProjectId = selectedProject?.ItemId ?? (selectedProject as Record<string, unknown> | null)?.itemId as string ?? "";
  const blocksProjectName = (selectedProject as Record<string, unknown> | null)?.Name as string ?? "Project";
  const userId = (user as Record<string, unknown>).id as string ?? "";
  const email = (user as Record<string, unknown>).email as string ?? "";
  const name = (user as Record<string, unknown>).name as string ?? email;

  // Set initial state with ready=true so pages can render
  // The workspaceId will be resolved async from the MADP Data Gateway
  const currentWsId = useWorkspaces.getState().workspaceId;

  // If we already have a resolved workspace ID, keep it
  if (currentWsId && currentWsId !== blocksProjectId) {
    updateStoreWithWorkspaceId(currentWsId, userId, email, name, blocksProjectId);
    return;
  }

  // Set temporary state so pages don't block
  updateStoreWithWorkspaceId(blocksProjectId, userId, email, name, blocksProjectId);

  // Resolve the actual MADP workspace ID asynchronously
  if (!resolving) {
    resolving = true;
    getOrCreateWorkspace(blocksProjectId, blocksProjectName).then((madpWsId) => {
      resolving = false;
      if (madpWsId && madpWsId !== blocksProjectId) {
        updateStoreWithWorkspaceId(madpWsId, userId, email, name, blocksProjectId);
      }
    }).catch(() => { resolving = false; });
  }
}

function updateStoreWithWorkspaceId(workspaceId: string, userId: string, email: string, name: string, _blocksProjectId: string) {
  useWorkspaces.setState({
    ready: true,
    workspaceId,
    userId,
    email,
    isSuperAdmin: true,
    me: {
      id: userId,
      workspaceId,
      name,
      email,
      role: "owner" as const,
      status: "active" as const,
      invitedAt: null,
      joinedAt: new Date().toISOString(),
      userId,
      membershipId: userId,
      roleKey: "owner",
      roleName: "Owner",
      permissions: ["view", "project.create", "project.edit", "project.delete", "members.manage", "roles.manage", "workspace.manage"] as never[],
      isCustomRole: false,
    } as never,
    members: [{
      id: userId,
      workspaceId,
      name,
      email,
      role: "owner" as const,
      status: "active" as const,
      invitedAt: null,
      joinedAt: new Date().toISOString(),
      userId,
      membershipId: userId,
      roleKey: "owner",
      roleName: "Owner",
      permissions: ["view", "project.create", "project.edit", "project.delete", "members.manage", "roles.manage", "workspace.manage"] as never[],
      isCustomRole: false,
    }] as never[],
    workspaces: [{
      id: workspaceId,
      name: "MADP Workspace",
      createdAt: new Date().toISOString(),
      role: "owner" as const,
      roleKey: "owner",
      roleName: "Owner",
      status: "active" as const,
      membershipId: null,
      viaPlatform: false,
    }],
  });
}

export function stopWorkspaceBridge() {
  if (unsubProject) { unsubProject(); unsubProject = null; }
  if (unsubAuth) { unsubAuth(); unsubAuth = null; }
}
