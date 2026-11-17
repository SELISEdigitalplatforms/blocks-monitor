// deps.files (functions/_lib/storage.ts FilesService) on local Storage, with the same checks and errors: presign refuses
// a bad size, type or checksum; a missing file is not_found. Upload and download URLs are signed, short-lived and point
// at this app (/api/files/...). Loaded in the functions' module graph (OpError instance).
import { OpError, invalidInput } from "../../functions/_lib/errors";
import { normaliseFileName, type FilesService } from "../../functions/_lib/storage";
import type { LocalRuntime } from "./runtime.ts";
import { createFileRecord, ensureDirectory, getFile, readHead, removeFile, signedUrl } from "./storage.ts";

const HEX64 = /^[0-9a-fA-F]{64}$/;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;
const HEAD_MAX_BYTES = 4096;

function sha256Hex(value: string): string {
  if (HEX64.test(value)) return value.toLowerCase();
  if (BASE64_32.test(value)) {
    const raw = Buffer.from(value, "base64");
    if (raw.length === 32) return raw.toString("hex");
  }
  throw invalidInput("sha256", "pattern");
}

export function createLocalFiles(rt: LocalRuntime, workspaceIdOf: (projectId: string) => Promise<string>): FilesService {
  const { db } = rt;
  const filesDir = rt.paths.filesDir;
  const must = (fileId: string) => {
    const f = typeof fileId === "string" && fileId ? getFile(db, fileId) : null;
    if (!f) throw new OpError("not_found");
    return f;
  };

  async function projectDirectory(projectId: string): Promise<string> {
    const workspaceId = await workspaceIdOf(projectId);
    let parent = "";
    for (const name of ["mf", workspaceId, projectId]) parent = ensureDirectory(db, parent, name);
    return parent;
  }

  return {
    projectDirectory,

    async presignUpload(i) {
      if (!Number.isInteger(i.sizeBytes) || i.sizeBytes < 1) throw invalidInput("sizeBytes", "min");
      if (i.sizeBytes > i.maxBytes) throw new OpError("too_large");
      if (!i.allowedMimes.includes(i.mime)) throw invalidInput("mime", "enum");
      const checksum = i.sha256 === undefined ? null : sha256Hex(i.sha256);
      const { storedName, displayName } = normaliseFileName(i.fileName, i.mime);
      const directoryId = await projectDirectory(i.projectId);
      const f = createFileRecord(db, { directoryId, name: storedName, mime: i.mime, sizeBytes: i.sizeBytes, sha256: checksum });
      return { fileId: f.fileId, uploadUrl: signedUrl(db, rt.appOrigin, "upload", f.fileId).url, storedName, displayName, directoryId, requiredHeaders: {} };
    },

    async info(fileId) {
      const f = must(fileId);
      return { fileId: f.fileId, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes, directoryId: f.directoryId, createdAt: f.createdAt };
    },

    async downloadUrl(fileId) {
      const f = must(fileId);
      return signedUrl(db, rt.appOrigin, "download", f.fileId);
    },

    async remove(fileId) {
      if (!removeFile(db, filesDir, fileId)) throw new OpError("not_found");
    },

    async head(fileId, bytes) {
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > HEAD_MAX_BYTES) throw new TypeError("head: bytes must be an integer between 1 and 4096");
      const f = must(fileId);
      if (!f.uploadedAt) throw new OpError("not_found");
      const out = readHead(filesDir, f.fileId, bytes);
      if (!out) throw new OpError("not_found");
      return out;
    },
  };
}
