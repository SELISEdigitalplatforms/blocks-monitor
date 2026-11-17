import fs from "node:fs";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";
import { resolveAppOrigin } from "../fnHost/appOrigin.ts";
import {
  buildCsp,
  CSP_NONCE_PLACEHOLDER,
  cspModeOf,
  DEFAULT_BLOCKS_API_URL,  needsWasm,  STORAGE_ORIGINS,} from "./csp.ts";

// CSP and security headers for the dev server (serve only, never test or build).
const applies: Plugin["apply"] = (_, env) => env.command === "serve" && env.mode !== "test";

export { createSecurityMiddleware } from "./middleware.ts";
import { createSecurityMiddleware } from "./middleware.ts";

export function mfSecurityHeaders({ root }: { root: string }): Plugin {
  let env: Record<string, string> = {};
  let pkg: Parameters<typeof needsWasm>[0] = {};
  return {
    name: "mf-security-headers",
    apply: applies,
    config(_, { mode }) {
      env = loadEnv(mode, root, ["VITE_", "MF_"]);
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      } catch {
        pkg = {};
      }
      return { html: { cspNonce: CSP_NONCE_PLACEHOLDER } };
    },
    configureServer(server) {
      const https = Boolean(server.config.server.https);
      const port = server.config.server.port ?? 5300;
      const resolved = resolveAppOrigin({ env: { ...env, ...process.env }, port, https });
      if (!resolved.ok) server.config.logger.error(`[csp] ${resolved.error}`);
      const appOrigin = resolved.ok ? resolved.origin : `${https ? "https" : "http"}://localhost:${port}`;
      const wasm = needsWasm(pkg);
      const reportOnly = cspModeOf(env) === "report-only";
      const blocksApiOrigin = env.VITE_BLOCKS_API_URL || DEFAULT_BLOCKS_API_URL;
      const hubUrl = env.VITE_MF_NOTIFIER_HUB_URL || null;
      // Added directly (not in a returned hook), so it runs before Vite's own middlewares.
      server.middlewares.use(
        createSecurityMiddleware({
          csp: (nonce) => buildCsp({ nonce, https, appOrigin, blocksApiOrigin, storageOrigins: STORAGE_ORIGINS, wasm, reportOnly, hubUrl }),
        }),
      );
    },
  };
}
