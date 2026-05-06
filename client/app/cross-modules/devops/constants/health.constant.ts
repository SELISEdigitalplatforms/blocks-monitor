import { MONITOR_SOURCE_TYPES } from "./alert.constant";

export const TABS = {
  all: { label: "All services", monitorSourceType: null },
  services: { label: "Blocks services", monitorSourceType: MONITOR_SOURCE_TYPES.BlocksServices },
  deployed: { label: "Deployed services", monitorSourceType: MONITOR_SOURCE_TYPES.DeployedServices },
  external: { label: "My services", monitorSourceType: MONITOR_SOURCE_TYPES.ExternalServices },
  others: { label: "Others", monitorSourceType: MONITOR_SOURCE_TYPES.OtherServices },
} as const;
export type TabKey = keyof typeof TABS;
