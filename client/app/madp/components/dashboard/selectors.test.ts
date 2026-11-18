import { describe, expect, it } from "vitest";
import { kpis, releaseRows, type DashProject, type DashRelease } from "./selectors";

const project = (id: string, stage: string): DashProject => ({
  id, name: `Project ${id}`, clientName: "", stage, step: "business", assigneeUserId: "", createdByUserId: "", updatedAt: "2026-10-20T08:00:00Z",
  handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "",
});
const release = (projectId: string, env: DashRelease["env"], version: string, status = "released"): DashRelease =>
  ({ projectId, env, version, status, releasedAt: "2026-10-20T08:00:00Z" });

describe("dashboard releases come from Release records only", () => {
  it("a project without a Release record is not released and has no row", () => {
    const projects = [project("a", "release"), project("b", "build")];
    expect(releaseRows(projects, [])).toEqual([]);
    expect(kpis({ projects, jobs: [], releases: [] })).toMatchObject({ released: 0 });
  });

  it("counts a project once however many releases it has, and ignores failed ones", () => {
    const projects = [project("a", "release"), project("b", "build")];
    const releases = [release("a", "dev", "1.0"), release("a", "stage", "1.0"), release("b", "dev", "0.1", "failed"), release("zz", "dev", "1.0")];
    expect(kpis({ projects, jobs: [], releases })).toMatchObject({ released: 1 });
    expect(releaseRows(projects, releases).map((r) => r.projectId)).toEqual(["a"]);
  });
});
