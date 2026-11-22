// The dashboard names a deploy job by where it goes: a milestone preview, or a release to development, staging or
// production (its InputJson), never "Milestone preview finished" for a release.
import { describe, expect, it } from "vitest";
import { assistFocusOf, deployTargetOf, jobLabel, recentActivity, type DashJob, type DashProject } from "../../src/domain/dashboard";
import { officeView } from "../../src/components/dashboard/officeStages";

const project = { id: "p1", name: "Asset Market", clientName: "", stage: "release", step: "release", assigneeUserId: "", createdByUserId: "u1", updatedAt: "" } as unknown as DashProject;
const job = (id: string, input: Record<string, unknown>, at: string): DashJob => ({
  id, projectId: "p1", kind: "preview.deploy", status: "succeeded", progress: 100, requestedByUserId: "u1",
  createdAt: at, finishedAt: at, errorCode: "", deployTo: deployTargetOf(JSON.stringify(input)),
});

describe("deploy jobs on the dashboard", () => {
  it("reads the target from the job's input", () => {
    expect(deployTargetOf(JSON.stringify({ milestoneId: "m1", version: "0.1.0" }))).toBe("preview");
    expect(deployTargetOf(JSON.stringify({ release: "1.0.0", milestoneId: "m3" }))).toBe("dev");
    expect(deployTargetOf(JSON.stringify({ environment: "stage", version: "1.0.0" }))).toBe("stage");
    expect(deployTargetOf(JSON.stringify({ environment: "production", version: "1.0.0" }))).toBe("production");
    expect(deployTargetOf("")).toBe("preview");
    expect(jobLabel({ kind: "build.run" })).toBe("Build");
  });

  it("names release deploys as releases in the activity and the office caption", () => {
    const jobs = [
      job("j1", { milestoneId: "m1", version: "0.1.0" }, "2026-10-31T13:30:00Z"),
      job("j2", { release: "1.0.0" }, "2026-10-31T13:58:00Z"),
      job("j3", { environment: "stage", version: "1.0.0" }, "2026-10-31T14:01:00Z"),
      job("j4", { environment: "production", version: "1.0.0" }, "2026-10-31T14:04:00Z"),
    ];
    const texts = recentActivity({ projects: [project], jobs, releases: [], approvals: [], clarifications: [], tickets: [], changes: [] }).map((a) => a.text);
    expect(texts).toEqual(["Release to production finished", "Release to staging finished", "Release to development finished", "Milestone preview finished"]);
    expect(officeView(jobs[3]!).caption).toMatch(/^Release to production · /);
  });
});

describe("the analysis jobs on the dashboard", () => {
  it("names the technical reading as technical decisions, not a second round of clarifying questions", () => {
    // E2E 08.11: "Clarifying questions finished" twice in the activity; the second was the technical decisions
    expect(assistFocusOf(JSON.stringify({ focus: "technical" }))).toBe("technical");
    expect(assistFocusOf(JSON.stringify({ focus: "requirements" }))).toBe("requirements");
    expect(assistFocusOf(JSON.stringify({ focus: "clarifications" }))).toBe("clarifications");
    expect(assistFocusOf("")).toBe("clarifications");
    expect(assistFocusOf("not json")).toBe("clarifications");
    const at = (m: number) => `2026-11-08T12:${String(m).padStart(2, "0")}:00Z`;
    const assist = (id: string, focus: string, m: number): DashJob => ({
      id, projectId: "p1", kind: "sanitization.assist", status: "succeeded", progress: 100, requestedByUserId: "u1",
      createdAt: at(m), finishedAt: at(m), errorCode: "", focus: assistFocusOf(JSON.stringify({ focus })),
    });
    const texts = recentActivity({ projects: [project], jobs: [assist("a1", "clarifications", 1), assist("a2", "technical", 2)], releases: [], approvals: [], clarifications: [], tickets: [], changes: [] }).map((a) => a.text);
    expect(texts).toEqual(["Technical decisions finished", "Clarifying questions finished"]);
    expect(jobLabel({ kind: "sanitization.assist" })).toBe("Clarifying questions");
    expect(jobLabel({ kind: "sanitization.assist", focus: "requirements" })).toBe("Requirement suggestions");
  });
});
