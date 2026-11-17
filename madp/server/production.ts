import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountBlocksRuntime, type Middleware, type MiddlewareStack } from "./blocks/runtime.ts";
import { getRouter } from "./blocks/backend.ts";
import type { PurgeModuleLike } from "./fnHost/purgeWorker.ts";

// Bundling preserves import.meta.url in dist-server; source dev resolves from server/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
const origin = new URL(env.MF_APP_ORIGIN || "");
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if ((origin.protocol !== "https:" && !(loopback && origin.protocol === "http:")) || origin.origin !== env.MF_APP_ORIGIN)
  throw new Error("MF_APP_ORIGIN must be a bare HTTPS origin or an HTTP loopback origin");
if (env.MF_BLOCKS_SHELL_ENABLED !== "1") throw new Error("This internal service requires MF_BLOCKS_SHELL_ENABLED=1");
for (const name of ["MF_BLOCKS_TENANT", "MF_SVC_CLIENT_ID", "MF_SVC_CLIENT_SECRET", "MF_BLOCKS_SHELL_KEY"]) {
  if (!env[name]) throw new Error(`Missing required server setting: ${name}`);
}
if (env.FACTORY_PLATFORM !== "blocks" || env.VITE_BLOCKS_AUTH_MODE !== "embedded") {
  throw new Error("Production requires FACTORY_PLATFORM=blocks and VITE_BLOCKS_AUTH_MODE=embedded");
}

const layers: { prefix: string; handler: Middleware }[] = [];
const stack: MiddlewareStack = {
  use(prefix: string | Middleware, handler?: Middleware) {
    layers.push(typeof prefix === "string" ? { prefix, handler: handler! } : { prefix: "", handler: prefix });
  },
};
// The shell runtime does not start a second engine or maintenance worker.
const runtime = mountBlocksRuntime(stack, {
  root, appOrigin: origin.origin, apiOrigin: env.VITE_BLOCKS_API_URL || "https://api.seliseblocks.com", env,
}, async (name) => getRouter(name), async () => (await import("../functions/_lib/purge.ts")) as unknown as PurgeModuleLike);

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };
const dist = path.join(root, "dist");
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; res.end(); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url || "/", origin).pathname); }
  catch { res.statusCode = 400; res.end(); return; }
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((p) => p.startsWith("."))) {
    res.statusCode = 404; res.end(); return;
  }
  let file = path.resolve(dist, `.${pathname}`);
  if (!file.startsWith(dist + path.sep) && file !== dist) { res.statusCode = 404; res.end(); return; }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (pathname !== "/" && (path.extname(pathname) || !String(req.headers.accept).includes("text/html"))) { res.statusCode = 404; res.end(); return; }
    file = path.join(dist, "index.html");
  }
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  res.setHeader("cache-control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  // HTML passes through the shared nonce/CSP middleware, including HEAD requests.
  res.end(await readFile(file));
}

const server = createServer((req, res) => {
  if (req.url === "/healthz") { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); return; }
  // Preserve the ingress Host for the shared session and CSRF checks; forwarded headers are never trusted.
  if (req.headers.host !== (env.MF_INTERNAL_HOST || origin.host)) { res.statusCode = 421; res.end(); return; }
  let index = 0;
  const next = (error?: unknown): void => {
    if (error) {
      console.error("[factory-http] request failed");
      if (!res.headersSent) { res.statusCode = 500; res.setHeader("content-type", "application/json"); }
      res.end('{"ok":false,"error":{"code":"INTERNAL_ERROR"}}'); return;
    }
    const layer = layers[index++];
    if (!layer) { void serveStatic(req, res).catch(next); return; }
    const original = req.url || "/";
    if (layer.prefix && original !== layer.prefix && !original.startsWith(layer.prefix + "/") && !original.startsWith(layer.prefix + "?")) { next(); return; }
    if (layer.prefix) req.url = original.slice(layer.prefix.length) || "/";
    try { layer.handler(req, res, (err) => { req.url = original; next(err); }); }
    catch (err) { req.url = original; next(err); }
  };
  next();
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.listen(Number(env.PORT || 5311), env.MF_LISTEN_HOST || "127.0.0.1", () => console.log("MADP internal workflow service listening"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  runtime.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
