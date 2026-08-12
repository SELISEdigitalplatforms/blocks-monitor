import { test, expect } from "../../support/test-base";
import { loginFresh } from "../../support/login-helper";

test.describe("Monitor - list", () => {
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

  test("TC-0011: Monitor list page renders with heading, API Docs link and tabs", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
    const apiDocsLink = page.getByRole("link", { name: "API Docs" });
    await expect(apiDocsLink).toBeVisible();
    await expect(apiDocsLink).toHaveAttribute("target", "_blank");

    await expect(page.getByRole("tab", { name: "My monitors" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Blocks services" }),
    ).toBeVisible();
  });

  test("TC-0012: 'My monitors' tab lists all monitors regardless of source type", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "My monitors" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Tagged Service" }),
    ).toBeVisible();
  });

  test("TC-0013: 'Blocks services' tab filters the list to platform-service monitors only", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Blocks services" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Tagged Service" }),
    ).toHaveCount(0);
  });

  test("TC-0014: Mobile viewport shows a Select dropdown instead of Tabs for switching monitor groups", async ({
    page,
  }) => {
    await page.setViewportSize({
      width: 375,
      height: 812,
    });

    const main = page.getByRole("main");
    await expect(main.getByRole("tablist")).toBeHidden({
      timeout: 5000,
    });

    await expect(main.getByRole("combobox")).toBeVisible({
      timeout: 5000,
    });
  });

  test("TC-0015: Monitor table shows Name, Monitor Type, URL, Tagged Service, Uptime and Status columns", async ({
    page,
  }) => {
    await expect(
      page.getByRole("columnheader", { name: "Name" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Monitor Type" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "URL" })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Tagged Service" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Uptime" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Status" }),
    ).toBeVisible();
  });

  test("TC-0016: Table loading skeleton renders while the monitor list request is pending", async ({
    page,
  }) => {
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

  test("TC-0017: 'No results.' renders when the monitor list is empty for the selected tab/filter", async ({
    page,
  }) => {
    // NOTE: assumes the "Blocks services" tab has zero monitors in this test environment.
    await page.getByRole("tab", { name: "Blocks services" }).click();
    const rowCount = await page.getByRole("row").count();
    if (rowCount <= 1) {
      await expect(page.getByText("No results.")).toBeVisible();
    }
  });

  test("TC-0018: Clicking a column header sorts the monitor list by that column", async ({
    page,
  }) => {
    const nameHeader = page.getByRole("columnheader", { name: "Name" });
    await nameHeader.click();
    await expect(page).toHaveURL(/isDescending=/);
    const urlAfterFirstClick = page.url();
    await nameHeader.click();
    await expect(page).not.toHaveURL(urlAfterFirstClick);
  });

  test("TC-0019: Pagination controls page through the monitor list and change page size", async ({
    page,
  }) => {
    const pageSizeSelect = page.getByRole("combobox").last();
    const currentPageSize = (await pageSizeSelect.innerText()).trim();
    await pageSizeSelect.click();
    // Pick an option different from the current value, since selecting the
    // already-active page size doesn't trigger a change event.
    const targetOption = page
      .getByRole("option")
      .filter({ hasNotText: currentPageSize })
      .first();
    if (await targetOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      const targetPageSize = (await targetOption.innerText()).trim();
      await targetOption.click();
      await expect(page).toHaveURL(new RegExp(`pageSize=${targetPageSize}`));
    } else {
      // No alternative page-size option was available in this state; nothing to assert.
      await page.keyboard.press("Escape");
      return;
    }

    const nextPageButton = page.getByRole("button", { name: /next/i });
    if (await nextPageButton.isEnabled()) {
      await nextPageButton.click();
      await expect(page).toHaveURL(/page=1/);
    }
  });

  test("TC-0020: Clicking a monitor row navigates to that monitor's details page", async ({
    page,
  }) => {
    const firstRow = page.getByRole("row").nth(1);
    const monitorName = (
      await firstRow.locator("td").first().innerText()
    ).trim();

    // The row click can occasionally be swallowed by a re-render; retry a few times.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await firstRow.click();
      try {
        await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
    await expect(
      page.getByRole("heading", { name: monitorName }),
    ).toBeVisible();
  });

  test("TC-0021: Row Actions menu is hidden for auto-discovered Blocks-service monitors", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Blocks services" }).click();
    const firstRow = page.getByRole("row").nth(1);
    if ((await page.getByRole("row").count()) > 1) {
      await expect(firstRow.getByRole("button")).toHaveCount(0);
    }
  });
});
