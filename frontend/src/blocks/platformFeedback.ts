// The platform-wide feedback the bottom-right "Send feedback" bubble sends to the MADP team (internal beta).
// Two writes on the workspace Logic Function: feedback.platform.presign per attached file, then one
// feedback.platform.submit. Bytes never pass through a function: after the presign the browser PUTs them to the
// presigned URL with the SDK (the same PUT as every other attachment lane); the URL is never stored or logged.
import { blocks } from "./client";
import { FunctionError, callFunction, newRequestId } from "./fn";
import { FunctionNotConfiguredError } from "./functions";
import { collabErrorMessage } from "./collab/messages";
import { ACCEPTED_EXTENSIONS, fileTypeFor } from "../domain/docs";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "../domain/feedback";
import { isStorageUnavailable } from "../domain/uploads";
import { t } from "../i18n";

export const PLATFORM_FEEDBACK_FN = "workspace" as const;
export const PLATFORM_FEEDBACK_OPS = {
  presign: "feedback.platform.presign",
  submit: "feedback.platform.submit",
} as const;

export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_DESCRIPTION_MAX = 5000;
export const FEEDBACK_MAX_FILES = MAX_ATTACHMENTS;

/** What the presign hands back under `upload`: exactly what the functions' files.presignUpload returns. */
export interface PlatformUpload {
  fileId: string;
  uploadUrl: string;
  storedName?: string;
  displayName?: string;
  directoryId?: string;
  requiredHeaders?: Record<string, string>;
}
export interface PlatformPresignAnswer {
  fileId: string;
  upload: PlatformUpload;
}
export interface PlatformSubmitAnswer {
  jobId: string;
}

/** A file that reached storage: what submit lists under `files`. */
export interface UploadedFeedbackFile {
  fileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface PlatformFeedbackInput {
  /** One uuid per form: the server de-duplicates a submit sent twice. */
  requestId: string;
  title: string;
  description: string;
  page: { path: string; title: string };
  client: { userAgent: string; viewport: string; language: string };
  files: UploadedFeedbackFile[];
}

export interface PlatformFeedbackDeps {
  call<T>(op: string, args: Record<string, unknown>): Promise<T>;
  putBytes(input: { url: string; body: Blob; contentType: string; headers: Record<string, string> }): Promise<void>;
  sha256Hex(file: Blob): Promise<string>;
}

export const defaultPlatformFeedbackDeps: PlatformFeedbackDeps = {
  call: async <T,>(op: string, args: Record<string, unknown>) =>
    (await callFunction<T>(PLATFORM_FEEDBACK_FN, op, args, { requestId: newRequestId() })).data,
  putBytes: async ({ url, body, contentType, headers }) => {
    await blocks.data.files.uploadToUrl({ url, body, contentType, headers });
  },
  sha256Hex: async (file) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join(""),
};

/** The type the server stores a file as (the first mime of its file type), or null when the type is not accepted. */
export function feedbackMimeOf(file: { name: string; type: string }): string | null {
  return fileTypeFor(file.name, file.type)?.mimes[0] ?? null;
}

/** Pre-check for the UX (the server decides): a plain message, or null when the file may be attached. */
export function checkFeedbackAttachment(file: { name: string; type: string; size: number }): string | null {
  if (!feedbackMimeOf(file)) {
    return t("assistant.feedback.typeNotAllowed", "{name} can't be attached. Accepted files: {accepted}.", { name: file.name, accepted: ACCEPTED_EXTENSIONS });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return t("assistant.feedback.tooLarge", "{name} is larger than {max} MB.", { name: file.name, max: Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024)) });
  }
  if (file.size <= 0) return t("assistant.feedback.emptyFile", "{name} is empty.", { name: file.name });
  return null;
}

/** A calm, plain message for anything that went wrong while sending; never server free text. */
export function platformFeedbackErrorMessage(e: unknown): string {
  if (e instanceof FunctionNotConfiguredError) {
    return t("assistant.feedback.unavailable", "Feedback can't be sent right now. Please try again in a little while.");
  }
  if (isStorageUnavailable(e)) {
    return t("assistant.feedback.storageUnavailable", "Files can't be uploaded right now. Remove them to send your feedback without files, or try again later.");
  }
  if (e instanceof FunctionError) return collabErrorMessage(e);
  return t("assistant.feedback.sendFailed", "Your feedback didn't reach us. Please check your connection and try again.");
}

/** Presign one file, then PUT its bytes to the presigned URL. Throws on any failure (the caller keeps the form). */
export async function uploadFeedbackAttachment(file: File, deps: PlatformFeedbackDeps = defaultPlatformFeedbackDeps): Promise<UploadedFeedbackFile> {
  const mime = feedbackMimeOf(file) ?? file.type;
  let sha256: string | undefined;
  try {
    sha256 = await deps.sha256Hex(file);
  } catch {
    sha256 = undefined; // the checksum is optional
  }
  const presign = await deps.call<PlatformPresignAnswer>(PLATFORM_FEEDBACK_OPS.presign, {
    fileName: file.name, mime, sizeBytes: file.size, ...(sha256 ? { sha256 } : {}),
  });
  await deps.putBytes({ url: presign.upload.uploadUrl, body: file, contentType: mime, headers: presign.upload.requiredHeaders ?? {} });
  return { fileId: presign.fileId, fileName: file.name, mime, sizeBytes: file.size };
}

/** Send the feedback itself (after every file is uploaded). */
export async function submitPlatformFeedback(input: PlatformFeedbackInput, deps: PlatformFeedbackDeps = defaultPlatformFeedbackDeps): Promise<PlatformSubmitAnswer> {
  return deps.call<PlatformSubmitAnswer>(PLATFORM_FEEDBACK_OPS.submit, { ...input });
}

/** The page and browser the feedback was written on. */
export function feedbackContext(): Pick<PlatformFeedbackInput, "page" | "client"> {
  return {
    page: { path: window.location.pathname, title: document.title },
    client: { userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}`, language: navigator.language },
  };
}
