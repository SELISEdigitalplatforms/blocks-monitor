import { test, expect } from "../../support/test-base";
import {
  getRowActionButton,
  loginAndOpenMonitorList,
  openFirstMonitor,
  waitForRowsLoaded,
} from "../../support/monitor-helpers";

test.describe("Monitor - delete", () => {
  // Give each test (including beforeEach) enough time to absorb slow pages.
  test.describe.configure({ timeout: 90_000 });

  // Log in and navigate to the Monitor list before every test. Cookies
  // do not persist across test contexts, so we cannot share auth from a
  // single beforeAll hook — each test must log in for itself.
  test.beforeEach(async ({ page }) => {
    await loginAndOpenMonitorList(page);
  });

  test("TC-0054: Deleting a monitor opens a confirmation dialog warning the action is irreversible", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page);
    test.skip(!actionButton, "No monitor with a row action menu is available.");
    await actionButton!.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByRole("heading", { name: "Remove monitor?" })).toBeVisible();
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
    const monitorName = (await firstRow.locator("td").first().innerText()).trim();
    const actionButton = firstRow.locator('[aria-haspopup="menu"]').first();
    const actionButtonVisible = await actionButton.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!actionButtonVisible, "No monitor with a row action menu is available.");
    await actionButton.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("row", { name: new RegExp(monitorName) })).toHaveCount(0);
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
