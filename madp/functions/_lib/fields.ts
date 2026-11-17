/** The single registry of every schema and field the library reads or writes (checked against S1 by a contract test). */
export const SYSTEM_FIELDS = ["ItemId"] as const;
/** Fields S2 adds to S1's schemas; absent from blocks/data/schemas until then. */
export const PENDING_S2_FIELDS = ["RequestKey"] as const;
export const ACL_STAMP_FIELDS = ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId"] as const;
/** Written only by the router (or deps.audit / deps.notify), never through deps.gw. */
export const ROUTED_SCHEMAS = ["Operation", "AuditEvent", "Notification"] as const;

/** Every column of the Project schema plus the system stamps: the one read of the project row in round trip 1. */
export const PROJECT_ROW_FIELDS = [
  "ItemId", "CreatedDate", "LastUpdatedDate",
  "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Name", "ClientName", "ClientContact", "ClientIndustry",
  "ClientRegion", "Status", "BusinessHandedOverByUserId", "Brief", "NameSuggested", "Stage", "ResumeTo", "CurrentScopeVersion",
  "AssigneeUserId", "BusinessHandedOverAt", "SanitizationCompletedAt", "RequirementsConfirmedAt", "ScopeLockedAt", "RepoProvider",
  "RepoOwner", "RepoName", "RepoMode", "RepoVisibility", "RepoBranch", "RepoExisting", "RepoNameEdited", "IsExample", "SeedKey",
  "Rev", "RequestKey",
  // the Landing page add-on and its Goals & requirements section (src/domain/landingPage.ts)
  "LandingPageAddOn", "LandingPageSection",
] as const;

export const LIB_FIELDS = {
  Account: ["ItemId", "UserId", "Email", "Status", "DisplayName"],
  Workspace: ["ItemId", "WorkspaceId", "Name", "Status"],
  Membership: ["ItemId", "WorkspaceId", "UserId", "Email", "RoleKey", "Status"],
  WorkspaceRole: ["ItemId", "WorkspaceId", "Key", "Name", "Description", "Permissions", "IsBuiltIn"],
  PlatformRole: ["ItemId", "Key", "Name", "Permissions", "IsBuiltIn"],
  PlatformRoleAssignment: ["ItemId", "UserId", "RoleKey", "Status"],
  Project: ["ItemId", "WorkspaceId", "Name", "AssigneeUserId", "CreatedByUserId", "ReaderIds"],
  Operation: [
    "ItemId", "RequestKey", "RequestId", "Op", "WorkspaceId", "ProjectId", "ActorUserId", "Status",
    "ResultJson", "ErrorCode", "Attempt", "CreatedByUserId", "UpdatedByUserId",
  ],
  AuditEvent: [
    "ItemId", "RequestKey", "WorkspaceId", "ProjectId", "ActorUserId", "ActorIsSuperAdmin", "Impersonated",
    "Action", "TargetType", "TargetId", "DetailsJson", "At", "CreatedByUserId", "UpdatedByUserId",
  ],
  Notification: [
    "ItemId", "RequestKey", "RecipientUserId", "WorkspaceId", "ProjectId", "EventKey", "Kind", "ParamsJson",
    "Link", "IsRead", "EmailStatus", "CreatedByUserId", "UpdatedByUserId",
  ],
  EngineJob: [
    "ItemId", "RequestKey", "WorkspaceId", "ReaderIds", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType",
    "TargetId", "InputJson", "OutputRefs", "Progress", "Message", "Attempts", "ClaimedBy", "ClaimedAt",
    "StartedAt", "FinishedAt", "ErrorCode", "RequestedByUserId", "CreatedByUserId", "UpdatedByUserId",
  ],
} as const;

export type LibSchema = keyof typeof LIB_FIELDS;

export function fieldsOf(schema: LibSchema): readonly string[] {
  return LIB_FIELDS[schema];
}
