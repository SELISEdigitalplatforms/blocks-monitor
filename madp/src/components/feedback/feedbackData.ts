/** Thread reads for the feedback UI. A Blocks project (route /p/:id) has its threads on SELISE Blocks (requirements and
 *  scope items alike, in the same FeedbackThread rows); anything else has none. */
import { useMemo } from "react";
import type { CommentKind, FeedbackComment, FeedbackTargetType, FeedbackThread } from "@/data/feedback";
import { useProjectCommentStats, useProjectThreads, useThreadComments } from "@/blocks/collab/feedback";
import { useRouteBlocksProjectId } from "@/blocks/collab/context";
import { COMMENT_KINDS, threadKey } from "../../domain/feedback";

const kindOf = (k: string): CommentKind => ((COMMENT_KINDS as readonly string[]).includes(k) ? (k as CommentKind) : "comment");

/** The thread of one item mapped to the legacy shape (comments carry the author's id, not a name), or null. */
export function useThread(type: FeedbackTargetType, targetId: string): FeedbackThread | null {
  const projectId = useRouteBlocksProjectId();
  const threads = useProjectThreads(projectId).data;
  const thread = threads?.get(threadKey(type, targetId)) ?? null;
  const comments = useThreadComments(projectId, thread?.id).data;
  return useMemo<FeedbackThread | null>(() => {
    if (!thread || !projectId) return null;
    const list: FeedbackComment[] = (comments ?? []).map((c) => ({
      id: c.id, threadId: c.threadId, author: c.authorUserId, text: c.text,
      kind: kindOf(c.kind), createdAt: c.at, attachments: [],
    }));
    return { id: thread.id, projectId, targetType: type, targetId, status: thread.status, createdAt: thread.updatedAt, comments: list };
  }, [thread, comments, projectId, type, targetId]);
}

export interface ThreadBadge {
  /** People's comments only (the team's replies and recorded events are not counted). */
  count: number;
  /** Accepted and closed. */
  resolved: boolean;
  /** The team is working on it. */
  working: boolean;
  /** The team answered or changed the item and waits for the person. */
  updated: boolean;
}

/** The comment count and status that the item's button shows, from the slim comment rows. */
export function useThreadBadge(type: FeedbackTargetType, targetId: string): ThreadBadge {
  const projectId = useRouteBlocksProjectId();
  const threads = useProjectThreads(projectId).data;
  const stats = useProjectCommentStats(projectId).data;
  const thread = threads?.get(threadKey(type, targetId)) ?? null;
  const status = thread?.status;
  return {
    count: thread ? stats?.get(thread.id)?.comments ?? 0 : 0,
    resolved: status === "resolved", working: status === "working", updated: status === "updated",
  };
}
