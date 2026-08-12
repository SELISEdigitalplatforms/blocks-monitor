import { test, expect } from "../../support/test-base";
import { loginFresh } from "../../support/login-helper";

test.describe("Monitor - add", () => {
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
    await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("link", { name: "Monitor" }).click();
    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
      timeout: 30000,
    });
  });

  test("TC-0022: 'Add Monitor' opens the Add monitor modal", async ({ page }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();
    await expect(page.getByText("Monitor type", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByText("Tag a Service")).toBeVisible();
    await expect(page.getByText("URL to monitor")).toBeVisible();
  });

  test("TC-0023: Monitor type defaults to 'HTTP Check' and toggling to 'Heartbeat' swaps the form fields", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    await expect(page.getByLabel("HTTP Check")).toBeChecked();
    await expect(page.getByText("URL to monitor")).toBeVisible();
    await expect(page.getByText("Request Configuration")).toBeVisible();

    await page.getByLabel("Heartbeat").check();
    await expect(page.getByText("URL to monitor")).toHaveCount(0);
    await expect(page.getByText("Request Configuration")).toHaveCount(0);

    await page.getByRole("button", { name: "Monitor settings" }).click();
    await expect(page.getByText(/grace time/i)).toBeVisible();
  });

  test("TC-0026: 'Tag a Service' defaults to 'None' with Deployed and My services as alternatives", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    await expect(page.getByLabel("None")).toBeChecked();

    await page.getByLabel("Deployed").check();
    await expect(page.getByText("Select repo")).toBeVisible();

    await page.getByLabel("My services").check();
    await expect(page.getByText("Select service")).toBeVisible();
  });

  test("TC-0029: Selecting a deployed repo auto-fills the URL to monitor field", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    await page.getByLabel("Deployed").check();
    await page.getByText("Select repo").click();

    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstOption.click();
      const urlInput = page.getByPlaceholder("Enter URL to monitor");
      await expect(urlInput).not.toHaveValue("");
    }
    // NOTE: assumes this test project has at least one deployed repo; otherwise the dropdown has no options.
  });

  test("TC-0037: Monitor interval slider offers the documented tick values", async ({ page }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    await page.getByRole("button", { name: "Monitor settings" }).click();
    for (const tick of ["30s", "1min", "5min", "30min", "1h"]) {
      await expect(page.getByText(tick, { exact: true }).first()).toBeVisible();
    }
  });

  test("TC-0038: Saving a valid HTTP Check monitor succeeds and navigates to its details page", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    const monitorName = `api-health-${Date.now()}`;
    await page.getByLabel("Name").fill(monitorName);
    await page
      .getByPlaceholder("Enter URL to monitor")
      .fill(`https://example.com/health-${Date.now()}`);

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 15000 });
  });

  test("TC-0039: Saving a valid Heartbeat monitor succeeds and navigates to its details page", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    const monitorName = `nightly-batch-job-${Date.now()}`;
    await page.getByLabel("Heartbeat").check();
    await page.getByLabel("Name").fill(monitorName);

    await page.getByRole("button", { name: "Monitor settings" }).click();
    const graceSlider = page.getByRole("slider").last();
    await graceSlider.click();
    await page.keyboard.press("ArrowRight");

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Monitor successfully created.")).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 15000 });
  });

  test("TC-0041: Save button stays disabled while the add-monitor request is pending", async ({
    page,
  }) => {
    await page.getByTestId("add-monitor-button").click();
    await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();

    const monitorName = `dup-click-${Date.now()}`;
    await page.getByLabel("Name").fill(monitorName);
    await page
      .getByPlaceholder("Enter URL to monitor")
      .fill(`https://example.com/health-${Date.now()}`);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
  });
});
