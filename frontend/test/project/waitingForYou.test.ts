// "Waiting for you" on the Dashboard, the project cards and Projects (src/domain/projectNow.ts) counts what change
// requests wait for from the person with the Team panel's own rule (src/components/team/changeWaiting.ts), from the
// dashboard's rows: the open change requests with their analysis, the jobs' InputJson facts and the policies' approvers.
import { describe, expect, it } from "vitest";
import type { DashboardRecords, DashJob, DashOpenChange, DashProject } from "../../src/domain/dashboard";
import { jobInputFacts, policyApproversOf } from "../../src/domain/dashboard";
import { projectsNow, waitingCount, waitingForYou } from "../../src/domain/projectNow";
import { analystThread, leadThread } from "../../src/components/team/teamMessages";
import { changeRightFor } from "../../src/components/changes/changeDecide";
import type { DeliveryChangeRequest, PolicyRecord } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, OTHER, OWNER, answered } from "../changes/fixtures";

const ALL = ["build.run", "release.approve", "business.edit", "requirements.edit", "scope.lock", "comment"];
const approvedAnalysis = JSON.stringify(answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }));

const project = (o: Partial<DashProject> = {}): DashProject => ({
  id: "p1", name: "PrimaBook", clientName: "", stage: "release", step: "release", assigneeUserId: OWNER, createdByUserId: OWNER,
  updatedAt: "2026-11-08T10:00:00.000Z", handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "", repoMode: "existing", ...o,
});
const change = (o: Partial<DashOpenChange> & Pick<DashOpenChange, "id" | "number" | "status">): DashOpenChange => ({
  projectId: "p1", lane: "change", analysis: approvedAnalysis, decidedAt: null, createdByUserId: OWNER, ...o,
});
const dashJob = (o: Partial<DashJob> & Pick<DashJob, "id" | "kind" | "status">, inputJson = ""): DashJob => ({
  projectId: "p1", progress: 0, requestedByUserId: OWNER, createdAt: "2026-11-07T22:26:00.000Z", finishedAt: "", errorCode: "",
  ...jobInputFacts(o.kind, inputJson), ...o,
});
const records = (o: Partial<DashboardRecords> = {}): DashboardRecords => ({
  projects: [project()], jobs: [], releases: [], approvals: [], clarifications: [], tickets: [], changes: [], milestones: [],
  openChanges: [], policyApprovers: {}, ...o,
});
const team = { activeMemberIds: [OWNER] };
const decided = "2026-11-07T22:26:00.000Z";

// the live product of the audit: CR-005 waits for approval, CR-006's build was cancelled, CR-007 has two questions
const LIVE = records({
  openChanges: [
    change({ id: "c5", number: 5, status: "review" }),
    change({ id: "c6", number: 6, status: "building", decidedAt: decided }),
    change({ id: "c7", number: 7, status: "questions", analysis: JSON.stringify(ANALYSIS) }),
  ],
  jobs: [
    dashJob({ id: "b6", kind: "change.build", status: "cancelled" }, JSON.stringify({ changeRequestId: "c6" })),
    dashJob({ id: "a7", kind: "change.analyse", status: "succeeded" }, JSON.stringify({ changeRequestId: "c7" })),
  ],
});

describe("change requests count in Waiting for you", () => {
  it("lists every change request waiting for you, decisions first, each opening its change request", () => {
    const now = projectsNow(LIVE, OWNER, ALL, team).get("p1")!;
    expect(now.waiting.map((w) => [w.text, w.action, w.to])).toEqual([
      ["CR-005 is waiting for your approval", "Review", "/p/p1/build?cr=5"],
      ["CR-007: 2 questions from your business analyst", "Answer", "/p/p1/build?cr=7"],
      ["The build of CR-006 stopped. It can start again", "Open", "/p/p1/build?cr=6"],
    ]);
    // the number counts things to do: each question, each approval, each build to start
    expect(waitingCount(waitingForYou(projectsNow(LIVE, OWNER, ALL, team)))).toBe(4);
  });

  it("is the same number the Team panel shows for the same rows", () => {
    const toCr = (c: DashOpenChange): DeliveryChangeRequest => ({
      id: c.id, number: c.number, lane: "change", featureRef: "", title: `Change ${c.number}`, description: "x", status: c.status as DeliveryChangeRequest["status"],
      version: null, createdByUserId: c.createdByUserId, createdByName: "", analysis: c.analysis, analysedAt: null, decidedAt: c.decidedAt,
      decidedByUserId: c.decidedAt ? OWNER : null, decisionNote: null, selfApproved: false,
    });
    const toJob = (j: DashJob): EngineJob => ({
      id: j.id, workspaceId: "w", projectId: j.projectId, kind: j.kind, status: j.status, inputJson: JSON.stringify({ changeRequestId: j.changeRequestId }),
      outputRefs: [], progress: 0, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: null, finishedAt: null,
      createdBy: OWNER, createdAt: j.createdAt, updatedAt: null,
    });
    const changes = (LIVE.openChanges ?? []).map(toCr);
    const jobs = LIVE.jobs.map(toJob);
    const policies: PolicyRecord[] = [];
    const rightOf = (cr: { createdByUserId: string | null }) => changeRightFor({ userId: OWNER, requesterId: cr.createdByUserId, policies, activeMemberIds: team.activeMemberIds, canApprove: true });
    const base = { projectId: "p1", changes, jobs, meId: OWNER, nameOf: () => "Mira Keller", canRun: true };
    const panel = analystThread({ ...base, rightOf, hasDev: true }).needsYou + leadThread({ ...base, milestones: [], previews: [] }).needsYou;
    expect(waitingCount(projectsNow(LIVE, OWNER, ALL, team).get("p1")!.waiting)).toBe(panel);
  });

  it("asks for the approval only of the approver the policies name (four eyes)", () => {
    const withPolicy = { ...LIVE, policyApprovers: { p1: [OTHER] } };
    const both = { activeMemberIds: [OWNER, OTHER] };
    const mine = projectsNow(withPolicy, OWNER, ALL, both).get("p1")!.waiting.map((w) => w.text);
    expect(mine).not.toContain("CR-005 is waiting for your approval");
    const theirs = projectsNow(withPolicy, OTHER, ALL, both).get("p1")!.waiting.map((w) => w.text);
    expect(theirs).toContain("CR-005 is waiting for your approval");
    // a role without release.approve is never asked
    expect(projectsNow(withPolicy, OTHER, ALL.filter((p) => p !== "release.approve"), both).get("p1")!.waiting.map((w) => w.text))
      .not.toContain("CR-005 is waiting for your approval");
  });

  it("asks a role that can't run builds nothing about answers or builds", () => {
    const now = projectsNow(LIVE, OWNER, ["release.approve"], team).get("p1")!;
    expect(now.waiting.map((w) => w.text)).toEqual(["CR-005 is waiting for your approval"]);
  });

  it("says a stopped change build once, through its change request, not again as a job to retry", () => {
    const failed = records({
      openChanges: [change({ id: "c6", number: 6, status: "building", decidedAt: decided })],
      jobs: [dashJob({ id: "b6", kind: "change.build", status: "failed" }, JSON.stringify({ changeRequestId: "c6" }))],
    });
    const waiting = projectsNow(failed, OWNER, ALL, team).get("p1")!.waiting;
    expect(waiting.map((w) => w.kind)).toEqual(["change"]);
    expect(waiting[0]!.text).toBe("The build of CR-006 stopped. It can start again");
  });

  it("waits for nothing on a paused or stopped project", () => {
    for (const stage of ["paused", "abandoned"]) {
      expect(projectsNow({ ...LIVE, projects: [project({ stage })] }, OWNER, ALL, team).get("p1")!.waiting).toEqual([]);
    }
  });

  it("counts the analyst's project questions one by one too", () => {
    const r = records({ clarifications: [
      { id: "q1", projectId: "p1", number: 1, question: "a?", ownerUserId: OWNER },
      { id: "q2", projectId: "p1", number: 2, question: "b?", ownerUserId: OWNER },
    ] });
    const items = waitingForYou(projectsNow(r, OWNER, ALL, team));
    expect(items).toHaveLength(1);
    expect(waitingCount(items)).toBe(2);
  });
});

describe("the dashboard's rows for the rule", () => {
  it("reads the change request, a release deploy and an after-deploy run from InputJson", () => {
    expect(jobInputFacts("change.build", JSON.stringify({ changeRequestId: "c6" }))).toEqual({ changeRequestId: "c6" });
    expect(jobInputFacts("change.build", JSON.stringify({ changeRequestId: "c6", afterDeploy: true }))).toEqual({ changeRequestId: "c6", afterDeploy: true });
    expect(jobInputFacts("preview.deploy", JSON.stringify({ environment: "stage" }))).toEqual({ releaseDeploy: true });
    expect(jobInputFacts("preview.deploy", JSON.stringify({ milestoneId: "m1" }))).toEqual({ releaseDeploy: false });
    expect(jobInputFacts("build.run", "not json")).toEqual({});
  });

  it("names each project's policy approvers from the policies and their steps", () => {
    expect(policyApproversOf(
      [{ ItemId: "pol-s", ProjectId: "p1" }, { ItemId: "pol-p", ProjectId: "p1" }, { ItemId: "pol-x", ProjectId: "p2" }],
      [
        { ParentId: "pol-s", ApproverUserIds: [OWNER, OTHER] },
        { ParentId: "pol-p", ApproverUserIds: [OTHER] },
        { ParentId: "pol-gone", ApproverUserIds: ["u-x"] },
      ],
    )).toEqual({ p1: [OWNER, OTHER] });
  });
});
