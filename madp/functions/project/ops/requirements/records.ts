/**
 * The ONE server mapper over S1's field names for the requirements and design
 * areas. S1's names win; a field the brief wants that S1 lacks (Requirement
 * Origin, ItemVersion restore/suggestion provenance, Project
 * RequirementsConfirmedByUserId) is a schema gap, never a JSON blob.
 */
import type { Row } from "./ports";

export const SCHEMA = {
  project: "Project",
  requirement: "Requirement",
  objective: "Objective",
  itemVersion: "ItemVersion",
  suggestion: "Suggestion",
  designBrief: "DesignBrief",
  attachment: "Attachment",
  clarification: "Clarification",
  engineJob: "EngineJob",
} as const;

export type RequirementPriority = "must" | "nice" | "later";
/** S1 Requirement.Status: removed = dropped; every other value counts as active. */
export const REMOVED_STATUS = "dropped";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A copy of the row without ReaderIds (the ACL never leaves the server). */
export function wire(row: Row): Row {
  const { ReaderIds: _readers, ...rest } = row;
  void _readers;
  return rest as Row;
}

/** True when the row was written by the engine: no creator, or an mf-engine identity. */
export function isEngineWritten(row: Row): boolean {
  const c = row.CreatedByUserId;
  return typeof c !== "string" || c === "" || c.startsWith("mf-engine");
}

// ---- Project ----

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string;
  stage: string;
  requirementsConfirmedAt: string | null;
  /** The Landing page add-on and its section, as stored (JSON strings; src/domain/landingPage.ts). */
  landingPageAddOn: string;
  landingPageSection: string;
}

export function toProject(row: Row): ProjectRecord {
  return {
    id: row.ItemId,
    workspaceId: str(row.WorkspaceId),
    name: str(row.Name),
    clientName: str(row.ClientName),
    stage: str(row.Stage),
    requirementsConfirmedAt: strOrNull(row.RequirementsConfirmedAt),
    landingPageAddOn: str(row.LandingPageAddOn),
    landingPageSection: str(row.LandingPageSection),
  };
}

// ---- Requirement ----

export interface RequirementRecord {
  id: string;
  key: string;
  number: number | null;
  title: string;
  detail: string;
  priority: string;
  criteria: string[];
  sourceRefs: string[];
  sortOrder: number;
  status: string;
  active: boolean;
  createdByUserId: string | null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const m = /^(?:R-)?(\d+)$/.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

export function toRequirement(row: Row): RequirementRecord {
  const status = str(row.Status);
  return {
    id: row.ItemId,
    key: str(row.Key),
    number: numberOf(row.Number),
    title: str(row.Title),
    detail: str(row.Text),
    priority: str(row.Priority),
    criteria: strList(row.AcceptanceCriteria),
    sourceRefs: strList(row.SourceRefs),
    sortOrder: int(row.SortOrder),
    status,
    active: status !== REMOVED_STATUS,
    createdByUserId: strOrNull(row.CreatedByUserId),
  };
}

/** Builds the stored columns from record-style fields; only defined keys (S1 names). */
export function requirementRow(f: {
  projectId?: string;
  number?: number;
  key?: string;
  title?: string;
  detail?: string;
  priority?: string;
  criteria?: string[];
  sourceRefs?: string[];
  sortOrder?: number;
  status?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.projectId !== undefined) out.ProjectId = f.projectId;
  if (f.number !== undefined) out.Number = f.number;
  if (f.key !== undefined) out.Key = f.key;
  if (f.title !== undefined) out.Title = f.title;
  if (f.detail !== undefined) out.Text = f.detail;
  if (f.priority !== undefined) out.Priority = f.priority;
  if (f.criteria !== undefined) out.AcceptanceCriteria = f.criteria;
  if (f.sourceRefs !== undefined) out.SourceRefs = f.sourceRefs;
  if (f.sortOrder !== undefined) out.SortOrder = f.sortOrder;
  if (f.status !== undefined) out.Status = f.status;
  return out;
}

// ---- Objective ----

export interface ObjectiveRecord {
  id: string;
  statement: string;
  criteria: string[];
  highLevelMd: string;
  architectureMd: string;
}

export function toObjective(row: Row): ObjectiveRecord {
  return {
    id: row.ItemId,
    statement: str(row.Statement),
    criteria: strList(row.AcceptanceCriteria),
    highLevelMd: str(row.HighLevelMd),
    architectureMd: str(row.ArchitectureMd),
  };
}

// ---- ItemVersion ----

export interface VersionRecord {
  id: string;
  itemKey: string;
  n: number;
  text: string;
  origin: string;
  createdByUserId: string | null;
  createdAt: string | null;
}

export function toVersion(row: Row): VersionRecord {
  return {
    id: row.ItemId,
    itemKey: str(row.ItemKey),
    n: int(row.N),
    text: str(row.Text),
    origin: str(row.Origin),
    createdByUserId: strOrNull(row.CreatedByUserId),
    createdAt: strOrNull(row.CreatedDate),
  };
}

// ---- Suggestion ----

export interface SuggestionRecord {
  id: string;
  source: string;
  key: string;
  title: string;
  text: string;
  status: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
}

export function toSuggestion(row: Row): SuggestionRecord {
  return {
    id: row.ItemId,
    source: str(row.Source),
    key: str(row.Key),
    title: str(row.Title),
    text: str(row.Text),
    status: str(row.Status),
    decidedByUserId: strOrNull(row.DecidedByUserId),
    decidedAt: strOrNull(row.DecidedAt),
  };
}

// ---- DesignBrief ----

export interface DesignBriefRecord {
  id: string;
  mode: string;
  instructions: string;
  sampleIds: string[];
  status: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
}

export function toDesignBrief(row: Row): DesignBriefRecord {
  return {
    id: row.ItemId,
    mode: str(row.Mode),
    instructions: str(row.Instructions),
    sampleIds: strList(row.SampleFileIds),
    status: str(row.Status),
    confirmedByUserId: strOrNull(row.ConfirmedByUserId),
    confirmedAt: strOrNull(row.ConfirmedAt),
  };
}

// ---- Attachment (OwnerType 'design-brief', OwnerId = the DesignBrief id) ----

export interface AttachmentRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  fileId: string;
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
  status: string;
  createdAt: string | null;
}

export function toAttachment(row: Row): AttachmentRecord {
  return {
    id: row.ItemId,
    ownerType: str(row.OwnerType),
    ownerId: str(row.OwnerId),
    fileId: str(row.FileId),
    fileName: str(row.FileName),
    storedName: str(row.StoredName),
    mime: str(row.Mime),
    sizeBytes: int(row.SizeBytes),
    status: str(row.Status),
    createdAt: strOrNull(row.CreatedDate),
  };
}

// ---- field rules (the lane's expectations; blocks/data/validations.json wins when present) ----

export type ValidationRule = { schema: string; field: string; kind: "regex" | "maxLength" | "required"; value?: string | number };

const rx = (schema: string, field: string, value: string): ValidationRule => ({ schema, field, kind: "regex", value });
const max = (schema: string, field: string, value: number): ValidationRule => ({ schema, field, kind: "maxLength", value });
const req = (schema: string, field: string): ValidationRule => ({ schema, field, kind: "required" });

/**
 * ItemVersion.N has no upper bound here although S1 currently caps it at 20:
 * pruning keeps 20 rows but N keeps growing (schema gap, see the lane report).
 */
export const FIELD_RULES: ValidationRule[] = [
  req("Requirement", "WorkspaceId"),
  req("Requirement", "ProjectId"),
  req("Requirement", "Key"),
  req("Requirement", "Number"),
  req("Requirement", "Title"),
  rx("Requirement", "Key", "^[a-z0-9][a-z0-9-]{0,62}$"),
  rx("Requirement", "Priority", "^(must|nice|later)$"),
  rx("Requirement", "Status", "^(draft|confirmed|assumed|dropped)$"),
  max("Requirement", "Title", 200),
  max("Requirement", "Text", 5000),
  req("Objective", "ProjectId"),
  rx("Objective", "Status", "^(draft|confirmed)$"),
  max("Objective", "Statement", 2000),
  req("ItemVersion", "ProjectId"),
  req("ItemVersion", "ItemKey"),
  req("ItemVersion", "N"),
  rx("ItemVersion", "Origin", "^(feedback|second-opinion|person|engine)$"),
  rx("ItemVersion", "ItemKey", "^((requirement|feature|story|screen|acceptance|milestone|clarification|decision|tech-decision):[a-z0-9][a-z0-9-]{0,62}|objective:main)$"),
  max("ItemVersion", "Text", 20000),
  req("Suggestion", "Key"),
  rx("Suggestion", "Status", "^(open|accepted|dismissed)$"),
  req("DesignBrief", "ProjectId"),
  rx("DesignBrief", "Mode", "^(figma|sample|describe)$"),
  rx("DesignBrief", "Status", "^(draft|confirmed)$"),
  max("DesignBrief", "Instructions", 10000),
  req("Attachment", "OwnerId"),
  rx("Attachment", "OwnerType", "^(design-brief|feedback-comment|change-request|clarification|assistant-message|agent-chat|ticket)$"),
  rx("Attachment", "Status", "^(pending|ready|rejected|deleted)$"),
  rx("Project", "Stage", "^(business|sanitization|requirements|scope|board|build|release|paused|abandoned)$"),
];
