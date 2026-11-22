// A change whose own checks failed after its deploy (src/domain/changeChecks.ts), on the delivery ops: cr.fixChecks
// ("Fix what the checks found", "Put development back"), cr.checksPolicy, cr.startBuild (its own version for every
// build; never the next increment on top of a broken one) and release.promote (a version that carries a change that is
// not usable is never promoted). Plus the pure rules every list and the dashboard use, and the notifications' words.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/fixChecks.test.ts
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { crChecksPolicyOp, crFixChecksOp } from "../../functions/delivery/ops/changes/crFixChecks";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { releasePromoteOp } from "../../functions/delivery/ops/releases/releasePromote";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { changesNotUsable, promotionBlockedBy, releaseBroken } from "../../src/domain/afterDeploy";
import { checksPolicyOf } from "../../src/domain/changeChecks";
import { compareReleaseVersions, freeVersion, fixRoundVersion, takenVersions, changeVersionAtStart } from "../../src/domain/delivery";
import { releaseNotUsable, releaseRows, type DashJob } from "../../src/domain/dashboard";
import { notificationText } from "@/blocks/workspaces/notificationText";
import { validateNotification } from "../../src/domain/notifications";
import { DELIVERY_MESSAGES, fixChecksText } from "@/blocks/delivery/actions";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : ({} as Record<string, any>));
const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-1`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });
const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();

const FEATURE = serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "feature", route: "feature", summary: "Invoices that repeat.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: true, conflicts: [], risks: [], acceptanceCriteria: ["A recurring invoice is created every month"],
  tickets: [{ title: "Records", description: "Store them.", increment: 1 }, { title: "Screen", description: "Edit them.", increment: 2 }],
  feature: { basis: "existing-product", increments: [{ title: "Records", goal: "Store." }, { title: "Screen", goal: "Edit." }], parts: { api: true, web: true, data: true } },
  estimate: { tickets: 2 }, questions: [],
})!);

/** v1.0.0 on dev, a change request (CR-005) with its first build on dev as 1.1.0. */
function world(o: { status?: string; code?: string } = {}) {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const cr = String(w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: 5, Lane: "add", FeatureRef: "", Title: "Recurring invoices", Description: "Invoices that repeat every month.",
    Status: o.status ?? "approved", Version: "1.1.0", RequestedByUserId: FX.owner, Analysis: FEATURE, DecidedAt: FX.now, ...stamps,
  }).ItemId);
  const build = delivered(w, { input: { changeRequestId: cr, version: "1.1.0" }, code: o.code ?? "after-deploy:accept-failed=6/38", finishedAt: at(1) });
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.1.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [cr], ReleasedAt: at(1), ReleasedByUserId: FX.owner, EngineJobId: build, ...stamps });
  return { w, cr, build };
}
function delivered(w: FakeWorld, o: { input: Record<string, unknown>; code: string; finishedAt: string; status?: string; kind?: string }): string {
  return String(w.seed("EngineJob", {
    ProjectId: FX.project, Kind: o.kind ?? "change.build", Status: o.status ?? "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, ...o.input }),
    OutputRefs: [], Progress: 100, Message: "Done.", Attempts: 1, ErrorCode: o.code, FinishedAt: o.finishedAt, RequestedByUserId: FX.owner, ...stamps,
  } as never).ItemId);
}

describe("cr.fixChecks: Fix what the checks found", () => {
  it("is a delivery op", () => {
    expect(deliveryOps["cr.fixChecks"]).toBe(crFixChecksOp);
    expect(deliveryOps["cr.checksPolicy"]).toBe(crChecksPolicyOp);
  });

  it("queues a fix round of the same change: the build it fixes, round 1, a patch version, started by a person", async () => {
    const { w, cr, build } = world();
    const res = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ action: "fix", existing: false, jobStatus: "queued", round: 1, version: "1.1.1" });
    expect(w.jobs.at(-1)).toMatchObject({
      kind: "change.build", target: { type: "EngineJob", id: build },
      input: { projectId: FX.project, changeRequestId: cr, fixChecks: true, afterJobId: build, baseJobId: build, round: 1, auto: false, version: "1.1.1" },
    });
    expect(w.audits.find((a) => a.action === "cr.fixChecks")?.details).toMatchObject({ action: "fix", afterJobId: build, round: 1, version: "1.1.1" });
    // a second click answers the round that runs
    const again = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr }, "r-again");
    expect(data(again)).toMatchObject({ jobId: data(res).jobId, existing: true });
    expect(w.jobs).toHaveLength(1);
  });

  it("after automatic rounds that did not help: the next round counts on, from the newest round", async () => {
    const { w, cr, build } = world();
    const r1 = delivered(w, { input: { changeRequestId: cr, fixChecks: true, afterJobId: build, baseJobId: build, round: 1, auto: true, version: "1.1.1" }, code: "after-deploy:accept-failed=4/38", finishedAt: at(3) });
    const r2 = delivered(w, { input: { changeRequestId: cr, fixChecks: true, afterJobId: r1, baseJobId: build, round: 2, auto: true, version: "1.1.2" }, code: "after-deploy:accept-failed=2/38", finishedAt: at(5) });
    const res = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr });
    expect(w.jobs.at(-1)!.input).toMatchObject({ afterJobId: r2, baseJobId: build, round: 3, auto: false, version: "1.1.3" });
    expect(data(res)).toMatchObject({ round: 3 });
  });

  it("after a round that found nothing to change: the build it followed is still the one to fix, and the round counts on", async () => {
    const { w, cr, build } = world();
    // the automatic round 1 deployed nothing (the failing checks were the environment's): no delivery of its own
    const r1 = delivered(w, { input: { changeRequestId: cr, fixChecks: true, afterJobId: build, baseJobId: build, round: 1, auto: true, version: "1.1.1" }, code: "nothing-deployed", finishedAt: at(3) });
    const res = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ action: "fix", round: 2 });
    expect(w.jobs.at(-1)).toMatchObject({ target: { type: "EngineJob", id: build }, input: { afterJobId: build, baseJobId: build, round: 2, auto: false } });
    expect(r1).not.toBe(build);
    // and the change is still not usable: the round left the checks of the build it followed as they were
    const view = (id: string, input: Record<string, unknown>, code: string, finishedAt: string) => ({ id, kind: "change.build", status: "succeeded", errorCode: code, finishedAt, inputJson: JSON.stringify(input) });
    expect(changesNotUsable([view("b", { changeRequestId: "cr" }, "after-deploy:accept-failed=6/38", at(1)), view("r1", { changeRequestId: "cr", fixChecks: true, afterJobId: "b" }, "nothing-deployed", at(3))])).toEqual(new Map([["cr", "b"]]));
  });

  it("puts development back: a revert of the build and its rounds, once", async () => {
    const { w, cr, build } = world();
    const res = await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr, action: "revert" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(w.jobs.at(-1)).toMatchObject({ kind: "change.build", input: { changeRequestId: cr, revertChecks: true, afterJobId: build, baseJobId: build, auto: false, version: "1.1.1" } });
    // a revert that ran already for that build is not asked for again
    const w2 = world();
    delivered(w2.w, { input: { changeRequestId: w2.cr, revertChecks: true, afterJobId: w2.build, baseJobId: w2.build, version: "1.1.1" }, code: "after-deploy:accept-failed=1/38", finishedAt: at(4) });
    expect(err(await call(w2.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: w2.cr, action: "revert" }))).toMatchObject({ messageKey: "delivery.checks.reverted" });
  });

  it("refuses when nothing failed, when another build runs, and an unknown action", async () => {
    const clean = world({ code: "" });
    expect(err(await call(clean.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: clean.cr }))).toMatchObject({ code: "invalid_input", messageKey: "delivery.checks.nothingFailed" });
    // checks that could not judge the change are not a failure: nothing to fix
    const unjudged = world({ code: "after-deploy:accept-not-run=limit" });
    expect(err(await call(unjudged.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: unjudged.cr }))).toMatchObject({ messageKey: "delivery.checks.nothingFailed" });
    const busy = world();
    busy.w.seed("EngineJob", { ProjectId: FX.project, Kind: "build.run", Status: "running", InputJson: JSON.stringify({ milestoneId: "m-x" }), ...stamps } as never);
    expect(err(await call(busy.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: busy.cr }))).toMatchObject({ code: "conflict", messageKey: "delivery.build.active" });
    expect(err(await call(busy.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: busy.cr, action: "rewrite" }, "r-x"))).toMatchObject({ code: "invalid_input" });
    expect(busy.w.jobs).toHaveLength(0);
  });
});

describe("cr.checksPolicy: what happens by itself when checks fail", () => {
  it("stores the project's policy; out-of-range values are refused", async () => {
    const { w } = world();
    const res = await call(w, crChecksPolicyOp, "cr.checksPolicy", { autoFixRounds: 1, autoRevert: false });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const p = w.rows("Project").find((r) => r.ItemId === FX.project)!;
    expect(checksPolicyOf(p.ChecksPolicy)).toEqual({ autoFixRounds: 1, autoRevert: false });
    expect(err(await call(w, crChecksPolicyOp, "cr.checksPolicy", { autoFixRounds: 3, autoRevert: false }, "r-2"))).toMatchObject({ code: "invalid_input" });
    expect(err(await call(w, crChecksPolicyOp, "cr.checksPolicy", { autoFixRounds: 1, autoRevert: "yes" }, "r-3"))).toMatchObject({ code: "invalid_input" });
  });
});

describe("cr.startBuild: a version of its own, never on top of a broken increment", () => {
  it("the next increment waits while the one on development is not usable", async () => {
    const { w, cr } = world();
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr }))).toMatchObject({ code: "conflict", messageKey: "delivery.checks.notUsable" });
    expect(w.jobs).toHaveLength(0);
  });

  it("a build that never finished still holds its version: the next one gets the next; the job carries it", async () => {
    const { w, cr } = world({ code: "" });
    // another change's build started as 1.2.0 and stopped before it was released
    delivered(w, { input: { changeRequestId: "cr-other", version: "1.2.0" }, code: "", finishedAt: at(2), status: "failed" });
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ version: "1.3.0" });
    expect(w.jobs.at(-1)!.input).toMatchObject({ changeRequestId: cr, version: "1.3.0" });
  });
});

describe("release.promote: only usable versions move on", () => {
  it("a version that carries a change whose checks failed on development is refused", async () => {
    const { w } = world({ status: "released-dev" });
    const res = await call(w, releasePromoteOp, "release.promote", { environment: "stage", version: "1.1.0" });
    expect(err(res)).toMatchObject({ code: "invalid_input", messageKey: "delivery.release.checksFailed", params: { changeNumber: 5 } });
  });
});

describe("the rules every page and list use (pure)", () => {
  const view = (id: string, input: Record<string, unknown>, code: string, finishedAt: string, kind = "change.build") =>
    ({ id, kind, status: "succeeded", errorCode: code, finishedAt, inputJson: JSON.stringify(input) });

  it("a change is not usable while its newest delivered build left its checks failing; a later fix, re-check or revert closes it", () => {
    const base = view("b", { changeRequestId: "cr" }, "after-deploy:accept-failed=6/38", at(1));
    expect([...changesNotUsable([base])]).toEqual([["cr", "b"]]);
    const fixed = view("r1", { changeRequestId: "cr", fixChecks: true, afterJobId: "b" }, "", at(3));
    expect(changesNotUsable([base, fixed]).size).toBe(0);
    const recheck = view("again", { changeRequestId: "cr", afterDeploy: true, afterJobId: "b" }, "", at(3));
    expect(changesNotUsable([base, recheck]).size).toBe(0);
    // another change's clean build never closes it; checks that could not judge are not "not usable"
    expect(changesNotUsable([base, view("o", { changeRequestId: "other" }, "", at(5))]).has("cr")).toBe(true);
    expect(changesNotUsable([view("n", { changeRequestId: "cr" }, "after-deploy:accept-not-run=ready", at(1))]).size).toBe(0);
  });

  it("a release is broken while its build's checks fail there; rolled back, it is not on its environment any more", () => {
    const base = view("b", { changeRequestId: "cr" }, "after-deploy:accept-failed=6/38", at(1));
    expect(releaseBroken({ engineJobId: "b" }, [base])).toBe(true);
    expect(releaseBroken({ engineJobId: "b", status: "rolled-back" }, [base])).toBe(false);
    expect(releaseBroken({ engineJobId: "b" }, [base, view("again", { changeRequestId: "cr", afterDeploy: true, afterJobId: "b" }, "", at(2))])).toBe(false);
    expect(releaseBroken({ engineJobId: null }, [base])).toBe(false);
  });

  it("promotion is blocked from the broken build's version on; an older version can still move", () => {
    const broken = new Map([["cr", "b"]]);
    const releases = [{ version: "1.1.0", engineJobId: "b" }];
    expect(promotionBlockedBy("1.1.0", broken, releases, compareReleaseVersions)).toBe("cr");
    expect(promotionBlockedBy("1.2.0", broken, releases, compareReleaseVersions)).toBe("cr");
    expect(promotionBlockedBy("1.0.0", broken, releases, compareReleaseVersions)).toBeNull();
    expect(promotionBlockedBy("1.0.0", new Map([["cr", "unknown"]]), releases, compareReleaseVersions)).toBe("cr");
  });

  it("versions: above everything held, a patch for a fix round, never one twice", () => {
    const held = takenVersions({ releases: ["1.0.0", "bad"], changes: ["1.1.0", null], jobs: [{ inputJson: JSON.stringify({ version: "1.2.0" }) }, { inputJson: "{" }] });
    expect(held.sort()).toEqual(["1.0.0", "1.1.0", "1.2.0"]);
    expect(changeVersionAtStart("add", held)).toBe("1.3.0");
    expect(changeVersionAtStart("fix", held)).toBe("1.2.1");
    expect(fixRoundVersion(held)).toBe("1.2.1");
    expect(freeVersion("1.2.0", held)).toBe("1.2.1");
    expect(freeVersion("1.4.0", held)).toBe("1.4.0");
    expect(fixRoundVersion([])).toBeNull();
  });

  it("the dashboard shows a release whose change is not usable as such", () => {
    const jobs: DashJob[] = [
      { id: "b", projectId: "p", kind: "change.build", status: "succeeded", progress: 100, requestedByUserId: "", createdAt: at(0), finishedAt: at(1), errorCode: "after-deploy:accept-failed=6/38", changeRequestId: "cr" },
    ];
    const rel = { projectId: "p", env: "dev" as const, version: "1.1.0", status: "released", releasedAt: at(1), jobId: "b" };
    expect(releaseNotUsable(rel, jobs)).toBe(true);
    const rows = releaseRows([{ id: "p", name: "PrimaBook", updatedAt: at(1) } as never], [rel], jobs);
    expect(rows[0]!.dev).toMatchObject({ version: "1.1.0", notUsable: true });
    const fixed: DashJob[] = [...jobs, { ...jobs[0]!, id: "r1", finishedAt: at(4), errorCode: "" }];
    expect(releaseNotUsable(rel, fixed)).toBe(false);
  });
});

describe("what people read", () => {
  it("a notification never calls a change that is not usable released", () => {
    const base = { projectId: "p", projectName: "PrimaBook", changeNumber: "CR-005" };
    const notUsable = { ...base, state: "not-usable", checks: "6 of 38", next: "fixing" };
    expect(validateNotification("change.released", notUsable, "/p/p/build?cr=5")).toMatchObject({ ok: true });
    expect(notificationText("change.released", notUsable)).toBe("Change CR-005 of PrimaBook is on Development, but not usable yet: 6 of 38 of its checks fail. The development team is fixing them.");
    expect(notificationText("change.released", { ...base, state: "fixed" })).toBe("Change CR-005 of PrimaBook works on Development now: its checks pass.");
    expect(notificationText("change.released", base)).toBe("Change CR-005 of PrimaBook is released.");
    const inc = { projectId: "p", projectName: "PrimaBook", environment: "dev", version: "1.1.0", changeNumber: "CR-005 increment 1", state: "not-usable", checks: "6 of 38", next: "you" };
    expect(validateNotification("release.created", inc, null)).toMatchObject({ ok: true });
    expect(notificationText("release.created", inc)).toBe("CR-005 increment 1 of PrimaBook is on Development, but not usable yet: 6 of 38 of its checks fail. Open it to decide how to go on.");
    expect(notificationText("release.created", { projectId: "p", projectName: "PrimaBook", environment: "dev", version: "1.1.3", changeNumber: "CR-005", state: "reverted" }))
      .toBe("Development of PrimaBook is back on the last build whose checks passed (1.1.3): CR-005 was taken off it until it is fixed.");
  });

  it("the ops' answers and refusals in plain words, never a team to ask", () => {
    expect(fixChecksText({ action: "fix", round: 2 })).toBe("Requested. The development team starts the fix round (round 2) in a moment.");
    expect(fixChecksText({ action: "revert" })).toMatch(/puts development back to the last build whose checks passed/);
    for (const k of ["delivery.checks.nothingFailed", "delivery.checks.reverted", "delivery.checks.notUsable", "delivery.release.checksFailed"]) {
      expect(DELIVERY_MESSAGES[k], k).toBeTruthy();
      expect(DELIVERY_MESSAGES[k]).not.toMatch(/engine team/);
    }
  });
});
