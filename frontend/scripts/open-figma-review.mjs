// Visible operator sign-in window. Uses a separate temporary profile, never a personal browser's stored credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const fileKey = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileKey ?? "")) throw new Error("Usage: node scripts/open-figma-review.mjs <fileKey>");
const base = path.join(os.tmpdir(), "opencode");
fs.mkdirSync(base, { recursive: true });
const profile = fs.mkdtempSync(path.join(base, "madp-figma-browser-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.platform === "win32" ? "msedge" : "chromium", headless: false,
  args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=5421"],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto(`https://www.figma.com/make/${fileKey}/`, { waitUntil: "domcontentloaded", timeout: 60000 })
  .catch(() => console.log("Figma is taking longer to load; the sign-in window remains open."));
console.log("Visible Figma review window opened. Sign in there; do not share credentials in chat. Automation control is local-only on port 5421.");
await new Promise((resolve) => context.on("close", resolve));
