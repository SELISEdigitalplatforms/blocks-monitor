import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"
import { reuseOrCreateSharedProject } from "../../support/create-and-delete-project"
import { e2eCredentials } from "../../support/env"
import { loginThroughOidc } from "../../support/login-helper"
import {
  MONITOR_SESSION_PATH,
  writeMonitorProject,
} from "../../support/monitor-project"
import { resetRunOutcome } from "../../support/run-outcome"

test.describe("monitor suite setup", () => {
  test("login, reuse or create the shared monitor project", async ({ browser }) => {
    test.setTimeout(300_000)

    resetRunOutcome()
    e2eCredentials()

    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    try {
      await loginThroughOidc(page)
      await expect(
        page.getByRole("heading", {
          name: /Your Blocks Projects|Welcome to SELISE Blocks/,
        }),
      ).toBeVisible({ timeout: 30_000 })

      const { projectName, dashboardUrl, itemId } = await reuseOrCreateSharedProject(page)
      if (!itemId) {
        throw new Error(`Could not resolve itemId from dashboard URL: ${dashboardUrl}`)
      }

      writeMonitorProject({
        projectName,
        itemId,
        dashboardUrl: dashboardUrl.replace(/\?.*$/, ""),
      })

      fs.mkdirSync(path.dirname(MONITOR_SESSION_PATH), { recursive: true })
      await context.storageState({ path: MONITOR_SESSION_PATH })
    } finally {
      await context.close()
    }
  })
})
