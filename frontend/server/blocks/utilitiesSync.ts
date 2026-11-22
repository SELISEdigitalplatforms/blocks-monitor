// The one-time move of the Factory's catalogue into Blocks Utilities (scripts/blocks-utilities-sync.mjs): every plan
// (the Plan rows, the defaults for keys not stored: Free, Classic USD 199, Speed USD 399, Enterprise contact sales)
// and every plan and discount code (the Coupon rows) become Utilities plans (with their monthly USD price) and
// discounts. Credit codes stay Coupon rows (Utilities has no code that adds credit). Without --apply it only prints
// what it would do; a rerun does only what is left (plans by code, discounts by code). It never switches
// billing.source: that is done on Platform > Plans once the result is checked.
//
//   node scripts/blocks-utilities-sync.mjs [--apply] [--report <file>] [--env-file <file>]
//
// The service identity comes from MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET (environment, the app's
// .env, or --env-file); Utilities is called at MF_BLOCKS_UTILITIES_BASE (default /utilities/v4 on the Blocks API). No
// credential, token or Utilities answer text is ever printed or written to the report.
import fs from "node:fs";
import path from "node:path";
import { createRawGateway, type RawGateway } from "../../functions/_lib/gateway";
import { f } from "../../functions/_lib/filter";
import { defaultSdk } from "../../functions/_lib/sdk";
import { serviceTokens } from "../../functions/_lib/serviceToken";
import { isUtilitiesError, serviceUtilities } from "../../functions/_lib/blocksUtilities";
import { COUPON_FIELDS, PLAN_FIELDS, planFromRow } from "../../functions/billing/ops/shared";
import { DEFAULT_PLANS, type PlanView } from "../../src/domain/billing";
import { couponTermsOf, type CouponTerms } from "../../src/domain/payments";
import { BILLING_INTERVAL, USD, utilitiesBaseOf, type UtilitiesApi, type UtilitiesDiscount, type UtilitiesPlan } from "../../src/domain/blocksUtilities";
import {
  createDiscountRequest,
  createPlanRequest,
  discountTerms,
  monthlyUsdPrice,
  planDefinition,
  planMatches,
  termsOfDiscount,
  utilitiesCode,
} from "../../src/domain/utilitiesBilling";
import { serviceEnv } from "../iam/migrate/main";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface FactoryCoupon {
  code: string;
  terms: CouponTerms;
  active: boolean;
  expiresAt: string | null;
  note: string;
  redemptions: number;
  maxRedemptions: number;
}

export type SyncAction =
  | { kind: "plan.create"; key: string; plan: PlanView }
  | { kind: "plan.update"; key: string; planId: string; plan: PlanView; newPriceCents: number | null; archivePriceId: string | null }
  | { kind: "plan.archive"; key: string; planId: string }
  | { kind: "plan.keep"; key: string; reason: "same" | "archived-in-utilities" }
  | { kind: "discount.create"; code: string; coupon: FactoryCoupon }
  | { kind: "discount.update"; code: string; discountId: string; version: number; coupon: FactoryCoupon }
  | { kind: "discount.archive"; code: string; discountId: string }
  | { kind: "discount.keep"; code: string; reason: "same" | "archived-in-utilities" }
  | { kind: "coupon.stays"; code: string; reason: "credit-code" };

/** The Factory's plans as the platform sells them: the rows, and the defaults for keys not stored. */
export async function readFactoryCatalogue(raw: Pick<RawGateway, "findAll">): Promise<{ plans: PlanView[]; coupons: FactoryCoupon[] }> {
  const both = async (schema: string, fields: readonly string[]) =>
    (await Promise.all([true, false].map((on) => raw.findAll(schema, { where: f.eq("Active", on), fields, max: 5000 })))).flat();
  const [planRows, couponRows] = await Promise.all([both("Plan", PLAN_FIELDS), both("Coupon", COUPON_FIELDS)]);
  const stored = new Map<string, PlanView>();
  for (const p of planRows.map(planFromRow)) if (p.key && (!stored.has(p.key) || p.active)) stored.set(p.key, p);
  for (const d of DEFAULT_PLANS) if (!stored.has(d.key)) stored.set(d.key, { ...d, features: [...d.features] });
  const plans = [...stored.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const coupons = couponRows
    .filter((r) => str(r.Code))
    .map((r: Row) => ({
      code: str(r.Code),
      terms: couponTermsOf(r),
      active: r.Active === true,
      expiresAt: str(r.ExpiresAt) || null,
      note: str(r.Note),
      redemptions: typeof r.Redemptions === "number" ? r.Redemptions : 0,
      maxRedemptions: typeof r.MaxRedemptions === "number" ? r.MaxRedemptions : 0,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { plans, coupons };
}

const sameTerms = (d: UtilitiesDiscount, c: FactoryCoupon): boolean => {
  const want = discountTerms(c.terms, { note: c.note, expiresAt: c.expiresAt });
  const have = termsOfDiscount(d);
  if (!want) return false;
  return (
    have.kind === c.terms.kind && JSON.stringify(have.planKeys) === JSON.stringify(c.terms.planKeys) && have.durationMonths === c.terms.durationMonths &&
    have.percentOff === c.terms.percentOff && have.amountOffCents === c.terms.amountOffCents && (d.displayName ?? "") === want.displayName &&
    (d.expiresAtUtc ? new Date(d.expiresAtUtc).toISOString() : null) === (want.expiresAtUtc ?? null)
  );
};

/** What the move does: per plan and per code, against what Utilities holds now. */
export function planSync(factory: { plans: PlanView[]; coupons: FactoryCoupon[] }, held: { plans: UtilitiesPlan[]; discounts: UtilitiesDiscount[] }): SyncAction[] {
  const actions: SyncAction[] = [];
  for (const p of factory.plans) {
    const same = held.plans.filter((u) => u.code === p.key && !u.organizationId);
    const u = same.find((x) => /^active$/i.test(x.status)) ?? same[0];
    if (!u) {
      actions.push({ kind: "plan.create", key: p.key, plan: p });
      continue;
    }
    if (!/^active$/i.test(u.status)) {
      actions.push({ kind: "plan.keep", key: p.key, reason: "archived-in-utilities" });
      continue;
    }
    if (!p.active) {
      actions.push({ kind: "plan.archive", key: p.key, planId: u.planId });
      continue;
    }
    if (planMatches(u, p)) {
      actions.push({ kind: "plan.keep", key: p.key, reason: "same" });
      continue;
    }
    const price = monthlyUsdPrice(u);
    const wanted = p.contactSales || p.priceUsd === null ? null : Math.round(p.priceUsd * 100);
    const priceChanges = wanted === null ? price !== null : !price || price.unitAmountMinor !== wanted;
    actions.push({
      kind: "plan.update", key: p.key, planId: u.planId, plan: p,
      newPriceCents: priceChanges ? wanted : null, archivePriceId: priceChanges && price ? price.priceId : null,
    });
  }
  for (const c of factory.coupons) {
    if (c.terms.kind === "credit") {
      actions.push({ kind: "coupon.stays", code: c.code, reason: "credit-code" });
      continue;
    }
    const d = held.discounts.find((x) => x.code === utilitiesCode(c.code) && !x.organizationId);
    if (!d) actions.push({ kind: "discount.create", code: c.code, coupon: c });
    else if (/^archived$/i.test(d.status)) actions.push({ kind: "discount.keep", code: c.code, reason: "archived-in-utilities" });
    else if (!c.active) actions.push({ kind: "discount.archive", code: c.code, discountId: d.discountId });
    else if (sameTerms(d, c)) actions.push({ kind: "discount.keep", code: c.code, reason: "same" });
    else actions.push({ kind: "discount.update", code: c.code, discountId: d.discountId, version: d.version, coupon: c });
  }
  return actions;
}

export function describeAction(a: SyncAction): string {
  switch (a.kind) {
    case "plan.create":
      return `plan ${a.key}: create (${a.plan.priceUsd === null ? "contact sales, no price" : `USD ${a.plan.priceUsd.toFixed(2)} a month`}${a.plan.active ? "" : ", then archive"})`;
    case "plan.update":
      return `plan ${a.key}: new version${a.newPriceCents !== null ? `, new price USD ${(a.newPriceCents / 100).toFixed(2)} a month` : a.archivePriceId ? ", price withdrawn" : ""}`;
    case "plan.archive":
      return `plan ${a.key}: archive (switched off here)`;
    case "plan.keep":
      return `plan ${a.key}: nothing to do (${a.reason === "same" ? "the same" : "archived in Utilities; it cannot be switched on again"})`;
    case "discount.create":
      return `code ${a.code}: create (${a.coupon.terms.kind}${a.coupon.active ? "" : ", then archive"})${a.coupon.redemptions ? `; ${a.coupon.redemptions} earlier use(s) are not carried over` : ""}${a.coupon.maxRedemptions ? "; the total limit is not carried over (Utilities: one use per organization)" : ""}`;
    case "discount.update":
      return `code ${a.code}: new version of its terms`;
    case "discount.archive":
      return `code ${a.code}: archive (switched off here)`;
    case "discount.keep":
      return `code ${a.code}: nothing to do (${a.reason === "same" ? "the same" : "archived in Utilities"})`;
    case "coupon.stays":
      return `code ${a.code}: stays here (a credit code; Utilities has no code that adds credit)`;
  }
}

export interface ApplyResult {
  done: number;
  failed: { action: string; code: string; status: number | null }[];
}

/** Carries the actions out one by one; a failure is recorded (the service's code and status only) and the rest go on. */
export async function applySync(u: UtilitiesApi, actions: readonly SyncAction[], log: (l: string) => void): Promise<ApplyResult> {
  const result: ApplyResult = { done: 0, failed: [] };
  const price = (planId: string, cents: number) => u.plans.createPrice({ planId, currencyCode: USD, unitAmountMinor: cents, interval: BILLING_INTERVAL.Month, intervalCount: 1 });
  for (const a of actions) {
    try {
      switch (a.kind) {
        case "plan.create": {
          const made = await u.plans.create(createPlanRequest(a.plan));
          if (a.plan.priceUsd !== null && !a.plan.contactSales) await price(made.planId, Math.round(a.plan.priceUsd * 100));
          if (!a.plan.active) await u.plans.archive(made.planId);
          break;
        }
        case "plan.update":
          await u.plans.update(a.planId, planDefinition(a.plan));
          if (a.newPriceCents !== null) await price(a.planId, a.newPriceCents);
          if (a.archivePriceId) await u.plans.archivePrice(a.archivePriceId);
          break;
        case "plan.archive":
          await u.plans.archive(a.planId);
          break;
        case "discount.create": {
          const req = createDiscountRequest(a.coupon.terms, { note: a.coupon.note, expiresAt: a.coupon.expiresAt });
          if (!req) continue;
          const made = await u.discounts.create(req);
          if (!a.coupon.active) await u.discounts.archive(made.discountId);
          break;
        }
        case "discount.update": {
          const body = discountTerms(a.coupon.terms, { note: a.coupon.note, expiresAt: a.coupon.expiresAt });
          if (!body) continue;
          await u.discounts.update(a.discountId, { ...body, expectedVersion: a.version });
          break;
        }
        case "discount.archive":
          await u.discounts.archive(a.discountId);
          break;
        default:
          continue;
      }
      result.done++;
      log(`done: ${describeAction(a)}`);
    } catch (e) {
      const code = isUtilitiesError(e) ? e.code : "utilities_unavailable";
      const status = isUtilitiesError(e) ? e.status : null;
      result.failed.push({ action: describeAction(a), code, status });
      log(`failed: ${describeAction(a)} (${code}${status ? `, ${status}` : ""})`);
    }
  }
  return result;
}

function argOf(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? "" : "";
}

export interface SyncWiring {
  raw: Pick<RawGateway, "findAll">;
  utilities: UtilitiesApi;
}

const USAGE = "Usage: node scripts/blocks-utilities-sync.mjs [--apply] [--report <file>] [--env-file <file>]";

/** The command: prints the plan; with --apply carries it out. Exit 1 when anything failed. */
export async function syncMain(argv: string[], root: string, o: { wiring?: SyncWiring; log?: (l: string) => void; now?: () => Date } = {}): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const now = o.now ?? (() => new Date());
  if (argv.includes("--help")) {
    log(USAGE);
    return 0;
  }
  const apply = argv.includes("--apply");
  let wiring = o.wiring;
  if (!wiring) {
    const env = serviceEnv(argv, root, log);
    if (!env) return 1;
    const tokens = serviceTokens(env, defaultSdk);
    const base = utilitiesBaseOf(process.env.MF_BLOCKS_UTILITIES_BASE);
    wiring = { raw: createRawGateway({ env, sdk: defaultSdk, tokens, batch: false }), utilities: serviceUtilities({ env: { ...env, utilitiesBase: base }, sdk: defaultSdk, tokens }) };
  }
  const startedAt = now().toISOString();
  const factory = await readFactoryCatalogue(wiring.raw);
  let held: { plans: UtilitiesPlan[]; discounts: UtilitiesDiscount[] };
  try {
    const [plans, discounts] = await Promise.all([wiring.utilities.plans.list({ status: "All" }), wiring.utilities.discounts.list()]);
    held = { plans, discounts };
  } catch (e) {
    log(`Blocks Utilities did not answer the catalogue read (${isUtilitiesError(e) ? `${e.code}${e.status ? `, ${e.status}` : ""}` : "unreachable"}). Nothing was written.`);
    return 1;
  }
  const actions = planSync(factory, held);
  for (const a of actions) log(describeAction(a));
  const todo = actions.filter((a) => !["plan.keep", "discount.keep", "coupon.stays"].includes(a.kind));
  const reportFile = argOf(argv, "--report") || path.join(root, "data", "blocks-utilities-sync", `${apply ? "apply" : "plan"}-${startedAt.replace(/[:.]/g, "-")}.json`);
  const base = {
    kind: "blocks-utilities-sync",
    mode: apply ? "apply" : "dry-run",
    startedAt,
    factory: { plans: factory.plans.length, coupons: factory.coupons.length },
    utilities: { plans: held.plans.length, discounts: held.discounts.length },
    actions: actions.map((a) => ({ kind: a.kind, what: describeAction(a) })),
  };
  const write = (body: unknown) => {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(body, null, 2)}\n`);
    log(`report: ${reportFile}`);
  };
  if (!apply) {
    log(`dry run: ${todo.length} change(s) to make; nothing written to Utilities (add --apply).`);
    write(base);
    return 0;
  }
  const result = await applySync(wiring.utilities, todo, log);
  write({ ...base, finishedAt: now().toISOString(), result });
  log(`${result.done} done, ${result.failed.length} failed. billing.source is unchanged: switch it on Platform > Plans when the catalogue is checked.`);
  return result.failed.length ? 1 : 0;
}
