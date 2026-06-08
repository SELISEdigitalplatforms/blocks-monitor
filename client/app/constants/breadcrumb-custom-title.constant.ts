import type { RouterType } from "@/router";

export const BREADCRUMB_CUSTOM_TITLES: Record<RouterType, string | null> = {
  "/": null,
  "/console": null,
  "/dashboard": null,
  "/project-overview": null,
  "/project-overview/environments": null,
  "/health": null,
  "/health/monitor/incidents/:id": null,
  "/health/monitor/:id": "Alert",
  "/login": null,
  "/login/callback": null,
  "/profile": null,
  "/*": null,
};
