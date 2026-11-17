/**
 * The ONE server-side mapper between this lane's logical records and the S1 schemas (blocks/data/schemas/*.json,
 * validations.json). Readers return null for an unreadable row (never guessed); writers produce S1 field names and
 * drop every stamp key (WorkspaceId, ReaderIds, CreatedByUserId, UpdatedByUserId, RequestKey): the scoped gateway
 * stamps those. No import from functions/_lib.
 */
import { normaliseCriteria, requirementRef, storyTitle } from "../../../../src/domain/scope";

type R = Record<string, unknown>;

export const SCHEMA = {
  project: "Project",
  scopeVersion: "ScopeVersion",
  feature: "Feature",
  story: "Story",
  milestone: "Milestone",
  designBrief: "DesignBrief",
  designScreen: "DesignScreen",
  engineJob: "EngineJob",
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
  secondOpinion: "SecondOpinion",
  challenge: "Challenge",
  requirement: "Requirement",
} as const;

const SYS = ["ItemId", "CreatedDate", "LastUpdatedDate"] as const;
const OWN = ["WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId"] as const;

/** The default read fields per schema (ReaderIds, RequestKey and SeedKey are never read back). */
export const FIELDS: Readonly<Record<(typeof SCHEMA)[keyof typeof SCHEMA], readonly string[]>> = {
  Project: [
    ...SYS, "WorkspaceId", "Name", "ClientName", "Stage", "ResumeTo", "CurrentScopeVersion", "ScopeLockedAt",
    "RequirementsConfirmedAt", "AssigneeUserId", "Rev",
  ],
  ScopeVersion: [
    ...SYS, ...OWN, "Number", "Title", "Summary", "Status", "LockedByUserId", "LockedAt", "UnlockedAt", "EngineJobId",
    "SuccessTargets", "ScreensReviewedAt", "ScreensReviewedBy",
  ],
  Feature: [...SYS, ...OWN, "ScopeVersion", "Key", "Title", "Description", "Priority", "Status", "RequirementRefs", "SortOrder"],
  Story: [
    ...SYS, ...OWN, "ScopeVersion", "FeatureRef", "Key", "Title", "Text", "ActorRole", "AcceptanceCriteria", "Priority", "SortOrder",
  ],
  Milestone: [
    ...SYS, ...OWN, "ScopeVersion", "Number", "Name", "Goal", "FeatureRefs", "SortOrder", "PreviewPoint", "Status", "EngineJobId",
  ],
  DesignBrief: [
    ...SYS, ...OWN, "Mode", "Instructions", "References", "SampleFileIds", "Status", "ConfirmedByUserId", "ConfirmedAt",
  ],
  DesignScreen: [...SYS, ...OWN, "DesignBriefId", "EngineJobId", "Key", "Name", "Version", "SortOrder", "ImageFileId", "Width", "Height", "Status"],
  EngineJob: [
    ...SYS, "WorkspaceId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId", "OutputRefs", "Progress",
    "Message", "Attempts", "FinishedAt", "RequestedByUserId",
  ],
  FeedbackThread: [...SYS, ...OWN, "TargetType", "TargetId", "Status"],
  FeedbackComment: [...SYS, ...OWN, "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At"],
  Attachment: [
    ...SYS, ...OWN, "OwnerType", "OwnerId", "FileId", "FileName", "StoredName", "Kind", "Mime", "SizeBytes", "Origin", "Status",
  ],
  SecondOpinion: [...SYS, ...OWN, "ScopeVersion", "EngineJobId", "Readiness", "OpenHigh", "OpenMedium", "OpenLow"],
  Challenge: [
    ...SYS, ...OWN, "OpinionId", "ChallengeType", "Severity", "Question", "Why", "TargetType", "TargetRef", "FixType", "FixRef",
    "SuggestedFix", "AutofillAnswer", "AnswerText", "DismissReason", "FinalText", "Status", "DecidedByUserId", "DecidedAt",
  ],
  Requirement: [...SYS, ...OWN, "Number", "Key", "Title", "Text", "Category", "Priority", "Status", "SortOrder"],
};

/** S1 has no Feature field for the screen links or the exclusion reason yet (Schema follow-ups); writers skip a null field. */
export const FEATURE_SCREEN_REFS_FIELD: string | null = null;
export const FEATURE_EXCLUDED_REASON_FIELD: string | null = null;

// ---- helpers ---------------------------------------------------------------------------------------------------

const str = (r: R, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
const num = (r: R, k: string): number | null => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
const strs = (r: R, k: string): string[] | null => {
  const v = r[k];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
};
const idOf = (r: R): string | null => (typeof r.ItemId === "string" && r.ItemId !== "" ? r.ItemId : null);
const stamp = (r: R): string => str(r, "LastUpdatedDate");

// ---- readers ---------------------------------------------------------------------------------------------------

export interface VersionRec {
  id: string;
  number: number;
  status: "draft" | "locked";
  lockedAt: string;
  lockedByUserId: string;
  updatedAt: string;
}
export function versionRec(r: R): VersionRec | null {
  const id = idOf(r);
  const number = num(r, "Number");
  const status = str(r, "Status");
  if (!id || number === null || (status !== "draft" && status !== "locked")) return null;
  return { id, number, status, lockedAt: str(r, "LockedAt"), lockedByUserId: str(r, "LockedByUserId"), updatedAt: stamp(r) };
}

export type FeaturePriorityRec = "must" | "nice" | "later" | "excluded";
export interface FeatureRec {
  id: string;
  key: string;
  /** `feature:<Key>`, the normalised ref the milestones and tickets use. */
  ref: string;
  name: string;
  description: string;
  /** Status "dropped" reads as "excluded". */
  priority: FeaturePriorityRec;
  /** The stored S1 Priority (kept while excluded). */
  storedPriority: "must" | "nice" | "later";
  /** `requirement:<Requirement.Key>` as stored. */
  requirementRefs: string[];
  /** Always [] until S1 has a field for the links (FEATURE_SCREEN_REFS_FIELD). */
  screenIds: string[];
  sortOrder: number;
  updatedAt: string;
}
export function featureRec(r: R): FeatureRec | null {
  const id = idOf(r);
  const key = str(r, "Key");
  const priority = str(r, "Priority");
  const status = str(r, "Status");
  const refs = strs(r, "RequirementRefs");
  if (!id || !key || !refs) return null;
  if (priority !== "must" && priority !== "nice" && priority !== "later") return null;
  if (status !== "planned" && status !== "dropped") return null;
  const screenIds = FEATURE_SCREEN_REFS_FIELD ? strs(r, FEATURE_SCREEN_REFS_FIELD) ?? [] : [];
  return {
    id,
    key,
    ref: `feature:${key}`,
    name: str(r, "Title"),
    description: str(r, "Description"),
    priority: status === "dropped" ? "excluded" : priority,
    storedPriority: priority,
    requirementRefs: refs,
    screenIds,
    sortOrder: num(r, "SortOrder") ?? 0,
    updatedAt: stamp(r),
  };
}

export interface StoryRec {
  id: string;
  key: string;
  /** `feature:<Feature.Key>` as stored. */
  featureRef: string;
  /** The stored Feature.Key (the text after `feature:`), the stable id inside refs. */
  featureKey: string;
  /** The feature's ItemId, translated from featureKey through featureIdByKey; the Key itself when the map does not know it. */
  featureId: string;
  actor: string;
  text: string;
  criteria: string[];
  sortOrder: number;
  updatedAt: string;
}
export function storyRec(r: R, featureIdByKey?: ReadonlyMap<string, string>): StoryRec | null {
  const id = idOf(r);
  const key = str(r, "Key");
  const ref = str(r, "FeatureRef");
  const criteria = strs(r, "AcceptanceCriteria");
  if (!id || !key || !ref.startsWith("feature:") || ref.length <= 8 || !criteria) return null;
  const featureKey = ref.slice("feature:".length);
  return {
    id,
    key,
    featureRef: ref,
    featureKey,
    featureId: featureIdByKey?.get(featureKey) ?? featureKey,
    actor: str(r, "ActorRole"),
    text: str(r, "Text"),
    criteria,
    sortOrder: num(r, "SortOrder") ?? 0,
    updatedAt: stamp(r),
  };
}

export interface MilestoneRec {
  id: string;
  number: number;
  name: string;
  goal: string;
  featureRefs: string[];
  sortOrder: number;
  status: string;
  scopeVersion: number;
  updatedAt: string;
}
export function milestoneRec(r: R): MilestoneRec | null {
  const id = idOf(r);
  const number = num(r, "Number");
  const scopeVersion = num(r, "ScopeVersion");
  const refs = strs(r, "FeatureRefs");
  if (!id || number === null || scopeVersion === null || !str(r, "Name") || !refs) return null;
  return {
    id,
    number,
    name: str(r, "Name"),
    goal: str(r, "Goal"),
    featureRefs: refs,
    sortOrder: num(r, "SortOrder") ?? 0,
    status: str(r, "Status"),
    scopeVersion,
    updatedAt: stamp(r),
  };
}

export interface BriefRec {
  id: string;
  status: "draft" | "confirmed";
  confirmedAt: string;
  confirmedByUserId: string;
}
export function briefRec(r: R): BriefRec | null {
  const id = idOf(r);
  const status = str(r, "Status");
  if (!id || (status !== "draft" && status !== "confirmed")) return null;
  return { id, status, confirmedAt: str(r, "ConfirmedAt"), confirmedByUserId: str(r, "ConfirmedByUserId") };
}

export interface ScreenRec {
  id: string;
  /** The Storage file id of the screenshot (DesignScreen.ImageFileId); "" until the engine wrote it. */
  screenshotRef: string;
}
export function screenRec(r: R): ScreenRec | null {
  const id = idOf(r);
  if (!id || !str(r, "Key")) return null;
  return { id, screenshotRef: str(r, "ImageFileId") };
}

export interface ThreadRec {
  id: string;
  targetType: string;
  targetId: string;
  status: "open" | "resolved";
}
export function threadRec(r: R): ThreadRec | null {
  const id = idOf(r);
  const status = str(r, "Status");
  if (!id || !str(r, "TargetType") || !str(r, "TargetId") || (status !== "open" && status !== "resolved")) return null;
  return { id, targetType: str(r, "TargetType"), targetId: str(r, "TargetId"), status };
}

export interface CommentRec {
  id: string;
  threadId: string;
  authorUserId: string;
  attachmentIds: string[];
}
export function commentRec(r: R): CommentRec | null {
  const id = idOf(r);
  const ids = strs(r, "AttachmentIds");
  if (!id || !str(r, "ThreadId") || !str(r, "AuthorUserId") || !ids) return null;
  return { id, threadId: str(r, "ThreadId"), authorUserId: str(r, "AuthorUserId"), attachmentIds: ids };
}

export type AttachmentStatus = "pending" | "ready" | "rejected" | "deleted";
export interface AttachmentRec {
  id: string;
  ownerType: string;
  ownerId: string;
  storageObjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  status: AttachmentStatus;
  createdByUserId: string;
  createdAt: string;
}
export function attachmentRec(r: R): AttachmentRec | null {
  const id = idOf(r);
  const status = str(r, "Status");
  if (!id || !str(r, "OwnerType") || !str(r, "OwnerId")) return null;
  if (status !== "pending" && status !== "ready" && status !== "rejected" && status !== "deleted") return null;
  return {
    id,
    ownerType: str(r, "OwnerType"),
    ownerId: str(r, "OwnerId"),
    storageObjectId: str(r, "FileId"),
    fileName: str(r, "FileName"),
    mime: str(r, "Mime"),
    sizeBytes: num(r, "SizeBytes") ?? 0,
    status,
    createdByUserId: str(r, "CreatedByUserId"),
    createdAt: str(r, "CreatedDate"),
  };
}

export interface ChallengeRec {
  id: string;
  status: "open" | "answered" | "accepted" | "dismissed";
  secondOpinionId: string;
}
export function challengeRec(r: R): ChallengeRec | null {
  const id = idOf(r);
  const status = str(r, "Status");
  if (!id || !str(r, "OpinionId")) return null;
  if (status !== "open" && status !== "answered" && status !== "accepted" && status !== "dismissed") return null;
  return { id, status, secondOpinionId: str(r, "OpinionId") };
}

export interface RequirementRec {
  id: string;
  key: string;
  status: string;
  /** Anything not dropped. */
  active: boolean;
}
export function requirementRec(r: R): RequirementRec | null {
  const id = idOf(r);
  const key = str(r, "Key");
  const status = str(r, "Status");
  if (!id || !key || !["draft", "confirmed", "assumed", "dropped"].includes(status)) return null;
  return { id, key, status, active: status !== "dropped" };
}

export interface JobRec {
  id: string;
  kind: string;
  status: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  requestedByUserId: string;
}
export function jobRec(r: R): JobRec | null {
  const id = idOf(r);
  if (!id || !str(r, "Kind") || !str(r, "Status")) return null;
  return {
    id,
    kind: str(r, "Kind"),
    status: str(r, "Status"),
    targetType: str(r, "TargetType"),
    targetId: str(r, "TargetId"),
    createdAt: str(r, "CreatedDate"),
    requestedByUserId: str(r, "RequestedByUserId"),
  };
}

// ---- writers ---------------------------------------------------------------------------------------------------

export function versionInsert(projectId: string, number: number): R {
  return { ProjectId: projectId, Number: number, Status: "draft" };
}

export interface FeatureDraftIn {
  name: string;
  description: string;
  priority: FeaturePriorityRec;
  excludedReason?: string;
  requirementIds: readonly string[];
  screenIds: readonly string[];
  sortOrder: number;
}

/**
 * Title = name; Key = key; Priority is the draft's, or for an excluded feature the stored one (else "later");
 * Status "dropped" when excluded; RequirementRefs = `requirement:<Requirement.Key>` through requirementKeysById
 * (an id that is not in the map is a programming error: handlers validate the ids first).
 */
export function featureFields(
  draft: FeatureDraftIn,
  o: {
    projectId: string;
    scopeVersion: number;
    key: string;
    requirementKeysById: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
    prev?: { storedPriority: "must" | "nice" | "later" };
  },
): R {
  const keyOf = (id: string): string => {
    const k = o.requirementKeysById instanceof Map ? o.requirementKeysById.get(id) : (o.requirementKeysById as Record<string, string>)[id];
    if (typeof k !== "string" || k === "") throw new TypeError(`Unknown requirement id ${id}`);
    return k;
  };
  const excluded = draft.priority === "excluded";
  const out: R = {
    ProjectId: o.projectId,
    ScopeVersion: o.scopeVersion,
    Key: o.key,
    Title: draft.name,
    Description: draft.description,
    Priority: excluded ? o.prev?.storedPriority ?? "later" : draft.priority,
    Status: excluded ? "dropped" : "planned",
    RequirementRefs: [...new Set(draft.requirementIds)].map((id) => requirementRef(keyOf(id))),
    SortOrder: draft.sortOrder,
  };
  if (FEATURE_SCREEN_REFS_FIELD) out[FEATURE_SCREEN_REFS_FIELD] = [...new Set(draft.screenIds)];
  if (FEATURE_EXCLUDED_REASON_FIELD) out[FEATURE_EXCLUDED_REASON_FIELD] = excluded ? draft.excludedReason ?? "" : "";
  return out;
}

export interface StoryDraftIn {
  actor: string;
  text: string;
  acceptanceCriteria: readonly string[];
  sortOrder: number;
}

/** FeatureRef = `feature:<featureKey>`; Title = storyTitle(actor, text); criteria are normalised. */
export function storyFields(
  draft: StoryDraftIn,
  o: { projectId: string; scopeVersion: number; key: string; featureKey: string },
): R {
  return {
    ProjectId: o.projectId,
    ScopeVersion: o.scopeVersion,
    FeatureRef: `feature:${o.featureKey}`,
    Key: o.key,
    Title: storyTitle(draft.actor, draft.text),
    Text: draft.text,
    ActorRole: draft.actor,
    AcceptanceCriteria: normaliseCriteria(draft.acceptanceCriteria),
    SortOrder: draft.sortOrder,
  };
}

/** Status "planned" is added on insert only (`insert: true`); an update keeps whatever the row has. */
export function milestoneFields(
  m: { number?: number; name: string; goal: string; featureRefs: readonly string[] },
  o: { projectId: string; scopeVersion: number; sortOrder: number; number?: number; insert?: boolean },
): R {
  const number = m.number ?? o.number;
  if (typeof number !== "number") throw new TypeError("A milestone needs a number.");
  const out: R = {
    ProjectId: o.projectId,
    ScopeVersion: o.scopeVersion,
    Number: number,
    Name: m.name,
    Goal: m.goal,
    FeatureRefs: [...m.featureRefs],
    SortOrder: o.sortOrder,
  };
  if (o.insert !== false) out.Status = "planned";
  return out;
}

export function threadFields(projectId: string, targetType: string, targetId: string): R {
  return { ProjectId: projectId, TargetType: targetType, TargetId: targetId, Status: "open" };
}

export function commentFields(c: { projectId: string; threadId: string; authorUserId: string; text: string; attachmentIds: readonly string[]; at: string }): R {
  return {
    ProjectId: c.projectId,
    ThreadId: c.threadId,
    AuthorUserId: c.authorUserId,
    Kind: "comment",
    Text: c.text,
    AttachmentIds: [...c.attachmentIds],
    At: c.at,
  };
}

export function attachmentFields(a: {
  projectId: string;
  ownerId: string;
  fileId: string;
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
}): R {
  return {
    ProjectId: a.projectId,
    OwnerType: "feedback-comment",
    OwnerId: a.ownerId,
    FileId: a.fileId,
    FileName: a.fileName,
    StoredName: a.storedName,
    Kind: a.mime === "application/pdf" ? "pdf" : "image",
    Mime: a.mime,
    SizeBytes: a.sizeBytes,
    Origin: "upload",
    Status: "pending",
  };
}

const bump = (prevRev?: number): R => (typeof prevRev === "number" ? { Rev: prevRev + 1 } : {});

/** The Project patch of scope.lock: journey step board, the locked scope version number and the time. */
export function projectLockPatch(number: number, lockedAt: string, prevRev?: number): R {
  return { Stage: "board", CurrentScopeVersion: number, ScopeLockedAt: lockedAt, ...bump(prevRev) };
}

/** Back to the scope step. ScopeLockedAt cannot be cleared on a DateTime field (MF-B14), so it stays as history. */
export function projectUnlockPatch(prevRev?: number): R {
  return { Stage: "scope", ...bump(prevRev) };
}

export type ChallengeDecision = "accepted" | "answered" | "dismissed";

/** FinalText / AnswerText / DismissReason by decision (the other two are cleared), plus who and when. */
export function challengeDecisionPatch(decision: ChallengeDecision, text: string | undefined, userId: string, at: string): R {
  const t = text ?? "";
  return {
    Status: decision,
    FinalText: decision === "accepted" ? t : "",
    AnswerText: decision === "answered" ? t : "",
    DismissReason: decision === "dismissed" ? t : "",
    DecidedByUserId: userId,
    DecidedAt: at,
  };
}

/** Reopens the point. DecidedAt cannot be cleared (MF-B14); Status open marks it as undecided. */
export function challengeUndoPatch(): R {
  return { Status: "open", FinalText: "", AnswerText: "", DismissReason: "", DecidedByUserId: "" };
}
