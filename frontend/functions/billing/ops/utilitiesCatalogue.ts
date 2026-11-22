// The plan catalogue and the plan / discount codes in Blocks Utilities (PlatformSetting billing.source =
// "blocks-utilities"): read, written and seeded on the platform's service identity. With source "factory" (the default)
// nothing here is called and the Plan and Coupon rows stay the catalogue. The mapping is src/domain/utilitiesBilling.ts.
//
// Utilities' rules the Factory follows here:
// - a plan's code never changes; an edit becomes the plan's next version (subscribers keep theirs);
// - a price is never edited: a new price is added and the old one archived;
// - archiving a plan or a discount is permanent (no restore): switching one back on is refused with a plain answer;
// - a discount code is lower case and used once per organization; there is no total limit and no per-person limit.
import { DEFAULT_PLANS, toCents, type CouponView, type PlanView } from "../../../src/domain/billing";
import { BILLING_INTERVAL, USD, type UtilitiesAccess, type UtilitiesDiscount, type UtilitiesPlan } from "../../../src/domain/blocksUtilities";
import { type CouponTerms } from "../../../src/domain/payments";
import {
  SETTING_SOURCE,
  couponViewOfDiscount,
  createDiscountRequest,
  createPlanRequest,
  discountTerms,
  monthlyUsdPrice,
  planDefinition,
  planMatches,
  planViewOf,
  settingSource,
  termsOfDiscount,
  utilitiesCode,
  type BillingSource,
} from "../../../src/domain/utilitiesBilling";
import { fail } from "../../workspace/ops/_shared/core";
import type { Gateway, OpAnswer, OpDeps } from "../../workspace/ops/_shared/ports";
import { catalogueCache } from "./readCache";
import { BILLING_SCHEMA, readPlans, type Row } from "./shared";

/** PlatformSetting billing.source ("factory" unless set). */
export async function readSource(gateway: Pick<Gateway, "listAll">): Promise<BillingSource> {
  const rows = await gateway.listAll<Row>(BILLING_SCHEMA.platformSetting, { filter: { Key: SETTING_SOURCE }, fields: ["ItemId", "Key", "ValueJson"], maxItems: 2 });
  return settingSource(rows[0]?.ValueJson);
}

/** A Utilities failure as the ops answer it (the service's code in params, never its sentence). */
export function utilitiesFailure(e: unknown, context: "catalogue" | "checkout" = "checkout"): OpAnswer<never> {
  const code = typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "utilities_unavailable";
  const status = typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : null;
  const fields = typeof e === "object" && e !== null && typeof (e as { fields?: unknown }).fields === "object" ? Object.keys((e as { fields: object }).fields ?? {}) : [];
  const coupon: Record<string, [Parameters<typeof fail>[0], string]> = {
    subscription_discount_not_found: ["not_found", "billing.couponUnknown"],
    subscription_discount_expired: ["forbidden", "billing.coupon.expired"],
    subscription_discount_not_started: ["forbidden", "billing.coupon.inactive"],
    subscription_discount_not_applicable: ["conflict", "billing.coupon.notForPlan"],
    subscription_discount_currency_mismatch: ["conflict", "billing.coupon.notForPlan"],
    subscription_discount_already_redeemed: ["conflict", "billing.couponAlreadyRedeemed"],
    subscription_discount_reservation_conflict: ["conflict", "billing.couponAlreadyRedeemed"],
    subscription_plan_not_found: ["not_found", "billing.planUnknown"],
    subscription_plan_archived: ["not_found", "billing.planUnknown"],
    subscription_price_not_found: ["not_found", "billing.planUnknown"],
    subscription_billing_profile_incomplete: ["conflict", "billing.utilities.billingProfile"],
    subscription_already_active: ["conflict", "billing.checkout.alreadyOnPlan"],
  };
  const known = coupon[code];
  if (known) return fail(known[0], known[1], { utilitiesCode: code });
  if (code.startsWith("subscription_payment_provider_")) return fail("conflict", "billing.checkout.paymentRequired", { utilitiesCode: code });
  if (status === 400) return fail("invalid_input", "tenancy.invalidArgs", { keys: fields.length ? fields : ["utilities"], utilitiesCode: code });
  if (status === 404) return fail("not_found", undefined, { utilitiesCode: code });
  if (status === 409) return fail("conflict", context === "catalogue" ? "billing.utilities.changed" : "billing.utilities.refused", { utilitiesCode: code });
  return fail("unavailable", "billing.provider.unavailable", { utilitiesCode: code });
}

/** deps.utilities, or a not-configured answer. */
export function utilitiesOf(deps: OpDeps): { ok: true; u: UtilitiesAccess } | { ok: false; error: OpAnswer<never> } {
  return deps.utilities ? { ok: true, u: deps.utilities } : { ok: false, error: fail("unavailable", "billing.provider.unavailable", { utilitiesCode: "utilities_not_configured" }) };
}

// ---------------------------------------------------------------- plans

/** Every Utilities plan the Factory sells (active and archived), shared for 30 s (catalogueCache). */
export async function utilitiesPlans(u: UtilitiesAccess): Promise<PlanView[]> {
  return catalogueCache.read("plans", async () => {
    const raw = await u.service.plans.list({ status: "All" });
    // a code is listed once: an active plan wins over an archived one of the same code
    const byKey = new Map<string, PlanView>();
    for (const p of raw.map(planViewOf)) if (p && (!byKey.has(p.key) || (p.active && !byKey.get(p.key)!.active))) byKey.set(p.key, p);
    return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  });
}

/** The catalogue of the source in use: Plan rows (defaults filled in) or Utilities plans. */
export async function readCatalogue(deps: Pick<OpDeps, "gateway" | "utilities">): Promise<{ plans: PlanView[]; source: BillingSource }> {
  const [source, factory] = await Promise.all([readSource(deps.gateway), readPlans(deps.gateway)]);
  if (source === "factory") return { plans: factory.plans, source };
  if (!deps.utilities) throw Object.assign(new Error("utilities_not_configured"), { code: "utilities_not_configured" });
  return { plans: await utilitiesPlans(deps.utilities), source };
}

async function findPlan(u: UtilitiesAccess, code: string): Promise<UtilitiesPlan | null> {
  const all = await u.service.plans.list({ status: "All" });
  const same = all.filter((p) => p.code === code && !p.organizationId);
  return same.find((p) => /^active$/i.test(p.status)) ?? same[0] ?? null;
}

/** Writes one plan to Utilities: create (with its monthly USD price), or update what changed (a new version), a new
 *  price for a new amount (the old one archived), archive when switched off. */
export async function savePlanInUtilities(u: UtilitiesAccess, plan: PlanView): Promise<{ ok: true; plan: PlanView; created: boolean } | { ok: false; error: OpAnswer<never> }> {
  try {
    const wantedCents = plan.contactSales || plan.priceUsd === null ? null : toCents(plan.priceUsd);
    const existing = await findPlan(u, plan.key);
    if (!existing) {
      const made = await u.service.plans.create(createPlanRequest(plan));
      if (wantedCents !== null) await u.service.plans.createPrice({ planId: made.planId, currencyCode: USD, unitAmountMinor: wantedCents, interval: BILLING_INTERVAL.Month, intervalCount: 1 });
      if (!plan.active) await u.service.plans.archive(made.planId);
      return { ok: true, plan, created: true };
    }
    if (!/^active$/i.test(existing.status)) {
      if (plan.active) return { ok: false, error: fail("conflict", "billing.utilities.archived", { key: plan.key }) };
      return { ok: true, plan: planViewOf(existing) ?? plan, created: false };
    }
    if (!planMatches(existing, plan)) await u.service.plans.update(existing.planId, planDefinition(plan));
    const current = monthlyUsdPrice(existing);
    if (wantedCents !== null && (!current || current.unitAmountMinor !== wantedCents)) {
      await u.service.plans.createPrice({ planId: existing.planId, currencyCode: USD, unitAmountMinor: wantedCents, interval: BILLING_INTERVAL.Month, intervalCount: 1 });
      if (current) await u.service.plans.archivePrice(current.priceId);
    } else if (wantedCents === null && current) {
      await u.service.plans.archivePrice(current.priceId);
    }
    if (!plan.active) await u.service.plans.archive(existing.planId);
    return { ok: true, plan, created: false };
  } catch (e) {
    return { ok: false, error: utilitiesFailure(e, "catalogue") };
  } finally {
    catalogueCache.clear();
  }
}

/** Creates the default plans Utilities does not hold yet (by code). */
export async function seedPlansInUtilities(u: UtilitiesAccess): Promise<{ ok: true; created: string[] } | { ok: false; error: OpAnswer<never> }> {
  try {
    const have = new Set((await u.service.plans.list({ status: "All" })).map((p) => p.code));
    const created: string[] = [];
    for (const p of DEFAULT_PLANS.filter((x) => !have.has(x.key))) {
      const res = await savePlanInUtilities(u, { ...p, features: [...p.features] });
      if (!res.ok) return res;
      created.push(p.key);
    }
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: utilitiesFailure(e, "catalogue") };
  } finally {
    catalogueCache.clear();
  }
}

// ---------------------------------------------------------------- codes

/** The plan and discount codes held in Utilities, as the coupon screens show them. */
export async function utilitiesCoupons(u: UtilitiesAccess, planName?: (key: string) => string): Promise<CouponView[]> {
  const list = await u.service.discounts.list();
  return list.filter((d) => !d.organizationId && (!d.scope || /^subscription$/i.test(d.scope))).map((d) => couponViewOfDiscount(d, planName));
}

/** The Utilities discount of a code (any state), or null. */
export async function findDiscount(u: UtilitiesAccess, code: string): Promise<UtilitiesDiscount | null> {
  const lower = utilitiesCode(code);
  return (await u.service.discounts.list()).find((d) => d.code === lower && !d.organizationId) ?? null;
}

export interface CouponWrite {
  /** utilities:<discount id> to change one; absent to create. */
  discountId: string | null;
  code: string;
  terms: CouponTerms | null;
  expiresAt?: string;
  active?: boolean;
  note?: string;
}

/** Creates or changes a plan / discount code in Utilities. Switching one off archives it for good. */
export async function saveCouponInUtilities(
  u: UtilitiesAccess,
  w: CouponWrite,
  planName?: (key: string) => string,
): Promise<{ ok: true; coupon: CouponView } | { ok: false; error: OpAnswer<never> }> {
  try {
    if (!w.discountId) {
      if (!w.terms) return { ok: false, error: fail("invalid_input", "tenancy.invalidArgs", { keys: ["kind"] }) };
      if (await findDiscount(u, w.code)) return { ok: false, error: fail("conflict", "billing.couponCodeTaken") };
      const req = createDiscountRequest(w.terms, { note: w.note, expiresAt: w.expiresAt || null, planName });
      if (!req) return { ok: false, error: fail("invalid_input", "tenancy.invalidArgs", { keys: ["kind"] }) };
      let made = await u.service.discounts.create(req);
      if (w.active === false) made = await u.service.discounts.archive(made.discountId);
      return { ok: true, coupon: couponViewOfDiscount(made, planName) };
    }
    const d = await u.service.discounts.get(w.discountId);
    const archived = /^archived$/i.test(d.status);
    if (archived) {
      if (w.active === true) return { ok: false, error: fail("conflict", "billing.utilities.archived", { code: d.code.toUpperCase() }) };
      return { ok: true, coupon: couponViewOfDiscount(d, planName) };
    }
    if (w.code && utilitiesCode(w.code) !== d.code) return { ok: false, error: fail("invalid_input", "tenancy.invalidArgs", { keys: ["code"] }) };
    let next = d;
    const changesTerms = w.terms !== null || w.note !== undefined || w.expiresAt !== undefined;
    if (changesTerms) {
      const terms = w.terms ?? termsOfDiscount(d);
      const expiresAt = w.expiresAt !== undefined ? w.expiresAt || null : d.expiresAtUtc ?? null;
      const body = discountTerms(terms, { note: w.note ?? d.displayName, expiresAt, planName });
      if (!body) return { ok: false, error: fail("invalid_input", "tenancy.invalidArgs", { keys: ["kind"] }) };
      next = await u.service.discounts.update(d.discountId, { ...body, oneUsePerOrganization: d.oneUsePerOrganization !== false, expectedVersion: d.version });
    }
    if (w.active === false) next = await u.service.discounts.archive(d.discountId);
    return { ok: true, coupon: couponViewOfDiscount(next, planName) };
  } catch (e) {
    return { ok: false, error: utilitiesFailure(e, "catalogue") };
  }
}
