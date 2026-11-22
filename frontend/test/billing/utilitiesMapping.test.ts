// The Factory's plans and codes as Blocks Utilities holds them, and back (src/domain/utilitiesBilling.ts).
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "../../src/domain/billing";
import { couponTermsOf } from "../../src/domain/payments";
import type { UtilitiesDiscount, UtilitiesPlan } from "../../src/domain/blocksUtilities";
import {
  couponViewOfDiscount,
  createDiscountRequest,
  createPlanRequest,
  discountIdOf,
  monthlyUsdPrice,
  planMatches,
  planViewOf,
  settingSource,
  subscriptionStatusOf,
  termsOfDiscount,
} from "../../src/domain/utilitiesBilling";

/** A Utilities plan as the service would answer after create + price. */
function stored(key: string, o: { priceMinor?: number | null; status?: string } = {}): UtilitiesPlan {
  const p = DEFAULT_PLANS.find((x) => x.key === key)!;
  const req = createPlanRequest(p);
  const price = o.priceMinor !== undefined ? o.priceMinor : p.priceUsd === null ? null : Math.round(p.priceUsd * 100);
  return {
    planId: `plan-${key}`, code: req.code, displayName: req.displayName, featuresJson: req.featuresJson, status: o.status ?? "Active", version: 1,
    hasSubscribers: false, subscriberScope: 0, organizationId: null, familyCode: req.familyCode, familyRank: req.familyRank,
    meters: [], prices: price === null ? [] : [{ priceId: `price-${key}`, currencyCode: "USD", unitAmountMinor: price, interval: "Month", intervalCount: 1, quantityItemKey: null }],
  };
}

describe("plans", () => {
  it("writes every Factory fact: code, name, the usage meter with the monthly credit, entitlements, features", () => {
    const classic = createPlanRequest(DEFAULT_PLANS.find((p) => p.key === "classic")!);
    expect(classic).toMatchObject({ code: "classic", displayName: "Classic", subscriberScope: 0, usageInterval: 2, familyCode: "madp-factory", familyRank: 2 });
    expect(classic.meters).toEqual([
      expect.objectContaining({ meterKey: "ai-usage", unitLabel: "USD cent", includedQuantity: 20_000, overageAllowed: false, resetPolicy: 0, topUp: expect.objectContaining({ enabled: true, unitPrices: [{ currencyCode: "USD", unitAmountMinor: 1 }], expiryPolicy: 1 }) }),
    ]);
    expect(classic.entitlements).toEqual([{ key: "assisted-tech-lead", limitKind: 0 }]);
    expect(JSON.parse(classic.featuresJson!)).toMatchObject({ madpFactory: 1, creditUsd: 200, maxParallelStreams: 2, priority: 2, contactSales: false });
    // Free's credit is the one-time sign-up credit, not a monthly allowance; Enterprise sells no credit
    expect(createPlanRequest(DEFAULT_PLANS[0]!).meters[0]!.includedQuantity).toBe(0);
    const enterprise = createPlanRequest(DEFAULT_PLANS.find((p) => p.key === "enterprise")!);
    expect(enterprise.meters[0]!.topUp).toBeUndefined();
    expect(enterprise.entitlements).toEqual([{ key: "assisted-dedicated", limitKind: 0 }]);
  });

  it("reads a stored plan back exactly as the Factory sells it", () => {
    for (const p of DEFAULT_PLANS) expect(planViewOf(stored(p.key))).toEqual(p);
    expect(planMatches(stored("speed"), DEFAULT_PLANS.find((p) => p.key === "speed")!)).toBe(true);
    expect(planMatches(stored("speed", { priceMinor: 45_000 }), DEFAULT_PLANS.find((p) => p.key === "speed")!)).toBe(false);
    expect(planViewOf(stored("speed", { status: "Archived" }))!.active).toBe(false);
  });

  it("reads a plan made in the Utilities console with the defaults, and skips per-person and one-organization plans", () => {
    const made = { ...stored("classic"), code: "team", displayName: "Team", featuresJson: null, familyRank: 7 };
    expect(planViewOf(made)).toMatchObject({ key: "team", name: "Team", priceUsd: 199, assisted: "none", maxParallelStreams: 1, contactSales: false, sortOrder: 7 });
    expect(planViewOf({ ...made, subscriberScope: 1 })).toBeNull();
    expect(planViewOf({ ...made, organizationId: "org-1" })).toBeNull();
    // the newest monthly USD price wins; yearly, other currencies and per-seat prices are not the list price
    const prices = [
      { priceId: "a", currencyCode: "USD", unitAmountMinor: 100, interval: "Month", intervalCount: 1 },
      { priceId: "y", currencyCode: "USD", unitAmountMinor: 900, interval: "Year", intervalCount: 1 },
      { priceId: "c", currencyCode: "CHF", unitAmountMinor: 200, interval: "Month", intervalCount: 1 },
      { priceId: "b", currencyCode: "usd", unitAmountMinor: 300, interval: "Month", intervalCount: 1 },
    ];
    expect(monthlyUsdPrice({ prices })!.priceId).toBe("b");
  });
});

describe("codes", () => {
  it("writes plan codes as 100% for N periods and discount codes as percent or fixed USD, lower case", () => {
    const plan = createDiscountRequest(couponTermsOf({ Code: "CLASSIC-3M", Kind: "plan", PlanKeys: ["classic"], DurationMonths: 3 }), { expiresAt: "2027-01-01T00:00:00Z" });
    expect(plan).toEqual({
      code: "classic-3m", displayName: "Pays the classic plan for 3 months", kind: 0, percentBasisPoints: 10_000, durationPeriods: 3, expiresAtUtc: "2027-01-01T00:00:00.000Z",
      applicablePlanCodes: ["classic"], applicablePriceIds: [], scope: "Subscription", applicableMeterKeys: [], oneUsePerOrganization: true,
    });
    expect(createDiscountRequest(couponTermsOf({ Code: "HALF", Kind: "discount", PercentOff: 50, DurationMonths: 2 }), { note: "Launch" })).toMatchObject({ code: "half", displayName: "Launch", kind: 0, percentBasisPoints: 5000, durationPeriods: 2, applicablePlanCodes: [] });
    expect(createDiscountRequest(couponTermsOf({ Code: "TWENTY", Kind: "discount", AmountOffUsd: 20 }), {})).toMatchObject({ kind: 1, amountMinor: 2000, currencyCode: "USD" });
    expect(createDiscountRequest(couponTermsOf({ Code: "GIFT", Kind: "credit", AmountUsd: 25 }), {})).toBeNull();
  });

  it("reads a discount back as the coupon screens show it", () => {
    const d: UtilitiesDiscount = {
      discountId: "d-1", code: "classic-3m", displayName: "Spring", kind: "Percent", percentBasisPoints: 10_000, durationPeriods: 3, applicablePlanCodes: ["classic"],
      status: "Active", version: 2, oneUsePerOrganization: true, effectiveState: "Active", redeemedRedemptions: 4, expiresAtUtc: "2027-01-01T00:00:00Z",
    };
    expect(termsOfDiscount(d)).toMatchObject({ code: "CLASSIC-3M", kind: "plan", planKeys: ["classic"], durationMonths: 3 });
    expect(couponViewOfDiscount(d)).toMatchObject({
      id: "utilities:d-1", code: "CLASSIC-3M", kind: "plan", redemptions: 4, maxRedemptions: 0, active: true, note: "Spring", source: "blocks-utilities", oneUsePerOrganization: true,
    });
    expect(couponViewOfDiscount({ ...d, kind: "FixedAmount", percentBasisPoints: null, amountMinor: 1500, status: "Archived" })).toMatchObject({ kind: "discount", amountOffUsd: 15, active: false });
    expect(discountIdOf("utilities:d-1")).toBe("d-1");
    expect(discountIdOf("row-1")).toBeNull();
  });
});

describe("settings and states", () => {
  it("reads billing.source with factory as the default", () => {
    expect(settingSource(undefined)).toBe("factory");
    expect(settingSource('"blocks-utilities"')).toBe("blocks-utilities");
    expect(settingSource('{"value":"blocks-utilities"}')).toBe("blocks-utilities");
    expect(settingSource('"stripe"')).toBe("factory");
    expect(settingSource("not json")).toBe("factory");
  });

  it("maps Utilities' subscription states onto the Factory's four", () => {
    expect(["Active", "Trialing", "Incomplete", "PastDue", "Unpaid", "Canceled", "IncompleteExpired"].map(subscriptionStatusOf)).toEqual([
      "active", "active", "pending", "past_due", "past_due", "cancelled", "cancelled",
    ]);
  });
});
