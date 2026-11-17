// npm run engine:blocks — the MADP engine worker for Blocks mode, as its own Node process (worker.ts does the work).
//
// The engine code is TypeScript in the functions' module graph, so it is loaded through a middleware-mode Vite server
// (no port, its own pre-bundle cache), like npm run reset. New code is picked up without a restart, in one of two ways:
//
//   in a checkout   an edited writer (server/local/engine/**), engine domain file (src/domain/**), function library
//                   file (functions/_lib/**) or worker file: the worker stops claiming, hands its running jobs over (they
//                   finish on the code they started with), loads the module graph again and goes on.
//   on the engine   MF_ENGINE_APP_LINK names the app through the release link (<bridge>/app/selise-madp/frontend, see
//   host            release.mjs). The worker runs from the concrete release folder the link named at its start and
//                   checks the link every few seconds. When the link names another complete release, the worker hands
//                   its running jobs over the same way: they finish on the files of the release they started with,
//                   while the next jobs run on the new release, loaded through its own module server. A release whose
//                   code does not start (3 tries) is refused: the worker goes on with the release it had and tries the
//                   refused one again after 10 minutes, or at once when the link names another release.
//
// This file itself, and the Vite it loads, are those of the folder the process started from: a change to them takes
// effect at the next start of the service.
//
// Environment (frontend/.env.local is read too): MF_SVC_CLIENT_ID, MF_SVC_CLIENT_SECRET, MF_BLOCKS_TENANT,
// VITE_BLOCKS_API_URL; ENGINE_SINCE (ISO time: older jobs are left alone), ENGINE_HOST_DIR (engine.json + pid file),
// ENGINE_POLL_MS, FACTORY_ENGINE=off, FACTORY_ENGINE_PACE; MF_ENGINE_APP_LINK, ENGINE_RELEASE_POLL_MS (release link
// check interval, default 5000). One worker per host (pid file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { concreteDir, createServerPool, releaseIdOf, releaseLabel, watchReleaseLink } from "./release.mjs";

// the concrete folder (every link resolved): the files this process started from stay the same when a link moves
const startRoot = concreteDir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
const ENTRY = "/server/blocks/engineWorker/worker.ts";
const RELOAD_WAIT_MS = 180_000;
/** A release whose code does not start is tried this often (at the link check's pace), then refused for a while. */
const RELEASE_LOAD_ATTEMPTS = 3;
const REFUSED_RETRY_MS = 10 * 60_000;
const WATCHED = /[\\/](server[\\/]local[\\/]engine|server[\\/]engine-context|server[\\/]blocks[\\/]engineWorker|functions[\\/]_lib|src[\\/]domain)[\\/][^\\/].*\.(ts|mjs|json)$/;

const stamp = () => new Date().toISOString();
const log = (line) => process.stdout.write(`${stamp()} ${line}\n`);
const errLine = (e) => (e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join(" | ") : String(e));

process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const { createServer, loadEnv } = await import("vite");
const env = { ...loadEnv("development", startRoot, ""), ...process.env };
// Settings from the env files reach the engine's modules that read process.env (the knowledge base under
// MF_ENGINE_ROOT, the Claude executables, the extraction runner); the process environment wins over the files.
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;

const hostDir = env.ENGINE_HOST_DIR ? path.resolve(env.ENGINE_HOST_DIR) : path.join(startRoot, "data");
fs.mkdirSync(hostDir, { recursive: true });
const pidFile = path.join(hostDir, "engine-worker.pid");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
try {
  const other = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (other && other !== process.pid && alive(other)) {
    log(`[engine] another engine worker runs (pid ${other}); this one stops`);
    process.exit(1);
  }
} catch {
  /* no pid file */
}
fs.writeFileSync(pidFile, `${process.pid}\n`);

/** The app through the release link (run.sh sets it on the engine host); empty in a checkout. */
const appLink = String(env.MF_ENGINE_APP_LINK ?? "").trim();
const releaseMode = appLink !== "";
const releasePollMs = Number(env.ENGINE_RELEASE_POLL_MS) > 0 ? Number(env.ENGINE_RELEASE_POLL_MS) : 5000;

// One module server per folder whose code runs: the current one, plus a folder an earlier generation still runs jobs
// on. A release's files never change, so its server does not watch them.
const pool = createServerPool({
  log,
  create: (dir) =>
    createServer({
      configFile: false,
      root: dir,
      logLevel: "warn",
      appType: "custom",
      cacheDir: path.join(dir, ".vite-cache", "engine"),
      resolve: { alias: { "@": path.join(dir, "src") } },
      optimizeDeps: { noDiscovery: true, entries: [], include: [] },
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: releaseMode
          ? null
          : { ignored: ["**/node_modules/**", "**/.vite-cache/**", "**/data/**", "**/dist/**", "**/e2e-report/**", "**/test-results/**", "**/public/**", "**/.git/**"] },
      },
    }),
});

const tokenStore = { cache: new Map(), inflight: new Map() };
let worker = null;
/** The folder the current generation's code comes from. */
let root = startRoot;
let generation = 0;
let reloading = false;
let reloadAgain = false;
/** The folder the next reload loads (set by a release switch); null: the current folder again. */
let wanted = null;
/** The folder a running reload loads. */
let inflight = null;
/** A release whose code did not start, and when: tried again only after REFUSED_RETRY_MS (or once the link names
 *  another folder and then this one again). */
let refused = null;
let stopping = false;

async function load(dir) {
  const server = await pool.acquire(dir);
  try {
    const mod = await server.ssrLoadModule(ENTRY);
    const next = await mod.startWorker({
      root: dir,
      env,
      tokenStore,
      log,
      since: env.ENGINE_SINCE || null,
      configDir: hostDir,
      pollMs: Number(env.ENGINE_POLL_MS) > 0 ? Number(env.ENGINE_POLL_MS) : undefined,
    });
    worker = { impl: next, root: dir };
    root = dir;
  } catch (e) {
    await pool.release(dir, root);
    throw e;
  }
  generation += 1;
  log(`[engine] code generation ${generation} loaded${releaseIdOf(dir) ? ` (${releaseLabel(dir)})` : ""}`);
  await pool.sweep(root);
}

/** Makes the next load of a folder evaluate its modules again (an edited file in a checkout, a failed start). */
async function invalidate(dir) {
  const server = await pool.server(dir)?.catch(() => null);
  server?.moduleGraph.invalidateAll();
}

async function loadUntilItWorks(dir) {
  for (let attempt = 1; !stopping; attempt += 1) {
    try {
      await load(dir);
      return;
    } catch (e) {
      log(`[engine] start failed (${attempt}x): ${errLine(e)}`);
      worker = null;
      await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * attempt)));
      await invalidate(dir);
    }
  }
}

/** A new release: a few attempts; when its code does not start, the worker goes on with the folder it had. */
async function loadRelease(dir) {
  for (let attempt = 1; attempt <= RELEASE_LOAD_ATTEMPTS && !stopping; attempt += 1) {
    try {
      // a release an earlier generation still runs jobs on has its server loaded: its modules are evaluated afresh
      await invalidate(dir);
      await load(dir);
      return true;
    } catch (e) {
      log(`[engine] ${releaseLabel(dir)} did not start (${attempt}x): ${errLine(e)}`);
      if (attempt < RELEASE_LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, releasePollMs * attempt));
    }
  }
  return false;
}

/** Hands the current generation's running jobs over: they finish on its code and files, then its folder may unload. */
async function retireCurrent() {
  if (!worker) return;
  const { impl, root: was } = worker;
  impl.drain();
  const until = Date.now() + RELOAD_WAIT_MS;
  while (impl.working().length > 0 && Date.now() < until && !stopping) await new Promise((r) => setTimeout(r, 1000));
  if (impl.working().length > 0) log(`[engine] ${impl.working().length} job(s) still running: they are resumed by the reloaded worker`);
  await impl.stop();
  worker = null;
  // a generation of an earlier release (no finished()) keeps its folder loaded until the process ends
  if (typeof impl.finished === "function") void impl.finished().then(() => pool.release(was, root)).catch(() => undefined);
}

async function reload(reason, target = null) {
  if (target) wanted = target;
  if (reloading) {
    reloadAgain = true;
    return;
  }
  reloading = true;
  try {
    do {
      reloadAgain = false;
      const next = wanted ?? root;
      wanted = null;
      inflight = next;
      if (next === root) log(`[engine] code changed (${reason}); finishing running jobs, then reloading`);
      else log(`[engine] app switched to ${releaseLabel(next)} (from ${releaseLabel(root)}); running jobs finish on the release they started with, new jobs run on the new one`);
      await retireCurrent();
      if (stopping) return;
      if (next === root) {
        await invalidate(root);
        await loadUntilItWorks(root);
      } else if (!(await loadRelease(next))) {
        refused = { dir: next, at: Date.now() };
        log(`[engine] ${releaseLabel(next)} refused: the worker goes on with ${releaseLabel(root)} (roll the link back, or install a fixed release)`);
        await invalidate(root);
        await loadUntilItWorks(root);
      } else {
        refused = null;
      }
      inflight = null;
    } while (reloadAgain && !stopping);
  } finally {
    inflight = null;
    reloading = false;
  }
}

let linkWatch = null;
if (releaseMode) {
  log(`[engine] app ${releaseLabel(startRoot)}; release link ${appLink}, checked every ${releasePollMs} ms`);
  linkWatch = watchReleaseLink({
    link: appLink,
    current: () => wanted ?? inflight ?? root,
    refused: () => (refused && Date.now() - refused.at < REFUSED_RETRY_MS ? refused.dir : null),
    everyMs: releasePollMs,
    log,
    onSwitch: (target) => void reload(`release ${releaseIdOf(target) ?? target}`, target),
  });
} else {
  // a checkout: its files change in place, so its server watches them (and stays for the life of the process)
  const { watcher } = await pool.acquire(startRoot);
  let reloadTimer = null;
  const onFile = (file) => {
    if (!WATCHED.test(file) || /\.test\.ts$/.test(file)) return;
    const rel = path.relative(startRoot, file);
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void reload(rel);
    }, 1500);
  };
  watcher.on("change", onFile);
  watcher.on("add", onFile);
  watcher.on("unlink", onFile);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`[engine] ${signal}: stopping (running jobs stay claimed and are resumed by the next start)`);
  linkWatch?.stop();
  try {
    await worker?.impl.stop();
  } catch {
    /* stopping anyway */
  }
  try {
    if (Number(fs.readFileSync(pidFile, "utf8").trim()) === process.pid) fs.unlinkSync(pidFile);
  } catch {
    /* gone */
  }
  await pool.closeAll().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log(`[engine] unhandled: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`));

await loadUntilItWorks(startRoot);
