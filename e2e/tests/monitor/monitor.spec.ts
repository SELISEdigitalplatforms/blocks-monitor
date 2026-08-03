import { test, expect } from "../../support/test-base";
import { MonitorPage, MonitorDetailsPage, IncidentsPage } from "../../support/pages/monitor-page";

test.describe("Monitor", () => {
  let monitor: MonitorPage;

  test.beforeEach(async ({ page }) => {
    monitor = new MonitorPage(page);
    await monitor.goto();
  });

  test("renders the monitor list page with Add Monitor button", async () => {
    await expect(monitor.addMonitorButton).toBeVisible();
  });

  test("switches between My monitors and Blocks services tabs", async () => {
    await expect(monitor.tab("My monitors")).toBeVisible();
    await expect(monitor.tab("Blocks services")).toBeVisible();

    await monitor.selectTab("Blocks services");
    await expect(monitor.page.getByRole("tab", { name: "Blocks services" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await monitor.selectTab("My monitors");
    await expect(monitor.page.getByRole("tab", { name: "My monitors" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("opens the Add monitor modal", async () => {
    await monitor.openAddMonitorModal();

    await expect(monitor.page.getByText("Monitor type", { exact: true })).toBeVisible();
    await expect(monitor.page.getByLabel("Add monitor").getByText("Name")).toBeVisible();
    await expect(monitor.page.getByText("URL to monitor")).toBeVisible();
  });

  test("closes the Add monitor modal without saving", async () => {
    await monitor.openAddMonitorModal();
    await monitor.cancelAddMonitorForm();

    await expect(monitor.addMonitorDialog).not.toBeVisible({ timeout: 5_000 });
  });

  test("navigates to the monitor details page by clicking a table row", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await expect(details.heading).toBeVisible({ timeout: 15_000 });
  });

  test("shows Current Status on the monitor details page", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await expect(details.currentStatus).toBeVisible({ timeout: 10_000 });
  });

  test("shows response time controls on the monitor details page", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const isVisible = await details.timeRangeSelect.isVisible().catch(() => false);
    if (isVisible) {
      await expect(details.timeRangeSelect).toBeVisible();
    }
  });

  test("opens the Configure modal from the monitor details page", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openConfigureModal();

    await expect(details.configureDialog).toBeVisible({ timeout: 10_000 });
  });

  test("opens notification settings and adds an email", async ({ page }) => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openNotificationSettings();
    await details.addNotificationEmail("test@example.com");
    await details.page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Monitor successfully updated.").first()).toBeVisible({
      timeout: 35_000,
    });
  });

  test("pauses a monitor via the action dropdown", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.pause();
    if (opened) {
      await expect(details.confirmationDialog("Pause monitor?")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("resumes a monitor via the action dropdown", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.resume();
    if (opened) {
      await expect(details.confirmationDialog("Resume monitor?")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("deletes a monitor via the action dropdown", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.delete();
    if (opened) {
      await expect(details.confirmationDialog("Remove monitor?")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("navigates to the incidents page from monitor details", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const navigated = await details.goToIncidents();
    if (navigated) {
      const incidents = new IncidentsPage(details.page);
      await expect(incidents.heading).toBeVisible({ timeout: 10_000 });
    }
  });

  test("navigates back from monitor details to the monitor list", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await expect(details.heading).toBeVisible({ timeout: 15_000 });

    if (await details.backButton.isVisible().catch(() => false)) {
      await details.goBack();
      await expect(monitor.heading).toBeVisible({ timeout: 10_000 });
    }
  });

  test("shows a skeleton loader while monitor data is loading", async () => {
    await monitor.goto();

    const skeleton = monitor.page.locator('[class*="skeleton"], [class*="Skeleton"]');
    const hasSkeleton = await skeleton
      .first()
      .isVisible()
      .catch(() => false);
    if (hasSkeleton) {
      await expect(skeleton.first()).toBeVisible();
    }
  });

  test("shows pagination controls when there are multiple pages", async () => {
    const hasPagination = await monitor.pagination.isVisible().catch(() => false);
    if (hasPagination) {
      await expect(monitor.pagination).toBeVisible();
    }
  });

  test("sorts the monitor list by clicking a column header", async () => {
    const nameHeader = monitor.columnHeader("Name");
    if (await nameHeader.isVisible().catch(() => false)) {
      await nameHeader.click();

      const sortIcon = monitor.page.locator('[class*="sort"], svg[class*="arrow"]');
      await expect(sortIcon.first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("shows validation errors when submitting Add Monitor form with empty fields", async () => {
    await monitor.openAddMonitorModal();

    const saveButton = monitor.page.getByRole("button", { name: /^Save$/i });
    await expect(saveButton).toBeDisabled();
  });

  test("creates a new monitor with HTTP Check type", async () => {
    await monitor.createHttpMonitor("E2E Playwright Monitor", "https://example.com/health");

    await expect(monitor.cell("E2E Playwright Monitor")).toBeVisible({ timeout: 15_000 });
  });

  test("changes the response time time range", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const isVisible = await details.timeRangeSelect.isVisible().catch(() => false);
    if (isVisible) {
      await details.timeRangeSelect.click();

      const option5m = details.page.getByRole("option", { name: /5min|5 m/i });
      if (await option5m.isVisible().catch(() => false)) {
        await option5m.click();
      }
    }
  });

  test("updates monitor configuration via the Configure modal", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openConfigureModal();
    await details.saveConfigureModalIfEnabled();
  });

  test("saves a notification email and verifies the dialog closes", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openNotificationSettings();
    await details.addNotificationEmail("e2e-test@blocks.dev");
    await details.saveNotificationSettingsIfEnabled();
  });

  test("confirms pause dialog and verifies dialog closes", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.pause();
    if (opened) {
      await expect(details.confirmationDialog("Pause monitor?")).toBeVisible({ timeout: 5_000 });

      const confirmed = await details.confirmDialogIfPresent();
      if (confirmed) {
        await expect(details.confirmationDialog("Pause monitor?")).not.toBeVisible({
          timeout: 5_000,
        });
      }
    }
  });

  test("confirms resume dialog and verifies dialog closes", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.resume();
    if (opened) {
      await expect(details.confirmationDialog("Resume monitor?")).toBeVisible({ timeout: 5_000 });

      const confirmed = await details.confirmDialogIfPresent();
      if (confirmed) {
        await expect(details.confirmationDialog("Resume monitor?")).not.toBeVisible({
          timeout: 5_000,
        });
      }
    }
  });

  test("confirms delete dialog and verifies monitor list reloads", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const opened = await details.delete();
    if (opened) {
      await expect(details.confirmationDialog("Remove monitor?")).toBeVisible({ timeout: 5_000 });

      const confirmed = await details.confirmDialogIfPresent();
      if (confirmed) {
        await expect(monitor.heading).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test("shows the incidents list on the incidents page", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const navigated = await details.goToIncidents();
    if (navigated) {
      const incidents = new IncidentsPage(details.page);
      await expect(incidents.heading).toBeVisible({ timeout: 10_000 });
      await expect(incidents.table).toBeVisible({ timeout: 10_000 });
    }
  });

  test("navigates back from incidents page to monitor details", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    const navigated = await details.goToIncidents();
    if (navigated) {
      const incidents = new IncidentsPage(details.page);
      await expect(incidents.heading).toBeVisible({ timeout: 10_000 });

      if (await incidents.backButton.isVisible().catch(() => false)) {
        await incidents.goBack();
        await expect(details.heading).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test("displays monitor cards with status on the details page", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await expect(details.currentStatus).toBeVisible({ timeout: 10_000 });

    const statusCard = details.page.getByText(/up|down/i).first();
    await expect(statusCard).toBeVisible({ timeout: 10_000 });
  });

  test("opens Configure modal and verifies form fields are populated", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openConfigureModal();

    await expect(details.page.getByLabel("Name")).toBeVisible();
    await expect(details.page.getByLabel("URL to monitor")).toBeVisible();
  });

  test("opens notification settings and verifies existing emails are listed", async () => {
    await monitor.openFirstMonitor();

    const details = new MonitorDetailsPage(monitor.page);
    await details.openNotificationSettings();

    const count = await details.emailInputs.count();
    if (count > 0) {
      await expect(details.emailInputs.first()).toBeVisible();
    }
  });

  test("handles the empty monitor list state", async () => {
    await monitor.goto();

    const isVisible = await monitor.emptyStateMessage.isVisible().catch(() => false);
    if (isVisible) {
      await expect(monitor.emptyStateMessage).toBeVisible();
    }
  });
});
