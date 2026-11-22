// Actual design component in an isolated browser, with fixture hooks: no account, API, billing or remote designs.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { buildCsp } from "../server/security/csp.ts";
import { makePreviewUrl } from "../src/domain/figmaMake.ts";
import { DESIGN_PREVIEW_HEADERS } from "../server/security/designPreview.ts";
import { screenGallery } from '../src/domain/figmaScreens.ts';

const liveArgument = process.argv.find((arg) => arg.startsWith("--live-preview="));
const livePreview = liveArgument ? makePreviewUrl(liveArgument.slice("--live-preview=".length)) : null;
if (liveArgument && !livePreview) throw new Error("--live-preview requires an HTTPS *.figma.site URL");

const root = fileURLToPath(new URL("../", import.meta.url));
const savedArg = process.argv.find((arg) => arg.startsWith('--saved-screens='));
const savedDir = savedArg ? path.resolve(root, '..', savedArg.slice('--saved-screens='.length)) : null;
const savedManifest = savedDir ? JSON.parse(readFileSync(path.join(savedDir, 'result.json'), 'utf8')).screens : [];
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==';
const nativeScreens = savedDir ? readdirSync(savedDir).filter((name) => name.endsWith('.png')).sort().map((file, i) => {
  const bytes = readFileSync(path.join(savedDir, file));
  return { name: savedManifest.find((s) => s.file === file)?.name ?? file.replace(/\.png$/, ''), nodeId: `${i + 1}:2`, requirementKeys: ['R-1'], png: bytes.toString('base64'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}) : [{ name: 'Order review', nodeId: '1:2', requirementKeys: ['R-1'], png: pixel, width: 390, height: 844 },
  { name: 'Desktop orders', nodeId: '2:2', requirementKeys: ['R-1'], png: pixel, width: 1440, height: 1000 }];
const temporaryBase = path.join(os.tmpdir(), "opencode");
mkdirSync(temporaryBase, { recursive: true });
const cacheDir = mkdtempSync(path.join(temporaryBase, "figma-ui-"));
const fixturePath = "/__figma-ui-state.js";
const fixture = `
import { useSyncExternalStore } from 'react';
import { automaticDesignDirection, designSource } from '/src/domain/figmaMake.ts';
const listeners = new Set();
let state = { brief: null, requirements: [], jobs: [], loading: true, editable: true };
const calls = [];
const notify = () => listeners.forEach(fn => fn());
const useState = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
const refetch = async () => {};
const generate = async args => {
  calls.push(args);
  const requirements = state.requirements.map(r => ({ key:r.key, title:r.title, text:r.detail, criteria:r.criteria }));
  const source = designSource(automaticDesignDirection(requirements), requirements);
  state = { ...state, brief: { id:'b1', mode:'figma', status:'draft' }, jobs: [{ id:'j1', status:'queued', progress:0,
    inputJson:JSON.stringify({ designBriefId:'b1', source }) }] };
  notify();
};
export const useDesignBrief = () => { const s=useState(); return { data:s.brief, isLoading:s.loading, isError:false, refetch }; };
export const useDesignContext = () => { const s=useState(); const rows=s.requirements.map(r=>({key:r.key,title:r.title,text:r.detail,criteria:r.criteria})); return { data:s.loading?null:{source:s.factorySource??designSource(automaticDesignDirection(rows),rows)}, isLoading:s.loading, isError:false }; };
export const useRequirements = () => { const s=useState(); return { data:s.requirements, isLoading:s.loading, isError:false }; };
export const useEngineJobs = () => { const s=useState(); return { data:s.jobs, isLoading:s.loading, isError:false }; };
export const useGenerateDesign = () => ({ mutateAsync:generate, isPending:false });
export const useConfirmDesignBrief = () => ({ mutateAsync:async () => {}, isPending:false });
export const requirementsErrorMessage = () => 'The design request could not be saved.';
window.figmaFixture = { set(value) { state={...state,...value}; notify(); }, calls,
  get brief() { return state.brief; },
  get source() { const rows=state.requirements.map(r=>({key:r.key,title:r.title,text:r.detail,criteria:r.criteria})); return designSource(automaticDesignDirection(rows),rows); } };
`;
const server = await createServer({
  configFile: false, envDir: false, root, cacheDir,
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "lucide-react", "clsx"] },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ['**/data/**'] } },
  resolve: { alias: [
    ...["@/blocks/requirements/hooks", "@/blocks/requirements/designContext", "@/blocks/requirements/mutations", "@/blocks/engine/jobs", "@/components/requirements/messages"].map(find => ({ find, replacement: fixturePath })),
    { find: /^@\//, replacement: `${path.join(root, "src")}/` },
  ] },
  plugins: [react(), {
    name: "figma-ui-fixture",
    resolveId(id) { if ([fixturePath, "/__figma-ui-main.js"].includes(id)) return id; },
    load(id) {
      if (id === fixturePath) return fixture;
      if (id === "/__figma-ui-main.js") return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MakeDesignPanel} from '/src/components/design/MakeDesignPanel.tsx'; import '/src/styles/index.css'; import '${fixturePath}'; const root=createRoot(document.getElementById('root')); window.mountDesign=(key,editable=true)=>root.render(React.createElement(React.StrictMode,null,React.createElement(MakeDesignPanel,{key,projectId:key,editable}))); window.mountDesign('loading');`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === `/api/design-preview/p1/${'b'.repeat(64)}/screens`) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ screens: nativeScreens })); return;
        }
        if (req.url === `/api/design-preview/p1/${'b'.repeat(64)}`) {
          res.writeHead(200, DESIGN_PREVIEW_HEADERS);
          res.end(screenGallery([{ name: 'Order review', png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==' }]));
          return;
        }
        if (req.url === `/api/design-preview/p1/${"a".repeat(64)}`) {
          res.writeHead(200, DESIGN_PREVIEW_HEADERS);
          res.end('<html><body><h1>Factory interactive design</h1><button onclick="document.querySelector(\'output\').textContent=\'Order confirmed\'">Place order</button><output></output><script>try { parent.document.body; document.body.dataset.parent="unsafe"; } catch { document.body.dataset.parent="blocked"; }</script></body></html>');
          return;
        }
        if (req.url !== "/") return next();
         res.setHeader("Content-Type", "text/html");
        const policy = buildCsp({ nonce: "browser-test", https: false, appOrigin: `http://${req.headers.host}`, blocksApiOrigin: "", storageOrigins: [], wasm: false, reportOnly: false });
        res.setHeader(policy.header, policy.value);
        res.end('<!doctype html><html><head><meta property="csp-nonce" nonce="browser-test"><title>Design UI fixture</title></head><body><div id="root"></div><script nonce="browser-test" type="module" src="/__figma-ui-main.js"></script></body></html>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(`Design fixture: ${error.message}`));
  // A published-preview fixture must never contact the real provider.
  await page.route("https://service-app.figma.site/**", route => route.fulfill({ contentType: "text/html", body: '<h1>Interactive design fixture</h1><button onclick="this.textContent=\'Order confirmed\'">Place order</button>' }));
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByText("Loading your design…")).toBeVisible();
  const requirements = [{ id: "r1", key: "R1", title: "Request service", detail: "Staff request service", criteria: ["A receipt is shown"] }];
  await page.evaluate(requirements => window.figmaFixture.set({ loading: false, requirements }), requirements);
  await expect.poll(() => page.evaluate(() => window.figmaFixture.calls.length)).toBe(1);
  await expect(page.getByText("Designing", { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.figmaFixture.calls[0]), { feedback: "", workflow: "screens" });
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  assert.doesNotMatch(await page.locator("body").innerText(), /credit|consent|MCP|owner engine/i);

  await page.evaluate(() => {
    const source = window.figmaFixture.source;
    window.figmaFixture.set({ jobs: [{ id: "j1", status: "failed", message: "Figma credits required; check MCP", inputJson: JSON.stringify({ designBriefId: "b1", source }) }] });
  });
  await expect(page.getByText("Design unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry design", exact: true })).toBeVisible();
  // Remount with the same persisted failed attempt: no automatic paid retry, including StrictMode effects.
  await page.evaluate(() => window.mountDesign("remounted"));
  await expect(page.getByText("Design unavailable", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.figmaFixture.calls.length), 1);
  assert.doesNotMatch(await page.locator("body").innerText(), /credits|MCP/i);

  await page.evaluate(() => {
    const source = window.figmaFixture.source;
    window.figmaFixture.set({ brief: { id: "b1", mode: "figma", status: "draft", prototypeJson: JSON.stringify({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/service-app/", previewUrl: "https://service-app.figma.site/",
      revision: "rev-1", source, jobId: "j1", artifactFileId: "file-1",
    }) }, jobs: [{ id: "j1", status: "succeeded", inputJson: JSON.stringify({ designBriefId: "b1", source }) }] });
  });
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'View designs', exact: true }).click();
  await expect(page.locator('iframe[title="Figma Make interactive product design"]')).toHaveAttribute("src", "https://service-app.figma.site/");
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this design revision" })).toBeEnabled();
  const design = page.frameLocator('iframe[title="Figma Make interactive product design"]');
  await expect(design.getByRole("heading", { name: "Interactive design fixture" })).toBeVisible();
  await design.getByRole("button", { name: "Place order" }).click();
  await expect(design.getByRole("button", { name: "Order confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Phone", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCSS("width", "390px");
  await expect(page.getByRole("button", { name: "Load interactive preview" })).toHaveCount(0);

  // Explicit opt-in acceptance check: real published runtime, no Figma sign-in or intercepted responses.
  if (livePreview) {
    await page.evaluate(previewUrl => {
      const source = window.figmaFixture.source;
      window.figmaFixture.set({ brief: { id: "b1", mode: "figma", status: "draft", prototypeJson: JSON.stringify({
        provider: "figma-make", projectUrl: "https://www.figma.com/make/LQFFLJ7cQuDV2fcvgVQ3Qp/", previewUrl,
        revision: "published-acceptance", source, jobId: "j1", artifactFileId: "file-1",
      }) } });
    }, livePreview);
    await expect(page.locator("iframe")).toHaveAttribute("src", livePreview);
    await expect(design.getByRole("heading", { name: /Good food/ })).toBeVisible({ timeout: 60000 });
    await design.getByRole("button", { name: "Customise Lemon herb chicken", exact: true }).click();
    await design.getByLabel("Quantity", { exact: true }).fill("2");
    await design.getByRole("button", { name: "Add to order", exact: true }).click();
    await design.getByRole("button", { name: /^Review order/ }).click();
    await design.getByRole("button", { name: /^Send order/ }).click();
    await expect(design.getByLabel("Your name")).toBeFocused();
    await design.getByLabel("Your name").fill("Preview Guest");
    await design.getByRole("button", { name: /^Send order/ }).click();
    await expect(design.getByRole("heading", { name: "Order #104", exact: true })).toBeVisible();
    await design.getByLabel("Prototype role").selectOption("Staff");
    await design.getByRole("button", { name: "Accept", exact: true }).click();
    await design.getByRole("button", { name: "Start cooking", exact: true }).click();
    await expect(design.getByRole("button", { name: "Edit order", exact: true })).toHaveCount(0);
    await design.getByRole("button", { name: "Mark ready", exact: true }).click();
    await design.getByRole("button", { name: "Mark served", exact: true }).click();
    await design.getByLabel("Prototype role").selectOption("Customer");
    await design.getByRole("button", { name: "Your order", exact: true }).click();
    await expect(design.locator(".panel .pill")).toHaveText("Served");
    await expect(page.locator("iframe")).toHaveCSS("width", "390px");
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await expect(design.getByRole("heading", { name: /Good food/ })).toBeVisible({ timeout: 30000 });
    console.log(JSON.stringify({ ok: true, scope: "Real published Juniper Table runtime in actual MakeDesignPanel under production CSP; surrounding hooks remain fixtures", previewUrl: livePreview,
      checks: ["no-figma-sign-in", "live-iframe-loaded", "phone-390px", "customisation-and-quantity", "required-name-validation", "submit-order", "staff-accept-cook-ready-serve", "edit-lock-after-cooking", "customer-status", "desktop-preview"], cloudWrites: false }));
  }

  await page.evaluate(() => {
    const source = `factory-v1:${window.figmaFixture.source}`;
    const previewUrl = `/api/design-preview/p1/${"a".repeat(64)}`;
    window.figmaFixture.set({ factorySource: source, brief: { id: "b1", mode: "figma", status: "draft", prototypeJson: JSON.stringify({
      provider: "factory", projectId: "p1", projectUrl: previewUrl, previewUrl, revision: "a".repeat(64), source, jobId: "j1", artifactFileId: "f1", figmaReferenceUrl: null,
    }) }, jobs: [{ id: "j1", status: "succeeded", inputJson: JSON.stringify({ designBriefId: "b1", source, workflow: "factory" }) }] });
  });
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(design.getByRole("heading", { name: "Factory interactive design" })).toBeVisible();
  await expect(design.locator("body")).toHaveAttribute("data-parent", "blocked");
  await design.getByRole("button", { name: "Place order" }).click();
  await expect(design.locator("output")).toHaveText("Order confirmed");
  await expect(page.getByRole("button", { name: "Approve this design revision" })).toBeEnabled();
  console.log(JSON.stringify({ ok: true, scope: "Factory iframe under production parent and child policies", checks: ["interactive-scripts-work", "parent-session-isolated", "no-same-origin-sandbox", "explicit-approval"] }));

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Use actual viewport-sized PNGs: a 1×1 placeholder has a square intrinsic
  // aspect ratio and cannot test fitting a portrait/landscape screen faithfully.
  if (!savedDir) {
    for (const screen of nativeScreens) screen.png = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.fillStyle = '#f8fafc'; context.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, screen);
  }
  await page.evaluate((nativeScreens) => {
    const source = `factory-v1:${window.figmaFixture.source}`, revision = 'b'.repeat(64);
    window.figmaFixture.set({ factorySource: source, brief: { id: 'b1', mode: 'figma', status: 'draft', prototypeJson: JSON.stringify({
      provider: 'figma-design', projectId: 'p1', projectUrl: 'https://www.figma.com/design/abc/Review', previewUrl: `/api/design-preview/p1/${revision}`,
      revision, source, jobId: 'j1', artifactFileId: 'f1', screens: nativeScreens.map(({ png, width, height, ...s }) => s),
    }) }, jobs: [{ id: 'j1', status: 'succeeded', inputJson: JSON.stringify({ designBriefId: 'b1', source, workflow: 'screens' }) }] });
  }, nativeScreens);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'View designs', exact: true }).click();
  const screens = page.getByRole('dialog', { name: 'Product design', exact: true });
  const assertScreenFits = async () => {
    await expect.poll(() => screens.getByRole('region', { name: 'Design canvas' }).evaluate((canvas) => {
      const image = canvas.querySelector('img'); if (!image) return false;
      const bounds = canvas.getBoundingClientRect(), picture = image.getBoundingClientRect();
      return picture.width > 0 && picture.left >= bounds.left && picture.right <= bounds.right + 1 && picture.top >= bounds.top && picture.bottom <= bounds.bottom + 1;
    })).toBe(true);
  };
  await expect(screens.getByRole('img', { name: nativeScreens[0].name, exact: true })).toBeVisible();
  await expect(screens.getByRole('heading', { name: nativeScreens[0].name, exact: true })).toBeVisible();
  await screens.getByRole('button', { name: /^Desktop/ }).click();
  const desktopScreen = nativeScreens.find((s) => s.width > 1024);
  if (desktopScreen) { await expect(screens.getByRole('img', { name: desktopScreen.name, exact: true })).toBeVisible(); await assertScreenFits(); }
  else await expect(screens.getByText('No desktop screens available')).toBeVisible();
  await screens.getByRole('button', { name: /^Mobile/ }).click();
  const mobileScreen = nativeScreens.find((s) => s.width <= 600);
  if (mobileScreen) { await expect(screens.getByRole('img', { name: mobileScreen.name, exact: true })).toBeVisible(); await assertScreenFits(); }
  await screens.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(screens.getByRole('button', { name: /%$/ })).toBeVisible();
  await screens.getByRole('button', { name: 'Fit width', exact: true }).click();
  await expect(screens.getByRole('button', { name: /%$/ })).toBeVisible();
  await screens.getByTitle('Fit entire screen', { exact: true }).click();
  await assertScreenFits();
  await page.screenshot({ path: path.join(root, 'data', 'design-viewer-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(screens).toBeVisible();
  await assertScreenFits();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, 'data', 'design-viewer-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect(screens).toHaveCSS('background-color', 'rgb(23, 24, 29)');
  await screens.getByRole('button', { name: /^All screens/ }).click();
  await page.screenshot({ path: path.join(root, 'data', 'design-viewer-dark.png') });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.keyboard.press('Escape');
  await expect(screens).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View designs', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('link', { name: /Open screen designs in Figma|Open all screen designs|Open in Figma Make|Original Figma reference/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve this design revision' })).toBeEnabled();
  await page.evaluate(() => {
    const brief = window.figmaFixture.brief;
    const prototype = JSON.parse(brief.prototypeJson);
    window.figmaFixture.set({ brief: { ...brief, prototypeJson: JSON.stringify({ ...prototype, reviewComplete: false, totalScreens: 20 }) } });
  });
  await expect(page.getByText('Preview incomplete', { exact: true })).toBeVisible();
  await expect(page.getByText(`${nativeScreens.length} of 20 screen previews are available.`, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this design revision' })).toBeDisabled();
  await page.evaluate(() => window.figmaFixture.set({ factorySource: 'factory-v1:ux-changed' }));
  await expect(page.getByRole('button', { name: 'Approve this design revision' })).toBeDisabled();
  console.log(JSON.stringify({ ok: true, scope: 'Native Figma screen gallery in Look & feel; exported-image fixture, no provider generation', checks: ['screen-preview-visible', 'no-script-sandbox', 'figma-reference', 'approval', 'stale-approval-disabled'] }));

  await page.evaluate(() => {
    window.figmaFixture.set({ factorySource: null });
    window.figmaFixture.set({ brief: { id: "b1", mode: "describe", status: "draft" }, jobs: [{ id: "legacy", status: "running", progress: 70,
      message: "Saving 10 screen designs.", inputJson: JSON.stringify({ designBriefId: "b1" }) }] });
    window.mountDesign("legacy");
  });
  await expect(page.getByText("Finishing an earlier design task", { exact: false })).toBeVisible();
  assert.doesNotMatch(await page.locator("body").innerText(), /Saving 10|Ready for review/);
  assert.equal(await page.evaluate(() => window.figmaFixture.calls.length), 1);
  await page.evaluate(() => window.figmaFixture.set({ jobs: [{ id: "legacy", status: "succeeded", inputJson: JSON.stringify({ designBriefId: "b1" }) }] }));
  await expect.poll(() => page.evaluate(() => window.figmaFixture.calls.length)).toBe(2);
  console.log(JSON.stringify({ ok: true, scope: "Actual MakeDesignPanel under production CSP with fixture hooks; no cloud writes or provider generation", checks: ["automatic-single-request", "no-customer-billing", "no-automatic-retry-after-failure", "direct-preview", "interactive-preview-under-production-csp", "responsive-preview", "approval", "legacy-job-reconciliation"] }));
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
