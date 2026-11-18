// The feedback upload pipeline: check (UX only) → SHA-256 → presign → byte PUT → commit, at most 3 files at once.
// The only direct Storage call is the SDK byte PUT to the presigned URL; the URL is never stored or logged.
// The SDK has no progress callback, so the phases are honest states and there are no percentages.
import { blocks } from "../client";
import { callFunction, newRequestId, FunctionError } from "../fn";
import { ACCEPTED_EXTENSIONS, fileTypeFor } from "../../domain/docs";
import { isStorageUnavailable } from "../../domain/uploads";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "../../domain/feedback";
import type { UploadPhase } from "../projects/upload";
import { collabErrorMessage } from "./messages";

export const MAX_CONCURRENT_FEEDBACK_UPLOADS = 3;
const CHECK_MESSAGE = "This file can't be uploaded.";

export interface FeedbackFileState {
  phase: UploadPhase;
  message?: string;
  attachmentId?: string;
  /** False when a retry can never succeed (file storage is not enabled). */
  retryable?: boolean;
}

export interface FeedbackUploadDeps {
  call<T>(op: string, args: Record<string, unknown>): Promise<T>;
  putBytes(input: { url: string; body: Blob; contentType: string; headers: Record<string, string> }): Promise<void>;
  sha256Hex(file: Blob): Promise<string>;
}

export const defaultUploadDeps: FeedbackUploadDeps = {
  call: async <T,>(op: string, args: Record<string, unknown>) => (await callFunction<T>("collab", op, args, { requestId: newRequestId() })).data,
  putBytes: async ({ url, body, contentType, headers }) => {
    await blocks.data.files.uploadToUrl({ url, body, contentType, headers });
  },
  sha256Hex: async (file) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join(""),
};

export interface UploadFeedbackInput {
  projectId: string;
  targetType: string;
  targetId: string;
  draftKey: string;
  files: readonly File[];
  /** Called with the index of the file in `files`. */
  onState?: (index: number, state: FeedbackFileState) => void;
  deps?: Partial<FeedbackUploadDeps>;
}

/** The ops of one upload lane (the comment boxes: feedback.attachment.*; the other places: attachment.*). */
export interface UploadOps {
  presign: string;
  commit: string;
  remove: string;
}
export const FEEDBACK_UPLOAD_OPS: UploadOps = { presign: "feedback.attachment.presign", commit: "feedback.attachment.commit", remove: "feedback.attachment.delete" };

/** One upload run of any lane: `owner` = the presign's arguments that say where the files go (besides the file itself). */
export interface UploadFilesInput {
  projectId: string;
  draftKey: string;
  owner: Record<string, unknown>;
  ops: UploadOps;
  files: readonly File[];
  onState?: (index: number, state: FeedbackFileState) => void;
  deps?: Partial<FeedbackUploadDeps>;
}

interface PresignAnswer {
  attachmentId: string;
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
}
interface CommitAnswer {
  attachment?: { ItemId?: string };
  rejected: string | null;
}

/** Pre-check for the UX; the server decides. Returns a plain message, or null when the file may go on. */
export function checkFeedbackFile(file: { name: string; type: string; size: number }): string | null {
  if (!fileTypeFor(file.name, file.type)) {
    return collabErrorMessage(new FunctionError("invalid_input", "", "", "feedback.typeNotAllowed", { accepted: ACCEPTED_EXTENSIONS }));
  }
  if (file.size > MAX_ATTACHMENT_BYTES) return collabErrorMessage(new FunctionError("too_large", "", "", "feedback.tooLarge"));
  if (file.size <= 0) return CHECK_MESSAGE;
  return null;
}

async function uploadOne(input: UploadFilesInput, deps: FeedbackUploadDeps, file: File, index: number): Promise<string | null> {
  const emit = (state: FeedbackFileState) => input.onState?.(index, state);
  const { projectId, draftKey, ops } = input;

  emit({ phase: "checking" });
  const refused = checkFeedbackFile(file);
  if (refused) {
    emit({ phase: "failed", message: refused });
    return null;
  }
  let sha256: string;
  try {
    sha256 = await deps.sha256Hex(file);
  } catch {
    emit({ phase: "failed", message: CHECK_MESSAGE });
    return null;
  }

  let presign: PresignAnswer;
  try {
    presign = await deps.call<PresignAnswer>(ops.presign, {
      projectId, ...input.owner, draftKey, fileName: file.name, mime: file.type, sizeBytes: file.size, sha256,
    });
  } catch (e) {
    emit({ phase: "failed", message: collabErrorMessage(e), retryable: !isStorageUnavailable(e) });
    return null;
  }

  emit({ phase: "uploading", attachmentId: presign.attachmentId });
  try {
    await deps.putBytes({ url: presign.uploadUrl, body: file, contentType: file.type, headers: presign.requiredHeaders ?? {} });
  } catch (e) {
    try {
      await deps.call(ops.remove, { projectId, attachmentId: presign.attachmentId });
    } catch {
      // Best effort: the server removes stale pending rows on the next upload.
    }
    emit({ phase: "failed", message: collabErrorMessage(e), retryable: !isStorageUnavailable(e) });
    return null;
  }

  emit({ phase: "verifying", attachmentId: presign.attachmentId });
  try {
    const res = await deps.call<CommitAnswer>(ops.commit, { projectId, attachmentId: presign.attachmentId });
    if (res.rejected) {
      emit({ phase: "failed", message: collabErrorMessage(new FunctionError("invalid_input", "", "", res.rejected)) });
      return null;
    }
    emit({ phase: "done", attachmentId: presign.attachmentId });
    return presign.attachmentId;
  } catch (e) {
    emit({ phase: "failed", message: collabErrorMessage(e), attachmentId: presign.attachmentId, retryable: !isStorageUnavailable(e) });
    return null;
  }
}

/** Upload the files of a comment (at most 3 at once). Never throws; resolves with the ids of the files that are ready. */
export function uploadFeedbackFiles(input: UploadFeedbackInput): Promise<string[]> {
  const { targetType, targetId, ...rest } = input;
  return uploadFiles({ ...rest, owner: { targetType, targetId }, ops: FEEDBACK_UPLOAD_OPS });
}

/** Upload the files of any lane (at most 3 at once). Never throws; resolves with the ids of the files that are ready. */
export async function uploadFiles(input: UploadFilesInput): Promise<string[]> {
  const deps: FeedbackUploadDeps = { ...defaultUploadDeps, ...input.deps };
  const files = input.files.slice(0, MAX_ATTACHMENTS);
  const ids: (string | null)[] = files.map(() => null);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      ids[i] = await uploadOne(input, deps, files[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FEEDBACK_UPLOADS, files.length) }, worker));
  return ids.filter((x): x is string => x !== null);
}

/** Remove a draft file the person took out of the composer again. Best effort. */
export async function discardFeedbackFile(projectId: string, attachmentId: string, deps: Partial<FeedbackUploadDeps> = {}, removeOp = FEEDBACK_UPLOAD_OPS.remove): Promise<void> {
  const call = deps.call ?? defaultUploadDeps.call;
  try {
    await call(removeOp, { projectId, attachmentId });
  } catch {
    // The server removes stale pending rows on the next upload.
  }
}
