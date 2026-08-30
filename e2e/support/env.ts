function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Fill it in e2e/.env.e2e.`)
  }
  return value
}

/** Blocks Monitor app under test (`E2E_BASE_URL`). */
export function e2eBaseUrl(): string {
  return stripTrailingSlash(requireEnv("E2E_BASE_URL"))
}

export function e2eProjectId(): string | undefined {
  const value = process.env.E2E_PROJECT_ID?.trim()
  return value || undefined
}

/**
 * Derive Blocks OS origin from the Monitor base URL.
 *
 * | Monitor (`E2E_BASE_URL`)                         | OS (derived)                              |
 * |--------------------------------------------------|-------------------------------------------|
 * | https://dev-monitor.blocksdevelopers.com[:port]  | https://dev-os.blocksdevelopers.com[:port]|
 * | https://monitor.seliseblocks.com                 | https://os.seliseblocks.com               |
 *
 * Override anytime with `E2E_OS_BASE_URL`.
 */
export function deriveOsBaseUrlFromMonitor(monitorBaseUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(monitorBaseUrl)
  } catch {
    return undefined
  }

  if (/^dev-monitor\./i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/^dev-monitor\./i, "dev-os.")
    return stripTrailingSlash(url.origin)
  }

  if (/^monitor\./i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/^monitor\./i, "os.")
    return stripTrailingSlash(url.origin)
  }

  return undefined
}

/** Blocks OS — create-project wizard + project delete (Monitor has no Delete UI). */
export function e2eOsBaseUrl(): string {
  const explicit = process.env.E2E_OS_BASE_URL?.trim()
  if (explicit) return stripTrailingSlash(explicit)

  const derived = deriveOsBaseUrlFromMonitor(e2eBaseUrl())
  if (derived) return derived

  throw new Error(
    "E2E_OS_BASE_URL is not set and could not be derived from E2E_BASE_URL. " +
      "Examples:\n" +
      "  Dev:  E2E_BASE_URL=https://dev-monitor.blocksdevelopers.com  → OS https://dev-os.blocksdevelopers.com\n" +
      "  Prod: E2E_BASE_URL=https://monitor.seliseblocks.com          → OS https://os.seliseblocks.com\n" +
      "Or set E2E_OS_BASE_URL explicitly in e2e/.env.e2e.",
  )
}

export function e2eCredentials(): { email: string; password: string } {
  return {
    email: requireEnv("E2E_USERNAME"),
    password: requireEnv("E2E_PASSWORD"),
  }
}
