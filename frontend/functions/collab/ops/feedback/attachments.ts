// Feedback attachments on Blocks Storage: presign, commit, url, delete (design 5, brief item 5).
// The pipeline itself (checks, pending row, presign, commit by size + magic bytes, draft removal) is common/uploads.ts,
// shared with the files of answers, change requests, chat messages and preview feedback (attachments/talk.ts).
import { defineOp, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import {
  DRAFT_KEY_PATTERN,
  FEEDBACK_TARGETS,
  TARGET_SCHEMA,
  feedbackGate,
  isDraftOwnerId,
  isLiveTarget,
  opensInline,
} from "../../../../src/domain/feedback";
import { projectArgs } from "../common/args";
import { childOf, liveProject } from "../common/loaders";
import { MSG } from "../common/messages";
import { prefetchChild, warm } from "../wiki/savePath";
import { SCHEMA, str } from "../common/records";
import { OWN_FIELDS, checkUpload, commitUpload, deleteDraft, openUploads, presignDraft, shaArg } from "../common/uploads";

const OWNER = "feedback-comment";

/** An attachment of this project owned by a feedback comment (or draft); anything else is not_found. */
async function feedbackAttachment(deps: OpDeps, projectId: string, id: string): Promise<Row> {
  const row = await childOf(deps, SCHEMA.attachment, id, projectId, OWN_FIELDS);
  if (str(row, "OwnerType") !== OWNER) return deps.fail("not_found");
  return row;
}

const prefetchOwn = (p: Parameters<typeof prefetchChild>[0], projectId: string, id: string): Promise<unknown> =>
  warm(prefetchChild(p, SCHEMA.attachment, id, "ProjectId", projectId, OWN_FIELDS));

const presign = defineOp({
  op: "feedback.attachment.presign",
  kind: "command",
  scope: "project",
  permission: "comment",
  args: projectArgs({
    targetType: v.enumOf(FEEDBACK_TARGETS),
    targetId: v.id(),
    draftKey: v.string({ pattern: DRAFT_KEY_PATTERN }),
    fileName: v.string({ min: 1, max: 255 }),
    mime: v.string({ min: 1, max: 100 }),
    sizeBytes: v.int({ min: 1 }),
    sha256: shaArg(),
  }),
  prefetch: (p) =>
    warm(
      prefetchChild(p, TARGET_SCHEMA[p.args.targetType], p.args.targetId, "ProjectId", p.args.projectId, ["Status"]),
      openUploads({ gw: p.gw } as unknown as OpDeps, p.args.projectId, OWNER, p.callerUserId),
    ),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const { projectId, targetType, targetId, draftKey } = args;
    // The type and size checks come before any read or Storage call.
    const checked = checkUpload(deps, args);

    // R1: project, target and the caller's open feedback attachments.
    const [project, target, mine] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, TARGET_SCHEMA[targetType], targetId, projectId, ["Status"]),
      openUploads(deps, projectId, OWNER, ctx.caller.userId),
    ]);
    if (!isLiveTarget(targetType, target)) return deps.fail("not_found");
    const gate = feedbackGate(targetType, { stage: str(project, "Stage"), resumeTo: str(project, "ResumeTo") });
    if (!gate.open) return deps.fail("conflict", MSG.feedbackClosed, { reason: gate.reason });

    return presignDraft(ctx, deps, { projectId, ownerType: OWNER, draftKey, fileName: args.fileName, sizeBytes: args.sizeBytes, checked, mine });
  },
});

const commit = defineOp({
  op: "feedback.attachment.commit",
  kind: "command",
  scope: "project",
  permission: "comment",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), feedbackAttachment(deps, args.projectId, args.attachmentId)]);
    return commitUpload(ctx, deps, row, { attachmentId: args.attachmentId, auditType: "feedback-attachment" });
  },
});

const url = defineOp({
  op: "feedback.attachment.url",
  kind: "view",
  scope: "project",
  permission: "view",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), feedbackAttachment(deps, args.projectId, args.attachmentId)]);
    const fileId = str(row, "FileId");
    if (str(row, "Status") !== "ready" || !fileId) return deps.fail("not_found");
    const owner = str(row, "OwnerId");
    if (isDraftOwnerId(owner)) {
      // Another person's unsent draft is not visible.
      if (str(row, "CreatedByUserId") !== ctx.caller.userId) return deps.fail("not_found");
    } else {
      await childOf(deps, SCHEMA.comment, owner, args.projectId, ["ItemId"]);
    }
    const d = await deps.files.downloadUrl(fileId);
    return { url: d.url, expiresAt: d.expiresAt, opensInline: opensInline(str(row, "Mime")) };
  },
});

const remove = defineOp({
  op: "feedback.attachment.delete",
  kind: "command",
  scope: "project",
  permission: "comment",
  args: projectArgs({ attachmentId: v.id() }),
  prefetch: (p) => prefetchOwn(p, p.args.projectId, p.args.attachmentId),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [, row] = await Promise.all([liveProject(ctx, deps), feedbackAttachment(deps, args.projectId, args.attachmentId)]);
    return deleteDraft(ctx, deps, row, { attachmentId: args.attachmentId, auditType: "feedback-attachment", isDraft: isDraftOwnerId(str(row, "OwnerId")) });
  },
});

export const FEEDBACK_ATTACHMENT_OPS = [presign, commit, url, remove];
