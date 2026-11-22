// What one open Build page asks the server (POST /api/data) over a minute, with the page's real data hooks, the real
// read transport and the real live clock (src/blocks/data/livePoll.ts) over a fake /api/data. The local server allows a
// session 120 requests a minute (server/fnHost/loginLimiter.ts); the page stays far below it: at most 20 a minute while
// a build runs, at most 6 while nothing runs, nothing while the server asks for a pause (429 with Retry-After).
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/buildPageReads.test.ts
import { createElement as h, Fragment } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider, environmentManager } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/blocks/queryClient";
import { configureDataTransport, coalescingSchedule, createDataTransport, type DataRead } from "@/blocks/data/transport";
import {
  useApprovalPolicies, useChangeRequests, useDeliveryJobs, useMilestones, usePreviews, useProjectTicketEvents, useReleases, useTickets,
} from "@/blocks/delivery/hooks";
import type { DeliveryContext } from "@/blocks/delivery/context";
import { ParallelStreams } from "@/components/build/queue/ParallelStreams";
import { createHeadlessRoot } from "./headless";

const P = "p-prima";
const W = "w-1";

const ctx = {
  projectId: P, status: "ready", error: null, workspaceId: W,
  project: { id: P, workspaceId: W, name: "PrimaBook", stage: "build", currentScopeVersion: 1, scopeLocked: true, scopeLockedAt: null, assigneeUserId: null, createdByUserId: "u-1" },
  userId: "u-1", isSuperAdmin: false, me: null, permissions: [], can: () => true,
  members: [{ userId: "u-1", displayName: "Mira Keller", roleKey: "owner" }], activeMemberIds: ["u-1"], memberName: () => "Mira Keller",
} as unknown as DeliveryContext;

// ---------------------------------------------------------------- the server's rows

const iso = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();
let jobStatus: "running" | "succeeded" = "running";
const rows = (): Record<string, Record<string, unknown>[]> => ({
  EngineJob: [
    { ItemId: "j-fix", WorkspaceId: W, ProjectId: P, Kind: "change.build", Status: jobStatus, Progress: 40, CreatedDate: iso(30), ClaimedAt: iso(31),
      FinishedAt: jobStatus === "succeeded" ? iso(50) : null,
      InputJson: JSON.stringify({ projectId: P, changeRequestId: "cr-18", fixChecks: true, afterJobId: "j-build", baseJobId: "j-build", round: 1, auto: true }),
      Message: "Fixing CR-018 (round 1): file-map 24986 chars for 2 repo(s)" },
    { ItemId: "j-build", WorkspaceId: W, ProjectId: P, Kind: "change.build", Status: "succeeded", Progress: 100, CreatedDate: iso(1), ClaimedAt: iso(2), FinishedAt: iso(20),
      InputJson: JSON.stringify({ projectId: P, changeRequestId: "cr-18" }), ErrorCode: "after-deploy:accept-failed=2/38" },
  ],
  ChangeRequest: Array.from({ length: 18 }, (_, i) => ({
    ItemId: `cr-${i + 1}`, ProjectId: P, Number: i + 1, Lane: "change", FeatureRef: "", Title: `Change ${i + 1}`, Description: "", Status: i === 17 ? "approved" : "released-dev",
  })),
  // more than a page each: a list read again asks for all its pages in one request
  Ticket: Array.from({ length: 150 }, (_, i) => ({
    ItemId: `t-${i}`, ProjectId: P, MilestoneId: null, Number: i + 1, Title: `Ticket ${i + 1}`, TicketType: "feature", FeatureRef: "", AgentRole: "dev",
    Column: "done", SortOrder: i, PlanRef: `cr:cr-${(i % 18) + 1}:${i % 7}`, Description: "", IsDone: true, Source: "change", DependsOn: [], Acceptance: [],
  })),
  TicketEvent: Array.from({ length: 450 }, (_, i) => ({
    ItemId: `e-${i}`, ProjectId: P, TicketId: `t-${i % 150}`, Kind: "move", FromColumn: "dev", ToColumn: "review", AuthorLabel: "dev", At: iso(i % 59), IsAuto: true,
  })),
  Milestone: [],
  Preview: [{ ItemId: "pv-1", ProjectId: P, Url: "https://dev.primabook.example", Version: "1.4.0", Status: "ready" }],
  Release: [{ ItemId: "r-1", ProjectId: P, Environment: "dev", Version: "1.4.0", ReleasedAt: iso(20) }],
  ApprovalPolicy: [{ ItemId: "pol-stage", ProjectId: P, Environment: "stage" }, { ItemId: "pol-prod", ProjectId: P, Environment: "production" }],
  ApprovalStep: [{ ItemId: "s-1", ParentId: "pol-stage", ParentType: "policy", SortOrder: 1 }],
  Project: [{ ItemId: P, ParallelStreams: null, StreamsAdvice: null }],
});

interface Post { at: number; reads: DataRead[] }
const posts: Post[] = [];
/** The server says "not now" (429 with Retry-After) until this time. */
let refuseUntil = 0;
const RETRY_AFTER_S = 30;

const fakeFetch = (async (_url: string, init: { body: string }) => {
  const { reads } = JSON.parse(init.body) as { reads: DataRead[] };
  posts.push({ at: Date.now(), reads });
  if (Date.now() < refuseUntil) return new Response(JSON.stringify({ ok: false }), { status: 429, headers: { "retry-after": String(RETRY_AFTER_S) } });
  const all = rows();
  const results = reads.map((r) => {
    const list = all[r.schema] ?? [];
    const from = (r.pageNo - 1) * r.pageSize;
    return { ok: true, items: list.slice(from, from + r.pageSize), totalCount: list.length, pageNo: r.pageNo, pageSize: r.pageSize, hasNextPage: from + r.pageSize < list.length };
  });
  return new Response(JSON.stringify({ results }), { status: 200 });
}) as unknown as typeof fetch;

// ---------------------------------------------------------------- the page's subscriptions (Queue tab)

/** BlocksBuildView: the step's own reads. */
function BuildStep() {
  useTickets(ctx); useMilestones(ctx); usePreviews(ctx); useReleases(ctx); useProjectTicketEvents(ctx);
  const { jobs } = useDeliveryJobs(ctx);
  const changes = useChangeRequests(ctx);
  return h(Fragment, null,
    h(Board), h(TeamLauncher), h(ChangeRequestLayer),
    // the Queue tab: the parallel streams control over the step's rows (the real component, with its own project read)
    h(ParallelStreams, { ctx, projectId: P, jobs, changes: changes.data }));
}
/** BlocksBoardView: mounted on every tab (hidden unless Board is picked). */
function Board() {
  useTickets(ctx); useMilestones(ctx); usePreviews(ctx); useDeliveryJobs(ctx); useChangeRequests(ctx); useProjectTicketEvents(ctx);
  return null;
}
/** The team launcher in the project frame (useTeamSummary's base reads). */
function TeamLauncher() {
  useChangeRequests(ctx); useDeliveryJobs(ctx); useReleases(ctx); useApprovalPolicies(ctx);
  return null;
}
/** The change request layer, closed (useBlocksChangeRequests). The Board has no Add feature button (management
 *  decision 09.11.2026: the engine runs the board), so nothing else here reads the releases for change access. */
function ChangeRequestLayer() {
  useChangeRequests(ctx);
  return null;
}

const page = () => h(QueryClientProvider, { client: queryClient }, h(MemoryRouter, null, h(BuildStep)));

const between = (from: number, to: number) => posts.filter((p) => p.at >= from && p.at < to);
/** READS_REPORT=1 prints each request of a window (its second and the lists it carried). */
const report = (label: string, list: Post[], from: number) => {
  if (!process.env.READS_REPORT) return;
  const lines = list.map((p) => `  +${((p.at - from) / 1000).toFixed(1)}s ${[...new Set(p.reads.map((r) => r.schema))].join("+")} (${p.reads.length} reads)`);
  console.log(`${label}: ${list.length} requests\n${lines.join("\n")}`);
};
const readsOf = (list: Post[], schema: string) => list.flatMap((p) => p.reads).filter((r) => r.schema === schema && r.pageNo === 1).length;

// ---------------------------------------------------------------- the minute

describe("one open Build page (Queue tab) reads calmly", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date"], now: Date.UTC(2026, 10, 9, 10, 0) });
    // a browser, not a server render: the cache keeps its timers
    environmentManager.setIsServer(() => false);
    configureDataTransport(createDataTransport({ fetch: fakeFetch, schedule: coalescingSchedule() }));
  });
  afterEach(() => {
    queryClient.clear();
  });
  afterAll(() => {
    configureDataTransport(null);
    environmentManager.setIsServer(() => typeof window === "undefined");
    vi.useRealTimers();
  });

  it("while a build runs: at most 20 requests a minute, every list once per tick, the settings never on the clock", async () => {
    jobStatus = "running";
    posts.length = 0;
    const root = await createHeadlessRoot();
    root.render(page());
    // the first load, then a minute of following the running fix round
    await vi.advanceTimersByTimeAsync(15_000);
    const from = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    const minute = between(from, Date.now());
    report("running, one minute", minute, from);
    expect(minute.length).toBeGreaterThanOrEqual(10);
    expect(minute.length).toBeLessThanOrEqual(20);
    // the job list every ~5 s, tickets and their moves every ~10 s, the records every ~30 s: once per tick, never once
    // per component that shows them (three components show the jobs, the tickets and the change requests)
    expect(readsOf(minute, "EngineJob")).toBeLessThanOrEqual(13);
    expect(readsOf(minute, "EngineJob")).toBeGreaterThanOrEqual(10);
    expect(readsOf(minute, "TicketEvent")).toBeLessThanOrEqual(7);
    expect(readsOf(minute, "Ticket")).toBeLessThanOrEqual(7);
    expect(readsOf(minute, "ChangeRequest")).toBeLessThanOrEqual(3);
    expect(readsOf(minute, "Release")).toBeLessThanOrEqual(3);
    // the approval policies and their steps change only by someone's action: not on the clock
    expect(readsOf(minute, "ApprovalPolicy")).toBe(0);
    expect(readsOf(minute, "ApprovalStep")).toBe(0);
    // one request per tick: a list's pages (150 tickets, 450 moves) leave together, and no read twice in one request
    for (const p of minute) {
      const keys = p.reads.map((r) => JSON.stringify(r));
      expect(new Set(keys).size).toBe(keys.length);
    }
    const ticks = new Set(minute.map((p) => Math.floor(p.at / 1000)));
    expect(minute.length).toBe(ticks.size);
    root.unmount();
  });

  it("when nothing runs: at most 6 requests a minute", async () => {
    jobStatus = "succeeded";
    posts.length = 0;
    const root = await createHeadlessRoot();
    root.render(page());
    await vi.advanceTimersByTimeAsync(20_000);
    const from = Date.now();
    await vi.advanceTimersByTimeAsync(120_000);
    const twoMinutes = between(from, Date.now());
    report("idle, two minutes", twoMinutes, from);
    expect(twoMinutes.length).toBeLessThanOrEqual(12);
    expect(twoMinutes.length / 2).toBeLessThanOrEqual(6);
    // a job queued elsewhere still shows up: the job list is read at least once a minute
    expect(readsOf(twoMinutes, "EngineJob")).toBeGreaterThanOrEqual(2);
    expect(readsOf(twoMinutes, "TicketEvent")).toBe(0);
    root.unmount();
  });

  it("a build that finishes slows the page down by itself", async () => {
    jobStatus = "running";
    posts.length = 0;
    const root = await createHeadlessRoot();
    root.render(page());
    await vi.advanceTimersByTimeAsync(20_000);
    jobStatus = "succeeded";
    // the job list sees the end, the rows the build wrote are read once more, then the idle pace
    await vi.advanceTimersByTimeAsync(30_000);
    const from = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    report("after the build finished, one minute", between(from, Date.now()), from);
    expect(between(from, Date.now()).length).toBeLessThanOrEqual(6);
    root.unmount();
  });

  it("backs off on 429: nothing is asked again until the server's Retry-After, then the page catches up in one request", async () => {
    jobStatus = "running";
    posts.length = 0;
    const root = await createHeadlessRoot();
    root.render(page());
    await vi.advanceTimersByTimeAsync(15_000);
    // the server refuses for the next 10 s and asks for 30 s
    refuseUntil = Date.now() + 10_000;
    const from = Date.now();
    await vi.advanceTimersByTimeAsync(8_000);
    const refused = between(from, Date.now());
    expect(refused.length).toBe(1);
    const at = refused[0]!.at;
    // the pause: not one request until Retry-After has passed (TanStack's own retry and the clock's ticks wait too)
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_S * 1000 - (Date.now() - at) - 1);
    expect(between(at + 1, Date.now())).toHaveLength(0);
    // then everything that waited leaves together, and the page follows the build again at its pace
    await vi.advanceTimersByTimeAsync(10_000);
    const after = between(at + 1, Date.now());
    report("429: the refused request, then after the pause", [...refused, ...after], from);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after.length).toBeLessThanOrEqual(3);
    // the first request after the pause carries the job list and every list the pause held back
    expect(after[0]!.at - at).toBeGreaterThanOrEqual(RETRY_AFTER_S * 1000);
    expect(new Set(after[0]!.reads.map((r) => r.schema))).toEqual(new Set(["EngineJob", "Ticket", "TicketEvent", "ChangeRequest", "Release", "Preview", "Milestone"]));
    refuseUntil = 0;
    root.unmount();
  });
});
