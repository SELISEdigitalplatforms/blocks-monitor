// Feedback comments and thread status on requirement targets (design 3.2 schemas 20-21, brief item 5).
// Feature, story, screen and milestone threads belong to the scope.feedback.* ops; this lane refuses their targetType.
import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import {
  COMMENT_MAX,
  DECISION_TEXT,
  DRAFT_KEY_PATTERN,
  FEEDBACK_JOB_TARGET,
  FEEDBACK_TARGETS,
  PERSON_THREAD_STATUSES,
  MAX_ATTACHMENTS,
  MAX_COMMENTS_PER_THREAD,
  RESOLVE_PERMISSION,
  TARGET_SCHEMA,
  draftOwnerId,
  feedbackGate,
  isFeedbackTarget,
  isLiveTarget,
  statusAfterComment,
  statusChange,
} from "../../../../src/domain/feedback";
import { projectArgs } from "../common/args";
import { childOf, countOf, listOf, liveProject, topOf } from "../common/loaders";
import { loaderDeps, prefetchChild, warm } from "../wiki/savePath";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, pick, str, strs } from "../common/records";

const attachmentRows = (deps: OpDeps, projectId: string, ids: string[]): Promise<Row[]> =>
  listOf(deps, SCHEMA.attachment, f.and(f.eq("ProjectId", projectId), f.in("ItemId", ids)), ["ItemId", "OwnerType", "OwnerId", "Status", "CreatedByUserId"]);

const gateOf = (project: Row, type: (typeof FEEDBACK_TARGETS)[number]) =>
  feedbackGate(type, { stage: str(project, "Stage"), resumeTo: str(project, "ResumeTo") });

/** Insert one row and give back the row as stored. `created: false` with an id means this RequestKey already wrote it; without an id another request won a natural unique key. */
async function insertRow(deps: OpDeps, schema: string, row: Row, key: string): Promise<{ row: Row; created: boolean; known: boolean }> {
  const res = await deps.gw.insert(schema, row, { key });
  return { row: res.itemId ? { ...row, ItemId: res.itemId } : row, created: res.created, known: !!res.itemId };
}

const threadWhere = (projectId: string, targetType: string, targetId: string) =>
  f.and(f.eq("ProjectId", projectId), f.eq("TargetType", targetType), f.eq("TargetId", targetId));

const addComment = defineOp({
  op: "feedback.comment.add",
  kind: "command",
  scope: "project",
  permission: "comment",
  args: projectArgs({
    targetType: v.enumOf(FEEDBACK_TARGETS),
    targetId: v.id(),
    text: v.string({ min: 1, max: COMMENT_MAX, trim: true }),
    draftKey: v.optional(v.string({ pattern: DRAFT_KEY_PATTERN })),
    attachmentIds: v.optional(v.array(v.id(), { max: MAX_ATTACHMENTS })),
  }),
  prefetch: (p) => {
    const ids = [...new Set(p.args.attachmentIds ?? [])];
    return warm(
      prefetchChild(p, TARGET_SCHEMA[p.args.targetType], p.args.targetId, "ProjectId", p.args.projectId, ["Status"]),
      ids.length > 0 ? attachmentRows(loaderDeps(p), p.args.projectId, ids) : Promise.resolve(),
      topOf(loaderDeps(p), SCHEMA.thread, threadWhere(p.args.projectId, p.args.targetType, p.args.targetId), [...FIELDS.thread], 1),
    );
  },
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const { projectId, targetType, targetId, text } = args;
    const ids = [...new Set(args.attachmentIds ?? [])];
    if (ids.length > 0 && !args.draftKey) return deps.fail("invalid_input", undefined, { field: "draftKey", rule: "required" });
    const mine = f.eq("ProjectId", projectId);

    // R1: project, target, attachments and the thread, in parallel.
    const [project, target, found, threads] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, TARGET_SCHEMA[targetType], targetId, projectId, ["Status"]),
      ids.length > 0 ? attachmentRows(deps, projectId, ids) : Promise.resolve([] as Row[]),
      topOf(deps, SCHEMA.thread, threadWhere(projectId, targetType, targetId), [...FIELDS.thread], 1),
    ]);
    if (!isLiveTarget(targetType, target)) return deps.fail("not_found");
    const gate = gateOf(project, targetType);
    if (!gate.open) return deps.fail("conflict", MSG.feedbackClosed, { reason: gate.reason });

    // Attachments: the caller's own ready uploads of this draft; on a retry they may already belong to the caller's comment.
    const draftOwner = args.draftKey ? draftOwnerId(args.draftKey) : "";
    const byId = new Map(found.map((r) => [str(r, "ItemId"), r]));
    const baseOk = (r: Row | undefined): r is Row =>
      !!r && str(r, "OwnerType") === "feedback-comment" && str(r, "Status") === "ready" && str(r, "CreatedByUserId") === ctx.caller.userId;
    const notDraft: Row[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!baseOk(row)) return deps.fail("invalid_input", MSG.attachmentNotReady);
      if (str(row, "OwnerId") !== draftOwner) notDraft.push(row);
    }
    const checkOwners = async (): Promise<void> => {
      if (notDraft.length === 0) return;
      const comments = await listOf(deps, SCHEMA.comment, f.and(mine, f.in("ItemId", [...new Set(notDraft.map((r) => str(r, "OwnerId")))])), [
        "ItemId",
        "AuthorUserId",
        "AttachmentIds",
      ]);
      for (const row of notDraft) {
        const owner = comments.find((c) => str(c, "ItemId") === str(row, "OwnerId"));
        if (!owner || str(owner, "AuthorUserId") !== ctx.caller.userId || !strs(owner, "AttachmentIds").includes(str(row, "ItemId"))) {
          return deps.fail("invalid_input", MSG.attachmentNotReady);
        }
      }
    };

    // Only a retry has attachments that are already owned: they are checked before anything is written.
    await checkOwners();

    // R2 (one round): the comment is written next to the checks that gate it. A first comment creates the thread in the
    // same round, so the comment carries a provisional ThreadId (the thread's RequestKey) that the closing writes replace.
    const commentRow = (threadId: string): Row => ({
      ProjectId: projectId,
      ThreadId: threadId,
      AuthorUserId: ctx.caller.userId,
      Kind: "comment",
      Text: text,
      AttachmentIds: ids,
      At: ctx.now.toISOString(),
    });
    let thread: Row;
    // A person's comment is work for the team: a resolved or updated thread is open again (a running job stays "working").
    let reopen: boolean;
    let made: { row: Row; created: boolean };
    let threadKnown = true;
    if (threads[0]) {
      thread = threads[0];
      const threadId = str(thread, "ItemId");
      reopen = statusAfterComment(str(thread, "Status")) !== str(thread, "Status");
      // The count is requested first; a comment that turns out to be over the limit is removed again.
      const [count, inserted] = await Promise.all([
        countOf(deps, SCHEMA.comment, f.eq("ThreadId", threadId)),
        insertRow(deps, SCHEMA.comment, commentRow(threadId), "comment"),
      ]);
      made = inserted;
      // A retry of a comment that is already stored counts itself.
      if (count >= MAX_COMMENTS_PER_THREAD && made.created) {
        await deps.gw.remove(SCHEMA.comment, str(made.row, "ItemId")).catch(() => undefined);
        return deps.fail("limit_reached", MSG.tooManyComments, { max: MAX_COMMENTS_PER_THREAD });
      }
    } else {
      const threadRow: Row = { ProjectId: projectId, TargetType: targetType, TargetId: targetId, Status: "open" };
      const [t, inserted] = await Promise.all([
        insertRow(deps, SCHEMA.thread, threadRow, "thread"),
        insertRow(deps, SCHEMA.comment, commentRow(deps.ids.local("thread")), "comment"),
      ]);
      made = inserted;
      thread = t.row;
      reopen = false;
      if (!t.known) {
        // Another request won the unique key: take its thread.
        const winner = (await topOf(deps, SCHEMA.thread, threadWhere(projectId, targetType, targetId), [...FIELDS.thread], 1))[0];
        if (!winner) return deps.fail("conflict");
        thread = winner;
        reopen = statusAfterComment(str(winner, "Status")) !== str(winner, "Status");
      }
      threadKnown = false;
    }
    const threadId = str(thread, "ItemId");
    const commentId = str(made.row, "ItemId");
    if (!commentId) return deps.fail("conflict");
    const owned = found.filter((r) => ids.includes(str(r, "ItemId")));
    const toOwn = owned.filter((r) => str(r, "OwnerId") !== commentId);
    const status = statusAfterComment(str(thread, "Status"));
    // The closing writes share the router's last round: the thread id on a first comment, the attachment owners, the
    // reopening, and the team's job on this thread (feedback.apply; one active job per thread: a comment that arrives
    // while it runs is picked up by that job before it ends).
    deps.after(async () => {
      await Promise.all([
        ...(threadKnown && made.created ? [] : [deps.gw.update(SCHEMA.comment, commentId, { ThreadId: threadId })]),
        ...toOwn.map((r) => deps.gw.update(SCHEMA.attachment, str(r, "ItemId"), { OwnerId: commentId })),
        ...(reopen ? [deps.gw.update(SCHEMA.thread, threadId, { Status: status })] : []),
        deps.jobs.create({
          kind: "feedback.apply",
          projectId,
          input: { projectId, threadId, commentId },
          targetType: FEEDBACK_JOB_TARGET,
          targetId: threadId,
          // one job per comment (a retried request finds the same job)
          eventKey: `feedback.apply:${commentId}`,
        }),
      ]);
    });
    deps.audit({ targetType: "feedback-thread", targetId: threadId, details: { commentId, kind: "comment" } });
    return {
      thread: pick({ ...thread, Status: status }, FIELDS.thread),
      comment: pick({ ...made.row, ThreadId: threadId }, FIELDS.comment),
      attachments: owned.map((r) => pick({ ...r, OwnerId: commentId }, FIELDS.attachment)),
    };
  },
});

const setStatus = defineOp({
  op: "feedback.thread.setStatus",
  kind: "command",
  scope: "project",
  permission: "membership",
  // status: what a person may set (reopen, or accept and close); decision: what they did with the team's suggestion.
  args: projectArgs({ threadId: v.id(), status: v.enumOf(PERSON_THREAD_STATUSES), decision: v.optional(v.enumOf(["applied", "kept"] as const)) }),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const [project, thread] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, SCHEMA.thread, args.threadId, args.projectId, [...FIELDS.thread]),
    ]);
    const type = str(thread, "TargetType");
    if (!isFeedbackTarget(type)) return deps.fail("invalid_input", undefined, { field: "targetType", rule: "enum" });
    // The item's editors may close or reopen any thread; a person who commented in it may close their own thread.
    if (!ctx.permissions.includes(RESOLVE_PERMISSION[type])) {
      const mine = await countOf(deps, SCHEMA.comment, f.and(f.eq("ThreadId", args.threadId), f.eq("AuthorUserId", ctx.caller.userId)));
      if (mine === 0 || args.status !== "resolved") return deps.fail("forbidden");
    }
    // Closing a thread changes nothing on the item, so it stays possible after the requirements are confirmed.
    const gate = gateOf(project, type);
    if (!gate.open && !(args.status === "resolved" && gate.reason === "requirementsConfirmed")) {
      return deps.fail("conflict", MSG.feedbackClosed, { reason: gate.reason });
    }
    const current = str(thread, "Status") || "open";
    if (statusChange(current, args.status) === "noop" && !args.decision) return { thread: pick(thread, FIELDS.thread) };
    const decision = args.decision ?? (args.status === "resolved" ? "accepted" : "reopened");
    // The decision is written into the thread as a system entry (who, when, what), next to the status.
    deps.after(async () => {
      await Promise.all([
        deps.gw.update(SCHEMA.thread, args.threadId, { Status: args.status }),
        deps.gw.insert(
          SCHEMA.comment,
          {
            ProjectId: args.projectId,
            ThreadId: args.threadId,
            AuthorUserId: ctx.caller.userId,
            Kind: "system",
            Text: DECISION_TEXT[decision],
            AttachmentIds: [],
            At: ctx.now.toISOString(),
          },
          { key: "decision" },
        ),
      ]);
    });
    deps.audit({ targetType: "feedback-thread", targetId: args.threadId, details: { from: current, to: args.status, decision } });
    return { thread: pick({ ...thread, Status: args.status, UpdatedByUserId: ctx.caller.userId }, FIELDS.thread) };
  },
});

export const FEEDBACK_COMMENT_OPS = [addComment, setStatus];
