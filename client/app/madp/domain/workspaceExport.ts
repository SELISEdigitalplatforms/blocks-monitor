/**
 * Workspace export catalogue: which records leave in a workspace backup,
 * which fields, the paging cursor and the file layout. Pure: shared by the
 * `workspace.export` function and the web client, so no DOM, fs, clock or
 * SDK access.
 */

export const EXPORT_FORMAT = "madp-factory-workspace-export";
export const EXPORT_VERSION = 1;
/** One answer page stays well under Host B's 5 MB result cap. */
export const EXPORT_PAGE_BYTES = 1_000_000;
export const EXPORT_GATEWAY_PAGE_SIZE = 100;
export const EXPORT_MIN_REMAINING_MS = 5_000;
export const EXPORT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const EXPORT_CURSOR_MAX_LENGTH = 64;
export const EXPORT_SYSTEM_FIELDS = ["ItemId", "CreatedDate", "LastUpdatedDate"] as const;
/** Internal ACL and idempotency keys: never exported. */
export const EXPORT_STRIPPED_FIELDS = ["ReaderIds", "RequestKey", "SeedKey"] as const;

/** Declared fields that stay out of the file (schema -> field -> reason). None today. */
export const EXPORT_OMITTED_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({});

/** Ordered: parents before children. Fields are the declared ones plus the system ones, minus stripped and omitted. */
export const EXPORT_SCHEMAS: readonly { readonly schema: string; readonly fields: readonly string[] }[] = Object.freeze([
  { schema: "Workspace", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "Name", "Status", "IsExample", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Membership", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "UserId", "Email", "DisplayName", "RoleKey", "Status", "InvitedByUserId", "InvitedAt", "JoinedAt", "SuspendedAt", "RemovedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "WorkspaceRole", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "Key", "Name", "Description", "Permissions", "IsBuiltIn", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Invitation", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "Email", "RoleKey", "Kind", "Status", "MembershipId", "InvitedByUserId", "InvitedAt", "ResolvedByUserId", "ResolvedAt", "Note", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Project", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "Name", "ClientName", "ClientContact", "ClientIndustry", "ClientRegion", "Status", "BusinessHandedOverByUserId", "Brief", "NameSuggested", "Stage", "ResumeTo", "CurrentScopeVersion", "AssigneeUserId", "BusinessHandedOverAt", "SanitizationCompletedAt", "RequirementsConfirmedAt", "ScopeLockedAt", "RepoProvider", "RepoOwner", "RepoName", "RepoMode", "RepoVisibility", "RepoBranch", "RepoExisting", "RepoNameEdited", "IsExample", "Rev", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ProjectAssignment", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "AssigneeUserId", "AssignedByUserId", "At", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Share", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ItemType", "ItemRef", "SharedByUserId", "SharedWithUserId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "DocFolder", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ParentId", "Name", "Kind", "SortOrder", "Status", "CreatedDate", "LastUpdatedDate"] },
  { schema: "DocFile", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "FolderId", "Name", "StoredName", "Mime", "SizeBytes", "StorageObjectId", "Kind", "SortOrder", "Status", "CreatedDate", "LastUpdatedDate"] },
  { schema: "DocNote", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "FolderId", "Title", "BodyMd", "SortOrder", "IsScratchPad", "CreatedDate", "LastUpdatedDate"] },
  { schema: "DesignBrief", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Mode", "Instructions", "References", "SampleFileIds", "Status", "ConfirmedByUserId", "ConfirmedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "DesignScreen", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "DesignBriefId", "EngineJobId", "Key", "Name", "Version", "SortOrder", "ImageFileId", "Width", "Height", "Status", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Objective", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Statement", "AcceptanceCriteria", "HighLevelMd", "ArchitectureMd", "SpecVersion", "Status", "ConfirmedByUserId", "ConfirmedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Requirement", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Key", "Title", "Text", "Category", "Priority", "Status", "AcceptanceCriteria", "SourceRefs", "SpecVersion", "SortOrder", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ItemVersion", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ItemKey", "N", "Text", "CommentIds", "Origin", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Suggestion", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Source", "Key", "Title", "Text", "Status", "DecidedByUserId", "DecidedAt", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Clarification", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Question", "Answer", "Status", "OwnerUserId", "SourceType", "SourceRef", "DeferReason", "AnsweredByUserId", "AnsweredAt", "SortOrder", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Decision", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Title", "Statement", "Rationale", "ClarificationId", "Status", "SourceRef", "DecidedByUserId", "DecidedAt", "SupersededById", "CreatedDate", "LastUpdatedDate"] },
  { schema: "TechDecision", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Area", "Title", "Choice", "Rationale", "Alternatives", "NfrCategory", "NfrTarget", "IntegrationSystem", "ExpertUserIds", "Status", "DecidedByUserId", "DecidedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ProjectAnswer", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "QuestionKey", "OptionId", "Text", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ScopeVersion", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Title", "Summary", "Status", "PlanHours", "LockedByUserId", "LockedAt", "UnlockedAt", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Feature", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ScopeVersion", "Key", "Title", "Description", "Priority", "Status", "RequirementRefs", "SortOrder", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Story", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ScopeVersion", "FeatureRef", "Key", "Title", "Text", "ActorRole", "AcceptanceCriteria", "Priority", "EstimateHours", "SortOrder", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Milestone", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ScopeVersion", "Number", "Name", "Goal", "FeatureRefs", "SortOrder", "PreviewPoint", "Status", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "SecondOpinion", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ScopeVersion", "EngineJobId", "Readiness", "OpenHigh", "OpenMedium", "OpenLow", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Challenge", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "OpinionId", "ChallengeType", "Severity", "Question", "Why", "TargetType", "TargetRef", "FixType", "FixRef", "SuggestedFix", "AutofillAnswer", "AnswerText", "DismissReason", "FinalText", "Status", "DecidedByUserId", "DecidedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Attachment", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "OwnerType", "OwnerId", "FileId", "FileName", "StoredName", "Kind", "Mime", "SizeBytes", "Origin", "Meta", "Status", "CreatedDate", "LastUpdatedDate"] },
  { schema: "FeedbackThread", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "TargetType", "TargetId", "Status", "CreatedDate", "LastUpdatedDate"] },
  { schema: "FeedbackComment", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At", "CreatedDate", "LastUpdatedDate"] },
  { schema: "WikiPage", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Slug", "PageGroup", "Title", "BodyMd", "SourcesJson", "UpdatedWithVersion", "Origin", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "WikiPageHistory", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "PageId", "BodyMd", "EditedByUserId", "Origin", "At", "CreatedDate", "LastUpdatedDate"] },
  { schema: "AssistantMessage", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Environment", "Role", "Kind", "Text", "Points", "RefsJson", "AttachmentsJson", "AnalysisJson", "FixState", "FixChangeRequestId", "FixCode", "FixVersion", "EngineJobId", "At", "CreatedDate", "LastUpdatedDate"] },
  { schema: "AgentChatMessage", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "AgentRole", "Role", "Kind", "Text", "AuthorUserId", "TaskTarget", "TaskId", "TaskCode", "TaskTitle", "TaskLane", "TaskFeatureRef", "EngineJobId", "At", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Board", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ScopeVersion", "Status", "LockedAt", "PlanHours", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Ticket", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "PlanRef", "Title", "TicketType", "FeatureRef", "StoryRef", "MilestoneId", "AgentRole", "Column", "EstimateHours", "Acceptance", "SortOrder", "Description", "IsDone", "DoneAt", "Source", "ChangeRequestId", "EngineJobId", "DependsOn", "CreatedDate", "LastUpdatedDate"] },
  { schema: "TicketEvent", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "TicketId", "Kind", "FromColumn", "ToColumn", "AuthorUserId", "AuthorLabel", "Text", "At", "IsAuto", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ChangeRequest", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Lane", "FeatureRef", "Title", "Description", "Status", "Version", "RequestedByUserId", "EngineJobId", "Analysis", "AnalysedAt", "DecidedAt", "DecidedByUserId", "DecisionNote", "SelfApproved", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ChangeRequestAttachment", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ChangeRequestId", "AttachmentId", "Position", "Caption", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Release", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Environment", "Version", "Url", "Status", "ChangeRequestIds", "MilestoneId", "ApprovalRequestId", "ReleasedAt", "ReleasedByUserId", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "Preview", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "MilestoneId", "Environment", "Version", "Url", "Status", "ReadyAt", "EngineJobId", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ApprovalPolicy", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Environment", "Status", "AllApproversRequired", "Note", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ApprovalRequest", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "PolicyId", "Environment", "Version", "Attempt", "ReleaseId", "Status", "RequestedByUserId", "RequestedAt", "DecidedAt", "CreatedDate", "LastUpdatedDate"] },
  { schema: "ApprovalStep", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ParentType", "ParentId", "StepKey", "StepType", "Label", "Required", "ApproverUserIds", "Decision", "DecidedByUserId", "DecidedAt", "Comment", "SortOrder", "CreatedDate", "LastUpdatedDate"] },
  { schema: "EngineJob", fields: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId", "InputJson", "OutputRefs", "Progress", "Message", "Attempts", "ClaimedBy", "ClaimedAt", "StartedAt", "FinishedAt", "ErrorCode", "RequestedByUserId", "CreatedDate", "LastUpdatedDate"] },
].map((s) => Object.freeze({ schema: s.schema, fields: Object.freeze(s.fields) })));

/** Schemas that carry WorkspaceId but never leave the server. */
export const EXPORT_EXCLUDED: Readonly<Record<string, string>> = Object.freeze({
  Operation: "the command log, with other callers' results",
  ShareLink: "external link hashes and view counts never leave the server",
  Notification: "other people's inboxes",
  AuditEvent: "the security trail, readable only by the super admin under the policy",
});

export interface ExportFileField {
  readonly idField: string;
  readonly many: boolean;
  readonly nameField?: string;
  readonly mimeField?: string;
  readonly sizeField?: string;
  readonly statusField?: string;
}

/** Schemas whose rows point at stored files: listed in the manifest, never as URLs or bytes. */
export const EXPORT_FILE_FIELDS: Readonly<Record<string, ExportFileField>> = Object.freeze({
  DocFile: { idField: "StorageObjectId", many: false, nameField: "Name", mimeField: "Mime", sizeField: "SizeBytes", statusField: "Status" },
  Attachment: { idField: "FileId", many: false, nameField: "FileName", mimeField: "Mime", sizeField: "SizeBytes", statusField: "Status" },
  DesignScreen: { idField: "ImageFileId", many: false, nameField: "Name", statusField: "Status" },
  DesignBrief: { idField: "SampleFileIds", many: true, statusField: "Status" },
});

export interface ExportCursor {
  schemaIndex: number;
  gatewayPage: number;
  offset: number;
}
export interface ExportChunk {
  schema: string;
  rows: Record<string, unknown>[];
}
export interface ExportFileEntry {
  schema: string;
  itemId: string;
  projectId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  status: string;
}
export interface ExportPage {
  format: string;
  version: number;
  chunks: ExportChunk[];
  files: ExportFileEntry[];
  cursor: string | null;
  workspace?: { id: string; name: string };
  schemas?: string[];
  exportedAt?: string;
}
export interface ExportFile {
  format: string;
  version: number;
  exportedAt: string;
  workspace: { id: string; name: string };
  records: Record<string, Record<string, unknown>[]>;
  files: ExportFileEntry[];
}

export const EXPORT_START: ExportCursor = Object.freeze({ schemaIndex: 0, gatewayPage: 1, offset: 0 });

const MAX_GATEWAY_PAGE = 1_000_000;
const CANONICAL_INT = /^(?:0|[1-9][0-9]*)$/;
const SCHEMA_NAMES: ReadonlySet<string> = new Set(EXPORT_SCHEMAS.map((s) => s.schema));

export function encodeCursor(c: ExportCursor): string {
  return `v1.${c.schemaIndex}.${c.gatewayPage}.${c.offset}`;
}

/** Strict: anything that is not exactly what encodeCursor writes (and in range) is null. The cursor carries no ids. */
export function decodeCursor(s: unknown): ExportCursor | null {
  if (typeof s !== "string" || s.length === 0 || s.length > EXPORT_CURSOR_MAX_LENGTH) return null;
  const parts = s.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const nums: number[] = [];
  for (const p of parts.slice(1)) {
    if (!CANONICAL_INT.test(p) || p.length > 9) return null;
    nums.push(Number(p));
  }
  const [schemaIndex, gatewayPage, offset] = nums;
  if (schemaIndex >= EXPORT_SCHEMAS.length) return null;
  if (gatewayPage < 1 || gatewayPage > MAX_GATEWAY_PAGE) return null;
  if (offset >= EXPORT_GATEWAY_PAGE_SIZE) return null;
  return { schemaIndex, gatewayPage, offset };
}

/** UTF-8 byte length of JSON.stringify(v), counted per code point. */
export function jsonBytes(v: unknown): number {
  const text = JSON.stringify(v);
  if (typeof text !== "string") return 0;
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

const catalogueFields = (schema: string): readonly string[] | undefined =>
  EXPORT_SCHEMAS.find((s) => s.schema === schema)?.fields;

const isPlain = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** A new object with only the catalogue fields of the schema, in catalogue order. */
export function exportRow(schema: string, row: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = catalogueFields(schema);
  if (!fields || !isPlain(row)) return out;
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(row, f) && row[f] !== undefined) out[f] = row[f];
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** File manifest entries of one row. Never a URL. */
export function manifestEntries(schema: string, row: unknown): ExportFileEntry[] {
  const spec = Object.prototype.hasOwnProperty.call(EXPORT_FILE_FIELDS, schema) ? EXPORT_FILE_FIELDS[schema] : undefined;
  if (!spec || !isPlain(row)) return [];
  const projectId = str(row.ProjectId);
  const name = spec.nameField ? str(row[spec.nameField]) : "";
  const mime = spec.mimeField ? str(row[spec.mimeField]) : "";
  const size = spec.sizeField ? row[spec.sizeField] : 0;
  const sizeBytes = typeof size === "number" && Number.isFinite(size) ? size : 0;
  const status = spec.statusField ? str(row[spec.statusField]) : "";
  if (spec.many) {
    const ids = row[spec.idField];
    if (!Array.isArray(ids)) return [];
    return ids
      .filter((id): id is string => typeof id === "string")
      .map((itemId) => ({ schema, itemId, projectId, name, mime, sizeBytes, status }));
  }
  return [{ schema, itemId: str(row.ItemId), projectId, name, mime, sizeBytes, status }];
}

/** Takes rows from `start` while the running sum stays within the budget; at least one when mustTakeOne. */
export function fitPage(
  rowBytes: readonly number[],
  start: number,
  budget: number,
  mustTakeOne: boolean,
): { taken: number; bytes: number; next: number } {
  let taken = 0;
  let bytes = 0;
  for (let i = start; i < rowBytes.length; i++) {
    const b = rowBytes[i];
    if (bytes + b > budget && !(mustTakeOne && taken === 0)) break;
    bytes += b;
    taken++;
  }
  return { taken, bytes, next: start + taken };
}

const validEntry = (e: unknown): e is ExportFileEntry =>
  isPlain(e) &&
  typeof e.schema === "string" &&
  typeof e.itemId === "string" &&
  typeof e.projectId === "string" &&
  typeof e.name === "string" &&
  typeof e.mime === "string" &&
  typeof e.sizeBytes === "number" &&
  Number.isFinite(e.sizeBytes) &&
  typeof e.status === "string";

/** Shape check of one answer page in the browser. Null when anything is off. */
export function validateExportPage(x: unknown): ExportPage | null {
  if (!isPlain(x)) return null;
  if (x.format !== EXPORT_FORMAT || x.version !== EXPORT_VERSION) return null;
  if (!Array.isArray(x.chunks) || !Array.isArray(x.files)) return null;
  for (const c of x.chunks) {
    if (!isPlain(c) || typeof c.schema !== "string" || !SCHEMA_NAMES.has(c.schema)) return null;
    if (!Array.isArray(c.rows) || !c.rows.every(isPlain)) return null;
  }
  if (!x.files.every(validEntry)) return null;
  if (x.cursor !== null && decodeCursor(x.cursor) === null) return null;
  if (x.workspace !== undefined) {
    if (!isPlain(x.workspace) || typeof x.workspace.id !== "string" || typeof x.workspace.name !== "string") return null;
  }
  if (x.schemas !== undefined) {
    if (!Array.isArray(x.schemas) || !x.schemas.every((n) => typeof n === "string" && SCHEMA_NAMES.has(n))) return null;
  }
  if (x.exportedAt !== undefined && typeof x.exportedAt !== "string") return null;
  return x as unknown as ExportPage;
}

/** Merges the pages into one file in catalogue order, without duplicate rows or files. */
export function assembleExport(pages: readonly ExportPage[]): ExportFile | null {
  const first = pages[0];
  if (!first || !first.workspace || typeof first.exportedAt !== "string") return null;
  const records: Record<string, Record<string, unknown>[]> = {};
  const seen: Record<string, Set<unknown>> = {};
  for (const s of EXPORT_SCHEMAS) {
    records[s.schema] = [];
    seen[s.schema] = new Set();
  }
  const files: ExportFileEntry[] = [];
  const seenFiles = new Set<string>();
  for (const page of pages) {
    for (const chunk of page.chunks) {
      const bucket = records[chunk.schema];
      if (!bucket) continue;
      for (const row of chunk.rows) {
        const id = row.ItemId;
        if (id !== undefined && seen[chunk.schema].has(id)) continue;
        if (id !== undefined) seen[chunk.schema].add(id);
        bucket.push(row);
      }
    }
    for (const f of page.files) {
      const key = `${f.schema}\u0000${f.itemId}`;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      files.push(f);
    }
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: first.exportedAt,
    workspace: { id: first.workspace.id, name: first.workspace.name },
    records,
    files,
  };
}

export function exportProgress(cursor: string | null): { done: number; total: number } {
  const total = EXPORT_SCHEMAS.length;
  if (cursor === null) return { done: total, total };
  return { done: decodeCursor(cursor)?.schemaIndex ?? 0, total };
}
