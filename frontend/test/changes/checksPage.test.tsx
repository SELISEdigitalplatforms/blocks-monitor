// A change whose own checks failed on development, on its page and in the Release page's list (src/domain/changeChecks.ts,
// src/components/build/changeChecksUi.ts): on development but not usable yet, with what does not work (the failing
// checks by name with a short reason), what happens next and who acts, the one action "Fix what the checks found", the
// fix rounds so far, and after a revert or a fix that passed one plain line. Real components over fixed rows.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/checksPage.test.tsx
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, DEV_RELEASE, MILESTONE, OWNER, cr, fakeCtx, job } from "./fixtures";
import { serializeChangeChecks, type ChecksRun } from "../../src/domain/changeChecks";

const rows = vi.hoisted(() => ({ changes: [] as unknown[], jobs: [] as unknown[] }));

vi.mock("@/blocks/delivery/hooks", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/delivery/hooks")>();
  const { DEV_RELEASE: dev, MILESTONE: m } = await import("./fixtures");
  const list = <T,>(data: T[]) => ({ data, unreadable: [], isLoading: false, error: null });
  return {
    ...actual,
    useChangeRequests: () => list(rows.changes),
    useReleases: () => list([dev]),
    useMilestones: () => list([m]),
    useApprovalPolicies: () => list([]),
    useDeliveryJobs: () => ({ jobs: rows.jobs, isLoading: false, error: null }),
    useFeatureNames: () => new Map(),
  };
});

const { BlocksChangeBuildView } = await import("../../src/components/build/BlocksChangeBuildView");
const { ChangeRequestsPanel } = await import("../../src/components/delivery/ChangeRequestsPanel");
const { changeChecksState, nextWords, policyWords } = await import("../../src/components/build/changeChecksUi");
const { checksPolicyOf } = await import("../../src/domain/changeChecks");

function render(el: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
function page(change: DeliveryChangeRequest, jobs: EngineJob[]) {
  rows.changes = [change];
  rows.jobs = jobs;
  return textOf(render(<BlocksChangeBuildView ctx={fakeCtx()} number={change.number} />));
}

const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };
const t = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();
/** A finished change build of CR-002 (its input on top of the change's own). */
const build = (id: string, m: number, code: string, input: Record<string, unknown> = {}, status: EngineJob["status"] = "succeeded"): EngineJob => ({
  ...job("change.build", status, 100), id, errorCode: code || null, finishedAt: status === "succeeded" ? t(m) : null, createdAt: t(m - 1),
  inputJson: JSON.stringify({ projectId: "p-asset", changeRequestId: "cr-2", ...input }),
});
const round = (id: string, n: number, after: string, m: number, code: string, status: EngineJob["status"] = "succeeded", auto = true) =>
  build(id, m, code, { fixChecks: true, afterJobId: after, baseJobId: "j-base", round: n, auto, version: `1.2.${n}` }, status);
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId">): ChecksRun => ({
  kind: "build", env: "dev", at: "", status: "failed", version: "1.2.0", commits: ["abc1234"], failed: 6, files: 38, fixtures: false, round: 0, auto: false, baseJobId: "",
  failing: [
    { repo: "api", name: "live/invoices.live.mjs", reason: "2 of 12 checks failed: creates a recurring invoice: expected 201, got 500" },
    { repo: "api", name: "live/recurring.live.mjs", reason: "Cannot find module './helpers/schedule.mjs'" },
  ],
  ...o,
});
const BASE = build("j-base", 1, "after-deploy:accept-failed=6/38", { version: "1.2.0" });
const released = (runs: ChecksRun[], status = "released-dev") =>
  cr({ status: status as DeliveryChangeRequest["status"], version: "1.2.0", analysisValue: ANALYSIS, ...decided, checks: serializeChangeChecks({ v: 1, runs }) });

/** Nothing on the page says the change was delivered or points at a team; no raw ids. */
function honest(text: string) {
  expect(text).not.toMatch(/engine team|has the details/i);
  expect(text).not.toMatch(/\breleased\b/i);
  for (const id of ["cr-2", "j-base", "j-r1", "u-owner", "p-asset"]) expect(text).not.toContain(id);
}

describe("a change whose own checks failed on development", () => {
  it("is on development but not usable: what does not work, and the one action is to fix what the checks found", () => {
    const r1 = round("j-r1", 1, "j-base", 3, "after-deploy:accept-failed=4/38");
    const r2 = round("j-r2", 2, "j-r1", 5, "after-deploy:accept-failed=2/38");
    const change = released([run({ jobId: "j-base" }), run({ jobId: "j-r1", kind: "fix", round: 1, auto: true, version: "1.2.1", failed: 4, baseJobId: "j-base" }),
      run({ jobId: "j-r2", kind: "fix", round: 2, auto: true, version: "1.2.2", failed: 2, baseJobId: "j-base", failing: [{ repo: "api", name: "live/recurring.live.mjs", reason: "Cannot find module './helpers/schedule.mjs'" }] })]);
    const text = page(change, [BASE, r1, r2]);
    expect(text).toContain("CR-002 is on development as 1.2.2, but not usable yet: 2 of its 38 checks fail");
    // what does not work, by name with a short reason
    expect(text).toContain("api · live/recurring.live.mjs — Cannot find module './helpers/schedule.mjs'");
    // the rounds so far, and who acts next
    expect(text).toContain("Fix round 1 (automatic) · 1.2.1 · 4 of 38 still fail");
    expect(text).toContain("Fix round 2 (automatic) · 1.2.2 · 2 of 38 still fail");
    expect(text).toContain("The development team tried 2 fix rounds on its own and the checks still fail. Decide how to go on");
    expect(text).toContain("Fix what the checks found");
    expect(text).toContain("Put development back");
    expect(text).toContain("not usable yet");
    honest(text);
  });

  it("an increment between its builds: the next increment is not the action while it is not usable", () => {
    const change = released([run({ jobId: "j-base" })], "approved");
    const text = page(change, [BASE]);
    expect(text).toContain("CR-002 is on development as 1.2.0, but not usable yet: 6 of its 38 checks fail");
    expect(text).toContain("Fix what the checks found");
    expect(text).not.toMatch(/Build increment|Start the build/);
    expect(text).toContain("api · live/invoices.live.mjs — 2 of 12 checks failed: creates a recurring invoice: expected 201, got 500");
    honest(text);
  });

  it("while a fix round runs, the page follows it and offers nothing to start", () => {
    const active = round("j-r1", 1, "j-base", 3, "", "running");
    const text = page(released([run({ jobId: "j-base" })]), [BASE, active]);
    expect(text).toContain("CR-002 is on development, but not usable yet; the development team is fixing what its checks found (round 1)");
    expect(text).toContain("The development team is fixing what the checks found (fix round 1); the same checks run again after its deploy.");
    expect(text).not.toContain("Fix what the checks found Put");
    honest(text);
  });

  it("a fix that passed: usable, and the page says since which round", () => {
    const r1 = round("j-r1", 1, "j-base", 3, "");
    const change = { ...released([run({ jobId: "j-base" }), run({ jobId: "j-r1", kind: "fix", round: 1, auto: true, status: "ok", failed: 0, version: "1.2.1", baseJobId: "j-base", failing: [] })]), version: "1.2.1" };
    const text = page(change, [BASE, r1]);
    expect(text).toContain("Its checks on development pass since fix round 1 (1.2.1).");
    expect(text).not.toContain("not usable");
  });

  it("development put back: the change is approved again, and the page says why", () => {
    const r1 = round("j-r1", 1, "j-base", 3, "after-deploy:accept-failed=4/38");
    const r2 = round("j-r2", 2, "j-r1", 5, "after-deploy:accept-failed=2/38");
    const rev = build("j-rev", 7, "", { revertChecks: true, afterJobId: "j-r2", baseJobId: "j-base", auto: true, version: "1.2.3" });
    const change = released([run({ jobId: "j-base" }), run({ jobId: "j-r2", kind: "fix", round: 2, auto: true, version: "1.2.2", baseJobId: "j-base" }),
      run({ jobId: "j-rev", kind: "revert", status: "ok", failed: 0, version: "1.2.3", baseJobId: "j-base", auto: true, failing: [] })], "approved");
    const text = page({ ...change, version: null }, [BASE, r1, r2, rev]);
    expect(text).toContain("Development was put back without CR-002");
    expect(text).toContain("development is back on the last build whose checks passed (1.2.3)");
    expect(text).toContain("Start the build");
    expect(text).not.toContain("not usable yet");
  });

  it("a fix round that found nothing to change: still not usable, the round says why, a person decides, and its automatic round is not used", () => {
    // PrimaBook CR-007: the failing check met a fixture the checks did not prepare; the round changed and deployed nothing
    const reason = "api:live/recurring.live.mjs: needs fixture QA Purchases, which this run does not prepare";
    const r1 = round("j-r1", 1, "j-base", 3, "nothing-deployed");
    const change = released([run({ jobId: "j-base" }), run({ jobId: "j-r1", kind: "fix", round: 1, auto: true, status: "not-run", version: "", commits: [], failed: 0, files: 0, failing: [], baseJobId: "j-base", nothing: [reason] })]);
    const text = page(change, [BASE, r1]);
    // the build it followed is still the change's newest: on development as 1.2.0, its checks still failing
    expect(text).toContain("CR-002 is on development as 1.2.0, but not usable yet: 6 of its 38 checks fail");
    // it deployed nothing, so it has no version of its own
    expect(text).toContain(`Fix round 1 (automatic) · nothing to change: the failing checks are the environment's (${reason})`);
    expect(text).toContain("The last fix round found nothing to change: the checks that still fail are the environment's, not the code");
    expect(text).toContain("Fix what the checks found");
    honest(text);
    const state = changeChecksState({ id: "cr-2", checks: change.checks }, [BASE, r1], checksPolicyOf(null));
    expect(state).toMatchObject({ broken: true, next: { who: "you", why: "nothing" }, rounds: [{ round: 1, state: "nothing", reasons: [reason] }] });
    expect(state.job?.id).toBe("j-base");
    // the checks ran again after it (a later run of the same build) and failed: the round is not one of the automatic ones
    const again = build("j-again", 6, "after-deploy:accept-failed=6/38", { afterDeploy: true, afterJobId: "j-base" });
    const later = changeChecksState({ id: "cr-2", checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-base" }), run({ jobId: "j-r1", kind: "fix", round: 1, auto: true, status: "not-run", failed: 0, files: 0, failing: [], baseJobId: "j-base", nothing: [reason] }), run({ jobId: "j-again" })] }) }, [BASE, r1, again], checksPolicyOf(null));
    expect(later.next).toEqual({ who: "you", why: "not-started" });
  });

  it("the Release page's list shows it as not usable, with the way to what does not work", () => {
    const change = released([run({ jobId: "j-base" })]);
    rows.changes = [change];
    rows.jobs = [BASE];
    const text = textOf(render(<ChangeRequestsPanel ctx={fakeCtx()} changeRequests={[change]} milestones={[MILESTONE]} releases={[DEV_RELEASE]} jobs={[BASE]} />));
    expect(text).toContain("On development · not usable yet");
    expect(text).toContain("See what does not work yet");
  });
});

describe("what happens next, in words (pure)", () => {
  const policy = checksPolicyOf(null);
  it("names who acts in every case", () => {
    expect(policyWords(policy)).toBe("When a change's checks fail after its deploy, the development team fixes them on its own, up to 2 rounds; if they still fail, development is put back to the last build whose checks passed.");
    expect(policyWords({ autoFixRounds: 0, autoRevert: false })).toBe("When a change's checks fail after its deploy, a person starts each fix round; if they still fail, a person decides.");
    for (const why of ["rounds-used", "policy-off", "person-started", "no-failing-tests", "not-started", "environment", "nothing"] as const) {
      const line = nextWords({ who: "you", why }, policy);
      expect(line).toMatch(/fix round|Run the checks again|put development back/i);
      expect(line).not.toMatch(/engine team/);
    }
    expect(nextWords({ who: "team", what: "reverting", auto: true }, policy)).toMatch(/^The development team is putting development back/);
  });

  it("the state: a build whose checks were not handed back yet asks a person; one that passed is not broken", () => {
    const one = changeChecksState({ id: "cr-2", checks: null }, [BASE], policy);
    expect(one).toMatchObject({ broken: true, failed: 6, files: 38, next: { who: "you", why: "not-started" } });
    expect(one.job?.id).toBe("j-base");
    const clean = changeChecksState({ id: "cr-2", checks: null }, [build("j-ok", 1, "")], policy);
    expect(clean).toMatchObject({ broken: false, next: null, reverted: null, fixed: null });
    // checks that could not judge the change are not "not usable"
    expect(changeChecksState({ id: "cr-2" }, [build("j-n", 1, "after-deploy:accept-not-run=limit")], policy).broken).toBe(false);
  });
});
