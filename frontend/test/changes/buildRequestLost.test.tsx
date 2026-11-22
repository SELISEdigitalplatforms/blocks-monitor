// A build request that never became a build (09.11.2026, PrimaBook CR-021): the start answered another change's
// running build, so the change read "building" and the page said "is being built" while no job of it existed; the
// button was gone and the change was stuck. Now:
//   (a) a start shows "requested" only when its write succeeded AND named a build of this change (startProblem);
//   (b) "being built" comes from an open build of the change itself, never from the status alone;
//   (c) "building" without any build of its own for more than two minutes reads "The build request did not reach the
//       development team" with "Start the build again", and waits for the person in the team's list.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/buildRequestLost.test.tsx
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, OWNER, answered, cr, fakeCtx, job } from "./fixtures";

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
    useTickets: () => list([]),
    useDeliveryJobs: () => ({ jobs: rows.jobs, isLoading: false, error: null }),
    useFeatureNames: () => new Map(),
  };
});

const { BlocksChangeBuildView, LOST_LINE } = await import("../../src/components/build/BlocksChangeBuildView");
const { buildLost, changeStage, LOST_BUILD_MS } = await import("../../src/components/changes/changeFlow");
const { startProblem } = await import("../../src/components/changes/blocksChanges");
const { changesWaiting, changeWaitJobOf, changeWaitText } = await import("../../src/components/team/changeWaiting");

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

const APPROVED = answered(ANALYSIS, { q1: "The listing's own currency", q2: "No, hide them" });
const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
/** CR-002 "building" since `m` minutes. */
const building = (m: number) => cr({ status: "building", version: "1.3.0", analysisValue: APPROVED, ...decided, updatedAt: minutesAgo(m) });
/** Another change's (CR-018's) build, running. */
const othersBuild: EngineJob = { ...job("change.build", "running", 40, "cr-18"), id: "j-cr18" };
const ownBuild = (status: EngineJob["status"]): EngineJob => ({ ...job("change.build", status, status === "queued" ? 0 : 30), id: "j-own" });

describe("(a) a start is shown as requested only when it started a build of this change", () => {
  it("a running build of this change, a just-made one the page does not know yet: fine", () => {
    expect(startProblem({ jobId: "j-own", existing: false, jobStatus: "queued" }, "cr-2", [othersBuild])).toBeNull();
    expect(startProblem({ jobId: "j-own", existing: true, jobStatus: "running" }, "cr-2", [ownBuild("running")])).toBeNull();
  });

  it("another change's build (a server that keyed builds per project) or a finished job: not started", () => {
    expect(startProblem({ jobId: "j-cr18", existing: true, jobStatus: "running" }, "cr-2", [othersBuild])).toBe("other-change");
    expect(startProblem({ jobId: "j-own", existing: true, jobStatus: "succeeded" }, "cr-2", [])).toBe("not-started");
  });
});

describe("(b) being built is a build of its own on its way", () => {
  it("with its own build queued or running: being built", () => {
    for (const s of ["queued", "running"] as const) {
      expect(changeStage("building", APPROVED, decided, ownBuild(s), null, { updatedAt: minutesAgo(30), now: Date.now() })).toBe("building");
    }
    const text = page(building(30), [othersBuild, ownBuild("running")]);
    expect(text).toContain("CR-002 is being built");
  });

  it("another change's running build never makes this one being built", () => {
    const text = page(building(30), [othersBuild]);
    expect(text).not.toContain("CR-002 is being built");
    expect(text).not.toContain("The development team is building CR-002");
  });

  it("a moment after the start, before its job is read: requested, not being built", () => {
    const text = page(building(0.5), []);
    expect(text).toContain("The build of CR-002 was requested; the development team picks it up in a moment");
    expect(text).not.toContain("CR-002 is being built");
    expect(text).not.toContain(LOST_LINE);
  });
});

describe("(c) a request that never reached the development team", () => {
  it("building without any build of its own for more than two minutes (or since an unknown time)", () => {
    const now = Date.now();
    expect(buildLost("building", null, { updatedAt: new Date(now - LOST_BUILD_MS - 1000).toISOString(), now })).toBe(true);
    expect(buildLost("building", null, { updatedAt: new Date(now - 30_000).toISOString(), now })).toBe(false);
    expect(buildLost("building", null, { updatedAt: null, now })).toBe(true);
    expect(buildLost("building", ownBuild("queued"), { updatedAt: null, now })).toBe(false);
    expect(buildLost("approved", null, { updatedAt: null, now })).toBe(false);
    // without a clock (a caller that does not know the time) it stays as it was
    expect(changeStage("building", APPROVED, decided, null)).toBe("building");
    expect(changeStage("building", APPROVED, decided, null, null, { updatedAt: minutesAgo(5), now })).toBe("buildLost");
  });

  it("the page says so and offers Start the build again (CR-021 with CR-018 running)", () => {
    const text = page(building(5), [othersBuild]);
    expect(text).toContain(LOST_LINE);
    expect(text).toContain("Start the build again");
    expect(text).not.toContain("CR-002 is being built");
  });

  it("it waits for the person in the team's list", () => {
    const base = { canRun: true, rightOf: () => ({ ok: false as const, reason: "notApprover" as const, others: [] }) };
    const waits = changesWaiting({ ...base, changes: [building(5)], jobs: [], now: Date.now() });
    expect(waits).toEqual([expect.objectContaining({ kind: "buildAgain", lost: true, jobId: null })]);
    expect(changeWaitText(waits[0]!).text).toBe("The build request of CR-002 did not reach the development team. It can start again");
    // with its own build queued: nothing waits
    expect(changesWaiting({ ...base, changes: [building(5)], jobs: [changeWaitJobOf(ownBuild("queued"))], now: Date.now() })).toEqual([]);
  });
});
