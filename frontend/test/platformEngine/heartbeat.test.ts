// The heartbeat (one EngineHost row per host, a sample a minute, 7-day retention in small batches) and the AI account
// rows the worker keeps (people's settings in, measurements out, never a credential), on the in-memory gateway.
import { describe, expect, it } from "vitest";
import { memoryGateway } from "../../functions/_lib/testing";
import { RETENTION_BATCH, createHeartbeat } from "../../server/blocks/engineWorker/heartbeat";
import { createAiAccountSync, rowPatch, settingsFromRows } from "../../server/blocks/engineWorker/aiAccountSync";
import type { HostStats } from "../../server/blocks/engineWorker/hostStats";
import type { AccountPool, PoolAccount } from "../../server/local/engine/ai/accountPool";

const STATS: HostStats = {
  cpuPercent: 41.26, load: [1.5, 1.2, 0.9], cpuCount: 8, memUsedMb: 9000, memTotalMb: 16000, diskUsedGb: 40.4, diskTotalGb: 100,
  runningLanes: 2, activeAgents: 6, uptime: 5000,
};

function beatSetup(o: { has?: (s: string) => boolean } = {}) {
  const gateway = memoryGateway();
  let now = Date.parse("2026-11-09T12:00:00.000Z");
  const lines: string[] = [];
  const hb = createHeartbeat({
    raw: gateway, hostId: "madp-engine-vm1", name: "vm1", stats: { read: () => STATS }, runningJobs: () => 3, queueLength: () => 4,
    release: () => "20261109-1100-abc", has: o.has ?? (() => true), log: (l) => lines.push(l), now: () => new Date(now),
  });
  return { gateway, hb, lines, tick: (ms: number) => (now += ms), at: () => now };
}

describe("heartbeat", () => {
  it("keeps one host row up to date and writes one sample a minute", async () => {
    const t = beatSetup();
    await t.hb.beat();
    t.tick(30_000);
    await t.hb.beat();
    t.tick(30_000);
    await t.hb.beat();
    const hosts = t.gateway.rows("EngineHost");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      HostId: "madp-engine-vm1", Name: "vm1", LastSeenAt: new Date(t.at()).toISOString(), CpuPercent: 41.26, Load1: 1.5, CpuCount: 8,
      MemUsedMb: 9000, MemTotalMb: 16000, DiskUsedGb: 40.4, RunningJobs: 3, RunningLanes: 2, ActiveAgents: 6, QueueLength: 4,
      Release: "20261109-1100-abc", Uptime: 5000,
    });
    expect(t.gateway.rows("EngineHostSample")).toHaveLength(2);
    expect(t.gateway.rows("EngineHostSample")[0]).toMatchObject({ HostId: "madp-engine-vm1", CpuPercent: 41.3, ActiveAgents: 6, RunningJobs: 3 });
  });

  it("deletes samples older than 7 days, oldest first, at most a small batch per round", async () => {
    const t = beatSetup();
    const old = Date.parse("2026-11-01T00:00:00.000Z");
    for (let i = 0; i < RETENTION_BATCH + 5; i += 1) {
      const at = new Date(old + i * 60_000).toISOString();
      t.gateway.seed("EngineHostSample", { HostId: "madp-engine-vm1", At: at, CpuPercent: 1, MemUsedMb: 1, RunningJobs: 0, ActiveAgents: 0, RequestKey: `s:${i}`, CreatedDate: at });
    }
    t.gateway.seed("EngineHostSample", { HostId: "madp-engine-vm1", At: "2026-11-09T11:00:00.000Z", CpuPercent: 1, MemUsedMb: 1, RunningJobs: 0, ActiveAgents: 0, RequestKey: "s:new", CreatedDate: "2026-11-09T11:00:00.000Z" });
    expect(await t.hb.prune()).toBe(RETENTION_BATCH);
    expect(await t.hb.prune()).toBe(5);
    expect(await t.hb.prune()).toBe(0);
    expect(t.gateway.rows("EngineHostSample").map((r) => r.RequestKey)).toEqual(["s:new"]);
  });

  it("waits for a tenant without the schema and only logs a failure (once), never throws", async () => {
    const waiting = beatSetup({ has: () => false });
    await waiting.hb.beat();
    await waiting.hb.beat();
    expect(waiting.gateway.rows("EngineHost")).toHaveLength(0);
    expect(waiting.lines.filter((l) => l.includes("no EngineHost schema"))).toHaveLength(1);

    const t = beatSetup();
    const broken = { ...t.gateway, find: async () => { throw new Error("gateway down"); }, insert: async () => { throw new Error("gateway down"); } };
    const lines: string[] = [];
    const hb = createHeartbeat({ raw: broken, hostId: "h", stats: { read: () => STATS }, runningJobs: () => 0, queueLength: () => 0, release: () => "", has: () => true, log: (l) => lines.push(l) });
    await expect(hb.beat()).resolves.toBeUndefined();
    await expect(hb.beat()).resolves.toBeUndefined();
    expect(lines.filter((l) => l.includes("host row failed"))).toHaveLength(1);
  });
});

const poolAcct = (label: string, o: Partial<PoolAccount> = {}): PoolAccount => ({
  label, provider: "claude-subscription", dir: `/x/${label}`, setting: "active", priority: 100, usage5h: null, usage7d: null,
  coolingUntil: null, resetsAt: null, lastUsedAt: null, running: 0, ...o,
});

describe("AI account rows", () => {
  const NOW = Date.parse("2026-11-09T12:00:00.000Z");
  it("reads people's settings (cooling counts as active) and writes only what changed", () => {
    const s = settingsFromRows([{ Label: "a", Status: "cooling", Priority: 3 }, { Label: "b", Status: "standby" }, { Label: "c", Status: "disabled", Priority: 7 }]);
    expect(Object.fromEntries(s)).toEqual({ a: { setting: "active", priority: 3 }, b: { setting: "standby", priority: 100 }, c: { setting: "disabled", priority: 7 } });
    const resting = poolAcct("a", { usage5h: 99.5, coolingUntil: NOW + 600_000, lastUsedAt: NOW - 1000 });
    expect(rowPatch(null, resting, NOW, 99)).toMatchObject({ Status: "cooling", Usage5hPercent: 99.5, Usage7dPercent: -1, ResetsAt: new Date(NOW + 600_000).toISOString(), OnHost: true });
    const row = { ...rowPatch(null, resting, NOW, 99), Label: "a" };
    expect(rowPatch(row, resting, NOW, 99)).toEqual({});
    // a standby account the engine rests keeps people's standby on its row
    expect(rowPatch({ Status: "standby", Provider: "claude-subscription", OnHost: true }, { ...resting, setting: "standby" }, NOW, 99)).not.toHaveProperty("Status");
    // a measurement lost in a restart never wipes the row's last one
    expect(rowPatch({ ...row, Usage5hPercent: 40 }, poolAcct("a"), NOW, 99)).not.toHaveProperty("Usage5hPercent");
  });

  it("syncs the pool with its rows: inserts new accounts, applies settings and the threshold, marks gone ones", async () => {
    const gateway = memoryGateway();
    gateway.seed("AiAccount", { Label: "gone", Provider: "claude-subscription", Status: "active", Priority: 100, Note: "", HostId: "h1", OnHost: true, RequestKey: "ai-account:h1:gone", Usage5hPercent: -1, Usage7dPercent: -1, ResetsAt: "", LastUsedAt: "" });
    gateway.seed("AiAccount", { Label: "sub-b", Provider: "claude-subscription", Status: "disabled", Priority: 4, Note: "kept", HostId: "h1", OnHost: true, RequestKey: "ai-account:h1:sub-b", Usage5hPercent: -1, Usage7dPercent: -1, ResetsAt: "", LastUsedAt: "" });
    gateway.seed("AiAccount", { Label: "other-host", Provider: "claude-subscription", Status: "active", Priority: 100, Note: "", HostId: "h2", OnHost: true, RequestKey: "ai-account:h2:other-host", Usage5hPercent: -1, Usage7dPercent: -1, ResetsAt: "", LastUsedAt: "" });
    gateway.seed("PlatformSetting", { Key: "engine.rotateAtPercent", Values: ["90"], ValueJson: "90", Description: "", ReaderIds: [], RequestKey: "setting:engine.rotateAtPercent" });
    let configured: Parameters<AccountPool["configure"]>[0] | null = null;
    const accounts = [poolAcct("sub-a", { usage5h: 20, lastUsedAt: NOW }), poolAcct("sub-b", { setting: "disabled", priority: 4 })];
    const pool: AccountPool = {
      accounts: () => accounts, rotateAtPercent: () => 90, configure: (c) => { configured = c; }, rediscover: () => undefined,
      lease: () => null, record: () => undefined, probe: async () => undefined,
    };
    const sync = createAiAccountSync({ raw: gateway, pool, hostId: "h1", has: () => true, log: () => undefined, now: () => NOW });
    await sync.tick();
    expect(configured!.rotateAtPercent).toBe(90);
    expect(Object.fromEntries(configured!.settings!)).toMatchObject({ "sub-b": { setting: "disabled", priority: 4 }, gone: { setting: "active" } });
    const rows = gateway.rows("AiAccount");
    const byLabel = (l: string) => rows.find((r) => r.Label === l)!;
    expect(byLabel("sub-a")).toMatchObject({ HostId: "h1", Provider: "claude-subscription", Status: "active", Usage5hPercent: 20, OnHost: true, RequestKey: "ai-account:h1:sub-a" });
    expect(byLabel("sub-b")).toMatchObject({ Status: "disabled", Priority: 4, Note: "kept" });
    expect(byLabel("gone").OnHost).toBe(false);
    expect(byLabel("other-host").OnHost).toBe(true);
    // nothing in a row names a folder, a key or a token
    expect(JSON.stringify(rows)).not.toMatch(/\/x\/|CLAUDE_CONFIG_DIR|key-file/);
  });
});
