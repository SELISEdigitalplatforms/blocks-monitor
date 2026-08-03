import { test, expect } from "../../support/test-base";
import { LoginPage } from "../../support/pages/login-page";

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
    // Extend the test timeout to cover an optional inspection hold at the end.
    const holdMs = Number(process.env.E2E_HOLD_MS ?? 0);
    if (holdMs > 0) test.setTimeout(holdMs + 60_000);

    const login = new LoginPage(page);

    // 1. Blocks Monitor login page -> dev-iam OIDC login -> back to console.
    await login.goto();
    await login.login(username!, password!);

    // Assert the console actually rendered — not just that the route changed.
    // This repo renders <ConsolePage /> without `canCreateProject`, and the kit
    // defaults it to false, so the "Welcome to SELISE Blocks" empty state is
    // unreachable here. Only "Your Blocks Projects" can appear.
    await expect(login.projectsHeading).toBeVisible({ timeout: 20_000 });

    // Persist the authenticated session for future specs to reuse.
    await login.saveAuthState("fixtures/auth.json");

    // Optionally keep the browser open to inspect the result before it closes.
    // e.g. E2E_HOLD_MS=120000 npm run test:headed
    if (holdMs > 0) {
      await page.waitForTimeout(holdMs);
    }
  });
});
