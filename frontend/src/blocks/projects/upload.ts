// The upload pipeline (check → SHA-256 → presign → PUT → commit) and the shared upload queue.
// The only direct Storage call is the SDK byte PUT to the presigned URL; the URL is never stored or logged.
// The SDK has no progress callback, so the phases are honest states and there are no percentages.
import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { blocks } from "../client";
import { FunctionError } from "../fn";
import { isStorageUnavailable } from "../../domain/uploads";
import { fileTypeFor,checkUpload, ACCEPTED_EXTENSIONS } from "../../domain/docs";
import { SCHEMA, fileFromRow, type DocFileRecord } from "./records";
import { useProjectsContext } from "./context";
import { callProjectOp } from "./mutations";
import { messageFor } from "./messages";
import { cacheRow } from "./docMutations";
import { useDocTree, type DocRow } from "./docReads";

export type UploadPhase = "checking" | "uploading" | "verifying" | "done" | "failed";

export interface UploadDeps {
  call<T>(op: string, args: Record<string, unknown>, opts?: { requestId?: string }): Promise<T>;
  putBytes(input: { url: string; body: Blob; contentType: string; headers: Record<string, string> }): Promise<void>;
  /** Lower-case hex SHA-256 (64 characters): the form doc.file.presign and the storage helper accept. */
  sha256Hex(file: Blob): Promise<string>;
}

export type UploadOutcome =
  | { ok: true; file: DocFileRecord; row: DocRow }
  | { ok: false; phase: UploadPhase; message: string; cancelled?: boolean; retryable?: boolean; notUploaded?: boolean };

export const MAX_CONCURRENT_UPLOADS = 3;
export const INCOMPLETE_MESSAGE = "The file didn't arrive complete. Try again.";
const CANCELLED_MESSAGE = "Upload cancelled.";
/** A presign that timed out or was unavailable: nothing was uploaded yet. */
export const NOT_UPLOADED_SLOW = "The server is slow.";
const CHECK_MESSAGE = "This file can't be uploaded.";

const defaultDeps: UploadDeps = {
  call: callProjectOp,
  putBytes: async ({ url, body, contentType, headers }) => {
    await blocks.data.files.uploadToUrl({ url, body, contentType, headers });
  },
  sha256Hex: async (file) => {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

interface PresignAnswer {
  fileId: string;
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
}

/** Run one upload to the end. Never throws; the outcome says where and why it stopped. */
export async function uploadDocFile(
  input: { projectId: string; folderId: string; file: File; usedBytes: number; fileCount: number },
  opts: { onPhase?: (phase: UploadPhase) => void; signal?: AbortSignal } = {},
  overrides: Partial<UploadDeps> = {},
): Promise<UploadOutcome> {
  const deps: UploadDeps = { ...defaultDeps, ...overrides };
  const { projectId, folderId, file } = input;
  const aborted = () => opts.signal?.aborted === true;
  const cancelled = (phase: UploadPhase): UploadOutcome => ({ ok: false, phase, message: CANCELLED_MESSAGE, cancelled: true });
  const cleanup = async (fileId: string): Promise<void> => {
    try {
      await deps.call("doc.file.delete", { projectId, fileId });
    } catch {
      // Best effort: the server removes stale pending rows on the next upload.
    }
  };

  // 1. checking (UX only; the server decides)
  opts.onPhase?.("checking");
  if (!fileTypeFor(file.name, file.type)) {
    const e = new FunctionError("invalid_input", "", "", "doc.typeNotAllowed", { accepted: ACCEPTED_EXTENSIONS });
    return { ok: false, phase: "checking", message: messageFor(e) };
  }
  const verdict = checkUpload({ sizeBytes: file.size, usedBytes: input.usedBytes, fileCount: input.fileCount });
  if (!verdict.ok) {
    return { ok: false, phase: "checking", message: messageFor(new FunctionError(verdict.code, "", "", verdict.messageKey, verdict.params)) };
  }
  if (aborted()) return cancelled("checking");

  let sha256: string;
  try {
    sha256 = await deps.sha256Hex(file);
  } catch {
    return { ok: false, phase: "checking", message: CHECK_MESSAGE };
  }
  if (aborted()) return cancelled("checking");

  // 2. presign (a failure stops here; nothing is sent)
  let presign: PresignAnswer;
  try {
    presign = await deps.call<PresignAnswer>("doc.file.presign", {
      projectId,
      folderId,
      fileName: file.name,
      mime: file.type,
      sizeBytes: file.size,
      sha256,
    });
  } catch (e) {
    if (e instanceof FunctionError && (e.code === "timeout" || e.code === "unavailable")) {
      return { ok: false, phase: "checking", message: NOT_UPLOADED_SLOW, retryable: true, notUploaded: true };
    }
    return { ok: false, phase: "checking", message: messageFor(e), retryable: !isStorageUnavailable(e) };
  }
  if (aborted()) {
    await cleanup(presign.fileId);
    return cancelled("checking");
  }

  // 3. uploading to Storage. Committing the upload (below) queues the MADP engine's reading of the file (file.extract,
  //    doc.file.commit): the file is read on the engine host, never by this browser or the web server.
  opts.onPhase?.("uploading");
  try {
    await deps.putBytes({
      url: presign.uploadUrl,
      body: file,
      contentType: file.type,
      headers: presign.requiredHeaders ?? {},
    });
  } catch (e) {
    await cleanup(presign.fileId);
    return { ok: false, phase: "uploading", message: messageFor(e), retryable: !isStorageUnavailable(e) };
  }
  if (aborted()) {
    await cleanup(presign.fileId);
    return cancelled("uploading");
  }

  // 4. verifying
  opts.onPhase?.("verifying");
  try {
    const res = await deps.call<{ file: DocRow }>("doc.file.commit", { projectId, fileId: presign.fileId });
    opts.onPhase?.("done");
    return { ok: true, file: fileFromRow(res.file), row: res.file };
  } catch (e) {
    const key = (e as { messageKey?: unknown } | null)?.messageKey;
    return {
      ok: false,
      phase: "verifying",
      message: key === "doc.uploadIncomplete" ? INCOMPLETE_MESSAGE : messageFor(e),
      retryable: !isStorageUnavailable(e),
    };
  }
}

// ---------------------------------------------------------------- queue

export interface UploadItem {
  id: string;
  name: string;
  sizeBytes: number;
  folderId: string;
  phase: UploadPhase | "queued";
  message?: string;
  /** False when a retry can never succeed (file storage is not enabled). */
  retryable?: boolean;
  /** True when the failure happened before any byte was sent (a slow presign). */
  notUploaded?: boolean;
}

interface QueueState {
  byProject: Record<string, UploadItem[]>;
}

export const useUploadStore = create<QueueState>(() => ({ byProject: {} }));

/** What the queue needs from the screen that feeds it. */
export interface QueueEnv {
  getUsage(): { usedBytes: number; fileCount: number };
  onDone(row: DocRow): void;
  deps?: Partial<UploadDeps>;
}

interface Job {
  file: File;
  controller: AbortController | null;
}

const jobs = new Map<string, Job>();
const envs = new Map<string, QueueEnv>();
let counter = 0;

function patch(projectId: string, id: string, change: Partial<UploadItem>): void {
  useUploadStore.setState((s) => ({
    byProject: {
      ...s.byProject,
      [projectId]: (s.byProject[projectId] ?? []).map((i) => (i.id === id ? { ...i, ...change } : i)),
    },
  }));
}

function itemsOf(projectId: string): UploadItem[] {
  return useUploadStore.getState().byProject[projectId] ?? [];
}

function pump(projectId: string): void {
  const env = envs.get(projectId);
  if (!env) return;
  for (;;) {
    const items = itemsOf(projectId);
    const running = items.filter((i) => jobs.get(i.id)?.controller && (i.phase === "checking" || i.phase === "uploading" || i.phase === "verifying"));
    if (running.length >= MAX_CONCURRENT_UPLOADS) return;
    const next = items.find((i) => i.phase === "queued");
    if (!next) return;
    const job = jobs.get(next.id);
    if (!job) {
      patch(projectId, next.id, { phase: "failed", message: CHECK_MESSAGE });
      continue;
    }
    job.controller = new AbortController();
    patch(projectId, next.id, { phase: "checking", message: undefined });
    const usage = env.getUsage();
    const others = running.reduce((n, i) => n + i.sizeBytes, 0);
    void uploadDocFile(
      { projectId, folderId: next.folderId, file: job.file, usedBytes: usage.usedBytes + others, fileCount: usage.fileCount + running.length },
      { signal: job.controller.signal, onPhase: (phase) => patch(projectId, next.id, { phase }) },
      env.deps,
    ).then((outcome) => {
      job.controller = null;
      if (outcome.ok) {
        env.onDone(outcome.row);
        jobs.delete(next.id);
        patch(projectId, next.id, { phase: "done", message: undefined });
      } else {
        patch(projectId, next.id, { phase: "failed", message: outcome.message, retryable: outcome.retryable, notUploaded: outcome.notUploaded });
      }
      pump(projectId);
    });
  }
}

export function enqueueUploads(projectId: string, files: File[], folderId: string, env: QueueEnv): void {
  envs.set(projectId, env);
  const added: UploadItem[] = files.map((file) => {
    const id = `up-${++counter}`;
    jobs.set(id, { file, controller: null });
    return { id, name: file.name, sizeBytes: file.size, folderId, phase: "queued" };
  });
  useUploadStore.setState((s) => ({ byProject: { ...s.byProject, [projectId]: [...itemsOf(projectId), ...added] } }));
  pump(projectId);
}

export function retryUpload(projectId: string, id: string): void {
  const item = itemsOf(projectId).find((i) => i.id === id);
  if (!item || item.phase !== "failed" || item.retryable === false || !jobs.has(id)) return;
  patch(projectId, id, { phase: "queued", message: undefined, retryable: undefined, notUploaded: undefined });
  pump(projectId);
}

export function cancelUpload(projectId: string, id: string): void {
  const item = itemsOf(projectId).find((i) => i.id === id);
  if (!item) return;
  const job = jobs.get(id);
  if (job?.controller) {
    job.controller.abort();
    return;
  }
  if (item.phase === "queued") patch(projectId, id, { phase: "failed", message: CANCELLED_MESSAGE });
}

export function removeUpload(projectId: string, id: string): void {
  jobs.get(id)?.controller?.abort();
  jobs.delete(id);
  useUploadStore.setState((s) => ({
    byProject: { ...s.byProject, [projectId]: (s.byProject[projectId] ?? []).filter((i) => i.id !== id) },
  }));
  pump(projectId);
}

/** Test helper: forget every queue. */
export function resetUploadQueues(): void {
  for (const j of jobs.values()) j.controller?.abort();
  jobs.clear();
  envs.clear();
  useUploadStore.setState({ byProject: {} });
}

export function useUploadQueue(projectId: string): {
  items: UploadItem[];
  add: (files: File[], folderId: string) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
} {
  const { workspaceId } = useProjectsContext();
  const tree = useDocTree(projectId);
  const items = useUploadStore((s) => s.byProject[projectId]) ?? NO_ITEMS;
  const usage = useRef({ usedBytes: 0, fileCount: 0 });
  usage.current = { usedBytes: tree.data?.counts.usedBytes ?? 0, fileCount: tree.data?.counts.files ?? 0 };
  const ws = useRef(workspaceId);
  ws.current = workspaceId;
  const env = useRef<QueueEnv>({
    getUsage: () => usage.current,
    onDone: (row) => {
      if (ws.current) cacheRow(ws.current, projectId, SCHEMA.file, row);
    },
  });
  // Keep the latest env bound, so queued uploads finish into the right cache after a remount.
  useEffect(() => {
    if (envs.has(projectId)) envs.set(projectId, env.current);
  }, [projectId]);
  const add = useCallback((files: File[], folderId: string) => enqueueUploads(projectId, files, folderId, env.current), [projectId]);
  return {
    items,
    add,
    retry: useCallback((id: string) => retryUpload(projectId, id), [projectId]),
    cancel: useCallback((id: string) => cancelUpload(projectId, id), [projectId]),
    remove: useCallback((id: string) => removeUpload(projectId, id), [projectId]),
  };
}

const NO_ITEMS: UploadItem[] = [];
