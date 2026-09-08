import fs from "fs";
import path from "path";
import { test } from "../../support/test-base";
import {
  deleteCreatedProject,
  ensureConsole,
  reuseOrCreateSharedProject,
} from "../../support/create-and-delete-project";
import { e2eCredentials } from "../../support/env";
import { loginThroughOidc } from "../../support/login-helper";
import {
  MONITOR_SESSION_PATH,
  clearMonitorProject,
  clearMonitorSession,
  readMonitorProject,
  writeMonitorProject,
} from "../../support/monitor-project";
import { resetRunOutcome, shouldDeleteSharedProject } from "../../support/run-outcome";
import {
  openMonitorList,
  runAddMonitorCancelCheck,
  runAddMonitorHttpCheckCheck,
  runApiDocsButtonCheck,
  runBlocksServicesTabCheck,
  runConfigureModalOpenCheck,
  runDeleteDialogCopyCheck,
  runDeleteFromDetailsCheck,
  runDeleteFromListCheck,
  runDeletePendingButtonCheck,
  runDetailsBackButtonCheck,
  runDetailsIncidentListCheck,
  runDetailsResponseTimeRangeCheck,
  runDetailsStatusCardCheck,
  runDetailsUptimeCardsCheck,
  runEditMonitorSaveCheck,
  runHeartbeatDeleteBugCheck,
  runHttpMethodBodyToggleCheck,
  runJsonSwitcherCheck,
  runMonitorSettingsAccordionCheck,
  runMonitorTypeToggleCheck,
  runMyMonitorsTabCheck,
  runNameSortCheck,
  runNotificationAddEmailCheck,
  runNotificationSettingsOpenCheck,
  runNotificationValidationCheck,
  runPaginationLabelCheck,
  runPauseDialogCheck,
  runPauseResumeCancelCheck,
  runPauseResumeConfirmCheck,
  runPauseResumeMenuCheck,
  runPausedBadgeCheck,
  runResumeDialogCheck,
  runRowClickNavigationCheck,
  runSourceTypeCheck,
} from "../../page/monitor";
import { expect } from "@playwright/test";

test.describe("Monitor - full page workflow", () => {
  test.setTimeout(600_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    // Mirror suite.setup.spec.ts: login, reuse/create shared project,
    // persist storage state so the workflow test reuses it.
    resetRunOutcome();
    e2eCredentials(); // fail fast if env vars are missing

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await loginThroughOidc(page);
      await expect(
        page.getByRole("heading", {
          name: /Your Blocks Projects|Welcome to SELISE Blocks/,
        }),
      ).toBeVisible({ timeout: 30_000 });

      const { projectName, dashboardUrl, itemId } = await reuseOrCreateSharedProject(page);
      if (!itemId) {
        throw new Error(`Could not resolve itemId from dashboard URL: ${dashboardUrl}`);
      }

      writeMonitorProject({
        projectName,
        itemId,
        dashboardUrl: dashboardUrl.replace(/\?.*$/, ""),
      });

      fs.mkdirSync(path.dirname(MONITOR_SESSION_PATH), { recursive: true });
      await context.storageState({ path: MONITOR_SESSION_PATH });
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);

    const fixture = readMonitorProject();
    if (!fixture) return;

    if (!shouldDeleteSharedProject()) {
      console.log(
        `[e2e] Keeping project "${fixture.projectName}" on the console ` +
          "(a test failed or E2E_KEEP_PROJECT=1).",
      );
      return;
    }

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: MONITOR_SESSION_PATH,
    });
    const page = await context.newPage();
    try {
      await ensureConsole(page);
      const deleted = await deleteCreatedProject(page, fixture.projectName, {
        itemId: fixture.itemId,
      });

      clearMonitorProject();
      clearMonitorSession();

      if (!deleted) {
        console.log(
          `[e2e] Project "${fixture.projectName}" was not deleted automatically — ` +
            "remove it manually from the console if needed.",
        );
      }
    } finally {
      await context.close();
    }
  });

  test("runs the entire Monitor page flow end-to-end", async ({ page }) => {
    await test.step("Open the Monitor list (create one if empty)", async () => {
      await openMonitorList(page);
    });

    await test.step("Pause & resume — actions menu shows the right item (TC-0048)", async () => {
      await runPauseResumeMenuCheck(page);
    });

    await test.step("Pause — confirmation dialog copy (TC-0049)", async () => {
      await runPauseDialogCheck(page);
    });

    await test.step("Resume — confirmation dialog copy (TC-0050)", async () => {
      await runResumeDialogCheck(page);
    });

    await test.step("Pause/Resume — confirming shows success toast (TC-0051)", async () => {
      await runPauseResumeConfirmCheck(page);
    });

    await test.step("Cancel leaves the monitor's active state unchanged (TC-0053)", async () => {
      await runPauseResumeCancelCheck(page);
    });

    await test.step("Delete — confirmation dialog copy (TC-0054)", async () => {
      await runDeleteDialogCopyCheck(page);
    });

    // TC-0055 actually deletes a monitor; openMonitorList ensures one exists.
    await test.step("Delete — confirm from list removes the row (TC-0055)", async () => {
      await runDeleteFromListCheck(page);
    });

    // TC-0056 needs a monitor to open; ensureMonitorExists inside openMonitorList handles it.
    await test.step("Delete — confirm from details page navigates back (TC-0056)", async () => {
      await runDeleteFromDetailsCheck(page);
    });

    // TC-0058: Confirm button is disabled while pending. Also needs a monitor.
    await test.step("Delete — Confirm button is disabled while pending (TC-0058)", async () => {
      await runDeletePendingButtonCheck(page);
    });

    await test.step("BUG-TC-0057: Deleting a newly-created Heartbeat monitor removes it from the list", async () => {
      await runHeartbeatDeleteBugCheck(page);
    });

    await test.step("Status — 'Paused' badge appears after pausing", async () => {
      await runPausedBadgeCheck(page);
    });

    await test.step("Tabs — switch to 'Blocks services'", async () => {
      await runBlocksServicesTabCheck(page);
    });

    await test.step("Tabs — switch back to 'My monitors'", async () => {
      await runMyMonitorsTabCheck(page);
    });

    await test.step("Sort — clicking the Name header is interactive", async () => {
      await runNameSortCheck(page);
    });

    await test.step("Pagination — 'Rows per page' control is rendered", async () => {
      await runPaginationLabelCheck(page);
    });

    await test.step("Details — Configure button opens the edit modal", async () => {
      await runConfigureModalOpenCheck(page);
    });

    await test.step("Details — Notification Settings opens with Add email control", async () => {
      await runNotificationSettingsOpenCheck(page);
    });

    await test.step("Details — Back button returns to the Monitor list", async () => {
      await runDetailsBackButtonCheck(page);
    });

    await test.step("List — API Docs button links to swagger", async () => {
      await runApiDocsButtonCheck(page);
    });

    await test.step("Add Monitor — Monitor type toggle (HTTP ↔ Heartbeat)", async () => {
      await runMonitorTypeToggleCheck(page);
    });

    await test.step("Add Monitor — Source type reveals Select repo / Select service", async () => {
      await runSourceTypeCheck(page);
    });

    await test.step("Add Monitor — Monitor settings accordion exposes Interval and Timeout sliders", async () => {
      await runMonitorSettingsAccordionCheck(page);
    });

    await test.step("Add Monitor — HTTP method enables Request body when Post", async () => {
      await runHttpMethodBodyToggleCheck(page);
    });

    await test.step("Add Monitor — Send-as-JSON switch reveals Request headers", async () => {
      await runJsonSwitcherCheck(page);
    });

    await test.step("Add Monitor — Cancel closes the modal without saving", async () => {
      await runAddMonitorCancelCheck(page);
    });

    await test.step("List — Row click navigates to monitor details", async () => {
      await runRowClickNavigationCheck(page);
    });

    await test.step("Details — Current Status card shows 'Up' or 'Down' with elapsed text", async () => {
      await runDetailsStatusCardCheck(page);
    });

    await test.step("Details — Uptime cards render Last 7 / 30 / 365 days", async () => {
      await runDetailsUptimeCardsCheck(page);
    });

    await test.step("Details — Status Overview time-range combobox lists 1h through 24h", async () => {
      await runDetailsResponseTimeRangeCheck(page);
    });

    await test.step("Details — Latest incidents section renders rows or empty state", async () => {
      await runDetailsIncidentListCheck(page);
    });

    await test.step("Details — Configure save persists changes (HTTP method → Post)", async () => {
      await runEditMonitorSaveCheck(page);
    });

    await test.step("Details — Notification Settings rejects invalid email format", async () => {
      await runNotificationValidationCheck(page);
    });

    await test.step("Details — Notification Settings adds and saves a valid email", async () => {
      await runNotificationAddEmailCheck(page);
    });

    await test.step("Add Monitor — HTTP Check happy path saves and opens details", async () => {
      await runAddMonitorHttpCheckCheck(page);
    });
  });
});
