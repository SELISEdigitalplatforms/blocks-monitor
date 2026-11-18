// Sample upload pipeline: presign (function) → PUT straight to Storage (official SDK) → commit (function).
// Bytes never pass through a function and the browser holds no write rights: every record write is a Logic Function op.
// A failed PUT is never committed. At most 3 uploads run at once.
import { useMemo, useRef, useState } from "react";
import { blocks } from "../client";
import { callFunction, FunctionError } from "../fn";
import { queryClient } from "../queryClient";
import { checkSampleUpload } from "@/madp/domain/designBrief";
import { STORAGE_UNAVAILABLE_MESSAGE, isStorageUnavailable } from "@/madp/domain/uploads";
import { applyAnswer, type CommitAnswer, type PresignAnswer } from "./mutations";
import { useActiveWorkspaceId } from "./context";
import type { ChangedRows } from "./records";

export type UploadState = "queued" | "uploading" | "committing" | "ready" | "rejected" | "failed";

export interface UploadItem {
  localId: string;
  fileName: string;
  sizeBytes: number;
  mime: string;
  state: UploadState;
  attachmentId: string | null;
  reason: string | null;
  /** our own mapped text of a failed step (never server free text); null otherwise */
  message: string | null;
}

export interface UploadDeps {
  presign(a: { fileName: string; mime: string; sizeBytes: number }): Promise<PresignAnswer>;
  put(a: { url: string; body: Blob; contentType: string; headers: Record<string, string> }): Promise<void>;
  commit(attachmentId: string): Promise<CommitAnswer>;
  onAnswer?(a: { changed?: ChangedRows }): void;
  /** UX-only pre-check (the server re-checks): a reason string refuses the file before any network call. */
  precheck?(file: { fileName: string; mime: string; sizeBytes: number }): string | null;
}

export type UploadFile = Blob & { name: string; type: string; size: number };

export const UPLOAD_CONCURRENCY = 3;

function failMessage(e: unknown): string | null {
  return e instanceof FunctionError && e.message ? e.message : null;
}

/** The failed-step patch: a storage refusal gets reason "storage" (never retried), anything else the step's own reason. */
function failedPatch(e: unknown, step: string): Partial<UploadItem> {
  if (isStorageUnavailable(e)) return { state: "failed", reason: "storage", message: STORAGE_UNAVAILABLE_MESSAGE };
  return { state: "failed", reason: step, message: failMessage(e) };
}

export async function runUpload(file: UploadFile, deps: UploadDeps, onState: (item: UploadItem) => void, localId = file.name): Promise<UploadItem> {
  let item: UploadItem = {
    localId,
    fileName: file.name,
    sizeBytes: file.size,
    mime: file.type,
    state: "queued",
    attachmentId: null,
    reason: null,
    message: null,
  };
  const set = (patch: Partial<UploadItem>) => {
    item = { ...item, ...patch };
    onState(item);
  };
  const info = { fileName: file.name, mime: file.type, sizeBytes: file.size };

  const refused = deps.precheck?.(info) ?? null;
  if (refused) {
    set({ state: "rejected", reason: refused });
    return item;
  }

  set({ state: "uploading" });
  let presigned: PresignAnswer;
  try {
    presigned = await deps.presign(info);
  } catch (e) {
    set(failedPatch(e, "presign"));
    return item;
  }
  deps.onAnswer?.(presigned);
  set({ attachmentId: presigned.attachmentId });

  try {
    await deps.put({ url: presigned.uploadUrl, body: file, contentType: file.type, headers: presigned.requiredHeaders });
  } catch (e) {
    set(failedPatch(e, "upload")); // never committed
    return item;
  }

  set({ state: "committing" });
  try {
    const done = await deps.commit(presigned.attachmentId);
    deps.onAnswer?.(done);
    if (done.status === "ready") set({ state: "ready", reason: null });
    else set({ state: "rejected", reason: done.reason });
  } catch (e) {
    set(failedPatch(e, "commit"));
  }
  return item;
}

export interface UploadQueue {
  add(files: File[]): void;
  retry(localId: string): void;
  items(): UploadItem[];
  busy(): boolean;
}

export function createUploadQueue(deps: UploadDeps, opts: { concurrency?: number; onChange: (items: UploadItem[]) => void }): UploadQueue {
  const limit = opts.concurrency ?? UPLOAD_CONCURRENCY;
  let list: UploadItem[] = [];
  const files = new Map<string, UploadFile>();
  const waiting: string[] = [];
  let running = 0;
  let seq = 0;

  const emit = () => opts.onChange(list);
  const update = (item: UploadItem) => {
    list = list.map((x) => (x.localId === item.localId ? item : x));
    emit();
  };

  function pump(): void {
    while (running < limit && waiting.length > 0) {
      const id = waiting.shift() as string;
      const file = files.get(id);
      if (!file) continue;
      running++;
      void runUpload(file, deps, update, id).finally(() => {
        running--;
        emit();
        pump();
      });
    }
  }

  function enqueue(id: string): void {
    const current = list.find((x) => x.localId === id);
    if (current) update({ ...current, state: "queued", reason: null, message: null, attachmentId: null });
    waiting.push(id);
    pump();
  }

  return {
    add(added) {
      for (const f of added) {
        const localId = `u${++seq}`;
        files.set(localId, f);
        list = [...list, { localId, fileName: f.name, sizeBytes: f.size, mime: f.type, state: "queued", attachmentId: null, reason: null, message: null }];
        waiting.push(localId);
      }
      emit();
      pump();
    },
    retry(localId) {
      const item = list.find((x) => x.localId === localId);
      if (!item || (item.state !== "failed" && item.state !== "rejected") || item.reason === "storage" || !files.has(localId)) return;
      enqueue(localId);
    },
    items: () => list,
    busy: () => list.some((x) => x.state === "queued" || x.state === "uploading" || x.state === "committing"),
  };
}

/** UX pre-check from the pure rules; a non-null result is a short reason. The server re-checks everything. */
function precheckFromRules(f: { mime: string; sizeBytes: number }, current: readonly UploadItem[]): string | null {
  const existing = current
    .filter((x) => x.state !== "failed" && x.state !== "rejected")
    .map((x) => ({ sizeBytes: x.sizeBytes, status: x.state === "ready" ? "ready" : "pending" }));
  const r = checkSampleUpload({ mime: f.mime, sizeBytes: f.sizeBytes, existing });
  return r.ok ? null : r.reason;
}

export function useSampleUploads(projectId: string): {
  items: UploadItem[];
  add: (files: File[]) => void;
  retry: (localId: string) => void;
  busy: boolean;
} {
  const ws = useActiveWorkspaceId();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const queue = useMemo(
    () =>
      createUploadQueue(
        {
          presign: async (a) => (await callFunction<PresignAnswer>("project", "sample.presign", { projectId, ...a })).data,
          put: async ({ url, body, contentType, headers }) => {
            await blocks.data.files.uploadToUrl({ url, body, contentType, headers });
          },
          commit: async (attachmentId) => (await callFunction<CommitAnswer>("project", "sample.commit", { projectId, attachmentId })).data,
          onAnswer: (a) => {
            if (wsRef.current) applyAnswer(queryClient, wsRef.current, projectId, a);
          },
          precheck: (f) => precheckFromRules(f, itemsRef.current.filter((x) => x.reason !== "limit")),
        },
        { onChange: (list) => setItems([...list]) },
      ),
    [projectId],
  );
  return { items, add: queue.add, retry: queue.retry, busy: items.some((x) => x.state === "queued" || x.state === "uploading" || x.state === "committing") };
}
