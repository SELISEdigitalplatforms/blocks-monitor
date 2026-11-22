// Feedback threads (one per target), their comments and comment attachments, written in the ops' order: the files are
// uploaded under a draft owner, the comment lists them, then they are moved to the comment (feedback.comment.add).
import { draftOwnerId } from "../../src/domain/feedback";
import { storedNameOf } from "../core/files";
import type { CommentPlan } from "../model";
import { row, t, u, type Ctx } from "./ctx";

export type ThreadTarget =
  | "requirement" | "feature" | "story" | "screen" | "objective" | "acceptance" | "milestone" | "clarification" | "decision" | "tech-decision" | "sanitization";

export async function seedThread(
  c: Ctx,
  local: string,
  target: { type: ThreadTarget; id: string },
  comments: readonly CommentPlan[],
  resolved = false,
): Promise<string> {
  if (comments.length === 0) throw new Error(`seed: thread ${local} has no comments`);
  const first = comments[0]!;
  const last = comments[comments.length - 1]!;
  const threadId = await row(
    c,
    "FeedbackThread",
    `thread-${local}`,
    { TargetType: target.type, TargetId: target.id, Status: resolved ? "resolved" : "open" },
    { by: first.by, at: t(c, first.at), updatedAt: t(c, last.at), updatedBy: last.by },
  );
  for (const [i, cm] of comments.entries()) {
    const at = t(c, cm.at);
    const attachmentIds: string[] = [];
    const draft = draftOwnerId(`${local}-${i}`);
    for (const [j, spec] of (cm.files ?? []).entries()) {
      const f = await c.s.file(spec);
      attachmentIds.push(
        await row(
          c,
          "Attachment",
          `att-${local}-${i}-${j}`,
          {
            OwnerType: "feedback-comment",
            OwnerId: draft,
            FileId: f.fileId,
            FileName: f.name,
            StoredName: storedNameOf(f.name, f.ext),
            Kind: f.kind === "image" ? "image" : "pdf",
            Mime: f.mime,
            SizeBytes: f.bytes.length,
            Origin: "upload",
            Meta: "",
            Status: "ready",
          },
          { by: cm.by, at },
        ),
      );
    }
    const commentId = await row(
      c,
      "FeedbackComment",
      `comment-${local}-${i}`,
      { ThreadId: threadId, AuthorUserId: u(c, cm.by), Kind: cm.system ? "system" : "comment", Text: cm.text, AttachmentIds: attachmentIds, At: at },
      { by: cm.by, at },
    );
    for (const id of attachmentIds) await c.s.update("Attachment", id, { OwnerId: commentId }, at);
  }
  return threadId;
}
