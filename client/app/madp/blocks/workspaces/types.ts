// Row types and op result types for the tenancy schemas. Field lists come from blocks/data/schemas (S1); CreatedDate is the
// Blocks system field used for newest-first sorts. Structural only: no db import.
import type { PlatformSettingKey } from "@/madp/domain/platform";

export const WORKSPACE_FIELDS = [
  "WorkspaceId", "ReaderIds", "Name", "Status", "IsExample", "SeedKey", "CreatedByUserId", "UpdatedByUserId", "CreatedDate",
] as const;
export interface WorkspaceRow {
  ItemId: string;
  WorkspaceId: string;
  ReaderIds: string[];
  Name: string;
  Status: "active" | "suspended" | "archived";
  IsExample: boolean;
  SeedKey: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
  CreatedDate: string;
}

export const MEMBERSHIP_FIELDS = [
  "WorkspaceId", "ReaderIds", "UserId", "Email", "DisplayName", "RoleKey", "Status", "InvitedByUserId", "InvitedAt",
  "JoinedAt", "SuspendedAt", "RemovedAt", "CreatedByUserId", "UpdatedByUserId",
] as const;
export interface MembershipRow {
  ItemId: string;
  WorkspaceId: string;
  ReaderIds: string[];
  UserId: string;
  Email: string;
  DisplayName: string;
  RoleKey: string;
  Status: "pending-account" | "invited" | "active" | "suspended" | "removed";
  InvitedByUserId: string;
  InvitedAt: string;
  JoinedAt: string;
  SuspendedAt: string;
  RemovedAt: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const INVITATION_FIELDS = [
  "WorkspaceId", "ReaderIds", "Email", "RoleKey", "Kind", "Status", "MembershipId", "InvitedByUserId", "InvitedAt",
  "ResolvedByUserId", "ResolvedAt", "Note", "CreatedByUserId", "UpdatedByUserId",
] as const;
export interface InvitationRow {
  ItemId: string;
  WorkspaceId: string;
  ReaderIds: string[];
  Email: string;
  RoleKey: string;
  Kind: "existing-account" | "pending-account";
  Status: "pending" | "approved" | "rejected" | "accepted" | "cancelled";
  MembershipId: string;
  InvitedByUserId: string;
  InvitedAt: string;
  ResolvedByUserId: string;
  ResolvedAt: string;
  Note: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const ACCOUNT_FIELDS = [
  "UserId", "Email", "DisplayName", "Status", "LastSignInAt", "DeactivatedAt", "DeactivatedByUserId",
  "CreatedByUserId", "UpdatedByUserId",
] as const;
export interface AccountRow {
  ItemId: string;
  UserId: string;
  Email: string;
  DisplayName: string;
  Status: "active" | "deactivated";
  LastSignInAt: string;
  DeactivatedAt: string;
  DeactivatedByUserId: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const WORKSPACE_ROLE_FIELDS = [
  "WorkspaceId", "ReaderIds", "Key", "Name", "Description", "Permissions", "IsBuiltIn", "CreatedByUserId", "UpdatedByUserId",
] as const;
export interface WorkspaceRoleRow {
  ItemId: string;
  WorkspaceId: string;
  ReaderIds: string[];
  Key: string;
  Name: string;
  Description: string;
  Permissions: string[];
  IsBuiltIn: boolean;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const PLATFORM_ROLE_FIELDS = [
  "ReaderIds", "Key", "Name", "Description", "Permissions", "IsBuiltIn", "CreatedByUserId", "UpdatedByUserId",
] as const;
export interface PlatformRoleRow {
  ItemId: string;
  ReaderIds: string[];
  Key: string;
  Name: string;
  Description: string;
  Permissions: string[];
  IsBuiltIn: boolean;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const PLATFORM_ROLE_ASSIGNMENT_FIELDS = [
  "ReaderIds", "UserId", "RoleKey", "Status", "AssignedByUserId", "AssignedAt", "RevokedAt", "CreatedByUserId", "UpdatedByUserId",
] as const;
/** No Email or DisplayName: names come from Account / Membership. */
export interface PlatformRoleAssignmentRow {
  ItemId: string;
  ReaderIds: string[];
  UserId: string;
  RoleKey: string;
  Status: "active" | "revoked";
  AssignedByUserId: string;
  AssignedAt: string;
  RevokedAt: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const PLATFORM_SETTING_FIELDS = [
  "ReaderIds", "Key", "Values", "ValueJson", "Description", "CreatedByUserId", "UpdatedByUserId",
] as const;
/** The list is in Values; there is no Value field. */
export interface PlatformSettingRow {
  ItemId: string;
  ReaderIds: string[];
  Key: string;
  Values: string[];
  ValueJson: string;
  Description: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
}

export const NOTIFICATION_FIELDS = [
  "RecipientUserId", "WorkspaceId", "ProjectId", "EventKey", "Kind", "ParamsJson", "Link", "IsRead", "ReadAt", "EmailStatus",
  "CreatedByUserId", "UpdatedByUserId", "CreatedDate",
] as const;
export interface NotificationRow {
  ItemId: string;
  RecipientUserId: string;
  WorkspaceId: string;
  ProjectId: string;
  EventKey: string;
  Kind: string;
  ParamsJson: string;
  Link: string;
  IsRead: boolean;
  ReadAt: string;
  EmailStatus: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
  CreatedDate: string;
}

export const AUDIT_EVENT_FIELDS = [
  "WorkspaceId", "ProjectId", "ActorUserId", "ActorIsSuperAdmin", "Impersonated", "Action", "TargetType", "TargetId",
  "DetailsJson", "At", "CreatedByUserId", "UpdatedByUserId", "CreatedDate",
] as const;
export interface AuditEventRow {
  ItemId: string;
  WorkspaceId: string;
  ProjectId: string;
  ActorUserId: string;
  ActorIsSuperAdmin: boolean;
  Impersonated: boolean;
  Action: string;
  TargetType: string;
  TargetId: string;
  DetailsJson: string;
  At: string;
  CreatedByUserId: string;
  UpdatedByUserId: string;
  CreatedDate: string;
}

/** The tenancy schemas this module reads or the functions write. */
export const TENANCY_SCHEMAS = [
  "Workspace", "Membership", "Invitation", "Account", "WorkspaceRole", "PlatformRole", "PlatformRoleAssignment",
  "PlatformSetting", "Notification", "AuditEvent",
] as const;

/** The result of a web op wrapper: structurally a DbResult (this module never imports the local database). */
export type OpOutcome<T = void> = { ok: true; value: T } | { ok: false; error: string; code?: string };

/* ---------- op results (server contract) ---------- */

export interface CreateWorkspaceResult { workspace: WorkspaceRow; membership: MembershipRow }
/** workspace.rename: `changed` is false when the workspace already had the name (nothing was written). */
export interface RenameWorkspaceResult { workspace: { id: string; name: string; updatedAt: string }; changed: boolean }
export type InvitePath = "invite" | "pending-account" | "reinvite-invited" | "reinvite-pending";
export interface InviteResult { membership: MembershipRow; invitation: InvitationRow; path: InvitePath }

export interface BootstrapResult {
  account: { userId: string; email: string; displayName: string; status: "active" | "deactivated" };
  isSuperAdmin?: boolean;
  platformPermissions?: string[];
  allowedEmailDomains?: string[];
  workspaces?: { workspaceId: string; name: string; status: string; membershipId: string; roleKey: string }[];
  accepted?: { workspaceId: string; name: string; membershipId: string }[];
  blocked?: { workspaceId: string; name: string }[];
  suspended?: { workspaceId: string; name: string }[];
}

/** me.access: the person's own platform access as the ops resolve it (read-only). */
export interface MyAccessResult {
  isSuperAdmin: boolean;
  platformPermissions: string[];
  platformRoleKeys: string[];
}

export interface MarkReadResult { marked: number; skipped: number }
export interface MarkAllReadResult { marked: number; remaining: number }
export interface RestampResult { readerCount: number; schemas: string[]; rows: number }

export interface PlatformRoleListResult {
  roles: { itemId: string | null; key: string; name: string; description?: string; permissions: string[]; isBuiltIn: boolean }[];
  assignments: { itemId: string; userId: string; roleKey: string; status: string; email: string; displayName: string }[];
}
export interface IamRoleChange { userId: string; role: "mf-platform-users"; grant: boolean }
export interface AssignResult { assignment: PlatformRoleAssignmentRow; iamRoleChange?: IamRoleChange }
export interface WorkspaceRoleSaveResult { role: WorkspaceRoleRow; created: boolean }
export interface WorkspaceRoleDeleteResult { key: string; reassigned: number }
export interface AllowedDomainsResult { domains: string[]; exceptions: string[]; isDefault: boolean }

export interface AuditListArgs {
  workspaceId?: string;
  actorUserId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}
export interface AuditListResult { items: AuditEventRow[]; totalCount: number; page: number; pageSize: number }

export interface DeactivateResult {
  account: AccountRow;
  suspendedMemberships: number;
  ownerlessWorkspaces: { workspaceId: string; name: string }[];
}
export interface ReactivateResult { account: AccountRow; restoredMemberships: number }
export interface SuspendResult { workspace: WorkspaceRow; readerCount: number }

export interface WorkspaceListResult {
  items: {
    workspaceId: string;
    name: string;
    status: string;
    memberCount: number;
    admins: { userId: string; email: string; displayName: string }[];
    /** Active plan key (billing); null or absent where none is recorded. */
    planKey?: string | null;
  }[];
  totalCount: number;
  page: number;
  pageSize: number;
}
export interface WorkspaceInspectResult {
  workspace: WorkspaceRow;
  members: MembershipRow[];
  customRoles: WorkspaceRoleRow[];
}
export interface AccessRequestListResult {
  items: {
    invitationId: string;
    membershipId: string;
    email: string;
    workspaceId: string;
    workspaceName: string;
    invitedByUserId: string;
    invitedByName: string;
    invitedAt: string;
  }[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/* ---------- the one mapper between A1's setting keys and S1's PlatformSetting keys ---------- */

export type S1SettingKey = "allowed-email-domains" | "allowed-email-exceptions";

const TO_S1: Record<PlatformSettingKey, S1SettingKey> = {
  allowedEmailDomains: "allowed-email-domains",
  qaExceptions: "allowed-email-exceptions",
};

export function toS1SettingKey(k: PlatformSettingKey): S1SettingKey {
  return TO_S1[k];
}

export function fromS1SettingKey(k: string): PlatformSettingKey | null {
  const hit = (Object.keys(TO_S1) as PlatformSettingKey[]).find((a) => TO_S1[a] === k);
  return hit ?? null;
}
