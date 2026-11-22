// Checkout and subscriptions through the real router: coupon kinds, checkout (idempotent confirm), plan change,
// cancel and resume, monthly renewal (idempotent per period), the paywall (on/off, internal organizations) and the
// "blocks" provider answering "not connected" until the host configures it.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { createJobs } from "../../functions/_lib/jobs";
import { runBillingRenewals } from "../../server/blocks/engineWorker/billingRenewals";
import { assertPaywall } from "../../functions/_lib/paywall";
import { BILLING_DEFS } from "../../functions/billing/ops/index";
import { noteBillingWrite } from "../../functions/billing/ops/readCache";
import { blocksProvider, gatewayConfigFromEnv, providerOf } from "../../functions/billing/ops/providers";
import { couponTermsOf, couponTermsProblems, prorateCents, quoteCode, receiptNumber } from "../../src/domain/payments";
import { CATALOGUE, seedCatalogue } from "./catalogue";

const OWNER = { userId: "owner-1", email: "owner@example.org" };
const MEMBER = { userId: "member-1", email: "member@example.org" };
const OTHER = { userId: "other-1", email: "other@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };

const T0 = "2026-11-01T00:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

function setup() {
  const gateway = memoryGateway();
  // every test has its own data store: answers the billing views hold from another test are dropped (readCache.ts)
  noteBillingWrite();
  // the plan catalogue as the platform's seed stores it (nothing fills in a plan that is not stored)
  seedCatalogue(gateway);
  const { workspaceId } = seedWorkspace(gateway, { name: "Acme", members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }] });
  const second = seedWorkspace(gateway, { name: "Acme two", members: [{ ...OWNER, roleKey: "owner" }] }).workspaceId;
  const other = seedWorkspace(gateway, { name: "Other", members: [{ ...OTHER, roleKey: "owner" }] }).workspaceId;
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  let n = 0;
  let now = at(T0);
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp("billing", BILLING_DEFS, { ctx: fakeCtx(who), gateway, now: () => now, request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` } });
  const entries = (ws = workspaceId) => gateway.rows("CreditEntry").filter((r) => r.WorkspaceId === ws);
  const sub = (ws = workspaceId) => gateway.rows("Subscription").find((r) => r.WorkspaceId === ws)!;
  const setNow = (iso: string) => void (now = at(iso));
  return { gateway, workspaceId, second, other, call, entries, sub, setNow };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const err = (r: { body: any }) => r.body.error as { code: string; messageKey: string; params?: any };

type Setup = ReturnType<typeof setup>;
async function coupon(t: Setup, args: Record<string, unknown>) {
  return data(await t.call(SUPER, "billing.coupons.save", { maxRedemptions: 0, ...args })).coupon;
}

/** Puts the organization on Classic with a plan code that pays `months`. */
async function onClassic(t: Setup, months = 1, code = "CLASSIC-PAID") {
  await coupon(t, { code, kind: "plan", planKeys: ["classic"], durationMonths: months });
  const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code }));
  return data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }));
}

describe("coupon kinds", () => {
  it("validates each kind's terms", () => {
    expect(couponTermsProblems({ kind: "credit", amountUsd: 25 })).toEqual([]);
    expect(couponTermsProblems({ kind: "credit", amountUsd: 0 })).toEqual(["amountUsd"]);
    expect(couponTermsProblems({ kind: "plan", planKeys: ["classic"], durationMonths: 3 })).toEqual([]);
    expect(couponTermsProblems({ kind: "plan", planKeys: [], durationMonths: 3 })).toContain("planKeys");
    expect(couponTermsProblems({ kind: "plan", planKeys: ["classic"], durationMonths: 37 })).toContain("durationMonths");
    expect(couponTermsProblems({ kind: "discount", percentOff: 50, durationMonths: 2 })).toEqual([]);
    expect(couponTermsProblems({ kind: "discount", amountOffUsd: 20 })).toEqual([]);
    expect(couponTermsProblems({ kind: "discount", percentOff: 50, amountOffUsd: 20 })).toEqual(expect.arrayContaining(["percentOff", "amountOffUsd"]));
    expect(couponTermsProblems({ kind: "discount" })).toEqual(expect.arrayContaining(["percentOff", "amountOffUsd"]));
    expect(couponTermsProblems({ kind: "gift" })).toEqual(["kind"]);
  });

  it("reads coupons saved before kinds with their old meaning", () => {
    expect(couponTermsOf({ Code: "OLD-1", AmountUsd: 10 })).toMatchObject({ kind: "credit", amountCents: 1000, legacy: true });
    expect(couponTermsOf({ Code: "OLD-2", AmountUsd: 0, PlanKey: "speed" })).toMatchObject({ kind: "plan", planKeys: ["speed"], legacy: true });
  });

  it("quotes plan, discount and credit codes against a checkout", () => {
    const base = { planKey: "classic", kind: "new" as const, priceCents: 19900, amountCents: 19900, creditCents: 20000, monthCreditCents: 20000, periodStart: T0, periodEnd: "2026-12-01T00:00:00.000Z" };
    const plan = quoteCode(base, couponTermsOf({ Code: "P", Kind: "plan", PlanKeys: ["classic"], DurationMonths: 3 }), T0);
    expect(plan).toMatchObject({ ok: true, quote: { dueCents: 0, paidThrough: "2027-02-01T00:00:00.000Z" } });
    const half = quoteCode(base, couponTermsOf({ Code: "D", Kind: "discount", PercentOff: 50, DurationMonths: 1 }), T0);
    expect(half).toMatchObject({ ok: true, quote: { discountCents: 9950, dueCents: 9950, paidThrough: null } });
    expect(quoteCode(base, couponTermsOf({ Code: "S", Kind: "plan", PlanKeys: ["speed"] }), T0)).toEqual({ ok: false, reason: "plan-not-allowed" });
    expect(quoteCode(base, couponTermsOf({ Code: "C", Kind: "credit", AmountUsd: 10 }), T0)).toEqual({ ok: false, reason: "credit-code" });
  });

  it("saves kinds through the platform op and refuses bad terms", async () => {
    const t = setup();
    const plan = await coupon(t, { code: "PLAN-3M", kind: "plan", planKeys: ["classic", "speed"], durationMonths: 3 });
    expect(plan).toMatchObject({ kind: "plan", planKeys: ["classic", "speed"], durationMonths: 3, perPersonLimit: 1, legacy: false });
    expect(plan.description).toBe("Pays the classic or speed plan for 3 months");
    expect(err(await t.call(SUPER, "billing.coupons.save", { code: "BAD-PLAN", kind: "plan", planKeys: ["free"], durationMonths: 1 })).code).toBe("invalid_input");
    expect(err(await t.call(SUPER, "billing.coupons.save", { code: "BAD-DISC", kind: "discount", percentOff: 120 })).code).toBe("invalid_input");
    expect(err(await t.call(OWNER, "billing.coupons.save", { code: "MINE-0001", kind: "credit", amountUsd: 5 })).code).toBe("forbidden");
  });
});

describe("checkout", () => {
  it("summarizes the plan, refuses to confirm while something is due without a card provider", async () => {
    const t = setup();
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" }));
    expect(checkout).toMatchObject({
      status: "open", kind: "new", amountUsd: 199, creditUsd: 200, dueUsd: 199, renewsOn: "2026-12-01T00:00:00.000Z", canConfirm: false,
      provider: { id: "coupon", connected: true, acceptsCards: false },
    });
    expect(checkout.plan).toMatchObject({ key: "classic", assisted: "tech-lead" });
    expect(checkout.blocker).toMatch(/Card payments are being connected/);
    const r = await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id });
    expect(err(r)).toMatchObject({ code: "conflict", messageKey: "billing.checkout.paymentRequired" });
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(0);
    // a refresh answers the same checkout
    const again = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    expect(again.id).toBe(checkout.id);
  });

  it("pays with a plan code once: the receipt, the credit and the subscription; a retry grants nothing more", async () => {
    const t = setup();
    await coupon(t, { code: "CLASSIC-3M", kind: "plan", planKeys: ["classic"], durationMonths: 3 });
    const started = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    const applied = data(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: started.id, code: "classic-3m" })).checkout;
    expect(applied).toMatchObject({ dueUsd: 0, discountUsd: 199, canConfirm: true, paidThrough: "2027-02-01T00:00:00.000Z", code: { code: "CLASSIC-3M", kind: "plan" } });
    const first = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    expect(first.checkout.status).toBe("paid");
    expect(first.checkout.receipt).toMatchObject({ planKey: "classic", amountUsd: 199, discountUsd: 199, paidUsd: 0, creditUsd: 200, couponCode: "CLASSIC-3M" });
    expect(first.checkout.receipt.receiptNo).toMatch(/^MF-20261101-[0-9A-Z]{6}$/);
    expect(first.balanceUsd).toBe(200);
    const second = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    expect(second.checkout.receipt.receiptNo).toBe(first.checkout.receipt.receiptNo);
    expect(second.balanceUsd).toBe(200);
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(1);
    expect(t.sub()).toMatchObject({ PlanKey: "classic", Status: "active", RenewsAt: "2026-12-01T00:00:00.000Z", PaidThroughAt: "2027-02-01T00:00:00.000Z", CouponCode: "CLASSIC-3M" });
    expect(t.gateway.rows("Coupon")[0]!.Redemptions).toBe(1);
    // the same plan again is refused; payments list the receipt for every member
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).messageKey).toBe("billing.checkout.alreadyOnPlan");
    const account = data(await t.call(MEMBER, "billing.payments.list", { workspaceId: t.workspaceId }));
    expect(account.canManage).toBe(false);
    expect(account.payments).toHaveLength(1);
    expect(account.subscription).toMatchObject({ planKey: "classic", status: "active", cancelAtPeriodEnd: false });
  });

  it("keeps checkout and plan changes to the organization's owners", async () => {
    const t = setup();
    expect(err(await t.call(MEMBER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).code).toBe("forbidden");
    expect(err(await t.call(OTHER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).code).toBe("not_member");
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" }));
    expect(err(await t.call(MEMBER, "billing.checkout.confirm", { checkoutId: checkout.id })).code).toBe("forbidden");
    expect(err(await t.call(OTHER, "billing.payments.list", { workspaceId: t.workspaceId })).code).toBe("not_member");
    for (const op of ["billing.subscription.change", "billing.subscription.cancel", "billing.subscription.resume"]) {
      expect(err(await t.call(MEMBER, op, { workspaceId: t.workspaceId, ...(op.endsWith("change") ? { planKey: "free" } : {}) })).code).toBe("forbidden");
    }
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "enterprise" })).messageKey).toBe("billing.plan.contactSales");
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "free" })).messageKey).toBe("billing.checkout.freePlan");
  });

  it("discount codes: part off still needs a card; all off pays the plan for the code's months", async () => {
    const t = setup();
    await coupon(t, { code: "HALF-OFF", kind: "discount", percentOff: 50, durationMonths: 1 });
    await coupon(t, { code: "FREE-2M", kind: "discount", percentOff: 100, durationMonths: 2, planKeys: ["classic"] });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code: "HALF-OFF" }));
    expect(checkout).toMatchObject({ discountUsd: 99.5, dueUsd: 99.5, canConfirm: false });
    expect(checkout.blocker).toMatch(/The code takes USD 99.50 off. The remaining USD 99.50 needs a card payment/);
    expect(err(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id })).messageKey).toBe("billing.checkout.paymentRequired");
    const all = data(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: checkout.id, code: "FREE-2M" })).checkout;
    expect(all).toMatchObject({ dueUsd: 0, canConfirm: true, paidThrough: "2027-01-01T00:00:00.000Z" });
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }));
    expect(t.sub()).toMatchObject({ PlanKey: "classic", PaidThroughAt: "2027-01-01T00:00:00.000Z" });
    // a discount code for another plan is refused plainly
    expect(err(await t.call(OTHER, "billing.checkout.start", { workspaceId: t.other, planKey: "speed", code: "FREE-2M" })).messageKey).toBe("billing.coupon.planNotAllowed");
  });

  it("credit codes add credit through Redeem; plan codes are used at checkout; one person's limit holds across organizations", async () => {
    const t = setup();
    await coupon(t, { code: "CREDIT-25", kind: "credit", amountUsd: 25, perPersonLimit: 1 });
    await coupon(t, { code: "PLAN-ONE", kind: "plan", planKeys: ["classic"], durationMonths: 1, perPersonLimit: 1 });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" }));
    expect(err(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: checkout.id, code: "CREDIT-25" }))).toMatchObject({ messageKey: "billing.coupon.creditCode", params: { amountUsd: 25 } });
    expect(err(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "PLAN-ONE" }))).toMatchObject({ messageKey: "billing.coupon.useAtCheckout", params: { planKey: "classic" } });
    expect(data(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "CREDIT-25" })).amountUsd).toBe(25);
    expect(err(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.second, code: "CREDIT-25" })).messageKey).toBe("billing.coupon.personLimit");
    data(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: checkout.id, code: "PLAN-ONE" }));
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }));
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.second, planKey: "classic", code: "PLAN-ONE" })).messageKey).toBe("billing.coupon.personLimit");
  });

  it("an open checkout expires after a day", async () => {
    const t = setup();
    await coupon(t, { code: "LATE-CODE", kind: "plan", planKeys: ["classic"] });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code: "LATE-CODE" }));
    t.setNow("2026-11-02T01:00:00.000Z");
    expect(err(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id })).messageKey).toBe("billing.checkout.closed");
    const fresh = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    expect(fresh.id).not.toBe(checkout.id);
  });
});

describe("change, cancel and resume", () => {
  it("upgrades now with the prorated difference; downgrades and cancels at renewal; resume undoes them", async () => {
    const t = setup();
    await onClassic(t, 1);
    // downgrade to Free: scheduled for the renewal day
    const down = data(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "free" }));
    expect(down).toMatchObject({ action: "scheduled", planKey: "free", effectiveAt: "2026-12-01T00:00:00.000Z", subscription: { nextPlan: { key: "free" } } });
    expect(data(await t.call(OWNER, "billing.subscription.resume", { workspaceId: t.workspaceId })).subscription.nextPlan).toBeNull();
    // cancel at period end, then resume
    expect(data(await t.call(OWNER, "billing.subscription.cancel", { workspaceId: t.workspaceId })).subscription.cancelAtPeriodEnd).toBe(true);
    expect(data(await t.call(OWNER, "billing.subscription.resume", { workspaceId: t.workspaceId })).subscription.cancelAtPeriodEnd).toBe(false);
    // upgrade halfway through the period: (399 - 199) x 15/30 due, (400 - 200) x 15/30 credit, same renewal day
    expect(data(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "speed" }))).toEqual({ action: "checkout", planKey: "speed" });
    t.setNow("2026-11-16T00:00:00.000Z");
    await coupon(t, { code: "UP-FREE", kind: "discount", percentOff: 100, planKeys: ["speed"] });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed", code: "UP-FREE" }));
    expect(checkout).toMatchObject({ kind: "upgrade", fromPlan: { key: "classic" }, amountUsd: 100, creditUsd: 100, dueUsd: 0, renewsOn: "2026-12-01T00:00:00.000Z" });
    const done = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }));
    expect(done.balanceUsd).toBe(300);
    expect(t.sub()).toMatchObject({ PlanKey: "speed", RenewsAt: "2026-12-01T00:00:00.000Z", CurrentPeriodStart: T0 });
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).messageKey).toBe("billing.checkout.downgradeAtRenewal");
  });

  it("prorates by the share of the period left", () => {
    expect(prorateCents(20000, T0, "2026-12-01T00:00:00.000Z", "2026-11-16T00:00:00.000Z")).toBe(10000);
    expect(prorateCents(20000, T0, "2026-12-01T00:00:00.000Z", "2026-12-02T00:00:00.000Z")).toBe(0);
    expect(receiptNumber("abc", T0)).toBe(receiptNumber("abc", T0));
  });
});

describe("monthly renewal", () => {
  it("renews while the code pays, once per period, then marks the plan past due", async () => {
    const t = setup();
    await onClassic(t, 3);
    const plan = () => t.entries().filter((e) => e.Kind === "plan");
    t.setNow("2026-12-01T01:00:00.000Z");
    const r1 = data(await t.call(SUPER, "billing.renewals.run"));
    expect(r1.renewed).toEqual([{ workspaceId: t.workspaceId, planKey: "classic", periodStart: "2026-12-01T00:00:00.000Z" }]);
    expect(data(await t.call(SUPER, "billing.renewals.run")).renewed).toEqual([]);
    expect(plan()).toHaveLength(2);
    // two months later in one pass: January renews (still paid), February is past due
    t.setNow("2027-02-01T01:00:00.000Z");
    const r2 = data(await t.call(SUPER, "billing.renewals.run"));
    expect(r2.renewed.map((x: { periodStart: string }) => x.periodStart)).toEqual(["2027-01-01T00:00:00.000Z"]);
    expect(r2.pastDue).toEqual([{ workspaceId: t.workspaceId, planKey: "classic", since: "2027-02-01T00:00:00.000Z" }]);
    expect(plan()).toHaveLength(3);
    expect(t.sub()).toMatchObject({ Status: "past_due", PastDueSince: "2027-02-01T00:00:00.000Z" });
    expect(String(t.sub().StatusNote)).toMatch(/payment for the month from 2027-02-01 is due/);
    expect(data(await t.call(SUPER, "billing.renewals.run")).pastDue).toEqual([]);
    const account = data(await t.call(OWNER, "billing.payments.list", { workspaceId: t.workspaceId }));
    expect(account.payments.map((p: { kind: string }) => p.kind)).toEqual(["renewal", "renewal", "new"]);
    expect(err(await t.call(OWNER, "billing.subscription.resume", { workspaceId: t.workspaceId })).messageKey).toBe("billing.subscription.payToResume");
    // switching to Free while past due ends the plan now
    const free = data(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "free" }));
    expect(free).toMatchObject({ action: "scheduled", planKey: "free", effectiveAt: "2027-02-01T01:00:00.000Z", subscription: { planKey: "free", status: "active" } });
    // paying for Classic again starts a fresh period
    await coupon(t, { code: "AGAIN-1M", kind: "plan", planKeys: ["classic"] });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code: "AGAIN-1M" }));
    expect(checkout.kind).toBe("new");
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }));
    expect(t.sub()).toMatchObject({ Status: "active", PastDueSince: "", StatusNote: "" });
  });

  it("a cancelled plan ends on the renewal day; a scheduled downgrade takes effect", async () => {
    const t = setup();
    await onClassic(t, 6);
    data(await t.call(OWNER, "billing.subscription.cancel", { workspaceId: t.workspaceId }));
    t.setNow("2026-12-01T00:30:00.000Z");
    const r = data(await t.call(SUPER, "billing.renewals.run"));
    expect(r.ended).toHaveLength(1);
    expect(t.sub()).toMatchObject({ PlanKey: "free", Status: "active", RenewsAt: "", CancelAtPeriodEnd: false });
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(1);
  });

  it("runs from the engine worker on its raw gateway, once per period", async () => {
    const t = setup();
    await onClassic(t, 2);
    const now = () => new Date("2026-12-01T02:00:00.000Z");
    const first = await runBillingRenewals(t.gateway, { now, env: {} });
    expect(first.renewed).toEqual([{ workspaceId: t.workspaceId, planKey: "classic", periodStart: "2026-12-01T00:00:00.000Z" }]);
    expect((await runBillingRenewals(t.gateway, { now, env: {} })).renewed).toEqual([]);
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(2);
    expect(t.gateway.rows("Payment").filter((p) => p.Kind === "renewal")).toHaveLength(1);
    const later = await runBillingRenewals(t.gateway, { now: () => new Date("2027-01-01T02:00:00.000Z"), env: {} });
    expect(later.pastDue).toHaveLength(1);
  });

  it("is a platform op", async () => {
    const t = setup();
    expect(err(await t.call(OWNER, "billing.renewals.run")).code).toBe("forbidden");
  });

  it("leaves a plan the catalogue does not list waiting: never ended, never renewed with built-in figures", async () => {
    const gateway = memoryGateway();
    noteBillingWrite();
    seedCatalogue(gateway, CATALOGUE.filter((p) => p.key !== "classic"));
    const { workspaceId } = seedWorkspace(gateway, { name: "Acme", members: [{ ...OWNER, roleKey: "owner" }] });
    const subscription = {
      WorkspaceId: workspaceId, PlanKey: "classic", Status: "active", StartedAt: T0, CurrentPeriodStart: T0, RenewsAt: "2026-12-01T00:00:00.000Z",
      PaidThroughAt: "2027-02-01T00:00:00.000Z", CancelAtPeriodEnd: false, NextPlanKey: "",
    };
    seedRow(gateway, "Subscription", subscription);
    const now = () => new Date("2026-12-01T02:00:00.000Z");
    const waiting = await runBillingRenewals(gateway, { now, env: {} });
    expect(waiting).toMatchObject({ renewed: [], pastDue: [], ended: [], waiting: [{ workspaceId, planKey: "classic" }] });
    expect(gateway.rows("Subscription")[0]).toMatchObject(subscription);
    expect(gateway.rows("CreditEntry")).toEqual([]);
    expect(gateway.rows("Payment")).toEqual([]);
    // once the catalogue lists it, the period renews with the catalogue's own figures
    seedCatalogue(gateway, [{ ...CATALOGUE.find((p) => p.key === "classic")!, creditUsd: 240 }]);
    const renewed = await runBillingRenewals(gateway, { now, env: {} });
    expect(renewed.waiting).toEqual([]);
    expect(renewed.renewed).toEqual([{ workspaceId, planKey: "classic", periodStart: "2026-12-01T00:00:00.000Z" }]);
    expect(gateway.rows("CreditEntry").map((e) => e.AmountUsd)).toEqual([240]);
  });
});

describe("paywall", () => {
  it("is off by default; when on, work needs credit left; internal organizations are never stopped", async () => {
    const t = setup();
    expect(data(await t.call(OWNER, "billing.access", { workspaceId: t.workspaceId }))).toMatchObject({ allowed: true, enforce: false });
    await expect(assertPaywall(t.gateway, t.workspaceId)).resolves.toBeUndefined();
    expect(err(await t.call(OWNER, "billing.paywall.save", { enforce: true })).code).toBe("forbidden");
    expect(data(await t.call(SUPER, "billing.paywall.save", { enforce: true }))).toMatchObject({ enforce: true, internalWorkspaceIds: [], provider: "coupon" });
    expect(data(await t.call(OWNER, "billing.access", { workspaceId: t.workspaceId }))).toMatchObject({ allowed: false, reason: "no-credit", balanceUsd: 0 });
    await expect(assertPaywall(t.gateway, t.workspaceId)).rejects.toMatchObject({ code: "limit_reached", messageKey: "billing.paywall", params: { reason: "no-credit" } });
    // credit left lets work start
    data(await t.call(SUPER, "billing.adjust", { workspaceId: t.workspaceId, amountUsd: 5, note: "Goodwill" }));
    await expect(assertPaywall(t.gateway, t.workspaceId)).resolves.toBeUndefined();
    // an internal organization is never stopped
    await expect(assertPaywall(t.gateway, t.other)).rejects.toMatchObject({ messageKey: "billing.paywall" });
    data(await t.call(SUPER, "billing.paywall.save", { internalWorkspaceIds: [t.other] }));
    await expect(assertPaywall(t.gateway, t.other)).resolves.toBeUndefined();
    expect(data(await t.call(OTHER, "billing.access", { workspaceId: t.other }))).toMatchObject({ allowed: true, internal: true });
    expect(err(await t.call(SUPER, "billing.paywall.save", { internalWorkspaceIds: ["no-such-org"] })).code).toBe("invalid_input");
    // the engine queue refuses builds, analyses and fix rounds before writing anything; other work still starts
    let inserts = 0;
    const jobs = createJobs({
      gw: { insert: async () => ({ created: true, itemId: `j${++inserts}` }) } as never, raw: t.gateway, ids: { job: (k?: string) => `job:${k}` } as never,
      caller: { userId: OWNER.userId }, workspaceId: t.second, now: () => new Date(T0), verifiedProjectId: "p1",
    });
    for (const kind of ["build.run", "change.build", "change.analyse", "fix.analyse", "feedback.apply"] as const) {
      await expect(jobs.create({ kind, projectId: "p1", input: {} })).rejects.toMatchObject({ code: "limit_reached", messageKey: "billing.paywall" });
    }
    expect(inserts).toBe(0);
    await expect(jobs.create({ kind: "requirements.draft", projectId: "p1", input: {} })).resolves.toMatchObject({ existing: false });
    // switched off again
    data(await t.call(SUPER, "billing.paywall.save", { enforce: false }));
    await expect(jobs.create({ kind: "build.run", projectId: "p1", input: {} })).resolves.toMatchObject({ existing: false });
    await expect(assertPaywall(t.gateway, t.second)).resolves.toBeUndefined();
  });
});

describe("the blocks provider", () => {
  it("answers not connected until the host configures it; codes still pay", async () => {
    const t = setup();
    const saved = data(await t.call(SUPER, "billing.paywall.save", { provider: "blocks" }));
    expect(saved.providerStatus).toMatchObject({ id: "blocks", connected: false, acceptsCards: false });
    const { checkout } = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed" }));
    expect(checkout).toMatchObject({ canConfirm: false, provider: { id: "blocks", connected: false } });
    expect(err(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id }))).toMatchObject({ messageKey: "billing.checkout.paymentRequired" });
    await coupon(t, { code: "SPEED-1M", kind: "plan", planKeys: ["speed"] });
    data(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: checkout.id, code: "SPEED-1M" }));
    expect(data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: checkout.id })).checkout.status).toBe("paid");
    const p = providerOf("blocks", undefined, {});
    expect(await p.createCheckout({ paymentId: "p1", workspaceId: "w", planKey: "speed", dueCents: 39900, periodStart: T0, periodEnd: T0, customerEmail: "a@b.c" })).toMatchObject({ ok: false, code: "not_connected" });
    expect(await p.portalUrl({ workspaceId: "w", providerRef: "x", returnUrl: "https://x" })).toMatchObject({ ok: false, code: "not_connected" });
  });

  it("with a host configuration and transport: hosted checkout, confirm, and signed events only", async () => {
    const config = gatewayConfigFromEnv({ MF_BILLING_GATEWAY: "payments", MF_BILLING_WEBHOOK_SECRET: "whsec_test", MF_BILLING_PRICE_IDS: JSON.stringify({ speed: "price_speed" }) });
    expect(config).not.toBeNull();
    expect(gatewayConfigFromEnv({ MF_BILLING_GATEWAY: "payments", MF_BILLING_WEBHOOK_SECRET: "{{secret.x}}", MF_BILLING_PRICE_IDS: "{}" })).toBeNull();
    const calls: [string, string, unknown][] = [];
    const transport = {
      async request(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
        calls.push([method, path, body]);
        if (path === "checkout/sessions") return { id: "cs_1", url: "https://pay.example/cs_1" };
        return { payment_status: "paid", amount_total: 39900, subscription: "sub_1" };
      },
    };
    const now = at("2026-11-01T00:00:00Z");
    const p = blocksProvider({ config, transport, now: () => now });
    expect(p.status()).toMatchObject({ connected: true, acceptsCards: true });
    const opened = await p.createCheckout({ paymentId: "p1", workspaceId: "w1", planKey: "speed", dueCents: 39900, periodStart: T0, periodEnd: T0, customerEmail: "a@b.c" });
    expect(opened).toEqual({ ok: true, value: { providerRef: "cs_1", redirectUrl: "https://pay.example/cs_1" } });
    expect(calls[0]![2]).toMatchObject({ line_items: [{ price: "price_speed", quantity: 1 }], client_reference_id: "p1" });
    expect(await p.confirm({ paymentId: "p1", workspaceId: "w1", planKey: "speed", dueCents: 39900, periodStart: T0, periodEnd: T0, customerEmail: "", providerRef: "cs_1" }))
      .toEqual({ ok: true, value: { paidCents: 39900, providerRef: "sub_1" } });
    const body = JSON.stringify({ type: "checkout.session.completed", created: now / 1000, data: { object: { client_reference_id: "p1", subscription: "sub_1", amount_total: 39900 } } });
    const ts = String(Math.floor(now / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await p.handleEvent({ body, headers: { "stripe-signature": `t=${ts},v1=${sig}` } })).toMatchObject({ ok: true, value: { type: "payment.succeeded", paymentId: "p1", paidCents: 39900 } });
    expect(await p.handleEvent({ body, headers: { "stripe-signature": `t=${ts},v1=${"0".repeat(64)}` } })).toMatchObject({ ok: false, code: "declined" });
    expect(await p.handleEvent({ body: body.replace("39900", "1"), headers: { "stripe-signature": `t=${ts},v1=${sig}` } })).toMatchObject({ ok: false });
  });
});
