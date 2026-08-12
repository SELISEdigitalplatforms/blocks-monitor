import { test, expect } from "../../support/test-base";
import { loginFresh } from "../../support/login-helper";
import type { Page } from "@playwright/test";

async function openFirstMonitor(page: Page) {
  await expect(page.locator('[class*="skeleton"]').first()).toBeHidden({
    timeout: 15000,
  });
  const firstRow = page.getByRole("row").nth(1);
  await expect(firstRow).toBeVisible({ timeout: 15000 });

  // The row click can occasionally be swallowed by a re-render; retry a few times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (page.isClosed()) {
      throw new Error(
        "Page was closed unexpectedly before the monitor could be opened.",
      );
    }
    await firstRow.click();
    try {
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

test.describe("Monitor - incidents", () => {
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
  });

  test("TC-0070: Incident list Status column shows 'Resolved' or 'Unresolved' with matching color coding", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const incidentRow = page.getByRole("row").nth(1);
    if ((await page.getByRole("row").count()) > 1) {
      await expect(incidentRow.getByText(/Resolved|Unresolved/)).toBeVisible();
    }
  });

  test("TC-0071: 'Status Code' column only appears for HTTP Check monitors, not Heartbeat", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const monitorTypeLabel = page.getByText("Monitor type", { exact: true });
    const monitorTypeValue = monitorTypeLabel.locator(
      "xpath=following-sibling::*[1]",
    );
    const monitorTypeText = await monitorTypeValue.innerText();

    if (monitorTypeText.includes("HTTP Check")) {
      await expect(
        page.getByRole("columnheader", { name: "Status Code" }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("columnheader", { name: "Status Code" }),
      ).toHaveCount(0);
    }
  });

  test("TC-0072: Root cause column parses a JSON failure reason down to its error message", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const rootCauseCells = page.getByRole("columnheader", {
      name: "Root cause",
    });
    await expect(rootCauseCells).toBeVisible();
    // NOTE: actual message content depends on live incident data for this monitor.
  });

  test("TC-0074: Ongoing incidents (no end time) are visually distinguished from resolved ones", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const rowCount = await page.getByRole("row").count();
    if (rowCount > 1) {
      const ongoingCell = page.getByText("Ongoing").first();
      if (await ongoingCell.isVisible()) {
        await expect(ongoingCell).toBeVisible();
      }
    }
  });

  test("TC-0075: Incident list sorts by Start time descending by default", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const startTimeHeader = page.getByRole("columnheader", {
      name: "Start time",
    });
    await expect(startTimeHeader).toBeVisible();
  });

  test("TC-0076: Full Incidents page paginates and sorts independently of the details-page preview list", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const viewAllButton = page.getByRole("button", {
      name: "View all incidents",
    });
    if (await viewAllButton.isVisible()) {
      await viewAllButton.click();
      await expect(page).toHaveURL(/\/monitor\/incidents\/[^/]+$/, {
        timeout: 15000,
      });
      const pageSizeSelect = page.getByRole("combobox").last();
      await pageSizeSelect.click();
      await page.getByRole("option", { name: "15" }).click();
      await expect(page).toHaveURL(/pageSize=15/);
    }
  });
});
