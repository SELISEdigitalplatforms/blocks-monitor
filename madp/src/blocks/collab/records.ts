// The ONE web-side mapper from S1 collaboration rows (FeedbackThread, FeedbackComment, Attachment, WikiPage,
// WikiPageHistory, AgentChatMessage, AssistantMessage) to typed records. Reads and function answers carry the same
// raw rows, so the same mappers serve both. A malformed row is dropped, never guessed.
import { isWikiGroup, SLUG_PATTERN, type WikiGroup, type WikiOrigin } from "../../domain/wiki";
import { isChatRole, type ChatRole } from "../../domain/agentChat";
import { offerKindOf, type ChatActionKind } from "../../domain/chatActions";
import {
  parseAttachmentNotes,
  parseRefs,
  type AssistantEnv,
  type AttachmentNote,
  type CodeRef,
  type FixState,
} from "../../domain/assistant";
import { THREAD_STATUSES, type ThreadStatus } from "../../domain/feedback";

export const COLLAB_SCHEMA = {
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
  wikiPage: "WikiPage",
  wikiHistory: "WikiPageHistory",
  agentChat: "AgentChatMessage",
  assistant: "AssistantMessage",
  suggestion: "Suggestion",
} as const;

export const THREAD_FIELDS = ["ItemId", "ProjectId", "TargetType", "TargetId", "Status", "LastUpdatedDate", "UpdatedByUserId"] as const;
export const COMMENT_FIELDS = ["ItemId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At"] as const;
export const ATTACHMENT_FIELDS = [
  "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileName", "Kind", "Mime", "SizeBytes", "Status", "CreatedByUserId", "CreatedDate",
] as const;
export const WIKI_TREE_FIELDS = [
  "ItemId", "ProjectId", "Slug", "PageGroup", "Title", "SourcesJson", "UpdatedWithVersion", "Origin", "EngineJobId", "LastUpdatedDate", "UpdatedByUserId",
] as const;
export const WIKI_PAGE_FIELDS = [...WIKI_TREE_FIELDS, "BodyMd"] as const;
export const WIKI_BODY_FIELDS = ["ItemId", "BodyMd", "LastUpdatedDate"] as const;
export const WIKI_HISTORY_FIELDS = ["ItemId", "ProjectId", "PageId", "BodyMd", "EditedByUserId", "Origin", "At"] as const;
export const WIKI_COUNT_FIELDS = ["ItemId", "ProjectId"] as const;
export const AGENT_CHAT_FIELDS = [
  "ItemId", "ProjectId", "AgentRole", "Role", "Kind", "Text", "AuthorUserId", "TaskTarget", "TaskId", "TaskCode", "TaskTitle", "TaskLane",
  "TaskFeatureRef", "EngineJobId", "At",
] as const;
export const ASSISTANT_FIELDS = [
  "ItemId", "ProjectId", "Environment", "Role", "Kind", "Text", "Points", "RefsJson", "AttachmentsJson", "AnalysisJson", "FixState",
  "FixChangeRequestId", "FixCode", "FixVersion", "EngineJobId", "At", "UpdatedByUserId",
] as const;

export interface FeedbackThreadRecord {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  /** open → working → updated (the team answered, waiting for the person) → resolved (accepted and closed). */
  status: ThreadStatus;
  updatedAt: string;
  updatedByUserId: string;
}

export interface FeedbackCommentRecord {
  id: string;
  projectId: string;
  threadId: string;
  authorUserId: string;
  kind: string;
  text: string;
  attachmentIds: string[];
  at: string;
}

export interface FeedbackAttachmentRecord {
  id: string;
  projectId: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  kind: string;
  mime: string;
  sizeBytes: number;
  status: "pending" | "ready" | "rejected" | "deleted";
  createdByUserId: string;
  createdAt: string;
}

export interface WikiPageRecord {
  id: string;
  projectId: string;
  slug: string;
  group: WikiGroup;
  title: string;
  sourcesJson: string;
  updatedWithVersion: string;
  origin: WikiOrigin;
  engineJobId: string;
  updatedAt: string;
  updatedByUserId: string;
  /** null when BodyMd was not read (the tree query leaves it out). */
  bodyMd: string | null;
}

export interface WikiHistoryRecord {
  id: string;
  projectId: string;
  pageId: string;
  bodyMd: string;
  editedByUserId: string;
  origin: WikiOrigin;
  at: string;
}

export interface AgentChatTask {
  /** change-request, suggestion and ticket from a chat task; preview-fix, screen-comment and scope-comment from a
   *  tapped offer (src/domain/chatActions.ts ACTION_RESULT). */
  target: "change-request" | "suggestion" | "ticket" | "preview-fix" | "screen-comment" | "scope-comment" | "streams-setting" | "continue-setting";
  id: string;
  code: string;
  title: string;
  lane: string;
  featureRef: string;
}

export interface AgentChatRecord {
  id: string;
  projectId: string;
  agentRole: ChatRole;
  role: "user" | "agent";
  kind: "text" | "task-created";
  text: string;
  authorUserId: string;
  task: AgentChatTask | null;
  /** An action the agent offers (a Kind "text" agent message whose TaskTarget is "offer:<kind>"), else null. */
  offer: AgentChatOffer | null;
  engineJobId: string;
  at: string;
}

export interface AgentChatOffer {
  kind: ChatActionKind;
  title: string;
  /** What will be sent: the message's Text. */
  details: string;
  /** The screen, milestone or scope item (TaskFeatureRef), "" for a change request. */
  targetId: string;
  /** "screen", "feature", "story" or "milestone" for a comment (TaskLane), else "". */
  targetType: string;
  /** What the tap made (TaskId / TaskCode), "" until it is taken. */
  takenId: string;
  takenCode: string;
}

export interface AssistantMessageRecord {
  id: string;
  projectId: string;
  environment: AssistantEnv;
  role: "user" | "assistant";
  kind: "text" | "analysis";
  text: string;
  points: string[];
  refs: CodeRef[];
  attachments: AttachmentNote[];
  analysisJson: string;
  fixState: FixState;
  fixChangeRequestId: string;
  fixCode: string;
  fixVersion: string;
  engineJobId: string;
  at: string;
  updatedByUserId: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
const isRow = (r: unknown): r is Row => typeof r === "object" && r !== null && !Array.isArray(r);

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function toThread(row: unknown): FeedbackThreadRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const status = oneOf(row.Status, THREAD_STATUSES);
  const targetType = str(row.TargetType);
  const targetId = str(row.TargetId);
  if (!id || !status || !targetType || !targetId) return null;
  return { id, projectId: str(row.ProjectId), targetType, targetId, status, updatedAt: str(row.LastUpdatedDate), updatedByUserId: str(row.UpdatedByUserId) };
}

export function toComment(row: unknown): FeedbackCommentRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const threadId = str(row.ThreadId);
  if (!id || !threadId || typeof row.Text !== "string") return null;
  return {
    id,
    projectId: str(row.ProjectId),
    threadId,
    authorUserId: str(row.AuthorUserId),
    kind: str(row.Kind),
    text: row.Text,
    attachmentIds: strings(row.AttachmentIds),
    at: str(row.At),
  };
}

export function toAttachment(row: unknown): FeedbackAttachmentRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const status = oneOf(row.Status, ["pending", "ready", "rejected", "deleted"] as const);
  if (!id || !status) return null;
  return {
    id,
    projectId: str(row.ProjectId),
    ownerType: str(row.OwnerType),
    ownerId: str(row.OwnerId),
    fileName: str(row.FileName),
    kind: str(row.Kind),
    mime: str(row.Mime),
    sizeBytes: num(row.SizeBytes),
    status,
    createdByUserId: str(row.CreatedByUserId),
    createdAt: str(row.CreatedDate),
  };
}

function wikiOrigin(v: unknown): WikiOrigin | null {
  return oneOf(v, ["factory", "person"] as const);
}

export function toWikiPage(row: unknown): WikiPageRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const slug = str(row.Slug);
  const origin = wikiOrigin(row.Origin);
  if (!id || !origin || !SLUG_PATTERN.test(slug) || !isWikiGroup(row.PageGroup)) return null;
  return {
    id,
    projectId: str(row.ProjectId),
    slug,
    group: row.PageGroup,
    title: str(row.Title),
    sourcesJson: str(row.SourcesJson),
    updatedWithVersion: str(row.UpdatedWithVersion),
    origin,
    engineJobId: str(row.EngineJobId),
    updatedAt: str(row.LastUpdatedDate),
    updatedByUserId: str(row.UpdatedByUserId),
    bodyMd: typeof row.BodyMd === "string" ? row.BodyMd : null,
  };
}

export function toWikiHistory(row: unknown): WikiHistoryRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const pageId = str(row.PageId);
  const origin = wikiOrigin(row.Origin);
  if (!id || !pageId || !origin) return null;
  return { id, projectId: str(row.ProjectId), pageId, bodyMd: str(row.BodyMd), editedByUserId: str(row.EditedByUserId), origin, at: str(row.At) };
}

export function toAgentChat(row: unknown): AgentChatRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const role = oneOf(row.Role, ["user", "agent"] as const);
  const kind = oneOf(row.Kind, ["text", "task-created"] as const);
  if (!id || !role || !kind || !isChatRole(row.AgentRole)) return null;
  let task: AgentChatTask | null = null;
  if (kind === "task-created") {
    const target = oneOf(row.TaskTarget, ["change-request", "suggestion", "ticket", "preview-fix", "screen-comment", "scope-comment", "streams-setting", "continue-setting"] as const);
    if (!target) return null;
    task = { target, id: str(row.TaskId), code: str(row.TaskCode), title: str(row.TaskTitle), lane: str(row.TaskLane), featureRef: str(row.TaskFeatureRef) };
  }
  const offerKind = kind === "text" && role === "agent" ? offerKindOf(row.TaskTarget) : null;
  const offer: AgentChatOffer | null = offerKind
    ? {
      kind: offerKind, title: str(row.TaskTitle), details: str(row.Text), targetId: str(row.TaskFeatureRef), targetType: str(row.TaskLane),
      takenId: str(row.TaskId), takenCode: str(row.TaskCode),
    }
    : null;
  return {
    id,
    projectId: str(row.ProjectId),
    agentRole: row.AgentRole,
    role,
    kind,
    text: str(row.Text),
    authorUserId: str(row.AuthorUserId),
    task,
    offer,
    engineJobId: str(row.EngineJobId),
    at: str(row.At),
  };
}

export function toAssistantMessage(row: unknown): AssistantMessageRecord | null {
  if (!isRow(row)) return null;
  const id = str(row.ItemId);
  const environment = oneOf(row.Environment, ["dev", "stage", "production"] as const);
  const role = oneOf(row.Role, ["user", "assistant"] as const);
  const kind = oneOf(row.Kind, ["text", "analysis"] as const);
  if (!id || !environment || !role || !kind) return null;
  const fixState = row.FixState === undefined || row.FixState === null || row.FixState === "" ? "none" : oneOf(row.FixState, ["none", "offered", "started", "declined"] as const);
  if (!fixState) return null;
  return {
    id,
    projectId: str(row.ProjectId),
    environment,
    role,
    kind,
    text: str(row.Text),
    points: strings(row.Points),
    refs: parseRefs(str(row.RefsJson)),
    attachments: parseAttachmentNotes(str(row.AttachmentsJson)),
    analysisJson: str(row.AnalysisJson),
    fixState,
    fixChangeRequestId: str(row.FixChangeRequestId),
    fixCode: str(row.FixCode),
    fixVersion: str(row.FixVersion),
    engineJobId: str(row.EngineJobId),
    at: str(row.At),
    updatedByUserId: str(row.UpdatedByUserId),
  };
}

/** Map rows, dropping the malformed ones. */
export function mapRows<T>(rows: readonly unknown[], to: (r: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const m = to(r);
    if (m) out.push(m);
  }
  return out;
}

/** At ascending, then id. */
export function byAt(a: { at: string; id: string }, b: { at: string; id: string }): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
