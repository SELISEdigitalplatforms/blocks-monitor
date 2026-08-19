import { expect, type Page } from "@playwright/test"
import { e2eBaseUrl, e2eCredentials } from "./env"

function oidcEmailField(page: Page) {
  return page.locator("#oidc-email").or(page.getByRole("textbox", { name: "Work Email" }))
}

function oidcPasswordField(page: Page) {
  return page.locator("#oidc-password").or(page.getByRole("textbox", { name: "Password" }))
}

const consoleHeading = (page: Page) =>
  page.getByRole("heading", {
    name: /Your Blocks Projects|Welcome to SELISE Blocks/,
  })

async function fillCredentialsAndSubmit(page: Page) {
  const { email, password } = e2eCredentials()
  const emailField = oidcEmailField(page)
  await emailField.fill(email)
  const passwordField = oidcPasswordField(page)
  await expect(passwordField).toBeVisible({ timeout: 15_000 })
  await passwordField.fill(password)
  await page.getByRole("button", { name: "Login", exact: true }).click()
}

export async function loginThroughOidc(page: Page, options?: { loginPath?: string }) {
  const base = e2eBaseUrl()
  const loginPath = options?.loginPath ?? `${base}/login`

  await page.goto(loginPath, { waitUntil: "domcontentloaded" })

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await consoleHeading(page).isVisible({ timeout: 5_000 }).catch(() => false)) {
      return
    }

    const loginButton = page.getByRole("button", { name: "Log in to your account" })
    if (await loginButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.waitForTimeout(2_000)
      try {
        await loginButton.click({ timeout: 10_000 })
      } catch {
        if (await consoleHeading(page).isVisible({ timeout: 5_000 }).catch(() => false)) return
        await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })
        await page.waitForTimeout(3_000)
        continue
      }

      const emailField = oidcEmailField(page)
      await Promise.race([
        emailField.waitFor({ state: "visible", timeout: 60_000 }),
        consoleHeading(page).waitFor({ state: "visible", timeout: 60_000 }),
        page.waitForURL(/\/app\/console/, { timeout: 60_000 }),
      ]).catch(() => {})

      if (await consoleHeading(page).isVisible().catch(() => false)) {
        return
      }

      if (await emailField.isVisible().catch(() => false)) {
        await fillCredentialsAndSubmit(page)
        await page.waitForURL(/\/app\/console/, { timeout: 60_000 })
        return
      }

      await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(3_000)
      continue
    }

    await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(3_000)
  }

  await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })
  await expect(consoleHeading(page)).toBeVisible({ timeout: 45_000 })
}

export async function ensureAuthenticated(page: Page) {
  const base = e2eBaseUrl()
  await page.goto(`${base}/app/console`, { waitUntil: "domcontentloaded" })

  if (await consoleHeading(page).isVisible({ timeout: 30_000 }).catch(() => false)) {
    return
  }

  await loginThroughOidc(page)
}

export async function ensureAuthenticatedOnCurrentOrigin(page: Page) {
  const href = page.url()
  if (!/^https?:/.test(href)) {
    await ensureAuthenticated(page)
    return
  }

  const origin = new URL(href).origin
  await page.goto(`${origin}/app/console`, { waitUntil: "domcontentloaded" })

  if (await consoleHeading(page).isVisible({ timeout: 30_000 }).catch(() => false)) {
    return
  }

  await loginThroughOidc(page, { loginPath: `${origin}/login` })
}
