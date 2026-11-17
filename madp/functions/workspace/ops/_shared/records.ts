// Row types and field lists copied from blocks/data/schemas/<Name>.json (+ ItemId).
import type { RoleDef } from "../../../../src/domain/roles";

export const SCHEMA = {
  workspace: "Workspace",
  membership: "Membership",
  invitation: "Invitation",
  account: "Account",
  workspaceRole: "WorkspaceRole",
  platformRole: "PlatformRole",
  platformRoleAssignment: "PlatformRoleAssignment",
  platformSetting: "PlatformSetting",
  notification: "Notification",
  auditEvent: "AuditEvent",
} as const;

/** The schemas that carry ReaderIds but no WorkspaceId (restamped by restampPlatform). */
export const PLATFORM_SCHEMAS = ["PlatformRole", "PlatformRoleAssignment", "PlatformSetting"] as const;

/** S1 has no Account.IsSuperAdmin yet; the coordinator flips this to 'IsSuperAdmin' once it exists. */
export const ACCOUNT_SUPER_ADMIN_FIELD: "IsSuperAdmin" | null = null;

/** A raw gateway row. */
export type Row = Record<string, unknown>;

interface Base {
  ItemId: string;
  CreatedByUserId?: string;
  UpdatedByUserId?: string;
}

export interface WorkspaceRow extends Base {
  WorkspaceId: string;
  ReaderIds: string[];
  Name: string;
  Status: "active" | "suspended" | "archived";
  IsExample?: boolean;
  SeedKey?: string;
}
export const WORKSPACE_FIELDS = [
  "ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Name", "Status", "IsExample", "SeedKey",
] as const;

export type MembershipStatus = "pending-account" | "invited" | "active" | "suspended" | "removed";
export interface MembershipRow extends Base {
  WorkspaceId: string;
  ReaderIds: string[];
  UserId: string;
  Email: string;
  DisplayName: string;
  RoleKey: string;
  Status: MembershipStatus;
  InvitedByUserId: string;
  InvitedAt: string;
  JoinedAt: string;
  SuspendedAt: string;
  RemovedAt: string;
  LastUpdatedDate?: string;
}
export const MEMBERSHIP_FIELDS = [
  "ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "UserId", "Email", "DisplayName",
  "RoleKey", "Status", "InvitedByUserId", "InvitedAt", "JoinedAt", "SuspendedAt", "RemovedAt", "LastUpdatedDate",
] as const;

export interface InvitationRow extends Base {
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
}
export const INVITATION_FIELDS = [
  "ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Email", "RoleKey", "Kind", "Status",
  "MembershipId", "InvitedByUserId", "InvitedAt", "ResolvedByUserId", "ResolvedAt", "Note",
] as const;

export interface AccountRow extends Base {
  UserId: string;
  Email: string;
  DisplayName: string;
  Status: "active" | "deactivated";
  LastSignInAt: string;
  DeactivatedAt: string;
  DeactivatedByUserId: string;
  IsSuperAdmin?: boolean;
  MustChangePassword?: boolean;
  TemporaryPasswordSetAt?: string;
}
export const ACCOUNT_FIELDS = [
  "ItemId", "CreatedByUserId", "UpdatedByUserId", "UserId", "Email", "DisplayName", "Status", "LastSignInAt",
  "DeactivatedAt", "DeactivatedByUserId",
] as const;
/** Read only where the flag matters: not part of ACCOUNT_FIELDS, so every other read works before the fields exist on the live gateway. */
export const ACCOUNT_PASSWORD_FIELDS = ["MustChangePassword", "TemporaryPasswordSetAt"] as const;

export interface WorkspaceRoleRow extends Base {
  WorkspaceId: string;
  ReaderIds: string[];
  Key: string;
  Name: string;
  Description: string;
  Permissions: string[];
  IsBuiltIn: boolean;
}
export const WORKSPACE_ROLE_FIELDS = [
  "ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Key", "Name", "Description",
  "Permissions", "IsBuiltIn",
] as const;

export interface PlatformRoleRow extends Base {
  ReaderIds: string[];
  Key: string;
  Name: string;
  Description: string;
  Permissions: string[];
  IsBuiltIn: boolean;
  /** "organization" marks an organization role template; absent or "platform" is a platform role. Read with PLATFORM_ROLE_SCOPED_FIELDS. */
  Scope?: string;
}
export const PLATFORM_ROLE_FIELDS = [
  "ItemId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Key", "Name", "Description", "Permissions", "IsBuiltIn",
] as const;

export interface PlatformRoleAssignmentRow extends Base {
  ReaderIds: string[];
  UserId: string;
  RoleKey: string;
  Status: "active" | "revoked";
  AssignedByUserId: string;
  AssignedAt: string;
  RevokedAt: string;
}
export const PLATFORM_ROLE_ASSIGNMENT_FIELDS = [
  "ItemId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "UserId", "RoleKey", "Status", "AssignedByUserId",
  "AssignedAt", "RevokedAt",
] as const;

export interface PlatformSettingRow extends Base {
  ReaderIds: string[];
  Key: string;
  Values: string[];
  ValueJson: string;
  Description: string;
}
export const PLATFORM_SETTING_FIELDS = [
  "ItemId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Key", "Values", "ValueJson", "Description",
] as const;

export interface NotificationRow extends Base {
  RecipientUserId: string;
  WorkspaceId: string;
  ProjectId: string;
  EventKey: string;
  Kind: string;
  ParamsJson: string;
  Link?: string;
  IsRead: boolean;
  ReadAt: string;
  EmailStatus: "none" | "pending" | "sent" | "failed";
}
export const NOTIFICATION_FIELDS = [
  "ItemId", "CreatedByUserId", "UpdatedByUserId", "RecipientUserId", "WorkspaceId", "ProjectId", "EventKey", "Kind",
  "ParamsJson", "Link", "IsRead", "ReadAt", "EmailStatus",
] as const;

export interface AuditEventRow extends Base {
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
}
export const AUDIT_EVENT_FIELDS = [
  "ItemId", "CreatedByUserId", "UpdatedByUserId", "WorkspaceId", "ProjectId", "ActorUserId", "ActorIsSuperAdmin",
  "Impersonated", "Action", "TargetType", "TargetId", "DetailsJson", "At",
] as const;

/** A stored WorkspaceRole / PlatformRole row as the pure role definition. */
export function toRoleDef(row: {
  Key: string;
  Name: string;
  Description?: string;
  Permissions?: readonly string[];
  IsBuiltIn?: boolean;
}): RoleDef {
  return {
    key: row.Key,
    name: row.Name,
    description: row.Description || undefined,
    permissions: row.Permissions ?? [],
    isBuiltIn: Boolean(row.IsBuiltIn),
  };
}
