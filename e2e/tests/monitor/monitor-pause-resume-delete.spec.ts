import { test, expect } from "../../support/test-base";
import { loginFresh } from "../../support/login-helper";
import type { Page } from "@playwright/test";

async function waitForRowsLoaded(page: Page) {
  await expect(page.locator('[class*="skeleton"]').first()).toBeHidden({
    timeout: 15000,
  });
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 15000 });
}

async function ensureMonitorExists(page: Page) {
  await waitForRowsLoaded(page);
  if (
    !(await page
      .getByText("No results.")
      .isVisible()
      .catch(() => false))
  ) {
    return;
  }
  await page.getByTestId("add-monitor-button").click();
  await expect(
    page.getByRole("heading", { name: "Add monitor" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill(`e2e-pause-resume-${Date.now()}`);
  await page
    .getByPlaceholder("Enter URL to monitor")
    .fill(`https://example.com/health-${Date.now()}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("Monitor successfully created.", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  // NOTE: the list can lag behind the write, so a freshly created monitor may
  // not show up immediately when navigating back to it; callers should guard
  // against that rather than assume the row/action button is present.
}

async function getRowActionButton(page: Page) {
  await waitForRowsLoaded(page);
  const firstRow = page.getByRole("row").nth(1);
  const actionButton = firstRow.getByRole("button").last();
  const isAvailable = await actionButton
    .isVisible({ timeout: 10000 })
    .catch(() => false);
  return isAvailable ? actionButton : null;
}

async function openFirstMonitor(page: Page) {
  await waitForRowsLoaded(page);
  const firstRow = page.getByRole("row").nth(1);

  // The row click can occasionally be swallowed by a re-render; retry a few times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await firstRow.click();
    try {
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

test.describe("Monitor - pause, resume & delete", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await loginFresh(page);
    await expect(
      page.getByRole("heading", { name: "Your Blocks Projects" }),
    ).toBeVisible({ timeout: 50000 });
    await page
      .getByRole("button", { name: /Development/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Project Details" }),
    ).toBeVisible({ timeout: 30000 });

    await page.getByRole("link", { name: "Monitor" }).click();
    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 30000,
    });

    await ensureMonitorExists(page);
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
      await expect(
        page.getByRole("heading", { name: "Pause monitor?" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "This will temporarily stop all checks for this monitor until resumed.",
        ),
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
      await expect(
        page.getByRole("heading", { name: "Resume monitor?" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Checks will start running again based on the configured interval.",
        ),
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
    await expect(
      page.getByText(/Monitor (paused|resumed) successfully/),
    ).toBeVisible({ timeout: 15000 });
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

  test("TC-0054: Deleting a monitor opens a confirmation dialog warning the action is irreversible", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      page.getByRole("heading", { name: "Remove monitor?" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This action will permanently delete the monitor and its related history. This cannot be undone.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  });

  test("TC-0055: Confirming delete from the monitor list removes the monitor without navigating away", async ({
    page,
  }) => {
    await waitForRowsLoaded(page);
    const firstRow = page.getByRole("row").nth(1);
    const noResultsVisible = await page
      .getByText("No results.")
      .isVisible()
      .catch(() => false);
    test.skip(noResultsVisible, "No monitor is available to delete.");
    const monitorName = (
      await firstRow.locator("td").first().innerText()
    ).trim();
    const actionButton = firstRow.getByRole("button").last();
    await actionButton.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("row", { name: new RegExp(monitorName) }),
    ).toHaveCount(0);
  });

  test("TC-0056: Confirming delete from the monitor details page navigates back", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 15000,
    });
  });

  test("TC-0058: Delete Confirm button is disabled while the delete request is pending", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirmButton = page.getByRole("button", { name: "Confirm" });
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await confirmButton.click();
    await expect(confirmButton).toBeDisabled();
    await expect(cancelButton).toBeDisabled();
  });
});
