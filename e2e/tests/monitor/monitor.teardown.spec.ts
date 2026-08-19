import { test } from "@playwright/test"
import { deleteCreatedProject } from "../../support/create-and-delete-project"
import { ensureAuthenticated } from "../../support/login-helper"
import { clearMonitorProject, readMonitorProject } from "../../support/monitor-project"

test.describe("monitor teardown", () => {
  test("delete shared monitor project", async ({ page }) => {
    test.setTimeout(180_000)
    const fixture = readMonitorProject()

    await ensureAuthenticated(page)
    await deleteCreatedProject(page, fixture?.projectName)
    clearMonitorProject()
  })
})
