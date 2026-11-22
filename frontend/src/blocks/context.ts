// THE web context of a Blocks screen: active workspace, caller, workspace permissions, members and workspaces.
// Sources: the workspace store (./workspaces/store) and the IAM session (./session); never src/state/**.
// The lane adapters (projects, requirements, delivery, scope, sanitization, engine) delegate here.
import { useMemo } from "react";
import { useSession } from "./session";
import { useWorkspaces, type Member, type MyWorkspace } from "./workspaces/store";
import { workspacePermissionsFor, type RoleDef } from "../domain/roles";
import type { WorkspacePermission } from "../domain/rbac";

export const FORMER_MEMBER = "Former member";
/** Shown for a person whose name is not known yet because the members are still loading. */
export const NAME_LOADING = "…";

export interface BlocksContext {
  workspaceId: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  permissions: readonly WorkspacePermission[];
  can(p: WorkspacePermission): boolean;
  members: readonly Member[];
  memberName(userId: string): string;
  workspaces: readonly MyWorkspace[];
  /** True once the workspace list has settled (loaded, or failed to load); false while it is still loading. */
  workspacesLoaded: boolean;
}

/** The caller's workspace permissions: the built-in or custom role, every permission for the super admin. */
export function permissionsFor(input: {
  roleKey: string | null;
  customRoles: readonly RoleDef[];
  isSuperAdmin: boolean;
}): readonly WorkspacePermission[] {
  return workspacePermissionsFor({ roleKey: input.roleKey, customRoles: input.customRoles, isSuperAdmin: input.isSuperAdmin });
}

/** "" for an empty id; the name of an active or invited member; "Former member" for anyone else once the members have loaded (until then a loading mark). */
export function memberNameIn(members: readonly { id: string; name: string; status: string }[], userId: string, loaded = true): string {
  if (!userId) return "";
  const m = members.find((x) => x.id === userId);
  if (m && (m.status === "active" || m.status === "invited")) return m.name || FORMER_MEMBER;
  return loaded ? FORMER_MEMBER : NAME_LOADING;
}

function build(s: {
  workspaceId: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  roleKey: string | null;
  customRoles: readonly RoleDef[];
  members: readonly Member[];
  workspaces: readonly MyWorkspace[];
  loaded: boolean;
}): BlocksContext {
  const permissions = permissionsFor({ roleKey: s.roleKey, customRoles: s.customRoles, isSuperAdmin: s.isSuperAdmin });
  return {
    workspaceId: s.workspaceId,
    userId: s.userId,
    isSuperAdmin: s.isSuperAdmin,
    permissions,
    can: (p) => permissions.includes(p),
    members: s.members,
    memberName: (id) => memberNameIn(s.members, id, s.loaded),
    workspaces: s.workspaces,
    workspacesLoaded: s.loaded,
  };
}

/** The context for React components; recomputed only when one of its sources changes. */
export function useBlocksContext(): BlocksContext {
  const profile = useSession((s) => s.profile);
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const storeUserId = useWorkspaces((s) => s.userId);
  const storeSuper = useWorkspaces((s) => s.isSuperAdmin);
  const roleKey = useWorkspaces((s) => s.me?.roleKey ?? null);
  const customRoles = useWorkspaces((s) => s.customRoles);
  const members = useWorkspaces((s) => s.members);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const loaded = useWorkspaces((s) => s.ready);
  const userId = profile?.userId ?? storeUserId ?? null;
  const isSuperAdmin = profile ? profile.isSuperAdmin === true : storeSuper === true;
  return useMemo(
    () => build({ workspaceId, userId, isSuperAdmin, roleKey, customRoles, members, workspaces, loaded }),
    [workspaceId, userId, isSuperAdmin, roleKey, customRoles, members, workspaces, loaded],
  );
}

/** The same context outside React (event handlers, query functions). */
export function getBlocksContext(): BlocksContext {
  const profile = useSession.getState().profile;
  const w = useWorkspaces.getState();
  return build({
    workspaceId: w.workspaceId,
    userId: profile?.userId ?? w.userId ?? null,
    isSuperAdmin: profile ? profile.isSuperAdmin === true : w.isSuperAdmin === true,
    roleKey: w.me?.roleKey ?? null,
    customRoles: w.customRoles,
    members: w.members,
    workspaces: w.workspaces,
    loaded: w.ready,
  });
}

export function useBlocksCan(p: WorkspacePermission): boolean {
  return useBlocksContext().can(p);
}
