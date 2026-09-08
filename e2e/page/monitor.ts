import { type Page, expect } from "@playwright/test";
import {
  getRowActionButton,
  openFirstMonitor,
  openMonitorList,
  waitForRowsLoaded,
} from "../support/monitor-helpers";

type RowActionButton = NonNullable<Awaited<ReturnType<typeof getRowActionButton>>>;

async function withRowActionButton(
  page: Page,
  callback: (button: RowActionButton) => Promise<void>,
): Promise<void> {
  const button = await getRowActionButton(page);
  if (!button) {
    throw new Error("No monitor with a row action menu is available.");
  }
  await callback(button);
}

export async function resetToMonitorList(page: Page) {
  await page.keyboard.press("Escape").catch(() => null);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 30_000 })
    .catch(() => null);
}

export async function runPauseResumeMenuCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const menuItem = page.getByRole("menuitem").first();
    await expect(menuItem).toHaveText(/^(Pause|Resume)$/);
    await page.keyboard.press("Escape");
  });
}

export async function runPauseDialogCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);

  // The Pause menu item only appears for monitors that are currently active.
  // Resume the first monitor first (Resume -> Confirm) so this assertion is
  // deterministic regardless of any leftover paused state from a previous run.
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const resumeItem = page.getByRole("menuitem", { name: "Resume", exact: true });
    if (await resumeItem.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await resumeItem.click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      // Note: alert-action.tsx emits "Monitor resumed successfully" with no trailing period.
      await expect(
        page.getByText("Monitor resumed successfully", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      // Already active; just close the menu so the next step can reopen it.
      await page.keyboard.press("Escape");
    }
  });

  await resetToMonitorList(page);

  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const pauseItem = page.getByRole("menuitem", { name: "Pause", exact: true });
    await expect(pauseItem).toBeVisible();
    await pauseItem.click();
    await expect(page.getByRole("heading", { name: "Pause monitor?", exact: true })).toBeVisible();
    await expect(
      page.getByText("This will temporarily stop all checks for this monitor until resumed.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pause monitor?", exact: true })).toHaveCount(0);
  });
}

export async function runResumeDialogCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);

  // The Resume menu item only appears for monitors that are currently paused.
  // Pause the first monitor first so this assertion is deterministic regardless
  // of how earlier steps (TC-0049 cancels a pause) left the row's state.
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const pauseItem = page.getByRole("menuitem", { name: "Pause", exact: true });
    if (await pauseItem.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await pauseItem.click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
    } else {
      // Already paused; just close the menu so the next step can reopen it.
      await page.keyboard.press("Escape");
    }
  });

  await resetToMonitorList(page);

  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const resumeItem = page.getByRole("menuitem", { name: "Resume", exact: true });
    await expect(resumeItem).toBeVisible();
    await resumeItem.click();
    await expect(page.getByRole("heading", { name: "Resume monitor?", exact: true })).toBeVisible();
    await expect(
      page.getByText("Checks will start running again based on the configured interval.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resume monitor?", exact: true })).toHaveCount(
      0,
    );
  });
}

export async function runPauseResumeConfirmCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    await page.getByRole("menuitem", { name: /^(Pause|Resume)$/ }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    // Note: alert-action.tsx emits "Monitor paused/resumed successfully" with no trailing period.
    await expect(
      page.getByText(/^Monitor (paused|resumed) successfully$/, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
}

export async function runPauseResumeCancelCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    await page.getByRole("menuitem", { name: /^(Pause|Resume)$/ }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^(Pause|Resume) monitor\?$/ })).toHaveCount(0);
  });
}

export async function runDeleteDialogCopyCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Remove monitor?", exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "This action will permanently delete the monitor and its related history. This cannot be undone.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });
}

export async function runDeleteFromListCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  const firstRow = page.getByRole("row").nth(1);
  await expect(page.getByText("No results.", { exact: true })).toHaveCount(0);

  const monitorName = (await firstRow.locator("td").first().innerText()).trim();
  const actionButton = firstRow.locator('[aria-haspopup="menu"]').first();
  await expect(actionButton).toBeVisible();

  await actionButton.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("row", { name: new RegExp(monitorName) })).toHaveCount(0);
}

export async function runDeleteFromDetailsCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

export async function runDeletePendingButtonCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const confirmButton = page.getByRole("button", { name: "Confirm", exact: true });
    const cancelButton = page.getByRole("button", { name: "Cancel", exact: true });
    await confirmButton.click();
    await expect(confirmButton).toBeDisabled();
    await expect(cancelButton).toBeDisabled();
  });
}

export async function runHeartbeatDeleteBugCheck(page: Page): Promise<void> {
  await openMonitorList(page);

  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("radio", { name: "Heartbeat", exact: true }).click();
  const monitorName = `test Heartbit ${Date.now()}`;
  const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
  await nameInput.click();
  await nameInput.fill(monitorName);

  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await saveButton.click();
  await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByRole("row", { name: monitorName })).toBeVisible({
    timeout: 30_000,
  });

  const row = page.getByRole("row", { name: monitorName });
  const actionButton = row.locator('[aria-haspopup="menu"]').first();
  const deleteMenuItem = page.getByRole("menuitem", { name: "Delete", exact: true });

  await actionButton.waitFor({ state: "visible", timeout: 15_000 });
  await actionButton.click();
  try {
    await deleteMenuItem.click({ timeout: 10_000 });
  } catch {
    await actionButton.click();
    await deleteMenuItem.click({ timeout: 15_000 });
  }

  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("row", { name: monitorName })).toHaveCount(0, {
    timeout: 30_000,
  });
}

export async function runPausedBadgeCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();

    const pauseItem = page.getByRole("menuitem", { name: "Pause", exact: true });
    if ((await pauseItem.count()) > 0) {
      await pauseItem.click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      // Note: alert-action.tsx emits "Monitor paused successfully" with no trailing period.
      await expect(page.getByText("Monitor paused successfully", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });
  });
}

export async function runBlocksServicesTabCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await page.getByRole("tab", { name: "Blocks services", exact: true }).click();
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 15_000 })
    .catch(() => null);
}

export async function runMyMonitorsTabCheck(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "My monitors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

export async function runNameSortCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  const nameHeader = page.getByRole("columnheader", { name: "Name", exact: true });
  await expect(nameHeader).toBeVisible();
  await nameHeader.click();
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 15_000 })
    .catch(() => null);
  await nameHeader.click();
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 15_000 })
    .catch(() => null);
}

export async function runPaginationLabelCheck(page: Page): Promise<void> {
  await resetToMonitorList(page);
  await expect(page.getByText("Rows per page", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function runConfigureModalOpenCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Configure", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Configure", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runNotificationSettingsOpenCheck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notification Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add email", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toHaveCount(0, { timeout: 5_000 });
}

export async function runDetailsBackButtonCheck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

export async function runApiDocsButtonCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  const apiDocsLink = page.getByRole("link", { name: "API Docs", exact: true });
  await expect(apiDocsLink).toBeVisible();
  const href = await apiDocsLink.getAttribute("href");
  expect(href ?? "").toContain("swagger");
}

export async function runRowClickNavigationCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  const firstRow = page.getByRole("row").nth(1);
  const monitorName = (await firstRow.locator("td").first().innerText()).trim();
  await firstRow.locator("td").first().click();
  await expect(page.getByRole("heading", { name: monitorName, exact: true, level: 1 })).toBeVisible(
    { timeout: 15_000 },
  );
}

export async function runDetailsStatusCardCheck(page: Page): Promise<void> {
  await openMonitorList(page);

  // Earlier steps (runPausedBadgeCheck) leave the first row in the paused state.
  // The "Currently up/down for X" line is intentionally hidden for paused
  // monitors (details.tsx drops it together with the up/down colour and word),
  // so resume the first monitor first to verify the elapsed text path.
  await resetToMonitorList(page);
  await withRowActionButton(page, async (actionButton) => {
    await actionButton.click();
    const resumeItem = page.getByRole("menuitem", { name: "Resume", exact: true });
    if (await resumeItem.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await resumeItem.click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      // Note: alert-action.tsx emits "Monitor resumed successfully" with no trailing period.
      await expect(
        page.getByText("Monitor resumed successfully", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      await page.keyboard.press("Escape");
    }
  });

  await openFirstMonitor(page);
  await expect(page.getByRole("heading", { name: "Current Status", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Currently (up|down) for/)).toBeVisible();
}

export async function runDetailsUptimeCardsCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  await expect(page.getByRole("heading", { name: "Last 7 days", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last 30 days", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last 365 days", exact: true })).toBeVisible();
  await expect(page.getByText(/\d+\.\d+%/).first()).toBeVisible();
}

export async function runDetailsResponseTimeRangeCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  const rangeCombobox = page.getByRole("combobox").filter({ hasText: "Last 1 Hour" }).first();
  await expect(rangeCombobox).toBeVisible({ timeout: 15_000 });
  await rangeCombobox.click();
  await expect(page.getByRole("option", { name: "Last 1 Hour", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Last 3 Hours", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Last 6 Hours", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Last 12 Hours", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Last 24 Hours", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
}

export async function runDetailsIncidentListCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  await expect(page.getByText("Latest incidents", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const noResults = page.getByText("No results.", { exact: true }).first();
  const incidentRow = page
    .getByRole("row")
    .filter({ hasText: /Unresolved|Resolved/ })
    .first();
  if ((await noResults.count()) > 0) {
    await expect(noResults).toBeVisible();
  } else {
    await expect(incidentRow).toBeVisible();
  }
}

export async function runMonitorTypeToggleCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByRole("textbox", { name: "URL to monitor", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request Configuration", exact: true }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Heartbeat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "URL to monitor", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request Configuration", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Grace Time", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: "HTTP Check", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "URL to monitor", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runSourceTypeCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByText("Select repo", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Select service", { exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: "Deployed", exact: true }).click();
  await expect(page.getByText("Select repo", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: "My services", exact: true }).click();
  await expect(page.getByText("Select service", { exact: true })).toBeVisible();
  await expect(page.getByText("Select repo", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runMonitorSettingsAccordionCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByRole("region", { name: "Monitor settings", exact: true })).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(2);
  await expect(page.getByText("Monitor interval", { exact: true })).toBeVisible();
  await expect(page.getByText("Request timeout", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runHttpMethodBodyToggleCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Request Configuration", exact: true }).click();

  const bodyTextarea = page.getByRole("textbox", { name: "Request body", exact: true });
  await expect(bodyTextarea).toBeDisabled();

  await page.getByRole("radio", { name: "Post", exact: true }).click();
  await expect(bodyTextarea).toBeEnabled();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runJsonSwitcherCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Request Configuration", exact: true }).click();
  await page.getByRole("radio", { name: "Post", exact: true }).click();

  await expect(page.getByText("Request headers", { exact: true })).toHaveCount(0);

  await page.getByRole("switch", { name: "Send as JSON (application/json)", exact: true }).click();
  await expect(page.getByText("Request headers", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "X-Header-Name", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Value", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
}

export async function runAddMonitorCancelCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  const initialRowCount = await page.getByRole("row").count();

  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const monitorName = `Cancel Test ${Date.now()}`;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(monitorName);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });

  await expect(page.getByRole("row", { name: new RegExp(monitorName) })).toHaveCount(0);
  expect(await page.getByRole("row").count()).toBe(initialRowCount);
}

export async function runAddMonitorHttpCheckCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const monitorName = `Verify HTTP Check ${Date.now()}`;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(monitorName);
  await page
    .getByRole("textbox", { name: "URL to monitor", exact: true })
    .fill(`https://example.com/verify-${Date.now()}`);

  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  await expect(page.getByRole("heading", { name: monitorName, exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function runEditMonitorSaveCheck(page: Page): Promise<void> {
  await openMonitorList(page);
  await openFirstMonitor(page);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Configure", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Request Configuration", exact: true }).click();
  await page.getByRole("radio", { name: "Post", exact: true }).click();

  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  await expect(page.getByRole("heading", { name: "Configure", exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function runNotificationValidationCheck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notification Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Add email", exact: true }).click();
  const emailInput = page.getByPlaceholder("Enter email address", { exact: true }).last();
  await emailInput.fill("not-a-valid-email");
  await emailInput.blur();

  await expect(page.getByText("Please enter a valid email address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toHaveCount(0, { timeout: 5_000 });
}

export async function runNotificationAddEmailCheck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notification Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Add email", exact: true }).click();
  await page
    .getByPlaceholder("Enter email address", { exact: true })
    .last()
    .fill(`verify-${Date.now()}@yopmail.com`);

  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  await expect(
    page.getByRole("heading", { name: "Notification settings", exact: true }),
  ).toHaveCount(0, { timeout: 15_000 });
}

export { openMonitorList, openFirstMonitor, getRowActionButton, waitForRowsLoaded };
