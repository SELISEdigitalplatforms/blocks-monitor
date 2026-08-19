import { defineConfig, devices } from "@playwright/test"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, ".env.e2e") })

const baseURL = process.env.E2E_BASE_URL

if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL is not set. Copy e2e/.env.e2e.example to e2e/.env.e2e and set E2E_BASE_URL to your named domain.",
  )
}

const autoStartServer = process.env.E2E_NO_WEBSERVER !== "1"
const monitorSessionPath = path.resolve(__dirname, "fixtures/monitor-session.json")

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 120_000,
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
      name: "monitor-setup",
      testMatch: /monitor\.setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "monitor",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /monitor\.(setup|teardown)\.spec\.ts/,
      dependencies: ["monitor-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "fixtures/monitor-session.json",
      },
    },
    {
      name: "monitor-teardown",
      testMatch: /monitor\.teardown\.spec\.ts/,
      dependencies: ["monitor"],
      use: {
        ...devices["Desktop Chrome"],
        ...(fs.existsSync(monitorSessionPath)
          ? { storageState: "fixtures/monitor-session.json" }
          : {}),
      },
    },
  ],
})
