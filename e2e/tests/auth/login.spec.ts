import { expect, test } from "../../support/test-base";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.describe("Authentication", () => {
  test.beforeAll(() => {
    if (!username || !password) {
      throw new Error(
        "E2E_USERNAME / E2E_PASSWORD are not set. Fill them in e2e/.env.e2e before running.",
      );
    }
  });

  test("logs in through dev-iam and lands on the console", async ({ page }) => {
    // Cross-origin OIDC plus a cold SPA load on the shared dev host can push
    // this flow past Playwright's 30s default, so give it generous headroom.
    // Extend further to cover an optional inspection hold at the end.
    const holdMs = Number(process.env.E2E_HOLD_MS ?? 0);
    test.setTimeout(holdMs > 0 ? holdMs + 120_000 : 120_000);

    // 1. Blocks Data login page — a single CTA that starts the OIDC flow.
    //    Rendered by blocks-kit's LoginPage (pages/login/blocks-login.tsx),
    //    whose default CTA label is "Log in to your account".
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    // The dev SPA can take a while to hydrate the CTA on a cold load.
    const loginCta = page.getByRole("button", { name: "Log in to your account" });
    await loginCta.waitFor({ state: "visible", timeout: 60_000 });

    // 2. Redirected to the dev-iam OIDC login page (/oidc/login, cross-origin).
    //    Selectors come from blocks-idp oidc-login-form.tsx (stable field ids).
    //    The CTA can render before its OIDC click handler is wired (hydration
    //    race on a cold dev load), and the cross-origin redirect itself is
    //    occasionally slow, so retry the click until the email field appears.
    const emailField = page.locator("#oidc-email");
    let reachedOidc = false;
    for (let attempt = 0; attempt < 4 && !reachedOidc; attempt++) {
      if (await loginCta.isVisible().catch(() => false)) {
        await loginCta.click().catch(() => {});
      }
      reachedOidc = await emailField
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
    }
    await emailField.waitFor({ timeout: 30_000 });
    await emailField.fill(username!);
    await page.locator("#oidc-password").fill(password!);
    await page.getByRole("button", { name: "Login", exact: true }).click();

    // 3. Optional one-time OIDC consent/permission screen.
    //    The OIDC path can route through /oidc/permission before returning.
    //    Confirm the real button label via `npm run codegen` on the first live
    //    run, then enable this block if the screen appears.
    // const consentBtn = page.getByRole("button", {
    //   name: /allow|authorize|continue|grant/i,
    // });
    // if (await consentBtn.isVisible().catch(() => false)) {
    //   await consentBtn.click();
    // }

    // 4. Back on Blocks Data, authenticated. /login/callback redirects to
    //    /app/console (router.tsx: CallbackPage defaultRedirectUrl).
    await page.waitForURL("**/app/console", { timeout: 60_000 });
    await expect(page).toHaveURL(/\/app\/console/);

    // Assert the console actually rendered — not just that the route changed.
    // blocks-data mounts <ConsolePage /> without `canCreateProject`, so the
    // "Welcome to SELISE Blocks" empty state is unreachable here and the
    // heading is always "Your Blocks Projects" (blocks-kit self-project.tsx).
    await expect(page.getByRole("heading", { name: "Your Blocks Projects" })).toBeVisible({
      timeout: 20_000,
    });

    // Persist the authenticated session for future specs to reuse.
    await page.context().storageState({ path: "fixtures/auth.json" });

    // Optionally keep the browser open to inspect the result before it closes.
    // e.g. E2E_HOLD_MS=120000 npm run test:headed
    if (holdMs > 0) {
      await page.waitForTimeout(holdMs);
    }
  });
});
