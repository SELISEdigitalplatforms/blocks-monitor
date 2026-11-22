// Four-eyes with the one-person fallback: the person who asked for a promotion approves it only when no other active
// approver of that step exists in the workspace (a recorded self-approval); while someone else can approve it, they
// must. The rule is the same in approvalRequest.decide, release.promote, the Release step and the dashboard count.
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { approvalRequestDecideOp } from "../../functions/delivery/ops/approvals/requestDecide";
import { releasePromoteOp } from "../../functions/delivery/ops/releases/releasePromote";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { environmentStates, stepKeyFor } from "../../src/domain/delivery";
import { decideRight, decisionCounts, type ApprovalRequest } from "../../src/domain/promotion";
import { releaseStep, type StepRelease, type StepRequest } from "../../src/components/delivery/releaseStep";
import { needsAttention, type DashApproval, type DashboardRecords } from "../../src/domain/dashboard";
import { projectsNow } from "../../src/domain/projectNow";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };

/** v1.0.0 on dev, a stage policy (architect + security) and a pending request for it, asked by `requester`. */
function world(o: { approvers: { architect: string[]; security: string[] }; requester: string; decided?: { architect?: string; security?: string } }): { w: FakeWorld; requestId: string } {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const steps = [
    { type: "architect" as const, approvers: o.approvers.architect, decidedBy: o.decided?.architect },
    { type: "security" as const, approvers: o.approvers.security, decidedBy: o.decided?.security },
  ];
  const policy = w.seed("ApprovalPolicy", { ProjectId: FX.project, Environment: "stage", Status: "active", ...stamps });
  steps.forEach((s, i) => w.seed("ApprovalStep", {
    ProjectId: FX.project, ParentType: "policy", ParentId: policy.ItemId, StepKey: stepKeyFor(i, s.type), StepType: s.type, Label: "",
    Required: true, ApproverUserIds: [...s.approvers], SortOrder: i, ...stamps,
  }));
  const allDecided = steps.every((s) => s.decidedBy);
  const req = w.seed("ApprovalRequest", {
    ProjectId: FX.project, PolicyId: policy.ItemId, Environment: "stage", Version: "1.0.0", Attempt: 1, Status: allDecided ? "approved" : "pending",
    RequestedByUserId: o.requester, RequestedAt: FX.now, ...stamps,
  });
  steps.forEach((s, i) => w.seed("ApprovalStep", {
    ProjectId: FX.project, ParentType: "request", ParentId: req.ItemId, StepKey: stepKeyFor(i, s.type), StepType: s.type, Label: "",
    Required: true, ApproverUserIds: [...s.approvers], Decision: s.decidedBy ? "approved" : "pending", DecidedByUserId: s.decidedBy ?? "", Comment: "", SortOrder: i, ...stamps,
  }));
  return { w, requestId: String(req.ItemId) };
}

const decide = (w: FakeWorld, approvalRequestId: string, stepIndex: number, requestId = `d${stepIndex}`) =>
  runOp(w.ports, { op: "approvalRequest.decide", requestId }, approvalRequestDecideOp, { projectId: FX.project, approvalRequestId, stepIndex, decision: "approved" });
const promote = (w: FakeWorld) =>
  runOp(w.ports, { op: "release.promote", requestId: "p1" }, releasePromoteOp, { projectId: FX.project, environment: "stage", version: "1.0.0" });

describe("approvalRequest.decide: four-eyes with the one-person fallback", () => {
  it("the requester is the only approver: they approve it themselves, and the audit says it was a self-approval", async () => {
    const { w, requestId } = world({ approvers: { architect: [FX.owner], security: [FX.owner] }, requester: FX.owner });
    w.as(FX.owner);
    const a = await decide(w, requestId, 0);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(a.ok && (a.data as { selfApproval: boolean; status: string })).toMatchObject({ selfApproval: true, status: "pending" });
    const b = await decide(w, requestId, 1);
    expect(b.ok && (b.data as { status: string }).status).toBe("approved");
    const audits = w.audits.filter((x) => x.action === "approvalRequest.decide");
    expect(audits).toHaveLength(2);
    for (const x of audits) expect(x.details).toMatchObject({ selfApproval: true, reason: "only approver" });
    expect(w.rows("ApprovalRequest").find((r) => r.ItemId === requestId)!.Status).toBe("approved");
    // and the promotion counts those approvals
    const p = await promote(w);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(w.audits.find((x) => x.action === "release.promote")!.details).toMatchObject({ selfApprovals: 2 });
  });

  it("another active approver exists: the requester is refused (ownRequest) and the other approver decides", async () => {
    const { w, requestId } = world({ approvers: { architect: [FX.owner, FX.customWith], security: [FX.owner] }, requester: FX.owner });
    w.as(FX.owner);
    const own = await decide(w, requestId, 0);
    expect(own.ok).toBe(false);
    expect(!own.ok && own.error).toMatchObject({ code: "forbidden", messageKey: "delivery.approvals.ownRequest" });
    // the security step has no one else: the requester may approve that one
    const sec = await decide(w, requestId, 1);
    expect(sec.ok, JSON.stringify(sec)).toBe(true);
    w.as(FX.customWith);
    const other = await decide(w, requestId, 0, "d0b");
    expect(other.ok, JSON.stringify(other)).toBe(true);
    expect(other.ok && (other.data as { selfApproval: boolean; status: string })).toMatchObject({ selfApproval: false, status: "approved" });
  });

  it("release.promote does not count a self-approval while another approver of that step exists", async () => {
    const { w } = world({ approvers: { architect: [FX.owner, FX.customWith], security: [FX.owner] }, requester: FX.owner, decided: { architect: FX.owner, security: FX.owner } });
    w.as(FX.owner);
    const p = await promote(w);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.error).toMatchObject({ code: "approval_required", messageKey: "delivery.approvals.ownRequest" });
  });
});

describe("the rule (domain)", () => {
  const req = (approvers: string[][]): ApprovalRequest => ({
    environment: "stage", version: "1.0.0", status: "pending",
    steps: approvers.map((a, i) => ({ type: i ? "security" : "architect", approverUserIds: a, decision: "pending", decidedBy: null, decidedAt: null, comment: null })),
  });
  it("decideRight", () => {
    const members = ["u-a", "u-b"];
    expect(decideRight(req([["u-a"]]), 0, "u-a", { requesterId: "u-a", activeMemberIds: members })).toEqual({ ok: true, self: true });
    expect(decideRight(req([["u-a", "u-b"]]), 0, "u-a", { requesterId: "u-a", activeMemberIds: members })).toEqual({ ok: false, reason: "ownRequest", others: ["u-b"] });
    // the other approver left the workspace: the requester is the only one left
    expect(decideRight(req([["u-a", "u-c"]]), 0, "u-a", { requesterId: "u-a", activeMemberIds: members })).toEqual({ ok: true, self: true });
    expect(decideRight(req([["u-a", "u-b"]]), 0, "u-b", { requesterId: "u-a", activeMemberIds: members })).toEqual({ ok: true, self: false });
    expect(decideRight(req([["u-a"]]), 0, "u-b", { requesterId: "u-a", activeMemberIds: members })).toMatchObject({ ok: false, reason: "notApprover" });
  });
  it("decisionCounts", () => {
    expect(decisionCounts({ approverUserIds: ["u-a"], decidedBy: "u-a", decision: "approved" }, "u-a", ["u-a"])).toBe(true);
    expect(decisionCounts({ approverUserIds: ["u-a", "u-b"], decidedBy: "u-a", decision: "approved" }, "u-a", ["u-a", "u-b"])).toBe(false);
    expect(decisionCounts({ approverUserIds: ["u-a", "u-b"], decidedBy: "u-b", decision: "approved" }, "u-a", ["u-a", "u-b"])).toBe(true);
  });
});

describe("the Release step and the dashboard follow the same rule", () => {
  const rel = (environment: string, version: string): StepRelease => ({ id: `${environment}-${version}`, environment, version, releasedAt: "2026-10-31T10:00:00Z", url: "", releasedByUserId: "u-a", changeRequestIds: [] });
  const states = () => environmentStates([rel("dev", "1.0.0")]);
  const stepRequest = (approvers: string[][], requester: string, required = [true, true, false]): StepRequest => ({
    id: "req-1", environment: "stage", version: "1.0.0", status: "pending", attempt: 1, requestedByUserId: requester, stepRequired: required,
    request: {
      environment: "stage", version: "1.0.0", status: "pending",
      steps: approvers.map((a, i) => ({ type: (["architect", "security", "qa"] as const)[i]!, approverUserIds: a, decision: "pending" as const, decidedBy: null, decidedAt: null, comment: null })),
    },
  });
  const policies = [{ id: "pol", environment: "stage" as const, policy: { environment: "stage" as const, steps: [
    { type: "architect" as const, required: true, approverUserIds: ["u-a"] }, { type: "security" as const, required: true, approverUserIds: ["u-a"] }, { type: "qa" as const, required: false, approverUserIds: ["u-a"] },
  ] } }];
  const NAMES: Record<string, string> = { "u-a": "Mara Keller", "u-b": "Florian Weber" };
  const run = (r: StepRequest, me: string, members: string[]) => releaseStep({
    states: states(), requests: [r], policies, changes: [], userId: me, activeMemberIds: members,
    can: { approve: true, promote: true, request: true }, nameOf: (id) => NAMES[id] ?? id,
  });

  it("the only approver approves their own request: one click, every step, and the page says why", () => {
    const s = run(stepRequest([["u-a"], ["u-a"], ["u-a"]], "u-a"), "u-a", ["u-a"]);
    expect(s.phase).toBe("approve");
    expect(s.selfApproval).toBe(true);
    // the optional QA step first, so the request settles on the last required one
    expect(s.mySteps).toEqual([2, 0, 1]);
    expect(s.primary).toMatchObject({ kind: "approve", label: "Approve v1.0.0 for Staging", reason: "You're the only approver, so you can approve this yourself." });
  });

  it("someone else can approve it: no approve button for the requester, and it says who must approve", () => {
    const s = run(stepRequest([["u-a", "u-b"], ["u-b"]], "u-a", [true, true]), "u-a", ["u-a", "u-b"]);
    expect(s.phase).toBe("waiting");
    expect(s.mySteps).toEqual([]);
    expect(s.primary).toMatchObject({ kind: "wait", disabled: true, reason: "You asked for this release, so Florian Weber must approve it." });
    expect(s.mustApprove).toEqual(["Florian Weber"]);
  });

  it("the dashboard counts one request with three steps as one release waiting for you", () => {
    const step = (id: string, label: string): DashApproval => ({ id, projectId: "p1", label, stepType: label.toLowerCase(), required: true, approverUserIds: ["u-a"], requestId: "req-1", requestedByUserId: "u-a" });
    const records: DashboardRecords = {
      projects: [{ id: "p1", name: "Asset Market", clientName: "", stage: "release", step: "release", assigneeUserId: "", createdByUserId: "u-a", updatedAt: "", createdAt: "", handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "", approverUserId: "", repoMode: "" }],
      jobs: [], releases: [], clarifications: [], tickets: [], changes: [],
      approvals: [step("s1", "Architect"), step("s2", "Security"), step("s3", "QA tester")],
    } as unknown as DashboardRecords;
    const now = projectsNow(records, "u-a", ["release.approve"]).get("p1")!;
    expect(now.waiting.filter((x) => x.kind === "release").map((x) => x.text)).toEqual(["Release waiting for your approval"]);
    expect(needsAttention(records, "u-a", ["release.approve"]).filter((x) => x.kind === "approval")).toHaveLength(1);
    // asked by me while Florian can approve: not mine to approve
    const withOther = { ...records, approvals: records.approvals.map((a) => ({ ...a, approverUserIds: ["u-a", "u-b"] })) };
    expect(projectsNow(withOther, "u-a", ["release.approve"]).get("p1")!.waiting.filter((x) => x.kind === "release")).toHaveLength(0);
  });
});
