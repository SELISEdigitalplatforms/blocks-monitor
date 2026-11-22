// Test kit: a Blocks Utilities service in memory behind the client's HTTP layer (functions/_lib/blocksUtilities.ts
// createUtilitiesClient). It answers the routes the Factory uses with the service's envelope and codes, scopes every
// subscription call to the bearer's organization (as Utilities does: a named organization is ignored), and lets a
// test play the provider's webhook (pay) and the renewal worker (renew).
import { createUtilitiesClient, type UtilitiesCaller, type UtilitiesHttp, type UtilitiesHttpRequest } from "../../functions/_lib/blocksUtilities";
import type {
  UtilitiesAccess,
  UtilitiesCreditGrant,
  UtilitiesDiscount,
  UtilitiesPlan,
  UtilitiesSubscription,
} from "../../src/domain/blocksUtilities";

type Rec = Record<string, any>;
const ok = (data: unknown, status = 200) => ({ status, body: { success: true, data, meta: { correlationId: "fake" } } });
const no = (status: number, code: string, fields?: Record<string, string[]>) => ({ status, body: { success: false, error: { code, message: `fake ${code}`, fields: fields ?? null }, meta: {} } });
const addMonth = (iso: string) => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

export interface FakeUtilities {
  /** What the router hands the ops: the service identity, and an organization only for a caller whose session is in it. */
  access(caller: UtilitiesCaller | null): UtilitiesAccess;
  plans: UtilitiesPlan[];
  discounts: UtilitiesDiscount[];
  subs: Map<string, UtilitiesSubscription>;
  usage: { org: string; key: string; quantity: number; metadata: Rec }[];
  grants: Map<string, UtilitiesCreditGrant[]>;
  profiles: Map<string, Rec>;
  /** Every request: the bearer's organization (null: the service identity), the method and the path. */
  calls: { org: string | null; method: string; path: string; body?: unknown; query?: unknown }[];
  /** A card provider is enabled on the tenant. */
  cards: boolean;
  /** Subscribing needs a complete billing profile. */
  profileRequired: boolean;
  /** The provider's webhook: the organization's open checkout is paid. */
  pay(org: string): void;
  /** The renewal worker: the organization's subscription moves on one period. */
  renew(org: string): void;
  /** The next call (the next one whose path matches) fails with this status (no envelope). */
  failNext(status: number, path?: RegExp): void;
}

export function fakeUtilities(o: { now?: () => string; cards?: boolean; profileRequired?: boolean } = {}): FakeUtilities {
  const now = o.now ?? (() => "2026-11-01T00:00:00.000Z");
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  let failing: { status: number; path: RegExp | null } | null = null;
  const state: FakeUtilities = {
    access: (caller) => ({
      service: createUtilitiesClient(http(null)),
      forOrganization: async (org) => (caller?.token && caller.organizationId === org ? createUtilitiesClient(http(org)) : null),
    }),
    plans: [],
    discounts: [],
    subs: new Map(),
    usage: [],
    grants: new Map(),
    profiles: new Map(),
    calls: [],
    cards: o.cards ?? false,
    profileRequired: o.profileRequired ?? false,
    pay(org) {
      const s = state.subs.get(org);
      if (s && s.status === "Incomplete") Object.assign(s, { status: "Active", checkoutUrl: null, pendingCheckout: null });
    },
    renew(org) {
      const s = state.subs.get(org);
      if (!s) return;
      if (s.cancelAtPeriodEnd) {
        s.status = "Canceled";
        return;
      }
      const target = s.pendingPlanChange;
      if (target) {
        Object.assign(s, { planCode: target.targetPlanCode, planName: target.targetPlanName, pendingPlanChange: null, unitAmountMinor: priceOf(target.targetPlanCode) });
      }
      s.currentPeriodStartUtc = s.currentPeriodEndUtc;
      s.currentPeriodEndUtc = addMonth(s.currentPeriodStartUtc);
      s.nextPaymentAtUtc = s.currentPeriodEndUtc;
      s.version += 1;
    },
    failNext(status, path) {
      failing = { status, path: path ?? null };
    },
  };

  const plan = (code: string) => state.plans.find((p) => p.code === code && p.status === "Active");
  const priceOf = (code: string) => plan(code)?.prices.at(-1)?.unitAmountMinor ?? 0;
  const activeDiscount = (code?: string) => state.discounts.find((d) => d.code === code && d.status === "Active");
  const redeemed = new Map<string, Set<string>>();

  function quoteOf(org: string, b: Rec): { ok: true; q: Rec; discount: UtilitiesDiscount | null } | { ok: false; res: ReturnType<typeof no> } {
    const p = plan(b.planCode);
    const price = p?.prices.find((x) => x.priceId === b.priceId);
    if (!p || !price) return { ok: false, res: no(404, "subscription_plan_not_found") };
    let off = 0;
    let d: UtilitiesDiscount | null = null;
    if (b.discountCode) {
      d = activeDiscount(b.discountCode) ?? null;
      if (!d) return { ok: false, res: no(404, "subscription_discount_not_found") };
      if (d.expiresAtUtc && d.expiresAtUtc <= now()) return { ok: false, res: no(409, "subscription_discount_expired") };
      if (d.applicablePlanCodes.length && !d.applicablePlanCodes.includes(p.code)) return { ok: false, res: no(409, "subscription_discount_not_applicable") };
      if (d.oneUsePerOrganization && redeemed.get(d.discountId)?.has(org)) return { ok: false, res: no(409, "subscription_discount_already_redeemed") };
      off = d.kind === "Percent" ? Math.round((price.unitAmountMinor * (d.percentBasisPoints ?? 0)) / 10_000) : Math.min(price.unitAmountMinor, d.amountMinor ?? 0);
    }
    const start = now();
    return {
      ok: true,
      discount: d,
      q: {
        currencyCode: "USD", subtotalMinor: price.unitAmountMinor, discountMinor: off, promotionalDiscountMinor: off, taxMinor: 0,
        totalDueNowMinor: price.unitAmountMinor - off, periodStartUtc: start, periodEndUtc: addMonth(start), blockers: [],
      },
    };
  }

  function route(org: string | null, req: UtilitiesHttpRequest) {
    const b = (req.body ?? {}) as Rec;
    const q = (req.query ?? {}) as Rec;
    const p = req.path;
    const m = req.method;
    // ---------------- the catalogue (any caller)
    if (m === "GET" && p === "/subscription-plans") {
      const status = q.status ?? "Active";
      return ok(state.plans.filter((x) => status === "All" || x.status === status));
    }
    if (m === "POST" && p === "/subscription-plans") {
      if (!/^[a-z0-9_-]+$/.test(b.code ?? "")) return no(400, "subscription_plan_code_invalid", { Code: ["invalid"] });
      if (plan(b.code)) return no(409, "subscription_plan_code_taken");
      const made: UtilitiesPlan = {
        planId: id("plan"), code: b.code, displayName: b.displayName, description: b.description ?? null, featuresJson: b.featuresJson ?? null, familyCode: b.familyCode ?? null,
        familyRank: b.familyRank ?? null, status: "Active", version: 1, hasSubscribers: false, subscriberScope: b.subscriberScope, organizationId: null,
        meters: b.meters ?? [], entitlements: b.entitlements ?? [], prices: [],
      } as UtilitiesPlan;
      state.plans.push(made);
      return ok(made);
    }
    let r = p.match(/^\/subscription-plans\/prices\/([^/]+)\/archive$/);
    if (m === "PUT" && r) {
      const owner = state.plans.find((x) => x.prices.some((pr) => pr.priceId === r![1]));
      if (!owner) return no(404, "subscription_price_not_found");
      owner.prices = owner.prices.filter((pr) => pr.priceId !== r![1]);
      return ok(owner);
    }
    if (m === "POST" && p === "/subscription-plans/prices") {
      const owner = state.plans.find((x) => x.planId === b.planId);
      if (!owner) return no(404, "subscription_plan_not_found");
      if (owner.status !== "Active") return no(409, "subscription_plan_archived");
      owner.prices.push({ priceId: id("price"), currencyCode: b.currencyCode, unitAmountMinor: b.unitAmountMinor, interval: ["Day", "Week", "Month", "Year"][b.interval]!, intervalCount: b.intervalCount, quantityItemKey: null });
      return ok(owner);
    }
    r = p.match(/^\/subscription-plans\/([^/]+)(\/archive)?$/);
    if (r && m === "PUT") {
      const x = state.plans.find((y) => y.planId === r![1]);
      if (!x) return no(404, "subscription_plan_not_found");
      if (r[2]) x.status = "Archived";
      else {
        if (x.status !== "Active") return no(409, "subscription_plan_archived");
        Object.assign(x, { displayName: b.displayName, description: b.description ?? null, featuresJson: b.featuresJson ?? null, familyRank: b.familyRank ?? null, meters: b.meters, entitlements: b.entitlements });
        x.version += 1;
      }
      return ok(x);
    }
    if (m === "GET" && p === "/subscription-discounts") return ok(state.discounts);
    r = p.match(/^\/subscription-discounts\/([^/]+)(\/archive)?$/);
    if (r && r[1] !== "preview") {
      const d = state.discounts.find((x) => x.discountId === r![1]);
      if (!d) return no(404, "subscription_discount_not_found");
      if (m === "GET") return ok(d);
      if (m === "PUT" && r[2]) {
        Object.assign(d, { status: "Archived", effectiveState: "Archived" });
        return ok(d);
      }
      if (m === "PUT") {
        if (b.expectedVersion !== d.version) return no(409, "subscription_discount_changed");
        Object.assign(d, { ...b, kind: b.kind === 0 ? "Percent" : "FixedAmount", version: d.version + 1 });
        delete (d as Rec).expectedVersion;
        return ok(d);
      }
    }
    if (m === "POST" && p === "/subscription-discounts") {
      if (!/^[a-z0-9_-]+$/.test(b.code ?? "")) return no(400, "subscription_discount_invalid", { Code: ["lower case"] });
      if (state.discounts.some((d) => d.code === b.code)) return no(409, "subscription_discount_code_taken");
      const d = { ...b, discountId: id("disc"), kind: b.kind === 0 ? "Percent" : "FixedAmount", status: "Active", effectiveState: "Active", version: 1, redeemedRedemptions: 0, organizationId: null } as UtilitiesDiscount;
      state.discounts.push(d);
      return ok(d);
    }
    if (m === "GET" && p === "/payments/providers") return ok(state.cards ? [{ paymentProviderId: "pp-1", providerName: "STRIPE", isEnabled: true }] : []);
    // ---------------- everything below is the bearer's organization's
    if (!org) return no(401, "subscription_organization_missing");
    const sub = state.subs.get(org) ?? null;
    if (m === "POST" && (p === "/subscriptions/preview" || p === "/subscription-discounts/preview")) {
      const res = quoteOf(org, b);
      if (p === "/subscription-discounts/preview") {
        if (!res.ok) return ok({ status: "Rejected", reasonCode: (res.res.body as Rec).error.code, message: "no", quote: {} });
        return ok({ status: "Accepted", quote: res.q });
      }
      return res.ok ? ok(res.q) : res.res;
    }
    if (m === "POST" && p === "/subscriptions") {
      if (sub && ["Active", "Trialing", "PastDue"].includes(sub.status)) return no(409, "subscription_already_active");
      if (state.profileRequired && !state.profiles.has(org)) return no(400, "subscription_billing_profile_incomplete");
      const res = quoteOf(org, b);
      if (!res.ok) return res.res;
      const due = res.q.totalDueNowMinor as number;
      if (due > 0 && !state.cards) return no(503, "subscription_payment_provider_not_configured");
      if (res.discount) {
        if (!redeemed.has(res.discount.discountId)) redeemed.set(res.discount.discountId, new Set());
        redeemed.get(res.discount.discountId)!.add(org);
        res.discount.redeemedRedemptions = (res.discount.redeemedRedemptions ?? 0) + 1;
      }
      const s: UtilitiesSubscription = {
        subscriptionId: id("sub"), status: due > 0 ? "Incomplete" : "Active", planCode: b.planCode, planName: plan(b.planCode)!.displayName, currencyCode: "USD",
        unitAmountMinor: res.q.subtotalMinor, interval: "Month", intervalCount: 1, currentPeriodStartUtc: res.q.periodStartUtc, currentPeriodEndUtc: res.q.periodEndUtc,
        nextPaymentAtUtc: res.q.periodEndUtc, cancelAtPeriodEnd: false, initialChargeAmountMinor: due, version: 1,
        checkoutUrl: due > 0 ? `https://pay.test.invalid/checkout/${n}` : null, pendingPlanChange: null,
      };
      state.subs.set(org, s);
      return ok(s);
    }
    if (m === "GET" && p === "/subscriptions/current") return ok(sub && sub.status !== "Canceled" ? sub : null);
    if (m === "GET" && p === "/subscriptions/invoices") {
      const items = sub && sub.status === "Active"
        ? [{ documentId: "doc-1", documentNumber: "INV-0001", documentType: "Invoice", status: "Issued", issuedAtUtc: sub.currentPeriodStartUtc, subscriptionId: sub.subscriptionId, currencyCode: "USD", planCode: sub.planCode, planName: sub.planName, periodStartUtc: sub.currentPeriodStartUtc, periodEndUtc: sub.currentPeriodEndUtc, amounts: { netSubtotalMinor: sub.initialChargeAmountMinor ?? 0, taxMinor: 0, totalMinor: sub.initialChargeAmountMinor ?? 0 } }]
        : [];
      return ok({ items, pageInfo: { pageSize: 25, hasNextPage: false } });
    }
    if (m === "PUT" && p === "/subscription-billing-profile") {
      state.profiles.set(org, b);
      return ok(b);
    }
    if (m === "POST" && p === "/subscription-usage") {
      if (!sub) return no(404, "subscription_not_found");
      const seen = state.usage.find((u) => u.org === org && u.key === b.idempotencyKey);
      if (!seen) state.usage.push({ org, key: b.idempotencyKey, quantity: b.quantity, metadata: b.metadata ?? {} });
      return ok({ allowed: true, meterKey: b.meterKey, unitLabel: "USD cent", periodKey: "p", periodStartUtc: sub.currentPeriodStartUtc, periodEndUtc: sub.currentPeriodEndUtc, included: 0, used: 0, remaining: 0, overage: 0, replayed: Boolean(seen) });
    }
    r = p.match(/^\/subscriptions\/([^/]+)(.*)$/);
    if (r) {
      if (!sub || sub.subscriptionId !== r[1]) return no(404, "subscription_not_found");
      const rest = r[2];
      if (m === "DELETE" && rest === "") {
        if (q.immediately) sub.status = "Canceled";
        else sub.cancelAtPeriodEnd = true;
        return ok(sub);
      }
      if (m === "DELETE" && rest === "/cancellation") {
        sub.cancelAtPeriodEnd = false;
        return ok(sub);
      }
      if (m === "DELETE" && rest === "/plan/pending") {
        sub.pendingPlanChange = null;
        return ok(sub);
      }
      if ((m === "PUT" && rest === "/plan") || (m === "POST" && rest === "/plan/preview")) {
        const target = plan(b.planCode);
        const price = target?.prices.find((x) => x.priceId === b.priceId);
        if (!target || !price) return no(404, "subscription_plan_not_found");
        const up = price.unitAmountMinor > sub.unitAmountMinor;
        const charge = up ? price.unitAmountMinor - sub.unitAmountMinor : 0;
        if (m === "POST") {
          return ok({ currencyCode: "USD", targetPlanCode: target.code, targetPriceId: price.priceId, chargeMinor: charge, timing: up ? "Immediate" : "AtRenewal", effectiveAtUtc: up ? now() : sub.currentPeriodEndUtc, newPeriodStartUtc: sub.currentPeriodStartUtc, newPeriodEndUtc: sub.currentPeriodEndUtc, nextRenewalAmountMinor: price.unitAmountMinor, blockers: [] });
        }
        if (up) Object.assign(sub, { planCode: target.code, planName: target.displayName, unitAmountMinor: price.unitAmountMinor, pendingPlanChange: null, initialChargeAmountMinor: charge });
        else sub.pendingPlanChange = { targetPlanCode: target.code, targetPlanName: target.displayName, targetPriceId: price.priceId, effectiveAtUtc: sub.currentPeriodEndUtc };
        return ok(sub);
      }
      if (m === "GET" && rest === "/credits") return ok(state.grants.get(org) ?? []);
      if (m === "POST" && rest === "/credits") {
        if (!state.cards) return no(503, "subscription_payment_provider_not_configured");
        const g: UtilitiesCreditGrant = { grantId: id("grant"), meterKey: b.meterKey, source: "Purchased", quantity: b.quantity, remaining: b.quantity, status: "Active", grantedAtUtc: now() };
        state.grants.set(org, [...(state.grants.get(org) ?? []), g]);
        return ok({ purchaseId: id("purchase"), status: "Completed", grant: g, checkoutUrl: null });
      }
    }
    return no(404, "fake_route_unknown");
  }

  function http(org: string | null): UtilitiesHttp {
    return async (req) => {
      state.calls.push({ org, method: req.method, path: req.path, ...(req.body !== undefined ? { body: req.body } : {}), ...(req.query ? { query: req.query } : {}) });
      if (failing !== null && (!failing.path || failing.path.test(req.path))) {
        const status = failing.status;
        failing = null;
        return { status, body: "<html>down</html>" };
      }
      return route(org, req);
    };
  }

  return state;
}
