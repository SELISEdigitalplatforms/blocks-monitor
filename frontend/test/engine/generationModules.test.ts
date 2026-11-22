// The engine worker keeps one process across installs: each release's code is a new code generation in the same
// process (server/blocks/engineWorker/start.mjs). A package that keeps process-wide state must never be loaded into
// that process, or the second release's copy of it breaks:
//   - @playwright/test refuses a second copy ("Requiring @playwright/test second time"), so after any install the
//     whole scope group of writers (design, scope draft, board plan, ...) could not be loaded and its jobs waited forever;
//   - pdfjs-dist (pdf-parse) uses the worker handler the first copy put on globalThis, so a release with another pdfjs
//     version could not read any PDF.
// Here the real start.mjs runs two releases, each a copy of this frontend with its own copies of those packages
// (release B's pdfjs one version up, as after an upgrade), and the design and PDF paths run on both generations.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULES = fs.realpathSync(path.join(FRONTEND, "node_modules"));
/** The packages each release gets its own copy of (the others are links to this checkout's). */
const OWN = new Set(["playwright", "playwright-core", "@playwright/test", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas", "@napi-rs/canvas-linux-x64-gnu"]);
const SOURCES = ["server", "src", "functions", "seed", "package.json", "tsconfig.json"];
const PDF = path.join(FRONTEND, "test", "engine", "fixtures", "minutes.pdf");

const made: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A release's node_modules: its own copies of OWN, links for the rest. */
function modulesOf(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(MODULES)) {
    if (entry === ".bin" || entry.startsWith(".")) continue;
    const from = path.join(MODULES, entry);
    if (entry.startsWith("@")) {
      fs.mkdirSync(path.join(dir, entry), { recursive: true });
      for (const sub of fs.readdirSync(from)) {
        const name = `${entry}/${sub}`;
        if (OWN.has(name)) fs.cpSync(path.join(from, sub), path.join(dir, entry, sub), { recursive: true });
        else fs.symlinkSync(fs.realpathSync(path.join(from, sub)), path.join(dir, entry, sub));
      }
    } else if (OWN.has(entry)) fs.cpSync(from, path.join(dir, entry), { recursive: true });
    else fs.symlinkSync(fs.realpathSync(from), path.join(dir, entry));
  }
}

/** Release B's pdfjs-dist one patch version up (API and worker alike), as an install that upgraded it. */
function bumpPdfjs(modules: string): void {
  const version = JSON.parse(fs.readFileSync(path.join(modules, "pdfjs-dist", "package.json"), "utf8")).version as string;
  const parts = version.split(".").map(Number);
  const next = `${parts[0]}.${parts[1]}.${parts[2]! + 1}`;
  for (const f of ["pdf.mjs", "pdf.worker.mjs"]) {
    const file = path.join(modules, "pdfjs-dist", "legacy", "build", f);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(`"${version}"`, `"${next}"`));
  }
}

// The worker of each release: the real design and PDF paths of that release, then what this process holds.
const WORKER = `import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
export async function startWorker(o: { root: string }) {
  const id = path.basename(path.resolve(o.root, "..", ".."));
  const note = (line: string) => fs.appendFileSync(String(process.env.TEST_RELEASE_OUT), id + " " + line + "\\n");
  const first = (e: unknown) => String(e instanceof Error ? e.message : e).split("\\n")[0];
  let markFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { markFinished = resolve; });
  note("started");
  void (async () => {
    try {
      const kinds = await import("../../local/engine/kinds/index.ts");
      await kinds.writerOf("design.generate");
      note("design writer loaded");
    } catch (e) { note("design writer failed: " + first(e)); }
    try {
      const design = await import("../../local/engine/kinds/scope/factoryDesign.ts");
      await design.smokeFactoryDesign("<!doctype html><html><head><meta name=viewport content='width=device-width'></head><body><h1>Orders</h1><p>Two open orders.</p></body></html>");
      note("design check passed");
    } catch (e) { note("design check failed: " + first(e)); }
    try {
      const screens = await import("../../local/engine/kinds/scope/screenHtml.ts");
      const renderer = screens.screenRenderer({ mode: "html" });
      try {
        const shot = await renderer.render({ device: "mobile", brand: "1f5fae", app: "Orders", title: "Open orders", blocks: [{ k: "heading", text: "Two open orders" }] });
        note("screen drawn with " + shot.via);
      } finally { await renderer.close(); }
    } catch (e) { note("screen failed: " + first(e)); }
    try {
      const pdf = await import("../../api/extraction/pdf.ts");
      const r = await pdf.extractPdf(fs.readFileSync(String(process.env.TEST_PDF)), "minutes.pdf");
      note("pdf read: " + r.totalPages + " page(s)");
    } catch (e) { note("pdf failed: " + first(e)); }
    const loaded = Object.keys(createRequire(import.meta.url).cache);
    note("in the worker process: playwright " + loaded.some((k) => k.includes("/node_modules/playwright")) + ", pdfjs " + ((globalThis as { pdfjsWorker?: unknown }).pdfjsWorker !== undefined));
    note("done");
  })();
  return {
    drain() {},
    working: () => [],
    async stop() { markFinished(); },
    finished: () => finished,
  };
}
`;

function release(base: string, id: string): string {
  const fe = path.join(base, "releases", id, "selise-madp", "frontend");
  fs.mkdirSync(fe, { recursive: true });
  for (const s of SOURCES) fs.cpSync(path.join(FRONTEND, s), path.join(fe, s), { recursive: true });
  fs.writeFileSync(path.join(fe, "server", "blocks", "engineWorker", "worker.ts"), WORKER);
  modulesOf(path.join(fe, "node_modules"));
  fs.writeFileSync(path.join(base, "releases", id, "selise-madp", "INSTALLED.txt"), `${id}\n`);
  return fe;
}

function pointLink(link: string, target: string): void {
  const next = `${link}.next`;
  fs.rmSync(next, { force: true });
  fs.symlinkSync(target, next);
  fs.renameSync(next, link);
}

describe.runIf(process.platform === "linux")("two code generations in one engine worker process", () => {
  it("each release's design and PDF work runs on its own copies of Playwright and pdfjs, never in the worker process", async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "madp-generations-")));
    made.push(base);
    release(base, "A");
    const b = release(base, "B");
    bumpPdfjs(path.join(b, "node_modules"));
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
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright"),
        MF_ENGINE_APP_LINK: path.join(app, "selise-madp", "frontend"),
        ENGINE_RELEASE_POLL_MS: "150",
        ENGINE_HOST_DIR: path.join(base, "host"),
        TEST_RELEASE_OUT: out,
        TEST_PDF: PDF,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout!.on("data", (d: Buffer) => (log += d.toString()));
    child.stderr!.on("data", (d: Buffer) => (log += d.toString()));
    const notes = () => fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean);
    const until = (what: () => boolean, ms = 90_000) =>
      vi.waitFor(() => {
        if (!what()) throw new Error(`still waiting; the worker's log:\n${log.slice(-3000)}\nnotes:\n${notes().join("\n")}`);
      }, { timeout: ms, interval: 100 });
    const of = (id: string) => notes().filter((n) => n.startsWith(`${id} `)).map((n) => n.slice(id.length + 1));

    await until(() => of("A").includes("done"));
    pointLink(app, "releases/B");
    await until(() => log.includes("code generation 2 loaded (release B)"));
    await until(() => of("B").includes("done"));

    const a = of("A");
    const bNotes = of("B");
    // the second generation loads the design writers and reads PDFs like the first one
    expect(bNotes, notes().join("\n")).toContain("design writer loaded");
    expect(bNotes).toContain("pdf read: 1 page(s)");
    expect(a).toContain("design writer loaded");
    expect(a).toContain("pdf read: 1 page(s)");
    // the browser work gives the same answers on both (Chromium where its build is installed, else the fallbacks)
    expect(bNotes.find((n) => n.startsWith("design check"))).toBe(a.find((n) => n.startsWith("design check")));
    expect(bNotes.find((n) => n.startsWith("screen"))).toBe(a.find((n) => n.startsWith("screen")));
    expect(bNotes.join("\n")).not.toContain("second time");
    // neither generation loaded Playwright or pdfjs into the worker's own process
    expect(a).toContain("in the worker process: playwright false, pdfjs false");
    expect(bNotes).toContain("in the worker process: playwright false, pdfjs false");
    // and every helper process ended with its work
    await until(() => fs.readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, "utf8").trim() === "", 15_000);

    child.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
    expect(code).toBe(0);
  }, 180_000);
});
