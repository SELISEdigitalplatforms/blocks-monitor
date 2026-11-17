import { describe, it, expect } from "vitest";
import {
  ALERT_PROVIDERS,
  HttpMethods,
  HTTP_METHODS,
  ScheduleOptions,
  SCHEDULES,
  MONITOR_INTERVAL,
  REVERSE_MONITOR_INTERVAL,
  REQUEST_TIMEOUT,
  REVERSE_REQUEST_TIMEOUT,
  MONITOR_SOURCE_TYPES,
} from "@/constants/alert.constant";
import {
  DEPLOYMENT_ENDPOINTS,
  ALERT_ENDPOINTS,
  MIGRATION_ENDPOINTS,
} from "@/constants/endpoint.constant";
import { tStatic } from "@seliseblocks/genesis-os/i18n";
import { getNavigationMenus } from "@/constants/navigation-menus.constant";
import { Sparkles } from "lucide-react";
import { MONITOR_TABS, parseAsMonitorTabKey } from "@/constants/monitor.constant";

describe("alert.constant", () => {
  it("exposes provider and method enums", () => {
    expect(ALERT_PROVIDERS.health).toBe("health");
    expect(HttpMethods.POST).toBe("2");
    expect(ScheduleOptions.CRON).toBe("2");
    expect(MONITOR_SOURCE_TYPES.BlocksServices).toBe("2");
  });

  it("has label/value option lists", () => {
    expect(HTTP_METHODS).toHaveLength(3);
    expect(HTTP_METHODS.map((m) => m.value)).toContain(HttpMethods.GET);
    expect(SCHEDULES).toHaveLength(3);
  });

  it("keeps interval maps consistent in both directions", () => {
    for (const [step, seconds] of Object.entries(MONITOR_INTERVAL)) {
      expect(REVERSE_MONITOR_INTERVAL[seconds]).toBe(Number(step));
    }
  });

  it("keeps timeout maps consistent in both directions", () => {
    expect(REQUEST_TIMEOUT[3]).toBe(30);
    expect(REVERSE_REQUEST_TIMEOUT[30]).toBe(3);
  });
});

describe("endpoint.constant", () => {
  it("prefixes deployment endpoints with /api", () => {
    expect(DEPLOYMENT_ENDPOINTS.ACCESS_TOKEN).toBe("/api/auth/accessToken");
    expect(DEPLOYMENT_ENDPOINTS.GITHUB_REPOS).toBe("/api/github/repos");
  });

  it("exposes monitor + health endpoints", () => {
    expect(ALERT_ENDPOINTS.SAVE_MONITOR).toBe("/api/Monitor/SaveMonitor");
    expect(ALERT_ENDPOINTS.SAVE_HEALTH).toBe("/api/Health/SaveHealth");
  });

  it("exposes repo-details and reports endpoints", () => {
    expect(ALERT_ENDPOINTS.GET_REPO_DETAILS).toBe("/api/Monitor/repo-details");
    expect(ALERT_ENDPOINTS.GET_REPORTS).toBe("/api/Monitor/reports");
  });

  it("exposes the four Alert recipients endpoints (#256)", () => {
    expect(ALERT_ENDPOINTS.GET_ALERT_RECIPIENTS).toBe("/api/Monitor/GetAlertRecipients");
    expect(ALERT_ENDPOINTS.GET_ALERT_RECIPIENT_SUGGESTIONS).toBe(
      "/api/Monitor/GetAlertRecipientSuggestions",
    );
    expect(ALERT_ENDPOINTS.SAVE_ALERT_RECIPIENT).toBe("/api/Monitor/SaveAlertRecipient");
    expect(ALERT_ENDPOINTS.DELETE_ALERT_RECIPIENT).toBe("/api/Monitor/DeleteAlertRecipient");
  });

  it("exposes migration endpoints", () => {
    expect(MIGRATION_ENDPOINTS.GET_STATUS).toBe("/api/migration/status");
  });
});

describe("navigation constants", () => {
  const navigationMenus = getNavigationMenus((key) => tStatic("monitor.shared", key));

  it("provides navigation menu entries", () => {
    const menu = navigationMenus.find((m) => m.id === "madp");
    expect(menu?.path).toBe("/app/madp");
    expect(navigationMenus.some((m) => m.type === "separator")).toBe(true);
  });

  it("opens MADP and keeps Blocks project and repository navigation", () => {
    const ids = navigationMenus.filter((m) => m.type === "menu").map((m) => m.id);
    expect(ids).toEqual(["madp", "blocks-overview", "repos", "environments"]);
    const repos = navigationMenus.find((m) => m.id === "repos");
    expect(repos?.path).toBe("/app/repositories");
    expect(repos?.name).toBe("Repos");
  });

  it("labels the MADP workspace", () => {
    const item = navigationMenus.find((m) => m.id === "madp");
    expect(item).toMatchObject({
      type: "menu",
      name: "MADP",
      path: "/app/madp",
      icon: Sparkles,
    });
  });
});

describe("monitor.constant parseAsMonitorTabKey", () => {
  it("has the expected tabs", () => {
    expect(Object.keys(MONITOR_TABS)).toEqual(["all", "services"]);
    expect(MONITOR_TABS.services.monitorSourceType).toBe(MONITOR_SOURCE_TYPES.BlocksServices);
  });

  it("parses a known tab key", () => {
    expect(parseAsMonitorTabKey.parse("services")).toBe("services");
  });

  it("falls back to 'all' for an unknown key", () => {
    expect(parseAsMonitorTabKey.parse("bogus")).toBe("all");
  });

  it("serializes a tab key back to its string", () => {
    expect(parseAsMonitorTabKey.serialize("all")).toBe("all");
  });
});
