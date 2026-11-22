// The files people attach where they talk to the team: an answer to the product manager's question ("clarification"),
// a change request and its answers ("change-request"), a chat message to an agent ("agent-chat"), feedback on a
// milestone preview ("ticket"). The same pipeline as the comment boxes (common/uploads.ts): presign → browser PUT →
// commit → url → delete; the files are drafts of the person (OwnerId "draft:<draftKey>") until the op that sends the
// words (clarification.answer, cr.saveDraft / cr.answer, agentChat.send, milestone.feedback) moves them onto its record.
// Permissions follow the op that sends the words (src/domain/attachments.ts TALK_PERMISSION).
import { defineOp, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import { DRAFT_KEY_PATTERN, isDraftOwnerId, opensInline } from "../../../../src/domain/feedback";
import { TALK_FOR_SCHEMA, TALK_OWNER_SCHEMA, TALK_OWNER_TYPES, isTalkOwnerType, mayAttach, type TalkOwnerType } from "../../../../src/domain/attachments";
import { canAnswerClarification } from "../../../../src/domain/sanitization";
import { projectArgs } from "../common/args";
import { childOf, liveProject } from "../common/loaders";
import { prefetchChild, warm } from "../wiki/savePath";
import { SCHEMA, str } from "../common/records";
import { OWN_FIELDS, checkUpload, commitUpload, deleteDraft, openUploads, presignDraft, shaArg } from "../common/uploads";

const AUDIT = "attachment";
const FOR_FIELDS = ["Status", "OwnerUserId"] as const;
const FOR_FIELDS_OF: Record<string, readonly string[]> = {
  Clarification: ["Status", "OwnerUserId"],
  ChangeRequest: ["Status"],
  Milestone: ["Status"],
};

/** An attachment of this project owned by one of the talk owner types (or its draft); anything else is not_found. */
async function talkAttachment(deps: OpDeps, projectId: string, id: string): Promise<Row & { OwnerType: TalkOwnerType }> {
  const row = await childOf(deps, SCHEMA.attachment, id, projectId, OWN_FIELDS);
  if (!isTalkOwnerType(str(row, "OwnerType"))) return deps.fail("not_found");
  return row as Row & { OwnerType: TalkOwnerType };
}

const prefetchOwn = (p: Parameters<typeof prefetchChild>[0], projectId: string, id: string): Promise<unknown> =>
  warm(prefetchChild(p, SCHEMA.attachment, id, "ProjectId", projectId, OWN_FIELDS));

/** The gate of a presign: who may attach here, and the record the person is writing about (when there is one). */
async function gateFor(ctx: OpCtx, deps: OpDeps, ownerType: TalkOwnerType, forId: string | undefined, projectId: string): Promise<void> {
  if (!mayAttach(ownerType, ctx.permissions)) return deps.fail("forbidden");
  const schema = TALK_FOR_SCHEMA[ownerType];
  if (!schema) return;
  // A new change request has no id yet (cr.saveDraft creates it with the files); the others always name their record.
  if (!forId) {
    if (ownerType === "change-request") return;
    return deps.fail("invalid_input", undefined, { field: "forId", rule: "required" });
  }
  const row = await childOf(deps, schema, forId, projectId, FOR_FIELDS_OF[schema] ?? ["Status"]);
  if (ownerType === "clarification") {
    if (!canAnswerClarification({ userId: ctx.caller.userId, permissions: ctx.permissions }, { ownerUserId: str(row, "OwnerUserId") })) {
      return deps.fail("forbidden");
    }
  }
  // Feedback on a preview is open until the milestone is accepted (milestone.feedback checks the preview itself).
  if (ownerType === "ticket" && str(row, "Status") === "done") return deps.fail("conflict");
}

const presign = defineOp({
  op: "attachment.presign",
  kind: "command",
  scope: "project",
  // The handler checks the permission of the place (TALK_PERMISSION): an answer, a change request, a chat or feedback.
  permission: "membership",
  args: projectArgs({
    ownerType: v.enumOf(TALK_OWNER_TYPES),
    forId: v.optional(v.id()),
    draftKey: v.string({ pattern: DRAFT_KEY_PATTERN }),
    fileName: v.string({ min: 1, max: 255 }),
    mime: v.string({ min: 1, max: 100 }),
    sizeBytes: v.int({ min: 1 }),
    sha256: shaArg(),
  }),
  prefetch: (p) => {
    const schema = TALK_FOR_SCHEMA[p.args.ownerType];
    return warm(
      schema && p.args.forId ? prefetchChild(p, schema, p.args.forId, "ProjectId", p.args.projectId, FOR_FIELDS_OF[schema] ?? FOR_FIELDS) : Promise.resolve(),
      openUploads({ gw: p.gw } as unknown as OpDeps, p.args.projectId, p.args.ownerType, p.callerUserId),
    );
  },
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const { projectId, ownerType, draftKey } = args;
    // The type and size checks come before any read or Storage call.
    const checked = checkUpload(deps, args);
    // R1: the project, the record written about and the caller's open uploads of this kind.
    const [, , mine] = await Promise.all([
      liveProject(ctx, deps),
      gateFor(ctx, deps, ownerType, args.forId, projectId),
      openUploads(deps, projectId, ownerType, ctx.caller.userId),
    ]);
    return presignDraft(ctx, deps, { projectId, ownerType, draftKey, fileName: args.fileName, sizeBytes: args.sizeBytes, checked, mine });
  },
});

const commit = defineOp({
  op: "attachment.commit",
  kind: "command",
  scope: "project",
  permission: "membership",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), talkAttachment(deps, args.projectId, args.attachmentId)]);
    return commitUpload(ctx, deps, row, { attachmentId: args.attachmentId, auditType: AUDIT });
  },
});

const url = defineOp({
  op: "attachment.url",
  kind: "view",
  scope: "project",
  permission: "view",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), talkAttachment(deps, args.projectId, args.attachmentId)]);
    const fileId = str(row, "FileId");
    if (str(row, "Status") !== "ready" || !fileId) return deps.fail("not_found");
    const owner = str(row, "OwnerId");
    if (isDraftOwnerId(owner)) {
      // Another person's unsent draft is not visible.
      if (str(row, "CreatedByUserId") !== ctx.caller.userId) return deps.fail("not_found");
    } else {
      // A sent file is visible with its record (an answer, a change request, a chat message, a feedback ticket).
      await childOf(deps, TALK_OWNER_SCHEMA[row.OwnerType], owner, args.projectId, ["ItemId"]);
    }
    const d = await deps.files.downloadUrl(fileId);
    return { url: d.url, expiresAt: d.expiresAt, opensInline: opensInline(str(row, "Mime")) };
  },
});

const remove = defineOp({
  op: "attachment.delete",
  kind: "command",
  scope: "project",
  permission: "membership",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), talkAttachment(deps, args.projectId, args.attachmentId)]);
    return deleteDraft(ctx, deps, row, { attachmentId: args.attachmentId, auditType: AUDIT, isDraft: isDraftOwnerId(str(row, "OwnerId")) });
  },
});

export const TALK_ATTACHMENT_OPS = [presign, commit, url, remove];
