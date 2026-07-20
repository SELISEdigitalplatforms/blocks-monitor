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
import { navigationMenus } from "@/constants/navigation-menus.constant";
import {
  HEALTH_TABS,
  parseAsHealthTabKey,
} from "@/constants/health.constant";

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

  it("exposes migration endpoints", () => {
    expect(MIGRATION_ENDPOINTS.GET_STATUS).toBe("/api/migration/status");
  });
});

describe("navigation constants", () => {
  it("provides navigation menu entries", () => {
    const menu = navigationMenus.find((m) => m.id === "health");
    expect(menu?.path).toBe("/app/health");
    expect(navigationMenus.some((m) => m.type === "separator")).toBe(true);
  });
});

describe("health.constant parseAsHealthTabKey", () => {
  it("has the expected tabs", () => {
    expect(Object.keys(HEALTH_TABS)).toEqual(["all", "services"]);
    expect(HEALTH_TABS.services.monitorSourceType).toBe(
      MONITOR_SOURCE_TYPES.BlocksServices,
    );
  });

  it("parses a known tab key", () => {
    expect(parseAsHealthTabKey.parse("services")).toBe("services");
  });

  it("falls back to 'all' for an unknown key", () => {
    expect(parseAsHealthTabKey.parse("bogus")).toBe("all");
  });

  it("serializes a tab key back to its string", () => {
    expect(parseAsHealthTabKey.serialize("all")).toBe("all");
  });
});
