// Pure rules for feedback on scope items and their attachments (no I/O).
import { MIME_EXTENSIONS, magicMatches as sharedMagicMatches } from "./uploads";

/** "success": one success & performance target of the scope (TargetId = its SuccessKey, e.g. "responseTime"). */
export type FeedbackTargetType = "feature" | "story" | "screen" | "milestone" | "success";
export const FEEDBACK_TARGET_TYPES: readonly FeedbackTargetType[] = ["feature", "story", "screen", "milestone", "success"];

export function isFeedbackTargetType(x: unknown): x is FeedbackTargetType {
  return typeof x === "string" && (FEEDBACK_TARGET_TYPES as readonly string[]).includes(x);
}

/** The UUIDv5 name of the one thread per item. */
export function threadKey(projectId: string, targetType: FeedbackTargetType, targetId: string): string {
  return `${projectId}:${targetType}:${targetId}`;
}

export const COMMENT_MAX_CHARS = 5000;

export function commentTextIssue(text: string): null | "comment.required" | "comment.tooLong" {
  const t = (text ?? "").trim();
  if (!t) return "comment.required";
  if (t.length > COMMENT_MAX_CHARS) return "comment.tooLong";
  return null;
}

export const ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_COMMENT = 5;
export const STALE_UPLOAD_MS = 3600000;
export const MAGIC_BYTES = 16;

export function isAllowedMime(m: unknown): m is AttachmentMime {
  return typeof m === "string" && (ATTACHMENT_MIMES as readonly string[]).includes(m);
}

export function attachmentIssue(a: { mime: string; sizeBytes: number }): null | "attachment.type" | "attachment.size" {
  if (!isAllowedMime(a.mime)) return "attachment.type";
  if (!(a.sizeBytes > 0) || a.sizeBytes > ATTACHMENT_MAX_BYTES) return "attachment.size";
  return null;
}

const EXTENSIONS: Record<AttachmentMime, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
const CANONICAL: Record<AttachmentMime, string> = {
  "image/png": MIME_EXTENSIONS["image/png"],
  "image/jpeg": MIME_EXTENSIONS["image/jpeg"],
  "image/webp": MIME_EXTENSIONS["image/webp"],
  "application/pdf": MIME_EXTENSIONS["application/pdf"],
};
const NAME_CAP = 120;

export function normaliseStoredName(fileName: string, mime: string): string {
  let n = String(fileName ?? "");
  n = n.slice(Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")) + 1);
  n = n.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\.{2,}/g, "");
  n = n.replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const ext = isAllowedMime(mime) ? CANONICAL[mime] : "";
  let base = n;
  const dot = n.lastIndexOf(".");
  if (dot > 0) {
    const tail = n.slice(dot).toLowerCase();
    const ok = isAllowedMime(mime) && EXTENSIONS[mime].includes(tail);
    if (ok) {
      return finish(n.slice(0, dot), n.slice(dot));
    }
    base = n.slice(0, dot);
    // 'a.png.exe' with png: the remaining base already carries the right extension.
    const d2 = base.lastIndexOf(".");
    if (d2 > 0 && isAllowedMime(mime) && EXTENSIONS[mime].includes(base.slice(d2).toLowerCase()))
      return finish(base.slice(0, d2), base.slice(d2));
  }
  return finish(base, ext);
}

function finish(base: string, ext: string): string {
  let b = base.trim().replace(/^\.+/, "");
  if (!b) b = "file";
  return b.slice(0, Math.max(1, NAME_CAP - ext.length)) + ext;
}

export function magicMatches(mime: string, bytes: Uint8Array): boolean {
  return isAllowedMime(mime) && sharedMagicMatches(mime, bytes);
}

export function isStaleUpload(a: { status: string; createdAt: string }, now: Date): boolean {
  if (a.status !== "pending") return false;
  const t = Date.parse(a.createdAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > STALE_UPLOAD_MS;
}
