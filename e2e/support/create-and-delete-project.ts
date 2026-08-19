import { Page, expect, test } from "@playwright/test"
import { e2eBaseUrl, e2eOsBaseUrl, e2eProjectId } from "./env"
import { ensureAuthenticated, ensureAuthenticatedOnCurrentOrigin } from "./login-helper"

const ORPHAN_PROJECT_PATTERN = /Test Project \d+/g
const ENV_BUTTON =
  /Development|Testing|Staging|IAT|UAT|Production|Pre-Prod|Prod Shadow/

const isVisibleNow = async (locator: { isVisible: (opts: { timeout: number }) => Promise<boolean> }) =>
  locator.isVisible({ timeout: 500 }).catch(() => false)

async function listOrphanProjectNames(page: Page): Promise<string[]> {
  const bodyText = await page.locator("body").innerText().catch(() => "")
  return [...new Set([...bodyText.matchAll(ORPHAN_PROJECT_PATTERN)].map((match) => match[0]))]
}

function consoleBase(host: "monitor" | "os" = "monitor") {
  return host === "os" ? e2eOsBaseUrl() : e2eBaseUrl()
}

/** Blocks console on Monitor or OS. */
export async function ensureConsole(page: Page, host: "monitor" | "os" = "monitor") {
  const base = consoleBase(host)
  const href = page.url()
  const onConsole =
    /^https?:/.test(href) &&
    new URL(href).origin === new URL(base).origin &&
    /\/app\/console\/?$/.test(new URL(href).pathname)

  if (!onConsole) {
    await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })
  }

  await expect(
    page.getByRole("heading", { name: /Your Blocks Projects|Welcome to SELISE Blocks/ }),
  ).toBeVisible({ timeout: 20_000 })
}

export function namedProjectCard(page: Page, projectName: string) {
  return page
    .locator("div")
    .filter({ has: page.getByText(projectName, { exact: true }) })
    .filter({
      has: page.getByRole("button", { name: ENV_BUTTON }),
    })
    .last()
}

async function waitForProjectCard(page: Page, projectName: string, host: "monitor" | "os" = "monitor") {
  for (let attempt = 0; attempt < 6; attempt++) {
    await ensureConsole(page, host)

    const card = namedProjectCard(page, projectName)
    if (await card.isVisible({ timeout: 1_500 }).catch(() => false)) {
      return card
    }

    if (attempt < 5) {
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForTimeout(500)
    }
  }

  throw new Error(`Project "${projectName}" did not appear on the ${host} console`)
}

/** Monitor project dashboard — Project Details / X-Blocks-Key. */
async function waitForMonitorDashboardReady(page: Page) {
  await expect(page).toHaveURL(/\/app\/(?!project\/)[^/]+\/dashboard/, { timeout: 20_000 })
  await expect(
    page
      .getByRole("heading", { name: "Project Details" })
      .or(page.getByText(/X-Blocks-Key/))
      .first(),
  ).toBeVisible({ timeout: 20_000 })
}

/** OS project dashboard — project name heading + Delete button. */
async function waitForOsDashboardReady(page: Page, projectName: string) {
  await expect(page).toHaveURL(/\/app\/(?!project\/)[^/]+\/dashboard/, { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function readProjectNameFromDashboard(page: Page): Promise<string> {
  const sidebarProject = page.getByRole("button", { name: /^Project / })
  if (await sidebarProject.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const label = await sidebarProject.innerText()
    return label.replace(/^Project\s+/i, "").trim()
  }

  const details = page
    .locator("main")
    .filter({ has: page.getByRole("heading", { name: "Project Details" }) })
  const nameBlock = details.getByText(/^Name\s+\S/, { exact: false }).first()
  if (await nameBlock.isVisible({ timeout: 3_000 }).catch(() => false)) {
    return (await nameBlock.innerText()).replace(/^Name\s+/, "").trim()
  }

  throw new Error(`Could not read project name from dashboard: ${page.url()}`)
}

async function openProjectById(page: Page, projectId: string) {
  await page.goto(`${e2eBaseUrl()}/app/${projectId}/dashboard`, { waitUntil: "domcontentloaded" })
  await waitForMonitorDashboardReady(page)
  const projectName = await readProjectNameFromDashboard(page)
  return { projectName, dashboardUrl: page.url(), itemId: projectId }
}

export async function openNamedProjectDashboard(
  page: Page,
  projectName: string,
  options?: { dashboardUrl?: string },
) {
  if (options?.dashboardUrl) {
    await page.goto(options.dashboardUrl, { waitUntil: "domcontentloaded" })
    try {
      await waitForMonitorDashboardReady(page)
      return
    } catch {
      // Fall through to card navigation.
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const card = await waitForProjectCard(page, projectName, "monitor")
    const envButton = card.getByRole("button", { name: ENV_BUTTON }).first()
    await expect(envButton).toBeVisible({ timeout: 10_000 })
    await envButton.click({ force: true })

    try {
      await waitForMonitorDashboardReady(page)
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

async function openOsProjectDashboard(page: Page, projectName: string) {
  await ensureConsole(page, "os")

  for (let attempt = 0; attempt < 3; attempt++) {
    const card = await waitForProjectCard(page, projectName, "os")
    const envButton = card.getByRole("button", { name: ENV_BUTTON }).first()
    await expect(envButton).toBeVisible({ timeout: 10_000 })
    await envButton.click({ force: true })

    try {
      await waitForOsDashboardReady(page, projectName)
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

async function deleteProjectOnOs(page: Page, projectName: string): Promise<boolean> {
  await page.goto(`${e2eOsBaseUrl()}/app/console`, { waitUntil: "domcontentloaded" })
  await ensureAuthenticatedOnCurrentOrigin(page)
  await openOsProjectDashboard(page, projectName)

  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Delete this environment?" })).toBeVisible()
  await page.getByRole("button", { name: "Delete", exact: true }).last().click()
  await expect(page.getByText("Successfully deleted", { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveURL(/\/app\/console$/, { timeout: 15_000 })
  return true
}

async function freeProjectSlotIfNeeded(page: Page) {
  await ensureConsole(page, "monitor")

  const welcomeHeading = page.getByRole("heading", { name: "Welcome to SELISE Blocks" })
  if (await isVisibleNow(welcomeHeading)) return

  const addProjectButton = page.getByText("Add Project", { exact: true }).first()
  if (await isVisibleNow(addProjectButton)) return

  throw new Error(
    "Console has no free project slot. Set E2E_REUSE_PROJECT_NAME or E2E_PROJECT_ID " +
      "to reuse an existing project, or delete a project manually from the console.",
  )
}

export async function createProject(page: Page) {
  await test.step("Open Monitor console", async () => {
    await ensureAuthenticated(page)
    await ensureConsole(page, "monitor")
  })

  await test.step("Start a new project from Add Project", async () => {
    const welcomeHeading = page.getByRole("heading", { name: "Welcome to SELISE Blocks" })
    const createProjectButton = page.getByRole("button", { name: "Create a project" })
    const addProjectButton = page.getByText("Add Project", { exact: true }).first()

    await freeProjectSlotIfNeeded(page)

    if (await welcomeHeading.isVisible().catch(() => false)) {
      await createProjectButton.click()
    } else {
      await expect(addProjectButton).toBeVisible({ timeout: 10_000 })
      await addProjectButton.click()
    }

    await expect(page.getByRole("heading", { name: "Name your project" })).toBeVisible({
      timeout: 30_000,
    })
  })

  const projectName = `Test Project ${Date.now()}`
  await test.step("Name the project and accept the agreements", async () => {
    const nameInput = page.locator('[placeholder="Enter your project name"]:visible')
    await nameInput.fill(projectName)

    await page.getByRole("checkbox", { name: "I confirm that I will use" }).click()
    await page.getByRole("checkbox", { name: "I accept the Terms of services" }).click()

    const continueButton = page.getByRole("button", { name: "Continue", exact: true })
    await expect(continueButton).toBeEnabled()
    await continueButton.click()
  })

  await test.step("Skip optional repositories", async () => {
    await expect(page.getByRole("heading", { name: "Add resource" })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole("button", { name: "Continue", exact: true }).click()
  })

  await test.step("Select Development and submit", async () => {
    await expect(
      page.getByText("Select environments", { exact: true }).and(page.locator(":visible")),
    ).toBeVisible({ timeout: 20_000 })

    await page.getByText("Development", { exact: true }).and(page.locator(":visible")).click()
    const submitButton = page.getByRole("button", { name: "Submit" })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()
  })

  await test.step("Wait for project creation success", async () => {
    await expect(page.getByText("Your project has been created.", { exact: true })).toBeVisible({
      timeout: 25_000,
    })
    await expect(page).toHaveURL(/\/app\/project\/[^/]+\/environments$/, {
      timeout: 15_000,
    })
  })

  await test.step("Open project dashboard on Monitor", async () => {
    await page.goto(`${e2eBaseUrl()}/app/console`, { waitUntil: "domcontentloaded" })
    await ensureConsole(page, "monitor")
    await openNamedProjectDashboard(page, projectName)
  })

  return { projectName, dashboardUrl: page.url() }
}

/** Reuse an existing project, or create one when Add Project is available. */
export async function reuseOrCreateSharedProject(
  page: Page,
): Promise<{ projectName: string; dashboardUrl: string; itemId: string }> {
  await ensureAuthenticated(page)

  const configuredProjectId = e2eProjectId()
  if (configuredProjectId) {
    return openProjectById(page, configuredProjectId)
  }

  await ensureConsole(page, "monitor")

  const reuseName = process.env.E2E_REUSE_PROJECT_NAME?.trim()
  if (reuseName) {
    await openNamedProjectDashboard(page, reuseName)
    const itemId = new URL(page.url()).pathname.split("/")[2] ?? ""
    return { projectName: reuseName, dashboardUrl: page.url(), itemId }
  }

  const testProjects = await listOrphanProjectNames(page)
  if (testProjects.length > 0) {
    const projectName = testProjects[testProjects.length - 1]!
    await openNamedProjectDashboard(page, projectName)
    const itemId = new URL(page.url()).pathname.split("/")[2] ?? ""
    return { projectName, dashboardUrl: page.url(), itemId }
  }

  const addProjectButton = page.getByText("Add Project", { exact: true }).first()
  if (await addProjectButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const created = await createProject(page)
    const itemId = new URL(created.dashboardUrl).pathname.split("/")[2] ?? ""
    return { ...created, itemId }
  }

  throw new Error(
    "No project to reuse and Add Project is unavailable. " +
      "Set E2E_REUSE_PROJECT_NAME (e.g. test) or E2E_PROJECT_ID, or free a console slot.",
  )
}

/** Delete project on Blocks OS (only place with project Delete UI). */
export async function deleteCreatedProject(
  page: Page,
  projectName?: string,
  options?: { itemId?: string },
): Promise<boolean> {
  if (!projectName) return false
  void options

  return test.step("Delete project on Blocks OS", async () => {
    try {
      const deleted = await deleteProjectOnOs(page, projectName)
      if (deleted) {
        await ensureConsole(page, "os")
        await expect(page.getByText(projectName, { exact: true })).toHaveCount(0, {
          timeout: 10_000,
        })
      }
      return deleted
    } catch (error) {
      console.warn(`[e2e] Failed to delete project "${projectName}" on OS:`, error)
      return false
    }
  })
}
