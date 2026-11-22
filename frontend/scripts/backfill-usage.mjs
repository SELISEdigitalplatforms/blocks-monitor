// Read the usage (tokens and cost) of jobs that ran before the engine recorded it back from the engine host's lane logs
// and reports, onto EngineJob.UsageJson and each job's usage credit entry (server/blocks/engineWorker/usageBackfill.ts).
// Run on the engine host. Without --apply it only prints what it would write; running it again writes nothing new.
//
//   node scripts/backfill-usage.mjs --root <folder holding the products' madp folders> [--apply] [--force]
//
// The TypeScript is loaded through a middleware-mode Vite server (no port), like the other backfill.
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
  cacheDir: path.join(root, ".vite-cache", "backfill-usage"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { backfillMain } = await server.ssrLoadModule("/server/blocks/engineWorker/usageBackfill.ts");
  process.exitCode = await backfillMain(process.argv.slice(2), root);
} catch (e) {
  console.error(`The backfill stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
