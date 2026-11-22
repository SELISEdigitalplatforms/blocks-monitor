// Read-only public-auth smoke checks in an isolated browser context; no real credentials or records.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.MADP_CHECK_ORIGIN || "https://dbsaun.slsblx.com:5310";
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let loginPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/login") loginPosts++;
  });
  await page.goto(`${origin}/sign-in`);
  const email = page.locator("#si-email");
  const password = page.locator("#si-password");
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  await expect(page.locator("#si-email-error")).toBeVisible();
  await email.fill("not-an-email");
  await password.fill("validation-only-not-a-credential");
  await submit.click();
  await expect(page.locator("#si-email-error")).toBeVisible();
  assert.equal(loginPosts, 0, "Invalid forms must not submit credentials");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.goto(`${origin}/dashboard`);
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  assert.equal(loginPosts, 0);
  console.log(JSON.stringify({ ok: true, scope: "Public embedded sign-in only; no authenticated or cloud-write checks", checks: ["form-rendering", "empty-validation", "invalid-email-no-login-post", "password-toggle", "anonymous-route-protection"] }));
} catch {
  console.error("Public auth UI checks failed. Confirm the embedded Blocks development server is running at MADP_CHECK_ORIGIN.");
  process.exitCode = 1;
} finally {
  await browser.close();
}
