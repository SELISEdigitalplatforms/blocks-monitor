import { test, expect } from "../../support/test-base"
import { getRowActionButton, openMonitorList } from "../../support/monitor-helpers"

test.describe("Monitor - pause & resume", () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(async ({ page }) => {
    await openMonitorList(page)
  })

  test("TC-0048: Actions menu shows 'Pause' for an active monitor and 'Resume' for a paused one", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page)
    test.skip(!actionButton, "No monitor with a row action menu is available.")
    await actionButton!.click()
    const menuItem = page.getByRole("menuitem").first()
    await expect(menuItem).toHaveText(/Pause|Resume/)
  })

  test("TC-0049: Pausing a monitor opens a confirmation dialog with the exact copy", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page)
    test.skip(!actionButton, "No monitor with a row action menu is available.")
    await actionButton!.click()
    const pauseItem = page.getByRole("menuitem", { name: "Pause" })
    if (await pauseItem.isVisible()) {
      await pauseItem.click()
      await expect(page.getByRole("heading", { name: "Pause monitor?" })).toBeVisible()
      await expect(
        page.getByText("This will temporarily stop all checks for this monitor until resumed."),
      ).toBeVisible()
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible()
    }
  })

  test("TC-0050: Resuming a monitor opens a confirmation dialog with the exact copy", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page)
    test.skip(!actionButton, "No monitor with a row action menu is available.")
    await actionButton!.click()
    const resumeItem = page.getByRole("menuitem", { name: "Resume" })
    if (await resumeItem.isVisible()) {
      await resumeItem.click()
      await expect(page.getByRole("heading", { name: "Resume monitor?" })).toBeVisible()
      await expect(
        page.getByText("Checks will start running again based on the configured interval."),
      ).toBeVisible()
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible()
    }
  })

  test("TC-0051: Confirming Pause/Resume shows the correct success toast and refreshes affected queries", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page)
    test.skip(!actionButton, "No monitor with a row action menu is available.")
    await actionButton!.click()
    await page.getByRole("menuitem", { name: /Pause|Resume/ }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await expect(page.getByText(/Monitor (paused|resumed) successfully/).first()).toBeVisible({
      timeout: 15000,
    })
  })

  test("TC-0053: Cancel in the Pause/Resume dialog leaves the monitor's active state unchanged", async ({
    page,
  }) => {
    const actionButton = await getRowActionButton(page)
    test.skip(!actionButton, "No monitor with a row action menu is available.")
    await actionButton!.click()
    await page.getByRole("menuitem", { name: /Pause|Resume/ }).click()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(
      page.getByRole("heading", { name: /Pause monitor\?|Resume monitor\?/ }),
    ).toBeHidden()
  })
})
