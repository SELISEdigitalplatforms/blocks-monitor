/** Pure helpers of the Screens & design tab: no React, no store, no SDK. Texts are UI copy only; every figure shown comes from a real record. */
import { getCulture, t } from "@/i18n";

export type DesignMode = "figma" | "sample" | "describe";

/** The part of the DesignBrief record the tab reads (structural, so s7's record satisfies it). */
export interface BriefView {
  prototypeJson?: string | null;
  mode: DesignMode;
  instructions: string;
  sampleIds: string[];
  status: "draft" | "confirmed";
  confirmedByUserId: string | null;
  confirmedAt: string | number | Date | null;
}

/** The part of a sample Attachment record the tab reads. */
export interface SampleView {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  status: "pending" | "ready" | "rejected" | "deleted";
}

/** One upload in progress, as the upload pipeline reports it. */
export interface UploadView {
  localId: string;
  fileName: string;
  sizeBytes: number;
  mime: string;
  state: "queued" | "uploading" | "committing" | "ready" | "rejected" | "failed";
  attachmentId: string | null;
  reason: string | null;
  message?: string | null;
}

/** One row of the sample list: a server sample or an upload still in progress. */
export interface SampleEntry {
  key: string;
  attachmentId: string | null;
  localId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  state: "uploading" | "ready" | "rejected" | "failed";
  reason: string | null;
  message?: string | null;
  /** short-lived thumbnail URL, only filled by the container that holds the useSampleUrl query */
  url?: string | null;
}

export const MIN_INSTRUCTIONS = 20;
export const MAX_INSTRUCTIONS = 10000;

/** Query results and plain values both arrive here; a record never has a `data` key, a query result always does. */
export function pick<T>(value: T | { data?: T | null } | null | undefined): T | null {
  if (value && typeof value === "object" && "data" in value) return ((value as { data?: T | null }).data ?? null) as T | null;
  return (value ?? null) as T | null;
}

export function limitText(): string {
  return t("analysis.design.limit", "PNG, JPEG, WebP or PDF. Up to 10 MB each, 10 samples, 50 MB in total.");
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export function failedReasonText(reason: string | null | undefined, message: string | null | undefined): string {
  if (reason === "storage") return t("analysis.design.storageUnavailable", "File storage isn't available yet. The platform owner needs to enable it.");
  const base = reason === "presign" ? t("analysis.design.uploadNotStarted", "The upload could not be started.")
    : reason === "upload" ? t("analysis.design.uploadNotSent", "The file could not be sent to storage.")
    : reason === "commit" ? t("analysis.design.uploadNotFinished", "The upload could not be finished.")
    : t("analysis.design.uploadFailed", "The upload failed.");
  return message && message.trim() ? `${base} ${message}` : `${base} ${t("analysis.design.tryAgain", "Try again.")}`;
}

export function rejectReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "size": return t("analysis.design.reject.size", "Too large: up to 10 MB per file.");
    case "type": return t("analysis.design.reject.type", "Only PNG, JPEG, WebP or PDF files are accepted.");
    case "count": return t("analysis.design.reject.count", "Too many samples: up to 10.");
    case "total": return t("analysis.design.reject.total", "Over the 50 MB total for the samples.");
    case "empty": return t("analysis.design.reject.empty", "The file is empty.");
    default: return reason && /\s/.test(reason) ? reason : t("analysis.design.reject.other", "This file was rejected.");
  }
}

/** Why the confirm button is disabled, or null when the instruction can be confirmed. */
export function confirmReason(brief: Pick<BriefView, "mode" | "instructions"> | null, readyCount: number, uploadsBusy: boolean): string | null {
  if (uploadsBusy) return t("analysis.design.confirm.uploadsBusy", "Wait for the uploads to finish.");
  if (!brief) return t("analysis.design.confirm.chooseMode", "Choose Figma Make, From a sample or Describe it.");
  if (brief.mode === "sample") return readyCount >= 1 ? null : t("analysis.design.confirm.uploadSample", "Upload at least one sample.");
  const n = brief.instructions.trim().length;
  if (n < MIN_INSTRUCTIONS) return t("analysis.design.confirm.writeMore", "Write a sentence or two first.");
  if (n > MAX_INSTRUCTIONS) return t("analysis.design.confirm.tooLong", "Keep it under 10 000 characters.");
  return null;
}

export function formatWhen(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return getCulture() === "de-CH"
    ? d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function statusLine(brief: BriefView | null, nameOf: (userId: string | null) => string): {
  label: "Draft" | "Confirmed"; detail: string | null; changedSinceConfirm: boolean;
} {
  if (brief && brief.status === "confirmed") {
    const when = brief.confirmedAt ? formatWhen(brief.confirmedAt) : "";
    return { label: "Confirmed", detail: when ? t("analysis.design.confirmedByAt", "Confirmed by {name}, {when}", { name: nameOf(brief.confirmedByUserId), when }) : t("analysis.design.confirmedBy", "Confirmed by {name}", { name: nameOf(brief.confirmedByUserId) }), changedSinceConfirm: false };
  }
  if (brief && brief.confirmedAt) return { label: "Draft", detail: t("analysis.design.changedSinceAgreed", "Changed since it was agreed: agree to it again"), changedSinceConfirm: true };
  return { label: "Draft", detail: null, changedSinceConfirm: false };
}

/** Server samples first (the brief's order, ready only), then uploads that are not on the server list yet. */
export function mergeSamples(order: string[], samples: SampleView[], uploads: UploadView[]): SampleEntry[] {
  const ready = samples.filter((s) => s.status === "ready");
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const sorted = [...ready].sort((a, b) => rank(a.id) - rank(b.id));
  const out: SampleEntry[] = sorted.map((s) => ({
    key: s.id, attachmentId: s.id, localId: null, fileName: s.fileName, mime: s.mime, sizeBytes: s.sizeBytes, state: "ready", reason: null,
  }));
  const known = new Set(sorted.map((s) => s.id));
  for (const u of uploads) {
    if (u.attachmentId && known.has(u.attachmentId)) continue;
    out.push({
      key: u.localId, attachmentId: u.attachmentId, localId: u.localId, fileName: u.fileName, mime: u.mime, sizeBytes: u.sizeBytes,
      state: u.state === "failed" ? "failed" : u.state === "rejected" ? "rejected" : u.state === "ready" ? "ready" : "uploading",
      reason: u.reason, message: u.message ?? null,
    });
  }
  return out;
}

/** The full ready order after moving one sample up or down; null when the move is not possible. */
export function movedOrder(readyIds: string[], id: string, dir: -1 | 1): string[] | null {
  const i = readyIds.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= readyIds.length) return null;
  const next = [...readyIds];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
