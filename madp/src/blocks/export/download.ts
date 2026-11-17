// Saves the assembled workspace export as a JSON file. Nothing goes into storage, logs or the query string.
import { exportWorkspace, type ExportProgress } from "./workspaceExport";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** madp-factory-export-<slug>-<YYYY-MM-DD>.json (local date). */
export function exportFileName(workspaceName: string, now: Date): string {
  const slug =
    workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "workspace";
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `madp-factory-export-${slug}-${day}.json`;
}

export async function exportWorkspaceToFile(opts: {
  workspaceId: string;
  workspaceName: string;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  now?: () => Date;
}): Promise<{ ok: true; fileName: string } | { ok: false; message: string; aborted?: boolean }> {
  const out = await exportWorkspace({ workspaceId: opts.workspaceId, signal: opts.signal, onProgress: opts.onProgress });
  if (!out.ok) return out.aborted ? { ok: false, message: out.message, aborted: true } : { ok: false, message: out.message };
  const fileName = exportFileName(opts.workspaceName, (opts.now ?? (() => new Date()))());
  const url = URL.createObjectURL(new Blob([JSON.stringify(out.file)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, fileName };
}
