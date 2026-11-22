/**
 * The files people send with a change request, its answers or feedback on a preview (src/domain/attachments.ts). They
 * go up as drafts of the person (collab attachment.* ops); the op that sends the words takes `attachmentIds` +
 * `draftKey`, checks that every file is one of the caller's own ready drafts of this project and owner type (or, on a
 * retry, already on this owner) and moves them onto the record it writes, before it queues the work that reads them.
 */
import { DRAFT_KEY_PATTERN } from "../../../src/domain/feedback";
import { DRAFT_CHECK_FIELDS, MAX_TALK_ATTACHMENTS, claimDrafts, type TalkOwnerType } from "../../../src/domain/attachments";
import { fail, idArg, type OpContext } from "./common";
import type { ReadPorts, Row } from "./ports";

export interface FilesArgs {
  attachmentIds: string[];
  draftKey: string;
}

/** The two optional arguments of a send op (absent: no files). Spread into the op's validated args (top-level keys, so
 *  the validated args validate again unchanged). */
export function filesArgs(a: Record<string, unknown>): FilesArgs {
  const raw = a.attachmentIds;
  let ids: string[] = [];
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw) || raw.length > MAX_TALK_ATTACHMENTS) fail("invalid_input", "delivery.files.tooMany", { field: "attachmentIds", max: MAX_TALK_ATTACHMENTS });
    ids = [...new Set((raw as unknown[]).map((x) => idArg(x, "attachmentIds")))];
  }
  // "" = no key (the validated args go through the validator again)
  const key = a.draftKey;
  if (key !== undefined && key !== null && key !== "" && (typeof key !== "string" || !DRAFT_KEY_PATTERN.test(key))) {
    fail("invalid_input", "delivery.args.invalid", { field: "draftKey" });
  }
  return { attachmentIds: ids, draftKey: typeof key === "string" ? key : "" };
}

/** The Attachment rows of the files (the same call in the prefetch and the handler, so the handler's read is free). */
export function readFiles(ports: ReadPorts, projectId: string, f: FilesArgs): Promise<Row[]> {
  if (f.attachmentIds.length === 0) return Promise.resolve([]);
  return ports.query("Attachment", { ProjectId: projectId, ItemId: { in: f.attachmentIds } }, { fields: DRAFT_CHECK_FIELDS });
}

export interface ClaimedFiles {
  count: number;
  ids: string[];
  /** Moves the drafts onto the owner (Meta: which answer a file belongs to, when it belongs to one). */
  attach(ownerId: string, meta?: string): Promise<void>;
}

/** The check before anything is written: the owner id is known only for an existing record (a retry may find the files on it). */
export function claimFiles(ctx: OpContext, rows: readonly Row[], f: FilesArgs, ownerType: TalkOwnerType, ownerId?: string | null): ClaimedFiles {
  const claim = claimDrafts(rows, { ids: f.attachmentIds, ownerType, draftKey: f.draftKey, userId: ctx.caller.userId, projectId: ctx.projectId, ownerId: ownerId ?? null });
  if (!claim.ok) return fail("invalid_input", "delivery.files.notReady", { field: "attachmentIds" });
  return {
    count: f.attachmentIds.length,
    ids: f.attachmentIds,
    async attach(owner, meta) {
      await Promise.all(
        claim.move.map((id) => ctx.ports.update("Attachment", id, ctx.touch({ OwnerId: owner, ...(meta ? { Meta: meta } : {}) }))),
      );
    },
  };
}

/**
 * The check before a send op creates its record (a feedback ticket, a new change request): every file is one of the
 * caller's own ready files of this project and owner type. Whether a file that is no longer a draft belongs to the
 * new record (a retry) is checked by claimFiles once the record's id is known.
 */
export function precheckFiles(ctx: OpContext, rows: readonly Row[], f: FilesArgs, ownerType: TalkOwnerType): void {
  if (f.attachmentIds.length === 0) return;
  if (!f.draftKey) fail("invalid_input", "delivery.files.notReady", { field: "draftKey" });
  const byId = new Map(rows.map((r) => [String(r.ItemId), r]));
  for (const id of f.attachmentIds) {
    const r = byId.get(id);
    if (!r || r.ProjectId !== ctx.projectId || r.OwnerType !== ownerType || r.Status !== "ready" || r.CreatedByUserId !== ctx.caller.userId) {
      fail("invalid_input", "delivery.files.notReady", { field: "attachmentIds" });
    }
  }
}
