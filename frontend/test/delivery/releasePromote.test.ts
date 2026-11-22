// release.promote (the Release step's "Release vX to Staging / Production") on the delivery test ports: the promotion
// records the release and queues its deployment for the MADP engine, once; the engine gives the row its address.
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { releasePromoteOp } from "../../functions/delivery/ops/releases/releasePromote";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { stepKeyFor } from "../../src/domain/delivery";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
const STEPS = [
  { type: "architect", required: true, approvers: [FX.owner], decision: "approved" },
  { type: "security", required: true, approvers: [FX.customWith], decision: "approved" },
] as const;

/** Version `version` on dev, a stage policy and an approved request for it. */
function ready(version = "1.0.0"): FakeWorld {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: version, Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const policy = w.seed("ApprovalPolicy", { ProjectId: FX.project, Environment: "stage", Status: "active", ...stamps });
  STEPS.forEach((s, i) => w.seed("ApprovalStep", {
    ProjectId: FX.project, ParentType: "policy", ParentId: policy.ItemId, StepKey: stepKeyFor(i, s.type), StepType: s.type, Label: "",
    Required: s.required, ApproverUserIds: [...s.approvers], SortOrder: i, ...stamps,
  }));
  const req = w.seed("ApprovalRequest", {
    ProjectId: FX.project, PolicyId: policy.ItemId, Environment: "stage", Version: version, Attempt: 1, Status: "approved",
    RequestedByUserId: FX.member, RequestedAt: FX.now, ...stamps,
  });
  STEPS.forEach((s, i) => w.seed("ApprovalStep", {
    ProjectId: FX.project, ParentType: "request", ParentId: req.ItemId, StepKey: stepKeyFor(i, s.type), StepType: s.type, Label: "",
    Required: s.required, ApproverUserIds: [...s.approvers], Decision: s.decision, DecidedByUserId: s.approvers[0], Comment: "", SortOrder: i, ...stamps,
  }));
  w.as(FX.owner);
  return w;
}

const promote = (w: FakeWorld, requestId: string, version = "1.0.0") =>
  runOp(w.ports, { op: "release.promote", requestId }, releasePromoteOp, { projectId: FX.project, environment: "stage", version });

describe("release.promote", () => {
  it("records the release without an address and queues its deployment for the engine", async () => {
    const w = ready();
    const res = await promote(w, "r1");
    expect(res.ok).toBe(true);
    const rel = w.rows("Release").find((r) => r.Environment === "stage" && r.Version === "1.0.0")!;
    expect(rel).toMatchObject({ Status: "released", Url: "" });
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ kind: "preview.deploy", input: { projectId: FX.project, environment: "stage", version: "1.0.0", releaseId: rel.ItemId } });
  });

  it("a second promotion of the same version deploys it once", async () => {
    const w = ready();
    expect((await promote(w, "r1")).ok).toBe(true);
    const again = await promote(w, "r2");
    expect(again.ok).toBe(true);
    expect(again.ok && (again.data as { existing: boolean }).existing).toBe(true);
    expect(w.rows("EngineJob").filter((j) => j.Kind === "preview.deploy")).toHaveLength(1);
  });
});
