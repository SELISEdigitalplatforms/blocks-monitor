// The preview server: serves every real build over HTTPS from the engine folders (build/paths.ts), with the Factory's
// dev certificate. Static files only, no dependencies; started detached by build/preview-server.sh (start | stop | status).
//
//   /<projectId>/                        the latest published build       project.json latestBuild -> builds/<buildId>/
//   /<projectId>/v/<version>/            a published version              project.json versions[version]
//   /<projectId>/stage/ | production/    a promoted release               project.json environments.stage | production
//   /_health                             "ok"
//
// The apps use a hash router and relative asset paths, so a path without a file extension answers the build's
// index.html, and a folder address without its trailing slash is redirected to it.
//
//   node frontend/server/local/engine/build/previewServer.ts      (MF_PREVIEW_HOST, MF_PREVIEW_PORT, MF_ENGINE_ROOT)
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { CERT_FILE, ID_RE, KEY_FILE, VERSION_RE, engineRoot, findProjectRoot } from "./paths.ts";

const HOST = process.env.MF_PREVIEW_HOST || "127.0.0.1";
const PORT = Number(process.env.MF_PREVIEW_PORT || 5321);
const ROOT = engineRoot();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

interface Hit {
  /** The build folder ("" when nothing is published there). */
  dir: string;
  rest: string[];
  /** The folder's address without its trailing slash: redirect. */
  redirect?: string;
}

interface Pj {
  latestBuild?: { buildId?: string } | null;
  versions?: Record<string, string>;
  environments?: Record<string, { buildId?: string } | undefined>;
}

function projectJsonOf(root: string): Pj {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8")) as Pj;
  } catch {
    return {};
  }
}

const buildFolder = (root: string, id: unknown): string => (typeof id === "string" && ID_RE.test(id) ? path.join(root, "builds", id) : "");

/** Maps a request path to a build folder and the path inside it; null when it names no project. */
export function resolveSite(urlPath: string, find: (projectId: string) => string | null = (id) => findProjectRoot(id)): Hit | null {
  let segs: string[];
  try {
    segs = urlPath.split("/").map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  segs = segs.slice(1); // leading ""
  const pid = segs[0] ?? "";
  if (!ID_RE.test(pid)) return null;
  const root = find(pid);
  if (!root) return null;
  const slash = urlPath.endsWith("/");
  const pj = projectJsonOf(root);
  if (segs[1] === "v" && VERSION_RE.test(segs[2] ?? "")) {
    const rest = segs.slice(3);
    if (rest.length === 0 && !slash) return { dir: "", rest: [], redirect: `/${pid}/v/${segs[2]}/` };
    return { dir: buildFolder(root, pj.versions?.[segs[2]!]), rest };
  }
  if (segs[1] === "stage" || segs[1] === "production") {
    const rest = segs.slice(2);
    if (rest.length === 0 && !slash) return { dir: "", rest: [], redirect: `/${pid}/${segs[1]}/` };
    return { dir: buildFolder(root, pj.environments?.[segs[1]]?.buildId), rest };
  }
  const rest = segs.slice(1);
  if (rest.length === 0 && !slash) return { dir: "", rest: [], redirect: `/${pid}/` };
  return { dir: buildFolder(root, pj.latestBuild?.buildId), rest };
}

function send(res: import("node:http").ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function serveFile(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, file: string): void {
  const ext = path.extname(file).toLowerCase();
  const isIndex = path.basename(file) === "index.html";
  const immutable = /[\\/]assets[\\/]/.test(file) && !isIndex;
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(file).pipe(res);
}

function handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  const urlPath = (req.url ?? "/").split("?")[0]!.split("#")[0]!;
  if (urlPath === "/_health") return send(res, 200, "ok");
  const hit = resolveSite(urlPath);
  if (!hit) return send(res, 404, "Not found");
  if (hit.redirect) {
    res.writeHead(301, { Location: hit.redirect, "Cache-Control": "no-store" });
    return void res.end();
  }
  if (hit.rest.some((s) => s === ".." || s.startsWith(".") || s.includes("\0") || s.includes("/") || s.includes("\\"))) return send(res, 404, "Not found");
  if (!hit.dir) return send(res, 404, "This version is not published.");
  const base = path.resolve(hit.dir);
  const index = path.join(base, "index.html");
  if (!fs.existsSync(index)) return send(res, 404, "This version is not published.");
  const target = path.resolve(base, ...hit.rest.filter(Boolean));
  if (target !== base && !target.startsWith(base + path.sep)) return send(res, 404, "Not found");
  let file = target;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch {
    // no such file: a route of the app (no extension) answers index.html; a missing asset is a 404
    if (path.extname(target)) return send(res, 404, "Not found");
    file = index;
  }
  if (!fs.existsSync(file)) return send(res, 404, "Not found");
  serveFile(req, res, file);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const server = https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, (req, res) => {
    try {
      handle(req, res);
    } catch (e) {
      console.error(new Date().toISOString(), "error", req.url, e instanceof Error ? e.message : String(e));
      if (!res.headersSent) send(res, 500, "Server error");
      else res.end();
    }
  });
  server.listen(PORT, HOST, () => console.log(new Date().toISOString(), `preview server on https://${HOST}:${PORT} serving ${ROOT}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
