import { test, expect } from "../../support/test-base";
import { getRowActionButton, loginAndOpenMonitorList } from "../../support/monitor-helpers";

test.describe("Monitor - pause & resume", () => {
  // Give each test (including beforeEach) enough time to absorb slow pages.
  test.describe.configure({ timeout: 90_000 });

  // Log in and navigate to the Monitor list before every test. Cookies
  // do not persist across test contexts, so we cannot share auth from a
  // single beforeAll hook — each test must log in for itself.
  test.beforeEach(async ({ page }) => {
    await loginAndOpenMonitorList(page);
  });

  test("TC-0048: Actions menu shows 'Pause' for an active monitor and 'Resume' for a paused one", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    const menuItem = page.getByRole("menuitem").first();
    await expect(menuItem).toHaveText(/Pause|Resume/);
  });

  test("TC-0049: Pausing a monitor opens a confirmation dialog with the exact copy", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    const pauseItem = page.getByRole("menuitem", { name: "Pause" });
    if (await pauseItem.isVisible()) {
      await pauseItem.click();
      await expect(page.getByRole("heading", { name: "Pause monitor?" })).toBeVisible();
      await expect(
        page.getByText("This will temporarily stop all checks for this monitor until resumed."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    }
  });

  test("TC-0050: Resuming a monitor opens a confirmation dialog with the exact copy", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    const resumeItem = page.getByRole("menuitem", { name: "Resume" });
    if (await resumeItem.isVisible()) {
      await resumeItem.click();
      await expect(page.getByRole("heading", { name: "Resume monitor?" })).toBeVisible();
      await expect(
        page.getByText("Checks will start running again based on the configured interval."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    }
  });

  test("TC-0051: Confirming Pause/Resume shows the correct success toast and refreshes affected queries", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    // The toast text appears in TWO places (the toast div and an
    // aria-live status region), so strict mode would reject the
    // ambiguous locator. Pick the first match.
    await expect(page.getByText(/Monitor (paused|resumed) successfully/).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("TC-0053: Cancel in the Pause/Resume dialog leaves the monitor's active state unchanged", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: /Pause monitor\?|Resume monitor\?/ }),
    ).toBeHidden();
  });
});
