import type { Page, Locator } from "@playwright/test";
import { expect } from "../../support/test-base";

// Page Object for the Blocks Monitor login page and the dev-iam OIDC login
// flow it redirects through. Specs interact through this class instead of
// poking locators directly, so selector changes only need updating here.
export class LoginPage {
  readonly page: Page;

  readonly loginButton: Locator;
  readonly emailField: Locator;
  readonly passwordField: Locator;
  readonly oidcLoginButton: Locator;
  readonly consentButton: Locator;
  readonly projectsHeading: Locator;

  constructor(page: Page) {
    this.page = page;

    this.loginButton = page.getByRole("button", { name: "Log in to your account" });
    this.emailField = page.locator("#oidc-email");
    this.passwordField = page.locator("#oidc-password");
    this.oidcLoginButton = page.getByRole("button", { name: "Login", exact: true });
    this.consentButton = page.getByRole("button", { name: /allow|authorize|continue|grant/i });
    this.projectsHeading = page.getByRole("heading", { name: "Your Blocks Projects" });
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(username: string, password: string) {
    await this.loginButton.click();

    await this.emailField.waitFor({ timeout: 30_000 });
    await this.emailField.fill(username);
    await this.passwordField.fill(password);
    await this.oidcLoginButton.click();

    if (await this.consentButton.isVisible().catch(() => false)) {
      await this.consentButton.click();
    }

    await this.page.waitForURL("**/app/console", { timeout: 45_000 });
    await expect(this.page).toHaveURL(/\/app\/console/);
  }

  async saveAuthState(path: string) {
    await this.page.context().storageState({ path });
  }
}
