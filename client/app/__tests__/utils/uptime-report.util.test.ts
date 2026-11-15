import { describe, it, expect, vi, afterEach } from "vitest";
import {
  reportFileName,
  resolveReportPeriod,
  saveFile,
  slugify,
  toDateInputValue,
} from "@/utils/uptime-report.util";

const NOW = new Date(2026, 10, 9, 15, 30); // 9 Nov 2026 15:30 local
const DAY = 24 * 60 * 60 * 1000;

describe("resolveReportPeriod", () => {
  it.each([
    ["24h", 1],
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
    ["365d", 365],
  ] as const)("preset %s ends now and spans %i days", (period, days) => {
    const result = resolveReportPeriod(period, { from: "", to: "" }, NOW);
    expect(result).toEqual({ from: new Date(NOW.getTime() - days * DAY), to: NOW });
  });

  it("custom runs from the start of the first day to the end of the last day", () => {
    const result = resolveReportPeriod("custom", { from: "2026-10-01", to: "2026-10-31" }, NOW);
    expect(result).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
  });

  it("custom ending today stops at now, not midnight", () => {
    const result = resolveReportPeriod("custom", { from: "2026-11-01", to: "2026-11-09" }, NOW);
    expect(result).toEqual({ from: new Date(2026, 10, 1), to: NOW });
  });

  it.each([
    [{ from: "", to: "2026-11-01" }, "REQUIRED"],
    [{ from: "2026-02-30", to: "2026-03-01" }, "REQUIRED"],
    [{ from: "2026-11-05", to: "2026-11-01" }, "ORDER"],
    [{ from: "2026-12-01", to: "2026-12-02" }, "FUTURE"],
    [{ from: "2025-01-01", to: "2026-11-01" }, "TOO_LONG"],
  ])("rejects %o with %s", (custom, error) => {
    expect(resolveReportPeriod("custom", custom, NOW)).toEqual({ error });
  });

  it("accepts a full leap year", () => {
    const result = resolveReportPeriod("custom", { from: "2024-01-01", to: "2024-12-31" }, NOW);
    expect(result).not.toHaveProperty("error");
  });
});

describe("file naming", () => {
  it("slugifies like the server", () => {
    expect(slugify("  Payments API (prod)! ")).toBe("payments-api-prod");
    expect(slugify("***")).toBe("monitor");
    expect(slugify("--a  b--")).toBe("a-b");
    // The 40-character cut lands right after a dash, which must not be left at the end.
    expect(slugify(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    // Long separator runs stay fast (the shape a backtracking regex chokes on).
    expect(slugify(`a${"-".repeat(50_000)}!`)).toBe("a");
  });

  it("builds the download name from scope, local dates and format", () => {
    expect(reportFileName("My monitors", new Date(2026, 9, 1), new Date(2026, 10, 9), "xlsx")).toBe(
      "uptime-report_my-monitors_20261001-20261109.xlsx",
    );
  });

  it("formats dates for date inputs in local time", () => {
    expect(toDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("saveFile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("re-types an octet-stream blob and clicks a download link", () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return "blob:x";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    saveFile(new Blob(["x"], { type: "application/octet-stream" }), "r.xlsx", "application/x-test");

    expect(created[0].type).toBe("application/x-test");
    expect(click).toHaveBeenCalledOnce();
  });
});
