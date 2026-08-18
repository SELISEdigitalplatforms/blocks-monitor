import { type Page, expect } from "@playwright/test";

export async function waitForRowsLoaded(page: Page) {
  // The Monitor list renders loading placeholders as
  // `<div class="animate-pulse ...">` inside the `<tr>` shell. Wait for
  // those to disappear first.
  await expect(page.locator(".animate-pulse").first())
    .toBeHidden({ timeout: 30000 })
    .catch(() => null);
  // Then either the first data row contains real text, OR the list
  // is empty (renders "No results."). The cap of 10 monitors per
  // project + accumulated e2e fixtures means the list is often empty
  // here.
  await expect(async () => {
    const rows = page.getByRole("row");
    const count = await rows.count();
    if (count <= 1) {
      await expect(page.getByText("No results.")).toBeVisible({ timeout: 500 });
      return;
    }
    await expect(rows.nth(1)).toContainText(/[^\s]/, { timeout: 500 });
  }).toPass({ timeout: 30000 });
}

export async function ensureMonitorExists(page: Page) {
  await waitForRowsLoaded(page);
  // Switch to the "My monitors" tab so the rows we end up operating on
  // are user-created (kebab actions visible). "Blocks services" rows
  // hide their row actions menu entirely.
  const myMonitorsTab = page.getByRole("tab", { name: "My monitors" });
  if (await myMonitorsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await myMonitorsTab.click();
    await waitForRowsLoaded(page);
  }
  if (
    !(await page
      .getByText("No results.")
      .isVisible()
      .catch(() => false))
  ) {
    return;
  }
  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible();
  await page.getByLabel("Name").fill(`e2e-pause-resume-${Date.now()}`);
  await page
    .getByPlaceholder("Enter URL to monitor")
    .fill(`https://example.com/health-${Date.now()}`);
  const saveButton = page.getByRole("button", { name: "Save" });
  try {
    await saveButton.click({ timeout: 5000 });
  } catch {
    await saveButton.click({ force: true });
  }
  // Either we navigated to /monitor/{id} (clear success) or we just
  // need the success toast to appear (modal closed with no nav).
  try {
    await page.waitForURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
    await page.goto(page.url().replace(/\/monitor\/[^/]+$/, "/monitor"));
    await waitForRowsLoaded(page);
  } catch {
    await expect(page.getByText("Monitor successfully created.", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await waitForRowsLoaded(page);
  }
  // NOTE: the list can lag behind the write, so a freshly created monitor may
  // not show up immediately when navigating back to it; callers should guard
  // against that rather than assume the row/action button is present.
}

export async function getRowActionButton(page: Page) {
  await waitForRowsLoaded(page);
  const rows = page.getByRole("row");
  const count = await rows.count();
  for (let r = 1; r < count; r++) {
    const row = rows.nth(r);
    // Hover to materialize hover-only kebabs.
    await row.hover({ timeout: 1000 }).catch(() => null);
    // The row's actions kebab is a Radix UI dropdown trigger rendered
    // as an `<svg>` with `aria-haspopup="menu"` — not a `<button>`,
    // so `getByRole("button")` finds nothing. Use the aria attribute
    // directly.
    const actionButton = row.locator('[aria-haspopup="menu"]').first();
    if (await actionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      return actionButton;
    }
  }
  return null;
}

export async function openFirstMonitor(page: Page) {
  await waitForRowsLoaded(page);
  const firstRow = page.getByRole("row").nth(1);

  // The row click can occasionally be swallowed by a re-render; retry a few times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await firstRow.click();
    try {
      await expect(page).toHaveURL(/\/monitor\/[^/]+$/, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

export async function loginAndOpenMonitorList(page: Page) {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "E2E_USERNAME / E2E_PASSWORD are not set. Fill them in e2e/.env.e2e before running.",
    );
  }

  // ---- 1. Open the app and click the login trigger.
  await page.goto("/", {
    waitUntil: "load",
  });
  const loginTrigger = page.getByRole("button", {
    name: "Log in to your account",
  });
  await loginTrigger.waitFor({ state: "visible", timeout: 30000 });
  await loginTrigger.click();

  // ---- 2. Fill credentials. Wait for each field to be ready before typing.
  const emailInput = page.getByRole("textbox", { name: "Work Email" });
  await emailInput.waitFor({ state: "visible", timeout: 30000 }).catch(async () => {
    await loginTrigger.click();
    await emailInput.waitFor({ state: "visible", timeout: 30000 });
  });
  await emailInput.fill(username);

  const passwordInput = page.getByRole("textbox", { name: "Password" });
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.fill(password);

  // ---- 3. Submit login, wait for projects page heading.
  // Use a fresh locator inside the fallback — the original
  // `loginSubmit` reference becomes stale once the page unmounts it
  // post-navigation. A re-click on a stale locator hangs until the
  // outer test timeout.
  const projectsHeading = page.getByRole("heading", {
    name: "Your Blocks Projects",
  });
  const loginSubmit = page.getByRole("button", { name: "Login" });
  await loginSubmit.waitFor({ state: "visible", timeout: 30000 });
  await loginSubmit.click();
  try {
    await expect(projectsHeading).toBeVisible({ timeout: 30000 });
  } catch {
    // Re-resolve. Three cases:
    //   - button gone: login already navigated; just wait for heading.
    //   - button visible & disabled: click already submitted, in flight;
    //     do NOT click again — just wait for heading.
    //   - button visible & enabled: first click was swallowed; re-click.
    const loginBtn = page.getByRole("button", { name: "Login" });
    const visible = await loginBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      const enabled = await loginBtn.isEnabled().catch(() => false);
      if (enabled) {
        await loginBtn.click();
      }
    }
    await expect(projectsHeading).toBeVisible({ timeout: 30000 });
  }

  // ---- 4. Open the Development project.
  const developmentButton = page.getByRole("button", { name: /Development/ }).first();
  await developmentButton.waitFor({ state: "visible", timeout: 30000 });
  await developmentButton.click();

  await expect(page.getByRole("heading", { name: "Project Details" }))
    .toBeVisible({ timeout: 30000 })
    .catch(async () => {
      await developmentButton.click();
      await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible({
        timeout: 30000,
      });
    });

  // ---- 5. Navigate to the Monitor list.
  const monitorLink = page.getByRole("link", { name: "Monitor" });
  await monitorLink.waitFor({ state: "visible", timeout: 30000 });
  await monitorLink.click();

  await expect(page.getByRole("heading", { name: "Monitor" }))
    .toBeVisible({
      timeout: 30000,
    })
    .catch(async () => {
      await monitorLink.click();
      await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible({
        timeout: 30000,
      });
    });

  await ensureMonitorExists(page);
}
