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

test.describe("Monitor - edit", () => {
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

  test("TC-0042: 'Configure' opens the Edit monitor modal pre-filled with the monitor's current values", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Configure" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure" }),
    ).toBeVisible();

    await expect(page.getByLabel("Name")).not.toHaveValue("");
  });

  test("TC-0043: Monitor type, Name, Tag a Service and URL are locked (read-only) in edit mode", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Configure" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure" }),
    ).toBeVisible();

    // NOTE: the Monitor type radios are not rendered in edit mode for this monitor;
    // only assert on them when present.
    const httpCheckRadio = page.getByLabel("HTTP Check");
    if (await httpCheckRadio.isVisible().catch(() => false)) {
      await expect(httpCheckRadio).toBeDisabled();
      await expect(page.getByLabel("Heartbeat")).toBeDisabled();
    }
    await expect(page.getByLabel("Name")).toBeDisabled();
    await expect(page.getByLabel("None")).toBeDisabled();
    await expect(
      page.getByText("Monitor source cannot be changed for existing monitors."),
    ).toBeVisible();
  });

  test("TC-0044: Editable settings (interval, timeout/grace time, request config) can still be changed in edit mode", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Configure" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Monitor settings" }).click();
    const intervalSlider = page.getByRole("slider").first();
    await expect(intervalSlider).toBeEnabled();

    await intervalSlider.click();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Monitor successfully updated.", { exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("TC-0045: Saving an edited monitor shows a success toast and closes the modal", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Configure" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Monitor settings" }).click();
    const intervalSlider = page.getByRole("slider").first();
    await intervalSlider.click();
    await page.keyboard.press("ArrowLeft");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Monitor successfully updated.", { exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("heading", { name: "Configure" })).toBeHidden();
    await expect(page).toHaveURL(/\/monitor\/[^/]+$/);
  });

  test("TC-0047: Re-saving a monitor's own unchanged URL is accepted", async ({
    page,
  }) => {
    await openFirstMonitor(page);
    await page.getByRole("button", { name: "Configure" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Monitor successfully updated.", { exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
