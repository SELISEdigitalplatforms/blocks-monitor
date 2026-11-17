// The Vite plugin of the local app: the functions' virtual modules, the local host's routes on the dev server, and the
// dev server's CSP and security headers. A middleware-mode server (npm run reset) gets the modules only.
import type { Plugin } from "vite";
import { installProcessGuard } from "../fnHost/processGuard.ts";
import { CSP_NONCE_PLACEHOLDER, buildCsp } from "../security/csp.ts";
import { createSecurityMiddleware } from "../security/plugin.ts";
import { createApiMiddleware } from "../api/middleware.ts";
import type { Backend } from "./backend.ts";
import { dbFileId } from "./db.ts";
import { createLocalHost } from "./host.ts";
import { LOCAL_ORIGIN, LOCAL_PORT, initRuntime } from "./runtime.ts";
import { localVirtualModules } from "./virtualModules.ts";

export { LOCAL_ORIGIN, LOCAL_PORT };

export function localFactory({ root }: { root: string }): Plugin[] {
  const host: Plugin = {
    name: "factory-local-host",
    config() {
      // The web calls the same-origin function host (/api/fn/<function>); Vite marks its inline scripts for the CSP nonce.
      return { define: { __MF_FN_HOST__: JSON.stringify("local") }, html: { cspNonce: CSP_NONCE_PLACEHOLDER } };
    },
    configureServer(server) {
      if (server.config.server.middlewareMode) return;
      const logger = server.config.logger;
      installProcessGuard((line) => logger.error(line));
      const rt = initRuntime({
        root,
        appOrigin: LOCAL_ORIGIN,
        log: (level, line) => (level === "error" ? logger.error(line) : level === "warn" ? logger.warn(line) : logger.info(line)),
      });
      // Added directly (not in a returned hook), so they run before Vite's own middlewares.
      server.middlewares.use(
        createSecurityMiddleware({
          csp: (nonce) => buildCsp({ nonce, https: false, appOrigin: LOCAL_ORIGIN, blocksApiOrigin: "", storageOrigins: [], wasm: false, reportOnly: false }),
        }),
      );
      // Engine API middleware — handles /api/engine/*, /api/projects/*, /api/artifacts/*, /api/steps/*
      server.middlewares.use(createApiMiddleware());
      const local = createLocalHost({
        rt,
        loadBackend: async () => {
          const mod = (await server.ssrLoadModule("/server/local/backend.ts")) as { getBackend(o: { expectedHost: string }): Backend };
          return mod.getBackend({ expectedHost: new URL(LOCAL_ORIGIN).host });
        },
      });
      for (const m of local.mounts) {
        if (m.path) server.middlewares.use(m.path, m.handler);
        else server.middlewares.use(m.handler);
      }
      // An edited server module (an op, a rule, the engine) is loaded again at once rather than on the next request, so the
      // engine never works with old and new code side by side.
      let reloadSoon: ReturnType<typeof setTimeout> | null = null;
      server.watcher.on("change", (file) => {
        if (!/[\\/](server[\\/]local|functions|src[\\/]domain)[\\/]/.test(file)) return;
        if (reloadSoon) clearTimeout(reloadSoon);
        reloadSoon = setTimeout(() => {
          reloadSoon = null;
          local.reload();
        }, 400);
      });
      // The store's file deleted or replaced under the running server (a manual wipe): restart on the new file.
      const opened = dbFileId(rt.paths.dbFile);
      const watch = setInterval(() => {
        const now = dbFileId(rt.paths.dbFile);
        if (now === opened) return;
        clearInterval(watch);
        logger.warn("[store] the database file was replaced; reloading the store");
        void server.restart();
      }, 2000);
      watch.unref();
      server.httpServer?.once("listening", () => {
        local.start();
        logger.info(`\n  MADP Factory  ${LOCAL_ORIGIN}   (store: ${rt.paths.dbFile})\n`);
      });
      server.httpServer?.once("close", () => {
        clearInterval(watch);
        local.close();
      });
    },
  };
  return [localVirtualModules(root), host];
}
