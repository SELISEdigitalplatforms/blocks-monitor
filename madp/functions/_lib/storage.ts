// deps.files: project directory, presign, info, download URL, remove and head over Blocks Storage.
// Private files inherit the service role's access from the isolated mf root, never from module-wide grants.
import { OpError, invalidInput } from "./errors";
import type { SdkClient } from "./sdk";

export interface PresignInput {
  projectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  maxBytes: number;
  allowedMimes: readonly string[];
  /**
   * SHA-256 of the bytes, in one of two encodings: 64 hex characters (canonical, any case) or the
   * standard base64 of the 32-byte digest (44 characters, '=' padded). It is normalised to lowercase
   * hex before it is sent as `checksum`. Anything else is `invalid_input` (field sha256, rule pattern).
   */
  sha256?: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

function sha256Hex(value: string): string {
  if (HEX64.test(value)) return value.toLowerCase();
  if (BASE64_32.test(value)) {
    const raw = atob(value);
    if (raw.length === 32) return Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }
  throw invalidInput("sha256", "pattern");
}
export interface PresignResult {
  fileId: string;
  uploadUrl: string;
  storedName: string;
  displayName: string;
  directoryId: string;
  requiredHeaders: Record<string, string>;
}
export interface FileInfo {
  fileId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  directoryId: string;
  createdAt: string;
}
export interface FilesService {
  projectDirectory(projectId: string): Promise<string>;
  presignUpload(i: PresignInput): Promise<PresignResult>;
  info(fileId: string): Promise<FileInfo>;
  downloadUrl(fileId: string): Promise<{ url: string; expiresAt: string | null }>;
  remove(fileId: string): Promise<void>;
  head(fileId: string, bytes: number): Promise<Uint8Array>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> } } | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}
export type FetchImpl = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal; method?: string },
) => Promise<FetchResponseLike>;

export interface FilesDeps {
  client: () => Promise<SdkClient>;
  workspaceIdOf: (projectId: string) => Promise<string>;
  fetchImpl?: FetchImpl;
  timeoutMs?: () => number;
}

export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/json": ".json",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const CONTROL = /[\u0000-\u001f\u007f]/g;
const MAX_DISPLAY = 200;
const MAX_BASE = 80;
const HEAD_MAX_BYTES = 4096;
const HEAD_TIMEOUT_MS = 5000;
const LIST_LIMIT = 100;
const MAX_LIST_PAGES = 20;
// Blocks Data's Default_Construct module; using its default directory avoids owner-only root creation.
const DEFAULT_STORAGE_MODULE = 8;

export function normaliseFileName(
  fileName: string,
  mime: string,
): { storedName: string; displayName: string; extension: string } {
  const displayName = String(fileName ?? "").replace(CONTROL, "").trim().slice(0, MAX_DISPLAY);
  const leaf = displayName.split(/[\\/]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  const base = dot > 0 ? leaf.slice(0, dot) : dot === 0 ? "" : leaf;
  const safe =
    base
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_BASE) || "file";
  const extension = MIME_EXTENSIONS[mime.toLowerCase()] ?? ".bin";
  return { storedName: `${safe}${extension}`, displayName, extension };
}

function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  const s = e?.status ?? e?.statusCode ?? e?.response?.status;
  return typeof s === "number" ? s : null;
}

export type StorageStep =
  | "directory.list"
  | "directory.create"
  | "directory.delete"
  | "file.presign"
  | "file.get"
  | "file.delete";

const MAX_DIAG_MESSAGE = 200;

/** The Blocks error text (body errors[].message, body.message or err.message), safe to log. */
function diagnosticMessage(err: unknown): string {
  const e = err as { body?: unknown; message?: unknown } | null;
  const body = e && typeof e === "object" ? (e.body as { errors?: unknown; message?: unknown } | undefined) : undefined;
  let text = "";
  if (body && Array.isArray(body.errors)) {
    text = body.errors
      .map((x) => (x && typeof x === "object" ? String((x as { message?: unknown }).message ?? "") : ""))
      .filter(Boolean)
      .join("; ");
  }
  if (!text && body && typeof body.message === "string") text = body.message;
  if (!text && e && typeof e.message === "string") text = e.message;
  return text
    .replace(/https?:\/\/[^\s"'<>)]+/gi, (u) => {
      try {
        const p = new URL(u);
        return `${p.origin}${p.pathname}`;
      } catch {
        return u.split(/[?#]/)[0] ?? "";
      }
    })
    .replace(/[A-Za-z0-9_+/=.-]{40,}/g, "…")
    .slice(0, MAX_DIAG_MESSAGE);
}

function withDiagnostic(out: OpError, step: StorageStep, status: number | null, err: unknown): OpError {
  Object.defineProperty(out, "diagnostic", {
    value: { source: "storage", step, status: status ?? 0, message: diagnosticMessage(err) },
    enumerable: false,
  });
  return out;
}

function mapError(err: unknown, step: StorageStep): OpError {
  if (err instanceof OpError) return err;
  const s = statusOf(err);
  if (s === 404) return withDiagnostic(new OpError("not_found"), step, s, err);
  if (s === 403) {
    return withDiagnostic(new OpError("not_configured", "storage.forbidden", { service: "storage" }), step, s, err);
  }
  if (s !== null && s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429) {
    return withDiagnostic(new OpError("internal", "storage.refused", { service: "storage" }), step, s, err);
  }
  return withDiagnostic(new OpError("unavailable"), step, s, err);
}

async function guard<T>(step: StorageStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw mapError(err, step);
  }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function pickItems(res: unknown): Rec[] {
  const items = rec(res).items;
  return Array.isArray(items) ? items.map(rec) : [];
}

export function createFiles(deps: FilesDeps): FilesService {
  async function listChildren(client: SdkClient, parentId: string | undefined, moduleName?: number): Promise<Rec[]> {
    const out: Rec[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const res = rec(
        await guard("directory.list", () =>
          client.data.objects.list({
            type: "directory",
            limit: LIST_LIMIT,
            ...(parentId ? { parentDirectoryId: parentId } : {}),
            ...(!parentId && moduleName !== undefined ? { moduleName } : {}),
            ...(cursor ? { cursor } : {}),
          }),
        ),
      );
      out.push(...pickItems(res));
      cursor = typeof res.nextCursor === "string" && res.nextCursor ? res.nextCursor : undefined;
      if (res.hasMore !== true || !cursor) break;
    }
    return out;
  }

  const oldestFirst = (a: Rec, b: Rec) =>
    str(a.createdDate).localeCompare(str(b.createdDate)) || str(a.itemId).localeCompare(str(b.itemId));

  async function ensureChild(client: SdkClient, parentId: string | undefined, name: string, moduleName?: number): Promise<string> {
    const named = (rows: Rec[]) => rows.filter((r) => r.name === name && r.type !== "file").sort(oldestFirst);
    let matches = named(await listChildren(client, parentId, moduleName));
    let createdId: string | null = null;
    if (matches.length === 0) {
      const made = rec(
        await guard("directory.create", () =>
          parentId
            ? client.data.directories.create({ name, parentDirectoryId: parentId })
            : client.data.directories.create({ name, ...(moduleName !== undefined ? { moduleName } : {}) }),
        ),
      );
      createdId = str(made.itemId) || str(made.directoryId) || str(made.id) || null;
      matches = named(await listChildren(client, parentId, moduleName));
      if (matches.length === 0 && createdId) return createdId;
    }
    const keep = matches[0];
    if (!keep) throw new OpError("unavailable");
    const keepId = str(keep.itemId);
    if (createdId && createdId !== keepId && matches.some((m) => str(m.itemId) === createdId)) {
      // Lost the race: our fresh (empty) directory is a duplicate.
      await guard("directory.delete", () =>
        client.data.directories.delete({ directoryId: createdId as string, permanent: true }),
      ).catch(() => undefined);
    }
    if (!keepId) throw new OpError("unavailable");
    return keepId;
  }

  async function projectDirectory(projectId: string): Promise<string> {
    const workspaceId = await deps.workspaceIdOf(projectId);
    return guard("directory.list", async () => {
      const client = await deps.client();
      const roots = (await listChildren(client, undefined, DEFAULT_STORAGE_MODULE)).filter((r) => r.name === "mf").sort(oldestFirst);
      const rootId = str(roots[0]?.itemId);
      if (!rootId) throw new OpError("not_configured", "storage.forbidden", { service: "storage" });
      const root = rec(await guard("directory.list", () => client.data.directories.get(rootId)));
      const permissions = rec(root.permissions);
      // An administrator provisions this boundary once. Never inherit broad module policies
      // or create files below an unconfigured root merely because an upload endpoint permits it.
      if (root.inheritsParentAccess !== false || permissions.canDownload !== true || permissions.canEdit !== true) {
        throw new OpError("not_configured", "storage.forbidden", { service: "storage" });
      }
      let parent = rootId;
      for (const name of [workspaceId, projectId]) parent = await ensureChild(client, parent, name);
      return parent as string;
    });
  }

  async function fileRecord(fileId: string): Promise<Rec> {
    return guard("file.get", async () => {
      const client = await deps.client();
      let res: Rec = {};
      try {
        res = rec(await (client.data.files as any).get(fileId, { configurationName: "Default" }));
      } catch (error) {
        // Use the metadata endpoint only for a missing/inaccessible details response. A server
        // error or outage must not be disguised as a missing file.
        const status = statusOf(error);
        if (status !== 404) throw mapError(error, "file.get");
      }
      if (res.errors && (res.errors as Rec).access) {
        // Metadata can contain the original write-only upload URL. It is not a download
        // capability and must never be used to bypass an access-denied file read.
        throw mapError({ status: 403 }, "file.get");
      }
      if (Object.keys(res).length === 0 || res.isSuccess === false) {
        const infoRes = rec(await guard("file.get", () => client.data.files.info({ filter: { fileIds: [fileId] } })));
        const list = pickItems(infoRes);
        const match = list.find((item) => str(item.itemId) === fileId || str(item.fileId) === fileId || str(item.ItemId) === fileId || str(item.FileId) === fileId);
        if (match) res = match;
      }
      if (Object.keys(res).length === 0) throw new OpError("not_found");
      return res;
    });
  }

  async function downloadUrl(fileId: string) {
    const r = await fileRecord(fileId);
    const url = str(r.downloadUrl) || str(r.DownloadUrl) || str(r.url) || str(r.Url) || str(r.preSignedUrl) || str(r.PreSignedUrl) || str(r.fileUrl) || str(r.FileUrl);
    if (!url) throw new OpError("not_found");
    const exp = str(r.expiresAt) || str(r.ExpiresAt) || str(r.expireDate) || str(r.ExpireDate) || str(r.expiry) || str(r.Expiry);
    return { url, expiresAt: exp || null };
  }

  return {
    projectDirectory,

    async presignUpload(i) {
      if (!Number.isInteger(i.sizeBytes) || i.sizeBytes < 1) throw invalidInput("sizeBytes", "min");
      if (i.sizeBytes > i.maxBytes) throw new OpError("too_large");
      if (!i.allowedMimes.includes(i.mime)) throw invalidInput("mime", "enum");
      const checksum = i.sha256 === undefined ? undefined : sha256Hex(i.sha256);
      const { storedName, displayName } = normaliseFileName(i.fileName, i.mime);
      const directoryId = await projectDirectory(i.projectId);
      return guard("file.presign", async () => {
        const client = await deps.client();
        const res = rec(
          await client.data.files.presignedUploadUrl({
            name: storedName,
            contentType: i.mime,
            configurationName: "Default",
            accessModifier: "Private",
            parentDirectoryId: directoryId,
            // SDK normalization drops lower-case contentType without mapping it to the API field.
            // Access is centralized here: inherit only the isolated app root's service-role
            // policies. Individual lanes cannot opt into broad organization/module access.
            ContentType: i.mime,
            SizeInBytes: i.sizeBytes,
            ObjectAccessLevel: "Creator",
            InheritsParentAccess: true,
            ...(checksum ? { Checksum: checksum, ChecksumAlgorithm: "SHA256" } : {}),
          }),
        );
        const fileId = str(res.fileId) || str(res.itemId);
        const uploadUrl = str(res.uploadUrl) || str(res.preSignedUrl) || str(res.url);
        if (!fileId || !uploadUrl) throw new OpError("unavailable");
        const rawHeaders = res.requiredHeaders ?? res.RequiredHeaders;
        const requiredHeaders: Record<string, string> = {};
        if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
          for (const [key, value] of Object.entries(rawHeaders as Rec)) if (typeof value === "string") requiredHeaders[key] = value;
        }
        return { fileId, uploadUrl, storedName, displayName, directoryId, requiredHeaders };
      });
    },

    async info(fileId) {
      const r = await fileRecord(fileId);
      let sizeBytes = Number(r.sizeInBytes ?? r.SizeInBytes ?? r.size ?? r.Size ?? r.fileSize ?? r.FileSize ?? 0) || 0;
      let mime = str(r.contentType) || str(r.ContentType) || str(r.mime) || str(r.Mime);
      const url = str(r.downloadUrl) || str(r.DownloadUrl) || str(r.url) || str(r.Url) || str(r.preSignedUrl) || str(r.PreSignedUrl) || str(r.fileUrl) || str(r.FileUrl);
      if (sizeBytes === 0 && url && url.startsWith("https://")) {
        const doFetch: FetchImpl = deps.fetchImpl ?? ((u, init) => fetch(u, init) as unknown as Promise<FetchResponseLike>);
        const ms = Math.max(1, Math.min(HEAD_TIMEOUT_MS, deps.timeoutMs?.() ?? HEAD_TIMEOUT_MS));
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), ms);
        try {
          const headRes = await doFetch(url, { method: "HEAD", headers: {}, signal: ac.signal });
          if (!headRes.ok) throw new OpError("unavailable");
          if (headRes.ok) {
            const cl = Number(headRes.headers?.get("content-length"));
            if (Number.isFinite(cl) && cl > 0) sizeBytes = cl;
            const ct = headRes.headers?.get("content-type");
            if (ct && !mime) mime = ct;
          }
        } catch (error) {
          // A failed measurement is not evidence of an empty or invalid upload. Keep the
          // DocFile pending so verification can be retried rather than deleting valid bytes.
          throw error instanceof OpError ? error : new OpError("unavailable");
        } finally { clearTimeout(timer); }
      }
      return {
        fileId: str(r.fileId) || str(r.FileId) || str(r.itemId) || str(r.ItemId) || fileId,
        name: str(r.name) || str(r.Name) || str(r.fileName) || str(r.FileName),
        mime,
        sizeBytes,
        directoryId: str(r.parentDirectoryId) || str(r.ParentDirectoryId),
        createdAt: str(r.createdDate) || str(r.CreatedDate) || str(r.createdAt) || str(r.CreatedAt),
      };
    },

    downloadUrl,

    async remove(fileId) {
      await guard("file.delete", async () => {
        const client = await deps.client();
        await client.data.files.delete({ fileId, permanent: true });
      });
    },

    async head(fileId, bytes) {
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > HEAD_MAX_BYTES) {
        throw new TypeError("head: bytes must be an integer between 1 and 4096");
      }
      const { url } = await downloadUrl(fileId);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new OpError("unavailable");
      }
      if (parsed.protocol !== "https:") throw new OpError("unavailable");
      const doFetch: FetchImpl = deps.fetchImpl ?? ((u, init) => fetch(u, init) as unknown as Promise<FetchResponseLike>);
      const ms = Math.max(1, Math.min(HEAD_TIMEOUT_MS, deps.timeoutMs?.() ?? HEAD_TIMEOUT_MS));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), ms);
      try {
        const res = await doFetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: ac.signal });
        if (res.status === 404) throw new OpError("not_found");
        if (!res.ok) throw new OpError("unavailable");
        const out = new Uint8Array(bytes);
        let n = 0;
        if (res.body) {
          const reader = res.body.getReader();
          while (n < bytes) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            const take = Math.min(value.length, bytes - n);
            out.set(value.subarray(0, take), n);
            n += take;
          }
          await reader.cancel().catch(() => undefined);
        } else if (res.arrayBuffer) {
          const all = new Uint8Array(await res.arrayBuffer());
          n = Math.min(all.length, bytes);
          out.set(all.subarray(0, n), 0);
        }
        return out.slice(0, n);
      } catch (err) {
        if (err instanceof OpError) throw err;
        throw new OpError("unavailable");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
