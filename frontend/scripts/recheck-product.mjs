// Run a product's onboarding checks again on the engine host (server/local/engine/official/onboarding.ts;
// docs/OFFICIAL-MADP-ENGINE.md "Onboarding checks"): each repo's gate once on its pristine dev branch, the checks left
// out before included, the choices made kept; the engine host's registry is rewritten (validated) and the onboarding
// report renewed. No Factory data, no Blocks, no secrets read or printed.
//
//   node scripts/recheck-product.mjs --project-folder <engine folder of the project> \
//     [--allow-live-tests] [--keep <repo>.<kind>.<check>]... [--leave-out <repo>.<kind>.<check>]... [--engine-home D]
//
// The TypeScript is loaded through a middleware-mode Vite server (no port), like the attach command.
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
  cacheDir: path.join(root, ".vite-cache", "recheck"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { recheckMain } = await server.ssrLoadModule("/server/local/engine/official/attach.ts");
  process.exitCode = await recheckMain(process.argv.slice(2));
} finally {
  await server.close();
}
