// Home, Projects, the Dashboard and the Wiki picker name where a project stands by the four steps the stepper shows
// (Project Setup → Business Analysis → Software Engineering → Release), "Step n of 4", and open the step's page: an
// analysis step opens its section of /p/:id/analysis. What waits for whom still follows the stored step.
import { describe, expect, it } from "vitest";
import { needsAttention, STEP_PERMISSION, stepPath, yourProjects, type DashboardRecords, type DashProject } from "../../src/domain/dashboard";
import { projectsNow, stepNameOf } from "../../src/domain/projectNow";
import { STEPS as FACTORY_STEPS } from "../../src/lib/factoryLabels";
import { STEPS, stepWords } from "../../src/components/home/parts";
import { projectPageTitle } from "../../src/ui/Shell";
import type { JourneyStep } from "../../src/domain/journey";

const project = (step: JourneyStep, extra: Partial<DashProject> = {}): DashProject => ({
  id: "p1", name: "Asset Market", clientName: "", stage: step, step, assigneeUserId: "u1", createdByUserId: "u1",
  updatedAt: "2026-11-07T10:00:00Z", handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "", ...extra,
});
const records = (p: DashProject): DashboardRecords => ({ projects: [p], jobs: [], releases: [], approvals: [], clarifications: [], tickets: [], changes: [] });
const ALL = Object.values(STEP_PERMISSION) as string[];

describe("where a project stands, in the four steps", () => {
  it("names each stored step by its step of four", () => {
    const names = (["business", "understanding", "sanitization", "requirements", "scope", "board", "build", "release"] as const).map((s) => stepNameOf({ step: s }));
    expect(names).toEqual([
      "Project Setup", "Business Analysis", "Business Analysis", "Business Analysis", "Business Analysis",
      "Software Engineering", "Software Engineering", "Release",
    ]);
    expect(STEPS).toEqual(["Project Setup", "Business Analysis", "Software Engineering", "Release"]);
    expect(FACTORY_STEPS).toEqual(STEPS);
  });

  it("opens an analysis step at its section of the Business Analysis page", () => {
    expect(stepPath("p1", "scope")).toBe("/p/p1/analysis#scope");
    expect(stepPath("p1", "sanitization")).toBe("/p/p1/analysis#sanitization");
    expect(stepPath("p1", "business")).toBe("/p/p1/business");
    expect(stepPath("p1", "board")).toBe("/p/p1/build?tab=board");
    expect(stepPath("p1", "build")).toBe("/p/p1/build");
    expect(stepPath("p1", "release")).toBe("/p/p1/delivered");
    expect(stepPath("p1", "wiki")).toBe("/p/p1/wiki");
  });

  it("lists a project at scope as Business Analysis, linked to the scope section", () => {
    expect(yourProjects([project("scope")])[0]).toMatchObject({ stepLabel: "Business Analysis", to: "/p/p1/analysis#scope" });
    expect(needsAttention(records(project("requirements")), "u1", ALL).find((a) => a.kind === "assigned"))
      .toMatchObject({ text: "Asset Market: assigned to you at Business Analysis", to: "/p/p1/analysis#requirements" });
  });

  it("keeps what waits for you on the stored step, with the phase as the step's name", () => {
    const now = projectsNow(records(project("scope")), "u1", ALL).get("p1")!;
    expect(now.stepLabel).toBe("Business Analysis");
    expect(now.waiting).toEqual([expect.objectContaining({ kind: "scope", text: "Scope waiting for your sign-off", action: "Review", to: "/p/p1/analysis#scope" })]);
    const paused = projectsNow(records(project("requirements", { stage: "paused" })), "u1", ALL).get("p1")!;
    expect(paused.workingText).toBe("Paused at Business Analysis");
  });

  it("counts the steps as n of 4", () => {
    expect(stepWords({ status: "scope", step: 1, progress: 0 })).toBe("Step 2 of 4: Business Analysis");
    expect(stepWords({ status: "intake", step: 0, progress: 0 }, false)).toBe("Step 1 of 4");
  });

  it("names a project page in the browser tab by its step of four", () => {
    expect(projectPageTitle("/p/p1/analysis")).toBe("Business Analysis");
    expect(projectPageTitle("/p/p1/scope")).toBe("Business Analysis");
    expect(projectPageTitle("/p/p1/business")).toBe("Project Setup");
    expect(projectPageTitle("/p/p1/build")).toBe("Software Engineering");
    expect(projectPageTitle("/p/p1/delivered")).toBe("Release");
    expect(projectPageTitle("/p/p1/wiki")).toBe("Wiki");
    expect(projectPageTitle("/p/p1/produced")).toBe("What MADP produced");
    expect(projectPageTitle("/projects")).toBeUndefined();
  });
});
