// Nothing of a deleted project shows as live work: the Dashboard's records (Dashboard, Home, Projects, the switcher's
// waiting dots, the leave guard), Home's records and the notification bell keep only live projects and their rows.
import { describe, expect, it } from "vitest";
import { kpis, liveDashboardRecords, recentActivity, releaseRows, type DashboardRecords, type DashProject } from "../../src/domain/dashboard";
import { projectsNow, waitingCount, waitingForYou } from "../../src/domain/projectNow";
import { liveHomeRecords } from "../../src/components/home/useMyProject";
import { bellItemOf, liveBell } from "../../src/blocks/workspaces/bell";

const ME = "u-owner";
const ALL = ["build.run", "release.approve", "business.edit", "requirements.edit", "scope.lock", "comment"];
const project = (id: string, o: Partial<DashProject> = {}): DashProject => ({
  id, name: `Project ${id}`, clientName: "", stage: "sanitization", step: "sanitization", assigneeUserId: ME, createdByUserId: ME,
  updatedAt: "2026-11-09T10:00:00.000Z", createdAt: "2026-11-01T10:00:00.000Z", handedOverAt: "2026-11-02T10:00:00.000Z",
  sanitizedAt: "", confirmedAt: "", lockedAt: "", status: "active", ...o,
});

// p1 is live, p2 is being deleted (its purge has not run yet), p3 was deleted but rows of it were left
const RAW: DashboardRecords = {
  projects: [project("p1"), project("p2", { status: "deleting" })],
  jobs: ["p1", "p2", "p3"].map((projectId, i) => ({
    id: `j${i}`, projectId, kind: "setup.assist" as const, status: "failed" as const, progress: 0, requestedByUserId: ME,
    createdAt: "2026-11-09T10:00:00.000Z", finishedAt: "2026-11-09T10:05:00.000Z", errorCode: "x",
  })),
  releases: ["p1", "p2", "p3"].map((projectId) => ({ projectId, env: "dev" as const, version: "1.0.0", status: "released", releasedAt: "2026-11-09T10:00:00.000Z" })),
  approvals: ["p1", "p2", "p3"].map((projectId, i) => ({
    id: `a${i}`, projectId, label: "Release", stepType: "approval", required: true, approverUserIds: [ME], requestId: `r${i}`, requestedByUserId: "u-other",
  })),
  clarifications: ["p1", "p2", "p2", "p3"].map((projectId, i) => ({ id: `c${i}`, projectId, number: i + 1, question: "?", ownerUserId: ME })),
  tickets: ["p1", "p2", "p3"].map((projectId, i) => ({ id: `t${i}`, projectId, title: "Task", doneAt: "2026-11-09T10:00:00.000Z" })),
  changes: ["p1", "p2", "p3"].map((projectId, i) => ({ id: `cr${i}`, projectId, number: i + 1, title: "Change", status: "review", createdAt: "2026-11-09T10:00:00.000Z" })),
  milestones: ["p1", "p2", "p3"].map((projectId, i) => ({ id: `m${i}`, projectId, name: "M1", status: "preview-ready" })),
  openChanges: ["p1", "p2", "p3"].map((projectId, i) => ({
    id: `oc${i}`, projectId, number: i + 1, lane: "change", status: "review", analysis: null, decidedAt: null, createdByUserId: "u-other",
  })),
  policyApprovers: { p1: [ME], p2: [ME], p3: [ME] },
};

describe("the dashboard's records keep only live projects", () => {
  const live = liveDashboardRecords(RAW);

  it("drops a project being deleted and every row of a project that is not listed", () => {
    expect(live.projects.map((p) => p.id)).toEqual(["p1"]);
    for (const key of ["jobs", "releases", "approvals", "clarifications", "tickets", "changes", "milestones", "openChanges"] as const) {
      expect((live[key] ?? []).map((r: { projectId: string }) => r.projectId), key).toEqual(["p1"]);
    }
    expect(live.policyApprovers).toEqual({ p1: [ME] });
  });

  it("puts nothing of a deleted project in Waiting for you, the counts, the activity or the releases", () => {
    const now = projectsNow(live, ME, ALL, { activeMemberIds: [ME] });
    expect([...now.keys()]).toEqual(["p1"]);
    const items = waitingForYou(now);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((w) => w.projectId === "p1")).toBe(true);
    expect(kpis(live)).toMatchObject({ projects: 1, released: 1 });
    expect(recentActivity(live).every((a) => a.projectId === "p1")).toBe(true);
    expect(releaseRows(live.projects, live.releases).map((r) => r.projectId)).toEqual(["p1"]);
  });

  it("projectsNow itself never lists a project being deleted, even from unfiltered records", () => {
    const now = projectsNow(RAW, ME, ALL, { activeMemberIds: [ME] });
    expect(now.has("p2")).toBe(false);
    expect(waitingForYou(now).some((w) => w.projectId === "p2")).toBe(false);
    // what waits on the live project is the same either way
    expect(waitingCount(waitingForYou(now))).toBe(waitingCount(waitingForYou(projectsNow(live, ME, ALL, { activeMemberIds: [ME] }))));
  });

  it("keeps a workspace with nothing deleted as it is", () => {
    const clean: DashboardRecords = { ...RAW, projects: [project("p1")], jobs: RAW.jobs.slice(0, 1), releases: RAW.releases.slice(0, 1) };
    const out = liveDashboardRecords(clean);
    expect(out.projects).toEqual(clean.projects);
    expect(out.jobs).toEqual(clean.jobs);
  });
});

describe("Home's records keep only live projects", () => {
  it("drops a project being deleted and the jobs of a project that is not listed", () => {
    const { projects, jobs } = liveHomeRecords(
      [{ ItemId: "p1", Name: "One", Stage: "build", Status: "active" }, { ItemId: "p2", Name: "Two", Stage: "build", Status: "deleting" }, { ItemId: "p4", Name: "Four", Stage: "build" }],
      ["p1", "p2", "p3", "p4"].map((ProjectId, i) => ({ ItemId: `j${i}`, ProjectId, Kind: "build.run", Status: "running", Progress: 10, CreatedDate: "2026-11-09T10:00:00.000Z" })),
    );
    expect(projects.map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(jobs.map((j) => j.projectId)).toEqual(["p1", "p4"]);
  });
});

describe("the notification bell", () => {
  const items = [
    bellItemOf({ ItemId: "n1", Kind: "scope.ready", ProjectId: "p1", IsRead: false, CreatedDate: "2026-11-09T10:00:00.000Z" }),
    bellItemOf({ ItemId: "n2", Kind: "requirements.ready", ProjectId: "p2", IsRead: false, CreatedDate: "2026-11-09T09:00:00.000Z" }),
    bellItemOf({ ItemId: "n3", Kind: "job.failed", ProjectId: "p2", IsRead: true, CreatedDate: "2026-11-09T08:00:00.000Z" }),
    bellItemOf({ ItemId: "n4", Kind: "invited", IsRead: false, CreatedDate: "2026-11-09T07:00:00.000Z" }),
  ];

  it("hides the notifications of a project being deleted, and the unread number agrees with the list", () => {
    const out = liveBell(items, 3, new Set(["p2"]));
    expect(out.items.map((i) => i.id)).toEqual(["n1", "n4"]);
    expect(out.unreadCount).toBe(2);
  });

  it("shows everything when no project is being deleted", () => {
    const out = liveBell(items, 3, new Set());
    expect(out.items.map((i) => i.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(out.unreadCount).toBe(3);
    expect(items[0]!.projectId).toBe("p1");
    expect(items[3]!.projectId).toBeNull();
  });

  it("counts the unread ones it shows when the server's number is missing", () => {
    expect(liveBell(items, null, new Set(["p2"])).unreadCount).toBe(2);
  });
});
