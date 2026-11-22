import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadEnv } from "vite";
const root = fileURLToPath(new URL("../", import.meta.url));
const [projectId, mode] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? "") || !["--dry-run", "--yes"].includes(mode) || process.argv.length !== 4) throw new Error("Usage: node scripts/factory-design.mjs <projectId> --dry-run|--yes");
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
Object.assign(process.env, { MF_BLOCKS_PROVISIONING_ENABLED: "false", MF_ENGINE_ROOT: path.join(root, "data", "local-planner", "engine-root") });
const server = await createServer({ configFile: false, root, logLevel: "error", appType: "custom", cacheDir: path.join(root, ".vite-cache", "factory-design"),
  resolve: { alias: { "@": path.join(root, "src") } }, optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  const mod = await server.ssrLoadModule("/server/blocks/engineWorker/factoryDesignRun.ts");
  console.log(JSON.stringify(await mod.runFactoryRevision({ root, env, projectId, approved: mode === "--yes",
    feedback: "Preserve the existing visual identity and working journeys. Move the editable prototype to the Factory-managed preview; make only corrections needed to align with the recorded goals, requirements, criteria, exclusions and constraints. Do not expand business scope." }), null, 2));
} catch (e) { console.error(e instanceof Error ? e.message : "Factory design run failed."); process.exitCode = 1; }
finally { await server.close(); }
