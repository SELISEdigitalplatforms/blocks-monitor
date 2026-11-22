// platform.engine.status and platform.ai.accounts.list/save through the real router: platform permissions, the 24 h
// window, people's settings (never "cooling", never a credential) and the rotation threshold.
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp } from "../../functions/_lib/testing";
import { platformEngineStatus, readSamples } from "../../functions/admin/ops/engine/status";
import { OpError } from "../../functions/_lib/errors";
import type { Row } from "../../functions/_lib/gateway";
import { MAX_SAMPLES_PER_HOST } from "../../src/domain/platformEngine";
import { platformAiAccountsList, platformAiAccountsSave } from "../../functions/admin/ops/engine/aiAccounts";
import { PLATFORM_PERMISSIONS } from "../../src/domain/rbac";

const OPS = [platformEngineStatus, platformAiAccountsList, platformAiAccountsSave];
const ADMIN = { userId: "admin-1", email: "admin@example.org", roles: ["mf-super-admin"] };
const PERSON = { userId: "person-1", email: "person@example.org" };
const NOW = new Date("2026-11-09T12:00:00.000Z");

function setup() {
  const gateway = memoryGateway();
  gateway.seed("EngineHost", {
    HostId: "madp-engine-vm1", Name: "vm1", LastSeenAt: "2026-11-09T11:59:40.000Z", CpuPercent: 37.5, Load1: 2.1, Load5: 1.8, Load15: 1.5,
    CpuCount: 8, MemUsedMb: 9000, MemTotalMb: 16000, DiskUsedGb: 40.5, DiskTotalGb: 100, RunningJobs: 2, RunningLanes: 2, ActiveAgents: 5,
    QueueLength: 1, Release: "20261109-1100-abc", Uptime: 86400, RequestKey: "engine-host:madp-engine-vm1",
  });
  const sample = (at: string, cpu: number) =>
    gateway.seed("EngineHostSample", { HostId: "madp-engine-vm1", At: at, CpuPercent: cpu, MemUsedMb: 8000, RunningJobs: 1, ActiveAgents: 3, RequestKey: `engine-sample:madp-engine-vm1:${at.slice(0, 16)}` });
  sample("2026-11-08T08:00:00.000Z", 99); // older than 24 h: not answered
  sample("2026-11-09T11:58:00.000Z", 20);
  sample("2026-11-09T11:59:00.000Z", 30);
  const a = gateway.seed("AiAccount", {
    Label: "sub-a", Provider: "claude-subscription", Status: "active", Usage5hPercent: 42, Usage7dPercent: -1, ResetsAt: "", LastUsedAt: "",
    Priority: 100, Note: "", HostId: "madp-engine-vm1", OnHost: true, RequestKey: "ai-account:madp-engine-vm1:sub-a",
  });
  const k = gateway.seed("AiAccount", {
    Label: "api-key", Provider: "anthropic-api", Status: "active", Usage5hPercent: -1, Usage7dPercent: -1, ResetsAt: "", LastUsedAt: "",
    Priority: 100, Note: "", HostId: "madp-engine-vm1", OnHost: true, RequestKey: "ai-account:madp-engine-vm1:api-key",
  });
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp("admin", OPS, { ctx: fakeCtx(who), gateway, request: { op, args }, now: () => NOW });
  return { gateway, call, subId: a, keyId: k };
}

describe("engine ops: registration and permissions", () => {
  it("are registered in mf-admin and use platform permissions the super admin holds", async () => {
    const ops = await listRegisteredOps("admin");
    expect(ops).toEqual(expect.arrayContaining(["platform.engine.status", "platform.ai.accounts.list", "platform.ai.accounts.save"]));
    expect(PLATFORM_PERMISSIONS).toEqual(expect.arrayContaining(["platform.engine.view", "platform.ai.manage"]));
  }, 60_000); // every admin op module is loaded on first use: the time this suite's own config allows, also in a full run

  it("refuse a person without a platform permission", async () => {
    const t = setup();
    for (const op of ["platform.engine.status", "platform.ai.accounts.list"]) {
      const r = await t.call(PERSON, op);
      expect(r.status).toBe(403);
    }
    const r = await t.call(PERSON, "platform.ai.accounts.save", { rotateAtPercent: 90 });
    expect(r.status).toBe(403);
  });
});

describe("platform.engine.status", () => {
  it("answers the hosts and the last 24 hours of samples, oldest first", async () => {
    const t = setup();
    const r = await t.call(ADMIN, "platform.engine.status");
    expect(r.status).toBe(200);
    const data = r.body.data;
    expect(data.hosts).toHaveLength(1);
    expect(data.hosts[0]).toMatchObject({ hostId: "madp-engine-vm1", cpuPercent: 37.5, activeAgents: 5, release: "20261109-1100-abc", memTotalMb: 16000 });
    expect(data.samples.map((s: { cpuPercent: number }) => s.cpuPercent)).toEqual([20, 30]);
    expect(data.now).toBe(NOW.toISOString());
    expect(data.samplesFailed).toBeUndefined();
  });

  // 11.11.2026 05:08 UTC: the host's 1,451st sample (the worker keeps 7 days) made the old read by HostId alone answer
  // limit_reached, and the whole section showed "could not be read" although the host was reporting.
  it("answers the 24-hour window when a host keeps more than a day of samples, read in pages, never limit_reached", async () => {
    const t = setup();
    const minutes = 3000; // about two days and two hours, one sample per minute (setup() holds the newest two minutes)
    for (let i = 3; i <= minutes; i += 1) {
      const at = new Date(NOW.getTime() - i * 60_000).toISOString();
      t.gateway.seed("EngineHostSample", { HostId: "madp-engine-vm1", At: at, CpuPercent: i % 100, MemUsedMb: 8000, RunningJobs: 0, ActiveAgents: 0, RequestKey: `engine-sample:madp-engine-vm1:x${i}` });
    }
    t.gateway.seed("EngineHostSample", { HostId: "madp-engine-vm2", At: "2026-11-09T11:30:00.000Z", CpuPercent: 1, MemUsedMb: 1, RunningJobs: 0, ActiveAgents: 0, RequestKey: "engine-sample:madp-engine-vm2:x" });
    const before = t.gateway.calls.length;
    const r = await t.call(ADMIN, "platform.engine.status");
    expect(r.status).toBe(200);
    const samples = r.body.data.samples as { hostId: string; at: string }[];
    const since = NOW.getTime() - 24 * 3_600_000;
    // the 1,440 minutes of the window (1,438 seeded here, the newest two by setup()); nothing older, no other host
    expect(samples).toHaveLength(1440);
    expect(samples.length).toBeLessThanOrEqual(MAX_SAMPLES_PER_HOST);
    expect(samples.every((s) => s.hostId === "madp-engine-vm1" && Date.parse(s.at) >= since)).toBe(true);
    expect(new Set(samples.map((s) => s.at)).size).toBe(samples.length);
    expect(samples.every((s, i) => i === 0 || samples[i - 1]!.at < s.at)).toBe(true);
    expect(samples.at(-1)!.at).toBe("2026-11-09T11:59:00.000Z");
    expect(r.body.data.samplesFailed).toBeUndefined();
    // the samples are read page by page (find), never as one findAll of every row the host has
    const reads = t.gateway.calls.slice(before).filter((c) => c.schema === "EngineHostSample");
    expect(reads.some((c) => c.method === "findAll")).toBe(false);
    expect(reads.filter((c) => c.method === "find").length).toBeGreaterThanOrEqual(15);
  });

  it("keeps the hosts and says samplesFailed when the samples cannot be read", async () => {
    const t = setup();
    t.gateway.failNext("find", new OpError("internal"), { schema: "EngineHostSample", times: 20 });
    const r = await t.call(ADMIN, "platform.engine.status");
    expect(r.status).toBe(200);
    expect(r.body.data.hosts).toHaveLength(1);
    expect(r.body.data.hosts[0]).toMatchObject({ hostId: "madp-engine-vm1", cpuPercent: 37.5 });
    expect(r.body.data.samples).toEqual([]);
    expect(r.body.data.samplesFailed).toBe(true);
  });

  it("drops the repeat when a sample is written between the first page and the others", async () => {
    // newest first, as the gateway answers a sort by At; a new sample arrives right after page 1 was answered
    const rows: Row[] = [];
    for (let i = 1; i <= 250; i += 1) rows.push({ ItemId: `s${i}`, HostId: "h1", At: new Date(NOW.getTime() - i * 60_000).toISOString(), CpuPercent: 1, MemUsedMb: 1, RunningJobs: 0, ActiveAgents: 0 });
    let served = 0;
    const svc = {
      async find(_schema: string, o: { page?: number; pageSize?: number }) {
        const page = o.page ?? 1;
        const size = o.pageSize ?? 100;
        const answer = { items: rows.slice((page - 1) * size, page * size).map((r) => ({ ...r })), totalCount: rows.length };
        if (++served === 1) rows.unshift({ ItemId: "s0", HostId: "h1", At: NOW.toISOString(), CpuPercent: 1, MemUsedMb: 1, RunningJobs: 0, ActiveAgents: 0 });
        return answer;
      },
    };
    const out = await readSamples(svc as never, "h1", NOW.getTime() - 24 * 3_600_000);
    expect(out.failed).toBe(false);
    expect(out.samples).toHaveLength(250);
    expect(new Set(out.samples.map((s) => s.at)).size).toBe(250);
    expect(out.samples.every((s, i) => i === 0 || out.samples[i - 1]!.at < s.at)).toBe(true);
  });
});

describe("platform.ai.accounts", () => {
  it("lists the accounts (no credentials: labels and numbers) with the default threshold", async () => {
    const t = setup();
    const r = await t.call(ADMIN, "platform.ai.accounts.list");
    expect(r.status).toBe(200);
    expect(r.body.data.rotateAtPercent).toBe(99);
    expect(r.body.data.rotateIsDefault).toBe(true);
    expect(r.body.data.accounts.map((a: { label: string }) => a.label)).toEqual(["sub-a", "api-key"]);
    expect(r.body.data.accounts[0]).toMatchObject({ usage5hPercent: 42, usage7dPercent: null, status: "active" });
    expect(JSON.stringify(r.body.data)).not.toMatch(/CLAUDE_CONFIG_DIR|secrets|\.key/);
  });

  it("saves status, priority, note and the threshold, and audits them", async () => {
    const t = setup();
    const r = await t.call(ADMIN, "platform.ai.accounts.save", {
      changes: [{ itemId: t.subId, status: "standby", priority: 5, note: "  Team plan\n second line " }],
      rotateAtPercent: 95,
    });
    expect(r.status).toBe(200);
    const row = t.gateway.rows("AiAccount").find((x) => x.ItemId === t.subId)!;
    expect(row).toMatchObject({ Status: "standby", Priority: 5, Note: "Team plan second line" });
    const setting = t.gateway.rows("PlatformSetting").find((x) => x.Key === "engine.rotateAtPercent")!;
    expect(setting.ValueJson).toBe("95");
    expect(r.body.data.rotateAtPercent).toBe(95);
    const actions = t.gateway.rows("AuditEvent").map((x) => `${x.Action}:${x.TargetType}`);
    expect(actions).toEqual(expect.arrayContaining(["platform.ai.accounts.save:ai-account", "platform.ai.accounts.save:platform-setting"]));

    const again = await t.call(ADMIN, "platform.ai.accounts.list");
    expect(again.body.data).toMatchObject({ rotateAtPercent: 95, rotateIsDefault: false });
  });

  it("refuses cooling (the engine's own), a threshold out of range, a credential in a note and an unknown account", async () => {
    const t = setup();
    const bad = async (args: Record<string, unknown>) => (await t.call(ADMIN, "platform.ai.accounts.save", args)).body.error?.code;
    expect(await bad({ changes: [{ itemId: t.subId, status: "cooling" }] })).toBe("invalid_input");
    expect(await bad({ rotateAtPercent: 101 })).toBe("invalid_input");
    expect(await bad({ rotateAtPercent: 10 })).toBe("invalid_input");
    expect(await bad({ changes: [{ itemId: t.subId, note: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" }] })).toBe("invalid_input");
    expect(await bad({})).toBe("invalid_input");
    expect(await bad({ changes: [{ itemId: "0123456789abcdef01234567", status: "disabled" }] })).toBe("not_found");
    expect(t.gateway.rows("AiAccount").find((x) => x.ItemId === t.subId)?.Status).toBe("active");
  });
});
