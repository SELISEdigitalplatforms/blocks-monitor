import { describe, expect, it } from "vitest";
import { acceptsWorkerJob, workerJobScope } from "../../server/blocks/engineWorker/jobScope";

describe("operator-owned worker scope", () => {
  it("excludes cloud extraction even when a foreign claim is stale", () => {
    const scope = workerJobScope({ MF_ENGINE_EXCLUDED_JOB_KINDS: "file.extract" });
    expect(acceptsWorkerJob(scope, { Kind: "file.extract", ClaimedBy: "cloud", ClaimedAt: "2020-01-01" })).toBe(false);
    expect(acceptsWorkerJob(scope, { Kind: "build.run" })).toBe(true);
    expect(() => workerJobScope({ MF_ENGINE_EXCLUDED_JOB_KINDS: "unknown" })).toThrow();
  });
  it("keeps the existing full-worker default", () => {
    const scope = workerJobScope({});
    expect(acceptsWorkerJob(scope, { ProjectId: "p1", Kind: "build.run" })).toBe(true);
  });
  it("restricts both project and job kind, including jobs loaded with a project snapshot", () => {
    const scope = workerJobScope({ MF_ENGINE_PROJECT_IDS: "p1,p1", MF_ENGINE_JOB_KINDS: "design.generate" });
    expect(scope).toEqual({ projectIds: ["p1"], kinds: ["design.generate"] });
    expect(acceptsWorkerJob(scope, { ProjectId: "p1", Kind: "design.generate" })).toBe(true);
    expect(acceptsWorkerJob(scope, { ProjectId: "p2", Kind: "design.generate" })).toBe(false);
    expect(acceptsWorkerJob(scope, { ProjectId: "p1", Kind: "build.run" })).toBe(false);
  });
  it.each(["../project", "project/other", "*", ",,,", "x".repeat(65)])("rejects invalid project scope %s rather than processing all projects", (value) => {
    expect(() => workerJobScope({ MF_ENGINE_PROJECT_IDS: value })).toThrow("Invalid worker project scope");
  });
  it.each(["design.unknown", "*", ",,,"])("rejects invalid kind scope %s", (value) => {
    expect(() => workerJobScope({ MF_ENGINE_JOB_KINDS: value })).toThrow("Invalid worker job-kind scope");
  });
});
