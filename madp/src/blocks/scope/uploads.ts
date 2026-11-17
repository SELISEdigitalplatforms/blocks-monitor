// Attachment uploads for scope feedback: presign (function) → PUT bytes straight to Storage (SDK) → commit (function).
// Bytes never pass through a function. A failed presign stops; a failed PUT never commits. The SDK has no progress
// callback, so the states are honest (uploading, ready, rejected, failed) and there are no percentages.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { blocks } from "../client";
import { callFunction } from "../fn";
import { failureText, type AttachmentAnswer, type AttachmentArgs, type CommitAnswer, type PresignAnswer, type PresignArgs } from "./mutations";
import { ATTACHMENT_MAX_PER_COMMENT, attachmentIssue } from "../../domain/scopeFeedback";
import { SCOPE_MESSAGES } from "./messages";
import { STORAGE_UNAVAILABLE_MESSAGE, isStorageUnavailable } from "../../domain/uploads";

export const MAX_CONCURRENT_UPLOADS = 3;
export const MAX_FILES_PER_COMMENT = ATTACHMENT_MAX_PER_COMMENT;

const FALLBACK: Record<string, string> = {
  "attachment.type": "Only PNG, JPEG, WebP or PDF files can be attached.",
  "attachment.size": "Files can be at most 10 MB.",
  "attachment.count": "A comment can have at most 5 files.",
  "attachment.rejected": "This file didn't pass the check, so it wasn't attached. Use a PNG, JPEG, WebP or PDF up to 10 MB.",
};
function text(key: string): string {
  const m = (SCOPE_MESSAGES as Record<string, string | ((p?: Record<string, unknown>) => string) | undefined>)[key];
  return typeof m === "function" ? m() : (m ?? FALLBACK[key]);
}

export interface UploadDeps {
  presign(args: PresignArgs): Promise<PresignAnswer>;
  put(input: { url: string; body: Blob; contentType: string; headers: Record<string, string> }): Promise<void>;
  commit(args: AttachmentArgs): Promise<CommitAnswer>;
  remove(args: AttachmentArgs): Promise<AttachmentAnswer | void>;
}

export const defaultUploadDeps: UploadDeps = {
  presign: async (args) => (await callFunction<PresignAnswer>("project", "scope.attachment.presign", args)).data,
  put: async ({ url, body, contentType, headers }) => {
    await blocks.data.files.uploadToUrl({ url, body, contentType, headers });
  },
  commit: async (args) => (await callFunction<CommitAnswer>("project", "scope.attachment.commit", args)).data,
  remove: async (args) => (await callFunction<AttachmentAnswer>("project", "scope.attachment.delete", args)).data,
};

export type UploadOutcome =
  | { ok: true; attachmentId: string; attachment?: Record<string, unknown> }
  | { ok: false; status: "rejected" | "failed"; reason: string; attachmentId?: string };

export interface UploadTarget {
  projectId: string;
  commentKey: string;
  /** A retry after the bytes arrived: only commit this attachment. */
  resumeAttachmentId?: string;
}

/** Runs one upload to the end. Never throws; the outcome says what happened and why. */
export async function uploadAttachment(file: File, target: UploadTarget, deps: UploadDeps = defaultUploadDeps): Promise<UploadOutcome> {
  const { projectId, commentKey } = target;
  let attachmentId = target.resumeAttachmentId;
  if (!attachmentId) {
    const issue = attachmentIssue({ mime: file.type, sizeBytes: file.size });
    if (issue) return { ok: false, status: "rejected", reason: text(issue) };

    let presign: PresignAnswer;
    try {
      presign = await deps.presign({ projectId, commentKey, fileName: file.name, mime: file.type, sizeBytes: file.size });
    } catch (e) {
      // File storage is off: a retry can never succeed, so this is a refusal, not a failure.
      if (isStorageUnavailable(e)) return { ok: false, status: "rejected", reason: STORAGE_UNAVAILABLE_MESSAGE };
      return { ok: false, status: "failed", reason: failureText(e) };
    }
    attachmentId = presign.attachmentId;

    try {
      await deps.put({ url: presign.uploadUrl, body: file, contentType: file.type, headers: presign.requiredHeaders ?? {} });
    } catch (e) {
      // Never commit after a failed PUT; drop the pending row (the server also cleans stale ones lazily).
      try {
        await deps.remove({ projectId, attachmentId });
      } catch {
        /* best effort */
      }
      return { ok: false, status: "failed", reason: failureText(e) };
    }
  }

  try {
    const res = await deps.commit({ projectId, attachmentId });
    if (res.rejected) return { ok: false, status: "rejected", reason: text("attachment.rejected"), attachmentId };
    return { ok: true, attachmentId, attachment: res.attachment };
  } catch (e) {
    // The bytes are there: a retry only commits.
    return { ok: false, status: "failed", reason: failureText(e), attachmentId };
  }
}

// ---------------------------------------------------------------- queue

export interface UploadItem {
  /** Local id. */
  id: string;
  fileName: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "rejected" | "failed";
  attachmentId?: string;
  reason?: string;
}

export interface UploadQueue {
  getItems(): UploadItem[];
  subscribe(fn: () => void): () => void;
  add(files: File[]): void;
  retry(id: string): void;
  remove(id: string): Promise<void>;
  dispose(): void;
}

interface Entry {
  file: File;
  running: boolean;
  /** Set when the bytes arrived but the commit failed. */
  resume?: string;
  cancelled: boolean;
}

export function createUploadQueue(
  target: { projectId: string; commentKey: string },
  deps: UploadDeps = defaultUploadDeps,
  newId: () => string = () => crypto.randomUUID(),
): UploadQueue {
  let items: UploadItem[] = [];
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const set = (next: UploadItem[]) => {
    items = next;
    for (const l of listeners) l();
  };
  const patch = (id: string, change: Partial<UploadItem>) => set(items.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const pump = () => {
    if (disposed) return;
    for (const item of items) {
      if (items.filter((i) => entries.get(i.id)?.running).length >= MAX_CONCURRENT_UPLOADS) return;
      const entry = entries.get(item.id);
      if (!entry || entry.running || item.status !== "uploading") continue;
      entry.running = true;
      void uploadAttachment(entry.file, { ...target, resumeAttachmentId: entry.resume }, deps).then(async (out) => {
        entry.running = false;
        if (entry.cancelled) {
          if (out.attachmentId) await deps.remove({ projectId: target.projectId, attachmentId: out.attachmentId }).catch(() => undefined);
        } else if (out.ok) {
          patch(item.id, { status: "ready", attachmentId: out.attachmentId, reason: undefined });
        } else {
          entry.resume = out.status === "failed" ? out.attachmentId : undefined;
          patch(item.id, { status: out.status, reason: out.reason, attachmentId: out.attachmentId });
        }
        pump();
      });
    }
  };

  return {
    getItems: () => items,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    add(files) {
      let active = items.filter((i) => i.status !== "rejected").length;
      const added: UploadItem[] = files.map((file) => {
        const id = newId();
        const base = { id, fileName: file.name, sizeBytes: file.size };
        if (active >= MAX_FILES_PER_COMMENT) return { ...base, status: "rejected", reason: text("attachment.count") };
        active++;
        entries.set(id, { file, running: false, cancelled: false });
        return { ...base, status: "uploading" };
      });
      set([...items, ...added]);
      pump();
    },
    retry(id) {
      const item = items.find((i) => i.id === id);
      const entry = entries.get(id);
      if (!item || item.status !== "failed" || !entry) return;
      patch(id, { status: "uploading", reason: undefined });
      pump();
    },
    async remove(id) {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const entry = entries.get(id);
      if (item.status === "uploading" && entry?.running) {
        entry.cancelled = true;
      } else if (item.attachmentId) {
        try {
          await deps.remove({ projectId: target.projectId, attachmentId: item.attachmentId });
        } catch (e) {
          patch(id, { reason: failureText(e) });
          return;
        }
      }
      entries.delete(id);
      set(items.filter((i) => i.id !== id));
      pump();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

export interface CommentUploads {
  items: UploadItem[];
  add(files: File[]): void;
  retry(id: string): void;
  remove(id: string): void;
  /** Attachment ids that are ready to send with the comment. */
  readyIds: string[];
  busy: boolean;
}

const NO_ITEMS: UploadItem[] = [];
const NO_SUBSCRIBE = () => () => undefined;

/** Creates the queue for one comment and hands it over; the cleanup disposes it. Runs inside an effect so that
 *  React StrictMode's mount, cleanup, mount leaves the second queue alive. */
export function mountCommentUploadQueue(
  target: { projectId: string; commentKey: string },
  deps: UploadDeps,
  publish: (q: UploadQueue) => void,
): () => void {
  const q = createUploadQueue(target, deps);
  publish(q);
  return () => q.dispose();
}

/** The uploads of one comment being written. Pass `deps` in tests. */
export function useCommentUploads(projectId: string, commentKey: string, deps: UploadDeps = defaultUploadDeps): CommentUploads {
  const [queue, setQueue] = useState<UploadQueue | null>(null);
  useEffect(() => mountCommentUploadQueue({ projectId, commentKey }, deps, setQueue), [projectId, commentKey, deps]);
  const items = useSyncExternalStore(queue ? queue.subscribe : NO_SUBSCRIBE, queue ? queue.getItems : () => NO_ITEMS, () => NO_ITEMS);
  const add = useCallback((files: File[]) => queue?.add(files), [queue]);
  const retry = useCallback((id: string) => queue?.retry(id), [queue]);
  const remove = useCallback((id: string) => void queue?.remove(id), [queue]);
  return {
    items,
    add,
    retry,
    remove,
    readyIds: items.filter((i) => i.status === "ready" && i.attachmentId).map((i) => i.attachmentId as string),
    busy: items.some((i) => i.status === "uploading"),
  };
}

// ---------------------------------------------------------------- the shared feedback composer

/** The file input's accept list for a scope comment. */
export const SCOPE_FEEDBACK_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

/** Pre-check for the composer (the server decides): a plain sentence, or null when the file may go on. */
export function checkScopeFeedbackFile(file: { type: string; size: number }): string | null {
  const issue = attachmentIssue({ mime: file.type, sizeBytes: file.size });
  return issue ? text(issue) : null;
}

/** The phases the shared feedback composer shows (the same as a requirement comment's upload). */
export interface ScopeFeedbackFileState {
  phase: "checking" | "uploading" | "verifying" | "done" | "failed";
  message?: string;
  attachmentId?: string;
  retryable?: boolean;
}

/** Uploads the files of one scope comment for the shared feedback composer (at most 3 at once, through the scope
 *  attachment ops). Never throws; resolves with the ids of the files that are ready. */
export async function uploadScopeFeedbackFiles(input: {
  projectId: string;
  commentKey: string;
  files: readonly File[];
  onState?: (index: number, state: ScopeFeedbackFileState) => void;
  deps?: UploadDeps;
}): Promise<string[]> {
  const files = input.files.slice(0, MAX_FILES_PER_COMMENT);
  const ids: (string | null)[] = files.map(() => null);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const emit = (s: ScopeFeedbackFileState) => input.onState?.(i, s);
      const refused = checkScopeFeedbackFile(files[i]!);
      if (refused) { emit({ phase: "failed", message: refused, retryable: false }); continue; }
      emit({ phase: "uploading" });
      const out = await uploadAttachment(files[i]!, { projectId: input.projectId, commentKey: input.commentKey }, input.deps ?? defaultUploadDeps);
      if (out.ok) {
        ids[i] = out.attachmentId;
        emit({ phase: "done", attachmentId: out.attachmentId });
      } else {
        emit({ phase: "failed", message: out.reason, attachmentId: out.attachmentId, retryable: out.status === "failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, files.length) }, worker));
  return ids.filter((x): x is string => x !== null);
}

/** Removes a file the person took out of the composer again. Best effort. */
export async function discardScopeFeedbackFile(projectId: string, attachmentId: string, deps: UploadDeps = defaultUploadDeps): Promise<void> {
  try {
    await deps.remove({ projectId, attachmentId });
  } catch {
    // The server removes stale pending rows lazily.
  }
}
