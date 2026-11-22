// "Known before this change" on the delivery ops (src/domain/changeChecks.ts KnownMark): cr.markKnown marks a failing
// check of a change with a short reason (or takes the mark back) on the change's checks record; a build whose every
// failing check is marked is not "not usable": it never blocks the change's next build, a promotion or a fix round's
// refusal says there is nothing to fix. Plus the policy checkbox that did not refresh after saving: the page now shows
// the op's answer, never a read right after the write that can still answer the value before it.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/knownBefore.test.ts
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { crFixChecksOp, crMarkKnownOp } from "../../functions/delivery/ops/changes/crFixChecks";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { releasePromoteOp } from "../../functions/delivery/ops/releases/releasePromote";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { changesNotUsable } from "../../src/domain/afterDeploy";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { checksCleared, checksPolicyOf, parseChangeChecks, serializeChangeChecks, serializeChecksPolicy, withRun, type ChecksRun } from "../../src/domain/changeChecks";
import { functionMutationOptions } from "../../src/blocks/fn";
import { DELIVERY_MESSAGES, checksPolicyKey, deliveryMutationConfig, markKnownText } from "@/blocks/delivery/actions";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : ({} as Record<string, any>));
const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-${Math.random()}`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });
const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();
const VIEWS = "test/projects-views.mjs";
const SIGNOFF = "test/portal-signoff.mjs";

// an increment of a feature between its builds: the next one may start once this one is usable
const FEATURE = serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "feature", route: "feature", summary: "A watchlist.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: true, conflicts: [], risks: [], acceptanceCriteria: ["The watchlist shows hours, unbilled and budget"],
  tickets: [{ title: "Watchlist", description: "List it.", increment: 1 }, { title: "Alerts", description: "Alert on it.", increment: 2 }],
  feature: { basis: "existing-product", increments: [{ title: "Watchlist", goal: "List." }, { title: "Alerts", goal: "Alert." }], parts: { api: true, web: true, data: true } },
  estimate: { tickets: 2 }, questions: [],
})!);

async function world() {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const crRow = w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: 6, Lane: "change", FeatureRef: "", Title: "Watchlist", Description: "Projects on a watchlist.",
    Status: "approved", Version: "1.1.0", RequestedByUserId: FX.owner, Analysis: FEATURE, DecidedAt: FX.now, ...stamps,
  });
  const cr = String(crRow.ItemId);
  const build = String(w.seed("EngineJob", {
    ProjectId: FX.project, Kind: "change.build", Status: "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: cr, version: "1.1.0" }),
    OutputRefs: [], Progress: 100, Message: "Done.", Attempts: 1, ErrorCode: "after-deploy:accept-failed=2/9", FinishedAt: at(1), RequestedByUserId: FX.owner, ...stamps,
  } as never).ItemId);
  const run: ChecksRun = {
    jobId: build, kind: "build", env: "dev", at: at(1), status: "failed", version: "1.1.0", commits: ["abc1234def"], failed: 2, files: 9, fixtures: false, round: 0, auto: false, baseJobId: "",
    failing: [{ repo: "api", name: VIEWS, reason: "FAIL watchlist matches list hours" }, { repo: "api", name: SIGNOFF, reason: "FAIL sign-off: 502" }], known: [], diagnosed: [],
  };
  await w.ports.update("ChangeRequest", cr, { Checks: serializeChangeChecks(withRun(null, run)) });
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.1.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [cr], ReleasedAt: at(1), ReleasedByUserId: FX.owner, EngineJobId: build, ...stamps });
  return { w, cr, build };
}
const checksOf = (w: FakeWorld, cr: string) => w.rows("ChangeRequest").find((r) => r.ItemId === cr)!.Checks;

describe("cr.markKnown: a failing check known before this change", () => {
  it("is a delivery op; marks a failing check of the change with its reason, the build and the commit it ran on", async () => {
    expect(deliveryOps["cr.markKnown"]).toBe(crMarkKnownOp);
    const { w, cr, build } = await world();
    const res = await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: VIEWS, reason: "  out of date since 24 Oct: the watchlist answer changed " });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ action: "mark", marked: true, existing: false, jobId: build });
    const rec = parseChangeChecks(checksOf(w, cr))!;
    expect(rec.marks).toEqual([{ repo: "api", name: VIEWS, reason: "out of date since 24 Oct: the watchlist answer changed", byUserId: FX.owner, at: expect.any(String), jobId: build, commit: "abc1234def" }]);
    // the answer carries the stored record (the page shows it at once)
    expect(data(res).checks).toBe(checksOf(w, cr));
    expect(w.audits.find((a) => a.action === "cr.markKnown")?.details).toMatchObject({ action: "mark", repo: "api", name: VIEWS, jobId: build });
    expect(markKnownText(data(res))).toMatch(/^Marked as known before this change/);
    // taken back
    const back = await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: VIEWS, action: "unmark" });
    expect(data(back)).toMatchObject({ action: "unmark", marked: false, existing: false });
    expect(parseChangeChecks(checksOf(w, cr))!.marks).toBeUndefined();
    expect(markKnownText(data(back))).toMatch(/counts as this change's failure again/);
  });

  it("refuses a check that never failed in the change's builds, a reason too short, an unsafe name", async () => {
    const { w, cr } = await world();
    expect(err(await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: "test/other.mjs", reason: "was red before" }))).toMatchObject({ code: "invalid_input", messageKey: "delivery.checks.markUnknownCheck" });
    expect(err(await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: VIEWS, reason: "x" }))).toMatchObject({ code: "invalid_input", messageKey: "delivery.checks.markReason" });
    expect(err(await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: "../etc/x", reason: "was red before" }))).toMatchObject({ code: "invalid_input" });
    expect(err(await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: "nope", repo: "api", name: VIEWS, reason: "was red before" }))).toMatchObject({ code: "not_found" });
    for (const k of ["delivery.checks.markReason", "delivery.checks.markUnknownCheck"]) expect(DELIVERY_MESSAGES[k], k).toBeTruthy();
  });

  it("every failing check marked: not usable no more, the next build may start, the version may move on, nothing to fix", async () => {
    const { w, cr, build } = await world();
    // one marked: still not usable (the sign-off is the change's)
    await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: VIEWS, reason: "out of date since 24 Oct" });
    expect(checksCleared(checksOf(w, cr), build)).toBe(false);
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr }))).toMatchObject({ messageKey: "delivery.checks.notUsable" });
    expect(err(await call(w, releasePromoteOp, "release.promote", { environment: "stage", version: "1.1.0" }))).toMatchObject({ messageKey: "delivery.release.checksFailed" });
    // both marked: cleared everywhere
    await call(w, crMarkKnownOp, "cr.markKnown", { changeRequestId: cr, repo: "api", name: SIGNOFF, reason: "dev's mail service refuses every e-mail" });
    expect(checksCleared(checksOf(w, cr), build)).toBe(true);
    const views = w.rows("EngineJob").map((j) => ({ id: String(j.ItemId), kind: String(j.Kind), status: String(j.Status), errorCode: String(j.ErrorCode ?? ""), finishedAt: String(j.FinishedAt ?? ""), inputJson: String(j.InputJson ?? "") }));
    expect(changesNotUsable(views).has(cr)).toBe(true);                                   // without the record: as before
    expect(changesNotUsable(views, (id, jobId) => checksCleared(checksOf(w, id), jobId)).has(cr)).toBe(false);
    // nothing of the change's to fix any more
    expect(err(await call(w, crFixChecksOp, "cr.fixChecks", { changeRequestId: cr }))).toMatchObject({ messageKey: "delivery.checks.nothingFailed" });
    const promote = await call(w, releasePromoteOp, "release.promote", { environment: "stage", version: "1.1.0" });
    expect(err(promote)?.messageKey).not.toBe("delivery.release.checksFailed");
    // the next increment builds
    const start = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: cr });
    expect(start.ok, JSON.stringify(start)).toBe(true);
  });
});

describe("the policy checkbox shows what was saved", () => {
  it("the op's answer goes into the page's cache; no read right after the write can put the old value back", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const projectId = FX.project;
    // the read the page makes (BlocksChangeBuildView): the gateway still answers the value before the write
    let reads = 0;
    const stale = { ItemId: projectId, ChecksPolicy: serializeChecksPolicy({ autoFixRounds: 2, autoRevert: true }) };
    // the page is open: its query is active (an invalidation would read again at once)
    const page = new QueryObserver(client, { queryKey: checksPolicyKey(projectId), queryFn: async () => { reads += 1; return stale; }, staleTime: 60_000 });
    const stop = page.subscribe(() => undefined);
    await vi.waitFor(() => expect(reads).toBe(1));
    const cfg = deliveryMutationConfig("cr.checksPolicy", FX.ws, projectId);
    expect(cfg.invalidate).not.toContainEqual(checksPolicyKey(projectId));
    const fake = (async (_fn: string, _op: string, args: Record<string, unknown>) => ({ data: { policy: { autoFixRounds: args.autoFixRounds, autoRevert: args.autoRevert } }, serverNow: null, requestId: "r" })) as never;
    const m = new MutationObserver(client, functionMutationOptions(cfg, client, fake));
    await m.mutate({ projectId, autoFixRounds: 2, autoRevert: false });
    const shown = client.getQueryData<{ ChecksPolicy: string }>(checksPolicyKey(projectId));
    expect(checksPolicyOf(shown?.ChecksPolicy)).toEqual({ autoFixRounds: 2, autoRevert: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toBe(1);                                                              // never read again right after
    expect(checksPolicyOf(page.getCurrentResult().data?.ChecksPolicy).autoRevert).toBe(false);
    stop();
  });

  it("a mark's answer goes into the cached change requests", async () => {
    const client = new QueryClient();
    const key = ["ws", FX.ws, "ChangeRequest", { kind: "list", mode: "all" }];
    client.setQueryData(key, [{ ItemId: "cr-6", Checks: "" }, { ItemId: "cr-7", Checks: "x" }]);
    const cfg = deliveryMutationConfig("cr.markKnown", FX.ws, FX.project);
    cfg.apply!({ checks: "{\"v\":1}" }, { changeRequestId: "cr-6" }, client);
    expect(client.getQueryData(key)).toEqual([{ ItemId: "cr-6", Checks: "{\"v\":1}" }, { ItemId: "cr-7", Checks: "x" }]);
  });
});
