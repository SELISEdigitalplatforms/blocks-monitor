import { type Page, expect } from "@playwright/test"
import { readMonitorProject } from "./monitor-project"

export async function waitForRowsLoaded(page: Page) {
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 30000 })
    .catch(() => null)
  await expect(async () => {
    const rows = page.getByRole("row")
    const count = await rows.count()
    if (count <= 1) {
      await expect(page.getByText("No results.")).toBeVisible({ timeout: 500 })
      return
    }
    await expect(rows.nth(1)).toContainText(/[^\s]/, { timeout: 500 })
  }).toPass({ timeout: 30000 })
}

export async function ensureMonitorExists(page: Page) {
  await waitForRowsLoaded(page)
  const myMonitorsTab = page.getByRole("tab", { name: "My monitors" })
  if (await myMonitorsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await myMonitorsTab.click()
    await waitForRowsLoaded(page)
  }
  if (
    !(await page
      .getByText("No results.")
      .isVisible()
      .catch(() => false))
  ) {
    return
  }
  await page.getByTestId("add-monitor-button").click()
  await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible()
  await page.getByLabel("Name").fill(`e2e-pause-resume-${Date.now()}`)
  await page
    .getByPlaceholder("Enter URL to monitor")
    .fill(`https://example.com/health-${Date.now()}`)
  const saveButton = page.getByRole("button", { name: "Save" })
  try {
    await saveButton.click({ timeout: 5000 })
  } catch {
    await saveButton.click({ force: true })
  }
  try {
    await page.waitForURL(/\/monitor\/[^/]+$/, { timeout: 5000 })
    await page.goto(page.url().replace(/\/monitor\/[^/]+$/, "/monitor"))
    await waitForRowsLoaded(page)
  } catch {
    await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
      timeout: 15000,
    })
    await waitForRowsLoaded(page)
  }
}

export async function getRowActionButton(page: Page) {
  await waitForRowsLoaded(page)
  const rows = page.getByRole("row")
  const count = await rows.count()
  for (let r = 1; r < count; r++) {
    const row = rows.nth(r)
    await row.hover({ timeout: 1000 }).catch(() => null)
    const actionButton = row.locator('[aria-haspopup="menu"]').first()
    if (await actionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      return actionButton
    }
  }
  return null
}

export async function openFirstMonitor(page: Page) {
  await waitForRowsLoaded(page)
  const firstRow = page.getByRole("row").nth(1)

  for (let attempt = 1; attempt <= 3; attempt++) {
    await firstRow.click()
    try {
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 })
      return
    } catch (error) {
      if (attempt === 3) throw error
    }
  }
}

export async function openMonitorList(page: Page) {
  const fixture = readMonitorProject()
  if (!fixture) {
    throw new Error("Monitor project fixture not found. Did monitor-setup run?")
  }

  if (fixture.dashboardUrl) {
    await page.goto(fixture.dashboardUrl)
  } else {
    await page.goto("/app/console")
    await expect(page.getByRole("heading", { name: "Your Blocks Projects" })).toBeVisible({
      timeout: 30_000,
    })
    const developmentButton = page.getByRole("button", { name: /Development/ }).first()
    await developmentButton.waitFor({ state: "visible", timeout: 30000 })
    await developmentButton.click()
  }

  await expect(page.getByRole("heading", { name: "Project Details" }))
    .toBeVisible({ timeout: 30000 })
    .catch(async () => {
      await page.reload()
      await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible({
        timeout: 30000,
      })
    })

  const monitorLink = page.getByRole("link", { name: "Monitor" })
  await monitorLink.waitFor({ state: "visible", timeout: 30000 })
  await monitorLink.click()

  await expect(page.getByRole("heading", { name: "Monitor" }))
    .toBeVisible({ timeout: 30000 })
    .catch(async () => {
      await monitorLink.click()
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 30000,
      })
    })

  await ensureMonitorExists(page)
}
