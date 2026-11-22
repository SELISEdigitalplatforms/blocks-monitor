// A start answers only work of the record it starts (09.11.2026, PrimaBook). With two parallel streams and CR-018's
// build running, "Build increment 2 of 3" on CR-020 answered {jobId: <CR-018's build>, existing: true, jobStatus:
// "running"}: cr.startBuild queued its job without a target, so its ActiveKey was the project's ("change.build:project",
// one active job per project and ActiveKey on the hosted store) and the store handed back the running build of ANOTHER
// change. The page said "requested", CR-020 was set to "building" and nothing was queued; CR-021 was left the same way.
// Now every change build has its own target (ActiveKey per change, per build it follows for a round, a revert or the
// steps after a deploy), an active answer of another record is refused as "another build is running", and a change
// left at "building" without a build of its own starts again. The fake store keeps the hosted ActiveKey rule.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/startOwnBuild.test.ts
import { describe, expect, it } from "vitest";
import { runOp, startEngineJob } from "../../functions/delivery/ops/common";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { crFixChecksOp } from "../../functions/delivery/ops/changes/crFixChecks";
import { buildRetryAfterDeployOp } from "../../functions/delivery/ops/build/retryAfterDeploy";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { serializeStreamsChoice } from "../../src/domain/parallelStreams";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : ({} as Record<string, any>));
const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-1`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });

const analysis = (codeAreas: string[]) => serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "change", route: "fast", summary: "A change.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: false, conflicts: [], risks: [], acceptanceCriteria: ["Works."], tickets: [{ title: "Do it", description: "Do it." }],
  estimate: { tickets: 1 }, questions: [], contextVersion: null, codeAreas,
})!);

/** v1.0.0 on dev; CR-018, CR-020 and CR-021 approved, each touching its own code; `streams` parallel streams. */
async function primaBook(streams?: number) {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const cr = (n: number, area: string) => String(w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: n, Lane: "change", FeatureRef: "", Title: `CR-${n}`, Description: "Do it.", Status: "approved", Version: "",
    RequestedByUserId: FX.owner, Analysis: analysis([area]), DecidedAt: FX.now, ...stamps,
  }).ItemId);
  const ids = { cr18: cr(18, "api: src/projects/types/"), cr20: cr(20, "api: src/team/master/"), cr21: cr(21, "api: test/flaky/") };
  if (streams) await w.ports.update("Project", FX.project, { ParallelStreams: serializeStreamsChoice({ v: 1, chosen: streams, suggested: streams, reason: "", by: FX.owner, at: FX.now }) });
  return { w, ...ids };
}

/** CR-018's build, running, as the old cr.startBuild stored it: no target, so the project's ActiveKey. */
const runningOnProjectKey = (w: FakeWorld, crId: string, version = "0.24.0") => String(w.seed("EngineJob", {
  ProjectId: FX.project, Kind: "change.build", Status: "running", ActiveKey: "change.build:project", TargetType: "", TargetId: "",
  InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: crId, version }), Progress: 40, Attempts: 1, RequestedByUserId: FX.owner, ...stamps,
} as never).ItemId);

const crRow = (w: FakeWorld, id: string) => w.rows("ChangeRequest").find((r) => r.ItemId === id)!;
const inputOf = (w: FakeWorld, jobId: string) => JSON.parse(String(w.rows("EngineJob").find((r) => r.ItemId === jobId)!.InputJson)) as Record<string, unknown>;

describe("cr.startBuild with CR-018's build running (the PrimaBook case)", () => {
  it("two streams: CR-020 gets a queued build of its own, never CR-018's", async () => {
    const { w, cr18, cr20 } = await primaBook(2);
    const theirs = runningOnProjectKey(w, cr18);
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr20 });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res).jobId).not.toBe(theirs);
    expect(data(res)).toMatchObject({ existing: false, jobStatus: "queued" });
    expect(inputOf(w, data(res).jobId)).toMatchObject({ changeRequestId: cr20 });
    // its own key: one active build per change request
    expect(w.rows("EngineJob").find((r) => r.ItemId === data(res).jobId)).toMatchObject({ ActiveKey: `change.build:${cr20}`, TargetType: "ChangeRequest", TargetId: cr20 });
    expect(crRow(w, cr20).Status).toBe("building");
    // a double click answers CR-020's own build
    const again = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr20 }, "r-again");
    expect(data(again)).toMatchObject({ jobId: data(res).jobId, existing: true });
  });

  it("CR-020 and CR-021 both queue beside CR-018: three builds, three changes", async () => {
    const { w, cr18, cr20, cr21 } = await primaBook(3);
    runningOnProjectKey(w, cr18);
    const a = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr20 });
    const b = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr21 }, "r-21");
    expect(a.ok && b.ok, JSON.stringify([a, b])).toBe(true);
    expect(w.jobs.map((j) => (j.input as { changeRequestId: string }).changeRequestId)).toEqual([cr20, cr21]);
    expect(new Set([data(a).jobId, data(b).jobId]).size).toBe(2);
  });

  it("one stream: another build is running, no job, the change stays approved", async () => {
    const { w, cr18, cr20 } = await primaBook();
    runningOnProjectKey(w, cr18);
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr20 }))).toMatchObject({ code: "conflict", messageKey: "delivery.build.active" });
    expect(w.jobs).toHaveLength(0);
    expect(crRow(w, cr20).Status).toBe("approved");
  });

  it("a store that answers another change's active build: refused, nothing marked building", async () => {
    const { w, cr18, cr20 } = await primaBook(2);
    const theirs = runningOnProjectKey(w, cr18);
    // a store from before the per-change key (or any clash): it names CR-018's running build for CR-020's start
    w.ports.createEngineJob = async () => ({ jobId: theirs, existing: true, status: "running" });
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr20 });
    expect(err(res)).toMatchObject({ code: "conflict", messageKey: "delivery.build.active" });
    expect(crRow(w, cr20).Status).toBe("approved");
    expect(crRow(w, cr20).Version).toBe("");
  });
});

describe("a change left at building without a build of its own (CR-021)", () => {
  it("starts again: its own build is queued", async () => {
    const { w, cr18, cr21 } = await primaBook(2);
    runningOnProjectKey(w, cr18);
    // what the old start left: "building" with a version, and no change.build of CR-021 anywhere
    await w.ports.update("ChangeRequest", cr21, { Status: "building", Version: "0.23.0" });
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr21 });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ existing: false, jobStatus: "queued" });
    expect(inputOf(w, data(res).jobId)).toMatchObject({ changeRequestId: cr21 });
  });

  it("with one stream it waits for the running build, as any other start", async () => {
    const { w, cr18, cr21 } = await primaBook();
    runningOnProjectKey(w, cr18);
    await w.ports.update("ChangeRequest", cr21, { Status: "building", Version: "0.23.0" });
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr21 }))).toMatchObject({ messageKey: "delivery.build.active" });
    expect(w.jobs).toHaveLength(0);
  });
});

describe("the other starts of a change: per build, never per project", () => {
  const built = (w: FakeWorld, crId: string, errorCode: string) => String(w.seed("EngineJob", {
    ProjectId: FX.project, Kind: "change.build", Status: "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: crId, version: "0.23.1" }),
    OutputRefs: [], Progress: 100, Message: "Done.", Attempts: 1, ErrorCode: errorCode, FinishedAt: FX.now, RequestedByUserId: FX.owner, ...stamps,
  } as never).ItemId);

  it("Fix what the checks found and Put development back: CR-020's own job beside CR-018's", async () => {
    for (const action of ["fix", "revert"] as const) {
      const { w, cr18, cr20 } = await primaBook(2);
      const own = built(w, cr20, "after-deploy:accept-failed=1/3");
      const theirs = runningOnProjectKey(w, cr18);
      const res = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr20, action });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect(data(res).jobId).not.toBe(theirs);
      expect(inputOf(w, data(res).jobId)).toMatchObject({ changeRequestId: cr20, afterJobId: own, ...(action === "fix" ? { fixChecks: true } : { revertChecks: true }) });
    }
  });

  it("Run the checks again (the steps after the deploy): CR-020's own job beside CR-018's", async () => {
    const { w, cr18, cr20 } = await primaBook(2);
    const own = built(w, cr20, "after-deploy:accept-not-run=limit");
    const theirs = runningOnProjectKey(w, cr18);
    // CR-018's build is running under the project's key for change.build: the retry must not land on it
    const res = await call(w, buildRetryAfterDeployOp, "build.retryAfterDeploy", { jobId: own });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res).jobId).not.toBe(theirs);
    expect(inputOf(w, data(res).jobId)).toMatchObject({ changeRequestId: cr20, afterDeploy: true, afterJobId: own });
    expect(w.rows("EngineJob").find((r) => r.ItemId === data(res).jobId)).toMatchObject({ ActiveKey: `change.build:${own}` });
  });

  it("an active answer of another record is refused by startEngineJob itself", async () => {
    const { w, cr18, cr20 } = await primaBook(2);
    const theirs = runningOnProjectKey(w, cr18);
    w.ports.createEngineJob = async () => ({ jobId: theirs, existing: true, status: "running" });
    const job = { workspaceId: FX.ws, projectId: FX.project, kind: "change.build" as const, input: { changeRequestId: cr20 }, dedupeKey: "k", createdByUserId: FX.owner };
    await expect(startEngineJob(w.ports, job, { field: "changeRequestId", id: cr20 })).rejects.toMatchObject({ messageKey: "delivery.build.active" });
    // its own active job is answered as it is (a double click)
    await expect(startEngineJob(w.ports, job, { field: "changeRequestId", id: cr18 })).resolves.toMatchObject({ jobId: theirs, existing: true });
  });
});
