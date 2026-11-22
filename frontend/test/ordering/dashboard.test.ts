// Newest first on the Dashboard, the Projects page and the project switcher: the Releases card puts the project with the
// newest release on top (PrimaBook was at the very bottom although its releases are the newest), the project lists go by
// each project's latest activity, the activity feed and what waits for you follow the same rule.
//   npx vitest run --config test/ordering/vitest.config.ts test/ordering/dashboard.test.ts
import { describe, expect, it } from "vitest";
import {
  byRecent, latestActivity, liveNow, projectsByActivity, recentActivity, releaseRows, yourProjects,
  type DashboardRecords, type DashJob, type DashProject, type DashRelease,
} from "@/domain/dashboard";
import { latestReleases } from "@/components/home/projects/projectCards";
import { switcherProjects } from "@/components/project/ProjectSwitcher";
import { sortChangeWaits, type ChangeWait } from "@/components/team/changeWaiting";

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();
const project = (id: string, name: string, updatedAt: string, extra: Partial<DashProject> = {}): DashProject => ({
  id, name, clientName: "", stage: "build", step: "build", assigneeUserId: "", createdByUserId: "", updatedAt, createdAt: at(1),
  handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "", ...extra,
});
const release = (projectId: string, env: DashRelease["env"], version: string, releasedAt: string): DashRelease => ({ projectId, env, version, status: "released", releasedAt });
const records = (over: Partial<DashboardRecords>): DashboardRecords => ({ projects: [], jobs: [], releases: [], approvals: [], clarifications: [], tickets: [], changes: [], ...over });

// PrimaBook's own row was last written days ago; its releases are the newest of the workspace
const projects = [
  project("asset", "Asset Market", at(9)),
  project("kairo", "Kairo", at(8)),
  project("prima", "PrimaBook", at(2)),
];
const releases = [
  release("asset", "dev", "1.0.0", at(5)),
  release("kairo", "dev", "0.9.0", at(6)),
  release("kairo", "stage", "0.9.0", at(7)),
  release("prima", "dev", "1.4.0", at(10, 8)),
  release("prima", "production", "1.3.0", at(10, 7)),
];

describe("the Dashboard's Releases card", () => {
  it("puts the project with the newest release on top (PrimaBook), then the others by their newest release", () => {
    expect(releaseRows(projects, releases).map((r) => r.project)).toEqual(["PrimaBook", "Kairo", "Asset Market"]);
  });

  it("counts a release on any environment, and keeps each environment's newest version", () => {
    const rows = releaseRows(projects, [...releases, release("asset", "production", "1.0.0", at(11))]);
    expect(rows.map((r) => r.projectId)).toEqual(["asset", "prima", "kairo"]);
    expect(rows[1]).toMatchObject({ dev: { version: "1.4.0" }, production: { version: "1.3.0" }, stage: null });
  });

  it("breaks a tie of release times by the projects' latest update", () => {
    const same = [release("asset", "dev", "1.0.0", at(5)), release("kairo", "dev", "1.0.0", at(5))];
    expect(releaseRows(projects, same).map((r) => r.projectId)).toEqual(["asset", "kairo"]);
  });

  it("the Projects page's release chips read the same rows", () => {
    expect([...latestReleases(projects, releases).keys()]).toEqual(["prima", "kairo", "asset"]);
  });
});

describe("the project lists, by latest activity", () => {
  const rec = records({ projects, releases });

  it("a project's latest activity is the newest of its own update, jobs, releases, changes and done tasks", () => {
    const job: DashJob = { id: "j", projectId: "kairo", kind: "build.run", status: "succeeded", progress: 100, requestedByUserId: "", createdAt: at(11), finishedAt: at(12), errorCode: "" };
    const activity = latestActivity(records({
      projects, releases, jobs: [job],
      changes: [{ id: "c", projectId: "asset", number: 3, title: "x", status: "draft", createdAt: at(13) }],
      tickets: [{ id: "t", projectId: "prima", title: "x", doneAt: at(14) }],
    }));
    expect(activity.get("kairo")).toBe(Date.parse(at(12)));
    expect(activity.get("asset")).toBe(Date.parse(at(13)));
    expect(activity.get("prima")).toBe(Date.parse(at(14)));
  });

  it("Your projects on the Dashboard puts PrimaBook on top: its release is the newest activity", () => {
    expect(yourProjects(projects, latestActivity(rec)).map((p) => p.name)).toEqual(["PrimaBook", "Asset Market", "Kairo"]);
    // without the activity: by the projects' own update
    expect(yourProjects(projects).map((p) => p.name)).toEqual(["Asset Market", "Kairo", "PrimaBook"]);
    expect(byRecent(projects, latestActivity(rec))[0]!.id).toBe("prima");
  });

  it("Live now falls back to the project on top of the list", () => {
    expect(liveNow(projects, [], latestActivity(rec))!.project.id).toBe("prima");
  });

  it("the Projects page and the switcher order their own project rows the same way, the open project pinned first", () => {
    const rows = projects.map((p) => ({ id: p.id, name: p.name, clientName: "", status: "active" as const, lastUpdatedDate: p.updatedAt, createdDate: p.createdAt }));
    const activity = latestActivity(rec);
    expect(projectsByActivity(rows, activity).map((p) => p.id)).toEqual(["prima", "asset", "kairo"]);
    expect(switcherProjects(projectsByActivity(rows, activity), "kairo", "").map((p) => p.id)).toEqual(["kairo", "prima", "asset"]);
    // no dashboard records yet: by the project's own update
    expect(projectsByActivity(rows, new Map()).map((p) => p.id)).toEqual(["asset", "kairo", "prima"]);
  });
});

describe("the activity feed and what waits for you", () => {
  it("lists the latest events newest first", () => {
    const feed = recentActivity(records({ projects, releases })).filter((e) => e.kind === "release");
    expect(feed.map((e) => e.at)).toEqual([...feed.map((e) => e.at)].sort().reverse());
    expect(feed[0]!.project).toBe("PrimaBook");
  });

  it("keeps a decision first, and within one kind puts the newest change request first", () => {
    const wait = (kind: ChangeWait["kind"], number: number) => ({ kind, number, changeRequestId: `c${number}`, code: `CR-00${number}`, count: 1 }) as ChangeWait;
    expect(sortChangeWaits([wait("startBuild", 2), wait("approve", 1), wait("startBuild", 5), wait("approve", 4)]).map((w) => `${w.kind}:${w.number}`))
      .toEqual(["approve:4", "approve:1", "startBuild:5", "startBuild:2"]);
  });
});
