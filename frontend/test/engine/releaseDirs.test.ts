// Release folders on the engine host (engine-host/install-engine-vm.sh): <bridge>/app is a link to
// releases/<id>, switched in one step by the install. Running work keeps the files of the release it started with;
// new work and the worker's next code generation use the release the link names.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  concreteDir, createServerPool, linkTarget, pinRelease, releaseIdOf, releaseReady, watchReleaseLink,
} from "../../server/blocks/engineWorker/release.mjs";
import { concretePath, officialHome, stableOfficialHome } from "../../server/local/engine/official/home.ts";
import { runLane } from "../../server/local/engine/official/madp.ts";
import { briefServer } from "../../server/engine-context/mcp.ts";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const made: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.MF_MADP_ENGINE_HOME;
  delete process.env.MF_MADP_PYTHON;
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "madp-releases-"));
  made.push(d);
  return concreteDir(d);
}

/** The link switch the install does: a new link, renamed over the old one (one step). */
function pointLink(link: string, target: string): void {
  const next = `${link}.next`;
  fs.rmSync(next, { force: true });
  fs.symlinkSync(target, next);
  fs.renameSync(next, link);
}

/** A release <base>/releases/<id> with the worker entry and, when complete, its INSTALLED.txt. */
function release(base: string, id: string, complete = true): string {
  const fe = path.join(base, "releases", id, "selise-madp", "frontend");
  fs.mkdirSync(path.join(fe, "server", "blocks", "engineWorker"), { recursive: true });
  fs.writeFileSync(path.join(fe, "server", "blocks", "engineWorker", "worker.ts"), "export {};\n");
  fs.writeFileSync(path.join(fe, "package.json"), `{"name":"release-${id}","private":true,"type":"module"}\n`);
  if (complete) fs.writeFileSync(path.join(base, "releases", id, "selise-madp", "INSTALLED.txt"), `${id}\n`);
  return fe;
}

/** The targets of this process's open files (Linux). */
const openFiles = (): string[] =>
  fs.readdirSync("/proc/self/fd").map((fd) => {
    try {
      return fs.readlinkSync(path.join("/proc/self/fd", fd));
    } catch {
      return "";
    }
  });

describe("release folders", () => {
  it("names the release of a frontend folder, and nothing outside releases", () => {
    expect(releaseIdOf("/srv/madp-factory/bridge/releases/e8e8afd2-20261109T213000Z/selise-madp/frontend")).toBe("e8e8afd2-20261109T213000Z");
    expect(releaseIdOf("/srv/madp-factory/bridge/app/selise-madp/frontend")).toBeNull();
    expect(releaseIdOf("/home/u/selise-madp/frontend")).toBeNull();
    expect(releaseIdOf("/srv/x/releases/../selise-madp/frontend")).toBeNull();
  });

  it("resolves the link to the concrete release, and a release is ready only with its INSTALLED.txt", () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const half = release(base, "bbbbbbb-20261109T110000Z", false);
    const app = path.join(base, "app");
    fs.symlinkSync("releases/aaaaaaa-20261109T100000Z", app);
    expect(linkTarget(path.join(app, "selise-madp", "frontend"))).toBe(a);
    expect(releaseReady(a)).toBe(true);
    expect(releaseReady(half)).toBe(false);
    expect(linkTarget(path.join(base, "no-link"))).toBeNull();
  });

  it("calls onSwitch once per new complete target; waits for an incomplete one; skips a refused one", () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const b = release(base, "bbbbbbb-20261109T110000Z");
    const c = release(base, "ccccccc-20261109T120000Z", false);
    const app = path.join(base, "app");
    pointLink(app, "releases/aaaaaaa-20261109T100000Z");
    let current = a;
    let refused: string | null = null;
    const switched: string[] = [];
    const lines: string[] = [];
    const watch = watchReleaseLink({
      link: path.join(app, "selise-madp", "frontend"),
      current: () => current,
      refused: () => refused,
      everyMs: 60_000,
      log: (l) => lines.push(l),
      onSwitch: (t) => {
        switched.push(t);
        current = t; // what start.mjs does: the switch target counts as current while it loads
      },
    });
    try {
      watch.check();
      expect(switched).toEqual([]);
      pointLink(app, "releases/bbbbbbb-20261109T110000Z");
      watch.check();
      watch.check();
      expect(switched).toEqual([b]);
      pointLink(app, "releases/ccccccc-20261109T120000Z");
      watch.check();
      watch.check();
      expect(switched).toEqual([b]);
      expect(lines.filter((l) => l.includes("not complete yet"))).toHaveLength(1);
      fs.writeFileSync(path.join(path.dirname(c), "INSTALLED.txt"), "done\n");
      refused = c;
      watch.check();
      expect(switched).toEqual([b]);
      refused = null;
      watch.check();
      expect(switched).toEqual([b, c]);
    } finally {
      watch.stop();
    }
  });

  it.runIf(process.platform === "linux")("pins a release by an open file of it, and lets go", () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const unpin = pinRelease(a);
    expect(openFiles()).toContain(path.join(a, "package.json"));
    unpin();
    unpin();
    expect(openFiles()).not.toContain(path.join(a, "package.json"));
  });
});

describe("the module servers of the generations", () => {
  const fake = (root: string) => ({ root, close: vi.fn(async () => undefined) });

  it("makes one server per folder and closes an old one only after its last generation, never the current one", async () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const b = release(base, "bbbbbbb-20261109T110000Z");
    const create = vi.fn(fake);
    const pool = createServerPool({ create });
    const s1 = await pool.acquire(a);
    const s2 = await pool.acquire(a);
    expect(s1).toBe(s2);
    expect(create).toHaveBeenCalledTimes(1);
    await pool.release(a, a);
    await pool.release(a, a);
    expect(s1.close).not.toHaveBeenCalled(); // the current folder stays loaded
    const sb = await pool.acquire(b);
    await pool.sweep(b);
    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(sb.close).not.toHaveBeenCalled();
    expect(pool.loaded()).toEqual([{ root: b, users: 1 }]);
    if (process.platform === "linux") {
      expect(openFiles()).not.toContain(path.join(a, "package.json"));
      expect(openFiles()).toContain(path.join(b, "package.json"));
    }
    await pool.closeAll();
    expect(sb.close).toHaveBeenCalledTimes(1);
  });

  it("an old release with a job still running stays loaded after the switch, then unloads", async () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const b = release(base, "bbbbbbb-20261109T110000Z");
    const pool = createServerPool({ create: fake });
    const sa = await pool.acquire(a); // generation 1 (a job running)
    await pool.acquire(b); // generation 2 after the switch
    await pool.sweep(b);
    expect(sa.close).not.toHaveBeenCalled();
    await pool.release(a, b); // generation 1 ran its last job
    expect(sa.close).toHaveBeenCalledTimes(1);
    expect(pool.server(a)).toBeNull();
  });

  it("a server that cannot be made leaves nothing behind", async () => {
    const base = tmp();
    const a = release(base, "aaaaaaa-20261109T100000Z");
    const pool = createServerPool({ create: () => Promise.reject(new Error("broken")) });
    await expect(pool.acquire(a)).rejects.toThrow("broken");
    expect(pool.loaded()).toEqual([]);
    if (process.platform === "linux") expect(openFiles()).not.toContain(path.join(a, "package.json"));
  });
});

describe("the official engine's folder", () => {
  it("is concrete: a lane gets the release the link names when it starts", () => {
    const base = tmp();
    for (const id of ["a", "b"]) fs.mkdirSync(path.join(base, "releases", id, "engine"), { recursive: true });
    const link = path.join(base, "app");
    pointLink(link, path.join(base, "releases", "a"));
    process.env.MF_MADP_ENGINE_HOME = path.join(link, "engine");
    expect(officialHome()).toBe(path.join(base, "releases", "a", "engine"));
    pointLink(link, path.join(base, "releases", "b"));
    expect(officialHome()).toBe(path.join(base, "releases", "b", "engine"));
    expect(concretePath(path.join(base, "missing"))).toBe(path.join(base, "missing"));
  });

  it("a product's registry gets the engine folder through the link, which outlives every release", () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, "releases", "a", "selise-madp", "engine", "selise-madp"), { recursive: true });
    fs.mkdirSync(path.join(base, "releases", "a", "selise-madp", "frontend"), { recursive: true });
    pointLink(path.join(base, "app"), path.join(base, "releases", "a"));
    const env = { MF_ENGINE_APP_LINK: path.join(base, "app", "selise-madp", "frontend") };
    expect(stableOfficialHome(env)).toBe(path.join(base, "app", "selise-madp", "engine", "selise-madp"));
    expect(stableOfficialHome({ ...env, MF_MADP_ENGINE_HOME: "/opt/madp" })).toBe("/opt/madp");
    // without the link (a checkout) it is the checkout's own engine folder, as officialHome names it
    expect(stableOfficialHome({})).toBe(officialHome({}));
  });

  it("the MCP brief server named through a link is the concrete file", () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, "releases", "a"), { recursive: true });
    fs.writeFileSync(path.join(base, "releases", "a", "index.mjs"), "");
    pointLink(path.join(base, "app"), path.join(base, "releases", "a"));
    expect(briefServer({ MF_MCP_BRIEF_SERVER: path.join(base, "app", "index.mjs") })).toBe(path.join(base, "releases", "a", "index.mjs"));
  });

  it("a running lane keeps its release when the link moves to a new one", async () => {
    const base = tmp();
    for (const id of ["a", "b"]) {
      const home = path.join(base, "releases", id, "engine");
      fs.mkdirSync(path.join(home, "MADP", "orchestrator", "cli"), { recursive: true });
      fs.writeFileSync(path.join(home, "MADP", "orchestrator", "cli", "project.py"), "");
      fs.writeFileSync(path.join(home, "VERSION"), `release-${id}\n`);
    }
    const link = path.join(base, "app");
    pointLink(link, path.join(base, "releases", "a"));
    const go = path.join(base, "go");
    // the lane: where it runs at its start, then (after the link moved) what it reads from its folder and its home
    const py = path.join(base, "fake-python.sh");
    fs.writeFileSync(py, [
      "#!/bin/sh",
      'echo "start cwd=$(pwd -P) home=$MADP_FRAMEWORK_HOME"',
      `while [ ! -f "${go}" ]; do sleep 0.05; done`,
      'echo "later cwd=$(pwd -P) relative=$(cat VERSION) home=$(cat "$MADP_FRAMEWORK_HOME/VERSION")"',
    ].join("\n"), { mode: 0o755 });
    process.env.MF_MADP_ENGINE_HOME = path.join(link, "engine");
    process.env.MF_MADP_PYTHON = py;
    const run = { id: "job-1", signal: new AbortController().signal, heartbeat: async () => undefined, log: () => undefined, check: () => undefined };
    const lane = runLane(run as never, ["feature"], { projectDir: path.join(base, "project"), label: "feature", timeoutMs: 20_000 });
    await vi.waitFor(() => {
      const logs = path.join(base, "project", "logs");
      const file = fs.existsSync(logs) ? fs.readdirSync(logs)[0] : undefined;
      expect(file && fs.readFileSync(path.join(logs, file), "utf8")).toContain("start cwd=");
    }, { timeout: 10_000 });
    pointLink(link, path.join(base, "releases", "b"));
    fs.writeFileSync(go, "");
    const r = await lane;
    const a = path.join(base, "releases", "a", "engine");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`start cwd=${a} home=${a}`);
    expect(r.stdout).toContain(`later cwd=${a} relative=release-a home=release-a`);
    // the next lane starts on the new release
    fs.rmSync(go);
    fs.writeFileSync(go, "");
    const next = await runLane(run as never, ["feature"], { projectDir: path.join(base, "project"), label: "feature", timeoutMs: 20_000 });
    expect(next.stdout).toContain(`home=${path.join(base, "releases", "b", "engine")}`);
  });
});

// The real start.mjs on a release tree: a fake worker.ts per release, the app link switched under it.
describe.runIf(process.platform === "linux")("the engine worker on release folders", () => {
  const WORKER = `import fs from "node:fs";
import path from "node:path";
export async function startWorker(o: { root: string }) {
  const id = path.basename(path.resolve(o.root, "..", ".."));
  const note = (line: string) => fs.appendFileSync(String(process.env.TEST_RELEASE_OUT), id + " " + line + "\\n");
  const jobMs = Number(process.env["TEST_JOB_MS_" + id] ?? "0");
  let running = jobMs > 0;
  let draining = false;
  let stopped = false;
  let markFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { markFinished = resolve; });
  note("started");
  if (running) setTimeout(() => {
    void import("./late.ts").then((late) => {
      note("job read " + late.WHICH + " from " + late.FROM);
      running = false;
      if (stopped) markFinished();
    });
  }, jobMs);
  return {
    drain() { draining = true; },
    working: () => (draining || !running ? [] : ["job-1"]),
    async stop() { stopped = true; note("stopped"); if (!running) markFinished(); },
    finished: () => finished,
  };
}
`;

  function workerRelease(base: string, id: string, worker = WORKER): string {
    const fe = release(base, id);
    const dir = path.join(fe, "server", "blocks", "engineWorker");
    for (const f of ["start.mjs", "release.mjs"]) fs.copyFileSync(path.join(FRONTEND, "server", "blocks", "engineWorker", f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, "worker.ts"), worker);
    fs.writeFileSync(path.join(dir, "late.ts"), `export const WHICH = "${id}";\nexport const FROM = import.meta.url;\n`);
    fs.symlinkSync(path.join(FRONTEND, "node_modules"), path.join(fe, "node_modules"));
    return fe;
  }

  it("new jobs run on the switched release, running ones finish on theirs; a broken release is refused", async () => {
    const base = tmp();
    const a = workerRelease(base, "A");
    const b = workerRelease(base, "B");
    workerRelease(base, "C", 'throw new Error("broken release C");\nexport {};\n');
    release(base, "D", false);
    const app = path.join(base, "app");
    pointLink(app, "releases/A");
    const out = path.join(base, "notes.txt");
    fs.writeFileSync(out, "");
    let log = "";
    const child = spawn(process.execPath, [path.join(app, "selise-madp", "frontend", "server", "blocks", "engineWorker", "start.mjs")], {
      cwd: base,
      env: {
        PATH: process.env.PATH,
        HOME: base,
        MF_ENGINE_APP_LINK: path.join(app, "selise-madp", "frontend"),
        ENGINE_RELEASE_POLL_MS: "150",
        ENGINE_HOST_DIR: path.join(base, "host"),
        TEST_RELEASE_OUT: out,
        TEST_JOB_MS_A: "2500",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout!.on("data", (d: Buffer) => (log += d.toString()));
    child.stderr!.on("data", (d: Buffer) => (log += d.toString()));
    const notes = () => fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean);
    // a wait that fails shows what the worker said
    const until = (what: () => boolean, ms = 20_000) =>
      vi.waitFor(() => {
        if (!what()) throw new Error(`still waiting; the worker's log:\n${log.slice(-3000)}\nnotes:\n${notes().join("\n")}`);
      }, { timeout: ms, interval: 50 });

    await until(() => log.includes("code generation 1 loaded (release A)"));
    expect(log).toContain("app release A; release link");
    pointLink(app, "releases/B");
    await until(() => log.includes("code generation 2 loaded (release B)"));
    expect(log).toContain("app switched to release B (from release A)");
    // A's job was handed over: it reads its own release's file after the switch, then A unloads
    await until(() => notes().some((n) => n.startsWith("A job read")));
    const read = notes().find((n) => n.startsWith("A job read"))!;
    expect(read).toContain(`job read A from file://${path.join(a, "server", "blocks", "engineWorker", "late.ts")}`);
    expect(notes().indexOf("B started")).toBeLessThan(notes().indexOf(read));
    await until(() => log.includes("release A: no job runs on it any more"));
    const fds = fs.readdirSync(`/proc/${child.pid}/fd`).map((f) => {
      try {
        return fs.readlinkSync(`/proc/${child.pid}/fd/${f}`);
      } catch {
        return "";
      }
    });
    expect(fds).toContain(path.join(b, "package.json"));
    expect(fds).not.toContain(path.join(a, "package.json"));

    // an incomplete release: the worker waits; a broken one: refused, the worker goes on with B
    pointLink(app, "releases/D");
    await until(() => log.includes("names release D, which is not complete yet"));
    pointLink(app, "releases/C");
    await until(() => log.includes("release C refused: the worker goes on with release B"));
    expect(log).toContain("release C did not start (3x)");
    await until(() => log.includes("code generation 3 loaded (release B)"));
    expect(log).not.toContain("loaded (release C)");
    expect(log).not.toContain("loaded (release D)");

    // a rollback to A, whose code was unloaded: loaded again, and B unloads (no job ran on it)
    pointLink(app, "releases/A");
    await until(() => log.includes("code generation 4 loaded (release A)"));
    await until(() => log.includes("release B: no job runs on it any more"));
    expect(notes().filter((n) => n === "A started")).toHaveLength(2);

    child.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(base, "host", "engine-worker.pid"))).toBe(false);
  }, 60_000);
});
