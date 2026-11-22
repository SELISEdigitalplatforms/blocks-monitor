// The files sent with a chat message to an agent (Attachment OwnerType "agent-chat", OwnerId = the person's
// AgentChatMessage). They go up as drafts of the composer (attachments/talk.ts); agentChat.send takes their ids + the
// draftKey, checks them before anything is written and moves them onto the message it stores, so the reply job (and a
// task made from the message) reads them. No op lives here.
import { OpError, f, v } from "../../../_lib";
import type { OpDeps, Row, ScopedGateway } from "../../../_lib";
import { DRAFT_KEY_PATTERN } from "../../../../src/domain/feedback";
import { MAX_TALK_ATTACHMENTS, claimDrafts } from "../../../../src/domain/attachments";
import { MSG } from "../common/messages";
import { SCHEMA, str } from "../common/records";

const OWNER = "agent-chat" as const;

/** The full Attachment fields (a task made from the message copies the files from these rows). */
const FILE_FIELDS = [
  "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileId", "FileName", "StoredName", "Kind", "Mime", "SizeBytes", "Origin", "Meta", "Status",
  "CreatedByUserId", "CreatedDate",
];

/** The two optional arguments of agentChat.send. */
export const sendFileArgs = {
  draftKey: v.optional(v.string({ pattern: DRAFT_KEY_PATTERN })),
  attachmentIds: v.optional(v.array(v.id(), { max: MAX_TALK_ATTACHMENTS })),
};

export const fileIdsOf = (args: { attachmentIds?: readonly string[] | undefined }): string[] => [...new Set(args.attachmentIds ?? [])];

/** The Attachment rows of the message's files (the same call in the prefetch and the handler). */
export async function readSendFiles(gw: ScopedGateway, projectId: string, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const rows = await gw.findAll(SCHEMA.attachment, { where: f.and(f.eq("ProjectId", projectId), f.in("ItemId", [...ids])), fields: FILE_FIELDS, max: ids.length });
  return rows as Row[];
}

/** Before anything is written: every file is one of the caller's own ready chat uploads of this project. */
export function precheckSendFiles(deps: OpDeps, rows: readonly Row[], o: { ids: readonly string[]; draftKey?: string; userId: string; projectId: string }): void {
  if (!o.ids.length) return;
  if (!o.draftKey) deps.fail("invalid_input", undefined, { field: "draftKey", rule: "required" });
  const byId = new Map(rows.map((r) => [str(r, "ItemId"), r]));
  for (const id of o.ids) {
    const r = byId.get(id);
    if (!r || str(r, "ProjectId") !== o.projectId || str(r, "OwnerType") !== OWNER || str(r, "Status") !== "ready" || str(r, "CreatedByUserId") !== o.userId) {
      deps.fail("invalid_input", MSG.attachmentNotReady);
    }
  }
}

/** Moves the drafts onto the stored message (a retry finds them there already); answers the rows as they now are. */
export async function attachSendFiles(
  deps: OpDeps,
  rows: readonly Row[],
  o: { ids: readonly string[]; draftKey?: string; userId: string; projectId: string; messageId: string },
): Promise<Row[]> {
  if (!o.ids.length) return [];
  if (!o.messageId) throw new OpError("internal");
  const claim = claimDrafts(rows, { ids: o.ids, ownerType: OWNER, draftKey: o.draftKey ?? null, userId: o.userId, projectId: o.projectId, ownerId: o.messageId });
  if (!claim.ok) return deps.fail("invalid_input", MSG.attachmentNotReady);
  await Promise.all(claim.move.map((id) => deps.gw.update(SCHEMA.attachment, id, { OwnerId: o.messageId })));
  return rows.filter((r) => o.ids.includes(str(r, "ItemId"))).map((r) => ({ ...r, OwnerId: o.messageId }));
}
