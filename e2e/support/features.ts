/**
 * TypeScript mirror of features.mjs — keep both files in sync when adding features.
 * The runner reads features.mjs; this file is for IDE autocomplete in specs if needed.
 */
export type MonitorFeature = {
  id: string;
  name: string;
  enabled: boolean;
  spec: string;
};

export const MONITOR_FEATURES: MonitorFeature[] = [
  {
    id: "monitor",
    name: "Monitor – pause & resume",
    enabled: true,
    spec: "tests/02-monitor/monitor.spec.ts",
  },
];
