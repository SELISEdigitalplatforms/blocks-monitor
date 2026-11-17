// Local Storage: a directory tree and file records in SQLite, the bytes under frontend/data/files/<fileId>, and short-lived
// signed upload / download URLs on this app's own origin (/api/files/...), the shape of the presigned cloud URLs the app
// was built on. Plain module (no OpError): the FilesService on top (storageService.ts) maps the outcomes.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { metaGet, metaSet } from "./db.ts";

export const URL_TTL_S = 15 * 60;

export interface StoredFile {
  fileId: string;
  directoryId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string | null;
  createdAt: string;
  uploadedAt: string | null;
}

type FileRow = { file_id: string; directory_id: string; name: string; mime: string; size_bytes: number; sha256: string | null; created_at: string; uploaded_at: string | null };

const fileOf = (r: FileRow): StoredFile => ({
  fileId: r.file_id,
  directoryId: r.directory_id,
  name: r.name,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  sha256: r.sha256,
  createdAt: r.created_at,
  uploadedAt: r.uploaded_at,
});

export function bytesPath(filesDir: string, fileId: string): string {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(fileId)) throw new TypeError("invalid file id");
  return path.join(filesDir, fileId);
}

function secret(db: DatabaseSync): Buffer {
  let s = metaGet(db, "storage.secret");
  if (!s) {
    s = randomBytes(32).toString("base64url");
    metaSet(db, "storage.secret", s);
  }
  return Buffer.from(s, "base64url");
}

const sign = (db: DatabaseSync, what: string): string => createHmac("sha256", secret(db)).update(what).digest("base64url");

export function signedUrl(db: DatabaseSync, appOrigin: string, kind: "upload" | "download", fileId: string, ttlS = URL_TTL_S): { url: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const sig = sign(db, `${kind}:${fileId}:${exp}`);
  return { url: `${appOrigin}/api/files/${kind}/${fileId}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function checkSignature(db: DatabaseSync, kind: "upload" | "download", fileId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  const want = Buffer.from(sign(db, `${kind}:${fileId}:${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function ensureDirectory(db: DatabaseSync, parentId: string, name: string): string {
  const hit = db.prepare("SELECT directory_id FROM storage_directories WHERE parent_id = ? AND name = ?").get(parentId, name) as { directory_id: string } | undefined;
  if (hit) return hit.directory_id;
  const id = randomUUID();
  db.prepare("INSERT INTO storage_directories (directory_id, parent_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, parentId, name, new Date().toISOString());
  return id;
}

export function createFileRecord(db: DatabaseSync, f: { directoryId: string; name: string; mime: string; sizeBytes: number; sha256?: string | null }): StoredFile {
  const fileId = randomUUID();
  db.prepare("INSERT INTO storage_files (file_id, directory_id, name, mime, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    fileId,
    f.directoryId,
    f.name,
    f.mime,
    f.sizeBytes,
    f.sha256 ?? null,
    new Date().toISOString(),
  );
  return getFile(db, fileId)!;
}

export function getFile(db: DatabaseSync, fileId: string): StoredFile | null {
  const r = db.prepare("SELECT * FROM storage_files WHERE file_id = ?").get(fileId) as FileRow | undefined;
  return r ? fileOf(r) : null;
}

/** Stores the bytes of a file record (the signed PUT, or the seed). */
export function writeBytes(db: DatabaseSync, filesDir: string, fileId: string, bytes: Uint8Array): void {
  fs.mkdirSync(filesDir, { recursive: true });
  fs.writeFileSync(bytesPath(filesDir, fileId), bytes);
  db.prepare("UPDATE storage_files SET size_bytes = ?, uploaded_at = ? WHERE file_id = ?").run(bytes.length, new Date().toISOString(), fileId);
}

export function readHead(filesDir: string, fileId: string, bytes: number): Uint8Array | null {
  let fd: number;
  try {
    fd = fs.openSync(bytesPath(filesDir, fileId), "r");
  } catch {
    return null;
  }
  try {
    const out = Buffer.alloc(bytes);
    const n = fs.readSync(fd, out, 0, bytes, 0);
    return new Uint8Array(out.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

export function removeFile(db: DatabaseSync, filesDir: string, fileId: string): boolean {
  const r = db.prepare("DELETE FROM storage_files WHERE file_id = ?").run(fileId);
  try {
    fs.rmSync(bytesPath(filesDir, fileId), { force: true });
  } catch {
    /* the record is gone either way */
  }
  return Number(r.changes) > 0;
}
