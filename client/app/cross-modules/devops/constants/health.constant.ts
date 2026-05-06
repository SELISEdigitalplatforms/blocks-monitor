import { createParser } from "nuqs";
import { MONITOR_SOURCE_TYPES } from "./alert.constant";

export const HEALTH_TABS = {
  all: { label: "All services", monitorSourceType: null },
  services: {
    label: "Blocks services",
    monitorSourceType: MONITOR_SOURCE_TYPES.BlocksServices,
  },
  deployed: {
    label: "Deployed services",
    monitorSourceType: MONITOR_SOURCE_TYPES.DeployedServices,
  },
  external: {
    label: "My services",
    monitorSourceType: MONITOR_SOURCE_TYPES.ExternalServices,
  },
  others: {
    label: "Others",
    monitorSourceType: MONITOR_SOURCE_TYPES.OtherServices,
  },
} as const;
export type HealthTabKey = keyof typeof HEALTH_TABS;

export const parseAsHealthTabKey = createParser({
  parse(value: string) {
    if (value in HEALTH_TABS) {
      return value as HealthTabKey;
    }
    return "all";
  },
  serialize(value: HealthTabKey) {
    return value;
  },
});
