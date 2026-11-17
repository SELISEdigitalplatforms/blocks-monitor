// Typed Blocks rows (S1 PascalCase names) and the camelCase records the requirements step works with, behind ONE mapper
// per record. Field names come from blocks/data/schemas/*.json; where the design brief names a field differently, S1 wins.
// Schema gaps: Suggestion has no Kind (kind is always null); Requirement has no Origin (derived from SourceRefs);
// ItemVersion.Origin allows only feedback|second-opinion|person|engine.
import { projectTypeOf, type ChoosableType } from "../../domain/projectType";
import { formatNumber } from "../../domain/numbering";
import {
  isActiveRequirementStatus,
  manualAuthorOf,
  originFromSourceRefs,
  type RequirementOrigin,
  type RequirementPriority,
  type SuggestionStatus,
} from "../../domain/requirements";
import type { DesignBriefStatus, DesignMode } from "../../domain/designBrief";
import { detailsFromRow, type SetupDetails } from "../../domain/setupDetails";

export const SCHEMA = {
  project: "Project",
  requirement: "Requirement",
  objective: "Objective",
  itemVersion: "ItemVersion",
  suggestion: "Suggestion",
  clarification: "Clarification",
  techDecision: "TechDecision",
  designBrief: "DesignBrief",
  attachment: "Attachment",
} as const;

export type AnyRow = { ItemId: string } & Record<string, unknown>;
export type ChangedKey = "Requirement" | "Objective" | "ItemVersion" | "Suggestion" | "DesignBrief" | "Attachment" | "Project" | "EngineJob";
export type ChangedRows = Partial<Record<ChangedKey, AnyRow[]>>;
export type RemovedIds = Partial<Record<ChangedKey, string[]>>;

// Field lists, always with ItemId.
// The Project item key is shared by the projects, sanitization and requirements readers, so the three lists must stay identical (test/blocks-project-item-fields.test.ts).
export const PROJECT_FIELDS = [
  "ItemId", "WorkspaceId", "Name", "ClientName", "ClientContact", "ClientIndustry", "ClientRegion",
  "Stage", "ResumeTo", "Status", "AssigneeUserId", "BusinessHandedOverAt", "BusinessHandedOverByUserId", "CreatedByUserId", "CreatedDate", "LastUpdatedDate", "RequirementsConfirmedAt", "RequirementsConfirmedByUserId",
  "RepoMode", "RepoOwner", "RepoName", "RepoBranch", "RepoVisibility",
  "Goal", "TargetUsers", "AppUrl", "WebsiteUrl", "LandingPageAddOn", "LandingPageSection", "TestEnv", "RunInstructions", "BlocksProjectRef", "SetupStatus", "SetupAnswers", "RepoExisting",
] as const;
export const REQUIREMENT_FIELDS = [
  "ItemId", "ProjectId", "Number", "Key", "Title", "Text", "Priority", "AcceptanceCriteria", "SourceRefs", "SortOrder", "Status", "CreatedByUserId",
] as const;
export const OBJECTIVE_FIELDS = ["ItemId", "ProjectId", "Statement", "AcceptanceCriteria", "HighLevelMd", "ArchitectureMd"] as const;
export const VERSION_META_FIELDS = ["ItemId", "ProjectId", "ItemKey", "N", "Origin", "CreatedByUserId", "CreatedDate"] as const;
export const VERSION_TEXT_FIELDS = [...VERSION_META_FIELDS, "Text"] as const;
export const SUGGESTION_FIELDS = ["ItemId", "ProjectId", "Source", "Key", "Title", "Text", "Status", "DecidedByUserId", "DecidedAt", "CreatedDate"] as const;
export const CLARIFICATION_FIELDS = ["ItemId", "ProjectId", "Question", "Answer", "Status", "OwnerUserId"] as const;
export const TECH_DECISION_FIELDS = ["ItemId", "ProjectId", "Area", "Title", "Choice", "Rationale", "Status"] as const;
export const DESIGN_BRIEF_FIELDS = [
  "ItemId", "ProjectId", "Mode", "Instructions", "SampleFileIds", "Status", "ConfirmedByUserId", "ConfirmedAt", "PrototypeJson",
] as const;
export const ATTACHMENT_FIELDS = [
  "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileName", "StoredName", "Mime", "SizeBytes", "Status", "CreatedDate",
] as const;

// Rows as the Data Gateway returns them (every field but ItemId may be missing).
export interface ProjectRow { ItemId: string; WorkspaceId?: string | null; Name?: string | null; ClientName?: string | null; Stage?: string | null; RequirementsConfirmedAt?: string | null; RequirementsConfirmedByUserId?: string | null; RepoMode?: string | null; RepoOwner?: string | null; RepoName?: string | null; RepoBranch?: string | null; RepoVisibility?: string | null;
  ClientContact?: string | null; ClientIndustry?: string | null; ClientRegion?: string | null; ResumeTo?: string | null; BusinessHandedOverAt?: string | null;
  Status?: string | null; BusinessHandedOverByUserId?: string | null;
  AssigneeUserId?: string | null; CreatedByUserId?: string | null; CreatedDate?: string | null; LastUpdatedDate?: string | null;
  /* the guided project start's answers (read so the shared Project cache row keeps them) */
  Goal?: string | null; TargetUsers?: string | null; AppUrl?: string | null; WebsiteUrl?: string | null; LandingPageAddOn?: string | null; LandingPageSection?: string | null; TestEnv?: string | null; RunInstructions?: string | null;
  BlocksProjectRef?: string | null; SetupStatus?: string | null; SetupAnswers?: string | null; RepoExisting?: string | boolean | null }
export interface RequirementRow {
  ItemId: string; ProjectId?: string | null; Number?: number | string | null; Key?: string | null; Title?: string | null; Text?: string | null;
  Priority?: string | null; AcceptanceCriteria?: string[] | null; SourceRefs?: string[] | null; SortOrder?: number | null;
  Status?: string | null; CreatedByUserId?: string | null;
}
export interface ObjectiveRow { ItemId: string; ProjectId?: string | null; Statement?: string | null; AcceptanceCriteria?: string[] | null; HighLevelMd?: string | null; ArchitectureMd?: string | null }
export interface ItemVersionRow {
  ItemId: string; ProjectId?: string | null; ItemKey?: string | null; N?: number | null; Origin?: string | null;
  CreatedByUserId?: string | null; CreatedDate?: string | null; Text?: string | null;
}
export interface SuggestionRow {
  ItemId: string; ProjectId?: string | null; Source?: string | null; Key?: string | null; Title?: string | null; Text?: string | null;
  Status?: string | null; DecidedByUserId?: string | null; DecidedAt?: string | null; CreatedDate?: string | null;
}
export interface ClarificationRow { ItemId: string; ProjectId?: string | null; Question?: string | null; Answer?: string | null; Status?: string | null; OwnerUserId?: string | null }
export interface TechDecisionRow { ItemId: string; ProjectId?: string | null; Area?: string | null; Title?: string | null; Choice?: string | null; Rationale?: string | null; Status?: string | null }
export interface DesignBriefRow {
  PrototypeJson?: string | null;
  ItemId: string; ProjectId?: string | null; Mode?: string | null; Instructions?: string | null; SampleFileIds?: string[] | null;
  Status?: string | null; ConfirmedByUserId?: string | null; ConfirmedAt?: string | null;
}
export interface AttachmentRow {
  ItemId: string; ProjectId?: string | null; OwnerType?: string | null; OwnerId?: string | null; FileName?: string | null; StoredName?: string | null;
  Mime?: string | null; SizeBytes?: number | null; Status?: string | null; CreatedDate?: string | null;
}

// Records
export interface ProjectRecord {
  id: string; name: string; clientName: string; stage: string | null; requirementsConfirmedAt: string | null; type: ChoosableType;
  /** Who approved the requirements (null for an approval stored before this field existed). */
  requirementsConfirmedBy: string | null;
  /** The setup answers (what it must do, workflows, exclusions, constraints, intended changes); empty when not given. */
  setup: SetupDetails;
  goal: string; targetUsers: string;
}
export interface RequirementRecord {
  id: string; number: number | null; label: string; key: string; title: string; detail: string; priority: RequirementPriority;
  criteria: string[]; origin: RequirementOrigin; authorUserId: string | null; sortOrder: number; status: string; active: boolean;
}
export interface ObjectiveRecord { id: string; text: string; criteria: string[]; highLevelMd: string; architectureMd: string }
export interface ItemVersionMeta { id: string; itemKey: string; n: number; origin: string; createdByUserId: string | null; createdAt: string | null }
export type ItemVersionRecord = ItemVersionMeta & { text: string };
export interface SuggestionRecord {
  id: string; source: string; key: string; title: string; text: string; kind: string | null; status: SuggestionStatus;
  decidedByUserId: string | null; decidedAt: string | null;
  /** When the suggestion was made (the list shows the newest first); absent on a record not read from the gateway. */
  createdAt?: string | null;
}
export interface ClarificationRecord { id: string; question: string; answer: string; status: string; owner: string }
export interface TechDecisionRecord { id: string; title: string; decision: string; rationale: string; status: string }
export interface DesignBriefRecord {
  prototypeJson?: string | null;
  id: string; mode: DesignMode; instructions: string; sampleIds: string[]; status: DesignBriefStatus;
  confirmedByUserId: string | null; confirmedAt: string | null;
}
export interface SampleRecord {
  id: string; fileName: string; storedName: string; mime: string; sizeBytes: number;
  status: "pending" | "ready" | "rejected" | "deleted"; createdAt: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Number may be an Int or an "R-n" string. */
function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const m = /^(?:[A-Z]{1,4}-)?(\d+)$/.exec(v.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > 0) return n;
    }
  }
  return null;
}

export function toProjectRecord(r: ProjectRow): ProjectRecord {
  return {
    id: r.ItemId, name: str(r.Name), clientName: str(r.ClientName), stage: strOrNull(r.Stage), requirementsConfirmedAt: strOrNull(r.RequirementsConfirmedAt), type: projectTypeOf(str(r.RepoMode)),
    requirementsConfirmedBy: strOrNull(r.RequirementsConfirmedByUserId),
    setup: detailsFromRow(r as unknown as Record<string, unknown>), goal: str(r.Goal), targetUsers: str(r.TargetUsers),
  };
}

const PRIORITIES: readonly string[] = ["must", "nice", "later"];

export function toRequirementRecord(r: RequirementRow): RequirementRecord {
  const number = numberOf(r.Number);
  const refs = strList(r.SourceRefs);
  const status = str(r.Status);
  const priority = (PRIORITIES.includes(str(r.Priority)) ? r.Priority : "must") as RequirementPriority;
  return {
    id: r.ItemId,
    number,
    label: number ? formatNumber("R", number) : "",
    key: str(r.Key) || r.ItemId,
    title: str(r.Title),
    detail: str(r.Text),
    priority,
    criteria: strList(r.AcceptanceCriteria),
    origin: originFromSourceRefs(refs),
    authorUserId: manualAuthorOf(refs) ?? strOrNull(r.CreatedByUserId),
    sortOrder: typeof r.SortOrder === "number" ? r.SortOrder : 0,
    status,
    active: isActiveRequirementStatus(status),
  };
}

export function toObjectiveRecord(r: ObjectiveRow): ObjectiveRecord {
  return { id: r.ItemId, text: str(r.Statement), criteria: strList(r.AcceptanceCriteria), highLevelMd: str(r.HighLevelMd), architectureMd: str(r.ArchitectureMd) };
}

export function toVersionMeta(r: ItemVersionRow): ItemVersionMeta {
  return {
    id: r.ItemId, itemKey: str(r.ItemKey), n: typeof r.N === "number" ? r.N : 0, origin: str(r.Origin),
    createdByUserId: strOrNull(r.CreatedByUserId), createdAt: strOrNull(r.CreatedDate),
  };
}

export function toVersionRecord(r: ItemVersionRow): ItemVersionRecord {
  return { ...toVersionMeta(r), text: str(r.Text) };
}

const SUGGESTION_STATUSES: readonly string[] = ["open", "accepted", "dismissed"];

export function toSuggestionRecord(r: SuggestionRow): SuggestionRecord {
  return {
    id: r.ItemId, source: str(r.Source), key: str(r.Key), title: str(r.Title), text: str(r.Text),
    kind: null, // Schema gap: S1's Suggestion has no Kind.
    status: (SUGGESTION_STATUSES.includes(str(r.Status)) ? r.Status : "open") as SuggestionStatus,
    decidedByUserId: strOrNull(r.DecidedByUserId), decidedAt: strOrNull(r.DecidedAt), createdAt: strOrNull(r.CreatedDate),
  };
}

export function toClarificationRecord(r: ClarificationRow): ClarificationRecord {
  return { id: r.ItemId, question: str(r.Question), answer: str(r.Answer), status: str(r.Status), owner: str(r.OwnerUserId) };
}

export function toTechDecisionRecord(r: TechDecisionRow): TechDecisionRecord {
  return { id: r.ItemId, title: str(r.Title), decision: str(r.Choice), rationale: str(r.Rationale), status: str(r.Status) || "proposed" };
}

export function toDesignBriefRecord(r: DesignBriefRow): DesignBriefRecord {
  return {
    id: r.ItemId,
    mode: (r.Mode === "figma" ? "figma" : r.Mode === "describe" ? "describe" : "sample") as DesignMode,
    prototypeJson: r.PrototypeJson ?? null,
    instructions: str(r.Instructions),
    sampleIds: strList(r.SampleFileIds),
    status: (r.Status === "confirmed" ? "confirmed" : "draft") as DesignBriefStatus,
    confirmedByUserId: strOrNull(r.ConfirmedByUserId),
    confirmedAt: strOrNull(r.ConfirmedAt),
  };
}

const SAMPLE_STATUSES = ["pending", "ready", "rejected", "deleted"] as const;

export function toSampleRecord(r: AttachmentRow): SampleRecord {
  const status = SAMPLE_STATUSES.find((s) => s === r.Status) ?? "pending";
  return {
    id: r.ItemId, fileName: str(r.FileName), storedName: str(r.StoredName), mime: str(r.Mime),
    sizeBytes: typeof r.SizeBytes === "number" ? r.SizeBytes : 0, status, createdAt: strOrNull(r.CreatedDate),
  };
}
