// The freshness tiers (src/blocks/data/freshness.ts, docs/FRESHNESS.md) and the Engine page's status read
// (src/components/platform/engineData.ts): hosts on every live tick, the day of samples only every 30 min.
import { describe, expect, it } from "vitest";
import {
  FRESHNESS_BACKOFF_MAX_MS, FRESHNESS_MS, failuresInARow, freshnessInterval, freshnessQuery, type FreshnessQueryView,
} from "@/blocks/data/freshness";
import { ENGINE_HISTORY_MS, ENGINE_HISTORY_RETRY_MS, engineBusy, historyDue, readEngineStatus, withLivePoints } from "@/components/platform/engineData";
import type { EngineHostView, EngineSampleView, EngineStatus } from "@/domain/platformEngine";

const q = <T,>(data: T | undefined, s: Partial<FreshnessQueryView<T>["state"]> = {}): FreshnessQueryView<T> => ({
  state: { data, dataUpdatedAt: 1_000, errorUpdatedAt: 0, errorUpdateCount: 0, ...s },
});

describe("freshness tiers", () => {
  it("live ≤ 30 s, near 60–120 s, calm 5 min, batch 30 min", () => {
    expect(FRESHNESS_MS.live).toEqual({ busy: 30_000, idle: 60_000 });
    expect(FRESHNESS_MS.near).toEqual({ busy: 60_000, idle: 120_000 });
    expect(FRESHNESS_MS.calm.busy).toBe(300_000);
    expect(FRESHNESS_MS.batch.busy).toBe(1_800_000);
  });

  it("the pace follows the data: busy while something runs, idle otherwise; default busy", () => {
    const live = freshnessQuery<{ running: number }>("live", { busy: (d) => (d?.running ?? 0) > 0 });
    expect(live.refetchInterval(q({ running: 2 }))).toBe(30_000);
    expect(live.refetchInterval(q({ running: 0 }))).toBe(60_000);
    expect(freshnessQuery("near").refetchInterval(q({}))).toBe(60_000);
    expect(freshnessQuery("near", { busy: false }).refetchInterval(q({}))).toBe(120_000);
    expect(freshnessQuery("calm").refetchInterval(q({}))).toBe(300_000);
    expect(freshnessQuery("batch").refetchInterval(q({}))).toBe(1_800_000);
  });

  it("never reads while the tab is hidden; a screen opened again within half the pace shows the cache", () => {
    for (const tier of ["live", "near", "calm"] as const) {
      const o = freshnessQuery(tier);
      expect(o.refetchIntervalInBackground).toBe(false);
      expect(o.staleTime).toBe(FRESHNESS_MS[tier].busy / 2);
    }
    expect(freshnessQuery("batch").staleTime).toBe(FRESHNESS_MS.batch.busy);
  });

  it("backs off after failures in a row (a 429 or a busy host fails the read), up to 10 min, and recovers", () => {
    expect(freshnessInterval("live", true, 0)).toBe(30_000);
    expect(freshnessInterval("live", true, 1)).toBe(60_000);
    expect(freshnessInterval("live", true, 3)).toBe(240_000);
    expect(freshnessInterval("live", true, 9)).toBe(FRESHNESS_BACKOFF_MAX_MS);
    expect(freshnessInterval("batch", true, 4)).toBe(FRESHNESS_MS.batch.busy); // a slow tier keeps its own pace
    const o = freshnessQuery("near");
    const query = q({}, { dataUpdatedAt: 1_000, errorUpdateCount: 0 });
    expect(o.refetchInterval(query)).toBe(60_000);
    // two failures in a row after an answer
    query.state = { ...query.state, errorUpdatedAt: 2_000, errorUpdateCount: 1 };
    expect(o.refetchInterval(query)).toBe(120_000);
    query.state = { ...query.state, errorUpdatedAt: 3_000, errorUpdateCount: 2 };
    expect(failuresInARow(query)).toBe(2);
    expect(o.refetchInterval(query)).toBe(240_000);
    // an answer: back to the pace; the next failure counts from one again
    query.state = { ...query.state, dataUpdatedAt: 4_000 };
    expect(o.refetchInterval(query)).toBe(60_000);
    query.state = { ...query.state, errorUpdatedAt: 5_000, errorUpdateCount: 3 };
    expect(o.refetchInterval(query)).toBe(120_000);
  });
});

const host = (o: Partial<EngineHostView> = {}): EngineHostView => ({
  hostId: "h1", name: "engine-1", lastSeenAt: "2026-11-09T10:00:30.000Z", cpuPercent: 40, load1: 1, load5: 1, load15: 1, cpuCount: 8,
  memUsedMb: 4096, memTotalMb: 16384, diskUsedGb: 10, diskTotalGb: 100, runningJobs: 1, runningLanes: 1, activeAgents: 2, queueLength: 0,
  release: "r1", uptime: 100, ...o,
});
const sample = (at: string, cpu = 10): EngineSampleView => ({ hostId: "h1", at, cpuPercent: cpu, memUsedMb: 1000, runningJobs: 0, activeAgents: 0 });

describe("the Engine page's status read", () => {
  it("reads the day of samples on open and then only every 30 min; between, the hosts alone", async () => {
    const asked: Record<string, unknown>[] = [];
    let seen = "2026-11-09T10:00:30.000Z";
    const call = async (args: Record<string, unknown>): Promise<EngineStatus> => {
      asked.push(args);
      return { hosts: [host({ lastSeenAt: seen })], samples: args.samples === false ? [] : [sample("2026-11-09T09:59:00.000Z"), sample("2026-11-09T10:00:00.000Z")], now: seen };
    };
    let t = 0;
    let held = await readEngineStatus(undefined, t, call);
    expect(asked.at(-1)).toEqual({});
    expect(held.history).toHaveLength(2);
    // the host's live reading is the newest point: the chart ends at "now"
    expect(held.samples.at(-1)).toMatchObject({ at: "2026-11-09T10:00:30.000Z", cpuPercent: 40, activeAgents: 2 });
    for (let i = 1; i < 60; i++) {
      t += 30_000;
      seen = new Date(Date.parse("2026-11-09T10:00:30.000Z") + t).toISOString();
      held = await readEngineStatus(held, t, call);
    }
    const full = asked.filter((a) => a.samples !== false).length;
    expect(full).toBe(1 + Math.floor(59 * 30_000 / ENGINE_HISTORY_MS));
    expect(asked.length).toBe(60);
    // between full reads the history is kept and only one live point is added per host
    expect(held.samples.length).toBe(held.history.length + 1);
  });

  it("the live point is left out when the history already holds the host's latest reading, and old samples leave the window", () => {
    const h = host({ lastSeenAt: "2026-11-09T10:00:00.000Z" });
    expect(withLivePoints([sample("2026-11-09T10:00:00.000Z")], [h], "2026-11-09T10:00:10.000Z")).toHaveLength(1);
    expect(withLivePoints([sample("2026-11-08T09:00:00.000Z")], [h], "2026-11-09T10:00:10.000Z")).toEqual([
      expect.objectContaining({ at: "2026-11-09T10:00:00.000Z" }),
    ]);
  });

  it("keeps the hosts when the history cannot be read, and tries the history again after a few minutes", async () => {
    const asked: Record<string, unknown>[] = [];
    let historyBroken = true;
    const call = async (args: Record<string, unknown>): Promise<EngineStatus> => {
      asked.push(args);
      if (args.samples === false) return { hosts: [host()], samples: [], now: "2026-11-09T10:00:40.000Z" };
      return historyBroken
        ? { hosts: [host()], samples: [], now: "2026-11-09T10:00:40.000Z", samplesFailed: true }
        : { hosts: [host()], samples: [sample("2026-11-09T09:59:00.000Z"), sample("2026-11-09T10:00:00.000Z")], now: "2026-11-09T10:00:40.000Z" };
    };
    let held = await readEngineStatus(undefined, 0, call);
    expect(held.hosts).toHaveLength(1);
    expect(held).toMatchObject({ historyFailed: true, historyReadAt: 0, historyTriedAt: 0, history: [] });
    // the charts still end at the host's live reading
    expect(held.samples).toEqual([expect.objectContaining({ at: "2026-11-09T10:00:30.000Z", cpuPercent: 40 })]);
    // live ticks before the retry time read the hosts only
    held = await readEngineStatus(held, ENGINE_HISTORY_RETRY_MS - 1, call);
    expect(asked.at(-1)).toEqual({ samples: false });
    expect(held.historyFailed).toBe(true);
    // then the history is tried again; once it reads, the page is whole again
    historyBroken = false;
    held = await readEngineStatus(held, ENGINE_HISTORY_RETRY_MS, call);
    expect(asked.at(-1)).toEqual({});
    expect(held).toMatchObject({ historyFailed: false, historyReadAt: ENGINE_HISTORY_RETRY_MS });
    expect(held.history).toHaveLength(2);
    // a later failure keeps the history that was read
    historyBroken = true;
    held = await readEngineStatus(held, ENGINE_HISTORY_RETRY_MS + ENGINE_HISTORY_MS, call);
    expect(held).toMatchObject({ historyFailed: true, historyReadAt: ENGINE_HISTORY_RETRY_MS });
    expect(held.history).toHaveLength(2);
    // "Try again" makes the history due at once
    expect(historyDue(held, ENGINE_HISTORY_RETRY_MS + ENGINE_HISTORY_MS + 1)).toBe(false);
    expect(historyDue({ ...held, historyTriedAt: Number.NEGATIVE_INFINITY }, ENGINE_HISTORY_RETRY_MS + ENGINE_HISTORY_MS + 1)).toBe(true);
  });

  it("falls back to the hosts alone when the full read fails, and fails only when that fails too", async () => {
    const boom = new Error("full read failed");
    const asked: Record<string, unknown>[] = [];
    const hostsWork = async (args: Record<string, unknown>): Promise<EngineStatus> => {
      asked.push(args);
      if (args.samples !== false) throw boom;
      return { hosts: [host()], samples: [], now: "2026-11-09T10:00:40.000Z" };
    };
    const held = await readEngineStatus(undefined, 0, hostsWork);
    expect(asked).toEqual([{}, { samples: false }]);
    expect(held.hosts).toHaveLength(1);
    expect(held.historyFailed).toBe(true);
    const nothingWorks = async (args: Record<string, unknown>): Promise<EngineStatus> => {
      throw args.samples === false ? new Error("hosts read failed") : boom;
    };
    await expect(readEngineStatus(undefined, 0, nothingWorks)).rejects.toBe(boom);
  });

  it("is busy while a host runs work or has a queue", () => {
    const s = (o: Partial<EngineHostView>): EngineStatus => ({ hosts: [host(o)], samples: [], now: "" });
    expect(engineBusy(s({ runningJobs: 0, activeAgents: 0, queueLength: 0 }))).toBe(false);
    expect(engineBusy(s({ runningJobs: 0, activeAgents: 0, queueLength: 3 }))).toBe(true);
    expect(engineBusy(undefined)).toBe(false);
  });
});
