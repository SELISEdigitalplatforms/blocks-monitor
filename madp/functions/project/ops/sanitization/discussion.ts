import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";
import { fail, fromCheck, gate, ok, notFound, requirePermission, withReads } from "./common";
import { parseComment } from "../../../../src/domain/sanitization";
import { can } from "../../../../src/domain/rbac";
import { FEEDBACK_JOB_TARGET } from "../../../../src/domain/feedback";

type Args = Record<string, unknown>;

async function findThread(ctx: Pick<ReadEnv, "gateway" | "project">) {
  const rows = await ctx.gateway.list(
    "FeedbackThread",
    { ProjectId: ctx.project.ItemId, TargetType: "sanitization", TargetId: ctx.project.ItemId },
    { fields: ["ItemId"], first: 1 },
  );
  return rows[0] ?? null;
}

async function add(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "reachable");
  if (blocked) return blocked;
  const denied = requirePermission(ctx, "comment");
  if (denied) return denied;
  const parsed = parseComment(args.text);
  if (!parsed.ok) return fromCheck(parsed);
  const text = parsed.value;
  const projectId = ctx.project.ItemId;

  const found = await findThread(ctx);
  const commentFields = (threadId: string) => ({
    ProjectId: projectId,
    ThreadId: threadId,
    AuthorUserId: ctx.userId,
    Text: text,
    Kind: "comment",
    At: ctx.now(),
  });
  let threadId: string;
  let comment: Row;
  if (found) {
    threadId = String(found.ItemId);
    comment = (await ctx.gateway.insert("FeedbackComment", commentFields(threadId), "comment")).row;
  } else {
    // The comment needs the new thread's id: both rows go in one round, the comment under a provisional ThreadId
    // (the thread's own request key) that the bookkeeping round replaces.
    const [t, c] = await Promise.allSettled([
      ctx.gateway.insert(
        "FeedbackThread",
        { ProjectId: projectId, TargetType: "sanitization", TargetId: projectId, Status: "open" },
        "thread",
      ),
      ctx.gateway.insert("FeedbackComment", commentFields(ctx.requestKeyOf("thread")), "comment"),
    ]);
    if (c.status === "rejected") throw c.reason;
    comment = c.value.row;
    if (t.status === "fulfilled") {
      threadId = String(t.value.row.ItemId);
    } else {
      if (!ctx.gateway.isDuplicateKey(t.reason)) throw t.reason;
      const again = await findThread(ctx);
      if (!again) throw t.reason;
      threadId = String(again.ItemId);
    }
  }
  if (comment.ThreadId !== threadId) {
    // Also a retry that finds the comment of the first run still on the provisional id.
    const commentId = String(comment.ItemId);
    ctx.after(() => ctx.gateway.patch("FeedbackComment", commentId, { ThreadId: threadId }));
    comment = { ...comment, ThreadId: threadId };
  }
  ctx.audit({ action: "discussion.add", targetType: "comment", targetId: String(comment.ItemId), details: { threadId, length: text.length } });
  // The team answers the discussion (feedback.apply; one active job per thread picks up later comments too).
  const commentId = String(comment.ItemId);
  ctx.after(() =>
    ctx.jobs.create({
      kind: "feedback.apply",
      projectId,
      inputJson: { projectId, threadId, commentId },
      target: { type: FEEDBACK_JOB_TARGET, id: threadId },
    }),
  );
  const data = { threadId, comment };
  return ok(data);
}

/** The reads of discussion.delete (shared with its prefetch); the last one is the existence check remove() makes. */
async function deleteReads(env: ReadEnv, commentId: string) {
  const [comment, thread] = await Promise.all([
    env.gateway.get("FeedbackComment", commentId),
    findThread(env),
    env.gateway.verify("FeedbackComment", commentId),
  ]);
  return [comment, thread] as const;
}

async function del(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "reachable");
  if (blocked) return blocked;
  const manage = can(ctx.permissions, "workspace.manage");
  if (!manage) {
    const denied = requirePermission(ctx, "comment");
    if (denied) return denied;
  }
  const commentId = typeof args.commentId === "string" ? args.commentId : "";
  if (!commentId) return notFound("comment");
  const [comment, thread] = await deleteReads(ctx, commentId);
  if (!comment || comment.ProjectId !== ctx.project.ItemId) return notFound("comment");
  if (!thread || comment.ThreadId !== thread.ItemId) return notFound("comment");
  if (comment.AuthorUserId !== ctx.userId && !manage) {
    return fail("forbidden", "sanitization.notAuthor");
  }
  await ctx.gateway.remove("FeedbackComment", commentId);
  ctx.audit({ action: "discussion.delete", targetType: "comment", targetId: commentId, details: { threadId: String(comment.ThreadId), ownComment: comment.AuthorUserId === ctx.userId, authorUserId: String(comment.AuthorUserId) } });
  return ok({ id: commentId });
}

export const DISCUSSION_OPS: OpTable = {
  // Not recorded: the comment insert is keyed, so a repeat finds the first run's row and answers the same (and finishes a ThreadId patch that failed).
  "discussion.add": withReads(add, { prefetch: (env) => findThread(env), record: () => false }),
  "discussion.delete": withReads(del, {
    prefetch: (env, args) => (typeof args.commentId === "string" && args.commentId ? deleteReads(env, args.commentId) : null),
  }),
};
