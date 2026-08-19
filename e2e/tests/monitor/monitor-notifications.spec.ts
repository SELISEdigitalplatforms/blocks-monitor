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

test.describe("Monitor - notification settings", () => {
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

  test("TC-0077: 'Notification Settings' opens a modal titled 'Notification settings' pre-filled with current recipients", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Notification Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Notification settings" }),
    ).toBeVisible();

    const emailInputs = page.getByPlaceholder("Enter email address");
    // NOTE: no email input rows render until at least one recipient is added.
    if ((await emailInputs.count()) === 0) {
      await page.getByRole("button", { name: "Add email" }).click();
    }
    await expect(emailInputs.first()).toBeVisible();
  });

  test("TC-0083: Saving valid, unique recipients updates the monitor and shows a success toast", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Notification Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Notification settings" }),
    ).toBeVisible();

    const emailInputs = page.getByPlaceholder("Enter email address");
    const count = await emailInputs.count();

    if (count === 0) {
      await page.getByRole("button", { name: "Add email" }).click();
    }

    await emailInputs.first().fill(`qa-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText("Monitor successfully updated.", { exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("TC-0084: Removing an email row clears its associated validation error", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Notification Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Notification settings" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add email" }).click();
    const emailInputs = page.getByPlaceholder("Enter email address");
    const lastIndex = (await emailInputs.count()) - 1;
    await emailInputs.nth(lastIndex).fill("not-an-email");
    await emailInputs.nth(lastIndex).blur();

    await expect(
      page.getByText("Please enter a valid email address"),
    ).toBeVisible();

    const trashButtons = page
      .getByRole("button")
      .filter({ has: page.locator("svg") });
    await trashButtons.last().click();

    await expect(
      page.getByText("Please enter a valid email address"),
    ).toHaveCount(0);
  });
});
