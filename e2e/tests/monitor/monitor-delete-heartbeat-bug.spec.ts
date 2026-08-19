import { test, expect } from "../../support/test-base"
import { openMonitorList } from "../../support/monitor-helpers"

test("BUG-TC-0057: Deleting a newly-created Heartbeat monitor does not remove it from the list", async ({
  page,
}) => {
  test.setTimeout(90_000)

  await openMonitorList(page)

  await page.getByTestId("add-monitor-button").click()
  await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({ timeout: 15000 })

  await page.getByRole("radio", { name: "Heartbeat" }).click()
  const monitorName = `test Heartbit ${Date.now()}`
  const nameInput = page.getByRole("textbox", { name: "Name" })
  await nameInput.click()
  await nameInput.fill(monitorName)

  const saveButton = page.getByRole("button", { name: "Save" })
  await saveButton.click()
  await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
    timeout: 30000,
  })

  await page.getByRole("button", { name: "Go back" }).click()
  await expect(page.getByText(monitorName)).toBeVisible({
    timeout: 30000,
  })

  const row = page.getByRole("row", { name: monitorName })
  const actionButton = row.locator('[aria-haspopup="menu"]').first()
  const deleteMenuItem = page.getByRole("menuitem", { name: "Delete" })

  await actionButton.waitFor({ state: "visible", timeout: 15000 })
  await actionButton.click()
  try {
    await deleteMenuItem.click({ timeout: 10000 })
  } catch {
    await actionButton.click()
    await deleteMenuItem.click({ timeout: 15000 })
  }

  await page.getByRole("button", { name: "Confirm" }).click()

  await expect(page.getByText(monitorName)).not.toBeVisible({
    timeout: 30000,
  })
})
