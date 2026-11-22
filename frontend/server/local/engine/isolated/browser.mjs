// Chromium through Playwright for the engine, run in a child process (host.ts, child.mjs): Playwright is never loaded
// into the engine worker's own process, where each installed release would add its own copy and @playwright/test
// refuses a second one.
//
//   smoke         the check of a Factory design (kinds/scope/factoryDesign.ts): a clean headless browser, no network
//                 but the design's own page, under the review sandbox's Content-Security-Policy; a blank page, a runtime
//                 error or a phone layout wider than the phone fails it. Chromium of `playwright`, the one
//                 @playwright/test gives (the same object), without loading the test runner.
//   launch, shot  the screen pictures (kinds/scope/screenHtml.ts): one Chromium per renderer, one page per device,
//                 the page's HTML photographed into a PNG. Chromium of `playwright-core`.
//
// Each keeps the library, and so the browser build, it had in the worker process, with the same time limits.
import http from "node:http";

export const withTimeout = (p, ms, what) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/** The design check with the given Chromium (BrowserType). Throws a plain sentence when the design fails it. */
export async function checkDesign(chromium, { html, csp }) {
  const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": csp }); res.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => route.request().url() === url ? route.continue() : route.abort());
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    if (!(await page.locator("body").innerText()).trim() || errors.length) throw new Error("The prototype is blank or has a runtime error.");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error("The phone preview overflows horizontally.");
  } finally { await browser?.close(); await new Promise((resolve) => server.close(() => resolve())); }
}

/** The renderer's browser (launch) and its page per device (shot). */
let browser = null;
const pages = new Map();

export const handlers = {
  async smoke(p) {
    const { chromium } = await import("playwright");
    await checkDesign(chromium, p);
    return true;
  },
  async launch({ args }) {
    if (browser) return true;
    const pw = await import("playwright-core");
    browser = await withTimeout(pw.chromium.launch({ headless: true, args }), 20_000, "Chromium start");
    return true;
  },
  async shot({ device, width, height, scale, html }) {
    if (!browser) throw new Error("no browser");
    let p = pages.get(device);
    if (!p) {
      const b = browser;
      p = (async () => {
        const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
        return ctx.newPage();
      })();
      pages.set(device, p);
    }
    const page = await p;
    await withTimeout(page.setContent(html, { waitUntil: "load", timeout: 15_000 }), 16_000, "page");
    await withTimeout(page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true"), 5_000, "fonts");
    const png = await withTimeout(page.screenshot({ type: "png", timeout: 15_000 }), 16_000, "screenshot");
    return new Uint8Array(png);
  },
};

export async function cleanup() {
  const b = browser;
  browser = null;
  pages.clear();
  if (b) await b.close().catch(() => undefined);
}
