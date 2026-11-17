// Shared record names, field lists and accessors of the collab function.
// The field lists are the answer and read lists; the web side (src/blocks/collab/records.ts) uses the same ones.
import type { Row } from "../../../_lib";

export const SCHEMA = {
  project: "Project",
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
  requirement: "Requirement",
  wikiPage: "WikiPage",
  wikiHistory: "WikiPageHistory",
  agentChat: "AgentChatMessage",
  assistant: "AssistantMessage",
  suggestion: "Suggestion",
  scopeVersion: "ScopeVersion",
  feature: "Feature",
  story: "Story",
  milestone: "Milestone",
  ticket: "Ticket",
  changeRequest: "ChangeRequest",
  release: "Release",
  engineJob: "EngineJob",
} as const;

const WIKI_TREE = [
  "ItemId", "ProjectId", "Slug", "PageGroup", "Title", "SourcesJson", "UpdatedWithVersion", "Origin", "EngineJobId",
  "LastUpdatedDate", "UpdatedByUserId",
] as const;

export const FIELDS = {
  thread: ["ItemId", "ProjectId", "TargetType", "TargetId", "Status", "LastUpdatedDate", "UpdatedByUserId"],
  comment: ["ItemId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At"],
  attachment: [
    "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileName", "Kind", "Mime", "SizeBytes", "Status", "CreatedByUserId",
    "CreatedDate",
  ],
  wikiTree: WIKI_TREE,
  wikiPage: [...WIKI_TREE, "BodyMd"],
  wikiHistory: ["ItemId", "ProjectId", "PageId", "BodyMd", "EditedByUserId", "Origin", "At"],
  agentChat: [
    "ItemId", "ProjectId", "AgentRole", "Role", "Kind", "Text", "AuthorUserId", "TaskTarget", "TaskId", "TaskCode",
    "TaskTitle", "TaskLane", "TaskFeatureRef", "EngineJobId", "At",
  ],
  assistant: [
    "ItemId", "ProjectId", "Environment", "Role", "Kind", "Text", "Points", "RefsJson", "AttachmentsJson", "AnalysisJson",
    "FixState", "FixChangeRequestId", "FixCode", "FixVersion", "EngineJobId", "At", "UpdatedByUserId",
  ],
  suggestion: ["ItemId", "ProjectId", "Source", "Key", "Title", "Text", "Status"],
} as const satisfies Record<string, readonly string[]>;

export const str = (row: Row | null | undefined, k: string): string => {
  const x = row?.[k];
  return typeof x === "string" ? x : "";
};

export const num = (row: Row | null | undefined, k: string): number => {
  const x = row?.[k];
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** A string array; anything that is not a string is dropped. */
export const strs = (row: Row | null | undefined, k: string): string[] => {
  const x = row?.[k];
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
};

/** The rows of a gateway answer: an array, or an object holding items, rows or data. */
export function rowsOf(res: unknown): Row[] {
  const list = Array.isArray(res)
    ? res
    : res && typeof res === "object"
      ? ((res as Record<string, unknown>).items ?? (res as Record<string, unknown>).rows ?? (res as Record<string, unknown>).data)
      : [];
  return Array.isArray(list) ? list.filter((r): r is Row => !!r && typeof r === "object") : [];
}

/** The answer row: only the listed keys (ItemId always). FileId, StoredName, ReaderIds and RequestKey never leave the server. */
export function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  if (row.ItemId !== undefined) out.ItemId = row.ItemId;
  for (const k of fields) if (k in row && row[k] !== undefined) out[k] = row[k];
  return out;
}

/** The server clock plus `ms`, as an ISO string (used for +1 ms ordering). */
export const isoPlus = (now: Date, ms: number): string => new Date(now.getTime() + ms).toISOString();

/** Date.parse equality; an empty or invalid date is never equal. */
export function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}
