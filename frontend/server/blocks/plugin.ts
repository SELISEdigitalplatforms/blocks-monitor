import type { Plugin } from "vite";
import { CSP_NONCE_PLACEHOLDER } from "../security/csp.ts";
import type { FunctionHandler } from "../../functions/_lib/types.ts";
import type { PurgeModuleLike } from "../fnHost/purgeWorker.ts";
import type { BlocksFunctionName } from "./host.ts";
import { mountBlocksRuntime } from "./runtime.ts";

/** Only a listening dev server runs background work: a middleware-mode server (a script, a test run) never writes. */
export function runsBackgroundWork(server: { httpServer: unknown }, env: Record<string, string | undefined> = process.env): boolean {
  return server.httpServer != null && !env.VITEST;
}

/** Cloud mode never opens local databases or starts the local workflow simulator. */
export function blocksFrontend(o: { root: string; appOrigin: string; apiOrigin: string; env: Record<string, string> }): Plugin {
  const embedded = o.env.VITE_BLOCKS_AUTH_MODE === "embedded";
  return {
    name: "factory-blocks-frontend",
    config() {
      return { define: { __MF_FN_HOST__: JSON.stringify(embedded ? "local" : "blocks") }, html: { cspNonce: CSP_NONCE_PLACEHOLDER } };
    },
    configureServer(server) {
      const runtime = mountBlocksRuntime(server.middlewares, o, async (name) => {
        const backend = await server.ssrLoadModule("/server/blocks/backend.ts") as {
          getRouter(name: BlocksFunctionName): FunctionHandler;
        };
        return backend.getRouter(name);
      }, runsBackgroundWork(server)
        // the routers' own module graph: the purge's wake hook is told by project.delete
        ? async () => await server.ssrLoadModule("/functions/_lib/purge.ts") as PurgeModuleLike
        : undefined);
      server.httpServer?.once("close", () => runtime.stop());
    },
  };
}
