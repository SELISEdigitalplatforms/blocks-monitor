import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin, ProxyOptions } from "vite";

/** Serve the separately built React 18 app through the shell's origin. */
export function madpAssets(directory: string): Plugin {
  return {
    name: "madp-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        if (pathname.startsWith("/madp-api/")) {
          const incoming = req.headers.origin || req.headers.referer;
          let sameOrigin = false;
          try { sameOrigin = Boolean(incoming) && new URL(incoming!).host === req.headers.host; } catch { /* reject malformed origins */ }
          if (!sameOrigin || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") || !pathname.startsWith("/madp-api/api/")) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: { code: "forbidden" } }));
            return;
          }
          return next();
        }
        if (!pathname.startsWith("/madp/")) return next();
        let relative: string;
        try { relative = decodeURIComponent(pathname.slice("/madp/".length)); }
        catch { res.statusCode = 400; res.end(); return; }
        const file = path.resolve(directory, relative || "index.html");
        if (!file.startsWith(path.resolve(directory) + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("MADP asset missing. Run npm run build:madp in client.");
          return;
        }
        const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".glb": "model/gltf-binary" };
        res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export function madpApiProxy(target: string): ProxyOptions {
  const origin = new URL(target).origin;
  return {
    target: origin,
    changeOrigin: true,
    secure: false,
    configure(proxy) {
      proxy.on("proxyReq", (upstream) => {
        // Shell cookies are validated by the .NET gateway. Only that gateway may
        // mint a trusted internal assertion; browser-supplied bridge headers never pass through.
        for (const header of upstream.getHeaderNames()) {
          if (header.startsWith("x-madp-") && header !== "x-madp-expected-tenant") upstream.removeHeader(header);
        }
      });
    },
  };
}
