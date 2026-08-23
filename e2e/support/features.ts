/**
 * TypeScript mirror of features.mjs — keep both files in sync when adding features.
 * The runner reads features.mjs; this file is for IDE autocomplete in specs if needed.
 */
export type MonitorFeature = {
  id: string
  name: string
  enabled: boolean
  spec: string
}

export const MONITOR_FEATURES: MonitorFeature[] = [
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
