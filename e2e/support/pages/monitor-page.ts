import type { Page, Locator } from "@playwright/test";
import { expect } from "../../support/test-base";
import { LoginPage } from "./login-page";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
// Page Object for the Monitor list, Add/Configure modals, monitor details,
// and the incidents page. Specs interact through this class instead of
// poking locators directly, so selector changes only need updating here.
export class MonitorPage {
  readonly page: Page;

  readonly heading: Locator;
  readonly addMonitorButton: Locator;
  readonly table: Locator;
  readonly tabs: Locator;

  constructor(page: Page) {
    this.page = page;

    this.heading = page.getByRole("heading", { name: "Monitor" });
    this.addMonitorButton = page.getByTestId("add-monitor-button");
    this.table = page.getByRole("table");
    this.tabs = page.getByRole("tab");
  }

  async goto() {
    await this.page.goto("/app/console");
    await this.page.getByRole("button", { name: "Open user menu" }).click();
    await this.page.getByText("Log out").click();

    const login = new LoginPage(this.page);
    await login.login(username!, password!);

    await this.page.getByRole("button", { name: "Development" }).first().click();
    await this.page.getByRole("link", { name: "Monitor" }).click();
    await expect(this.page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  }

  tab(name: "My monitors" | "Blocks services"): Locator {
    return this.tabs.filter({ hasText: name });
  }

  async selectTab(name: "My monitors" | "Blocks services") {
    await this.tab(name).click();
  }

  get rows(): Locator {
    return this.table.getByRole("row").filter({ hasText: /Heartbeat|HTTP Check/i });
  }

  firstRow(): Locator {
    return this.rows.first();
  }

  async openFirstMonitor() {
    await this.firstRow().click();
  }

  cell(name: string): Locator {
    return this.page.getByRole("cell", { name });
  }

  columnHeader(name: string): Locator {
    return this.page.getByRole("columnheader", { name });
  }

  get pagination(): Locator {
    return this.page.getByRole("navigation", { name: /pagination|table pagination/i });
  }

  get emptyStateMessage(): Locator {
    return this.table.getByText("No results.");
  }

  // --- Add monitor modal ---

  get addMonitorDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Add monitor" });
  }

  async openAddMonitorModal() {
    await this.addMonitorButton.click();
    await this.addMonitorDialog.waitFor({ state: "visible", timeout: 10_000 });
  }

  async fillAddMonitorForm(fields: { name?: string; url?: string }) {
    if (fields.name !== undefined) {
      await this.page.getByLabel("Name").fill(fields.name);
    }
    if (fields.url !== undefined) {
      await this.page.getByLabel("URL to monitor").fill(fields.url);
    }
  }

  async saveAddMonitorForm() {
    await this.addMonitorDialog.getByRole("button", { name: "Save" }).click();
  }

  async cancelAddMonitorForm() {
    await this.page.getByRole("button", { name: "Cancel" }).click();
  }

  async createHttpMonitor(name: string, url: string) {
    await this.openAddMonitorModal();
    await this.fillAddMonitorForm({ name, url });
    await this.saveAddMonitorForm();
    await this.addMonitorDialog.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

// Page Object for a single monitor's details page: status, Configure modal,
// Notification Settings modal, and the Actions (pause/resume/delete) menu.
export class MonitorDetailsPage {
  readonly page: Page;

  readonly heading: Locator;
  readonly configureButton: Locator;
  readonly notificationSettingsButton: Locator;
  readonly actionsButton: Locator;
  readonly currentStatus: Locator;

  constructor(page: Page) {
    this.page = page;

    this.heading = page.getByRole("heading", { name: /monitor details|general information/i });
    this.configureButton = page.getByRole("button", { name: "Configure" });
    this.notificationSettingsButton = page.getByRole("button", { name: "Notification Settings" });
    this.actionsButton = page.getByRole("button", { name: "Actions" });
    this.currentStatus = page.getByText("Current Status");
  }

  get backButton(): Locator {
    return this.page.getByRole("button", { name: /back|arrow left/i });
  }

  async goBack() {
    await this.backButton.click();
  }

  get timeRangeSelect(): Locator {
    return this.page.getByLabel(/time range|select time range/i);
  }

  async selectTimeRange(optionPattern: RegExp) {
    await this.timeRangeSelect.click();
    await this.page.getByRole("option", { name: optionPattern }).click();
  }

  // --- Configure modal ---

  get configureDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Configure" });
  }

  async openConfigureModal() {
    await this.configureButton.waitFor({ state: "visible", timeout: 10_000 });
    await this.configureButton.click();
    await this.configureDialog.waitFor({ state: "visible", timeout: 10_000 });
  }

  get configureSaveButton(): Locator {
    return this.page.getByRole("button", { name: /^Save$/i });
  }

  async saveConfigureModalIfEnabled() {
    const isDisabled = await this.configureSaveButton.isDisabled().catch(() => true);
    if (isDisabled) return false;

    await this.configureSaveButton.click();
    await this.configureDialog.waitFor({ state: "hidden", timeout: 5_000 });
    return true;
  }

  // --- Notification settings modal ---

  get notificationSettingsDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Notification settings" });
  }

  async openNotificationSettings() {
    await this.notificationSettingsButton.click();
    await this.notificationSettingsDialog.waitFor({ state: "visible", timeout: 10_000 });
  }

  get emailInputs(): Locator {
    return this.page.getByPlaceholder("Enter email address");
  }

  async addNotificationEmail(email: string) {
    const addEmailButton = this.page.getByRole("button", { name: /add email/i });
    if (await addEmailButton.isVisible().catch(() => false)) {
      await addEmailButton.click();
    }

    await this.emailInputs.first().fill(email);
    await this.page.getByRole("button").filter({ hasText: /^$/ }).nth(1).click();
  }

  async saveNotificationSettingsIfEnabled() {
    const saveButton = this.page.getByRole("button", { name: "Save" });
    const isDisabled = await saveButton.isDisabled().catch(() => false);
    if (isDisabled) return false;

    await saveButton.click();
    await this.notificationSettingsDialog.waitFor({ state: "hidden", timeout: 5_000 });
    return true;
  }

  // --- Actions menu: pause / resume / delete ---

  async openActionsMenu() {
    await this.actionsButton.click();
  }

  menuItem(name: "Pause" | "Resume" | "Delete"): Locator {
    return this.page.getByRole("menuitem", { name });
  }

  confirmationDialog(name: "Pause monitor?" | "Resume monitor?" | "Remove monitor?"): Locator {
    return this.page.getByRole("dialog", { name });
  }

  get confirmButton(): Locator {
    return this.page.getByRole("button", { name: /confirm/i });
  }

  async pause() {
    await this.openActionsMenu();
    const pauseItem = this.menuItem("Pause");
    if (!(await pauseItem.isVisible().catch(() => false))) return false;

    await pauseItem.click();
    await this.confirmationDialog("Pause monitor?").waitFor({ state: "visible", timeout: 5_000 });
    return true;
  }

  async resume() {
    await this.openActionsMenu();
    const resumeItem = this.menuItem("Resume");
    if (!(await resumeItem.isVisible().catch(() => false))) return false;

    await resumeItem.click();
    await this.confirmationDialog("Resume monitor?").waitFor({ state: "visible", timeout: 5_000 });
    return true;
  }

  async delete() {
    await this.openActionsMenu();
    const deleteItem = this.menuItem("Delete");
    if (!(await deleteItem.isVisible().catch(() => false))) return false;

    await deleteItem.click();
    await this.confirmationDialog("Remove monitor?").waitFor({ state: "visible", timeout: 5_000 });
    return true;
  }

  async confirmDialogIfPresent() {
    if (!(await this.confirmButton.isVisible().catch(() => false))) return false;
    await this.confirmButton.click();
    return true;
  }

  // --- Incidents ---

  get viewAllIncidentsButton(): Locator {
    return this.page.getByRole("button", { name: /view all incidents/i });
  }

  async goToIncidents() {
    if (!(await this.viewAllIncidentsButton.isVisible().catch(() => false))) return false;
    await this.viewAllIncidentsButton.click();
    return true;
  }
}

// Page Object for the Incidents page reached from monitor details.
export class IncidentsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly table: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Incidents" });
    this.table = page.getByRole("table");
    this.backButton = page.getByRole("button", { name: /back|arrow left/i });
  }

  async goBack() {
    await this.backButton.click();
  }
}
