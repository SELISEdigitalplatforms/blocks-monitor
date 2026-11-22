// The billing ops through the real router: permissions (platform vs. organization), the sign-up grant, coupon limits,
// purchase approval, adjustments, the usage report; the engine's usage capture (idempotent per job) and the backfill.
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedRow, seedWorkspace, type MemoryGateway } from "../../functions/_lib/testing";
import { BILLING_DEFS } from "../../functions/billing/ops/index";
import { noteBillingWrite } from "../../functions/billing/ops/readCache";
import { recordLaneUsage } from "../../server/local/engine/usage";
import { logIdOf, usagePlan } from "../../server/blocks/engineWorker/usageBackfill";
import { seedCatalogue } from "./catalogue";

const OWNER = { userId: "owner-1", email: "owner@example.org" };
const MEMBER = { userId: "member-1", email: "member@example.org" };
const OTHER = { userId: "other-1", email: "other@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };

const LINE = (cost: string, total = 1000) => `tokens: ${total} (in 10 / out 20 / cache-read 900 / cache-write 70), cost $${cost}, models claude-opus-4-1+claude-sonnet-4-5`;

/** An organization, a member and another organization; the plan catalogue stored (as the platform's seed stores it)
 *  unless `catalogue` is false. */
function setup(o: { catalogue?: boolean } = {}) {
  const gateway = memoryGateway();
  // every test has its own data store: answers the billing views hold from another test are dropped (readCache.ts)
  noteBillingWrite();
  if (o.catalogue !== false) seedCatalogue(gateway);
  const { workspaceId } = seedWorkspace(gateway, {
    name: "Acme",
    members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }],
  });
  const other = seedWorkspace(gateway, { name: "Other", members: [{ ...OTHER, roleKey: "owner" }] }).workspaceId;
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  let n = 0;
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp("billing", BILLING_DEFS, { ctx: fakeCtx(who), gateway, request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` } });
  const entries = (ws = workspaceId) => gateway.rows("CreditEntry").filter((r) => r.WorkspaceId === ws);
  return { gateway, workspaceId, other, call, entries };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const code = (r: { body: any }) => r.body.error?.code;

describe("registration and permissions", () => {
  it("registers every billing op in mf-billing", async () => {
    const ops = await listRegisteredOps("billing");
    for (const op of ["billing.plans.list", "billing.summary", "billing.redeemCoupon", "billing.requestPurchase", "billing.usage.report", "billing.adjust"]) {
      expect(ops).toContain(op);
    }
  });

  it("lists the stored plans only: none before the catalogue is seeded, never a built-in plan", async () => {
    const empty = setup({ catalogue: false });
    expect(data(await empty.call(MEMBER, "billing.plans.list")).plans).toEqual([]);
    // the organization's plan is not in the catalogue: no plan, not the built-in Free
    expect(data(await empty.call(MEMBER, "billing.summary", { workspaceId: empty.workspaceId })).plan).toBeNull();
    data(await empty.call(SUPER, "billing.plans.seed"));
    expect(data(await empty.call(MEMBER, "billing.plans.list")).plans.map((p: { key: string }) => p.key)).toEqual(["free", "classic", "speed", "enterprise"]);

    const t = setup();
    const { plans } = data(await t.call(MEMBER, "billing.plans.list"));
    expect(plans.map((p: { key: string }) => p.key)).toEqual(["free", "classic", "speed", "enterprise"]);
    expect(plans[3]).toMatchObject({ priceUsd: null, contactSales: true });
  });

  it("names the organization's plan from the catalogue, never another plan when its own is not listed", async () => {
    const t = setup({ catalogue: false });
    seedCatalogue(t.gateway, [{ key: "classic", name: "Classic", priceUsd: 249, creditUsd: 250, assisted: "tech-lead", maxParallelStreams: 3, priority: 2, features: [], contactSales: false, active: true, sortOrder: 2 }]);
    seedRow(t.gateway, "Subscription", { WorkspaceId: t.workspaceId, PlanKey: "classic", Status: "active", StartedAt: "2026-11-01T00:00:00.000Z", RenewsAt: "2026-12-01T00:00:00.000Z" });
    expect(data(await t.call(MEMBER, "billing.summary", { workspaceId: t.workspaceId })).plan).toEqual({ key: "classic", name: "Classic", assisted: "tech-lead", maxParallelStreams: 3 });
    // on Speed, which the catalogue does not list: no plan (not Classic, not the built-in Speed or Free)
    noteBillingWrite();
    const other = setup({ catalogue: false });
    seedCatalogue(other.gateway, [{ key: "free", name: "Free", priceUsd: 0, creditUsd: 50, assisted: "none", maxParallelStreams: 1, priority: 1, features: [], contactSales: false, active: true, sortOrder: 1 }]);
    seedRow(other.gateway, "Subscription", { WorkspaceId: other.workspaceId, PlanKey: "speed", Status: "active", StartedAt: "2026-11-01T00:00:00.000Z", RenewsAt: "2026-12-01T00:00:00.000Z" });
    expect(data(await other.call(MEMBER, "billing.summary", { workspaceId: other.workspaceId })).plan).toBeNull();
  });

  it("keeps platform ops to the platform permissions", async () => {
    const t = setup();
    for (const [op, args] of [
      ["billing.plans.save", { plan: { key: "free" } }],
      ["billing.coupons.list", {}],
      ["billing.purchases.list", {}],
      ["billing.adjust", { workspaceId: t.workspaceId, amountUsd: 10, note: "x" }],
      ["billing.balances.list", {}],
      ["billing.usage.report", { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z", groupBy: "workspace" }],
    ] as const) {
      const r = await t.call(OWNER, op, args as Record<string, unknown>);
      expect([403, 400]).toContain(r.status);
      if (r.status === 403) expect(code(r)).toBe("forbidden");
    }
    expect(t.entries()).toHaveLength(0);
  });

  it("keeps organization ops to members of that organization", async () => {
    const t = setup();
    expect(code(await t.call(OTHER, "billing.summary", { workspaceId: t.workspaceId }))).toBe("not_member");
    expect(code(await t.call(OTHER, "billing.requestPurchase", { workspaceId: t.workspaceId, planKey: "classic" }))).toBe("not_member");
    expect(data(await t.call(MEMBER, "billing.summary", { workspaceId: t.workspaceId })).plan.key).toBe("free");
  });
});

describe("plans and settings", () => {
  it("saves a plan (super admin) and seeds the defaults once", async () => {
    const t = setup({ catalogue: false });
    const seeded = data(await t.call(SUPER, "billing.plans.seed"));
    expect(seeded.created).toEqual(["free", "classic", "speed", "enterprise"]);
    expect(data(await t.call(SUPER, "billing.plans.seed")).created).toEqual([]);
    const plan = { key: "classic", name: "Classic", priceUsd: 249, creditUsd: 250, assisted: "tech-lead", maxParallelStreams: 3, priority: 2, features: ["More"], contactSales: false, active: true, sortOrder: 2 };
    data(await t.call(SUPER, "billing.plans.save", { plan }));
    const { plans } = data(await t.call(MEMBER, "billing.plans.list"));
    expect(plans.find((p: { key: string }) => p.key === "classic")).toMatchObject({ priceUsd: 249, creditUsd: 250, maxParallelStreams: 3 });
    expect(t.gateway.rows("Plan").filter((r) => r.Key === "classic")).toHaveLength(1);
    expect(code(await t.call(SUPER, "billing.plans.save", { plan: { ...plan, priceUsd: 1.234 } }))).toBe("invalid_input");
  });

  it("saves the price factor and the sign-up credit", async () => {
    const t = setup();
    expect(data(await t.call(SUPER, "billing.settings.get"))).toEqual({ priceFactor: 1, signupCreditUsd: 50, source: "factory" });
    expect(data(await t.call(SUPER, "billing.settings.save", { priceFactor: 1.5, signupCreditUsd: 25 }))).toEqual({ priceFactor: 1.5, signupCreditUsd: 25, source: "factory" });
    expect(data(await t.call(SUPER, "billing.settings.get"))).toEqual({ priceFactor: 1.5, signupCreditUsd: 25, source: "factory" });
    expect(code(await t.call(SUPER, "billing.settings.save", { priceFactor: 0 }))).toBe("invalid_input");
  });
});

describe("sign-up grant", () => {
  it("puts a new organization on Free with the sign-up credit once per person", async () => {
    const gateway = memoryGateway();
    seedRow(gateway, "Account", { UserId: OWNER.userId, Email: OWNER.email, Status: "active" });
    const { WORKSPACE_DEFS } = await import("../../functions/workspace/ops/index");
    const create = (name: string, requestId: string) =>
      runOp("workspace", WORKSPACE_DEFS, { ctx: fakeCtx(OWNER), gateway, request: { op: "workspace.create", args: { name }, requestId } });
    const first = await create("First", "req-create-first-abcdefgh");
    expect(first.status).toBe(200);
    await create("First", "req-create-first-abcdefgh"); // a retry
    await create("Second", "req-create-second-abcdefgh");
    const signup = gateway.rows("CreditEntry").filter((r) => r.Kind === "signup");
    expect(signup).toHaveLength(1);
    expect(signup[0]).toMatchObject({ AmountCents: 5000, AmountUsd: 50, UserId: OWNER.userId });
    expect(gateway.rows("Subscription").map((r) => r.PlanKey)).toEqual(["free", "free"]);
  });
});

describe("coupons", () => {
  it("redeems once per organization, up to the coupon's limit", async () => {
    const t = setup();
    const { coupon } = data(await t.call(SUPER, "billing.coupons.save", { code: "welcome-10", amountUsd: 10.5, maxRedemptions: 1 }));
    expect(coupon).toMatchObject({ code: "WELCOME-10", amountUsd: 10.5, redemptions: 0, active: true });
    const ok = data(await t.call(MEMBER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: " welcome-10 " }));
    expect(ok).toEqual({ amountUsd: 10.5, planKey: null, balanceUsd: 10.5 });
    expect(code(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "WELCOME-10" }))).toBe("conflict");
    expect(code(await t.call(OTHER, "billing.redeemCoupon", { workspaceId: t.other, code: "WELCOME-10" }))).toBe("limit_reached");
    expect(code(await t.call(OTHER, "billing.redeemCoupon", { workspaceId: t.other, code: "NOPE-0000" }))).toBe("not_found");
    expect(t.entries(t.other)).toHaveLength(0);
    expect(t.gateway.rows("Coupon")[0]!.Redemptions).toBe(1);
  });

  it("refuses expired and deactivated coupons; a plan coupon sets the plan", async () => {
    const t = setup();
    data(await t.call(SUPER, "billing.coupons.save", { code: "OLD-0001", amountUsd: 5, expiresAt: "2020-01-01T00:00:00Z", maxRedemptions: 0 }));
    expect(code(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "OLD-0001" }))).toBe("forbidden");
    const { coupon } = data(await t.call(SUPER, "billing.coupons.save", { code: "SPEED-001", amountUsd: 0, planKey: "speed", maxRedemptions: 0 }));
    data(await t.call(SUPER, "billing.coupons.save", { id: coupon.id, active: false }));
    expect(code(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "SPEED-001" }))).toBe("forbidden");
    data(await t.call(SUPER, "billing.coupons.save", { id: coupon.id, active: true }));
    expect(data(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "SPEED-001" })).planKey).toBe("speed");
    expect(data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId })).plan.key).toBe("speed");
  });
});

describe("purchase requests and adjustments", () => {
  it("approving a plan request sets the subscription and grants the plan's credit once", async () => {
    const t = setup();
    const { request } = data(await t.call(MEMBER, "billing.requestPurchase", { workspaceId: t.workspaceId, planKey: "classic", note: "Please" }));
    expect(request).toMatchObject({ status: "pending", planKey: "classic", note: "Please", workspaceName: "Acme" });
    const list = data(await t.call(SUPER, "billing.purchases.list", { status: "pending" }));
    expect(list.requests).toHaveLength(1);
    expect(list.items).toHaveLength(1);
    const decided = data(await t.call(SUPER, "billing.purchases.decide", { id: request.id, decision: "approve" }));
    expect(decided.request.status).toBe("approved");
    expect(code(await t.call(SUPER, "billing.purchases.decide", { id: request.id, decision: "approve" }))).toBe("conflict");
    const s = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(s.plan.key).toBe("classic");
    expect(s.balanceUsd).toBe(200);
    expect(s.subscription.renewsAt).not.toBe("");
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(1);
  });

  it("a declined request grants nothing; credit purchases and asks are validated", async () => {
    const t = setup();
    const { request } = data(await t.call(OWNER, "billing.requestPurchase", { workspaceId: t.workspaceId, amountUsd: 100 }));
    data(await t.call(SUPER, "billing.purchases.decide", { id: request.id, decision: "decline" }));
    expect(t.entries()).toHaveLength(0);
    expect(code(await t.call(OWNER, "billing.requestPurchase", { workspaceId: t.workspaceId }))).toBe("invalid_input");
    expect(code(await t.call(OWNER, "billing.requestPurchase", { workspaceId: t.workspaceId, planKey: "classic", amountUsd: 5 }))).toBe("invalid_input");
    expect(code(await t.call(OWNER, "billing.requestPurchase", { workspaceId: t.workspaceId, amountUsd: 5, note: "x".repeat(501) }))).toBe("invalid_input");
  });

  it("adjusts with a reason, either way, and the balance follows", async () => {
    const t = setup();
    expect(data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 20.25, note: "Goodwill" })).balanceUsd).toBe(20.25);
    expect(data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: -5.1, note: "Correction" })).balanceUsd).toBe(15.15);
    expect(code(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 5, note: "  " }))).toBe("invalid_input");
    const { rows } = data(await t.call(SUPER, "billing.balances.list"));
    expect(rows.find((r: { workspaceId: string }) => r.workspaceId === t.workspaceId)).toMatchObject({ balanceUsd: 15.15, grantedUsd: 15.15, consumedUsd: 0 });
  });
});

function seedJob(gateway: MemoryGateway, workspaceId: string, projectId = "project-1"): string {
  return seedRow(gateway, "EngineJob", {
    WorkspaceId: workspaceId, ReaderIds: [OWNER.userId], ProjectId: projectId, Kind: "change.build", Status: "running", ActiveKey: "k",
    RequestedByUserId: OWNER.userId, CreatedByUserId: OWNER.userId, Attempts: 1, Progress: 10,
  });
}

describe("usage capture", () => {
  it("adds every lane run to the job and keeps ONE usage entry per job, at cost x price factor", async () => {
    const t = setup();
    data(await t.call(SUPER, "billing.settings.save", { priceFactor: 1.5 }));
    const jobId = seedJob(t.gateway, t.workspaceId);
    await recordLaneUsage(t.gateway, jobId, `log...\n${LINE("2.0000")}\n`, "2026-11-09T10:00:00.000Z");
    await recordLaneUsage(t.gateway, jobId, `${LINE("1.0010", 500)}`, "2026-11-09T11:00:00.000Z");
    expect(await recordLaneUsage(t.gateway, jobId, "no summary", "2026-11-09T11:00:00.000Z")).toBeNull();
    const usage = JSON.parse(String(t.gateway.rows("EngineJob").find((r) => r.ItemId === jobId)!.UsageJson));
    expect(usage).toMatchObject({ costUsd: 3.001, lanes: 2, tokens: { total: 1500 } });
    const entries = t.entries().filter((e) => e.Kind === "usage");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ JobId: jobId, AmountCents: -450, AmountUsd: -4.5, Tokens: 1500, UserId: OWNER.userId, ProjectId: "project-1" });
    const s = data(await t.call(MEMBER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(s).toMatchObject({ consumedUsd: 4.5, balanceUsd: -4.5, tokens: 1500, runningJobs: 1 });
    expect(s.jobs[0]).toMatchObject({ jobId, costUsd: 4.5, tokens: 1500 });
    expect(s.perProject[0]).toMatchObject({ projectId: "project-1", costUsd: 4.5 });
  });

  it("reports usage by organization, model and day (costUsd = charged, rawCostUsd = measured)", async () => {
    const t = setup();
    const a = seedJob(t.gateway, t.workspaceId);
    const b = seedJob(t.gateway, t.other, "project-2");
    await recordLaneUsage(t.gateway, a, LINE("1.0000"), "2026-11-02T10:00:00.000Z");
    await recordLaneUsage(t.gateway, b, LINE("3.0000"), "2026-11-03T10:00:00.000Z");
    const range = { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" };
    const byWs = data(await t.call(SUPER, "billing.usage.report", { ...range, groupBy: "workspace" }));
    expect(byWs.rows.map((r: { label: string; costUsd: number }) => [r.label, r.costUsd])).toEqual([["Other", 3], ["Acme", 1]]);
    expect(byWs.totals).toMatchObject({ costUsd: 4, rawCostUsd: 4, tokens: 2000, jobs: 2 });
    const byDay = data(await t.call(SUPER, "billing.usage.report", { ...range, groupBy: "day" }));
    expect(byDay.rows.map((r: { key: string }) => r.key)).toEqual(["2026-11-02", "2026-11-03"]);
    const byModel = data(await t.call(SUPER, "billing.usage.report", { ...range, groupBy: "model" }));
    expect(byModel.rows[0].label).toBe("claude-opus-4-1 + claude-sonnet-4-5");
    const none = data(await t.call(SUPER, "billing.usage.report", { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z", groupBy: "workspace" }));
    expect(none.rows).toEqual([]);
  });
});

describe("backfill", () => {
  it("maps lane logs by job id, sums their lane runs, takes reports naming a job, skips recorded jobs", () => {
    const jobs = [
      { ItemId: "6745a1b2c3d4e5f6a7b8c9d0e1", WorkspaceId: "w" },
      { ItemId: "job-two-0000000000000000", WorkspaceId: "w" },
      { ItemId: "job-three-000000000000000", WorkspaceId: "w", UsageJson: JSON.stringify({ tokens: { total: 1 }, costUsd: 1, lanes: 1 }) },
    ];
    const files = [
      { file: `/e/p/madp/logs/${logIdOf(jobs[0]!.ItemId)}-feature.log`, kind: "log" as const, text: `\n$ madp feature x\n${LINE("1.0000")}\n[exit 0]\n\n$ madp feature y\n${LINE("0.5000")}\n` },
      { file: "/e/p/madp/reports/quick/20261020-120000-fix.md", kind: "report" as const, text: `Job job-two-0000000000000000\n${LINE("0.2500")}` },
      { file: `/e/p/madp/logs/${logIdOf(jobs[2]!.ItemId)}-quick.log`, kind: "log" as const, text: LINE("9.0000") },
      { file: "/e/p/madp/reports/feature/unrelated.md", kind: "report" as const, text: LINE("7.0000") },
    ];
    const plan = usagePlan(jobs, files);
    expect(plan.map((p) => [p.jobId, p.usage.costUsd, p.usage.lanes])).toEqual([
      ["6745a1b2c3d4e5f6a7b8c9d0e1", 1.5, 2],
      ["job-two-0000000000000000", 0.25, 1],
    ]);
    expect(usagePlan(jobs, files, { force: true }).map((p) => p.jobId)).toContain("job-three-000000000000000");
  });
});
