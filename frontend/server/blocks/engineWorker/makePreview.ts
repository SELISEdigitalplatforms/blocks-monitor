import { makePreviewUrl, parseMakePrototype } from "../../../src/domain/figmaMake.ts";

type Brief = { ItemId: string; Mode?: unknown; Status?: unknown; PrototypeJson?: unknown };

/** Explicit operator association, not evidence that an arbitrary site belongs to the Make file. */
export function prepareMakePreview(briefs: readonly Brief[], fileKey: string, url: string) {
  const previewUrl = makePreviewUrl(url);
  if (!previewUrl) throw new Error("invalid_make_preview_url");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileKey)) throw new Error("invalid_make_file_key");
  const matches = briefs.filter((b) => {
    const prototype = parseMakePrototype(b.PrototypeJson);
    return b.Mode === "figma" && prototype && new URL(prototype.projectUrl).pathname.split("/")[2] === fileKey;
  });
  if (matches.length !== 1) throw new Error(matches.length ? "make_file_in_multiple_briefs" : "no_imported_design_matches_make_file");
  const brief = matches[0];
  const prototype = parseMakePrototype(brief.PrototypeJson)!;
  if (prototype.source.startsWith("pending:")) throw new Error("design_revision_is_pending");
  const original = typeof brief.PrototypeJson === "string" ? JSON.parse(brief.PrototypeJson) : brief.PrototypeJson;
  const previous = prototype.previewUrl;
  const patch = { PrototypeJson: JSON.stringify({ ...original, previewUrl }), Status: "draft" };
  return { briefId: brief.ItemId, previous, previewUrl, unchanged: previous === previewUrl, patch };
}

/** No redirects or credentials: a missing, login-only or non-HTML URL must not be recorded as ready. */
export async function verifyMakePreview(url: string, request: typeof fetch = fetch): Promise<void> {
  const preview = makePreviewUrl(url);
  if (!preview) throw new Error("invalid_make_preview_url");
  const response = await request(preview, { method: "GET", redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(20000) });
  try {
    if (!response.ok) throw new Error(`preview_http_${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("preview_is_not_html");
    if (response.headers.get("x-frame-options")) throw new Error("preview_blocks_framing");
    // A restrictive frame-ancestors needs a browser check against the real app, not a claimed success here.
    if (/\bframe-ancestors\b/i.test(response.headers.get("content-security-policy") ?? "")) throw new Error("preview_requires_frame_ancestors_review");
  } finally { await response.body?.cancel(); }
}
