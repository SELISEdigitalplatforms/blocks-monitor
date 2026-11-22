/** The public share answer (Host A GET /api/public/share/<token>): no session, no Blocks API. */
export interface PublicShareFile { name: string; mime: string; sizeBytes: number; url: string; urlExpiresAt: string; inline: boolean }
export interface PublicShareItem {
  itemType: string;
  kind: "file" | "text" | "link";
  title: string;
  description?: string;
  file?: PublicShareFile;
  text?: { body: string; format: "plain" | "markdown" };
  link?: { url: string; host: string; isFigma: boolean };
}
export interface PublicShareAnswer { sharedByName: string; expiresAt: string; item: PublicShareItem }

export type PublicShareResult =
  | { status: "ok"; share: PublicShareAnswer }
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "error" };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);

function parseItem(v: unknown): PublicShareItem | null {
  if (!isObj(v) || !isStr(v.itemType) || !isStr(v.title) || !optStr(v.description)) return null;
  const { kind } = v;
  if (kind !== "file" && kind !== "text" && kind !== "link") return null;
  const item: PublicShareItem = { itemType: v.itemType, kind, title: v.title };
  if (isStr(v.description)) item.description = v.description;
  if (kind === "file") {
    const f = v.file;
    if (!isObj(f) || !isStr(f.name) || !isStr(f.mime) || !isNum(f.sizeBytes) || !isStr(f.url) || !isStr(f.urlExpiresAt) || typeof f.inline !== "boolean") return null;
    item.file = { name: f.name, mime: f.mime, sizeBytes: f.sizeBytes, url: f.url, urlExpiresAt: f.urlExpiresAt, inline: f.inline };
  } else if (kind === "text") {
    const t = v.text;
    if (!isObj(t) || !isStr(t.body) || (t.format !== "plain" && t.format !== "markdown")) return null;
    item.text = { body: t.body, format: t.format };
  } else {
    const l = v.link;
    if (!isObj(l) || !isStr(l.url) || !isStr(l.host) || typeof l.isFigma !== "boolean") return null;
    item.link = { url: l.url, host: l.host, isFigma: l.isFigma };
  }
  return item;
}

function parseAnswer(body: unknown): PublicShareAnswer | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.data)) return null;
  const d = body.data;
  if (!isStr(d.sharedByName) || !isStr(d.expiresAt)) return null;
  const item = parseItem(d.item);
  return item ? { sharedByName: d.sharedByName, expiresAt: d.expiresAt, item } : null;
}

export async function fetchPublicShare(token: string, signal?: AbortSignal): Promise<PublicShareResult> {
  if (!TOKEN.test(token)) return { status: "not_found" };
  try {
    const res = await fetch(`/api/public/share/${token}`, {
      method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { accept: "application/json" }, signal,
    });
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 429) return { status: "rate_limited" };
    if (res.status !== 200) return { status: "error" };
    const share = parseAnswer(await res.json());
    return share ? { status: "ok", share } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** The shared plain-text file, read from its presigned Storage URL; null on any failure or when larger than maxBytes. */
export async function fetchSharedText(url: string, maxBytes = 200000, signal?: AbortSignal): Promise<string | null> {
  try {
    if (new URL(url).protocol !== "https:") return null;
    const res = await fetch(url, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", signal });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > maxBytes) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return null;
  }
}
