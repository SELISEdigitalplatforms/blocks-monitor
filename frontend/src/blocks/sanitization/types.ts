// Row and argument types of the Product sanitization data layer. Field names follow S1's schema files.
import type { AssistFocus, Blocker, ClarificationStatus } from "@/domain/sanitization";

export type { AssistFocus, Blocker, ClarificationStatus };

export interface SanitizationCtx {
  workspaceId: string | null;
  projectId: string;
}

export const SANITIZATION_SECTIONS = ["clarifications", "decisions", "technical", "discussion", "requirements"] as const;
export type SanitizationSection = (typeof SANITIZATION_SECTIONS)[number];

interface BaseRow {
  ItemId: string;
  WorkspaceId: string;
  ProjectId: string;
  CreatedDate?: string | null;
  LastUpdatedDate?: string | null;
  CreatedByUserId?: string | null;
  UpdatedByUserId?: string | null;
}

export interface ProjectRow extends BaseRow {
  Name: string;
  ClientName?: string | null;
  Stage: string;
  ResumeTo?: string | null;
  BusinessHandedOverAt?: string | null;
  BusinessHandedOverByUserId?: string | null;
  Status?: string | null;
  ClientContact?: string | null;
  ClientIndustry?: string | null;
  ClientRegion?: string | null;
  AssigneeUserId?: string | null;
  RequirementsConfirmedAt?: string | null;
  RequirementsConfirmedByUserId?: string | null;
  /** The project type: "new" = greenfield, "existing" = brownfield (src/domain/projectType.ts). */
  RepoMode?: string;
  RepoOwner?: string;
  RepoName?: string;
  RepoBranch?: string;
  RepoVisibility?: string;
  /* the guided project start's answers (read so the shared Project cache row keeps them) */
  Goal?: string; TargetUsers?: string; AppUrl?: string; WebsiteUrl?: string; LandingPageAddOn?: string; LandingPageSection?: string; TestEnv?: string; RunInstructions?: string;
  BlocksProjectRef?: string; SetupStatus?: string; SetupAnswers?: string; RepoExisting?: string | boolean;
}

export interface ClarificationRow extends BaseRow {
  Number: number;
  Question: string;
  /** The engine's one-click answers for this question (empty for a person's own question). */
  Options?: string[] | null;
  Answer?: string | null;
  Status: ClarificationStatus;
  OwnerUserId?: string | null;
  SourceType?: string | null;
  SourceRef?: string | null;
  DeferReason?: string | null;
  AnsweredByUserId?: string | null;
  AnsweredAt?: string | null;
  SortOrder?: number | null;
}

export interface DecisionRow extends BaseRow {
  Number: number;
  Title: string;
  Statement?: string | null;
  Rationale?: string | null;
  Status: "proposed" | "accepted" | "rejected" | "superseded";
  ClarificationId?: string | null;
  SupersededById?: string | null;
  DecidedByUserId?: string | null;
  DecidedAt?: string | null;
}

export interface TechDecisionRow extends BaseRow {
  Number: number;
  Area: string;
  Title: string;
  Choice?: string | null;
  Rationale?: string | null;
  Alternatives?: string | string[] | null;
  ExpertUserIds?: string[] | null;
  Status: string;
  NfrCategory?: string | null;
  NfrTarget?: string | null;
  IntegrationSystem?: string | null;
}

export interface RequirementRow extends BaseRow {
  Number: number;
  Key: string;
  Title: string;
  Text?: string | null;
  Priority: "must" | "nice" | "later";
  Status: string;
  AcceptanceCriteria?: string[] | null;
  SortOrder?: number | null;
}

export interface ObjectiveRow extends BaseRow {
  Statement?: string | null;
  AcceptanceCriteria?: string[] | null;
  HighLevelMd?: string | null;
  ArchitectureMd?: string | null;
  Status: string;
}

export interface ItemVersionRow extends BaseRow {
  ItemKey: string;
  N: number;
  Text?: string | null;
  Origin?: string | null;
}

export interface ThreadRow extends BaseRow {
  TargetType: string;
  TargetId: string;
  Status: string;
}

export interface CommentRow extends BaseRow {
  ThreadId: string;
  AuthorUserId: string;
  Text: string;
  Kind: string;
  At: string;
}

export interface MembershipRow extends BaseRow {
  UserId: string;
  DisplayName?: string | null;
  Email: string;
  RoleKey: string;
  Status: string;
}

export interface DocFolderRow extends BaseRow {
  Name: string;
  ParentId?: string | null;
}
export interface DocNoteRow extends BaseRow {
  Title: string;
  FolderId?: string | null;
}
export interface DocFileRow extends BaseRow {
  Name: string;
  FolderId?: string | null;
  Status?: string | null;
}

// The Project item key is shared by the projects, sanitization and requirements readers, so the three lists must stay identical (test/blocks-project-item-fields.test.ts).
export const PROJECT_FIELDS = [
  "ItemId", "WorkspaceId", "Name", "ClientName", "ClientContact", "ClientIndustry", "ClientRegion",
  "Stage", "ResumeTo", "Status", "AssigneeUserId", "BusinessHandedOverAt", "BusinessHandedOverByUserId", "CreatedByUserId", "CreatedDate", "LastUpdatedDate", "RequirementsConfirmedAt", "RequirementsConfirmedByUserId",
  "RepoMode", "RepoOwner", "RepoName", "RepoBranch", "RepoVisibility",
  "Goal", "TargetUsers", "AppUrl", "WebsiteUrl", "LandingPageAddOn", "LandingPageSection", "TestEnv", "RunInstructions", "BlocksProjectRef", "SetupStatus", "SetupAnswers", "RepoExisting",
] as const;
export const CLARIFICATION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Number", "Question", "Options", "Answer", "Status", "OwnerUserId", "SourceType", "SourceRef",
  "DeferReason", "AnsweredByUserId", "AnsweredAt", "SortOrder", "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId",
] as const;
export const DECISION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Number", "Title", "Statement", "Rationale", "Status", "ClarificationId", "SupersededById",
  "DecidedByUserId", "DecidedAt", "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId",
] as const;
export const TECH_DECISION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Number", "Area", "Title", "Choice", "Rationale", "Alternatives", "ExpertUserIds", "Status",
  "NfrCategory", "NfrTarget", "IntegrationSystem", "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId",
] as const;
export const REQUIREMENT_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Number", "Key", "Title", "Text", "Priority", "Status", "AcceptanceCriteria", "SortOrder",
  "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId",
] as const;
export const OBJECTIVE_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Statement", "AcceptanceCriteria", "HighLevelMd", "ArchitectureMd", "Status",
  "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId",
] as const;
export const ITEM_VERSION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "ItemKey", "N", "Text", "Origin", "CreatedDate", "CreatedByUserId",
] as const;
export const THREAD_FIELDS = ["ItemId", "WorkspaceId", "ProjectId", "TargetType", "TargetId", "Status"] as const;
export const COMMENT_FIELDS = ["ItemId", "WorkspaceId", "ProjectId", "ThreadId", "AuthorUserId", "Text", "Kind", "At"] as const;
export const MEMBERSHIP_ROW_FIELDS = ["ItemId", "WorkspaceId", "UserId", "DisplayName", "Email", "RoleKey", "Status"] as const;
export const DOC_FOLDER_FIELDS = ["ItemId", "WorkspaceId", "ProjectId", "Name", "ParentId", "CreatedDate"] as const;
export const DOC_NOTE_FIELDS = ["ItemId", "WorkspaceId", "ProjectId", "Title", "FolderId", "CreatedDate"] as const;
export const DOC_FILE_FIELDS = ["ItemId", "WorkspaceId", "ProjectId", "Name", "FolderId", "Status", "CreatedDate"] as const;

export interface BusinessRef {
  id: string;
  type: "note" | "file" | "folder";
  title: string;
  folderId: string | null;
  createdAt: string | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  roleKey: string;
}

export interface MemberDirectory {
  list: Member[];
  nameOf(userId?: string | null): string;
}

export interface StepAccess {
  userId: string | null;
  permissions: readonly string[];
  isSuperAdmin: boolean;
  canEdit: boolean;
  canComment: boolean;
  canManage: boolean;
  loading: boolean;
}

// ---- op arguments and results (as the server answers) ----

export interface ClarificationSaveArgs {
  projectId: string;
  id?: string;
  question: string;
  ownerUserId?: string;
  sourceType?: "note" | "file" | "";
  sourceId?: string;
  expectedUpdatedAt?: string;
  [k: string]: unknown;
}
/** attachmentIds + draftKey: the files sent with the answer (uploaded as drafts of the answer box, src/blocks/collab/talkUpload.ts). */
export interface ClarificationAnswerArgs { projectId: string; id: string; answer: string; expectedUpdatedAt?: string; attachmentIds?: string[]; draftKey?: string; [k: string]: unknown }
export interface ClarificationDeferArgs { projectId: string; id: string; reason: string; expectedUpdatedAt?: string; [k: string]: unknown }
export interface ClarificationReopenArgs { projectId: string; id: string; expectedUpdatedAt?: string; [k: string]: unknown }
export interface ClarificationDeleteArgs { projectId: string; id: string; [k: string]: unknown }
export interface ClarificationSaveResult { clarification: ClarificationRow }
/** The answer to the business analyst's own brief question (objective or users), recorded in one write. */
export interface BriefAnswerArgs { projectId: string; about: "goal" | "users"; answer: string; [k: string]: unknown }
export interface IdResult { id: string }

export interface DecisionSaveArgs {
  projectId: string;
  id?: string;
  title: string;
  decisionText: string;
  rationale?: string;
  clarificationId?: string;
  supersedesId?: string;
  expectedUpdatedAt?: string;
  [k: string]: unknown;
}
export interface DecisionSaveResult { decision: DecisionRow; superseded: DecisionRow | null }
export interface DecisionDeleteArgs { projectId: string; id: string; [k: string]: unknown }
export interface DecisionDeleteResult { id: string; restoredId: string | null }

export interface TechDecisionSaveArgs {
  projectId: string;
  id?: string;
  area: string;
  topic: string;
  choice?: string;
  rationale?: string;
  alternativesConsidered?: string;
  status?: string;
  nfrCategory?: string;
  target?: string;
  integrationSystem?: string;
  consultedUserIds?: string[];
  expectedUpdatedAt?: string;
  [k: string]: unknown;
}
export interface TechDecisionSaveResult { techDecision: TechDecisionRow }
export interface TechDecisionDeleteArgs { projectId: string; id: string; [k: string]: unknown }

export interface CommentAddArgs { projectId: string; text: string; [k: string]: unknown }
export interface CommentAddResult { threadId: string; comment: CommentRow }
export interface CommentDeleteArgs { projectId: string; commentId: string; [k: string]: unknown }

export interface RequirementUpsert {
  id?: string;
  clientKey?: string;
  title: string;
  description?: string;
  priority: "must" | "nice" | "later";
  acceptanceCriteria: string[];
  sortOrder: number;
  expectedUpdatedAt?: string;
}
export interface InitialRequirementsSaveArgs {
  projectId: string;
  objective?: { statement?: string; highLevelDetails?: string; architectureSummary?: string; expectedUpdatedAt?: string };
  upsert?: RequirementUpsert[];
  remove?: string[];
  [k: string]: unknown;
}
export interface InitialRequirementsSaveResult {
  objective: ObjectiveRow | null;
  requirements: RequirementRow[];
  removed: string[];
  conflicts: { kind: "requirement" | "objective"; id: string; clientKey?: string }[];
}

export interface CompleteArgs { projectId: string; [k: string]: unknown }
export interface CompleteResult { stage: string; versions: number }
export interface DraftInitialArgs { projectId: string; instruction?: string; [k: string]: unknown }
export interface AssistArgs { projectId: string; focus: AssistFocus; refId?: string; question?: string; [k: string]: unknown }
export interface JobCreateResult { jobId: string; existing: boolean }
