import type { RouterType } from "@/router";

export const BREADCRUMB_CUSTOM_TITLES: Record<RouterType, string | null> = {
  "/": null,
  "/login": null,
  "/login/callback": null,
  "/app": null,
  "/app/console": null,
  "/app/:itemId": null,
  "/app/:itemId/dashboard": null,
  "/app/:itemId/health": null,
  "/app/:itemId/monitor/:id": "Alert",
  "/app/:itemId/monitor/incidents/:id": null,
  "/app/profile": null,
  "/*": null,
};
