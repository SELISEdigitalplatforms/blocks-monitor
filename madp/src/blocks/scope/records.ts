// The ONE web-side mapper from S1 rows to this page's typed records. A malformed row maps to null and is counted as
// unreadable by `mapRows`; nothing is guessed. Field names are S1's (blocks/data/schemas/*.json).
import type { JourneyStep } from "../../domain/journey";
import { effectiveStep } from "../../domain/projects";
import { parseSuccessTargets, type SuccessTargets } from "../../domain/successTargets";
import { THREAD_STATUSES, type ThreadStatus } from "../../domain/feedback";

export type RawRow = Record<string, unknown>;

export const SCHEMA = {
  project: "Project",
  scopeVersion: "ScopeVersion",
  feature: "Feature",
  story: "Story",
  milestone: "Milestone",
  designBrief: "DesignBrief",
  designScreen: "DesignScreen",
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
  secondOpinion: "SecondOpinion",
  challenge: "Challenge",
  approvalPolicy: "ApprovalPolicy",
  approvalStep: "ApprovalStep",
  requirement: "Requirement",
  objective: "Objective",
  membership: "Membership",
  workspaceRole: "WorkspaceRole",
} as const;

/** S1 has no fields yet for these; UI steps hide the controls while false (Schema follow-ups). */
export const FEATURE_FIELD_SUPPORT = { screenLinks: false, excludedReason: false };

/** Feedback targets of this page (the thread schema allows more; the other lanes own those). */
export const SCOPE_FEEDBACK_TARGETS = ["feature", "story", "screen", "milestone", "success"] as const;
export type ScopeFeedbackTarget = (typeof SCOPE_FEEDBACK_TARGETS)[number];

export const PROJECT_FIELDS = [
  "ItemId", "WorkspaceId", "Name", "ClientName", "Stage", "ResumeTo", "CurrentScopeVersion", "ScopeLockedAt",
] as const;
export const SCOPE_VERSION_FIELDS = [
  "ItemId", "ProjectId", "Number", "Status", "LockedAt", "LockedByUserId", "LastUpdatedDate", "SuccessTargets", "ScreensReviewedAt", "ScreensReviewedBy",
] as const;
export const FEATURE_FIELDS = [
  "ItemId", "ProjectId", "ScopeVersion", "Key", "Title", "Description", "Priority", "Status", "RequirementRefs", "SortOrder", "LastUpdatedDate",
] as const;
export const STORY_FIELDS = [
  "ItemId", "ProjectId", "ScopeVersion", "FeatureRef", "Key", "Title", "Text", "ActorRole", "AcceptanceCriteria", "SortOrder", "LastUpdatedDate",
] as const;
export const MILESTONE_FIELDS = [
  "ItemId", "ProjectId", "ScopeVersion", "Number", "Name", "Goal", "FeatureRefs", "SortOrder", "Status", "LastUpdatedDate",
] as const;
export const DESIGN_BRIEF_FIELDS = [
  "ItemId", "ProjectId", "Mode", "Status", "ConfirmedByUserId", "ConfirmedAt", "PrototypeJson",
] as const;
export const DESIGN_SCREEN_FIELDS = [
  "ItemId", "ProjectId", "DesignBriefId", "Key", "Name", "Version", "SortOrder", "ImageFileId", "Width", "Height", "Status", "CreatedDate",
] as const;
export const THREAD_FIELDS = ["ItemId", "ProjectId", "TargetType", "TargetId", "Status"] as const;
export const COMMENT_FIELDS = ["ItemId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At"] as const;
export const ATTACHMENT_FIELDS = [
  "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileName", "Mime", "SizeBytes", "Status", "CreatedByUserId", "CreatedDate",
] as const;
export const SECOND_OPINION_FIELDS = ["ItemId", "ProjectId", "ScopeVersion", "CreatedDate"] as const;
export const CHALLENGE_FIELDS = [
  "ItemId", "ProjectId", "OpinionId", "Severity", "Question", "Why", "SuggestedFix", "TargetType", "TargetRef", "Status",
  "FinalText", "AnswerText", "DismissReason", "DecidedByUserId", "DecidedAt",
] as const;
export const APPROVAL_POLICY_FIELDS = ["ItemId", "ProjectId", "Environment", "Status"] as const;
export const APPROVAL_STEP_FIELDS = [
  "ItemId", "ProjectId", "ParentType", "ParentId", "StepKey", "StepType", "Required", "ApproverUserIds", "SortOrder",
] as const;
export const REQUIREMENT_FIELDS = ["ItemId", "ProjectId", "Number", "Key", "Title", "Status", "SortOrder"] as const;
export const OBJECTIVE_FIELDS = ["ItemId", "ProjectId", "Statement"] as const;
export const MEMBERSHIP_FIELDS = ["ItemId", "UserId", "DisplayName", "Email", "RoleKey", "Status"] as const;
export const WORKSPACE_ROLE_FIELDS = ["ItemId", "Key", "Name", "Permissions"] as const;

const isRecord = (v: unknown): v is RawRow => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const timeOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T | null => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : null);
const updatedAt = (r: RawRow): string => str(r.LastUpdatedDate);

export interface Mapped<T> {
  items: T[];
  unreadable: number;
}

/** Map rows, counting the ones that cannot be read. */
export function mapRows<T>(rows: readonly RawRow[], fn: (r: RawRow) => T | null): Mapped<T> {
  const items: T[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const v = isRecord(r) ? fn(r) : null;
    if (v === null) unreadable++;
    else items.push(v);
  }
  return { items, unreadable };
}

const bySort = <T extends { sortOrder: number }>(a: T, b: T): number => a.sortOrder - b.sortOrder;
export function sortedMapped<T extends { sortOrder: number }>(m: Mapped<T>): Mapped<T> {
  return { items: [...m.items].sort(bySort), unreadable: m.unreadable };
}

const prefixed = (ref: string, prefix: string): string | null =>
  ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : null;

// ── Project ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string;
  stage: JourneyStep;
  currentScopeVersion: number | null;
  scopeLockedAt: string | null;
}

export function projectFromRow(r: RawRow): ProjectRecord | null {
  const id = nonEmpty(r.ItemId);
  const workspaceId = nonEmpty(r.WorkspaceId);
  if (!id || !workspaceId) return null;
  const v = r.CurrentScopeVersion;
  return {
    id,
    workspaceId,
    name: str(r.Name),
    clientName: str(r.ClientName),
    stage: effectiveStep(str(r.Stage), str(r.ResumeTo)),
    currentScopeVersion: typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null,
    scopeLockedAt: timeOrNull(r.ScopeLockedAt),
  };
}

// ── Scope version, features, stories, milestones ───────────────────────────────────────────────────────────────

export interface ScopeVersionRecord {
  id: string;
  number: number;
  status: "draft" | "locked";
  lockedAt: string | null;
  lockedByUserId: string | null;
  updatedAt: string;
  /** Success & performance (step "Scope & success"); empty targets when none were entered */
  successTargets: SuccessTargets;
  screensReviewedAt: string | null;
  screensReviewedBy: string | null;
}

export function scopeVersionFromRow(r: RawRow): ScopeVersionRecord | null {
  const id = nonEmpty(r.ItemId);
  const number = int(r.Number);
  const status = r.Status === "locked" ? "locked" : r.Status === "draft" || r.Status === "unlocked" ? "draft" : null;
  if (!id || number < 1 || !status) return null;
  return {
    id, number, status, lockedAt: timeOrNull(r.LockedAt), lockedByUserId: nonEmpty(r.LockedByUserId), updatedAt: updatedAt(r),
    successTargets: parseSuccessTargets(r.SuccessTargets),
    screensReviewedAt: timeOrNull(r.ScreensReviewedAt), screensReviewedBy: nonEmpty(r.ScreensReviewedBy),
  };
}

export type FeaturePriority = "must" | "nice" | "later" | "excluded";

export interface FeatureRecord {
  id: string;
  key: string;
  ref: string;
  name: string;
  description: string;
  priority: FeaturePriority;
  excludedReason: string | null;
  requirementIds: string[];
  screenIds: string[];
  sortOrder: number;
  updatedAt: string;
}

/** `requirementIdByKey` maps 'requirement:<Key>' refs to Requirement ItemIds; an unknown key is used as it is (Key = ItemId). */
export function featureFromRow(r: RawRow, requirementIdByKey: ReadonlyMap<string, string> = new Map()): FeatureRecord | null {
  const id = nonEmpty(r.ItemId);
  const key = nonEmpty(r.Key);
  const name = nonEmpty(r.Title);
  const priority = r.Status === "dropped" ? "excluded" : oneOf(r.Priority, ["must", "nice", "later"] as const);
  if (!id || !key || !name || !priority) return null;
  const requirementIds = strings(r.RequirementRefs)
    .map((ref) => prefixed(ref, "requirement:"))
    .filter((k): k is string => k !== null)
    .map((k) => requirementIdByKey.get(k) ?? k);
  return {
    id,
    key,
    ref: "feature:" + key,
    name,
    description: str(r.Description),
    priority,
    excludedReason: null,
    requirementIds,
    screenIds: [],
    sortOrder: int(r.SortOrder),
    updatedAt: updatedAt(r),
  };
}

export interface StoryRecord {
  id: string;
  key: string;
  featureId: string;
  actor: string;
  text: string;
  acceptanceCriteria: string[];
  sortOrder: number;
  updatedAt: string;
}

/** `featureIdByKey` maps Feature.Key to the feature's ItemId; an unknown key is kept as it is (legacy rows where Key = ItemId). */
export function storyFromRow(r: RawRow, featureIdByKey: ReadonlyMap<string, string> = new Map()): StoryRecord | null {
  const id = nonEmpty(r.ItemId);
  const key = nonEmpty(r.Key);
  const featureKey = prefixed(str(r.FeatureRef), "feature:");
  if (!id || !key || !featureKey) return null;
  return {
    id,
    key,
    // featureId is the feature's ItemId; FeatureRef holds `feature:<Feature.Key>` and is translated here; an unknown Key is kept.
    featureId: featureIdByKey.get(featureKey) ?? featureKey,
    actor: str(r.ActorRole),
    text: str(r.Text),
    acceptanceCriteria: strings(r.AcceptanceCriteria),
    sortOrder: int(r.SortOrder),
    updatedAt: updatedAt(r),
  };
}

export interface MilestoneRecord {
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

export function milestoneFromRow(r: RawRow): MilestoneRecord | null {
  const id = nonEmpty(r.ItemId);
  const number = int(r.Number);
  const name = nonEmpty(r.Name);
  if (!id || number < 1 || !name) return null;
  return {
    id,
    number,
    name,
    goal: str(r.Goal),
    featureRefs: strings(r.FeatureRefs),
    sortOrder: int(r.SortOrder),
    status: str(r.Status) || "planned",
    scopeVersion: int(r.ScopeVersion),
    updatedAt: updatedAt(r),
  };
}

// ── Design ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DesignBriefRecord {
  id: string;
  status: "draft" | "confirmed";
  mode: string;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  prototypeJson: string | null;
}

export function designBriefFromRow(r: RawRow): DesignBriefRecord | null {
  const id = nonEmpty(r.ItemId);
  const status = oneOf(r.Status, ["draft", "confirmed"] as const);
  if (!id || !status) return null;
  return { id, status, mode: str(r.Mode), confirmedAt: timeOrNull(r.ConfirmedAt), confirmedByUserId: nonEmpty(r.ConfirmedByUserId), prototypeJson: typeof r.PrototypeJson === "string" ? r.PrototypeJson : null };
}

export interface DesignScreenRecord {
  id: string;
  name: string;
  /** S1 has no purpose, feature links or viewport field yet: purpose is "", featureRefs [] and the viewport comes from the size. */
  purpose: string;
  featureRefs: string[];
  viewport: "desktop" | "mobile";
  sortOrder: number;
  createdAt: string;
  imageFileId: string | null;
  status: string;
}

export function designScreenFromRow(r: RawRow): DesignScreenRecord | null {
  const id = nonEmpty(r.ItemId);
  const name = nonEmpty(r.Name);
  if (!id || !name) return null;
  const w = int(r.Width);
  const h = int(r.Height);
  return {
    id,
    name,
    purpose: "",
    featureRefs: [],
    viewport: w > 0 && h > 0 && w < h && w <= 768 ? "mobile" : "desktop",
    sortOrder: int(r.SortOrder),
    createdAt: str(r.CreatedDate),
    imageFileId: nonEmpty(r.ImageFileId),
    status: str(r.Status),
  };
}

// ── Feedback ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FeedbackThreadRecord {
  id: string;
  targetType: ScopeFeedbackTarget;
  targetId: string;
  status: ThreadStatus;
}

export function threadFromRow(r: RawRow): FeedbackThreadRecord | null {
  const id = nonEmpty(r.ItemId);
  const targetType = oneOf(r.TargetType, SCOPE_FEEDBACK_TARGETS);
  const targetId = nonEmpty(r.TargetId);
  const status = oneOf(r.Status, THREAD_STATUSES);
  if (!id || !targetType || !targetId || !status) return null;
  return { id, targetType, targetId, status };
}

export interface FeedbackCommentRecord {
  id: string;
  threadId: string;
  authorUserId: string;
  text: string;
  at: string;
  attachmentIds: string[];
}

export function commentFromRow(r: RawRow): FeedbackCommentRecord | null {
  const id = nonEmpty(r.ItemId);
  const threadId = nonEmpty(r.ThreadId);
  if (!id || !threadId) return null;
  return { id, threadId, authorUserId: str(r.AuthorUserId), text: str(r.Text), at: str(r.At), attachmentIds: strings(r.AttachmentIds) };
}

export interface AttachmentRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  status: "pending" | "ready" | "rejected" | "deleted";
  createdByUserId: string;
  createdAt: string;
}

export function attachmentFromRow(r: RawRow): AttachmentRecord | null {
  const id = nonEmpty(r.ItemId);
  const status = oneOf(r.Status, ["pending", "ready", "rejected", "deleted"] as const);
  if (!id || !status) return null;
  return {
    id,
    ownerType: str(r.OwnerType),
    ownerId: str(r.OwnerId),
    fileName: str(r.FileName),
    mime: str(r.Mime),
    sizeBytes: int(r.SizeBytes),
    status,
    createdByUserId: str(r.CreatedByUserId),
    createdAt: str(r.CreatedDate),
  };
}

// ── Second opinion ──────────────────────────────────────────────────────────────────────────────────────────────

export interface SecondOpinionRecord {
  id: string;
  scopeVersion: number;
  createdAt: string;
}

export function secondOpinionFromRow(r: RawRow): SecondOpinionRecord | null {
  const id = nonEmpty(r.ItemId);
  if (!id) return null;
  return { id, scopeVersion: int(r.ScopeVersion), createdAt: str(r.CreatedDate) };
}

export interface ChallengeRecord {
  id: string;
  secondOpinionId: string;
  severity: "high" | "medium" | "low";
  question: string;
  why: string;
  suggestedFix: string;
  target: { type: "feature" | "story"; id: string } | null;
  status: "open" | "accepted" | "answered" | "dismissed";
  finalText: string;
  answerText: string;
  dismissReason: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
}

export function challengeFromRow(r: RawRow): ChallengeRecord | null {
  const id = nonEmpty(r.ItemId);
  const severity = oneOf(r.Severity, ["high", "medium", "low"] as const);
  const status = oneOf(r.Status, ["open", "accepted", "answered", "dismissed"] as const);
  const question = nonEmpty(r.Question);
  if (!id || !severity || !status || !question) return null;
  const type = oneOf(r.TargetType, ["feature", "story"] as const);
  const ref = str(r.TargetRef);
  const targetId = type ? (prefixed(ref, type + ":") ?? nonEmpty(ref)) : null;
  return {
    id,
    secondOpinionId: str(r.OpinionId),
    severity,
    question,
    why: str(r.Why),
    suggestedFix: str(r.SuggestedFix),
    target: type && targetId ? { type, id: targetId } : null,
    status,
    finalText: str(r.FinalText),
    answerText: str(r.AnswerText),
    dismissReason: str(r.DismissReason),
    decidedByUserId: nonEmpty(r.DecidedByUserId),
    decidedAt: timeOrNull(r.DecidedAt),
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ApprovalStepRecord {
  id: string;
  type: "architect" | "security" | "qa" | "custom";
  required: boolean;
  approverUserIds: string[];
}

export interface ApprovalPolicyRecord {
  id: string;
  environment: "stage" | "production";
  steps: ApprovalStepRecord[];
}

export function approvalStepFromRow(r: RawRow): (ApprovalStepRecord & { sortOrder: number; parentId: string }) | null {
  const id = nonEmpty(r.ItemId);
  const type = oneOf(r.StepType, ["architect", "security", "qa", "custom"] as const);
  if (!id || !type || r.ParentType !== "policy" || !nonEmpty(r.ParentId)) return null;
  if (typeof r.Required !== "boolean" || !Array.isArray(r.ApproverUserIds)) return null;
  if (!r.ApproverUserIds.every((u) => typeof u === "string")) return null;
  return { id, type, required: r.Required, approverUserIds: r.ApproverUserIds as string[], sortOrder: int(r.SortOrder), parentId: str(r.ParentId) };
}

export type PolicyState = ApprovalPolicyRecord | "unreadable" | null;

/** One environment's policy: null = not set up (or disabled), "unreadable" = a policy or one of its steps is malformed. */
export function approvalPolicyFor(
  environment: "stage" | "production",
  policyRows: readonly RawRow[],
  stepRows: readonly RawRow[],
): PolicyState {
  const mine = policyRows.filter((p) => isRecord(p) && p.Environment === environment && p.Status !== "disabled");
  if (mine.length === 0) return null;
  const row = mine[0];
  const id = nonEmpty(row.ItemId);
  if (!id) return "unreadable";
  const own = stepRows.filter((s) => isRecord(s) && s.ParentType === "policy" && s.ParentId === id);
  const steps = own.map(approvalStepFromRow);
  if (steps.some((s) => s === null)) return "unreadable";
  const ordered = (steps as NonNullable<(typeof steps)[number]>[]).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id,
    environment,
    steps: ordered.map(({ id: sid, type, required, approverUserIds }) => ({ id: sid, type, required, approverUserIds })),
  };
}

// ── Requirements and objective (read only) ──────────────────────────────────────────────────────────────────────

export interface RequirementRecord {
  id: string;
  key: string;
  code: string;
  title: string;
  active: boolean;
  sortOrder: number;
}

export function requirementFromRow(r: RawRow): RequirementRecord | null {
  const id = nonEmpty(r.ItemId);
  const key = nonEmpty(r.Key);
  const title = nonEmpty(r.Title);
  const number = int(r.Number);
  if (!id || !key || !title || number < 1) return null;
  return { id, key, code: "R-" + number, title, active: r.Status !== "dropped", sortOrder: int(r.SortOrder) };
}

export interface ObjectiveRecord {
  id: string;
  text: string;
}

export function objectiveFromRow(r: RawRow): ObjectiveRecord | null {
  const id = nonEmpty(r.ItemId);
  if (!id) return null;
  return { id, text: str(r.Statement) };
}
