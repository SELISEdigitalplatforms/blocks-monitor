// The billing views' short-lived answers (functions/billing/ops/readCache.ts): billing.summary per organization,
// billing.usage.report per period and grouping and billing.balances.list, each for 5 s (half the 10 s the usage screens
// read at while an engine job runs), through the real router over a memory gateway;
// every billing write drops what it can affect, a read in flight during a write never fills the cache, and the access
// check still runs on every call.
import { beforeEach, describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { BILLING_DEFS } from "../../functions/billing/ops/index";
import {
  BALANCES_CACHE_MS, SUMMARY_CACHE_MS, USAGE_REPORT_CACHE_MS, createReadCache, noteBillingWrite, summaryCache, usageReportCache, usageReportKey,
} from "../../functions/billing/ops/readCache";
import { USAGE_BUSY_MS } from "../../src/blocks/billing/usage";

const OWNER = { userId: "owner-1", email: "owner@example.org" };
const OTHER = { userId: "other-1", email: "other@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };

function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { name: "Cache Co", members: [{ ...OWNER, roleKey: "owner" }] });
  seedWorkspace(gateway, { name: "Elsewhere", members: [{ ...OTHER, roleKey: "owner" }] });
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  let n = 0;
  // the credit entries read so far (the gateway logs every call)
  const reads = { get CreditEntry() { return gateway.calls.filter((c) => c.schema === "CreditEntry" && c.method !== "insert" && c.method !== "update").length; } };
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp("billing", BILLING_DEFS, { ctx: fakeCtx(who), gateway, request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` } });
  return { gateway, workspaceId, call, reads };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};

beforeEach(() => noteBillingWrite());

describe("createReadCache", () => {
  it("answers repeats within the window from the cache, one load per key at a time, and copies out", async () => {
    let t = 0;
    let loads = 0;
    const c = createReadCache<{ n: number }>({ ttlMs: 1_000, now: () => t });
    const load = async () => ({ n: ++loads });
    const [a, b] = await Promise.all([c.read("k", load), c.read("k", load)]);
    expect(loads).toBe(1);
    expect(a).toEqual({ n: 1 });
    a.n = 99; // a caller cannot change the held answer
    expect(await c.read("k", load)).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    t = 999;
    expect((await c.read("k", load)).n).toBe(1);
    t = 1_000;
    expect((await c.read("k", load)).n).toBe(2);
    expect(loads).toBe(2);
  });

  it("a drop during a load keeps that load's answer out of the cache", async () => {
    let release!: (v: { n: number }) => void;
    const c = createReadCache<{ n: number }>({ ttlMs: 60_000 });
    const slow = c.read("ws-1", () => new Promise((r) => { release = r; }));
    c.drop("ws-1"); // a write landed while the read was under way
    release({ n: 1 });
    expect(await slow).toEqual({ n: 1 }); // the caller who asked still gets it
    expect(c.size()).toBe(0);
    expect(await c.read("ws-1", async () => ({ n: 2 }))).toEqual({ n: 2 });
    expect(c.size()).toBe(1);
  });

  it("clear() during a load and prefix drops work the same way; failed answers are not kept", async () => {
    let release!: (v: { n: number }) => void;
    const c = createReadCache<{ n: number }>({ ttlMs: 60_000 });
    const slow = c.read("a|1", () => new Promise((r) => { release = r; }));
    c.clear();
    release({ n: 1 });
    await slow;
    expect(c.size()).toBe(0);
    await c.read("a|1", async () => ({ n: 1 }));
    await c.read("a|2", async () => ({ n: 2 }));
    await c.read("b|1", async () => ({ n: 3 }));
    c.drop("a|*");
    expect(c.size()).toBe(1);
    await c.read("x", async () => ({ n: -1 }), (v) => v.n > 0);
    expect(c.size()).toBe(1);
    await expect(c.read("y", async () => { throw new Error("gateway down"); })).rejects.toThrow("gateway down");
    expect(c.size()).toBe(1);
  });

  it("keeps at most `max` answers, the oldest dropped first", async () => {
    const c = createReadCache<number>({ ttlMs: 60_000, max: 2 });
    for (const k of ["a", "b", "c"]) await c.read(k, async () => 1);
    expect(c.size()).toBe(2);
  });

  it("a period that ends now is one key; a fixed end keeps its own", () => {
    const now = Date.parse("2026-11-09T10:00:00.000Z");
    const a = usageReportKey("2026-11-01T00:00:00.000Z", "2026-11-09T10:00:00.000Z", "workspace", now);
    const b = usageReportKey("2026-11-01T00:00:00.000Z", "2026-11-09T10:00:42.000Z", "workspace", now + 42_000);
    expect(a).toBe(b);
    expect(usageReportKey("2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "workspace", now)).not.toBe(a);
    expect(usageReportKey("2026-11-01T00:00:00.000Z", "2026-11-09T10:00:00.000Z", "day", now)).not.toBe(a);
    // no answer is held longer than half the fastest pace the usage screens read at (src/blocks/billing/usage.ts)
    for (const ms of [SUMMARY_CACHE_MS, USAGE_REPORT_CACHE_MS, BALANCES_CACHE_MS]) {
      expect(ms).toBe(5_000);
      expect(ms).toBeLessThanOrEqual(USAGE_BUSY_MS / 2);
    }
  });
});

describe("billing.summary and billing.usage.report through the router", () => {
  it("a repeat summary reads no credit entries; a coupon, a purchase request or an adjustment is seen at once", async () => {
    const t = setup();
    const first = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    const after1 = t.reads.CreditEntry;
    expect(after1).toBeGreaterThan(0);
    const again = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(again).toEqual(first);
    expect(t.reads.CreditEntry).toBe(after1);

    // an adjustment (a billing command writing a credit entry) drops the organization's summary
    data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 25, note: "Goodwill" }));
    const adjusted = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(adjusted.balanceUsd).toBeCloseTo(first.balanceUsd + 25, 2);

    // a purchase request shows in the summary's pending list straight away
    data(await t.call(OWNER, "billing.requestPurchase", { workspaceId: t.workspaceId, amountUsd: 50 }));
    const requested = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(requested.pendingRequests).toHaveLength(1);
  });

  it("the membership check still runs on every call: a cached summary is never handed to a non-member", async () => {
    const t = setup();
    data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    const refused = await t.call(OTHER, "billing.summary", { workspaceId: t.workspaceId });
    expect(refused.body.error?.code).toBe("not_member");
  });

  it("the usage report is shared for a period ending now; an adjustment drops it", async () => {
    const t = setup();
    const from = "2026-11-01T00:00:00.000Z";
    const report = () => t.call(SUPER, "billing.usage.report", { from, to: new Date().toISOString(), groupBy: "workspace" });
    data(await report());
    const after1 = t.reads.CreditEntry;
    data(await report());
    expect(t.reads.CreditEntry).toBe(after1);
    expect(usageReportCache.size()).toBe(1);
    data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 5, note: "Fix" }));
    expect(usageReportCache.size()).toBe(0);
    expect(summaryCache.size()).toBe(0);
    data(await report());
    expect(t.reads.CreditEntry).toBeGreaterThan(after1);
  });

  it("the report's permission check still runs: an organization owner without the platform permission is refused", async () => {
    const t = setup();
    data(await t.call(SUPER, "billing.usage.report", { from: "2026-11-01T00:00:00.000Z", to: new Date().toISOString(), groupBy: "workspace" }));
    const refused = await t.call(OWNER, "billing.usage.report", { from: "2026-11-01T00:00:00.000Z", to: new Date().toISOString(), groupBy: "workspace" });
    expect(refused.status).not.toBe(200);
  });
});

describe("billing.balances.list", () => {
  it("is shared for 5 s after the permission check, and a billing write drops it", async () => {
    const t = setup();
    const first = data(await t.call(SUPER, "billing.balances.list"));
    const after1 = t.reads.CreditEntry;
    data(await t.call(SUPER, "billing.balances.list"));
    expect(t.reads.CreditEntry).toBe(after1);
    expect((await t.call(OWNER, "billing.balances.list")).status).not.toBe(200);
    data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 7, note: "Fix" }));
    const next = data(await t.call(SUPER, "billing.balances.list"));
    const row = (d: { rows: { workspaceId: string; balanceUsd: number }[] }) => d.rows.find((r) => r.workspaceId === t.workspaceId)!;
    expect(row(next).balanceUsd).toBeCloseTo(row(first).balanceUsd + 7, 2);
  });
});
