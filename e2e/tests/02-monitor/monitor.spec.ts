/**
 * Monitor page end-to-end test (feature project).
 *
 * Suite setup/teardown live in Playwright projects `monitor-setup` /
 * `monitor-teardown`. This spec reuses the shared project session and
 * exercises the Monitor list page:
 *
 *   1. Open the Monitor list (creates one if empty)
 *   2. Pause & resume (TC-0048, TC-0049, TC-0050, TC-0051, TC-0053)
 *   3. Delete confirmations from list & details (TC-0054, TC-0055, TC-0056, TC-0058)
 *   4. Heartbeat delete bug (BUG-TC-0057)
 *
 * Note: each step calls `resetToMonitorList` first to drop any leftover menu /
 * dialog / loading state from the previous step.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../../support/test-base";
import {
  openFirstMonitor,
  openMonitorList,
  openRowActionsMenu,
  waitForRowsLoaded,
} from "../../support/monitor-helpers";

/**
 * Drop any leftover menu / dialog / loading state from the previous step and
 * confirm we are back on the Monitor list with at least one row to act on.
 */
async function resetToMonitorList(page: Page) {
  await page.keyboard.press("Escape").catch(() => null);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 30_000 });
  await waitForRowsLoaded(page);
}

test.describe("Monitor - full page workflow", () => {
  test.setTimeout(600_000);

  test("runs the entire Monitor page flow end-to-end", async ({ page }) => {
    // ── Section 1: open the Monitor list ─────────────────────────────────────
    await test.step("Open the Monitor list (create one if empty)", async () => {
      await openMonitorList(page);
    });

    // ── Section 2: pause & resume checks (TC-0048, TC-0049, TC-0050, TC-0051, TC-0053) ──
    await test.step("Pause & resume — actions menu shows the right item (TC-0048)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      const menuItem = page.getByRole("menuitem").first();
      await expect(menuItem).toHaveText(/Pause|Resume/);
      await page.keyboard.press("Escape");
    });

    await test.step("Pause — confirmation dialog copy (TC-0049)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      const pauseItem = page.getByRole("menuitem", { name: "Pause" });
      if (await pauseItem.isVisible().catch(() => false)) {
        await pauseItem.click();
        await expect(page.getByRole("heading", { name: "Pause monitor?" })).toBeVisible();
        await expect(
          page.getByText("This will temporarily stop all checks for this monitor until resumed."),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByRole("heading", { name: "Pause monitor?" })).toBeHidden();
      }
    });

    await test.step("Resume — confirmation dialog copy (TC-0050)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      const resumeItem = page.getByRole("menuitem", { name: "Resume" });
      if (await resumeItem.isVisible().catch(() => false)) {
        await resumeItem.click();
        await expect(page.getByRole("heading", { name: "Resume monitor?" })).toBeVisible();
        await expect(
          page.getByText("Checks will start running again based on the configured interval."),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByRole("heading", { name: "Resume monitor?" })).toBeHidden();
      }
    });

    await test.step("Pause/Resume — confirming shows success toast (TC-0051)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(/Monitor (paused|resumed) successfully/).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Cancel leaves the monitor's active state unchanged (TC-0053)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(
        page.getByRole("heading", { name: /Pause monitor\?|Resume monitor\?/ }),
      ).toBeHidden();
    });

    // ── Section 3: delete checks (TC-0054, TC-0055, TC-0056, TC-0058) ───────
    await test.step("Delete — confirmation dialog copy (TC-0054)", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.getByRole("heading", { name: "Remove monitor?" })).toBeVisible();
      await expect(
        page.getByText(
          "This action will permanently delete the monitor and its related history. This cannot be undone.",
        ),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
    });

    // TC-0055 actually deletes a monitor; openMonitorList ensures one exists.
    await test.step("Delete — confirm from list removes the row (TC-0055)", async () => {
      await openMonitorList(page);
      const firstRow = page.getByRole("row").nth(1);
      const noResultsVisible = await page
        .getByText("No results.")
        .isVisible()
        .catch(() => false);
      test.skip(noResultsVisible, "No monitor is available to delete.");
      const monitorName = (await firstRow.locator("td").first().innerText()).trim();
      const actionButton = await openRowActionsMenu(page, firstRow);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("row", { name: new RegExp(monitorName) })).toHaveCount(0);
    });

    // TC-0056 needs a monitor to open; ensureMonitorExists inside openMonitorList handles it.
    await test.step("Delete — confirm from details page navigates back (TC-0056)", async () => {
      await openMonitorList(page);
      await openFirstMonitor(page);
      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 15_000 });
    });

    // TC-0058: Confirm button is disabled while pending. Also needs a monitor.
    await test.step("Delete — Confirm button is disabled while pending (TC-0058)", async () => {
      await openMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: "Delete" }).click();
      const confirmButton = page.getByRole("button", { name: "Confirm" });
      const cancelButton = page.getByRole("button", { name: "Cancel" });
      await confirmButton.click();
      await expect(confirmButton).toBeDisabled();
      await expect(cancelButton).toBeDisabled();
    });

    // ── Section 4: Heartbeat delete bug (BUG-TC-0057) ───────────────────────
    await test.step("BUG-TC-0057: Deleting a newly-created Heartbeat monitor removes it from the list", async () => {
      test.setTimeout(90_000);
      await openMonitorList(page);

      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("radio", { name: "Heartbeat" }).click();
      const monitorName = `test Heartbit ${Date.now()}`;
      const nameInput = page.getByRole("textbox", { name: "Name" });
      await nameInput.click();
      await nameInput.fill(monitorName);

      const saveButton = page.getByRole("button", { name: "Save" });
      await saveButton.click();
      await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: "Go back" }).click();
      await expect(page.getByText(monitorName)).toBeVisible({ timeout: 30_000 });

      const row = page.getByRole("row", { name: monitorName });
      const actionButton = await openRowActionsMenu(page, row);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await page.getByRole("menuitem", { name: "Delete" }).click();

      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(monitorName)).not.toBeVisible({ timeout: 30_000 });
    });

    // ── Section 5: Status badge after pause ──────────────────────────────────
    await test.step("Status — 'Paused' badge appears after pausing", async () => {
      await resetToMonitorList(page);
      const actionButton = await openRowActionsMenu(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");

      // Pause if available; otherwise monitor is already paused.
      const pauseItem = page.getByRole("menuitem", { name: "Pause" });
      if (await pauseItem.isVisible().catch(() => false)) {
        await pauseItem.click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(page.getByText(/Monitor paused successfully/).first()).toBeVisible({
          timeout: 15_000,
        });
      }

      // The Status column shows a "Paused" Badge when isActive === false.
      await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      });
    });

    // ── Section 6: Tabs ─────────────────────────────────────────────────────
    await test.step("Tabs — switch to 'Blocks services'", async () => {
      await resetToMonitorList(page);
      await page.getByRole("tab", { name: "Blocks services" }).click();
      await expect(page.locator(".animate-pulse").first())
        .toBeHidden({ timeout: 15_000 })
        .catch(() => null);
    });

    await test.step("Tabs — switch back to 'My monitors'", async () => {
      await page.getByRole("tab", { name: "My monitors" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 15_000,
      });
    });

    // ── Section 7: Sort ─────────────────────────────────────────────────────
    await test.step("Sort — clicking the Name header is interactive", async () => {
      await resetToMonitorList(page);
      const nameHeader = page.getByRole("columnheader", { name: /Name/ }).first();
      await expect(nameHeader).toBeVisible();
      await nameHeader.click();
      await expect(page.locator(".animate-pulse").first())
        .toBeHidden({ timeout: 15_000 })
        .catch(() => null);
      // Click again to flip sort direction.
      await nameHeader.click();
      await expect(page.locator(".animate-pulse").first())
        .toBeHidden({ timeout: 15_000 })
        .catch(() => null);
    });

    // ── Section 8: Pagination controls visible ──────────────────────────────
    await test.step("Pagination — 'Rows per page' control is rendered", async () => {
      await resetToMonitorList(page);
      // The TablePagination component renders a "Rows per page" label.
      // Verify at least the page indicator is visible (the list is small,
      // so navigation buttons may be disabled — that's fine).
      await expect(page.getByText("Rows per page", { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    // ── Section 9: Details page — Configure (Edit) modal ─────────────────────
    await test.step("Details — Configure button opens the edit modal", async () => {
      await openMonitorList(page);
      await openFirstMonitor(page);
      await page.getByRole("button", { name: "Configure" }).click();
      await expect(page.getByRole("heading", { name: "Configure" })).toBeVisible({
        timeout: 15_000,
      });
      // MonitorModal uses an X icon with sr-only "Close" text — close via that.
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("heading", { name: "Configure" })).toBeHidden({
        timeout: 5_000,
      });
    });

    // ── Section 10: Details page — Notification Settings modal ──────────────
    await test.step("Details — Notification Settings opens with Add email control", async () => {
      await page.getByRole("button", { name: "Notification Settings" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add email" })).toBeVisible();
      // Email input is empty by default; Save is therefore disabled.
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeHidden({
        timeout: 5_000,
      });
    });

    // ── Section 11: Details page — Back button ──────────────────────────────
    // NOTE: details.tsx passes `data-testid="back-button"` but the BackIconButton
    // component (back-buttons/index.tsx) ignores that prop and only sets
    // aria-label="Go back". We target the rendered button by its accessible name.
    await test.step("Details — Back button returns to the Monitor list", async () => {
      await page.getByRole("button", { name: "Go back" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
