// Workspace export client: pages the server view op `workspace.export` and assembles one JSON file in memory.
import { FunctionError, callFunction, functionErrorMessage, newRequestId } from "../fn";
import { FunctionNotConfiguredError } from "../functions";
import {
  EXPORT_MAX_TOTAL_BYTES,
  assembleExport,
  exportProgress,
  jsonBytes,
  validateExportPage,
  type ExportFile,
  type ExportPage,
} from "../../domain/workspaceExport";

export const EXPORT_MESSAGES = {
  unreadable: "The export could not be read. Try again.",
  notConfigured: "Export isn't available yet.",
  tooLarge: "This workspace is too large to export as one file.",
  aborted: "The export was stopped.",
};

export interface ExportProgress {
  done: number;
  total: number;
}

export type ExportOutcome = { ok: true; file: ExportFile; bytes: number } | { ok: false; message: string; aborted?: boolean };

const MAX_PAGES = 10_000;
const CURSOR = /^v1\.(\d+)\.(\d+)\.(\d+)$/;

function position(cursor: string): [number, number, number] | null {
  const m = CURSOR.exec(cursor);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `next` is strictly ahead of `prev` (schemaIndex, gatewayPage, offset). */
function advances(prev: string | null, next: string): boolean {
  const n = position(next);
  if (!n) return false;
  if (prev === null) return true;
  const p = position(prev);
  if (!p) return false;
  for (let i = 0; i < 3; i++) {
    if (n[i] !== p[i]) return n[i] > p[i];
  }
  return false;
}

function failure(message: string, aborted?: boolean): ExportOutcome {
  return aborted ? { ok: false, message, aborted: true } : { ok: false, message };
}

function errorMessage(err: unknown): string {
  if (err instanceof FunctionNotConfiguredError) return EXPORT_MESSAGES.notConfigured;
  if (err instanceof FunctionError) return functionErrorMessage(err.code);
  return EXPORT_MESSAGES.unreadable;
}

export async function exportWorkspace(opts: {
  workspaceId: string;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}): Promise<ExportOutcome> {
  const { workspaceId, signal, onProgress } = opts;
  onProgress?.(exportProgress(null));
  const pages: ExportPage[] = [];
  let cursor: string | null = null;
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) return failure(EXPORT_MESSAGES.aborted, true);
      if (pages.length >= MAX_PAGES) return failure(EXPORT_MESSAGES.unreadable);
      const args: Record<string, unknown> = cursor === null ? { workspaceId } : { workspaceId, cursor };
      const res = await callFunction<unknown>("workspace", "workspace.export", args, { requestId: newRequestId() });
      const page = validateExportPage(res.data);
      if (!page) return failure(EXPORT_MESSAGES.unreadable);
      if (pages.length === 0 && (!page.workspace || !page.exportedAt)) return failure(EXPORT_MESSAGES.unreadable);
      if (page.cursor !== null && !advances(cursor, page.cursor)) return failure(EXPORT_MESSAGES.unreadable);
      total += jsonBytes(page);
      if (total > EXPORT_MAX_TOTAL_BYTES) return failure(EXPORT_MESSAGES.tooLarge);
      pages.push(page);
      onProgress?.(exportProgress(page.cursor));
      if (page.cursor === null) break;
      cursor = page.cursor;
    }
    const file = assembleExport(pages);
    if (!file) return failure(EXPORT_MESSAGES.unreadable);
    return { ok: true, file, bytes: total };
  } catch (err) {
    return failure(errorMessage(err));
  }
}
