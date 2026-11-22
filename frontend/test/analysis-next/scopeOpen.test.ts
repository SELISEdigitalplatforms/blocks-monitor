// Business Analysis sends the Scope & success step's entry op (scope.open: queues the scope draft, repairs a lock) once
// per project as soon as the project has reached the step, also when the requirements are approved on the page.
import { describe, expect, it } from "vitest";
import { shouldOpenScope } from "../../src/components/analysis-next/next/scopeOpen";

const at = (step: Parameters<typeof shouldOpenScope>[0]["step"], o: Partial<Parameters<typeof shouldOpenScope>[0]> = {}) =>
  shouldOpenScope({ projectId: "p1", workspaceId: "w1", step, sentFor: null, ...o });

describe("shouldOpenScope", () => {
  it("waits until the project reaches Scope & success", () => {
    expect(at("business")).toBe(false);
    expect(at("sanitization")).toBe(false);
    expect(at("requirements")).toBe(false);
    expect(at(null)).toBe(false);
  });

  it("sends it at Scope & success and after it (the op repairs an interrupted lock there)", () => {
    expect(at("scope")).toBe(true);
    expect(at("board")).toBe(true);
  });

  it("sends it once per project, and only with a workspace", () => {
    expect(at("scope", { sentFor: "p1" })).toBe(false);
    expect(at("scope", { sentFor: "p0" })).toBe(true);
    expect(at("scope", { workspaceId: null })).toBe(false);
    expect(at("scope", { projectId: "" })).toBe(false);
  });
});
