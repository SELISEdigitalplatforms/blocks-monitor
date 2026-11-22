// The helper processes of the engine (server/local/engine/isolated): work that needs a package with process-wide state
// (Playwright, pdf-parse) runs in a child process started from the folder of the code that asks for it, never in the
// engine worker's own process. The child answers calls, keeps the errors' names, is closed past a call's limit, and
// ends (with its Chromium) when it is closed or its parent process ends.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedEntry, runIsolated, startIsolated, type IsolatedChild, type IsolatedTask } from "../../server/local/engine/isolated/host.ts";
import { checkDesign } from "../../server/local/engine/isolated/browser.mjs";
import { DESIGN_PREVIEW_CSP } from "../../server/security/designPreview.ts";
import { textPdf } from "../extraction/pdfFixture";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const open: IsolatedChild[] = [];
const spawned: ChildProcess[] = [];
const made: string[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) await c.close();
  for (const c of spawned.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function helper(task: IsolatedTask): IsolatedChild {
  const c = startIsolated(task);
  open.push(c);
  return c;
}

/** True while the process runs (a zombie has ended). */
const running = (pid: number): boolean => {
  try {
    return !/\) [ZX] /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
};
/** Every process below this one (Linux). */
const descendants = (pid: number): number[] => {
  let kids: number[] = [];
  try {
    kids = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
  } catch {
    /* gone */
  }
  return kids.flatMap((k) => [k, ...descendants(k)]);
};

describe("the engine's helper processes", () => {
  it("start from the folder of the code that asks for them, so from that code's release", () => {
    expect(isolatedEntry()).toBe(path.join(FRONTEND, "server", "local", "engine", "isolated", "child.mjs"));
  });

  it("answer calls, and an error keeps its name and message", async () => {
    const pdf = helper("pdf");
    const read = await pdf.call<{ total: number; pages: { num: number; text: string }[] }>("text", { data: new Uint8Array(textPdf(["Owners approve releases."])), maxPages: 5 });
    expect(read.total).toBe(1);
    expect(read.pages).toEqual([{ num: 1, text: expect.stringContaining("Owners approve releases.") }]);
    const broken = await pdf.call("text", { data: new TextEncoder().encode("%PDF-1.4\nbroken"), maxPages: 5 }).catch((e: unknown) => e);
    expect(broken).toBeInstanceOf(Error);
    expect((broken as Error).name).toMatch(/^[A-Z]\w*Exception$/); // pdfjs's own error, as in the worker process before
    await expect(pdf.call("nothing")).rejects.toThrow("The pdf helper has no operation nothing");
    expect(pdf.alive).toBe(true);
  });

  it("is closed when a call runs past its limit, and ends on close()", async () => {
    const browser = helper("browser");
    await expect(browser.call("launch", { args: [] }, { timeoutMs: 50 })).rejects.toThrow("The browser helper did not answer within");
    await vi.waitFor(() => expect(browser.alive).toBe(false), { timeout: 10_000 });
    await expect(browser.call("launch", { args: [] })).rejects.toThrow("The browser helper is not running");
    const pdf = helper("pdf");
    await pdf.close();
    expect(pdf.alive).toBe(false);
  });

  it.runIf(process.platform === "linux")("leaves no process behind after one call", async () => {
    const before = new Set(descendants(process.pid));
    await expect(runIsolated("pdf", "text", { data: new Uint8Array(textPdf(["One page."])), maxPages: 5 })).resolves.toMatchObject({ total: 1 });
    await expect(runIsolated("browser", "shot", { device: "mobile", width: 390, height: 844, scale: 2, html: "<p>x</p>" })).rejects.toThrow("no browser");
    expect(descendants(process.pid).filter((p) => !before.has(p) && running(p))).toEqual([]);
  });

  it.runIf(process.platform === "linux")("ends, with its Chromium, when its parent process ends", async () => {
    // a parent that starts a browser helper (as the engine worker does) and is then killed outright
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "madp-isolated-")));
    made.push(dir);
    const script = path.join(dir, "parent.mjs");
    fs.writeFileSync(script, [
      'import { fork } from "node:child_process";',
      'const child = fork(process.argv[2], ["browser"], { serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [] });',
      'child.on("message", (m) => process.stdout.write(JSON.stringify({ child: child.pid, launched: m.ok === true }) + "\\n"));',
      'child.send({ id: 1, op: "launch", payload: { args: [] } });',
      "setInterval(() => undefined, 1000);",
    ].join("\n"));
    const parent = spawn(process.execPath, [script, isolatedEntry()], { stdio: ["ignore", "pipe", "inherit"] });
    spawned.push(parent);
    let out = "";
    parent.stdout!.on("data", (d: Buffer) => (out += d.toString()));
    await vi.waitFor(() => expect(out).toContain("\n"), { timeout: 60_000 });
    const { child, launched } = JSON.parse(out.trim()) as { child: number; launched: boolean };
    const below = descendants(child);
    if (launched) expect(below.length).toBeGreaterThan(0); // Chromium's processes
    parent.kill("SIGKILL");
    await vi.waitFor(() => {
      expect(running(child)).toBe(false);
      expect(below.filter(running)).toEqual([]);
    }, { timeout: 20_000, interval: 100 });
  }, 90_000);
});

// The design check of a Factory design, as browser.mjs runs it, with the Chromium this machine has (playwright-core's);
// the engine's own check uses `playwright`'s, as @playwright/test gave it before.
describe("the design check", () => {
  const csp = DESIGN_PREVIEW_CSP.replace("frame-ancestors 'self'", "frame-ancestors 'none'");

  it("passes a working page and names a blank, broken or too wide one (when Chromium starts here)", async () => {
    const { chromium } = await import("playwright-core");
    const here = await chromium.launch({ headless: true }).then((b) => b.close().then(() => true), () => false);
    if (!here) return; // no Chromium build on this machine for playwright-core
    const page = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>${body}</body></html>`;
    await expect(checkDesign(chromium, { html: page("<h1>Orders</h1><p>Two open orders.</p>"), csp })).resolves.toBeUndefined();
    await expect(checkDesign(chromium, { html: page(""), csp })).rejects.toThrow("The prototype is blank or has a runtime error.");
    await expect(checkDesign(chromium, { html: page("<p>Orders</p><script>missing()</script>"), csp })).rejects.toThrow("The prototype is blank or has a runtime error.");
    await expect(checkDesign(chromium, { html: page('<div style="width:900px">Orders</div>'), csp })).rejects.toThrow("The phone preview overflows horizontally.");
  }, 90_000);
});
