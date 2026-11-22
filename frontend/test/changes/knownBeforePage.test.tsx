// The change's page when its checks hit failures that are older than the change (09.11.2026, PrimaBook CR-006 and
// CR-007): the checks that still fail as they did before it are listed apart, with why ("known before this change":
// the engine's history, or a person's mark), never counted against it; a failing check can be marked so with a short
// reason; a fix round's diagnosis that puts a failing check in the environment is shown beside it (the check stays
// failed). Real components over fixed rows (as checksPage.test.tsx).
//   npx vitest run --config test/changes/vitest.config.ts test/changes/knownBeforePage.test.tsx
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, OWNER, cr, fakeCtx, job } from "./fixtures";
import { serializeChangeChecks, type ChecksRun, type KnownMark } from "../../src/domain/changeChecks";

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
const { changeChecksState } = await import("../../src/components/build/changeChecksUi");

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
const build = (id: string, m: number, code: string, input: Record<string, unknown> = {}): EngineJob => ({
  ...job("change.build", "succeeded", 100), id, errorCode: code || null, finishedAt: t(m), createdAt: t(m - 1),
  inputJson: JSON.stringify({ projectId: "p-asset", changeRequestId: "cr-2", ...input }),
});
const VIEWS = "test/projects-views.mjs";
const SIGNOFF = "test/portal-signoff.mjs";
const PROJECTS = "test/projects.mjs";
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId">): ChecksRun => ({
  kind: "build", env: "dev", at: "", status: "failed", version: "1.2.0", commits: ["abc1234"], failed: 2, files: 9, fixtures: false, round: 0, auto: false, baseJobId: "",
  failing: [
    { repo: "api", name: VIEWS, reason: "FAIL watchlist matches list hours, unbilled and budget exactly" },
    { repo: "api", name: SIGNOFF, reason: "FAIL sign-off: 502" },
  ],
  known: [{ repo: "api", name: PROJECTS, reason: "FAIL create project without a reason: expected 201, got 422", evidence: "failed the same way before this change (on 0a1b2c3d4e5f, 2026-10-30 10:00 UTC: 6 failing)", by: "history" }],
  diagnosed: [],
  ...o,
});
const mark = (name: string, reason: string): KnownMark => ({ repo: "api", name, reason, byUserId: OWNER, at: t(3), jobId: "j-base", commit: "abc1234" });
const released = (runs: ChecksRun[], marks: KnownMark[] = []) =>
  cr({ status: "released-dev" as DeliveryChangeRequest["status"], version: "1.2.0", analysisValue: ANALYSIS, ...decided, checks: serializeChangeChecks({ v: 1, runs, marks }) });
const BASE = build("j-base", 1, "after-deploy:accept-failed=2/9", { version: "1.2.0" });

describe("known before this change, on the change's page", () => {
  it("what failed before the change is listed apart, with why; a failing check can be marked so", () => {
    const text = page(released([run({ jobId: "j-base" })]), [BASE]);
    expect(text).toContain("CR-002 is on development as 1.2.0, but not usable yet: 2 of its 9 checks fail");
    expect(text).toContain("Known before this change: still failing, not this change's");
    expect(text).toContain(`api · ${PROJECTS} — FAIL create project without a reason: expected 201, got 422 Failed the same way before this change (on 0a1b2c3d4e5f, 2026-10-30 10:00 UTC: 6 failing).`);
    // the failing ones: each can be marked known before this change
    expect(text).toContain(`api · ${VIEWS} — FAIL watchlist matches list hours, unbilled and budget exactly Known before this change`);
  });

  it("a person's mark: the check moves to the known list, the count drops; every one marked: usable again", () => {
    const one = page(released([run({ jobId: "j-base" })], [mark(VIEWS, "out of date since 24 Oct: the watchlist answer changed")]), [BASE]);
    expect(one).toContain("but not usable yet: 1 of its 9 checks fail");
    expect(one).toContain(`api · ${VIEWS} — FAIL watchlist matches list hours, unbilled and budget exactly Marked known before this change: out of date since 24 Oct: the watchlist answer changed. Take the mark back`);
    const both = released([run({ jobId: "j-base" })], [mark(VIEWS, "out of date since 24 Oct"), mark(SIGNOFF, "dev's mail service refuses every e-mail")]);
    const text = page(both, [BASE]);
    expect(text).not.toContain("not usable yet");
    expect(text).not.toContain("Fix what the checks found");
    expect(text).toContain("Known before this change: still failing, not this change's");
    const state = changeChecksState({ id: "cr-2", checks: both.checks }, [BASE], { autoFixRounds: 2, autoRevert: true });
    expect(state).toMatchObject({ broken: false, next: null, failing: [] });
    expect(state.known.map((k) => `${k.by} ${k.name}`)).toEqual([`history ${PROJECTS}`, `person ${VIEWS}`, `person ${SIGNOFF}`]);
  });

  it("a green build still lists what fails as it did before the change", () => {
    const ok = build("j-ok", 1, "");
    const text = page(released([run({ jobId: "j-ok", status: "ok", failed: 0, failing: [] })]), [ok]);
    expect(text).not.toContain("not usable");
    expect(text).toContain(`Known before this change: still failing, not this change's api · ${PROJECTS}`);
  });

  it("the diagnosis beside the verdict: the check stays failed, the page says what the diagnosis found and why nothing starts by itself", () => {
    const r1 = build("j-r1", 3, "after-deploy:accept-failed=1/9", { fixChecks: true, afterJobId: "j-base", baseJobId: "j-base", round: 1, auto: true, version: "1.2.1" });
    const runs = [run({ jobId: "j-base" }), run({
      jobId: "j-r1", kind: "fix", round: 1, auto: true, version: "1.2.1", baseJobId: "j-base", failed: 1,
      failing: [{ repo: "api", name: SIGNOFF, reason: "FAIL sign-off: 502" }],
      diagnosed: [{ repo: "api", name: SIGNOFF, side: "environment", cause: "dev's mail service refuses the sign-off e-mail", evidence: ["the API answered messageKey mail.serviceDown"] }],
    })];
    const text = page(released(runs, [mark(VIEWS, "out of date since 24 Oct")]), [BASE, r1]);
    expect(text).toContain("but not usable yet: 1 of its 9 checks fail");
    expect(text).toContain(`api · ${SIGNOFF} — FAIL sign-off: 502 The fix round's diagnosis puts it in the environment, not the code: dev's mail service refuses the sign-off e-mail (the API answered messageKey mail.serviceDown). Its checks still count it as failed.`);
    expect(text).toContain("The last fix round's diagnosis puts the checks that still fail in the environment, not the code");
  });
});
