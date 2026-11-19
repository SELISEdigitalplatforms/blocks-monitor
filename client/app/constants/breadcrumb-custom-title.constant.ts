import type { RouterType } from "@/router";

export const BREADCRUMB_CUSTOM_TITLES: Partial<Record<RouterType, string | null>> = {
  "/": null,
  "/login": null,
  "/login/callback": null,
  "/app": null,
  "/app/console": null,
  "/app/profile": null,
  "/*": null,
};
