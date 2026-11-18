// Shared upload primitives: the canonical MIME -> extension table, stored-name cleaning,
// magic-byte checks and the refused set. Each purpose (Business files, design samples,
// scope feedback attachments) keeps its own allowlist and limits in its own module.
// Pure: no React, DOM, storage, timers or network; the functions bundle this file unchanged.

/** Canonical MIME -> extension (with the dot). Agrees with functions/_lib MIME_EXTENSIONS for every type both know. */
export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  "application/vnd.ms-outlook": ".msg",
  "message/rfc822": ".eml",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** Extensions never accepted (any purpose). */
export const REFUSED_EXTENSIONS: readonly string[] = [
  "svg", "svgz", "html", "htm", "xhtml", "xml", "js", "mjs", "ts", "sh", "bat", "cmd", "ps1",
  "exe", "msi", "dll", "com", "scr", "jar", "apk", "app", "dmg", "iso",
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
];

/** MIME types never accepted (any purpose). */
export const REFUSED_MIME: readonly string[] = [
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-shellscript",
  "text/x-shellscript",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-dosexec",
  "application/vnd.microsoft.portable-executable",
  "application/x-executable",
  "application/x-mach-binary",
  "application/java-archive",
  "application/vnd.android.package-archive",
  "application/x-apple-diskimage",
  "application/x-iso9660-image",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-bzip2",
  "application/x-xz",
];

/** Shown when the server refuses an upload because file storage is not enabled. */
export const STORAGE_UNAVAILABLE_MESSAGE = "File storage isn't available yet. The platform owner needs to enable it.";

/** Did the server refuse because file storage is unavailable? Duck-typed on { code, messageKey, params }. */
export function isStorageUnavailable(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { code?: unknown; messageKey?: unknown; params?: unknown };
  if (x.messageKey === "storage.forbidden" || x.code === "storage_forbidden") return true;
  const service = typeof x.params === "object" && x.params !== null ? (x.params as { service?: unknown }).service : undefined;
  return x.code === "not_configured" && service === "storage";
}

/** Bytes of the file head a caller must read for `magicMatches`. */
export const MAGIC_HEAD_BYTES = 16;

export function baseMime(mime: unknown): string {
  return typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

function lastSegment(name: unknown): string {
  const seg = String(name ?? "").split(/[\\/]/).pop() ?? "";
  return seg.replace(CONTROL, "").replace(/[. ]+$/, "");
}

function extensionOf(name: string): string {
  const seg = lastSegment(name);
  const dot = seg.lastIndexOf(".");
  return dot >= 0 && dot < seg.length - 1 ? seg.slice(dot + 1).toLowerCase() : "";
}

export function isRefusedUpload(name: string, mime: string): boolean {
  if (REFUSED_MIME.includes(baseMime(mime))) return true;
  return REFUSED_EXTENSIONS.includes(extensionOf(name));
}

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(MIME_EXTENSIONS).map((e) => e.slice(1)),
  ...REFUSED_EXTENSIONS,
  "jpeg",
  "markdown",
  "json",
]);

const NAME_CAP = 120;

/**
 * A storage-safe file name that always carries the canonical extension of the MIME type:
 * no path, traversal or control characters, NFC, no trailing dots or spaces, a missing, wrong
 * or double extension replaced, never empty.
 */
export function normaliseStoredName(name: string, mime: string): string {
  let n = String(name ?? "").normalize("NFC");
  n = n.slice(Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")) + 1);
  n = n.replace(CONTROL, "").replace(/\s+/g, " ").replace(/[. ]+$/g, "").replace(/^[. ]+/, "");
  const ext = MIME_EXTENSIONS[baseMime(mime)] ?? ".bin";
  let base = n;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && /^[a-z0-9]{1,5}$/i.test(base.slice(dot + 1))) {
    base = base.slice(0, dot);
    // "a.png.exe": drop further known extensions too.
    for (;;) {
      const d = base.lastIndexOf(".");
      if (d > 0 && KNOWN_EXTENSIONS.has(base.slice(d + 1).toLowerCase())) base = base.slice(0, d);
      else break;
    }
  }
  base = base.replace(/[. ]+$/g, "").replace(/^[. ]+/, "");
  if (!base) base = "file";
  const room = NAME_CAP - ext.length;
  if (base.length > room) base = base.slice(0, room).replace(/[. ]+$/g, "") || "file";
  return `${base}${ext}`;
}

function startsWith(bytes: ArrayLike<number>, at: number, expected: readonly number[]): boolean {
  if (!bytes || bytes.length < at + expected.length) return false;
  for (let i = 0; i < expected.length; i++) if (bytes[at + i] !== expected[i]) return false;
  return true;
}
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

const OFFICE_ZIP = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const OLE_TYPES = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.ms-outlook"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown", "text/csv", "message/rfc822"]);

/** Do the first bytes of a file fit its declared MIME type? Unknown and refused types never match. */
export function magicMatches(mime: string, head: ArrayLike<number>): boolean {
  const m = baseMime(mime);
  if (!m || !head || REFUSED_MIME.includes(m)) return false;
  if (m === "image/png") return startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47]);
  if (m === "image/jpeg" || m === "image/jpg") return startsWith(head, 0, [0xff, 0xd8, 0xff]);
  if (m === "image/gif") return startsWith(head, 0, ascii("GIF87a")) || startsWith(head, 0, ascii("GIF89a"));
  if (m === "image/webp") return startsWith(head, 0, ascii("RIFF")) && startsWith(head, 8, ascii("WEBP"));
  if (m === "application/pdf") return startsWith(head, 0, ascii("%PDF-"));
  if (OFFICE_ZIP.has(m)) return startsWith(head, 0, ZIP);
  if (OLE_TYPES.has(m)) return startsWith(head, 0, OLE);
  if (m === "audio/mpeg" || m === "audio/mp3") {
    return startsWith(head, 0, ascii("ID3")) || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  }
  if (m === "audio/mp4" || m === "audio/x-m4a" || m === "video/mp4" || m === "video/quicktime") return startsWith(head, 4, ascii("ftyp"));
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave") return startsWith(head, 0, ascii("RIFF")) && startsWith(head, 8, ascii("WAVE"));
  if (TEXT_TYPES.has(m)) {
    if (head.length === 0) return false;
    for (let i = 0; i < head.length; i++) if (head[i] === 0) return false;
    return true;
  }
  return false;
}
