// A start action must really start. Every delivery op that queues engine work asks for its job under a dedupe key; a key
// that names a job which already FINISHED (one that collided with an earlier build's, or a count read before that
// build was visible) answered that finished job, and the op reported a start, and set the change request to
// "building", while nothing ran (05.11: "Build increment 2 of 4" showed the team building, no job existed). Now every
// start goes through common.ts startEngineJob: a finished job under the key is never answered; a new job is queued
// under a key derived from it, or, after MAX_FINISHED_KEYS finished jobs in a row, the start fails in plain words.
// Plus build.retryAfterDeploy ("Finish the steps after the deploy"). On the delivery test ports.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/startReallyStarts.test.ts
import { describe, expect, it, vi } from "vitest";
import { createJobs } from "../../functions/_lib/jobs";
import { MAX_FINISHED_KEYS, runOp, startEngineJob } from "../../functions/delivery/ops/common";
import { buildStartOp } from "../../functions/delivery/ops/build/buildStart";
import { milestoneAcceptOp } from "../../functions/delivery/ops/build/milestoneAccept";
import { milestoneFeedbackOp } from "../../functions/delivery/ops/build/milestoneFeedback";
import { buildRetryAfterDeployOp } from "../../functions/delivery/ops/build/retryAfterDeploy";
import { ticketCommentOp } from "../../functions/delivery/ops/board/ticketComment";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { crSubmitOp } from "../../functions/delivery/ops/changes/crSubmit";
import { releasePromoteOp } from "../../functions/delivery/ops/releases/releasePromote";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import type { DeliveryPorts } from "../../functions/delivery/ops/ports";
import { stepKeyFor } from "../../src/domain/delivery";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { NOT_STARTED_MESSAGE, notStartedProblem } from "@/blocks/delivery/actions";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
const ACTIVE = ["queued", "claimed", "running"];

type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : ({} as Record<string, any>));
const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-1`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });
const jobRow = (w: FakeWorld, id: string) => w.rows("EngineJob").find((r) => r.ItemId === id);

/** The next job any op asks for: its key already names a job that ended with `status` (and that the op's reads did not
 *  see). Answers the finished job's id once it is made. */
function keyNamesFinishedJob(w: FakeWorld, status: "succeeded" | "failed" | "cancelled" = "succeeded"): { id: () => string; key: () => string } {
  const real = w.ports.createEngineJob;
  let stale = "";
  let key = "";
  w.ports.createEngineJob = async (job) => {
    if (!stale) {
      key = job.dedupeKey;
      stale = w.staleJobKey(job.dedupeKey, status);
    }
    return real(job);
  };
  return { id: () => stale, key: () => key };
}

/** Every key any op asks for names a job that already finished. */
function everyKeyFinished(w: FakeWorld): void {
  const real = w.ports.createEngineJob;
  w.ports.createEngineJob = async (job) => {
    w.staleJobKey(job.dedupeKey, "succeeded");
    return real(job);
  };
}

/** The answer named a real job that works now (queued for the engine), never the finished one. */
function reallyStarted(w: FakeWorld, jobId: string, stale: { id: () => string; key: () => string }): void {
  expect(stale.id()).not.toBe("");
  expect(jobId).not.toBe(stale.id());
  const row = jobRow(w, jobId);
  expect(row, "the answered job exists").toBeTruthy();
  expect(ACTIVE).toContain(row!.Status);
  // asked for again under the key derived from the finished job
  expect(w.jobKeys()).toContain(`${stale.key()}~${stale.id()}`);
}

// ------------------------------------------------------------------ worlds

/** Three milestones: 1 and 2 built with a ready preview (done tickets), 3 planned (one planned ticket). */
function milestones(statuses: string[] = ["preview-ready", "preview-ready", "planned"]) {
  const w = createFakeWorld();
  const ids = statuses.map((Status, i) => String(w.seed("Milestone", {
    ProjectId: FX.project, ScopeVersion: 1, Number: i + 1, Name: `M${i + 1}`, Goal: "", FeatureRefs: [], SortOrder: i + 1, PreviewPoint: "", Status, ...stamps,
  }).ItemId));
  const tickets = ids.map((id, i) => {
    if (statuses[i] !== "planned") {
      w.seed("Preview", { ProjectId: FX.project, MilestoneId: id, Environment: "dev", Version: `0.${i + 1}.0`, Url: `https://m${i + 1}-app.dev.client.ch`, Status: "ready", ReadyAt: FX.now, ...stamps });
    }
    return String(w.seed("Ticket", {
      ProjectId: FX.project, Number: i + 1, PlanRef: `plan:${i + 1}`, Title: `T${i + 1}`, TicketType: "story", FeatureRef: "", MilestoneId: id,
      AgentRole: "shipper", Column: statuses[i] === "planned" ? "planned" : "done", SortOrder: 0, Description: "", IsDone: statuses[i] !== "planned", Source: "plan", ...stamps,
    }).ItemId);
  });
  return { w, ids, tickets };
}

const ANALYSIS = serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "change", route: "fast", summary: "Show the delivery window.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: false, conflicts: [], risks: [], acceptanceCriteria: ["The list shows it"], tickets: [{ title: "Column", description: "Add it." }],
  estimate: { tickets: 1 }, questions: [],
})!);

/** v1.0.0 on dev and one change request. */
function change(cr: { Status: string; Analysis?: string; DecidedAt?: string; Version?: string }) {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const row = w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: 7, Lane: "change", FeatureRef: "", Title: "Delivery window", Description: "Show the delivery window on the order list.",
    Status: cr.Status, Version: cr.Version ?? "", RequestedByUserId: FX.owner,
    ...(cr.Analysis !== undefined ? { Analysis: cr.Analysis } : {}), ...(cr.DecidedAt !== undefined ? { DecidedAt: cr.DecidedAt } : {}), ...stamps,
  });
  return { w, crId: String(row.ItemId) };
}
const crRow = (w: FakeWorld, id: string) => w.rows("ChangeRequest").find((r) => r.ItemId === id)!;

// ------------------------------------------------------------------ the shared job creation (functions/_lib/jobs.ts)

describe("jobs.create answers the job a key names as it is stored now", () => {
  const service = (insert: unknown, get: unknown) => createJobs({
    // raw: no billing settings stored, so the paywall (functions/_lib/paywall.ts) is off.
    gw: { insert, get } as never, raw: { findAll: async () => [] } as never, ids: { job: (k?: string) => `job:${k}` } as never,
    caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date(FX.now), verifiedProjectId: "p1",
  });

  it("a key that names a finished job: its real status, never the queued row it would have written", async () => {
    const get = vi.fn().mockResolvedValue({ ItemId: "j-old", Kind: "change.build", Status: "succeeded", ActiveKey: "j-old", FinishedAt: FX.now });
    const jobs = service(vi.fn().mockResolvedValue({ created: false, itemId: "j-old" }), get);
    const made = await jobs.create({ kind: "change.build", projectId: "p1", input: { changeRequestId: "cr-1" }, eventKey: "change.build:cr-1:1" });
    expect(made.existing).toBe(true);
    expect(made.job).toMatchObject({ ItemId: "j-old", Status: "succeeded" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("a new job needs no read; a key whose job cannot be read yet is the one just written", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const fresh = service(vi.fn().mockResolvedValue({ created: true, itemId: "j-new" }), get);
    expect((await fresh.create({ kind: "build.run", projectId: "p1", input: {}, eventKey: "k" })).job).toMatchObject({ ItemId: "j-new", Status: "queued" });
    expect(get).not.toHaveBeenCalled();
    const justWritten = service(vi.fn().mockResolvedValue({ created: false, itemId: "j-new" }), get);
    expect((await justWritten.create({ kind: "build.run", projectId: "p1", input: {}, eventKey: "k" })).job).toMatchObject({ ItemId: "j-new", Status: "queued" });
  });
});

// ------------------------------------------------------------------ the shared start

describe("startEngineJob", () => {
  const spec = (): Parameters<DeliveryPorts["createEngineJob"]>[0] => ({
    workspaceId: FX.ws, projectId: FX.project, kind: "build.run", input: { projectId: FX.project, milestoneId: "m" }, dedupeKey: "build.run:k:1", createdByUserId: FX.owner,
  });

  it("a new job and a job that runs are answered as they are", async () => {
    const w = createFakeWorld();
    const first = await startEngineJob(w.ports, spec());
    expect(first).toMatchObject({ existing: false, status: "queued" });
    expect(await startEngineJob(w.ports, spec())).toEqual({ jobId: first.jobId, existing: true, status: "queued" });
    await w.ports.update("EngineJob", first.jobId, { Status: "running" });
    expect(await startEngineJob(w.ports, spec())).toEqual({ jobId: first.jobId, existing: true, status: "running" });
  });

  for (const status of ["succeeded", "failed", "cancelled"] as const) {
    it(`a ${status} job under the key is never answered: a new job is queued, and a replay gets that same new job`, async () => {
      const w = createFakeWorld();
      const stale = w.staleJobKey("build.run:k:1", status);
      const a = await startEngineJob(w.ports, spec());
      expect(a.existing).toBe(false);
      expect(a.jobId).not.toBe(stale);
      expect(jobRow(w, a.jobId)?.Status).toBe("queued");
      expect(w.jobKeys()).toEqual(["build.run:k:1", `build.run:k:1~${stale}`]);
      // the same request again: the same keys, the same new job, nothing more queued
      expect(await startEngineJob(w.ports, spec())).toEqual({ jobId: a.jobId, existing: true, status: "queued" });
      expect(w.jobs).toHaveLength(1);
    });
  }

  it("gives up in plain words after MAX_FINISHED_KEYS finished jobs in a row", async () => {
    const w = createFakeWorld();
    everyKeyFinished(w);
    await expect(startEngineJob(w.ports, spec())).rejects.toMatchObject({ code: "conflict", messageKey: "delivery.job.notStarted" });
    expect(w.jobs).toHaveLength(0);
    expect(w.jobKeys()).toHaveLength(MAX_FINISHED_KEYS + 1);
  });
});

// ------------------------------------------------------------------ every start op family

describe("build.start never answers a finished job", () => {
  it("the build of the next milestone", async () => {
    const { w, ids } = milestones();
    const stale = keyNamesFinishedJob(w);
    const res = await call(w, buildStartOp, "build.start", { milestoneId: ids[2] });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ kind: "build.run", existing: false, jobStatus: "queued" });
    reallyStarted(w, data(res).jobId, stale);
  });

  it("the new preview of a milestone that is built but not online", async () => {
    const { w, ids } = milestones(["building"]);
    const built = await call(w, buildStartOp, "build.start", { milestoneId: ids[0] }, "b-1");
    await w.ports.update("EngineJob", data(built).jobId, { Status: "succeeded" });
    const stale = keyNamesFinishedJob(w, "failed");
    const res = await call(w, buildStartOp, "build.start", { milestoneId: ids[0] }, "b-2");
    expect(data(res)).toMatchObject({ kind: "preview.deploy", existing: false, jobStatus: "queued" });
    reallyStarted(w, data(res).jobId, stale);
  });
});

describe("cr.startBuild never answers a finished job, and never leaves a change building without one", () => {
  it("the key of its next build names the earlier, finished build: a new job is queued and the change builds", async () => {
    const { w, crId } = change({ Status: "approved", Analysis: ANALYSIS, DecidedAt: FX.now });
    // the incident: the key the op computes is the one the previous, finished build has
    const finished = w.staleJobKey(`change.build:${crId}:1`, "succeeded");
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ existing: false, jobStatus: "queued", version: "1.1.0" });
    reallyStarted(w, data(res).jobId, { id: () => finished, key: () => `change.build:${crId}:1` });
    expect(crRow(w, crId).Status).toBe("building");
    expect(w.audits.some((a) => a.action === "cr.startBuild")).toBe(true);
  });

  it("when no new job can be made the start fails in plain words and the change is not set to building", async () => {
    const { w, crId } = change({ Status: "approved", Analysis: ANALYSIS, DecidedAt: FX.now });
    everyKeyFinished(w);
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(err(res)).toMatchObject({ code: "conflict", messageKey: "delivery.job.notStarted" });
    expect(crRow(w, crId).Status).toBe("approved");
    expect(w.audits.some((a) => a.action === "cr.startBuild")).toBe(false);
  });

  it("a change left at building with its newest build succeeded (a start that queued nothing) builds again", async () => {
    const { w, crId } = change({ Status: "approved", Analysis: ANALYSIS, DecidedAt: FX.now });
    const first = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "s-1");
    await w.ports.update("EngineJob", data(first).jobId, { Status: "succeeded" });
    expect(crRow(w, crId).Status).toBe("building");
    const again = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "s-2");
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(data(again).jobId).not.toBe(data(first).jobId);
    expect(jobRow(w, data(again).jobId)?.Status).toBe("queued");
  });
});

describe("the analysis of a change (cr.submit, cr.answer: change.analyse) never answers a finished job", () => {
  it("sent for analysis: a new analysis is queued", async () => {
    const { w, crId } = change({ Status: "draft" });
    const stale = keyNamesFinishedJob(w);
    const res = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ status: "analysing", existing: false });
    reallyStarted(w, data(res).jobId, stale);
    expect(jobRow(w, data(res).jobId)?.Kind).toBe("change.analyse");
  });
});

describe("feedback builds (milestone.feedback, ticket.comment) never answer a finished job", () => {
  it("feedback on a ready preview: the build of the milestone is queued", async () => {
    const { w, ids } = milestones();
    const stale = keyNamesFinishedJob(w);
    const res = await call(w, milestoneFeedbackOp, "milestone.feedback", { milestoneId: ids[0], text: "The list should show the delivery window." });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    reallyStarted(w, data(res).jobId, stale);
    expect(jobRow(w, data(res).jobId)).toMatchObject({ Kind: "build.run" });
  });

  it("a comment on a finished ticket of a ready preview: its fix is built", async () => {
    const { w, tickets } = milestones();
    const stale = keyNamesFinishedJob(w, "cancelled");
    const res = await call(w, ticketCommentOp, "ticket.comment", { ticketId: tickets[0], text: "The total should include the tax." });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res).fixTicketId).toBeTruthy();
    reallyStarted(w, data(res).jobId, stale);
  });
});

describe("milestone.accept: the first release to dev never answers a finished job", () => {
  it("the last milestone accepted: the release job is queued", async () => {
    const { w, ids } = milestones(["done", "preview-ready"]);
    const stale = keyNamesFinishedJob(w, "failed");
    const res = await call(w, milestoneAcceptOp, "milestone.accept", { milestoneId: ids[1] });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res).releaseJobId).toBeTruthy();
    reallyStarted(w, data(res).releaseJobId, stale);
  });
});

describe("release.promote: the deployment never answers a finished job", () => {
  it("a promotion to staging queues its deployment", async () => {
    const w = createFakeWorld();
    w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
    // the owner minimum: an architect and a security approval, both given
    const steps = [{ type: "architect", by: FX.owner }, { type: "security", by: FX.customWith }] as const;
    const policy = w.seed("ApprovalPolicy", { ProjectId: FX.project, Environment: "stage", Status: "active", ...stamps });
    steps.forEach((x, i) => w.seed("ApprovalStep", { ProjectId: FX.project, ParentType: "policy", ParentId: policy.ItemId, StepKey: stepKeyFor(i, x.type), StepType: x.type, Label: "", Required: true, ApproverUserIds: [x.by], SortOrder: i, ...stamps }));
    const req = w.seed("ApprovalRequest", { ProjectId: FX.project, PolicyId: policy.ItemId, Environment: "stage", Version: "1.0.0", Attempt: 1, Status: "approved", RequestedByUserId: FX.member, RequestedAt: FX.now, ...stamps });
    steps.forEach((x, i) => w.seed("ApprovalStep", { ProjectId: FX.project, ParentType: "request", ParentId: req.ItemId, StepKey: stepKeyFor(i, x.type), StepType: x.type, Label: "", Required: true, ApproverUserIds: [x.by], Decision: "approved", DecidedByUserId: x.by, Comment: "", SortOrder: i, ...stamps }));
    const stale = keyNamesFinishedJob(w, "failed");
    const res = await call(w, releasePromoteOp, "release.promote", { environment: "stage", version: "1.0.0" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const deploy = w.rows("EngineJob").find((j) => j.Kind === "preview.deploy");
    expect(deploy).toBeTruthy();
    reallyStarted(w, String(deploy!.ItemId), stale);
  });
});

describe("the web never shows a start that named finished work", () => {
  it("notStartedProblem: an answer whose job is not queued, claimed or running", () => {
    for (const s of ["queued", "claimed", "running"]) expect(notStartedProblem({ jobId: "j", jobStatus: s })).toBeNull();
    for (const s of ["succeeded", "failed", "cancelled"]) expect(notStartedProblem({ jobId: "j", existing: true, jobStatus: s })).toBe(NOT_STARTED_MESSAGE);
    // an answer without a job status (an older server, an op that started nothing) is taken as it is
    expect(notStartedProblem({ jobId: "j", existing: true })).toBeNull();
    expect(notStartedProblem(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ build.retryAfterDeploy

const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 9, m)).toISOString();
/** A finished delivery build as the engine leaves it. */
function delivered(w: FakeWorld, o: { kind: "change.build" | "build.run"; input: Record<string, unknown>; code: string; finishedAt: string; status?: string }): string {
  return String(w.seed("EngineJob", {
    ProjectId: FX.project, Kind: o.kind, Status: o.status ?? "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, ...o.input }),
    OutputRefs: [], Progress: 100, Message: "Released.", Attempts: 1, ErrorCode: o.code, FinishedAt: o.finishedAt, RequestedByUserId: FX.owner, ...stamps,
  } as never).ItemId);
}
const finish = (w: FakeWorld, jobId: string, requestId = "f-1") => call(w, buildRetryAfterDeployOp, "build.retryAfterDeploy", { jobId }, requestId);

describe("build.retryAfterDeploy (Finish the steps after the deploy)", () => {
  it("is a delivery op", () => {
    expect(deliveryOps["build.retryAfterDeploy"]).toBe(buildRetryAfterDeployOp);
  });

  it("queues a job of the build's kind that only runs the steps after the deploy; a second click answers it", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now, Version: "1.1.0" });
    const build = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:data-failed,texts-held", finishedAt: at(1) });
    const res = await finish(w, build);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ kind: "change.build", existing: false, jobStatus: "queued" });
    expect(w.jobs.at(-1)).toMatchObject({ kind: "change.build", input: { projectId: FX.project, changeRequestId: crId, afterDeploy: true, afterJobId: build } });
    expect(crRow(w, crId).Status).toBe("released-dev");
    expect(w.audits.find((a) => a.action === "build.retryAfterDeploy")?.details).toMatchObject({ afterJobId: build, issues: "data-failed,texts-held" });
    const again = await finish(w, build, "f-2");
    expect(data(again)).toMatchObject({ jobId: data(res).jobId, existing: true, jobStatus: "queued" });
    expect(w.jobs).toHaveLength(1);
  });

  it("a milestone's build gets a build.run of that milestone", async () => {
    const { w, ids } = milestones();
    const build = delivered(w, { kind: "build.run", input: { milestoneId: ids[1] }, code: "after-deploy:data-exposed", finishedAt: at(2) });
    const res = await finish(w, build);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(w.jobs.at(-1)).toMatchObject({ kind: "build.run", input: { projectId: FX.project, milestoneId: ids[1], afterDeploy: true, afterJobId: build } });
  });

  it("a change whose own checks on dev did not pass runs them again; another change's clean build does not close them", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now, Version: "1.1.0" });
    const build = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:accept-failed=1/2", finishedAt: at(1) });
    delivered(w, { kind: "change.build", input: { changeRequestId: "cr-other" }, code: "", finishedAt: at(5) });
    const res = await finish(w, build);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(w.jobs.at(-1)).toMatchObject({ kind: "change.build", input: { changeRequestId: crId, afterDeploy: true, afterJobId: build } });
    expect(w.audits.find((a) => a.action === "build.retryAfterDeploy")?.details).toMatchObject({ issues: "accept-failed" });
  });

  it("refuses when nothing is open: a clean build, or a later build of the project finished those steps", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now });
    const clean = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "", finishedAt: at(1) });
    expect(err(await finish(w, clean))).toMatchObject({ code: "invalid_input", messageKey: "delivery.afterDeploy.nothingOpen" });
    const open = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:texts-failed", finishedAt: at(3) });
    delivered(w, { kind: "build.run", input: { milestoneId: "m-x" }, code: "", finishedAt: at(5) });
    expect(err(await finish(w, open, "f-2"))).toMatchObject({ messageKey: "delivery.afterDeploy.nothingOpen" });
    expect(w.jobs).toHaveLength(0);
  });

  it("refuses what only a person can finish, another build that runs, and anything that is not a build", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now });
    const refused = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:data-refused", finishedAt: at(1) });
    expect(err(await finish(w, refused))).toMatchObject({ messageKey: "delivery.afterDeploy.needsPerson", params: { issue: "data-refused" } });
    const preview = String(w.seed("EngineJob", { ProjectId: FX.project, Kind: "preview.deploy", Status: "succeeded", InputJson: "{}", ErrorCode: "after-deploy:data-failed", ...stamps } as never).ItemId);
    expect(err(await finish(w, preview, "f-2"))).toMatchObject({ code: "not_found" });
    expect(err(await finish(w, "no-such-job", "f-3"))).toMatchObject({ code: "not_found" });
    const open = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:data-failed", finishedAt: at(4) });
    w.seed("EngineJob", { ProjectId: FX.project, Kind: "build.run", Status: "running", InputJson: JSON.stringify({ milestoneId: "m-x" }), ...stamps } as never);
    expect(err(await finish(w, open, "f-4"))).toMatchObject({ code: "conflict", messageKey: "delivery.build.active" });
    expect(w.jobs).toHaveLength(0);
  });

  it("never answers a finished retry under its key", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now });
    const build = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:data-failed", finishedAt: at(1) });
    const stale = keyNamesFinishedJob(w);
    const res = await finish(w, build);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    reallyStarted(w, data(res).jobId, stale);
  });

  it("needs the right to run builds", async () => {
    const { w, crId } = change({ Status: "released-dev", Analysis: ANALYSIS, DecidedAt: FX.now });
    const build = delivered(w, { kind: "change.build", input: { changeRequestId: crId }, code: "after-deploy:data-failed", finishedAt: at(1) });
    w.as(FX.viewer);
    expect(err(await finish(w, build))?.code).toBe("forbidden");
  });
});
