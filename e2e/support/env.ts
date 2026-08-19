export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Fill it in e2e/.env.e2e.`)
  }
  return value
}

export function e2eBaseUrl(): string {
  return requireEnv("E2E_BASE_URL")
}

export function e2eProjectId(): string | undefined {
  const value = process.env.E2E_PROJECT_ID?.trim()
  return value || undefined
}

/** Blocks OS — project delete only (Monitor has no project Delete UI). */
export function e2eOsBaseUrl(): string {
  const explicit = process.env.E2E_OS_BASE_URL
  if (explicit) return explicit.replace(/\/$/, "")

  const monitor = e2eBaseUrl()
  if (/dev-monitor/i.test(monitor)) {
    return monitor.replace(/dev-monitor/i, "dev-os")
  }

  throw new Error(
    "E2E_OS_BASE_URL is not set and could not be derived from E2E_BASE_URL. " +
      "Set E2E_OS_BASE_URL in e2e/.env.e2e (e.g. https://dev-os.blocksdevelopers.com).",
  )
}

export function e2eCredentials(): { email: string; password: string } {
  return {
    email: requireEnv("E2E_USERNAME"),
    password: requireEnv("E2E_PASSWORD"),
  }
}
