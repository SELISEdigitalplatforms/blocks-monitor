// The Factory's plans and codes as Blocks Utilities holds them (PlatformSetting billing.source = "blocks-utilities"), and
// back. Pure mapping, shared by the billing functions, the sync script and the tests.
//
// What maps 1:1 and what does not:
// - Plan key, name, monthly USD price, active/archived: Utilities' plan code, display name, a monthly USD price (minor
//   units) and its catalogue status. Contact-sales (Enterprise) is a plan without a price.
// - The Factory-only plan facts (monthly credit, assisted level, parallel builds, queue priority, the feature lines,
//   contact sales, the order) ride in the plan's featuresJson, which Utilities stores verbatim. The monthly credit is
//   also the included quantity of the plan's "ai-usage" meter (USD cents), where per-job usage is reported.
// - A plan code (the plan paid N months) is a 100% discount for N periods; a discount code is a percent or a fixed USD
//   discount for N periods, limited to plan codes. Utilities has one limit, one use per organization; it has no total
//   number of redemptions and no per-person limit, and an archived code (or plan) cannot be switched on again.
// - A credit code (adds USD credit) has no Utilities counterpart (its discounts only price a subscription or a credit
//   purchase): credit codes stay Factory rows.
import {
  ASSISTED,
  DEFAULT_PLANS,
  centsToUsd,
  toCents,
  type Assisted,
  type CouponView,
  type PlanView,
} from "./billing";
import {
  BILLING_INTERVAL,
  DISCOUNT_KIND,
  ENTITLEMENT_LIMIT_KIND,
  METER_AGGREGATION,
  METER_RESET,
  QUANTITY_DISCOUNT_POLICY,
  SUBSCRIBER_SCOPE,
  USD,
  type UtilitiesCreateDiscount,
  type UtilitiesCreatePlan,
  type UtilitiesDiscount,
  type UtilitiesDiscountTerms,
  type UtilitiesPlan,
  type UtilitiesPlanDefinition,
  type UtilitiesPrice,
} from "./blocksUtilities";
import { describeCoupon, type CouponTerms } from "./payments";

/** PlatformSetting billing.source: where plans, codes and subscriptions live. */
export const SETTING_SOURCE = "billing.source";
export const BILLING_SOURCES = ["factory", "blocks-utilities"] as const;
export type BillingSource = (typeof BILLING_SOURCES)[number];
export const DEFAULT_SOURCE: BillingSource = "factory";

/** The PlatformSetting's value ("factory" unless it names blocks-utilities). */
export function settingSource(valueJson: unknown): BillingSource {
  if (typeof valueJson !== "string" || !valueJson.trim()) return DEFAULT_SOURCE;
  let v: unknown;
  try {
    v = JSON.parse(valueJson);
  } catch {
    return DEFAULT_SOURCE;
  }
  if (typeof v === "object" && v !== null && "value" in v) v = (v as { value: unknown }).value;
  return (BILLING_SOURCES as readonly unknown[]).includes(v) ? (v as BillingSource) : DEFAULT_SOURCE;
}

/** The family every Factory plan is filed under in Utilities. */
export const PLAN_FAMILY = "madp-factory";
/** The meter the Factory reports each job's AI usage on: USD cents, reset every month. */
export const USAGE_METER = "ai-usage";
export const USAGE_UNIT = "USD cent";
/** Buyable credit on the usage meter, in USD cents. */
export const MIN_CREDIT_PURCHASE_CENTS = 1_000;
export const MAX_CREDIT_PURCHASE_CENTS = 100_000_000;
/** The PaymentProvider id the Factory's records carry for a subscription held in Utilities. */
export const UTILITIES_PROVIDER = "blocks-utilities";
/** A Utilities discount's id as the coupon screens carry it (Factory rows keep their own ids). */
export const UTILITIES_COUPON_PREFIX = "utilities:";

/** The Factory facts of a plan, kept in Utilities' featuresJson. */
export interface FactoryPlanFacts {
  madpFactory: 1;
  creditUsd: number;
  assisted: Assisted;
  maxParallelStreams: number | null;
  priority: number;
  features: string[];
  contactSales: boolean;
  sortOrder: number;
}

export function factsOf(p: PlanView): FactoryPlanFacts {
  return {
    madpFactory: 1,
    creditUsd: p.creditUsd,
    assisted: p.assisted,
    maxParallelStreams: p.maxParallelStreams,
    priority: p.priority,
    features: [...p.features],
    contactSales: p.contactSales || p.priceUsd === null,
    sortOrder: p.sortOrder,
  };
}

/** What a plan sells, as Utilities' create and update take it. */
export function planDefinition(p: PlanView): UtilitiesPlanDefinition {
  // Free's credit is the one-time sign-up credit (kept in the Factory), not a monthly allowance.
  const monthly = p.contactSales || p.priceUsd === null || p.priceUsd <= 0 ? 0 : toCents(p.creditUsd);
  return {
    displayName: p.name,
    ...(p.features.length ? { description: p.features.join(" · ").slice(0, 1000) } : {}),
    featuresJson: JSON.stringify(factsOf(p)),
    trialRequiresPaymentMethod: false,
    oneTrialPerPlan: true,
    requirePaymentMethodUpfront: false,
    quantityDiscountCombinationPolicy: QUANTITY_DISCOUNT_POLICY.BestDiscount,
    usageInterval: BILLING_INTERVAL.Month,
    usageIntervalCount: 1,
    familyCode: PLAN_FAMILY,
    familyRank: p.sortOrder,
    quantityItems: [],
    meters: [
      {
        meterKey: USAGE_METER,
        displayName: "AI usage",
        unitLabel: USAGE_UNIT,
        aggregation: METER_AGGREGATION.Sum,
        resetPolicy: METER_RESET.Periodic,
        quantityScale: 0,
        includedQuantity: monthly,
        // The Factory's credit balance decides whether work may start; Utilities only counts.
        overageAllowed: false,
        thresholdPercents: [],
        rateTables: [],
        subLimits: [],
        // Credit is bought in USD cents at one cent each (USD 10 to USD 1,000,000 a purchase) and never expires.
        ...(p.contactSales || p.priceUsd === null
          ? {}
          : { topUp: { enabled: true, unitPrices: [{ currencyCode: USD, unitAmountMinor: 1 }], minQuantity: MIN_CREDIT_PURCHASE_CENTS, maxQuantity: MAX_CREDIT_PURCHASE_CENTS, expiryPolicy: METER_RESET.Never } }),
      },
    ],
    // The consultant level a plan brings, as an entitlement an app can check (GET /entitlements). Parallel builds and
    // queue priority are not metered, so they stay plan features (featuresJson), where Utilities keeps product flags.
    entitlements: p.assisted !== "none" ? [{ key: assistedEntitlement(p.assisted), limitKind: ENTITLEMENT_LIMIT_KIND.Boolean }] : [],
    trialGrants: [],
  };
}

/** The Boolean entitlement a consultant level is granted as ("assisted-tech-lead"). */
export const assistedEntitlement = (a: Assisted): string => `assisted-${a}`;

export function createPlanRequest(p: PlanView): UtilitiesCreatePlan {
  return { code: p.key, subscriberScope: SUBSCRIBER_SCOPE.Organization, ...planDefinition(p) };
}

/** The plan's monthly USD price (the newest one when several are on sale), or null. */
export function monthlyUsdPrice(u: Pick<UtilitiesPlan, "prices">): UtilitiesPrice | null {
  const prices = (u.prices ?? []).filter(
    (p) => p.currencyCode?.toUpperCase() === USD && /^month$/i.test(p.interval) && (p.intervalCount ?? 1) === 1 && !p.quantityItemKey,
  );
  return prices.length ? prices[prices.length - 1]! : null;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

function readFacts(raw: unknown): Partial<FactoryPlanFacts> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Partial<FactoryPlanFacts>) : {};
  } catch {
    return {};
  }
}

/** A Utilities plan as the Factory shows and sells it; null for a plan sold per person or to one organization only. */
export function planViewOf(u: UtilitiesPlan): PlanView | null {
  if (!u.code) return null;
  const scope = (u as { subscriberScope?: unknown }).subscriberScope;
  if (scope !== undefined && scope !== SUBSCRIBER_SCOPE.Organization && scope !== "Organization") return null;
  if (u.organizationId) return null;
  const facts = readFacts(u.featuresJson);
  const fallback = DEFAULT_PLANS.find((p) => p.key === u.code);
  const price = monthlyUsdPrice(u);
  const contactSales = facts.contactSales === true || !price;
  const streams = facts.maxParallelStreams;
  return {
    key: u.code,
    name: u.displayName || fallback?.name || u.code,
    priceUsd: contactSales ? null : centsToUsd(num(price!.unitAmountMinor)),
    creditUsd: num(facts.creditUsd, fallback?.creditUsd ?? 0),
    assisted: (ASSISTED as readonly unknown[]).includes(facts.assisted) ? (facts.assisted as Assisted) : (fallback?.assisted ?? "none"),
    maxParallelStreams: streams === null ? null : typeof streams === "number" && streams > 0 ? streams : (fallback?.maxParallelStreams ?? 1),
    priority: num(facts.priority, fallback?.priority ?? 0),
    features: Array.isArray(facts.features) ? facts.features.filter((x): x is string => typeof x === "string") : [...(fallback?.features ?? [])],
    contactSales,
    active: /^active$/i.test(u.status),
    sortOrder: num(facts.sortOrder, num(u.familyRank, fallback?.sortOrder ?? 100)),
  };
}

/** Whether a stored Utilities plan already sells what `p` describes (name, facts, monthly price). */
export function planMatches(u: UtilitiesPlan, p: PlanView): boolean {
  const v = planViewOf(u);
  if (!v) return false;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return v.name === p.name && v.priceUsd === p.priceUsd && v.active === p.active && same(readFacts(u.featuresJson), factsOf(p));
}

// ---------------------------------------------------------------- codes

/** A Factory code (upper case) as a Utilities code (lower case). */
export const utilitiesCode = (code: string): string => code.trim().toLowerCase();

/** The Utilities discount for a plan or discount code; null for a credit code (no counterpart). */
export function discountTerms(t: CouponTerms, o: { note?: string; expiresAt?: string | null; planName?: (key: string) => string }): UtilitiesDiscountTerms | null {
  if (t.kind === "credit") return null;
  const base = {
    displayName: (o.note?.trim() || describeCoupon(t, o.planName)).slice(0, 200),
    durationPeriods: Math.max(1, t.durationMonths),
    ...(o.expiresAt ? { expiresAtUtc: new Date(o.expiresAt).toISOString() } : {}),
    applicablePlanCodes: [...t.planKeys],
    applicablePriceIds: [],
    scope: "Subscription" as const,
    applicableMeterKeys: [],
    oneUsePerOrganization: true,
  };
  if (t.kind === "plan") return { ...base, kind: DISCOUNT_KIND.Percent, percentBasisPoints: 10_000 };
  if (t.percentOff > 0) return { ...base, kind: DISCOUNT_KIND.Percent, percentBasisPoints: t.percentOff * 100 };
  return { ...base, kind: DISCOUNT_KIND.FixedAmount, amountMinor: t.amountOffCents, currencyCode: USD };
}

export function createDiscountRequest(t: CouponTerms, o: { note?: string; expiresAt?: string | null; planName?: (key: string) => string }): UtilitiesCreateDiscount | null {
  const terms = discountTerms(t, o);
  return terms ? { code: utilitiesCode(t.code), ...terms } : null;
}

/** The terms of a Utilities discount in the Factory's words. */
export function termsOfDiscount(d: UtilitiesDiscount): CouponTerms {
  const percent = /^percent$/i.test(d.kind);
  const bp = num(d.percentBasisPoints);
  const plan = percent && bp >= 10_000;
  return {
    code: d.code.toUpperCase(),
    kind: plan ? "plan" : "discount",
    amountCents: 0,
    planKeys: [...(d.applicablePlanCodes ?? [])],
    durationMonths: Math.max(1, num(d.durationPeriods, 1)),
    percentOff: percent && !plan ? Math.round(bp / 100) : 0,
    amountOffCents: percent ? 0 : Math.round(num(d.amountMinor)),
    perPersonLimit: 0,
    legacy: false,
  };
}

/** A Utilities discount as the coupon screens show it. */
export function couponViewOfDiscount(d: UtilitiesDiscount, planName?: (key: string) => string): CouponView & { source: BillingSource; oneUsePerOrganization: boolean } {
  const t = termsOfDiscount(d);
  return {
    id: `${UTILITIES_COUPON_PREFIX}${d.discountId}`,
    kind: t.kind,
    legacy: false,
    planKeys: t.planKeys,
    durationMonths: t.durationMonths,
    percentOff: t.percentOff,
    amountOffUsd: centsToUsd(t.amountOffCents),
    perPersonLimit: 0,
    description: describeCoupon(t, planName),
    code: t.code,
    amountUsd: 0,
    planKey: null,
    // Utilities has no total limit: every organization may use a code once.
    maxRedemptions: 0,
    redemptions: num(d.redeemedRedemptions),
    expiresAt: d.expiresAtUtc ?? null,
    active: /^active$/i.test(d.status) && !/^(archived)$/i.test(d.effectiveState ?? ""),
    note: d.displayName ?? "",
    source: "blocks-utilities",
    oneUsePerOrganization: d.oneUsePerOrganization !== false,
  };
}

/** The Utilities discount id behind a coupon screen id, or null for a Factory row. */
export function discountIdOf(couponId: string): string | null {
  return couponId.startsWith(UTILITIES_COUPON_PREFIX) ? couponId.slice(UTILITIES_COUPON_PREFIX.length) || null : null;
}

// ---------------------------------------------------------------- subscriptions

/** Utilities' subscription states in the Factory's four. */
export function subscriptionStatusOf(status: string): "active" | "pending" | "cancelled" | "past_due" {
  switch (status.toLowerCase()) {
    case "active":
    case "trialing":
      return "active";
    case "incomplete":
      return "pending";
    case "pastdue":
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "cancelled";
  }
}

/** USD minor units as the API's USD numbers. */
export const usdOfMinor = (minor: unknown): number => centsToUsd(Math.round(num(minor)));
