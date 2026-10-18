import { describe, it, expect } from "vitest";
import {
  hasNoReport,
  transformVulnerabilities,
} from "@/components/module/repos/sca-transform";

describe("sca-transform", () => {
  it("returns empty for null/empty input", () => {
    expect(transformVulnerabilities(null)).toEqual([]);
    expect(transformVulnerabilities([])).toEqual([]);
  });

  it("maps fields with Unknown defaults and null-safe EPSS/CVSS", () => {
    const rows = transformVulnerabilities([
      { severity: "HIGH", score: "7.5", epssPercentile: 0.5 },
      { id: "CVE-1", name: "left-pad", group: "npm", version: "1.0.0", severity: "CRITICAL" },
      { severity: "LOW", score: null, epssPercentile: null },
    ]);
    expect(rows[0].severity).toBe("Critical");
    expect(rows[0].vulnerability).toBe("CVE-1");
    expect(rows[1].severity).toBe("High");
    expect(rows[1].epss).toBe(50);
    expect(rows[1].cvss).toBe(7.5);
    expect(rows[2].cvss).toBeNull();
    expect(rows[2].epss).toBeNull();
    expect(rows[2].component).toBe("Unknown");
  });

  it("orders by severity then CVSS desc with nulls last", () => {
    const rows = transformVulnerabilities([
      { severity: "HIGH", score: "5" },
      { severity: "HIGH", score: "9" },
      { severity: "HIGH", score: null },
      { severity: "CRITICAL", score: "1" },
    ]);
    expect(rows.map((r) => [r.severity, r.cvss])).toEqual([
      ["Critical", 1],
      ["High", 9],
      ["High", 5],
      ["High", null],
    ]);
  });

  it("hasNoReport treats null/empty details as no report", () => {
    expect(hasNoReport(null)).toBe(true);
    expect(hasNoReport({ details: null })).toBe(true);
    expect(hasNoReport({ details: {} })).toBe(true);
    expect(hasNoReport({ details: { ncloc: "1" } })).toBe(false);
  });
});
