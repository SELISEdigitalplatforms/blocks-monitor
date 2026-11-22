// Read the checks of earlier change builds back from the engine host's acceptance reports onto their change requests
// (server/blocks/engineWorker/checksBackfill.ts): the files that failed and the files that passed, so "a change's failing
// checks follow the newest result of each file" covers builds that ran before those results were recorded. Run on the
// engine host. Without --apply it only prints what it would add.
//
//   node scripts/backfill-checks.mjs --project <project id> --reports <the product's madp folder>/reports [--apply]
//
// The TypeScript is loaded through a middleware-mode Vite server (no port), like the recheck command.
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
  cacheDir: path.join(root, ".vite-cache", "backfill-checks"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { backfillMain } = await server.ssrLoadModule("/server/blocks/engineWorker/checksBackfill.ts");
  process.exitCode = await backfillMain(process.argv.slice(2), root);
} catch (e) {
  console.error(`The backfill stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
