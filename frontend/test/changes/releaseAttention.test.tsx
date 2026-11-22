// The Release page with several changes that need attention (09.11.2026, PrimaBook): no stacked full-width notice per
// change any more; one chip "Needs attention · N" in the status strip (it opens the side panel), and the Send-to-Staging
// action says in one short line which change holds it back, with a link to the panel. A change whose failing checks pass
// since a later version holds nothing back. Real components over fixed rows.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/releaseAttention.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest, DeliveryRelease } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, OWNER, answered, cr, job } from "./fixtures";
import { serializeChangeChecks, type ChecksRun } from "../../src/domain/changeChecks";

const rows = vi.hoisted(() => ({ changes: [] as unknown[], jobs: [] as unknown[], releases: [] as unknown[], policies: [] as unknown[] }));

vi.mock("@/blocks/delivery/hooks", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/delivery/hooks")>();
  const list = <T,>(data: T[]) => ({ data, unreadable: [], isLoading: false, error: null });
  return {
    ...actual,
    useChangeRequests: () => list(rows.changes),
    useReleases: () => list(rows.releases),
    useMilestones: () => list([]),
    usePreviews: () => list([]),
    useApprovalPolicies: () => list(rows.policies),
    useApprovalRequests: () => list([]),
    useDeliveryJobs: () => ({ jobs: rows.jobs, isLoading: false, error: null }),
    useFeatureNames: () => new Map(),
  };
});
vi.mock("@/blocks/delivery/context", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/delivery/context")>();
  const { fakeCtx } = await import("./fixtures");
  return { ...actual, useDeliveryContext: () => fakeCtx() };
});
vi.mock("@/blocks/projects/reads", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/projects/reads")>();
  return { ...actual, useProject: () => ({ data: { id: "p-asset", name: "PrimaBook", step: "release", type: "greenfield", repoBranch: "", clientName: "SELISE" } }) };
});
vi.mock("@/blocks/delivery/environments", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/delivery/environments")>();
  return { ...actual, useLiveFacts: () => actual.liveFacts(null, null) };
});

const { BlocksReleaseView } = await import("../../src/components/delivery/BlocksReleaseView");

const APPROVED = answered(ANALYSIS, { q1: "The listing's own currency", q2: "No, hide them" });
const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };
const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h, m)).toISOString();
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId" | "at" | "version">): ChecksRun => ({
  kind: "build", env: "dev", status: "failed", commits: ["abc1234"], failed: 0, files: 0, fixtures: false, failing: [], round: 0, auto: false, baseJobId: "",
  known: [], diagnosed: [], ...o,
});
const change = (n: number, o: Partial<DeliveryChangeRequest> = {}) => cr({ id: `cr-${n}`, number: n, title: `Change ${n}`, status: "released-dev", analysisValue: APPROVED, ...decided, ...o });
const built = (id: string, crId: string, h: number, errorCode: string): EngineJob => ({
  ...job("change.build", "succeeded", 100, crId), id, errorCode: errorCode || null, finishedAt: t(h), createdAt: t(h - 1),
});
const release = (version: string, jobId: string, crId: string, h: number): DeliveryRelease => ({
  id: `r-${version}`, projectId: "p-asset", environment: "dev", version, url: "https://app.dev.example.ch", changeRequestIds: [crId], releasedAt: t(h),
  releasedByUserId: OWNER, approvalRequestId: null, engineJobId: jobId, status: "released",
});
const render = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter><BlocksReleaseView projectId="p-asset" /></MemoryRouter></QueryClientProvider>)
    .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
};

/** Five changes on dev whose checks failed (named on their records) and one whose failing check passes since. */
function world(o: { cr20Passes?: boolean } = {}) {
  const failingRun = (n: number, h: number) => serializeChangeChecks({ v: 1, runs: [run({ jobId: `j-${n}`, at: t(h), version: `0.${n}.0`, failed: 1, files: 2, failing: [{ repo: "api", name: `test/t${n}.mjs`, reason: "FAIL" }] })] });
  rows.changes = [
    ...[12, 13, 14].map((n, i) => change(n, { version: `0.${n}.0`, checks: failingRun(n, 10 + i) })),
    change(20, { version: "0.20.0", checks: failingRun(20, 14) }),
    change(21, { version: "0.21.0", status: "released-dev", checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-21", at: t(15), version: "0.21.0", status: "ok", files: 1, passed: o.cr20Passes ? [{ repo: "api", name: "test/t20.mjs" }] : [] })] }) }),
  ];
  rows.jobs = [
    ...[12, 13, 14].map((n, i) => built(`j-${n}`, `cr-${n}`, 10 + i, "after-deploy:accept-failed=1/2")),
    built("j-20", "cr-20", 14, "after-deploy:accept-failed=1/2"),
    built("j-21", "cr-21", 15, ""),
  ];
  rows.releases = [release("0.1.0", "", "", 9), ...[12, 13, 14, 20, 21].map((n, i) => release(`0.${n}.0`, `j-${n}`, `cr-${n}`, 10 + i))];
  // who approves a release to staging and production: set up, so the one action is "Send … to Staging"
  rows.policies = (["stage", "production"] as const).map((environment) => ({
    id: `pol-${environment}`, environment, updatedAt: null,
    policy: { environment, steps: [{ type: "architect", required: true, approverUserIds: ["u-other"] }, { type: "security", required: true, approverUserIds: ["u-other"] }] },
  }));
}

describe("the Release page: one chip and one short line, never a notice per change", () => {
  it("four changes need attention: one chip, no stacked notices", () => {
    world();
    const text = render();
    expect(text).toContain("Needs attention 4");
    expect(text).not.toContain("is on development, but not usable yet");
    // the change list in Details keeps its own row per change; the full-width notice and its link are gone
    expect(text).not.toMatch(/See what does not work(?! yet)/);
  });

  it("Send to Staging says which change holds it back, in one line, linking to the panel", () => {
    world();
    const text = render();
    expect(text).toMatch(/v0\.21\.0 carries CR-0(12|13|14|20), whose own checks fail on development\. See what needs attention/);
  });

  it("a failing check that passes since on a later version holds nothing back", () => {
    world({ cr20Passes: true });
    const text = render();
    expect(text).toContain("Needs attention 3");
  });

  it("nothing needs attention: no chip", () => {
    world();
    rows.jobs = (rows.jobs as EngineJob[]).map((j) => ({ ...j, errorCode: null }));
    const text = render();
    expect(text).not.toContain("Needs attention");
    expect(text).not.toContain("whose own checks fail on development");
  });
});
