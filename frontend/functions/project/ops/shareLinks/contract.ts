/**
 * The share-link contract: names, limits, token helpers and the public answer shapes. Pure: no I/O.
 * Only the SHA-256 of a token is ever stored; the token itself is shown once to its creator.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SHARE_LINK_SCHEMA = "ShareLink";

export const SHARE_LINK_ITEM_TYPES = [
  "doc.file",
  "doc.note",
  "design.screen",
  "attachment",
  "wiki.page",
  "change.request",
  "change.attachment",
  "release.preview",
  "scope",
] as const;
export type ShareLinkItemType = (typeof SHARE_LINK_ITEM_TYPES)[number];

export function isShareLinkItemType(x: unknown): x is ShareLinkItemType {
  return typeof x === "string" && (SHARE_LINK_ITEM_TYPES as readonly string[]).includes(x);
}

export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export const SHARE_LINK_DEFAULT_DAYS = 7;
export const SHARE_LINK_MAX_ACTIVE_PER_ITEM = 20;
export const SHARE_LINK_LIST_MAX = 50;
export const SHARE_LINK_URL_TTL_SECONDS = 300;

export const SHARE_LINK_FIELDS = [
  "ItemId",
  "WorkspaceId",
  "ProjectId",
  "ItemType",
  "ItemRef",
  "TokenHash",
  "ExpiresAt",
  "RevokedAt",
  "CreatedByUserId",
  "UpdatedByUserId",
  "ViewCount",
  "LastViewedAt",
  "CreatedDate",
  "LastUpdatedDate",
] as const;

export const SHARE_LINK_VIEW_FIELDS = SHARE_LINK_FIELDS.filter((x) => x !== "TokenHash");

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Constant-time comparison of two hex hashes; malformed input still does the same work and answers false. */
export function sameHash(a: string, b: string): boolean {
  const okA = typeof a === "string" && HEX64.test(a);
  const okB = typeof b === "string" && HEX64.test(b);
  const bufA = Buffer.from(okA ? a : "0".repeat(64), "hex");
  const bufB = Buffer.from(okB ? b : "0".repeat(64), "hex");
  const equal = timingSafeEqual(bufA, bufB);
  return okA && okB && equal;
}

type LinkRow = Record<string, unknown>;

function str(row: LinkRow, k: string): string {
  const v = row[k];
  return typeof v === "string" ? v : "";
}

function dateStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return "";
}

export function isLive(row: LinkRow, now: Date): boolean {
  if (dateStr(row.RevokedAt) !== "") return false;
  const exp = Date.parse(dateStr(row.ExpiresAt));
  return Number.isFinite(exp) && exp > now.getTime();
}

export interface ShareLinkView {
  id: string;
  projectId: string;
  itemType: ShareLinkItemType;
  itemRef: string;
  createdByUserId: string;
  createdDate: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export function shareLinkView(row: LinkRow): ShareLinkView {
  const type = row.ItemType;
  const views = row.ViewCount;
  return {
    id: str(row, "ItemId"),
    projectId: str(row, "ProjectId"),
    itemType: isShareLinkItemType(type) ? type : "doc.file",
    itemRef: str(row, "ItemRef"),
    createdByUserId: str(row, "CreatedByUserId"),
    createdDate: dateStr(row.CreatedDate),
    expiresAt: dateStr(row.ExpiresAt),
    revokedAt: dateStr(row.RevokedAt) || null,
    viewCount: typeof views === "number" && Number.isFinite(views) ? Math.max(0, Math.trunc(views)) : 0,
    lastViewedAt: dateStr(row.LastViewedAt) || null,
  };
}

export const PASSIVE_INLINE_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
] as const;

export function isPassiveMime(mime: unknown): boolean {
  if (typeof mime !== "string") return false;
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  return (PASSIVE_INLINE_MIMES as readonly string[]).includes(base);
}

const MAX_URL = 2048;

export function safeOutboundUrl(raw: unknown): { url: string; host: string; isFigma: boolean } | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  const host = u.hostname.toLowerCase();
  if (host === "") return null;
  const url = u.toString();
  if (url.length > MAX_URL) return null;
  return { url, host, isFigma: host === "figma.com" || host.endsWith(".figma.com") };
}

export interface PublicShareFile {
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
  urlExpiresAt: string;
  inline: boolean;
}

export interface PublicShareItem {
  itemType: ShareLinkItemType;
  kind: "file" | "text" | "link";
  title: string;
  description?: string;
  file?: PublicShareFile;
  text?: { body: string; format: "plain" | "markdown" };
  link?: { url: string; host: string; isFigma: boolean };
}

export interface PublicShareAnswer {
  sharedByName: string;
  expiresAt: string;
  item: PublicShareItem;
}

export type PublicShareItemDraft = Omit<PublicShareItem, "file"> & {
  file?: { name: string; mime: string; sizeBytes: number };
};
