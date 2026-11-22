// Release folders on the engine host (engine-host/install-engine-vm.sh). The app lives in
// <bridge>/releases/<id>/selise-madp/frontend, and <bridge>/app is a link to the release new jobs use. A release is never
// changed once installed: the install writes a new release and then switches the link in one step.
//
// The worker resolves the link to a concrete release folder once per code generation (start.mjs). Its jobs run on the
// files of that release to their end, also after the link moved on; the next generation loads the release the link
// names. Plain JavaScript, so start.mjs imports it before Vite is up.
import fs from "node:fs";
import path from "node:path";

/** The worker's entry module, relative to a frontend folder. A folder without it is not one the worker can load. */
export const WORKER_ENTRY = "server/blocks/engineWorker/worker.ts";
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A folder with every link in its path resolved (the same folder for as long as it exists, whatever links change). */
export function concreteDir(dir) {
  return fs.realpathSync(path.resolve(dir));
}

/** The id of the release a frontend folder belongs to (<…>/releases/<id>/selise-madp/frontend); null outside releases. */
export function releaseIdOf(frontend) {
  const parts = path.resolve(frontend).split(path.sep);
  const n = parts.length;
  if (n < 5 || parts[n - 1] !== "frontend" || parts[n - 2] !== "selise-madp" || parts[n - 4] !== "releases") return null;
  return RELEASE_ID.test(parts[n - 3]) ? parts[n - 3] : null;
}

/** "release <id>" or the folder itself, for log lines. */
export const releaseLabel = (frontend) => {
  const id = releaseIdOf(frontend);
  return id ? `release ${id}` : frontend;
};

/** The concrete folder the link names now; null while it cannot be resolved (missing, dangling). */
export function linkTarget(link) {
  try {
    return fs.realpathSync(link);
  } catch {
    return null;
  }
}

/** A frontend folder the worker may switch to: the worker entry is there and, inside a release, the release's
 *  INSTALLED.txt (written by the install after everything else, before the link moves). */
export function releaseReady(frontend) {
  if (!fs.existsSync(path.join(frontend, WORKER_ENTRY))) return false;
  return releaseIdOf(frontend) === null || fs.existsSync(path.join(frontend, "..", "INSTALLED.txt"));
}

/** Keeps a file of the release open while code of that release may still run. The install's prune looks at every
 *  process's open files, working folder, arguments and environment, so a pinned release is never removed. */
export function pinRelease(frontend) {
  let fd = null;
  try {
    fd = fs.openSync(path.join(frontend, "package.json"), "r");
  } catch {
    fd = null;
  }
  return () => {
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch {
      /* closed */
    }
    fd = null;
  };
}

/**
 * Polls the app link every `everyMs` and calls `onSwitch(target)` when it names a ready concrete folder other than
 * `current()` (the folder the worker runs or is switching to) and other than `refused()` (a release whose code did not
 * start). Returns { check, stop }: `check()` runs one poll at once.
 */
export function watchReleaseLink({ link, current, onSwitch, refused = () => null, everyMs = 5000, log = () => {} }) {
  let timer = null;
  let stopped = false;
  let waiting = null;
  const check = () => {
    const target = linkTarget(link);
    if (!target || target === current() || target === refused()) {
      waiting = null;
      return;
    }
    if (!releaseReady(target)) {
      if (waiting !== target) log(`[engine] the app link names ${releaseLabel(target)}, which is not complete yet; waiting`);
      waiting = target;
      return;
    }
    waiting = null;
    onSwitch(target);
  };
  const loop = () => {
    if (stopped) return;
    try {
      check();
    } catch (e) {
      log(`[engine] app link check failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`);
    }
    timer = setTimeout(loop, everyMs);
  };
  // not unref'd: on the engine host this check keeps the worker process alive between generations
  timer = setTimeout(loop, everyMs);
  return {
    check,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * The module servers of the code generations still alive, one per release folder. `acquire(root)` gives a
 * generation the server of its folder (made on first use, the folder pinned); `release(root, current)` is called once
 * a generation ran its last job. A server is closed, and its folder unpinned, once no generation uses it and it is not
 * the current folder; `sweep(current)` does that after a switch.
 */
export function createServerPool({ create, log = () => {} }) {
  const entries = new Map();
  const close = async (root, e) => {
    entries.delete(root);
    e.unpin();
    try {
      const server = await e.server;
      await server.close();
    } catch {
      /* closed or never made */
    }
    log(`[engine] ${releaseLabel(root)}: no job runs on it any more; its code is unloaded`);
  };
  const sweep = async (current) => {
    const idle = [...entries].filter(([root, e]) => e.users === 0 && root !== current);
    for (const [root, e] of idle) await close(root, e);
  };
  return {
    async acquire(root) {
      let e = entries.get(root);
      if (!e) {
        e = { server: Promise.resolve().then(() => create(root)), users: 0, unpin: pinRelease(root) };
        entries.set(root, e);
      }
      e.users += 1;
      try {
        return await e.server;
      } catch (err) {
        e.users -= 1;
        if (e.users === 0 && entries.get(root) === e) {
          entries.delete(root);
          e.unpin();
        }
        throw err;
      }
    },
    async release(root, current) {
      const e = entries.get(root);
      if (!e) return;
      e.users = Math.max(0, e.users - 1);
      await sweep(current);
    },
    sweep,
    /** The server of a folder when one is loaded (a lookup: no generation is counted). */
    server: (root) => entries.get(root)?.server ?? null,
    /** The folders whose code is loaded now, with the number of generations on each. */
    loaded: () => [...entries].map(([root, e]) => ({ root, users: e.users })),
    async closeAll() {
      const all = [...entries.values()];
      entries.clear();
      for (const e of all) {
        e.unpin();
        try {
          await (await e.server).close();
        } catch {
          /* closing anyway */
        }
      }
    },
  };
}
