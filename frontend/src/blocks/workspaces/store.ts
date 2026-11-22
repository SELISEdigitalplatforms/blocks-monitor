// THE workspace store: a snapshot of what the signed-in person can see (workspaces, team, roles, bell), written only by
// ./sync. Render-time reads (memberById, activeWorkspaceId, canNow) read this snapshot and never the database.
import { create } from "zustand";
import { WORKSPACE_ROLE_LABEL, isWorkspaceRole, type PlatformPermission, type WorkspacePermission, type WorkspaceRole } from "@/domain/rbac";
import { workspacePermissionsFor, type RoleDef } from "@/domain/roles";
import type { NotificationKind } from "@/domain/notifications";
import { workspaceWritable } from "@/domain/tenancy";
import type { MembershipRow } from "./types";

export interface Workspace { id: string; name: string; createdAt: string }
export type WorkspaceStatus = "active" | "suspended" | "archived";
export type MyWorkspace = Workspace & {
  role: WorkspaceRole;
  roleKey: string;
  roleName: string;
  status: WorkspaceStatus;
  membershipId: string | null;
  viaPlatform: boolean;
};
export type MemberStatus = "active" | "invited" | "pending-account";
export interface Member {
  /** The IAM user id (a pending-account row with no user yet uses its membership id). */
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  /** Compatibility value: the built-in key; for a custom role "member" when it holds project.edit, else "viewer". */
  role: WorkspaceRole;
  status: MemberStatus;
  invitedAt: string | null;
  joinedAt: string | null;
  userId: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  permissions: WorkspacePermission[];
  isCustomRole: boolean;
  viaPlatform?: boolean;
}
export interface AssignmentEvent { projectId: string; memberId: string; assignedBy: string; assignedAt: string }
export interface ActivityEntry { kind: "assigned" | "reassigned" | "unassigned"; by: string; from: string; to: string; at: string }
export type ShareItemType = "scope" | "screens" | "screen";
export interface ShareTarget { type: ShareItemType; ref: string; label: string }
export interface Share {
  id: string; workspaceId: string; itemType: ShareItemType; itemRef: string; projectId: string;
  sharedBy: string; sharedWith: string; createdAt: string;
}
export type { NotificationKind };
export interface MemberNotification { id: string; memberId: string; kind: NotificationKind; text: string; link: string; read: boolean; createdAt: string }

export interface WorkspaceState {
  ready: boolean;
  workspaceId: string | null;
  email: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  workspaces: MyWorkspace[];
  /** The assignable people: active and invited. */
  members: Member[];
  /** Everyone with a row in the active workspace, including pending-account. */
  team: Member[];
  me: Member | null;
  customRoles: RoleDef[];
  platformPermissions: PlatformPermission[];
  allowedEmailDomains: string[];
  suspended: { workspaceId: string; name: string }[];
  blocked: { workspaceId: string; name: string }[];
  bootstrapError: string | null;
  /** True from sign-in until me.bootstrap answers (success or failure); `ready` no longer waits for it when a workspace exists. */
  bootstrapPending: boolean;
  loadError: string | null;
  assignments: AssignmentEvent[];
  shares: Share[];
  notifications: MemberNotification[];
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = {
  ready: false,
  workspaceId: null,
  email: null,
  userId: null,
  isSuperAdmin: false,
  workspaces: [],
  members: [],
  team: [],
  me: null,
  customRoles: [],
  platformPermissions: [],
  allowedEmailDomains: [],
  suspended: [],
  blocked: [],
  bootstrapError: null,
  bootstrapPending: false,
  loadError: null,
  assignments: [],
  shares: [],
  notifications: [],
};

export const useWorkspaces = create<WorkspaceState>(() => ({ ...EMPTY_WORKSPACE_STATE }));

/** Back to the empty snapshot; `ready` says whether that emptiness is known (signed out) or still loading. */
export function resetWorkspaceStore(ready: boolean): void {
  useWorkspaces.setState({
    ...EMPTY_WORKSPACE_STATE,
    workspaces: [], members: [], team: [], customRoles: [], platformPermissions: [], allowedEmailDomains: [],
    suspended: [], blocked: [], assignments: [], shares: [], notifications: [],
    ready,
  });
}

/** Tests merge a partial snapshot into the store. */
export function __setWorkspaceSnapshotForTests(partial: Partial<WorkspaceState>): void {
  useWorkspaces.setState(partial);
}

const nameFromEmail = (email: string): string => email.trim().split("@")[0] ?? "";

/** True when a display name is really an email address (the invite-time copy in Membership.DisplayName). */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(s.trim());
}

/** A team member from a Membership row; identity comes from the verified profile or membership copy, never an Account mirror. */
export function memberFromRow(
  row: MembershipRow,
  c: { customRoles: RoleDef[]; accountName?: string | null; selfName?: string | null },
): Member {
  const roleKey = row.RoleKey;
  const builtIn = isWorkspaceRole(roleKey);
  const custom = builtIn ? undefined : c.customRoles.find((r) => !r.isBuiltIn && r.key === roleKey);
  const permissions = workspacePermissionsFor({ roleKey, customRoles: c.customRoles });
  const role: WorkspaceRole = builtIn ? roleKey : permissions.includes("project.edit") ? "member" : "viewer";
  const roleName = builtIn ? WORKSPACE_ROLE_LABEL[roleKey] : (custom?.name ?? "Custom role");
  const status: MemberStatus =
    row.Status === "active" ? "active" : row.Status === "pending-account" ? "pending-account" : "invited";
  const email = (row.Email ?? "").trim().toLowerCase();
  return {
    id: row.UserId || row.ItemId,
    workspaceId: row.WorkspaceId,
    name:
      [c.selfName, c.accountName, row.DisplayName].map((v) => (v ?? "").trim()).find((v) => v && !looksLikeEmail(v)) ||
      nameFromEmail(email),
    email,
    role,
    status,
    invitedAt: row.InvitedAt || null,
    joinedAt: row.JoinedAt || null,
    userId: row.UserId ?? "",
    membershipId: row.ItemId,
    roleKey,
    roleName,
    permissions,
    isCustomRole: !builtIn,
  };
}

export function currentWorkspace(state: WorkspaceState): MyWorkspace | null {
  return state.workspaces.find((w) => w.id === state.workspaceId) ?? null;
}

/** True when the active workspace accepts writes (it is active). */
export function canWrite(state: WorkspaceState): boolean {
  const ws = currentWorkspace(state);
  return ws ? workspaceWritable(ws.status) : false;
}
