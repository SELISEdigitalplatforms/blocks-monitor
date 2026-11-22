// Lists, and with --apply removes, what deleted projects left behind on the Blocks tenant of frontend/.env.local:
// per schema with a ProjectId, the rows whose project no longer exists or is being deleted (server/blocks/orphans.ts).
// The rules are the project delete's own (src/domain/projects.ts): a project's work and content (notifications
// included) is removed, Storage files first, and a project still marked 'deleting' is finished by the purge itself;
// the command log, audit trail and credit ledger stay as history and are only counted. Prints counts and ids only.
//
//   node scripts/purge-orphans.mjs             the dry run (the default): reads only, writes nothing
//   node scripts/purge-orphans.mjs --apply     removes what the dry run lists for removal
//
// The TypeScript is loaded through a middleware-mode Vite server (no port, no plugins), like the backfills.
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
  cacheDir: path.join(root, ".vite-cache", "purge-orphans"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { orphansMain } = await server.ssrLoadModule("/server/blocks/orphans.ts");
  process.exitCode = await orphansMain(process.argv.slice(2), root);
} catch (e) {
  console.error(`The orphan scan stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
