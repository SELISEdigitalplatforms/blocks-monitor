// Parity check before switching rbac.source to "iam" (server/iam/migrate/parity.ts): for every person, platform-wide and
// in every organization, the permissions today's Factory resolver gives against the ones IAM would give. It reads IAM
// and the Data Gateway and writes only the result to PlatformSetting iam.parity ({at, ok, mismatches, url}: the
// screens show it; --no-record skips that). Exits 1 while any difference is left; it must print 0 before the switch.
//
//   node scripts/iam-parity.mjs [--verbose] [--all-users] [--report <file>] [--no-record] [--env-file <file>]
//
// --all-users also checks IAM users the Factory rows do not name (catches grants only IAM has).
// The TypeScript is loaded through a middleware-mode Vite server (no port), like the backfills.
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
  cacheDir: path.join(root, ".vite-cache", "iam-parity"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { parityMain, runMain } = await server.ssrLoadModule("/server/iam/migrate/main.ts");
  process.exitCode = await runMain(() => parityMain(process.argv.slice(2), root));
} finally {
  await server.close();
}
