import type { RouterType } from "@/router";

export const BREADCRUMB_CUSTOM_TITLES: Record<RouterType, string | null> = {
  "/": null,
  "/login": null,
  "/login/callback": null,
  "/app": null,
  "/app/console": null,
  "/app/dashboard": null,
  "/app/project-overview": null,
  "/app/project-overview/environments": null,
  "/app/health": null,
  "/app/health/health": null,
  "/app/health/monitor/incidents/:id": null,
  "/app/health/monitor/:id": "Alert",
  "/app/profile": null,
  "/*": null,
};
