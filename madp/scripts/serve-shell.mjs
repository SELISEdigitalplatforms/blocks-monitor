import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadEnv } from "vite";
import { localVirtualModules } from "../server/local/virtualModules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
process.env.MF_BLOCKS_SHELL_ENABLED = "1";
process.env.FACTORY_PLATFORM = "blocks";
process.env.VITE_BLOCKS_AUTH_MODE = "embedded";
process.env.MF_APP_ORIGIN ||= "http://127.0.0.1:5311";
process.env.PORT ||= "5311";
const modules = await createServer({
  configFile: false,
  root,
  plugins: [localVirtualModules(root)],
  resolve: { alias: { "@": path.join(root, "src") } },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false },
});
await modules.ssrLoadModule("/server/production.ts");
