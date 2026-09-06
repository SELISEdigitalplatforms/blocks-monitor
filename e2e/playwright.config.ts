import { defineConfig, devices } from "@playwright/test"
import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, ".env.e2e") })

const baseURL = process.env.E2E_BASE_URL

if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL is not set. Copy e2e/.env.e2e.example to e2e/.env.e2e and set E2E_BASE_URL to your named domain.",
  )
}

const autoStartServer = process.env.E2E_NO_WEBSERVER !== "1"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 600_000,
  reporter: [["html", { open: "never" }], ["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
    launchOptions: {
      slowMo: process.env.E2E_SLOWMO ? Number(process.env.E2E_SLOWMO) : 0,
    },
  },
  ...(autoStartServer
    ? {
        webServer: {
          command: "bash run.sh -b",
          cwd: path.resolve(__dirname, ".."),
          url: baseURL,
          reuseExistingServer: true,
          ignoreHTTPSErrors: true,
          timeout: 600_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
          env: {
            FrontendRuntime__BLOCKS_MONITOR_BASE_URL: baseURL,
          },
        },
      }
    : {}),
  projects: [
    {
      name: "monitor",
      // The spec lives at tests/02-monitor/monitor.spec.ts. The earlier
      // `Monitor[\\/]monitor\.spec\.ts` regex required a literal "Monitor"
      // folder that never existed, so `playwright test` silently matched
      // zero files on this package. Match the real on-disk path instead.
      testMatch: /02-monitor[\\/]monitor\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
