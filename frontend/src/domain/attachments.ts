/**
 * Files people attach while they talk to the team: an answer to the business analyst's question, a change request and
 * its answers, a chat message to an agent, feedback on a milestone preview. Pure (imports only other src/domain files),
 * so the functions, the engine and the web bundle share the same rules.
 *
 * The upload pipeline is the one of the comment boxes (src/domain/feedback.ts): the files go up as drafts of the person
 * (OwnerId "draft:<draftKey>") while they type, and the op that sends the words moves the ready drafts onto the record
 * it writes (OwnerType + OwnerId below). Types and sizes are the comment boxes' (MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES,
 * ./docs fileTypeFor).
 */
import type { WorkspacePermission } from "./rbac";
import { draftOwnerId, MAX_ATTACHMENTS } from "./feedback";

/** The Attachment.OwnerType of each place people talk to the team (server/local/engine/ai/attachments.ts ATTACHMENT_OWNERS). */
export const TALK_OWNER_TYPES = ["clarification", "change-request", "agent-chat", "ticket"] as const;
export type TalkOwnerType = (typeof TALK_OWNER_TYPES)[number];

export function isTalkOwnerType(x: unknown): x is TalkOwnerType {
  return typeof x === "string" && (TALK_OWNER_TYPES as readonly string[]).includes(x);
}

/** The record that owns the files once they are sent. */
export const TALK_OWNER_SCHEMA: Record<TalkOwnerType, "Clarification" | "ChangeRequest" | "AgentChatMessage" | "Ticket"> = {
  clarification: "Clarification",
  "change-request": "ChangeRequest",
  "agent-chat": "AgentChatMessage",
  ticket: "Ticket",
};

/**
 * The record the person is writing about while the files go up (presign's `forId`): the question, the change request,
 * the milestone whose preview they try. A chat message has none (the files belong to the message being written).
 */
export const TALK_FOR_SCHEMA: Record<TalkOwnerType, "Clarification" | "ChangeRequest" | "Milestone" | null> = {
  clarification: "Clarification",
  "change-request": "ChangeRequest",
  "agent-chat": null,
  ticket: "Milestone",
};

/** Who may attach files there: the same permission as the op that sends the words (any one of the list). */
export const TALK_PERMISSION: Record<TalkOwnerType, readonly WorkspacePermission[]> = {
  // clarification.answer: sanitization.edit, or the question's owner with "comment" (canAnswerClarification)
  clarification: ["sanitization.edit", "comment"],
  "change-request": ["build.run"],
  "agent-chat": ["comment"],
  ticket: ["comment", "build.run"],
};

export function mayAttach(ownerType: TalkOwnerType, permissions: readonly string[]): boolean {
  return TALK_PERMISSION[ownerType].some((p) => permissions.includes(p));
}

/** The files one message, answer or request may carry. */
export const MAX_TALK_ATTACHMENTS = MAX_ATTACHMENTS;

/** The Attachment fields a send op reads to check the drafts it is handed. */
export const DRAFT_CHECK_FIELDS = ["ItemId", "ProjectId", "OwnerType", "OwnerId", "Status", "CreatedByUserId", "FileName", "Mime", "SizeBytes"] as const;

type AnyRow = Record<string, unknown>;
const s = (row: AnyRow | undefined, k: string): string => (typeof row?.[k] === "string" ? (row[k] as string) : "");

export type DraftClaim =
  | { ok: true; /** The ids to move onto the owner (the rest already belong to it: a retry). */ move: string[]; files: { id: string; name: string; mime: string; sizeBytes: number }[] }
  | { ok: false; reason: "draftKey" | "notReady" };

/**
 * The check of a send op: every id is one of the caller's own ready uploads of this project and owner type, still a
 * draft of this draftKey or (a retry of the same request) already on this owner. Pure; the rows are the Attachment
 * rows read by ProjectId + ItemId in `ids`.
 */
export function claimDrafts(
  rows: readonly AnyRow[],
  o: { ids: readonly string[]; ownerType: TalkOwnerType; draftKey?: string | null; userId: string; projectId: string; ownerId?: string | null },
): DraftClaim {
  const ids = [...new Set(o.ids.filter((x) => typeof x === "string" && x !== ""))];
  if (ids.length === 0) return { ok: true, move: [], files: [] };
  if (!o.draftKey) return { ok: false, reason: "draftKey" };
  const draft = draftOwnerId(o.draftKey);
  const byId = new Map(rows.map((r) => [s(r, "ItemId"), r]));
  const move: string[] = [];
  const files: { id: string; name: string; mime: string; sizeBytes: number }[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || s(r, "ProjectId") !== o.projectId || s(r, "OwnerType") !== o.ownerType || s(r, "Status") !== "ready" || s(r, "CreatedByUserId") !== o.userId) {
      return { ok: false, reason: "notReady" };
    }
    const owner = s(r, "OwnerId");
    if (owner === draft) move.push(id);
    else if (!o.ownerId || owner !== o.ownerId) return { ok: false, reason: "notReady" };
    files.push({ id, name: s(r, "FileName"), mime: s(r, "Mime"), sizeBytes: typeof r.SizeBytes === "number" ? r.SizeBytes : 0 });
  }
  return { ok: true, move, files };
}

/** Attachment.Meta of a file that belongs to one answer of a change request ({"questionId":"q2"}); "" for the request itself. */
export function answerMeta(questionId: string | null | undefined): string {
  return questionId ? JSON.stringify({ questionId }) : "";
}

/** The question id an Attachment.Meta names, or null. */
export function questionIdOf(meta: unknown): string | null {
  if (typeof meta !== "string" || !meta.trim().startsWith("{")) return null;
  try {
    const v = JSON.parse(meta) as { questionId?: unknown };
    return typeof v.questionId === "string" && v.questionId ? v.questionId : null;
  } catch {
    return null;
  }
}

/** One line for the audit and the ledger: "2 files: design.png, notes.pdf". */
export function filesLine(files: readonly { name: string }[]): string {
  if (!files.length) return "";
  const names = files.map((f) => f.name || "file").join(", ");
  return `${files.length} ${files.length === 1 ? "file" : "files"}: ${names}`.slice(0, 300);
}
