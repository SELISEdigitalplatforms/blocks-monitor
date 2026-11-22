// Attach an EXISTING product to a Factory project on the engine host, so the Factory develops it through the official
// MADP engine (server/local/engine/official/attach.ts does the work; docs/OFFICIAL-MADP-ENGINE.md "Existing products").
// Dry run by default: it prints the plan and writes nothing. --yes clones, installs, writes the registry and
// factory.json, and links the Factory project (and, with --live-url, records it as live) in the Factory's data.
//
//   node scripts/attach-existing-product.mjs --project-id <id> --project-folder <engine folder> \
//     --registry <official registry .yml> --dev-tenant <D + 32 hex> --web-url <https dev address> \
//     [--live-url <https dev address> [--live-version x.y.z]] [--author-name N --author-email E] \
//     [--commit-trailer T] [--with-stage [--stage-cli-config-dir D] [--stage-cli-cwd D]] [--engine-home D] [--yes]
//
// The Factory's data is reached as the engine worker reaches it (MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID,
// MF_SVC_CLIENT_SECRET, VITE_BLOCKS_API_URL from the environment or frontend/.env.local); without them the dry run
// still prints the plan of the files, and --yes stops before it writes anything. No credential is ever printed.
//
// The TypeScript is loaded through a middleware-mode Vite server (no port), like the engine worker (start.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const { createServer, loadEnv } = await import("vite");
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;

const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  appType: "custom",
  cacheDir: path.join(root, ".vite-cache", "attach"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { attachMain } = await server.ssrLoadModule("/server/local/engine/official/attach.ts");
  const { serviceFactoryData } = await server.ssrLoadModule("/server/local/engine/official/attachData.ts");
  process.exitCode = await attachMain(process.argv.slice(2), { data: serviceFactoryData(env) });
} finally {
  await server.close();
}
