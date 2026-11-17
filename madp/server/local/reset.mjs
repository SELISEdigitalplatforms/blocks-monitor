// npm run reset: empties the local store (database rows, accounts, sessions, files, mail drop) and seeds it again with
// frontend/seed (seedAll), then prints the accounts to sign in with. Safe while `npm run dev` runs: the dev server notices
// the new data and everyone signs in again. The seed is TypeScript in the functions' module graph, so it is loaded
// through a middleware-mode Vite server (no port, its own pre-bundle cache).
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.FACTORY_TASK = "reset";
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { createServer } = await import("vite");
const server = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  root,
  logLevel: "warn",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
let code = 0;
try {
  const mod = await server.ssrLoadModule("/server/local/resetMain.ts");
  await mod.reset({ root });
} catch (e) {
  code = 1;
  console.error(`\nReset failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  await server.close();
}
process.exit(code);
