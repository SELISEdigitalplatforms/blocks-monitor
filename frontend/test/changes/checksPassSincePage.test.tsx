// A change whose own checks failed, each failing check passing since on a later version (another change's run judged
// it: src/domain/changeChecks.ts checksPassSince), on its page and in the Release page's list: usable, "Its checks pass
// on development since 0.15.0 (after CR-003)", its own failed run kept; never "not usable yet", no "Fix what the checks
// found". A check that was not judged since keeps it not usable. Real components over fixed rows.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/checksPassSincePage.test.tsx
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, DEV_RELEASE, MILESTONE, OWNER, answered, cr, fakeCtx, job } from "./fixtures";
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
    useTickets: () => list([]),
    useDeliveryJobs: () => ({ jobs: rows.jobs, isLoading: false, error: null }),
    useFeatureNames: () => new Map(),
  };
});

const { BlocksChangeBuildView } = await import("../../src/components/build/BlocksChangeBuildView");
const { ChangeRequestsPanel } = await import("../../src/components/delivery/ChangeRequestsPanel");

function render(el: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const APPROVED = answered(ANALYSIS, { q1: "The listing's own currency", q2: "No, hide them" });
const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };
const t = (h: number) => new Date(Date.UTC(2026, 10, 9, h, 0)).toISOString();
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId" | "at" | "version">): ChecksRun => ({
  kind: "build", env: "dev", status: "failed", commits: ["abc1234"], failed: 0, files: 0, fixtures: false, failing: [], round: 0, auto: false, baseJobId: "",
  known: [], diagnosed: [], ...o,
});
const fail = (name: string) => ({ repo: "api", name, reason: "FAIL not ok 2 - the rate of a tariff" });
const built = (id: string, crId: string, h: number, errorCode: string): EngineJob => ({
  ...job("change.build", "succeeded", 100, crId), id, errorCode: errorCode || null, finishedAt: t(h), createdAt: t(h - 1),
});

/** CR-002 failed test/tariffs.mjs and test/rates.mjs on 0.13.0; CR-003's run on 0.15.0 passed `passes`. */
function world(passes: string[]) {
  const two = cr({
    status: "released-dev", version: "0.13.0", analysisValue: APPROVED, ...decided,
    checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-2", at: t(12), version: "0.13.0", failed: 2, files: 2, failing: [fail("test/tariffs.mjs"), fail("test/rates.mjs")] })] }),
  });
  const three = cr({
    id: "cr-3", number: 3, title: "Bring the tariff tests in line", status: "released-dev", version: "0.15.0", analysisValue: APPROVED, ...decided,
    checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-3", at: t(13), version: "0.15.0", status: "ok", files: passes.length, passed: passes.map((name) => ({ repo: "api", name })) })] }),
  });
  rows.changes = [two, three];
  rows.jobs = [built("j-2", "cr-2", 12, "after-deploy:accept-failed=2/2"), built("j-3", "cr-3", 13, "")];
  return { two, three };
}
const page = (c: DeliveryChangeRequest) => textOf(render(<BlocksChangeBuildView ctx={fakeCtx()} number={c.number} />));

describe("a change whose failing checks pass since on a later version", () => {
  it("its page: usable, since 0.15.0 after CR-003, its own failed run kept", () => {
    const { two } = world(["test/tariffs.mjs", "test/rates.mjs", "test/keep.mjs"]);
    const text = page(two);
    expect(text).toContain("Its checks pass on development since 0.15.0 (after CR-003).");
    expect(text).toContain("Its own checks failed on 0.13.0");
    expect(text).toContain("test/tariffs.mjs — passes since 0.15.0 (CR-003)");
    expect(text).not.toContain("not usable yet");
    expect(text).not.toContain("Fix what the checks found");
  });

  it("the Release page's list: never 'not usable yet'", () => {
    world(["test/tariffs.mjs", "test/rates.mjs"]);
    const text = textOf(render(<ChangeRequestsPanel ctx={fakeCtx()} changeRequests={rows.changes as DeliveryChangeRequest[]} milestones={[MILESTONE]} releases={[DEV_RELEASE]} jobs={rows.jobs as EngineJob[]} />));
    expect(text).not.toContain("not usable yet");
  });

  it("one failing check not judged since: still not usable, with Fix what the checks found", () => {
    const { two } = world(["test/tariffs.mjs"]);
    const text = page(two);
    expect(text).toContain("not usable yet");
    expect(text).toContain("Fix what the checks found");
    expect(text).not.toContain("Its checks pass on development since");
  });
});
