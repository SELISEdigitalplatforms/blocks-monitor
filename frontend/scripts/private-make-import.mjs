// Operator-approved, single-run Make import or recovery; never a replacement for the general queue worker.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadEnv } from "vite";
const root = fileURLToPath(new URL("../", import.meta.url));
const [projectId, mode, extra] = process.argv.slice(2);
const valid = /^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? "");
const createMode = valid && mode === "--dry-run" && !extra || valid && mode === "--yes" && !extra;
const recoverNew = valid && mode === "--recover-new" && !extra;
const recoverDestination = valid && mode === "--recover-destination" && /^[A-Za-z0-9_-]{1,128}$/.test(extra ?? "");
if (!createMode && !recoverNew && !recoverDestination || process.argv.length !== 4 + (recoverDestination ? 1 : 0)) {
  console.error("Usage: node scripts/private-make-import.mjs <projectId> --dry-run|--yes");
  console.error("       node scripts/private-make-import.mjs <projectId> --recover-new");
  console.error("       node scripts/private-make-import.mjs <projectId> --recover-destination <fileKey>");
  process.exit(2);
}
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [key, value] of Object.entries(env)) if (process.env[key] === undefined && typeof value === "string") process.env[key] = value;
Object.assign(process.env, { MF_ENGINE_FIGMA_WORKFLOW: "import", MF_ENGINE_FIGMA_IMPORT_APPROVED: createMode && mode === "--yes" || recoverNew || recoverDestination ? "1" : "0",
  MF_ENGINE_FIGMA_CREDITS_APPROVED: "0", MF_BLOCKS_PROVISIONING_ENABLED: "false",
  MF_ENGINE_ROOT: path.join(root, "data", "local-planner", "engine-root") });
const server = await createServer({ configFile: false, root, logLevel: "error", appType: "custom", cacheDir: path.join(root, ".vite-cache", "private-import"),
  resolve: { alias: { "@": path.join(root, "src") } }, optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  const mod = await server.ssrLoadModule("/server/blocks/engineWorker/privateMakeImport.ts");
  const result = recoverNew || recoverDestination
    ? await mod.recoverMakeImport({ root, env, projectId, mode: recoverNew ? "new" : "destination", fileKey: extra })
    : await mod.privateMakeImport({ root, env, projectId, approved: mode === "--yes" });
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(e instanceof Error ? e.message : "Private import failed; no response body was printed."); process.exitCode = 1; }
finally { await server.close(); }
