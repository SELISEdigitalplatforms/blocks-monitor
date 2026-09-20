import type { Page } from "@playwright/test";
import { test, expect } from "../../support/test-base";
import {
  getRowActionButton,
  openFirstMonitor,
  openMonitorList,
} from "../../support/monitor-helpers";

async function resetToMonitorList(page: Page) {
  const addMonitorHeading = page.getByRole("heading", { name: "Add monitor" });
  if (await addMonitorHeading.isVisible({ timeout: 500 }).catch(() => false)) {
    const cancelBtn = page.getByRole("button", { name: "Cancel" });
    if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelBtn.click({ force: true }).catch(() => null);
    }
    await page.keyboard.press("Escape").catch(() => null);
    await expect(addMonitorHeading)
      .toBeHidden({ timeout: 5000 })
      .catch(() => null);
  }
  await page.keyboard.press("Escape").catch(() => null);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 30_000 })
    .catch(() => null);
}

test.describe("Monitor - full page workflow", () => {
  test.setTimeout(600_000);

  test("runs the entire Monitor page flow end-to-end", async ({ page }) => {
    await test.step("Open the Monitor list (create one if empty)", async () => {
      await openMonitorList(page);
    });

    await test.step("Pause & resume — actions menu shows the right item (TC-0048)", async () => {
      await resetToMonitorList(page);
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();
      const menuItem = page.getByRole("menuitem").first();
      await expect(menuItem).toHaveText(/Pause|Resume/);
      await page.keyboard.press("Escape");
    });

    await test.step("Pause — confirmation dialog copy (TC-0049)", async () => {
      await resetToMonitorList(page);
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();
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
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();
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
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();
      await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(/Monitor (paused|resumed) successfully/).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Cancel leaves the monitor's active state unchanged (TC-0053)", async () => {
      await resetToMonitorList(page);
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();
      await page.getByRole("menuitem", { name: /Pause|Resume/ }).click();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(
        page.getByRole("heading", { name: /Pause monitor\?|Resume monitor\?/ }),
      ).toBeHidden();
    });

    await test.step("Delete — confirmation dialog copy (TC-0054)", async () => {
      await resetToMonitorList(page);
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
      await page.getByRole("button", { name: "Cancel" }).click();
    });

    await test.step("Delete — confirm from list removes the row (TC-0055)", async () => {
      await openMonitorList(page);
      const firstRow = page.getByRole("row").nth(1);
      const noResultsVisible = await page
        .getByText("No results.")
        .isVisible()
        .catch(() => false);
      test.skip(noResultsVisible, "No monitor is available to delete.");
      const monitorName = (await firstRow.locator("td").first().innerText()).trim();
      const actionButton = firstRow.locator('[aria-haspopup="menu"]').first();
      const visible = await actionButton.isVisible({ timeout: 10_000 }).catch(() => false);
      test.skip(!visible, "No monitor with a row action menu is available.");
      await actionButton.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("row", { name: new RegExp(monitorName) })).toHaveCount(0);
    });

    await test.step("Delete — confirm from details page navigates back (TC-0056)", async () => {
      await openMonitorList(page);
      await openFirstMonitor(page);
      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 15_000 });
    });

    await test.step("Delete — Confirm button is disabled while pending (TC-0058)", async () => {
      await openMonitorList(page);
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

    await test.step("BUG-TC-0057: Deleting a newly-created Heartbeat monitor removes it from the list", async () => {
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
      const actionButton = row.locator('[aria-haspopup="menu"]').first();
      const deleteMenuItem = page.getByRole("menuitem", { name: "Delete" });

      await actionButton.waitFor({ state: "visible", timeout: 15_000 });
      await actionButton.click();
      try {
        await deleteMenuItem.click({ timeout: 10_000 });
      } catch {
        await actionButton.click();
        await deleteMenuItem.click({ timeout: 15_000 });
      }

      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(monitorName)).not.toBeVisible({ timeout: 30_000 });
    });

    await test.step("Status — 'Paused' badge appears after pausing", async () => {
      await resetToMonitorList(page);
      const actionButton = await getRowActionButton(page);
      test.skip(!actionButton, "No monitor with a row action menu is available.");
      await actionButton!.click();

      const pauseItem = page.getByRole("menuitem", { name: "Pause" });
      if (await pauseItem.isVisible().catch(() => false)) {
        await pauseItem.click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(page.getByText(/Monitor paused successfully/).first()).toBeVisible({
          timeout: 15_000,
        });
      }

      await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      });
    });

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

    await test.step("Sort — clicking the Name header is interactive", async () => {
      await resetToMonitorList(page);
      const nameHeader = page.getByRole("columnheader", { name: /Name/ }).first();
      await expect(nameHeader).toBeVisible();
      await nameHeader.click();
      await expect(page.locator(".animate-pulse").first())
        .toBeHidden({ timeout: 15_000 })
        .catch(() => null);
      await nameHeader.click();
      await expect(page.locator(".animate-pulse").first())
        .toBeHidden({ timeout: 15_000 })
        .catch(() => null);
    });

    await test.step("Pagination — 'Rows per page' control is rendered", async () => {
      await resetToMonitorList(page);
      await expect(page.getByText("Rows per page", { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Details — Configure button opens the edit modal", async () => {
      await openMonitorList(page);
      await openFirstMonitor(page);
      await page.getByRole("button", { name: "Configure" }).click();
      await expect(page.getByRole("heading", { name: "Configure" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("heading", { name: "Configure" })).toBeHidden({
        timeout: 5_000,
      });
    });

    await test.step("Details — Notification Settings opens with Add email control", async () => {
      await page.getByRole("button", { name: "Notification Settings" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add email" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeHidden({
        timeout: 5_000,
      });
    });

    await test.step("Details — Back button returns to the Monitor list", async () => {
      await page.getByRole("button", { name: "Go back" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("List — API Docs link points to swagger", async () => {
      await resetToMonitorList(page);
      const apiDocsLink = page.getByRole("link", { name: "API Docs" });
      await expect(apiDocsLink).toBeVisible();
      const href = await apiDocsLink.getAttribute("href");
      expect(href ?? "").toMatch(/swagger/i);
    });

    await test.step("Add Monitor — Monitor type toggle (HTTP ↔ Heartbeat)", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("radio", { name: "Heartbeat" }).click();
      await expect(page.getByLabel("URL to monitor")).toBeHidden();

      await page.getByRole("radio", { name: "HTTP Check" }).click();
      await expect(page.getByLabel("URL to monitor")).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();
    });

    await test.step("Add Monitor — Source type reveals Select repo / Select service", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("Select repo", { exact: true })).toBeHidden();
      await expect(page.getByText("Select service", { exact: true })).toBeHidden();

      await page.getByRole("radio", { name: "Deployed" }).click();
      await expect(page.getByText("Select repo", { exact: true })).toBeVisible();

      await page.getByRole("radio", { name: "My services" }).click();
      await expect(page.getByText("Select service", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();
    });

    await test.step("Add Monitor — Monitor settings accordion exposes Interval and Timeout sliders", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await expect(page.getByText("Monitor interval", { exact: true })).toBeVisible();
      await expect(page.getByText("Request timeout", { exact: true })).toBeVisible();

      await expect(page.getByText("30s", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("1min", { exact: true }).first()).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();
    });

    await test.step("Add Monitor — HTTP method enables Request body when Post", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Request Configuration" }).click();

      const bodyArea = page.getByPlaceholder("Enter request body content...");
      await expect(bodyArea).toBeDisabled();

      await page.getByRole("radio", { name: "Post" }).click();
      await expect(bodyArea).toBeEnabled();

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();
    });

    await test.step("Add Monitor — Send-as-JSON switch reveals Request headers", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      const requestConfigTrigger = page.getByRole("button", { name: "Request Configuration" });
      await expect(requestConfigTrigger).toHaveAttribute("data-state", "closed");
      await requestConfigTrigger.click({ force: true });

      await expect(page.getByText("X-Header-Name", { exact: true })).toBeHidden();

      await page.getByRole("switch", { name: /Send as JSON/ }).click();

      await expect(page.getByText("X-Header-Name", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();
    });

    await test.step("Add Monitor — Cancel closes the modal without saving", async () => {
      await resetToMonitorList(page);
      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("textbox", { name: "Name" }).fill("e2e-cancel-discard");

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeHidden();

      await expect(page.getByText("e2e-cancel-discard")).toHaveCount(0);
    });

    await test.step("List — Row click navigates to monitor details", async () => {
      await openMonitorList(page);
      const firstRow = page.getByRole("row").nth(1);
      const monitorName = (await firstRow.locator("td").first().innerText()).trim();
      await firstRow.locator("td").first().click();
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: monitorName, exact: true })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Details — Current Status card shows a state", async () => {
      await expect(page.getByRole("heading", { name: "Current Status" })).toBeVisible();
      await expect(page.getByText(/^(Up|Down|Paused)$/).first()).toBeVisible();
    });

    await test.step("Details — Uptime cards render 'Last X days'", async () => {
      await expect(page.getByText(/Last \d+ days/).first()).toBeVisible();
    });

    await test.step("Details — Status Overview time-range combobox lists 1h through 24h", async () => {
      const timeRangeCombobox = page
        .locator('div', { has: page.getByRole("heading", { name: "Status Overview" }) })
        .locator('button[role="combobox"]');
      await expect(timeRangeCombobox).toBeVisible();
      await timeRangeCombobox.click();
      await expect(page.getByRole("option", { name: "Last 1 Hour" })).toBeVisible();
      await expect(page.getByRole("option", { name: "Last 3 Hours" })).toBeVisible();
      await expect(page.getByRole("option", { name: "Last 6 Hours" })).toBeVisible();
      await expect(page.getByRole("option", { name: "Last 12 Hours" })).toBeVisible();
      await expect(page.getByRole("option", { name: "Last 24 Hours" })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("Details — Latest incidents section renders", async () => {
      await expect(page.getByText("Latest incidents", { exact: true })).toBeVisible();
    });

    await test.step("Details — Configure save persists HTTP method change to Post", async () => {
      await page.getByRole("button", { name: "Configure" }).click({ force: true });
      await expect(page.getByRole("heading", { name: "Configure" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Request Configuration" }).click();
      await page.getByRole("radio", { name: "Post" }).click();

      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Monitor successfully updated.", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { name: "Configure" })).toBeHidden({
        timeout: 5_000,
      });
    });

    await test.step("Details — Notification Settings rejects invalid email format", async () => {
      await page.getByRole("button", { name: "Notification Settings" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Add email" }).click();
      await page.getByPlaceholder("Enter email address").first().fill("not-an-email");
      await expect(page.getByText("Please enter a valid email address").first()).toBeVisible({
        timeout: 5_000,
      });

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeHidden({
        timeout: 5_000,
      });
    });

    await test.step("Details — Notification Settings adds and saves a valid email", async () => {
      const uniqueEmail = `e2e-${Date.now()}@example.com`;
      await page.getByRole("button", { name: "Notification Settings" }).click();
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Add email" }).click();
      await page.getByPlaceholder("Enter email address").first().fill(uniqueEmail);
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page.getByText("Monitor successfully updated.", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { name: "Notification settings" })).toBeHidden({
        timeout: 5_000,
      });
    });

    await test.step("Add Monitor — HTTP Check happy path saves and opens details", async () => {
      await page.getByRole("button", { name: "Go back" }).click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByTestId("add-monitor-button").click();
      await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
        timeout: 15_000,
      });

      const monitorName = `e2e-http-${Date.now()}`;
      const url = `https://example.com/health-${Date.now()}`;

      await page.getByRole("radio", { name: "HTTP Check" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(monitorName);
      await page.getByPlaceholder("Enter URL to monitor").fill(url);

      await page.getByRole("button", { name: "Save" }).click();

      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: monitorName, exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });
  });
});
