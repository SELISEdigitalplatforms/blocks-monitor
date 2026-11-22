// The billing ops with Blocks Utilities as the source of truth (PlatformSetting billing.source = "blocks-utilities"),
// through the real router over a fake Utilities HTTP layer (fakeUtilities.ts): switching the source, the plan
// catalogue, plan and discount codes, checkout (codes, the hosted payment page), plan changes, cancel and resume, the
// billing account with invoices, the sync (period credit, bought credit, usage per job) and the renewal run.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { BILLING_DEFS } from "../../functions/billing/ops/index";
import { billingPlansPublic } from "../../functions/billing/ops/plansPublic";
import { noteBillingWrite } from "../../functions/billing/ops/readCache";
import { runBillingRenewals } from "../../server/blocks/engineWorker/billingRenewals";
import { fakeUtilities } from "./fakeUtilities";

const OWNER = { userId: "owner-1", email: "owner@example.org" };
const MEMBER = { userId: "member-1", email: "member@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };
const ORG = "iam-org-acme";
const T0 = "2026-11-01T00:00:00.000Z";

function setup(o: { cards?: boolean; profileRequired?: boolean; linked?: boolean } = {}) {
  const gateway = memoryGateway();
  noteBillingWrite();
  let now = Date.parse(T0);
  const fake = fakeUtilities({ now: () => new Date(now).toISOString(), cards: o.cards, profileRequired: o.profileRequired });
  const { workspaceId } = seedWorkspace(gateway, { name: "Acme", members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }] });
  if (o.linked !== false) void gateway.update("Workspace", workspaceId, { IamOrganizationId: ORG });
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  let n = 0;
  /** A call as `who`; `org` is the IAM organization the caller's session is in (Host A passes it with the token). */
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}, org: string | null = ORG) =>
    runOp("billing", [...BILLING_DEFS, billingPlansPublic], {
      ctx: fakeCtx({ ...who, utilitiesCaller: { token: `token-of-${who.userId}`, organizationId: org } }),
      gateway,
      now: () => now,
      utilities: (caller) => fake.access(caller),
      request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` },
    });
  const entries = () => gateway.rows("CreditEntry").filter((r) => r.WorkspaceId === workspaceId);
  const sub = () => gateway.rows("Subscription").find((r) => r.WorkspaceId === workspaceId);
  const setNow = (iso: string) => void (now = Date.parse(iso));
  return { gateway, fake, workspaceId, call, entries, sub, setNow };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const err = (r: { body: any }) => r.body.error as { code: string; messageKey?: string; params?: any };

type T = ReturnType<typeof setup>;
/** Switches the source and puts the default plans into Utilities. */
async function onUtilities(t: T) {
  data(await t.call(SUPER, "billing.settings.save", { source: "blocks-utilities" }));
  return data(await t.call(SUPER, "billing.plans.seed"));
}

describe("switching the source", () => {
  it("stays on this platform by default and switches only when Utilities answers", async () => {
    const t = setup();
    expect(data(await t.call(SUPER, "billing.paywall.get")).source).toBe("factory");
    t.fake.failNext(503);
    expect(err(await t.call(SUPER, "billing.settings.save", { source: "blocks-utilities" }))).toMatchObject({ code: "unavailable", params: { utilitiesCode: "utilities_unavailable" } });
    expect(data(await t.call(SUPER, "billing.settings.get")).source).toBe("factory");
    expect(err(await t.call(SUPER, "billing.settings.save", { source: "stripe" })).code).toBe("invalid_input");
    expect(data(await t.call(SUPER, "billing.paywall.save", { source: "blocks-utilities" })).source).toBe("blocks-utilities");
    expect(data(await t.call(SUPER, "billing.settings.get")).source).toBe("blocks-utilities");
    // nothing of the catalogue was written to Utilities by switching
    expect(t.fake.plans).toEqual([]);
  });
});

describe("the plan catalogue in Utilities", () => {
  it("seeds the default plans with their monthly USD price, meter, entitlement and features; lists them back", async () => {
    const t = setup();
    expect((await onUtilities(t)).created).toEqual(["free", "classic", "speed", "enterprise"]);
    expect(t.fake.plans.map((p) => [p.code, p.prices.map((x) => x.unitAmountMinor)])).toEqual([["free", [0]], ["classic", [19_900]], ["speed", [39_900]], ["enterprise", []]]);
    // every catalogue call goes out on the service identity, never a caller's token
    expect(t.fake.calls.every((c) => c.org === null)).toBe(true);
    const { plans } = data(await t.call(OWNER, "billing.plans.list"));
    expect(plans.map((p: any) => [p.key, p.priceUsd, p.creditUsd, p.assisted, p.maxParallelStreams])).toEqual([
      ["free", 0, 50, "none", 1], ["classic", 199, 200, "tech-lead", 2], ["speed", 399, 400, "business", 5], ["enterprise", null, 0, "dedicated", null],
    ]);
    expect(data(await t.call(SUPER, "billing.plans.seed")).created).toEqual([]);
    // the pricing page reads the same catalogue
    const pub = data(await t.call(MEMBER, "billing.plans.public"));
    expect(pub.plans.map((p: any) => p.key)).toEqual(["free", "classic", "speed", "enterprise"]);
  });

  it("a new price is a new Utilities price (the old one archived); a feature change is a new version; switched off is archived for good", async () => {
    const t = setup();
    await onUtilities(t);
    const classic = data(await t.call(OWNER, "billing.plans.list")).plans.find((p: any) => p.key === "classic");
    data(await t.call(SUPER, "billing.plans.save", { plan: { ...classic, priceUsd: 249, features: [...classic.features, "Priority support"] } }));
    const stored = t.fake.plans.find((p) => p.code === "classic")!;
    expect(stored.prices.map((p) => p.unitAmountMinor)).toEqual([24_900]);
    expect(stored.version).toBe(2);
    noteBillingWrite();
    const after = data(await t.call(OWNER, "billing.plans.list")).plans.find((p: any) => p.key === "classic");
    expect(after).toMatchObject({ priceUsd: 249, features: expect.arrayContaining(["Priority support"]) });
    data(await t.call(SUPER, "billing.plans.save", { plan: { ...after, active: false } }));
    expect(stored.status).toBe("Archived");
    expect(data(await t.call(OWNER, "billing.plans.list")).plans.map((p: any) => p.key)).not.toContain("classic");
    expect(data(await t.call(SUPER, "billing.plans.list", { includeInactive: true })).plans.find((p: any) => p.key === "classic").active).toBe(false);
    expect(err(await t.call(SUPER, "billing.plans.save", { plan: { ...after, active: true } }))).toMatchObject({ code: "conflict", messageKey: "billing.utilities.archived" });
    // a new plan is created with its price
    data(await t.call(SUPER, "billing.plans.save", { plan: { ...after, key: "team", name: "Team", priceUsd: 99, active: true, sortOrder: 5 } }));
    expect(t.fake.plans.find((p) => p.code === "team")!.prices[0]!.unitAmountMinor).toBe(9_900);
  });
});

describe("codes", () => {
  it("keeps plan and discount codes in Utilities (lower case) and credit codes here; lists both", async () => {
    const t = setup();
    await onUtilities(t);
    const plan = data(await t.call(SUPER, "billing.coupons.save", { code: "CLASSIC-3M", kind: "plan", planKeys: ["classic"], durationMonths: 3, maxRedemptions: 0 })).coupon;
    expect(plan).toMatchObject({ code: "CLASSIC-3M", kind: "plan", source: "blocks-utilities", id: expect.stringMatching(/^utilities:/) });
    expect(t.fake.discounts[0]).toMatchObject({ code: "classic-3m", kind: "Percent", percentBasisPoints: 10_000, durationPeriods: 3, applicablePlanCodes: ["classic"], oneUsePerOrganization: true });
    data(await t.call(SUPER, "billing.coupons.save", { code: "HALF-OFF", kind: "discount", percentOff: 50, durationMonths: 2 }));
    data(await t.call(SUPER, "billing.coupons.save", { code: "GIFT-25", kind: "credit", amountUsd: 25, maxRedemptions: 0 }));
    expect(t.fake.discounts.map((d) => d.code)).toEqual(["classic-3m", "half-off"]);
    expect(t.gateway.rows("Coupon").map((r) => r.Code)).toEqual(["GIFT-25"]);
    const { coupons } = data(await t.call(SUPER, "billing.coupons.list"));
    expect(coupons.map((c: any) => [c.code, c.kind, c.source])).toEqual([["CLASSIC-3M", "plan", "blocks-utilities"], ["GIFT-25", "credit", "factory"], ["HALF-OFF", "discount", "blocks-utilities"]]);
    expect(err(await t.call(SUPER, "billing.coupons.save", { code: "classic-3m", kind: "plan", planKeys: ["classic"] }))).toMatchObject({ code: "conflict", messageKey: "billing.couponCodeTaken" });
    // a change is the discount's next version; switching off archives it, for good
    const changed = data(await t.call(SUPER, "billing.coupons.save", { id: plan.id, kind: "plan", planKeys: ["classic", "speed"], durationMonths: 6, note: "Spring" })).coupon;
    expect(changed).toMatchObject({ planKeys: ["classic", "speed"], durationMonths: 6, note: "Spring" });
    expect(t.fake.discounts[0]!.version).toBe(2);
    expect(data(await t.call(SUPER, "billing.coupons.save", { id: plan.id, active: false })).coupon.active).toBe(false);
    expect(err(await t.call(SUPER, "billing.coupons.save", { id: plan.id, active: true }))).toMatchObject({ code: "conflict", messageKey: "billing.utilities.archived" });
    // a plan code typed where credit codes are redeemed is sent to checkout
    expect(err(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "HALF-OFF" }))).toMatchObject({ messageKey: "billing.coupon.useAtCheckout" });
    // a credit code is redeemed here as before
    expect(data(await t.call(OWNER, "billing.redeemCoupon", { workspaceId: t.workspaceId, code: "GIFT-25" })).amountUsd).toBe(25);
  });
});

describe("checkout through Utilities", () => {
  it("needs a token for the workspace's organization: an unlinked workspace or another organization's session sends nothing", async () => {
    const unlinked = setup({ linked: false });
    await onUtilities(unlinked);
    const before = unlinked.fake.calls.length;
    expect(err(await unlinked.call(OWNER, "billing.checkout.start", { workspaceId: unlinked.workspaceId, planKey: "classic" }))).toMatchObject({ code: "conflict", messageKey: "billing.utilities.organization", params: { reason: "not_linked" } });
    const t = setup();
    await onUtilities(t);
    expect(err(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" }, "iam-org-other"))).toMatchObject({ messageKey: "billing.utilities.organization", params: { reason: "no_token" } });
    expect(unlinked.fake.calls.length).toBe(before);
    expect(t.fake.calls.some((c) => c.org !== null)).toBe(false);
    // a member is not an owner
    expect(err(await t.call(MEMBER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).code).toBe("forbidden");
  });

  it("pays a plan with a plan code: Utilities subscribes at nothing due, the credit is granted once, the mirror follows", async () => {
    const t = setup({ profileRequired: true });
    await onUtilities(t);
    data(await t.call(SUPER, "billing.coupons.save", { code: "CLASSIC-3M", kind: "plan", planKeys: ["classic"], durationMonths: 3 }));
    const started = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    expect(started).toMatchObject({ status: "open", amountUsd: 199, dueUsd: 199, creditUsd: 200, canConfirm: false, provider: { id: "blocks-utilities", acceptsCards: false } });
    expect(err(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: started.id, code: "NOPE-0000" }))).toMatchObject({ messageKey: "billing.couponUnknown" });
    const applied = data(await t.call(OWNER, "billing.checkout.applyCode", { checkoutId: started.id, code: "classic-3m" })).checkout;
    expect(applied).toMatchObject({ discountUsd: 199, dueUsd: 0, canConfirm: true, code: { code: "CLASSIC-3M" } });
    const done = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    expect(done.checkout).toMatchObject({ status: "paid", receipt: { planKey: "classic", paidUsd: 0, creditUsd: 200, provider: "blocks-utilities" } });
    expect(done.balanceUsd).toBe(200);
    // the billing profile the invoice needs was filled from the organization and its owner, then the subscribe retried
    expect(t.fake.profiles.get(ORG)).toMatchObject({ legalName: "Acme", billingContactEmail: OWNER.email });
    const held = t.fake.subs.get(ORG)!;
    expect(held).toMatchObject({ status: "Active", planCode: "classic" });
    expect(t.sub()).toMatchObject({ PlanKey: "classic", Status: "active", Provider: "blocks-utilities", ProviderRef: held.subscriptionId, CouponCode: "CLASSIC-3M" });
    // a retry, a second tab, the sync of the same period: nothing more
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId }));
    expect(t.entries().filter((e) => e.Kind === "plan").map((e) => e.AmountCents)).toEqual([20_000]);
    // every subscription call went out with the owner's or member's own token for the organization
    expect(t.fake.calls.filter((c) => c.path.startsWith("/subscriptions") || c.path.startsWith("/subscription-discounts/preview")).every((c) => c.org === ORG)).toBe(true);
    // the code is used: one use per organization
    const again = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed" })).checkout;
    expect(again.kind).toBe("upgrade");
  });

  it("sends the buyer to Utilities' payment page and settles when the payment arrived", async () => {
    const t = setup({ cards: true });
    await onUtilities(t);
    const started = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed" })).checkout;
    expect(started).toMatchObject({ dueUsd: 399, canConfirm: true, provider: { acceptsCards: true }, redirectUrl: null });
    const waiting = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id })).checkout;
    expect(waiting).toMatchObject({ status: "open", redirectUrl: expect.stringMatching(/^https:\/\/pay\.test\.invalid\/checkout\//) });
    expect(t.entries().filter((e) => e.Kind === "plan")).toHaveLength(0);
    // back from the page before the webhook: still waiting, nothing granted
    expect(data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id })).checkout.status).toBe("open");
    t.fake.pay(ORG);
    const paid = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    expect(paid.checkout).toMatchObject({ status: "paid", receipt: { paidUsd: 399, creditUsd: 400 } });
    expect(paid.balanceUsd).toBe(400);
    // the account shows Utilities' subscription and its invoices
    const account = data(await t.call(MEMBER, "billing.payments.list", { workspaceId: t.workspaceId }));
    expect(account).toMatchObject({ source: "blocks-utilities", subscription: { planKey: "speed", status: "active" }, invoices: [{ number: "INV-0001", total: 399, planName: "Speed" }] });
    expect(account.payments).toHaveLength(1);
  });

  it("settles a checkout paid on the payment page when the buyer comes back to the billing page (the sync)", async () => {
    const t = setup({ cards: true });
    await onUtilities(t);
    const started = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id }));
    expect(data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId })).checkoutsSettled).toBe(0);
    t.fake.pay(ORG);
    const synced = data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId }));
    expect(synced).toMatchObject({ checkoutsSettled: 1, creditGranted: false, subscription: { planKey: "classic", provider: "blocks-utilities" } });
    expect(t.gateway.rows("Payment").find((r) => r.ItemId === started.id)).toMatchObject({ Status: "paid", PaidUsd: 199 });
    expect(t.entries().filter((e) => e.Kind === "plan").map((e) => e.AmountCents)).toEqual([20_000]);
    // the owner's confirm afterwards answers the same receipt
    expect(data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: started.id })).checkout.status).toBe("paid");
  });
});

describe("plan changes, cancel and resume", () => {
  async function onSpeed(t: T) {
    await onUtilities(t);
    data(await t.call(SUPER, "billing.coupons.save", { code: "SPEED-1M", kind: "plan", planKeys: ["speed"], durationMonths: 1 }));
    const c = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed", code: "SPEED-1M" })).checkout;
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: c.id }));
  }

  it("schedules a lower plan in Utilities, keeps the plan on resume, cancels at the period's end and resumes", async () => {
    const t = setup({ cards: true });
    await onSpeed(t);
    const down = data(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "classic" }));
    expect(down).toMatchObject({ action: "scheduled", planKey: "classic", effectiveAt: "2026-12-01T00:00:00.000Z", subscription: { planKey: "speed", nextPlan: { key: "classic" } } });
    expect(t.fake.subs.get(ORG)!.pendingPlanChange?.targetPlanCode).toBe("classic");
    const kept = data(await t.call(OWNER, "billing.subscription.resume", { workspaceId: t.workspaceId }));
    expect(kept.subscription.nextPlan).toBeNull();
    expect(t.fake.subs.get(ORG)!.pendingPlanChange).toBeNull();
    const cancelled = data(await t.call(OWNER, "billing.subscription.cancel", { workspaceId: t.workspaceId }));
    expect(cancelled.subscription).toMatchObject({ planKey: "speed", cancelAtPeriodEnd: true });
    expect(t.fake.subs.get(ORG)!.cancelAtPeriodEnd).toBe(true);
    expect(data(await t.call(OWNER, "billing.subscription.resume", { workspaceId: t.workspaceId })).subscription.cancelAtPeriodEnd).toBe(false);
    // the plan agreed with sales is not bought here
    expect(err(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "enterprise" }))).toMatchObject({ messageKey: "billing.plan.contactSales" });
    expect(err(await t.call(OWNER, "billing.subscription.change", { workspaceId: t.workspaceId, planKey: "nope" })).code).toBe("not_found");
  });

  it("an upgrade is charged by Utilities (its plan change) and adds the credit difference for the rest of the period", async () => {
    const t = setup({ cards: true });
    await onUtilities(t);
    data(await t.call(SUPER, "billing.coupons.save", { code: "CLASSIC-1M", kind: "plan", planKeys: ["classic"], durationMonths: 1 }));
    const c = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code: "CLASSIC-1M" })).checkout;
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: c.id }));
    t.setNow("2026-11-16T00:00:00.000Z");
    const up = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "speed" })).checkout;
    expect(up).toMatchObject({ kind: "upgrade", amountUsd: 200, dueUsd: 200, fromPlan: { key: "classic" } });
    expect(up.creditUsd).toBeCloseTo(100, 0);
    const paid = data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: up.id })).checkout;
    expect(paid.status).toBe("paid");
    expect(t.fake.subs.get(ORG)!.planCode).toBe("speed");
    expect(t.sub()).toMatchObject({ PlanKey: "speed", Provider: "blocks-utilities" });
  });
});

describe("the sync", () => {
  it("grants a renewed period's credit once, mirrors bought credit and reports each finished job's usage once", async () => {
    const t = setup({ cards: true });
    await onUtilities(t);
    const c = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic" })).checkout;
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: c.id }));
    t.fake.pay(ORG);
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: c.id }));
    // two jobs used credit this period; one has finished
    for (const [id, status, cents] of [["job-1", "succeeded", 1234], ["job-2", "running", 500]] as const) {
      seedRow(t.gateway, "EngineJob", { ItemId: id, WorkspaceId: t.workspaceId, ReaderIds: [OWNER.userId], ProjectId: "p-1", Status: status, Kind: "build.run", ActiveKey: id });
      seedRow(t.gateway, "CreditEntry", { WorkspaceId: t.workspaceId, Kind: "usage", AmountCents: -cents, AmountUsd: -cents / 100, Tokens: 9000, JobId: id, ProjectId: "p-1", At: "2026-11-05T00:00:00.000Z" });
    }
    const first = data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId }));
    expect(first).toMatchObject({ creditGranted: false, usageReported: 1, purchasesMirrored: 0 });
    expect(t.fake.usage).toEqual([{ org: ORG, key: "job:job-1", quantity: 1234, metadata: { jobId: "job-1", projectId: "p-1", tokens: "9000" } }]);
    expect(data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId })).usageReported).toBe(0);
    // Utilities renews: the next period's credit, once
    t.fake.renew(ORG);
    t.setNow("2026-12-01T01:00:00.000Z");
    expect(data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId })).creditGranted).toBe(true);
    expect(data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId })).creditGranted).toBe(false);
    expect(t.entries().filter((e) => e.Kind === "plan").map((e) => e.AmountCents)).toEqual([20_000, 20_000]);
    expect(t.sub()).toMatchObject({ CurrentPeriodStart: "2026-12-01T00:00:00.000Z", RenewsAt: "2027-01-01T00:00:00.000Z" });
    // credit bought in Utilities lands in the ledger, once
    const bought = data(await t.call(OWNER, "billing.credits.buy", { workspaceId: t.workspaceId, amountUsd: 50 }));
    expect(bought).toMatchObject({ status: "Completed", creditedUsd: 50, redirectUrl: null });
    expect(data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId })).purchasesMirrored).toBe(0);
    expect(t.entries().filter((e) => e.Kind === "purchase").map((e) => e.AmountCents)).toEqual([5_000]);
    expect(err(await t.call(OWNER, "billing.credits.buy", { workspaceId: t.workspaceId, amountUsd: 5 })).code).toBe("invalid_input");
    // a member whose role may not read the credits still syncs the plan (the credit read is refused, the rest goes on)
    t.fake.failNext(403, /\/credits$/);
    const partial = data(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId }));
    expect(partial).toMatchObject({ purchasesMirrored: 0, subscription: { planKey: "classic" } });
    expect(err(await t.call(MEMBER, "billing.credits.buy", { workspaceId: t.workspaceId, amountUsd: 50 })).code).toBe("forbidden");
  });

  it("the Factory's renewal run leaves subscriptions Utilities holds to Utilities", async () => {
    const t = setup({ cards: true });
    await onUtilities(t);
    data(await t.call(SUPER, "billing.coupons.save", { code: "CLASSIC-1M", kind: "plan", planKeys: ["classic"], durationMonths: 1 }));
    const c = data(await t.call(OWNER, "billing.checkout.start", { workspaceId: t.workspaceId, planKey: "classic", code: "CLASSIC-1M" })).checkout;
    data(await t.call(OWNER, "billing.checkout.confirm", { checkoutId: c.id }));
    const report = await runBillingRenewals(t.gateway, { now: () => new Date("2027-01-15T00:00:00.000Z"), env: {} });
    expect(report).toMatchObject({ renewed: [], pastDue: [], ended: [] });
    expect(t.sub()).toMatchObject({ PlanKey: "classic", Status: "active" });
  });

  it("is not offered while this platform is the source", async () => {
    const t = setup();
    expect(err(await t.call(MEMBER, "billing.subscription.sync", { workspaceId: t.workspaceId }))).toMatchObject({ code: "not_supported", messageKey: "billing.utilities.notSource" });
  });
});
