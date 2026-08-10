import { createParser } from "nuqs";
import { MONITOR_SOURCE_TYPES } from "@/constants/alert.constant";

export const MONITOR_TABS = {
  all: { label: "My monitors", monitorSourceType: null },
  services: {
    label: "Blocks services",
    monitorSourceType: MONITOR_SOURCE_TYPES.BlocksServices,
  },
} as const;
export type MonitorTabKey = keyof typeof MONITOR_TABS;

export const parseAsMonitorTabKey = createParser({
  parse(value: string) {
    if (value in MONITOR_TABS) {
      return value as MonitorTabKey;
    }
    return "all";
  },
  serialize(value: MonitorTabKey) {
    return value;
  },
});
