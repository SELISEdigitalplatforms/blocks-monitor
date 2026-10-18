import { describe, it, expect } from "vitest";
import {
  DEPLOYMENT_LOG_EVENT_STATUS,
  DURATION_PLACEHOLDER,
  formatElapsedTime,
  getDeploymentLogEventBadgeClassName,
  getDeploymentLogEventBadgeStyle,
  isLiveBuildStatus,
} from "@/utils/deployment-logs.utils";

describe("deployment-logs.utils", () => {
  it("maps known statuses to badge styles", () => {
    expect(getDeploymentLogEventBadgeStyle(DEPLOYMENT_LOG_EVENT_STATUS.SUCCESS).bg).toBe(
      "bg-green-100",
    );
    expect(getDeploymentLogEventBadgeStyle(DEPLOYMENT_LOG_EVENT_STATUS.FAILED).bg).toBe(
      "bg-red-100",
    );
    expect(getDeploymentLogEventBadgeStyle("TotallyUnknown").bg).toBe("bg-yellow-100");
  });

  it("builds a className string", () => {
    expect(getDeploymentLogEventBadgeClassName(DEPLOYMENT_LOG_EVENT_STATUS.RUNNING)).toContain(
      "bg-blue-100",
    );
  });

  it("formats elapsed time", () => {
    expect(formatElapsedTime(Number.NaN)).toBe(DURATION_PLACEHOLDER);
    expect(formatElapsedTime(500)).toBe("1s");
    expect(formatElapsedTime(90_000)).toBe("1m 30s");
    expect(formatElapsedTime(3_600_000 + 120_000)).toBe("1h 2m");
  });

  it("detects live build statuses", () => {
    expect(isLiveBuildStatus("Running")).toBe(true);
    expect(isLiveBuildStatus("Succeeded")).toBe(false);
    expect(isLiveBuildStatus(null)).toBe(false);
  });
});
