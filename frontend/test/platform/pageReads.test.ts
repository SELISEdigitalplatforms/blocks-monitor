// What the Platform's Engine & capacity, Overview and Credits & coupons pages ask the function host per minute, and
// how many engine samples the Engine page makes the host read, before this change (the options as they were at
// 7bfc9a68, rebuilt here) and after it (the real data hooks, rendered without a DOM, over a fake callFunction).
// The Build page's reads are measured in test/delivery/buildPageReads.test.ts (its clock is unchanged).
//   npx vitest run --config test/platform/vitest.config.ts test/platform/pageReads.test.ts   (READS_REPORT=1 prints the table)
import { createElement as h } from "react";
import { QueryClientProvider, QueryObserver, environmentManager, focusManager, type QueryClient } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/domain/platformEngine";

interface Call { at: number; op: string; args: Record<string, unknown>; samples: number }
const calls: Call[] = [];
const SAMPLES_PER_HOST = 24 * 60;
const HOSTS = 2;

function answer(op: string, args: Record<string, unknown>): unknown {
  if (op === "platform.engine.status") {
    const now = new Date().toISOString();
    const hosts = Array.from({ length: HOSTS }, (_, i) => ({
      hostId: `h${i}`, name: `engine-${i}`, lastSeenAt: now, cpuPercent: 40, load1: 1, load5: 1, load15: 1, cpuCount: 8, memUsedMb: 4096,
      memTotalMb: 16384, diskUsedGb: 10, diskTotalGb: 100, runningJobs: 1, runningLanes: 1, activeAgents: 3, queueLength: 0, release: "r1", uptime: 1,
    }));
    const samples = args.samples === false ? [] : hosts.flatMap((host) => Array.from({ length: SAMPLES_PER_HOST }, (_, m) => ({
      hostId: host.hostId, at: new Date(Date.now() - (SAMPLES_PER_HOST - m) * 60_000).toISOString(), cpuPercent: 30, memUsedMb: 4000, runningJobs: 1, activeAgents: 2,
    })));
    return { hosts, samples, now } satisfies EngineStatus;
  }
  if (op === "platform.ai.accounts.list") return { accounts: [], rotateAtPercent: 99, rotateIsDefault: true };
  if (op === "billing.usage.report") return { from: args.from, to: args.to, groupBy: args.groupBy, rows: [], totals: { tokens: 0, costUsd: 0, chargedUsd: 0, rawCostUsd: 0, jobs: 0 } };
  if (op === "billing.purchases.list") return { requests: [], items: [] };
  if (op === "billing.balances.list") return { rows: [] };
  return {};
}

/** The function caller: an unknown function name fails at once without a request (as the real one does). */
async function fakeCall<T>(name: string, op: string, args: Record<string, unknown> = {}): Promise<{ data: T; serverNow: null; requestId: string }> {
  if (name === "platform") throw new TypeError(`Unknown function "${name}"`);
  const data = answer(op, args) as T;
  const samples = op === "platform.engine.status" ? HOSTS * (args.samples === false ? 0 : SAMPLES_PER_HOST) : 0;
  calls.push({ at: Date.now(), op, args, samples });
  return { data, serverNow: null, requestId: "r" };
}

vi.mock("@/blocks/fn", async (importOriginal) => ({ ...(await importOriginal<object>()), callFunction: fakeCall }));

const { QueryClient: Client } = await import("@tanstack/react-query");
const { useEngineStatus, useAiAccounts: useEngineAiAccounts } = await import("@/components/platform/engineData");
const { useMonthUsage, useEngineHosts, useAiAccounts, useOrganizationCounts, usePendingPurchases, monthStart } = await import("@/components/platform/overviewData");
const { freshnessQuery } = await import("@/blocks/data/freshness");

// ---------------------------------------------------------------- before: the options as they were (7bfc9a68)

type Sub = { key: readonly unknown[]; op: string; args: Record<string, unknown>; options: Record<string, unknown> };
const BEFORE: Record<string, Sub[]> = {
  engine: [{ key: ["e", "status"], op: "platform.engine.status", args: {}, options: { staleTime: 15_000, refetchInterval: 30_000, retry: 1 } }],
  overview: [
    { key: ["o", "usage"], op: "billing.usage.report", args: { groupBy: "workspace" }, options: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
    { key: ["o", "engine"], op: "platform.engine.status", args: {}, options: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 60_000 } },
    { key: ["o", "ai"], op: "platform.ai.accounts.list", args: {}, options: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
    { key: ["o", "purchases"], op: "billing.purchases.list", args: { status: "pending" }, options: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  ],
  "ai-accounts": [{ key: ["a", "accounts"], op: "platform.ai.accounts.list", args: {}, options: { staleTime: 30_000, refetchInterval: 60_000, retry: 1 } }],
  credits: [
    { key: ["c", "balances"], op: "billing.balances.list", args: {}, options: { staleTime: 30_000, refetchInterval: 60_000, retry: 0 } },
    { key: ["c", "purchases"], op: "billing.purchases.list", args: {}, options: { staleTime: 30_000, refetchInterval: 60_000, retry: 0 } },
  ],
};

function observeBefore(client: QueryClient, subs: Sub[]): () => void {
  const offs = subs.map((s) => new QueryObserver(client, { queryKey: s.key, queryFn: () => fakeCall("admin", s.op, s.args).then((r) => r.data), ...s.options }).subscribe(() => undefined));
  return () => offs.forEach((off) => off());
}

// ---------------------------------------------------------------- after: the real hooks

function EnginePage() {
  useEngineStatus(true);
  return null;
}
function OverviewPage() {
  useMonthUsage(true); useEngineHosts(true); useAiAccounts(true); useOrganizationCounts(true); usePendingPurchases(true);
  return null;
}
function AiAccountsPage() {
  useEngineAiAccounts(true);
  return null;
}
/** Credits & coupons, Balances tab: its two reads, with the section's own option line. */
const CREDITS_AFTER: Sub[] = [
  // balances follow the agents' work: every 10 s while an engine job runs, every minute when none runs (this fake: none)
  { key: ["c", "balances"], op: "billing.balances.list", args: {}, options: { ...freshnessQuery<{ runningJobs?: number }>("usage", { busy: (d) => (d?.runningJobs ?? 0) > 0 }), retry: 0 } },
  { key: ["c", "purchases"], op: "billing.purchases.list", args: {}, options: { ...freshnessQuery("near"), retry: 0 } },
];

async function renderPage(client: QueryClient, page: () => null): Promise<() => void> {
  const { createHeadlessRoot } = await import("../delivery/headless");
  const root = await createHeadlessRoot();
  root.render(h(QueryClientProvider, { client }, h(page)));
  return () => root.unmount();
}

// ---------------------------------------------------------------- the measurement

const MINUTES = 30;
interface Measure { perMinute: number; samplesPerMinute: number }

async function measure(mount: (client: QueryClient) => Promise<() => void> | (() => void)): Promise<Measure> {
  const client = new Client({ defaultOptions: { queries: { gcTime: 60 * 60_000 } } });
  calls.length = 0;
  const stop = await mount(client);
  await vi.advanceTimersByTimeAsync(10_000); // the first load
  const from = Date.now();
  await vi.advanceTimersByTimeAsync(MINUTES * 60_000);
  const list = calls.filter((c) => c.at >= from);
  stop();
  client.clear();
  return { perMinute: list.length / MINUTES, samplesPerMinute: list.reduce((n, c) => n + c.samples, 0) / MINUTES };
}

const results: Record<string, { before: Measure; after: Measure }> = {};

describe("Platform pages ask calmly and read the sample history rarely", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date"], now: Date.UTC(2026, 10, 9, 10, 0) });
    environmentManager.setIsServer(() => false);
  });
  afterEach(() => focusManager.setFocused(undefined));
  afterAll(() => {
    if (process.env.READS_REPORT) {
      const rows = Object.entries(results).map(([page, r]) =>
        `${page.padEnd(10)} calls/min ${r.before.perMinute.toFixed(2)} -> ${r.after.perMinute.toFixed(2)}   engine samples read/min ${Math.round(r.before.samplesPerMinute)} -> ${Math.round(r.after.samplesPerMinute)}`);
      console.log(rows.join("\n"));
    }
    environmentManager.setIsServer(() => typeof window === "undefined");
    vi.useRealTimers();
  });

  it("Engine & capacity: the hosts every 30 s while they work, the day of samples every 30 min instead of every 30 s", async () => {
    const before = await measure((c) => observeBefore(c, BEFORE.engine));
    const after = await measure((c) => renderPage(c, EnginePage));
    results.engine = { before, after };
    expect(before.perMinute).toBeCloseTo(2, 0);
    expect(after.perMinute).toBeCloseTo(2, 0); // the host cards stay live
    expect(before.samplesPerMinute).toBeGreaterThan(5_000);
    expect(after.samplesPerMinute).toBeLessThan(before.samplesPerMinute / 30);
  });

  it("Overview: every tile near (usage, hosts, AI accounts each minute, requests every 2 min), no samples read", async () => {
    const before = await measure((c) => observeBefore(c, BEFORE.overview));
    const after = await measure((c) => renderPage(c, OverviewPage));
    results.overview = { before, after };
    expect(after.perMinute).toBeLessThanOrEqual(3.6);
    expect(after.samplesPerMinute).toBe(0);
    expect(before.samplesPerMinute).toBeGreaterThan(2_000);
  });

  it("the Overview asks for the month's usage up to now and the hosts only", async () => {
    calls.length = 0;
    const client = new Client();
    const stop = await renderPage(client, OverviewPage);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.find((c) => c.op === "billing.usage.report")?.args).toMatchObject({ from: monthStart(new Date()), groupBy: "workspace" });
    expect(calls.find((c) => c.op === "platform.engine.status")?.args).toEqual({ samples: false });
    stop();
    client.clear();
  });

  it("Credits & coupons (Balances tab): balances and requests each minute, as before; coupons and plans calm", async () => {
    const before = await measure((c) => observeBefore(c, BEFORE.credits));
    const after = await measure((c) => observeBefore(c, CREDITS_AFTER));
    results.credits = { before, after };
    expect(after.perMinute).toBeCloseTo(before.perMinute, 0);
    expect(freshnessQuery("calm").refetchInterval({ state: { data: undefined, dataUpdatedAt: 1, errorUpdatedAt: 0, errorUpdateCount: 0 } })).toBe(300_000);
  });

  it("AI accounts: every minute, as before", async () => {
    const before = await measure((c) => observeBefore(c, BEFORE["ai-accounts"]));
    const after = await measure((c) => renderPage(c, AiAccountsPage));
    results["ai-accounts"] = { before, after };
    expect(after.perMinute).toBeCloseTo(before.perMinute, 0);
    expect(after.perMinute).toBeCloseTo(1, 0);
  });

  it("nothing is read while the tab is hidden", async () => {
    focusManager.setFocused(false);
    const after = await measure((c) => renderPage(c, EnginePage));
    // the first load only (it happens before the measured window)
    expect(after.perMinute).toBe(0);
  });
});
