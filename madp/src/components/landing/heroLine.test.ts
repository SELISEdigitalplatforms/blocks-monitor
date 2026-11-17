import { describe, expect, it } from "vitest";
import { LEGEND, LEGEND_LABEL } from "./heroLine";

describe("hero legend", () => {
  it("has the 10 stops, phase and human role, in order", () => {
    expect(LEGEND.map((s) => [s.phase, s.label])).toEqual([
      ["Brief", "Product Owner"],
      ["Plan", "Business Analyst"],
      ["Build", "Software Engineer"],
      ["Review", "Code Reviewer"],
      ["Test", "QA Engineer"],
      ["Security", "Security Engineer"],
      ["Docs", "Technical Writer"],
      ["Release", "Release Manager"],
      ["Deploy", "DevOps Engineer"],
      ["Live", "End users"],
    ]);
  });

  it("contains no digits", () => {
    expect(JSON.stringify(LEGEND)).not.toMatch(/\d/);
    expect(LEGEND_LABEL).not.toMatch(/\d/);
  });

  it("reads the roles in order for screen readers", () => {
    expect(LEGEND_LABEL).toBe(
      "From the Product Owner's brief to End users: Business Analyst, Software Engineer, Code Reviewer, QA Engineer, Security Engineer, Technical Writer, Release Manager, DevOps Engineer",
    );
  });
});
