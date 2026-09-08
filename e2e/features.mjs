/**
 * Monitor E2E feature list — edit `enabled` and order here.
 * Run: npm run test:features
 *
 * Env: E2E_FEATURES=pause-resume,delete  or  E2E_FEATURES=all
 */

/** @type {{ id: string, name: string, enabled: boolean, spec: string }[]} */
export const MONITOR_FEATURES = [
  {
    id: "monitor",
    name: "Monitor – pause & resume",
    enabled: true,
    spec: "tests/02-monitor/monitor.spec.ts",
  },
];

export function resolveEnabledFeatures() {
  const override = process.env.E2E_FEATURES?.trim();

  if (!override || override === "all") {
    return MONITOR_FEATURES.filter((feature) => feature.enabled);
  }

  const ids = override
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  /** @type {typeof MONITOR_FEATURES} */
  const selected = [];

  for (const id of ids) {
    const feature = MONITOR_FEATURES.find((entry) => entry.id === id);
    if (!feature) {
      throw new Error(
        `Unknown E2E feature "${id}". Valid ids: ${MONITOR_FEATURES.map((f) => f.id).join(", ")}`,
      );
    }
    selected.push(feature);
  }

  return selected;
}
