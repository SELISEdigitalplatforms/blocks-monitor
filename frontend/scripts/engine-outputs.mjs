// Writes (or refreshes) the "What MADP produced" index and the engine-style artifacts of project folders on this engine
// host: <MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/artifacts/ (server/engine-context/outputs.ts). The engine
// worker does the same after every job; this script is for folders made before that, or to look at one again.
//
//   MF_ENGINE_ROOT=/srv/madp-factory/engine-root node frontend/scripts/engine-outputs.mjs --all
//   node frontend/scripts/engine-outputs.mjs <projectId> [<projectId> …]
//
// Only writes under each project's artifacts/ (its own generated files, listed in artifacts/outputs.json); never moves
// or removes anything. Prints every file it wrote.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = process.env.MF_ENGINE_ROOT ? path.resolve(process.env.MF_ENGINE_ROOT) : path.resolve(root, "..", "..", "madp-factory-work", "engine-root");
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: engine-outputs.mjs --all | <projectId> …");
  process.exit(2);
}

const folders = [];
const base = path.join(engineRoot, "projects");
for (const ws of fs.existsSync(base) ? fs.readdirSync(base) : []) {
  if (!ID.test(ws)) continue;
  for (const pid of fs.readdirSync(path.join(base, ws))) {
    if (!ID.test(pid) || !fs.existsSync(path.join(base, ws, pid, "project.json"))) continue;
    if (args.includes("--all") || args.includes(pid)) folders.push(path.join(base, ws, pid));
  }
}
if (folders.length === 0) {
  console.error(`no project folder found under ${base}`);
  process.exit(1);
}

process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const { createServer } = await import("vite");
const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  appType: "custom",
  cacheDir: path.join(root, ".vite-cache", "engine-outputs"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
let failed = 0;
try {
  const { writeProjectOutputs } = await server.ssrLoadModule("/server/engine-context/outputs.ts");
  for (const dir of folders) {
    try {
      const m = await writeProjectOutputs(dir);
      console.log(`\n${m.name} (${path.relative(engineRoot, dir)}): ${m.summary}`);
      for (const f of m.generated) console.log(`  artifacts/${f}`);
    } catch (e) {
      failed += 1;
      console.error(`\n${path.relative(engineRoot, dir)}: not written (${e instanceof Error ? e.message : String(e)})`);
    }
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
