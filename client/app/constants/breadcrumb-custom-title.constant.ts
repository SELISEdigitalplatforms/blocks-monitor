import type { RouterType } from "@/router";

export const BREADCRUMB_CUSTOM_TITLES: Record<RouterType, string | null> = {
  "/": null,
  "/app/console": null,
  "/app/dashboard": null,
  "/app/project-overview": null,
  "/app/project-overview/environments": null,
  "/app/health": null,
  "/app/health/monitor/incidents/:id": null,
  "/app/health/monitor/:id": "Alert",
  "/login": null,
  "/login/callback": null,
  "/app/profile": null,
  "/*": null,
};
