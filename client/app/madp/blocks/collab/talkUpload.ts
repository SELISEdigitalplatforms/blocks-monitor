// The files people attach where they talk to the team (an answer to a question, a change request and its answers, a
// chat message, feedback on a preview): the comment boxes' upload pipeline (feedbackUpload.ts) on the collab ops
// attachment.* (functions/collab/ops/attachments/talk.ts), and the reads of the files once they are sent.
// The send op of each place takes the ready ids + the draftKey and moves the files onto its record.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { blocksAllOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { MAX_TALK_ATTACHMENTS, questionIdOf, type TalkOwnerType } from "../../domain/attachments";
import { checkFeedbackFile, discardFeedbackFile, uploadFiles, type FeedbackFileState, type FeedbackUploadDeps, type UploadOps } from "./feedbackUpload";
import { openAttachment, type OpenDeps } from "./feedback";
import { ATTACHMENT_FIELDS, COLLAB_SCHEMA, toAttachment, type FeedbackAttachmentRecord } from "./records";
import { useCollabContext } from "./context";

export const TALK_UPLOAD_OPS: UploadOps = { presign: "attachment.presign", commit: "attachment.commit", remove: "attachment.delete" };

/** Where the files go: the owner type, and the record the person writes about (the question, the change request, the
 *  milestone; none for a chat message). */
export interface TalkOwner {
  ownerType: TalkOwnerType;
  forId?: string | null;
}

export interface UploadTalkInput extends TalkOwner {
  projectId: string;
  draftKey: string;
  files: readonly File[];
  onState?: (index: number, state: FeedbackFileState) => void;
  deps?: Partial<FeedbackUploadDeps>;
}

/** Upload the files (at most 3 at once). Never throws; resolves with the ids of the files that are ready. */
export function uploadTalkFiles(input: UploadTalkInput): Promise<string[]> {
  const { ownerType, forId, ...rest } = input;
  return uploadFiles({ ...rest, owner: { ownerType, ...(forId ? { forId } : {}) }, ops: TALK_UPLOAD_OPS });
}

/** The same pre-check as the comment boxes (the server decides). */
export const checkTalkFile = checkFeedbackFile;

/** Remove a draft file the person took out again. Best effort. */
export const discardTalkFile = (projectId: string, attachmentId: string, deps: Partial<FeedbackUploadDeps> = {}): Promise<void> =>
  discardFeedbackFile(projectId, attachmentId, deps, TALK_UPLOAD_OPS.remove);

/** Open a sent (or own draft) file with a short-lived link; the link is never kept. */
export const openTalkFile = (projectId: string, a: FeedbackAttachmentRecord, deps: OpenDeps = {}): Promise<void> =>
  openAttachment(projectId, a, { ...deps, urlOp: "attachment.url" });

export const MAX_TALK_FILES = MAX_TALK_ATTACHMENTS;

type Row = { ItemId: string } & Record<string, unknown>;
const w = whereOf<Row>();
const MAX_OWNERS = 200;
/** The sent files' fields: the comment boxes' plus Meta (which answer of a change request a file belongs to). */
const TALK_FIELDS = [...ATTACHMENT_FIELDS, "Meta"] as const;

/** A sent file; `questionId`: the change request's question whose answer it came with (null: the request itself). */
export interface TalkFile extends FeedbackAttachmentRecord { questionId: string | null }

/** The ready files of these owners (one read; the owners are the answers, the requests, the messages, the tickets). */
export function talkAttachmentsQueryOptions(ws: string | null | undefined, projectId: string | null | undefined, ownerType: TalkOwnerType, ownerIds: readonly string[]) {
  const ids = [...new Set(ownerIds.filter(Boolean))].sort().slice(0, MAX_OWNERS);
  const o = blocksAllOptions<Row>(COLLAB_SCHEMA.attachment, {
    workspaceId: ws, fields: TALK_FIELDS,
    where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("OwnerType", ownerType), w.in("OwnerId", ids), w.eq("Status", "ready")),
    sort: [{ field: "CreatedDate", dir: "asc" }],
    maxItems: Math.max(1, ids.length * MAX_TALK_ATTACHMENTS),
  });
  return { ...o, enabled: o.enabled !== false && Boolean(ws) && Boolean(projectId) && ids.length > 0 };
}

/** The files of each owner id (ready files only, oldest first). */
export function selectTalkAttachments(rows: readonly Row[]): Map<string, TalkFile[]> {
  const out = new Map<string, TalkFile[]>();
  for (const r of rows) {
    const a = toAttachment(r);
    if (!a || a.status !== "ready") continue;
    out.set(a.ownerId, [...(out.get(a.ownerId) ?? []), { ...a, questionId: questionIdOf(r.Meta) }]);
  }
  return out;
}

export function useTalkAttachments(projectId: string | null | undefined, ownerType: TalkOwnerType, ownerIds: readonly string[]): UseQueryResult<Map<string, TalkFile[]>, BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({ ...talkAttachmentsQueryOptions(workspaceId, projectId, ownerType, ownerIds), select: selectTalkAttachments });
}
