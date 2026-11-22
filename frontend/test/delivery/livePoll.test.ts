// The live clock (src/blocks/data/livePoll.ts) and the read path's back-off (src/blocks/data/transport.ts), on their
// own: one read per list per tick however many observers it has, the pace by what the lists say, nothing while the tab
// is hidden, a boost, its own pace for a read that asks for one, and the pause after a 429 or 503.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/livePoll.test.ts
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_MS, createLivePoller, liveEvery, liveMeta, type LivePoller } from "@/blocks/data/livePoll";
import { BACKOFF_FIRST_MS, BACKOFF_MAX_MS, backoffMs, createDataTransport, type DataRead } from "@/blocks/data/transport";

/** A cache with lists whose reads are counted. */
function setup(o: { hidden?: () => boolean; pausedUntil?: () => number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const reads: string[] = [];
  let busy = true;
  const visible: (() => void)[] = [];
  const list = (name: string, meta?: Record<string, unknown>) => ({
    queryKey: ["ws", "w-1", name],
    queryFn: async () => {
      reads.push(name);
      return name === "EngineJob" ? { items: [{ Status: busy ? "running" : "succeeded" }] } : [];
    },
    ...(meta ? { meta } : {}),
  });
  const poller = createLivePoller({
    client, random: () => 0.5, hidden: o.hidden, pausedUntil: o.pausedUntil,
    onVisible: (fn) => { visible.push(fn); return () => undefined; },
  });
  const observers: (() => void)[] = [];
  const observe = (opts: ReturnType<typeof list>) => {
    const ob = new QueryObserver(client, opts);
    observers.push(ob.subscribe(() => undefined));
  };
  const jobsBusy = (data: unknown) => ((data as { items?: { Status: string }[] } | undefined)?.items?.some((r) => r.Status === "running") ? "running" as const : null);
  return {
    client, reads, poller, observe, list, jobsBusy, visible,
    setBusy: (b: boolean) => { busy = b; },
    close: () => { observers.forEach((u) => u()); poller.stop(); client.clear(); },
  };
}
const count = (reads: string[], name: string) => reads.filter((r) => r === name).length;

describe("the live clock", () => {
  let s: ReturnType<typeof setup> | null = null;
  let poller: LivePoller | null = null;
  beforeEach(() => { vi.useFakeTimers({ now: Date.UTC(2026, 10, 9, 10, 0) }); });
  afterEach(() => { s?.close(); s = null; poller = null; vi.useRealTimers(); });

  it("reads a list once per tick however many components show it, at the pace of its class while a job runs", async () => {
    s = setup();
    poller = s.poller;
    const jobs = s.list("EngineJob", liveMeta("jobs", s.jobsBusy));
    const tickets = s.list("Ticket", liveMeta("work"));
    const changes = s.list("ChangeRequest", liveMeta("records"));
    const policies = s.list("ApprovalPolicy");
    // three components show the jobs, two the tickets: still one read each per tick
    for (const o of [jobs, jobs, jobs, tickets, tickets, changes, policies]) s.observe(o);
    poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poller.mode()).toBe("running");
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count(s.reads, "EngineJob")).toBeGreaterThanOrEqual(10);
    expect(count(s.reads, "EngineJob")).toBeLessThanOrEqual(12);
    expect(count(s.reads, "Ticket")).toBeGreaterThanOrEqual(5);
    expect(count(s.reads, "Ticket")).toBeLessThanOrEqual(6);
    expect(count(s.reads, "ChangeRequest")).toBeLessThanOrEqual(2);
    expect(count(s.reads, "ApprovalPolicy")).toBe(0);
  });

  it("slows down by itself once nothing runs: the job list once a minute, the records every two, the work not at all", async () => {
    s = setup();
    poller = s.poller;
    s.observe(s.list("EngineJob", liveMeta("jobs", s.jobsBusy)));
    s.observe(s.list("Ticket", liveMeta("work")));
    s.observe(s.list("ChangeRequest", liveMeta("records")));
    poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    s.setBusy(false);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(poller.mode()).toBe("idle");
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(240_000);
    expect(count(s.reads, "EngineJob")).toBeGreaterThanOrEqual(3);
    expect(count(s.reads, "EngineJob")).toBeLessThanOrEqual(4);
    expect(count(s.reads, "ChangeRequest")).toBeLessThanOrEqual(2);
    expect(count(s.reads, "Ticket")).toBe(0);
    expect(LIVE_MS.work.idle).toBeNull();
  });

  it("reads nothing while the tab is hidden, and what is due at once when it is shown again", async () => {
    let hidden = false;
    s = setup({ hidden: () => hidden });
    poller = s.poller;
    s.observe(s.list("EngineJob", liveMeta("jobs", s.jobsBusy)));
    poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    hidden = true;
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.reads.length).toBeLessThanOrEqual(1);
    const before = s.reads.length;
    hidden = false;
    for (const fn of s.visible) fn();
    await vi.advanceTimersByTimeAsync(10);
    expect(s.reads.length).toBe(before + 1);
  });

  it("asks nothing during the server's pause and right at its end", async () => {
    let until = 0;
    s = setup({ pausedUntil: () => until });
    poller = s.poller;
    s.observe(s.list("EngineJob", liveMeta("jobs", s.jobsBusy)));
    poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    until = Date.now() + 40_000;
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(39_000);
    expect(s.reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(s.reads).toEqual(["EngineJob"]);
  });

  it("a boost reads its keys on every fast tick while it is held; a read at its own pace keeps it", async () => {
    s = setup();
    poller = s.poller;
    s.setBusy(false);
    s.observe(s.list("EngineJob", liveMeta("jobs", s.jobsBusy)));
    s.observe(s.list("ChangeRequest", liveMeta("records")));
    s.observe(s.list("Feature", liveEvery(20_000)));
    s.observe(s.list("Requirement", liveEvery(false)));
    poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    const release = poller.boost([["ws", "w-1", "ChangeRequest"]]);
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(count(s.reads, "ChangeRequest")).toBeGreaterThanOrEqual(5);
    expect(count(s.reads, "Feature")).toBe(1);
    expect(count(s.reads, "Requirement")).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    s.reads.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count(s.reads, "ChangeRequest")).toBeLessThanOrEqual(1);
    expect(count(s.reads, "Feature")).toBe(3);
  });
});

describe("the read path's pause after 429 or 503", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("doubles from 2 s up to 60 s, spread by ±20 %, never shorter than Retry-After", () => {
    expect(backoffMs(1, null, 0.5)).toBe(BACKOFF_FIRST_MS);
    expect(backoffMs(2, null, 0.5)).toBe(2 * BACKOFF_FIRST_MS);
    expect(backoffMs(9, null, 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(1, null, 0)).toBe(0.8 * BACKOFF_FIRST_MS);
    expect(backoffMs(1, null, 0.999)).toBeLessThanOrEqual(1.2 * BACKOFF_FIRST_MS);
    expect(backoffMs(1, 30, 0)).toBe(30_000);
    expect(backoffMs(1, 30, 0.999)).toBeLessThanOrEqual(36_000);
  });

  it("holds every read asked for during the pause and sends them together when it ends; one answer ends the run", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 9, 10, 0) });
    const calls: { at: number; reads: number; status: number }[] = [];
    const answers = [429, 503, 200, 429];
    const fetch = (async (_u: string, init: { body: string }) => {
      const reads = (JSON.parse(init.body) as { reads: DataRead[] }).reads;
      const status = answers.shift() ?? 200;
      calls.push({ at: Date.now(), reads: reads.length, status });
      if (status !== 200) return new Response("{}", { status, headers: status === 429 && calls.length === 1 ? { "retry-after": "10" } : {} });
      return new Response(JSON.stringify({ results: reads.map(() => ({ ok: true, items: [], totalCount: 0, pageNo: 1, pageSize: 10, hasNextPage: false })) }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const t = createDataTransport({ fetch, schedule: (fn) => void setTimeout(fn, 0), random: () => 0.5, onFreshness: () => undefined });
    const read = (schema: string): DataRead => ({ schema, fields: ["ItemId"], pageNo: 1, pageSize: 10 });
    const start = Date.now();
    // refused (429, Retry-After 10 s): that request fails as a whole
    const first = t.read(read("A")).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(t.pausedUntil!()).toBe(start + 10_000);
    // asked for during the pause: held, then one request at its end
    const held = [t.read(read("B")).catch((e: unknown) => e), t.read(read("C")).catch((e: unknown) => e)];
    await vi.advanceTimersByTimeAsync(9_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ reads: 2, status: 503 });
    // the second refusal in a row: 4 s (doubled, no Retry-After)
    const second = calls[1]!.at;
    expect(t.pausedUntil!()).toBe(second + 2 * BACKOFF_FIRST_MS);
    const again = t.read(read("D"));
    await vi.advanceTimersByTimeAsync(2 * BACKOFF_FIRST_MS + 10);
    await expect(again).resolves.toMatchObject({ items: [] });
    expect(calls[2]).toMatchObject({ status: 200 });
    // answered: the next refusal starts from 2 s again
    const next = t.read(read("E")).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.pausedUntil!()).toBe(calls[3]!.at + BACKOFF_FIRST_MS);
    await Promise.all([first, ...held, next]);
  });
});
