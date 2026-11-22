// The usage figures stay live (src/blocks/billing/usage.ts): one refresh policy for every usage read (10 s while an
// engine job runs, 60 s otherwise, never slower than the server keeps an answer), every usage read of a workspace under
// one key, and a job that starts or ends in a job list on screen reads them all at once.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { FRESHNESS_MS, freshnessQuery } from "../../src/blocks/data/freshness";
import {
  MAX_TRACKED_LISTS, USAGE_BUSY_MS, USAGE_IDLE_MS, USAGE_STALE_MS, createJobStateTracker, invalidateUsage, usageKeys, usagePace,
} from "../../src/blocks/billing/usage";
import { billingKeys, sameJobPlaceholder, summaryPace, summaryVersion } from "../../src/components/billing/billingData";
import { queryClient } from "../../src/blocks/queryClient";
import { BALANCES_CACHE_MS, SUMMARY_CACHE_MS, USAGE_REPORT_CACHE_MS } from "../../functions/billing/ops/readCache";
import { balancesBusy } from "../../src/components/platform/billing/balancesData";
import { usageFromReport } from "../../src/components/platform/overviewData";
import "../../src/blocks/engine/jobs";
import type { BillingSummary } from "../../src/components/billing/types";

const SUMMARY: BillingSummary = {
  plan: { key: "free", name: "Free", assisted: "none", maxParallelStreams: 1 },
  balanceUsd: 37.6, grantedUsd: 50, consumedUsd: 12.4, tokens: 5_325_798, perProject: [], activeAgents: 4, runningJobs: 1,
  monthUsedUsd: 12.4, monthTokens: 5_325_798, renewsAt: null, pendingRequests: [],
};

const row = (id: string, status: string) => ({ ItemId: id, WorkspaceId: "w", ProjectId: "p", Kind: "change.build", Status: status });
const view = <T>(data: T) => ({ state: { data, dataUpdatedAt: 1, errorUpdatedAt: 0, errorUpdateCount: 0 } });

describe("the refresh policy", () => {
  it("every usage read: 10 s while an engine job runs, 60 s when none runs, cached on screen for half the fast pace", () => {
    expect(FRESHNESS_MS.usage).toEqual({ busy: 10_000, idle: 60_000 });
    expect([USAGE_BUSY_MS, USAGE_IDLE_MS, USAGE_STALE_MS]).toEqual([10_000, 60_000, 5_000]);
    expect(usagePace(true)).toBe(10_000);
    expect(usagePace(false)).toBe(60_000);
    expect(freshnessQuery("usage").staleTime).toBe(5_000);
  });

  it("the summary is fast while its workspace has a job running or agents at work", () => {
    expect(summaryPace({ ...SUMMARY, runningJobs: 1, activeAgents: 0 })).toBe(10_000);
    expect(summaryPace({ ...SUMMARY, runningJobs: 0, activeAgents: 3 })).toBe(10_000);
    expect(summaryPace({ ...SUMMARY, runningJobs: 0, activeAgents: 0 })).toBe(60_000);
  });

  it("the platform's report, overview tile and balances follow the jobs running on the platform", () => {
    const report = freshnessQuery<{ runningJobs?: number }>("usage", { busy: (d) => (d?.runningJobs ?? 0) > 0 });
    expect(report.refetchInterval(view({ runningJobs: 2 }))).toBe(10_000);
    expect(report.refetchInterval(view({ runningJobs: 0 }))).toBe(60_000);
    expect(report.refetchInterval(view(undefined))).toBe(60_000);
    expect(balancesBusy({ rows: [], runningJobs: 1 })).toBe(true);
    expect(balancesBusy({ rows: [], runningJobs: 0 })).toBe(false);
    expect(usageFromReport({ rows: [{ costUsd: 1.5, tokens: 10 }], runningJobs: 3 })).toEqual({ costUsd: 1.5, tokens: 10, rows: 1, runningJobs: 3 });
  });

  it("no server cache of a usage view is held longer than half the fastest pace", () => {
    for (const ms of [SUMMARY_CACHE_MS, USAGE_REPORT_CACHE_MS, BALANCES_CACHE_MS]) expect(ms).toBeLessThanOrEqual(USAGE_BUSY_MS / 2);
  });

  it("the summary and the build in focus sit under one key per workspace", () => {
    expect(billingKeys.summary("w")).toEqual(usageKeys.summary("w"));
    expect(usageKeys.job("w", "j1").slice(0, 4)).toEqual([...usageKeys.summary("w")]);
  });

  it("the build in focus never polls on its own: it is read again when a charge lands in the summary", () => {
    const v = summaryVersion(SUMMARY);
    expect(summaryVersion({ ...SUMMARY, activeAgents: 9, runningJobs: 3, balanceUsd: 1 })).toBe(v);
    expect(summaryVersion({ ...SUMMARY, tokens: SUMMARY.tokens + 1 })).not.toBe(v);
    expect(summaryVersion({ ...SUMMARY, consumedUsd: SUMMARY.consumedUsd + 0.01 })).not.toBe(v);
    expect(summaryVersion(undefined)).toBe("");
  });

  it("while the build's next figure loads its last one stays; another build never borrows it", () => {
    const keep = sameJobPlaceholder("j1");
    const prev = { jobId: "j1", costUsd: 1, tokens: 10, at: null };
    expect(keep(prev, { queryKey: [...usageKeys.job("w", "j1"), "10:1"] })).toBe(prev);
    expect(keep(prev, { queryKey: [...usageKeys.job("w", "j0"), "10:1"] })).toBeUndefined();
    expect(sameJobPlaceholder(null)(prev, { queryKey: [...usageKeys.job("w", "j1"), "10:1"] })).toBeUndefined();
  });
});

describe("a job that starts or ends", () => {
  it("is noticed in a list read before: a new job, a status change; the first read and unchanged reads are calm", () => {
    const t = createJobStateTracker();
    expect(t.changed("a", [row("j1", "succeeded")])).toBe(false); // first read: only recorded
    expect(t.changed("a", [row("j1", "succeeded")])).toBe(false);
    expect(t.changed("a", [row("j2", "queued"), row("j1", "succeeded")])).toBe(true); // a job started
    expect(t.changed("a", [row("j2", "claimed"), row("j1", "succeeded")])).toBe(true); // the engine took it
    expect(t.changed("a", [row("j2", "claimed"), row("j1", "succeeded")])).toBe(false);
    expect(t.changed("a", [row("j2", "succeeded"), row("j1", "succeeded")])).toBe(true); // it ended
    expect(t.changed("a", [row("j3", "succeeded"), row("j2", "succeeded")])).toBe(true); // queued and done between two reads
    expect(t.changed("a", [row("j3", "succeeded")])).toBe(false); // a job leaving the list is no change of state
  });

  it("keeps each list apart, ignores rows it cannot read, forgets the oldest list beyond its bound", () => {
    const t = createJobStateTracker(2);
    expect(t.changed("a", [row("j1", "running")])).toBe(false);
    expect(t.changed("b", [row("j1", "succeeded")])).toBe(false); // another list's first read
    expect(t.changed("a", [row("j1", "running"), { ItemId: 7, Status: "running" }, { ItemId: "x", Status: "nonsense" }])).toBe(false);
    expect(t.changed("c", [])).toBe(false);
    // "b" was the oldest of three: forgotten, so its next read is a first read again
    expect(t.changed("b", [row("j1", "failed")])).toBe(false);
    expect(MAX_TRACKED_LISTS).toBeGreaterThan(0);
  });

  it("invalidates the workspace's summary and its builds, nothing else", async () => {
    const client = new QueryClient();
    for (const key of [usageKeys.summary("w"), usageKeys.job("w", "j1"), usageKeys.summary("other"), ["ws", "w", "billing", "account"], ["ws", "w", "EngineJob"]]) {
      client.setQueryData(key, { x: 1 });
    }
    await invalidateUsage(client, "w");
    const invalid = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(invalid(usageKeys.summary("w"))).toBe(true);
    expect(invalid(usageKeys.job("w", "j1"))).toBe(true);
    expect(invalid(usageKeys.summary("other"))).toBe(false);
    expect(invalid(["ws", "w", "billing", "account"])).toBe(false);
    expect(invalid(["ws", "w", "EngineJob"])).toBe(false);
  });

  afterEach(() => queryClient.clear());

  it("the app's job lists drive it: a build that ends in a list on screen reads the usage again at once", () => {
    const list = ["ws", "w-live", "EngineJob", { kind: "list", where: "p" }];
    queryClient.setQueryData(usageKeys.summary("w-live"), { balanceUsd: 1 });
    queryClient.setQueryData(list, { items: [row("j1", "running")], totalCount: 1 });
    expect(queryClient.getQueryState(usageKeys.summary("w-live"))?.isInvalidated).toBe(false);
    // a poll that shows the same state changes nothing
    queryClient.setQueryData(list, { items: [row("j1", "running")], totalCount: 1 });
    expect(queryClient.getQueryState(usageKeys.summary("w-live"))?.isInvalidated).toBe(false);
    queryClient.setQueryData(list, { items: [row("j1", "succeeded")], totalCount: 1 });
    expect(queryClient.getQueryState(usageKeys.summary("w-live"))?.isInvalidated).toBe(true);
  });
});
