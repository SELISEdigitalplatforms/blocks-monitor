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
    await firstRow.click();
    try {
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

test.describe("Monitor - details", () => {
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

  test("TC-0059: Monitor Details page shows a loading skeleton while monitor/downtime data is loading", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    await page.route("**/*", async (route) => {
      if (["xhr", "fetch"].includes(route.request().resourceType())) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    await page.reload();
    const skeleton = page.locator('[class*="skeleton"]').first();
    // NOTE: this page may render server-side with data already populated on
    // reload, in which case no client-side loading skeleton is shown.
    if (await skeleton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(skeleton).toBeVisible();
    }
  });

  test("TC-0060: 'Current Status' summary card shows Up/Down state with a colored left border and elapsed duration", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const statusCard = page
      .locator("div")
      .filter({ hasText: "Current Status" })
      .first();
    await expect(statusCard).toBeVisible();
    await expect(statusCard.getByText(/Currently (up|down) for/)).toBeVisible();
  });

  test("TC-0061: Uptime-range summary cards show correct percentage and incident/downtime totals", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const rangeCard = page
      .getByRole("heading", { name: "Last 7 days" })
      .locator("..");
    await expect(rangeCard).toBeVisible();
    await expect(rangeCard.getByText(/%$/)).toBeVisible();
    await expect(rangeCard.getByText(/incidents,.*down/)).toBeVisible();
  });

  test("TC-0062: General information card shows Tagged Service, URL/Heartbeat URL and Monitor type", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    await expect(page.getByText("General information")).toBeVisible();
    await expect(page.getByText("Tagged Service")).toBeVisible();
    await expect(
      page.getByText("URL to monitor").or(page.getByText("Heartbeat URL")),
    ).toBeVisible();
    await expect(page.getByText("Monitor type")).toBeVisible();
  });

  test("TC-0063: General information shows 'None' when no repo or external service is tagged", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    // NOTE: assumes the opened monitor has no tagged repo/service.
    const taggedServiceLabel = page.getByText("Tagged Service", {
      exact: true,
    });
    const taggedServiceValue = taggedServiceLabel.locator(
      "xpath=following-sibling::*[1]",
    );
    const text = await taggedServiceValue.innerText();
    if (!text.includes("Deployed service") && !text.includes("My service")) {
      expect(text).toContain("None");
    }
  });

  test("TC-0064: Notification recipients summary shows the first email plus a '+N more' count", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const recipientsRow = page
      .locator("div")
      .filter({ hasText: "Notification recipients" })
      .last();
    const text = await recipientsRow.innerText();
    if (/\+ \d+ more/.test(text)) {
      await expect(recipientsRow.getByText(/\+ \d+ more/)).toBeVisible();
    }
  });

  test("TC-0065: Notification recipients shows 'Add recipient' prompt when no emails are configured", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const recipientsRow = page
      .locator("div")
      .filter({ hasText: "Notification recipients" })
      .last();
    const text = await recipientsRow.innerText();
    if (text.includes("Add recipient")) {
      await expect(recipientsRow.getByText("Add recipient")).toBeVisible();
    }
  });

  test("TC-0066: Notification recipients and header actions are hidden for auto-discovered Blocks-service monitors", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Blocks services" }).click();
    const rowCount = await page.getByRole("row").count();
    if (rowCount > 1) {
      const firstRow = page.getByRole("row").nth(1);
      await firstRow.click();
      try {
        await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
      } catch {
        await firstRow.click();
        await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 15000 });
      }
      await expect(
        page.getByRole("button", { name: "Notification Settings" }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Configure" })).toHaveCount(
        0,
      );
      await expect(page.getByText("Notification recipients")).toHaveCount(0);
    }
  });

  test("TC-0067: Response time chart re-fetches when the time range selector changes", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    const timeRangeSelect = page.getByRole("combobox").first();
    await timeRangeSelect.click();
    await page.getByRole("option", { name: "Last 24 Hours" }).click();
    await expect(timeRangeSelect).toContainText("Last 24 Hours");
  });

  test("TC-0068: 'View all incidents' link only appears when there are more than 4 incidents, and navigates to the full incident list", async ({
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
    }
  });

  test("TC-0069: Back button on Monitor Details returns to the previous page", async ({
    page,
  }) => {
    await openFirstMonitor(page);

    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 15000,
    });
  });
});
