// Move the Factory's plans and its plan and discount codes into Blocks Utilities (server/blocks/utilitiesSync.ts):
// every plan (the Plan rows, and the defaults Free, Classic USD 199, Speed USD 399 and Enterprise for keys not stored)
// becomes a Utilities plan with its monthly USD price, its usage meter and its features; every plan or discount code
// becomes a Utilities discount. Credit codes stay here. Without --apply it only prints what it would do and writes the
// plan under data/blocks-utilities-sync/; a rerun does only what is left. It never switches billing.source.
//
//   node scripts/blocks-utilities-sync.mjs [--apply] [--report <file>] [--env-file <file>]
//
// The service identity comes from MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET (environment, .env or
// --env-file); Utilities is called at MF_BLOCKS_UTILITIES_BASE (default /utilities/v4 on the Blocks API). The
// TypeScript is loaded through a middleware-mode Vite server (no port), like the other migrations.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const { createServer } = await import("vite");
const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  appType: "custom",
  cacheDir: path.join(root, ".vite-cache", "blocks-utilities-sync"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { syncMain } = await server.ssrLoadModule("/server/blocks/utilitiesSync.ts");
  const { runMain } = await server.ssrLoadModule("/server/iam/migrate/main.ts");
  process.exitCode = await runMain(() => syncMain(process.argv.slice(2), root));
} finally {
  await server.close();
}
