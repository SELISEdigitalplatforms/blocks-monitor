/**
 * Monitor E2E feature list — edit `enabled` and order here.
 * Run: npm run test:features
 *
 * Env: E2E_FEATURES=pause-resume,delete  or  E2E_FEATURES=all
 */

/** @type {{ id: string, name: string, enabled: boolean, spec: string }[]} */
export const MONITOR_FEATURES = [
  {
    id: "pause-resume",
    name: "Monitor – pause & resume",
    enabled: true,
    spec: "tests/monitor/monitor-pause-resume.spec.ts",
  },
  {
    id: "delete",
    name: "Monitor – delete",
    enabled: true,
    spec: "tests/monitor/monitor-delete.spec.ts",
  },
  {
    id: "delete-heartbeat-bug",
    name: "Monitor – delete heartbeat bug",
    enabled: true,
    spec: "tests/monitor/monitor-delete-heartbeat-bug.spec.ts",
  },
]

export function resolveEnabledFeatures() {
  const override = process.env.E2E_FEATURES?.trim()

  if (!override || override === "all") {
    return MONITOR_FEATURES.filter((feature) => feature.enabled)
  }

  const ids = override.split(",").map((id) => id.trim()).filter(Boolean)
  /** @type {typeof MONITOR_FEATURES} */
  const selected = []

  for (const id of ids) {
    const feature = MONITOR_FEATURES.find((entry) => entry.id === id)
    if (!feature) {
      throw new Error(
        `Unknown E2E feature "${id}". Valid ids: ${MONITOR_FEATURES.map((f) => f.id).join(", ")}`,
      )
    }
    selected.push(feature)
  }

  return selected
}
