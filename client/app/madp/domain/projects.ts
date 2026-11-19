/**
 * Projects: shared rules for the Project, ProjectAssignment and Share records.
 * Pure (imports only other src/domain files), so the server functions and the web bundle it alike.
 * Time is always passed in by the caller.
 */
import { JOURNEY_STEPS, type JourneyStep } from "./journey";
import { prefixPath } from "../lib/pathPrefix";

export const PROJECT_NAME_MAX = 80;
export const CLIENT_FIELD_MAX = 120;
export const UNTITLED_PROJECT = "Untitled project";

export const PROJECT_STATUSES = ["active", "deleting"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STAGES = [...JOURNEY_STEPS, "paused", "abandoned"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

const isStep = (s: unknown): s is JourneyStep => (JOURNEY_STEPS as readonly string[]).includes(s as string);

/** The journey step a Project.Stage stands for; paused / abandoned projects stand at their resume step. */
export function effectiveStep(stage: string, resumeTo?: string): JourneyStep {
  if (isStep(stage)) return stage;
  if ((stage === "paused" || stage === "abandoned") && isStep(resumeTo)) return resumeTo;
  return "business";
}

export const SHARE_ITEM_TYPES = ["scope", "screens", "screen"] as const;
export type ShareItemType = (typeof SHARE_ITEM_TYPES)[number];
export const SHARE_ITEM_REF_MAX = 128;
export const SHARE_RECIPIENTS_MAX = 50;

export type Check<T> =
  | { ok: true; value: T }
  | { ok: false; messageKey: string; params?: Record<string, unknown> };

// Control characters and bidi overrides are never part of a name.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/;

export function checkProjectName(raw: unknown, opts?: { fallback?: boolean }): Check<string> {
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  const v = raw.trim();
  if (UNSAFE_CHARS.test(v)) return { ok: false, messageKey: "project.nameInvalid" };
  if (!v) {
    return opts?.fallback ? { ok: true, value: UNTITLED_PROJECT } : { ok: false, messageKey: "project.nameRequired" };
  }
  if (v.length > PROJECT_NAME_MAX) return { ok: false, messageKey: "project.nameTooLong", params: { max: PROJECT_NAME_MAX } };
  return { ok: true, value: v };
}

export function checkClientField(raw: unknown, field: string): Check<string> {
  if (raw === undefined) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  const v = raw.trim();
  if (UNSAFE_CHARS.test(v)) return { ok: false, messageKey: "project.nameInvalid" };
  if (v.length > CLIENT_FIELD_MAX) return { ok: false, messageKey: "project.fieldTooLong", params: { field, max: CLIENT_FIELD_MAX } };
  return { ok: true, value: v };
}

/**
 * A Blocks project id is a UUID; local ids look like "p-…".
 * The ONE implementation; src/blocks/{delivery,scope}/projectKind.ts re-export it.
 */
export function isBlocksProjectId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** The page a share opens (the same targets as shareLink in src/state/workspaces.ts). */
export function shareLink(s: { projectId: string; itemType: ShareItemType; itemRef: string }): string {
  const base = prefixPath(`/p/${encodeURIComponent(s.projectId)}`);
  if (s.itemType === "scope") return `${base}/scope`;
  if (s.itemType === "screens") return `${base}/scope#screens`;
  return `${base}/scope?screen=${encodeURIComponent(s.itemRef)}`;
}

export function shareLabel(itemType: ShareItemType, projectName: string): string {
  if (itemType === "scope") return `Scope · ${projectName}`;
  if (itemType === "screens") return `Screen designs · ${projectName}`;
  return `Screen design · ${projectName}`;
}

/** Local guard for notification links; L3's isSafeInternalLink stays authoritative later. */
export function isInternalLink(link: string): boolean {
  if (typeof link !== "string" || !link.startsWith("/")) return false;
  if (link.startsWith("//") || link.startsWith("/\\")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001F\u007F]/.test(link);
}

/** A project row that is being deleted: every reader treats it as gone (the purge removes it and its rows). */
export function isDeletingProject(p: { Status?: unknown; status?: unknown } | null | undefined): boolean {
  return !!p && (p.Status === "deleting" || p.status === "deleting");
}

/**
 * ProjectId values that name no project: host-level work (the engine's daily skills sync is an EngineJob of ProjectId
 * "system") and rows of no project at all. Such rows are never a deleted project's leftovers.
 */
export const NO_PROJECT_IDS: readonly string[] = ["", "system"];

/** True when a row's ProjectId names a project (not empty, not a host-level marker). */
export function namesProject(projectId: unknown): projectId is string {
  return typeof projectId === "string" && !NO_PROJECT_IDS.includes(projectId.trim());
}

/**
 * Every schema whose rows are a project's work or content, children first, Project last: deleting a project removes
 * them all. project.delete walks this list in order; seed.remove and the background purge (functions/_lib/purge.ts)
 * use it too. Every schema here may be removed through the scoped gateway.
 */
export const PROJECT_CASCADE: readonly string[] = [
  "TicketEvent",
  "Ticket",
  "Board",
  "WikiPageHistory",
  "WikiPage",
  "AgentChatMessage",
  "AssistantMessage",
  "FeedbackComment",
  "FeedbackThread",
  "Challenge",
  "SecondOpinion",
  "Release",
  "ChangeRequestAttachment",
  "ChangeRequest",
  "ApprovalStep",
  "ApprovalRequest",
  "ApprovalPolicy",
  "Preview",
  "Milestone",
  "ItemVersion",
  "SetupSuggestion",
  "Suggestion",
  "ProjectAnswer",
  "Story",
  "Feature",
  "Requirement",
  "RequirementExtra",
  "Objective",
  "Decision",
  "TechDecision",
  "Clarification",
  "DesignScreen",
  "DesignBrief",
  "ScopeVersion",
  "ProjectBrief",
  "AttachmentExtraction",
  "Attachment",
  "DocFile",
  "DocNote",
  "DocFolder",
  "ShareLink",
  "Share",
  "ProjectAssignment",
  "EngineJob",
  "Project",
];

/**
 * A project's rows that only the service identity may remove (the scoped gateway refuses the routed schemas): the
 * background purge removes them with the rest, before the Project row. A recipient's notification about a deleted
 * project is no longer something to act on.
 */
export const PROJECT_SERVICE_CASCADE: readonly string[] = ["Notification"];

/** Every child schema the background purge removes for a deleted project (the Project row goes last, on its own). */
export const PROJECT_PURGE_SCHEMAS: readonly string[] = [
  ...PROJECT_CASCADE.filter((s) => s !== "Project"),
  ...PROJECT_SERVICE_CASCADE,
];

/** History that outlives the project: kept on purpose, never shown as live work (readers join on live projects). */
export const PROJECT_CASCADE_KEEP: readonly { schema: string; reason: string }[] = [
  { schema: "Operation", reason: "the command log; the purge keeps its own progress there" },
  { schema: "AuditEvent", reason: "the security trail; the purge writes the project.delete event there" },
  { schema: "CreditEntry", reason: "the usage and credit ledger: what the project's work cost stays billed (shown as a removed project)" },
];

/** Schemas with a ProjectId field that the Data Gateway does not have (no row can exist, nothing writes them). */
export const PROJECT_CASCADE_UNDEPLOYED: readonly { schema: string; reason: string }[] = [
  { schema: "PlanningJob", reason: "not deployed to the Blocks tenant and written by nothing" },
];

/** The Storage-file fields of each schema that has some. Bytes are deleted permanently before the row. */
export const PROJECT_FILE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  DocFile: ["StorageObjectId"],
  Attachment: ["FileId"],
  DesignScreen: ["ImageFileId"],
  AttachmentExtraction: ["ExtractedContentObjectId", "FindingsObjectId"],
  ProjectBrief: ["BriefObjectId"],
};

/** The fields a cascade reads of a schema's rows: ItemId and its Storage-file fields. */
export function cascadeFieldsOf(schema: string): string[] {
  return ["ItemId", ...(PROJECT_FILE_FIELDS[schema] ?? [])];
}

/** The Storage file ids a row of `schema` holds (each is deleted before the row). */
export function fileIdsOf(schema: string, row: Readonly<Record<string, unknown>>): string[] {
  return (PROJECT_FILE_FIELDS[schema] ?? []).map((f) => row[f]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

export interface HandOverCounts {
  notesWithText: number;
  readyFiles: number;
}

/** The business input can be handed over once there is a note with text or a ready file. */
export function canHandOver(c: HandOverCounts): boolean {
  return c.notesWithText >= 1 || c.readyFiles >= 1;
}
