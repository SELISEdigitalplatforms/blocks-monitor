import { test } from "@playwright/test"
import { deleteCreatedProject, ensureConsole } from "../../support/create-and-delete-project"
import {
  clearMonitorProject,
  clearMonitorSession,
  MONITOR_SESSION_PATH,
  readMonitorProject,
} from "../../support/monitor-project"
import { shouldDeleteSharedProject } from "../../support/run-outcome"

test.describe("monitor suite teardown", () => {
  test("delete the shared monitor project when the suite passed", async ({ browser }) => {
    test.setTimeout(120_000)

    const fixture = readMonitorProject()
    if (!fixture) return

    if (!shouldDeleteSharedProject()) {
      console.log(
        `[e2e] Keeping project "${fixture.projectName}" on the console ` +
          "(a test failed or E2E_KEEP_PROJECT=1).",
      )
      return
    }

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: MONITOR_SESSION_PATH,
    })
    const page = await context.newPage()
    try {
      await ensureConsole(page)
      const deleted = await deleteCreatedProject(page, fixture.projectName, {
        itemId: fixture.itemId,
      })

      clearMonitorProject()
      clearMonitorSession()

      if (!deleted) {
        console.log(
          `[e2e] Project "${fixture.projectName}" was not deleted automatically — ` +
            "remove it manually from the console if needed.",
        )
      }
    } finally {
      await context.close()
    }
  })
})
