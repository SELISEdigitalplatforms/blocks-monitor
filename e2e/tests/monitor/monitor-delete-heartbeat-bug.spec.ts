import { test, expect } from "../../support/test-base";

// This test is self-contained (its own login + app navigation via the
// "SELISE Blocks apps" menu, rather than the shared beforeEach used by the
// other monitor delete/pause-resume specs), since it logs in through
// dev-iam directly instead of the dev-monitor entry point.
//
// KNOWN BUG: after confirming delete on a freshly-created Heartbeat
// monitor, the monitor is NOT actually removed from the list — the row
// (and its name text) is still visible. The final assertion below is
// intentionally left failing so this stays flagged until the app fixes
// it; do not "fix" this test by loosening or removing that assertion.
test("BUG-TC-0057: Deleting a newly-created Heartbeat monitor does not remove it from the list", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "E2E_USERNAME / E2E_PASSWORD are not set. Fill them in e2e/.env.e2e before running.",
    );
  }

  // ---- 1. Log in.
  await page.goto("https://dev-iam.blocksdevelopers.com/login", {
    waitUntil: "load",
  });
  const loginTrigger = page.getByRole("button", {
    name: "Log in to your account",
  });
  await loginTrigger.waitFor({ state: "visible", timeout: 30000 });
  await loginTrigger.click();

  const emailInput = page.getByRole("textbox", { name: "Work Email" });
  await emailInput.waitFor({ state: "visible", timeout: 30000 }).catch(async () => {
    await loginTrigger.click();
    await emailInput.waitFor({ state: "visible", timeout: 30000 });
  });
  await emailInput.fill(username);

  const passwordInput = page.getByRole("textbox", { name: "Password" });
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.fill(password);

  const loginSubmit = page.getByRole("button", { name: "Login" });
  await loginSubmit.waitFor({ state: "visible", timeout: 30000 });
  await loginSubmit.click();

  // ---- 2. Open the Monitor app for the Development project.
  const appsMenu = page.getByRole("button", { name: "SELISE Blocks apps" });
  await appsMenu.waitFor({ state: "visible", timeout: 30000 });
  await appsMenu.click();

  const monitorAppLink = page.getByRole("link", { name: "Monitor Monitor" });
  await monitorAppLink.waitFor({ state: "visible", timeout: 30000 });
  await monitorAppLink.click();

  const developmentButton = page.getByRole("button", { name: "Development" }).first();
  await developmentButton.waitFor({ state: "visible", timeout: 30000 });
  await developmentButton.click();

  const monitorLink = page.getByRole("link", { name: "Monitor" });
  await monitorLink.waitFor({ state: "visible", timeout: 30000 });
  await monitorLink.click();
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
    timeout: 30000,
  });

  // ---- 3. Create a Heartbeat monitor.
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({ timeout: 15000 });

  await page.getByRole("radio", { name: "Heartbeat" }).click();
  // A hardcoded name collides with monitors left behind by earlier failed
  // runs (the delete step never ran for those), so `getByText(name)`
  // matches multiple rows and "not visible" never becomes true even
  // after successfully deleting THIS run's monitor. Make the name
  // unique per run to avoid that entirely.
  const monitorName = `test Heartbit ${Date.now()}`;
  const nameInput = page.getByRole("textbox", { name: "Name" });
  await nameInput.click();
  await nameInput.fill(monitorName);

  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.click();
  await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  // ---- 4. Go back to the list and find the new monitor's row.
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByText(monitorName)).toBeVisible({
    timeout: 30000,
  });

  // The row's kebab (⋮) menu is a Radix dropdown trigger with an
  // auto-generated id (e.g. #radix-_r_62_) that changes on every render —
  // it can never be relied on across runs. Instead, scope to the row
  // containing our monitor's name and find its trigger by the stable
  // aria-haspopup="menu" attribute.
  const row = page.getByRole("row", { name: monitorName });
  const actionButton = row.locator('[aria-haspopup="menu"]').first();
  const deleteMenuItem = page.getByRole("menuitem", { name: "Delete" });

  // A background list refetch can re-render the row right after the
  // kebab menu opens, detaching the menu from the DOM mid-click. Retry
  // the whole open-menu-then-click sequence once if that happens.
  await actionButton.waitFor({ state: "visible", timeout: 15000 });
  await actionButton.click();
  try {
    await deleteMenuItem.click({ timeout: 10000 });
  } catch {
    await actionButton.click();
    await deleteMenuItem.click({ timeout: 15000 });
  }

  await page.getByRole("button", { name: "Confirm" }).click();

  // This is expected to FAIL until the underlying delete bug is fixed.
  await expect(page.getByText(monitorName)).not.toBeVisible({
    timeout: 30000,
  });
});
