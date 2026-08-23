import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import { reuseOrCreateSharedProject } from "../../support/create-and-delete-project"
import { ensureMonitorExists } from "../../support/monitor-helpers"
import { loginThroughOidc } from "../../support/login-helper"
import { MONITOR_SESSION_PATH, writeMonitorProject } from "../../support/monitor-project"
import { resetRunOutcome } from "../../support/run-outcome"

test.describe("monitor setup", () => {
  test("login, reuse or create one shared project, seed Monitor", async ({ page }) => {
    test.setTimeout(300_000)
    resetRunOutcome()

    await loginThroughOidc(page)
    await expect(
      page.getByRole("heading", { name: /Your Blocks Projects|Welcome to SELISE Blocks/ }),
    ).toBeVisible({ timeout: 30_000 })

    fs.mkdirSync(path.dirname(MONITOR_SESSION_PATH), { recursive: true })
    await page.context().storageState({ path: MONITOR_SESSION_PATH })

    const { projectName, dashboardUrl, itemId } = await reuseOrCreateSharedProject(page)
    if (!itemId) {
      throw new Error(`Could not resolve itemId from dashboard URL: ${dashboardUrl}`)
    }

    const monitorLink = page.getByRole("link", { name: "Monitor" })
    await monitorLink.waitFor({ state: "visible", timeout: 30_000 })
    await monitorLink.click()

    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({ timeout: 30_000 })
    await ensureMonitorExists(page)

    writeMonitorProject({
      projectName,
      itemId,
      dashboardUrl,
      monitorUrl: page.url().replace(/\?.*$/, ""),
    })
  })
})
