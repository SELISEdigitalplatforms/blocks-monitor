// /api/files: the signed upload (PUT /upload/<fileId>) and download (GET /download/<fileId>) URLs of local Storage.
// Like presigned cloud URLs they need no session: the signature and its expiry are the grant. An upload must match the
// size (and the SHA-256, when one was declared) the presign recorded.
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocalRuntime } from "./runtime.ts";
import { bytesPath, checkSignature, getFile, writeBytes } from "./storage.ts";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// Served inline only when the browser cannot run them.
const PASSIVE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|text\/csv|text\/markdown|application\/json)$/i;

function send(res: ServerResponse, status: number, body = "", headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

function readAll(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createFilesRoute(rt: LocalRuntime) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const m = /^\/(upload|download)\/([A-Za-z0-9-]{1,100})$/.exec(url.pathname);
      if (!m) return send(res, 404);
      const kind = m[1] as "upload" | "download";
      const fileId = m[2]!;
      if (!checkSignature(rt.db, kind, fileId, url.searchParams.get("exp"), url.searchParams.get("sig"))) return send(res, 403, "This link has expired.");
      const file = getFile(rt.db, fileId);
      if (!file) return send(res, 404);

      if (kind === "upload") {
        if (req.method === "OPTIONS") return send(res, 204, "", { allow: "PUT" });
        if (req.method !== "PUT") return send(res, 405, "", { allow: "PUT" });
        const body = await readAll(req, Math.min(MAX_UPLOAD_BYTES, file.sizeBytes));
        if (body === null) return send(res, 413, "The file is larger than announced.");
        if (body.length !== file.sizeBytes) return send(res, 400, "The file size does not match.");
        if (file.sha256 && createHash("sha256").update(body).digest("hex") !== file.sha256) return send(res, 400, "The file checksum does not match.");
        writeBytes(rt.db, rt.paths.filesDir, fileId, body);
        return send(res, 201);
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "", { allow: "GET, HEAD" });
      if (!file.uploadedAt) return send(res, 404);
      const p = bytesPath(rt.paths.filesDir, fileId);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(p);
      } catch {
        return send(res, 404);
      }
      const inline = PASSIVE.test(file.mime);
      res.statusCode = 200;
      res.setHeader("content-type", file.mime || "application/octet-stream");
      res.setHeader("content-length", String(stat.size));
      res.setHeader("cache-control", "private, max-age=300");
      res.setHeader("x-content-type-options", "nosniff");
      if (!inline) res.setHeader("content-security-policy", "sandbox; default-src 'none'");
      res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
      if (req.method === "HEAD") return void res.end();
      fs.createReadStream(p).pipe(res);
    } catch {
      if (!res.headersSent) send(res, 500);
    }
  };
}
