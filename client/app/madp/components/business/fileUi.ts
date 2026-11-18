/** Pure display rules for business files (no DOM, no network). */
import { t } from "@/madp/i18n";

export type OpenMode = "inline-image" | "open" | "download";
export type UploadPhase = "queued" | "checking" | "uploading" | "verifying" | "done" | "failed";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const OPEN_EXT = new Set(["pdf", "txt", "md", "csv"]);
const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md", "text/csv": "csv",
};

/** Lower-case extension of a display name ("" when none). */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
}

/** "840 KB" / "1.2 MB" (decimal units, one decimal only from MB up). */
export function formatSize(bytes: number): string {
  const n = Math.max(0, Math.floor(bytes) || 0);
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export function openMode(file: { name: string; mime: string }): OpenMode {
  const ext = extensionOf(file.name) || MIME_EXT[file.mime.toLowerCase()] || "";
  if (IMAGE_EXT.has(ext)) return "inline-image";
  if (OPEN_EXT.has(ext)) return "open";
  return "download";
}

export function phaseLabel(phase: UploadPhase): string {
  switch (phase) {
    case "queued": return t("analysis.business.upload.waiting", "Waiting…");
    case "checking": return t("analysis.business.upload.checking", "Checking…");
    case "uploading": return t("analysis.business.upload.uploading", "Uploading…");
    case "verifying": return t("analysis.business.upload.verifying", "Verifying…");
    case "done": return t("analysis.business.upload.done", "Done");
    default: return t("analysis.business.upload.failed", "Failed");
  }
}

/** The status text of a queue row; a non-retryable failure shows its sentence alone (no "Failed" label). */
export function uploadStatusText(item: { phase: UploadPhase; message?: string; retryable?: boolean; notUploaded?: boolean }): string {
  if (item.phase === "failed" && item.notUploaded && item.message) return t("analysis.business.upload.notUploaded", "Not uploaded yet: {message}", { message: item.message });
  if (item.phase === "failed" && item.retryable === false && item.message) return item.message;
  return `${phaseLabel(item.phase)}${item.phase === "failed" && item.message ? ` ${item.message}` : ""}`;
}
