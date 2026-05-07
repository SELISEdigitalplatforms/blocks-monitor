import { createParser } from "nuqs";
import { MONITOR_SOURCE_TYPES } from "./alert.constant";

export const HEALTH_TABS = {
  all: { label: "My monitors", monitorSourceType: null },
  services: {
    label: "Blocks services",
    monitorSourceType: MONITOR_SOURCE_TYPES.BlocksServices,
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
