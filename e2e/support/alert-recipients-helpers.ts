import { type Locator, type Page, expect } from "@playwright/test";
import { waitForRowsLoaded } from "./monitor-helpers";
import { openSharedProjectDashboard } from "./suite-helpers";

/**
 * Page object and helpers for the Alert recipients page (#256).
 *
 * Every fixture is created through the UI, because the runner has no root DB access. The shared
 * project already holds monitors and maybe recipients from other specs, so assertions are scoped
 * to the rows and monitors this run creates, and monitor counts are read from the page.
 */

const PAGE_TIMEOUT = 30_000;

/** A short id that keeps this run's monitors and emails apart from every other run. */
export function e2eRunId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** When `e2eRunId()` made `runId` (its first 8 base-36 characters are `Date.now()`), or null. */
export function e2eRunStartedAt(runId: string): number | null {
  const stamp = parseInt(runId.slice(0, 8), 36);
  return /^[0-9a-z]{9,10}$/.test(runId) && Number.isFinite(stamp) ? stamp : null;
}

/** Obvious dummy addresses on example.com: never a project member, never a real inbox. */
export function e2eEmail(tag: string, runId: string): string {
  return `e2e+${tag}-${runId}@example.com`;
}

/** The side-menu link. `exact` keeps it apart from the details page's "Open Alert recipients". */
export function alertRecipientsMenuLink(page: Page): Locator {
  return page.getByRole("link", { name: "Alert recipients", exact: true });
}

/** The counts in a save toast, e.g. "Added to 4 monitors. 1 skipped: already has 10 recipients." */
export interface SaveSummary {
  added: number;
  removed: number;
  skippedFull: number;
}

export interface AllMonitorsSave extends SaveSummary {
  /** The editable-monitor count the dialog reported in "All monitors (N)". */
  count: number;
}

/** The counts in the server's save message (`AlertRecipientService.Summary`). */
export function parseSaveSummary(text: string): SaveSummary {
  const count = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  const summary = {
    added: count(/Added to (\d+) monitors?\./),
    removed: count(/Removed from (\d+) monitors?\./),
    skippedFull: count(/(\d+) skipped: already (?:has|have) \d+ recipients\./),
  };
  // Conflicts and denials are not expected in a single-user run: fail loudly with the text.
  expect(text, "save summary without conflicts or denials").not.toMatch(/not updated:/);
  return summary;
}

export class AlertRecipientsPage {
  readonly heading: Locator;
  readonly addButton: Locator;
  readonly search: Locator;
  readonly coverageBadge: Locator;
  readonly table: Locator;
  readonly notice: Locator;
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Alert recipients", level: 1 });
    // The header button comes first; the empty state repeats it.
    this.addButton = page.getByRole("button", { name: "Add recipient", exact: true }).first();
    this.search = page.getByRole("searchbox", { name: "Search people or monitors" });
    this.coverageBadge = page.getByTestId("coverage-badge");
    this.table = page.getByRole("table");
    // Toasts are role="status" too; only the notice says "They no longer get alert emails."
    this.notice = page
      .getByRole("status")
      .filter({ hasText: /removed from \d+ monitors?\. They no longer get alert emails\./ });
    this.dialog = page.getByRole("dialog");
  }

  /** Shared project dashboard → side menu "Alert recipients". */
  async open() {
    await openSharedProjectDashboard(this.page);
    const link = alertRecipientsMenuLink(this.page);
    await link.waitFor({ state: "visible", timeout: PAGE_TIMEOUT });
    await link.click();
    await this.waitForLoaded();
  }

  /** Waits until the list, or one of its empty states, replaced the loading skeleton. */
  async waitForLoaded() {
    await expect(this.page).toHaveURL(/\/alert-recipients\/?$/, { timeout: PAGE_TIMEOUT });
    await expect(this.heading).toBeVisible({ timeout: PAGE_TIMEOUT });
    await expect(this.page.getByTestId("recipients-loading")).toHaveCount(0, {
      timeout: PAGE_TIMEOUT,
    });
    await expect(
      this.table
        .or(this.page.getByText("No one gets alert emails yet.", { exact: true }))
        .or(this.page.getByText("Add a monitor first.", { exact: true }))
        .or(this.page.getByText("No people or monitors match.", { exact: true })),
    ).toBeVisible({ timeout: PAGE_TIMEOUT });
  }

  row(email: string): Locator {
    return this.page.getByRole("row").filter({ has: this.page.getByText(email, { exact: true }) });
  }

  editButton(email: string): Locator {
    return this.page.getByRole("button", { name: `Edit ${email}`, exact: true });
  }

  removeButton(email: string): Locator {
    return this.page.getByRole("button", {
      name: `Remove ${email} from all monitors`,
      exact: true,
    });
  }

  // ---- Dialog -----------------------------------------------------------------------------------

  get emailInput(): Locator {
    return this.dialog.getByRole("textbox", { name: "Email", exact: true });
  }

  get allMonitorsRadio(): Locator {
    return this.dialog.getByRole("radio", { name: /^All monitors \(\d+\)/ });
  }

  get selectedMonitorsRadio(): Locator {
    return this.dialog.getByRole("radio", { name: /^Selected monitors/ });
  }

  /** "Add to all N monitors", "Add to K monitors" or "Save". */
  get submitButton(): Locator {
    return this.dialog.getByRole("button", { name: /^(Add to |Save$)/ });
  }

  get monitorList(): Locator {
    return this.dialog.getByRole("list", { name: "Monitors" });
  }

  monitorCheckbox(monitorName: string): Locator {
    return this.monitorList
      .getByRole("listitem")
      .filter({ has: this.page.getByText(monitorName, { exact: true }) })
      .getByRole("checkbox");
  }

  async openAddDialog() {
    await expect(this.addButton).toBeEnabled({ timeout: PAGE_TIMEOUT });
    await this.addButton.click();
    await expect(this.dialog.getByRole("heading", { name: "Add recipient" })).toBeVisible();
  }

  async openEditDialog(email: string) {
    await this.editButton(email).click();
    await expect(this.dialog.getByRole("heading", { name: "Edit recipient" })).toBeVisible();
    await expect(this.emailInput).toHaveValue(email);
  }

  /** The editable-monitor count the dialog reports in "All monitors (N)". */
  async reportedMonitorCount(): Promise<number> {
    const label = this.dialog.getByText(/^All monitors \(\d+\)$/);
    await expect(label).toBeVisible();
    const match = /\((\d+)\)/.exec((await label.textContent()) ?? "");
    if (!match) throw new Error("The dialog does not report the monitor count.");
    return Number(match[1]);
  }

  /** Ticks exactly `monitorNames` in the Selected checklist, unticking everything else. */
  async chooseSelectedMonitors(monitorNames: string[]) {
    await this.selectedMonitorsRadio.check();
    await expect(this.monitorList).toBeVisible();
    const ticked = this.monitorList.getByRole("checkbox", { checked: true });
    while ((await ticked.count()) > 0) {
      await ticked.first().uncheck();
    }
    for (const name of monitorNames) {
      await this.monitorCheckbox(name).check();
    }
  }

  /** Saves the open dialog and waits for the success toast and for the dialog to close. */
  /** `toast` is a pattern, or text the toast contains. */
  async submitAndExpectToast(toast: RegExp | string) {
    await expect(this.submitButton).toBeEnabled();
    await this.submitButton.click();
    await expect(this.page.getByText(toast).first()).toBeVisible({ timeout: PAGE_TIMEOUT });
    await expect(this.dialog).toBeHidden({ timeout: PAGE_TIMEOUT });
  }

  /**
   * Saves the open dialog and returns the counts the server reported for this save (read from
   * the SaveAlertRecipient response, so an older toast still on screen can't be mistaken for it),
   * after the toast shows that message and the dialog closed. Full monitors in the shared project
   * are skipped by the server, so callers compare these numbers with each other, not with a fixed
   * monitor count.
   */
  async submitAndReadSummary(): Promise<SaveSummary> {
    await expect(this.submitButton).toBeEnabled();
    const saved = this.page.waitForResponse(
      (response) =>
        response.url().includes("/SaveAlertRecipient") && response.request().method() === "POST",
      { timeout: PAGE_TIMEOUT },
    );
    await this.submitButton.click();
    const body = await (await saved).json();
    expect(body?.isSuccess, `save refused: ${String(body?.message)}`).toBe(true);
    const message = String(body.message);
    const summary = parseSaveSummary(message);
    expect(summary.added, "toast and data agree").toBe(Number(body.data?.added ?? 0));
    expect(summary.skippedFull, "toast and data agree").toBe(body.data?.skippedFull?.length ?? 0);
    await expect(this.page.getByText(message, { exact: true }).first()).toBeVisible({
      timeout: PAGE_TIMEOUT,
    });
    await expect(this.dialog).toBeHidden({ timeout: PAGE_TIMEOUT });
    return summary;
  }

  /**
   * Add a person with "All monitors". `typed` lets a caller type a non-normalized spelling.
   * Returns the monitor count the dialog reported and the toast's counts. Every editable monitor
   * is either added to or skipped as full (the person is new, so none is unchanged).
   */
  async addToAllMonitors(email: string, typed = email): Promise<AllMonitorsSave> {
    await this.openAddDialog();
    await this.emailInput.fill(typed);
    await this.allMonitorsRadio.check();
    const count = await this.reportedMonitorCount();
    await expect(this.submitButton).toHaveText(
      count === 1 ? "Add to 1 monitor" : `Add to all ${count} monitors`,
    );
    const summary = await this.submitAndReadSummary();
    expect(summary.removed).toBe(0);
    expect(summary.added + summary.skippedFull, "added + skipped as full = every monitor").toBe(
      count,
    );
    await expect(this.row(email)).toBeVisible({ timeout: PAGE_TIMEOUT });
    return { count, ...summary };
  }

  async addToSelectedMonitors(email: string, monitorNames: string[]) {
    await this.openAddDialog();
    await this.emailInput.fill(email);
    await this.chooseSelectedMonitors(monitorNames);
    const n = monitorNames.length;
    await expect(this.submitButton).toHaveText(`Add to ${n} ${n === 1 ? "monitor" : "monitors"}`);
    await this.submitAndExpectToast(`Added to ${n} ${n === 1 ? "monitor" : "monitors"}.`);
    await expect(this.row(email)).toBeVisible({ timeout: PAGE_TIMEOUT });
  }

  /** Row text for "K monitors:" followed by exactly these names (H3). */
  async expectSelectedMonitorsRow(email: string, monitorNames: string[], notNames: string[] = []) {
    const row = this.row(email);
    const n = monitorNames.length;
    await expect(row).toContainText(`${n} ${n === 1 ? "monitor" : "monitors"}:`, {
      timeout: PAGE_TIMEOUT,
    });
    for (const name of monitorNames) {
      await expect(row.getByText(name, { exact: true })).toBeVisible();
    }
    for (const name of notNames) {
      await expect(row.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(row.getByText(/^All monitors \(\d+\)$/)).toHaveCount(0);
  }

  /** Row text for "All monitors (N)" and "New monitors too" (H3, H4). */
  async expectAllMonitorsRow(email: string, count: number) {
    const row = this.row(email);
    await expect(row.getByText(`All monitors (${count})`, { exact: true })).toBeVisible({
      timeout: PAGE_TIMEOUT,
    });
    await expect(row.getByText("New monitors too", { exact: true })).toBeVisible();
  }

  /**
   * The row of an "All monitors" person, from the numbers the page reported: "All monitors (N)"
   * when they are on every one of the `count` monitors, otherwise "K monitors:" (some were full,
   * so the page shows the monitors they are on). `onMonitors` is K.
   */
  async expectAllMonitorsChoiceRow(email: string, count: number, onMonitors: number) {
    if (onMonitors === count) {
      await this.expectAllMonitorsRow(email, count);
      return;
    }
    const row = this.row(email);
    await expect(row).toContainText(`${onMonitors} ${onMonitors === 1 ? "monitor" : "monitors"}:`, {
      timeout: PAGE_TIMEOUT,
    });
    await expect(row.getByText(/^All monitors \(\d+\)$/)).toHaveCount(0);
  }

  /**
   * Removes people this spec left behind in earlier runs whose cleanup failed: addresses made by
   * `e2eEmail(tag, runId)` for the given tags, from runs that started more than `olderThanMs` ago
   * (so a run still in progress is never touched). A leftover "All monitors" person is added to
   * every monitor, so a few of them fill monitors and break later runs (C7). Never fails the run.
   */
  async removeLeftoverPeople(tags: string[], olderThanMs: number) {
    // Literal pattern (no RegExp built from input); the tag is checked against `tags` below. Run ids
    // are base 36 with no hyphen, so the last hyphen separates the tag from the run id.
    const pattern = /^Remove (e2e\+(.+)-([0-9a-z]+)@example\.com) from all monitors$/;
    const removed: string[] = [];
    try {
      await this.search.fill("e2e+");
      const labels = await this.page
        .getByRole("button", { name: /^Remove e2e\+.+ from all monitors$/ })
        .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? ""));
      for (const label of labels) {
        const match = pattern.exec(label);
        if (!match || !tags.includes(match[2])) continue;
        const startedAt = e2eRunStartedAt(match[3]);
        if (startedAt === null || Date.now() - startedAt < olderThanMs) continue;
        await this.removeButton(match[1]).click();
        await expect(this.row(match[1])).toHaveCount(0, { timeout: PAGE_TIMEOUT });
        removed.push(match[1]);
      }
    } catch (error) {
      console.warn(`[e2e] Removing leftover alert recipients failed. ${String(error)}`);
    } finally {
      await this.search.fill("").catch(() => null);
    }
    return removed;
  }

  /** Removes one person if this page lists them. Used by cleanup, so it never fails the run. */
  async removeIfListed(email: string) {
    await this.search.fill(email).catch(() => null);
    const removeButton = this.removeButton(email);
    const listed = await removeButton
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (listed) {
      await removeButton.click();
      await expect(this.row(email)).toHaveCount(0, { timeout: PAGE_TIMEOUT });
    }
    await this.search.fill("").catch(() => null);
  }
}

/** A monitor details URL. */
export const MONITOR_DETAILS_URL = /\/monitor\/[^/]+$/;

/** Monitor list → Add monitor → Save. Returns the new monitor's details URL. */
export async function createMonitorViaUi(
  page: Page,
  options: { name: string; kind: "HTTP Check" | "Heartbeat" },
): Promise<string> {
  const monitorLink = page.getByRole("link", { name: "Monitor", exact: true }).first();
  await monitorLink.waitFor({ state: "visible", timeout: PAGE_TIMEOUT });
  await monitorLink.click();
  await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
    timeout: PAGE_TIMEOUT,
  });
  await waitForRowsLoaded(page);

  await page.getByTestId("add-monitor-button").click();
  await expect(page.getByRole("heading", { name: "Add monitor" })).toBeVisible({
    timeout: PAGE_TIMEOUT,
  });
  await page.getByRole("radio", { name: options.kind }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(options.name);
  if (options.kind === "HTTP Check") {
    await page
      .getByPlaceholder("Enter URL to monitor")
      .fill(`https://example.com/e2e-health/${encodeURIComponent(options.name)}`);
  }
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(MONITOR_DETAILS_URL, { timeout: PAGE_TIMEOUT });
  await expect(page.getByRole("heading", { name: options.name, exact: true })).toBeVisible({
    timeout: PAGE_TIMEOUT,
  });
  return page.url();
}

/** Opens a monitor's details by URL and waits for its heading. */
export async function openMonitorDetails(page: Page, detailsUrl: string, name: string) {
  await page.goto(detailsUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({
    timeout: PAGE_TIMEOUT,
  });
}

/** The read-only "Notification recipients" chips on a monitor's details page. */
export function detailsRecipientChips(page: Page): Locator {
  return page.getByRole("list", { name: "Notification recipients" }).getByRole("listitem");
}

/** Details → Actions → Delete → Confirm. Used by cleanup, so it never fails the run. */
export async function deleteMonitorViaUi(page: Page, detailsUrl: string, name: string) {
  try {
    await openMonitorDetails(page, detailsUrl, name);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Monitor", exact: true })).toBeVisible({
      timeout: PAGE_TIMEOUT,
    });
  } catch (error) {
    console.warn(
      `[e2e] Could not delete monitor "${name}" (${detailsUrl}); delete it by hand. ${String(error)}`,
    );
  }
}
