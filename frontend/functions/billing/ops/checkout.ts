// Checkout and subscription management (functions/billing): billing.checkout.start / applyCode / confirm,
// billing.subscription.change / cancel / resume, billing.payments.list, billing.access, billing.paywall.get / save and
// billing.renewals.run. The rules are src/domain/payments.ts; the providers functions/billing/ops/providers.ts.
//
// Who may do what: every member of the organization reads (payments.list, access); changes need workspace.manage
// (the organization's owners); paywall settings and the manual renewal run need platform.billing.manage.
//
// Idempotency: a checkout is one Payment row (Status open -> paid). Confirm grants the credit under a once key (the
// code's redemption slot coupon:<code>:<n> carrying the payment id, or payment:<id> without a code), so a refresh, a
// retry or two tabs never grant twice; a paid checkout answers its receipt again.
import {
  COUPON_CODE,
  addMonth,
  billingTotals,
  centsToUsd,
  couponRefusal,
  normalizeCouponCode,
  toCents,
  type PlanView,
} from "../../../src/domain/billing";
import {
  CHECKOUT_TTL_MS,
  SETTING_ENFORCE,
  SETTING_INTERNAL_WORKSPACES,
  SETTING_PROVIDER,
  PAYMENT_PROVIDERS,
  changeDirection,
  couponTermsOf,
  paywallVerdict,
  prorateCents,
  receiptNumber,
  settingBool,
  settingList,
  settingProvider,
  usd,
  type AccessView,
  type BillingAccountView,
  type ChangeAnswer,
  type CheckoutBase,
  type CheckoutView,
  type CodeQuote,
  type PaymentProviderId,
  type PaymentView,
  type PaywallSettings,
  type SubscriptionView,
} from "../../../src/domain/payments";
import { audit, fail, ok, openOp, readArgs } from "../../workspace/ops/_shared/core";
import type { Gateway, OpAnswer, OpCtx, OpDeps } from "../../workspace/ops/_shared/ports";
import { providerOf } from "./providers";
import { noteBillingWrite } from "./readCache";
import { utilitiesFailure } from "./utilitiesCatalogue";
import { BILLING_SOURCES, SETTING_SOURCE, settingSource, type BillingSource } from "../../../src/domain/utilitiesBilling";
import { renewDue, type RenewalReport } from "./renewal";
import {
  BILLING_SCHEMA,
  COUPON_FIELDS,
  CREDIT_FIELDS,
  PAYMENT_FIELDS,
  entryRow,
  num,
  openPlatform,
  planOf,
  readPlans,
  unlistedPlan,
  str,
  subscriptionOf,
  workspaceEntries,
  workspaceNames,
  type Row,
} from "./shared";

const bad = (keys: string[]): OpAnswer<never> => fail("invalid_input", "tenancy.invalidArgs", { keys });
const MANAGE = "workspace.manage" as const;

// ---------------------------------------------------------------- settings

export interface PaymentSettings {
  source: BillingSource;
  provider: PaymentProviderId;
  enforce: boolean;
  internalWorkspaceIds: string[];
  rows: Row[];
}

export async function readPaymentSettings(gateway: Pick<Gateway, "listAll">): Promise<PaymentSettings> {
  const rows = await gateway.listAll<Row>(BILLING_SCHEMA.platformSetting, {
    filter: { Key: { in: [SETTING_PROVIDER, SETTING_ENFORCE, SETTING_INTERNAL_WORKSPACES, SETTING_SOURCE] } },
    fields: ["ItemId", "Key", "ValueJson"],
  });
  const value = (key: string) => rows.find((r) => r.Key === key)?.ValueJson;
  return {
    source: settingSource(value(SETTING_SOURCE)),
    provider: settingProvider(value(SETTING_PROVIDER)),
    enforce: settingBool(value(SETTING_ENFORCE), false),
    internalWorkspaceIds: settingList(value(SETTING_INTERNAL_WORKSPACES)),
    rows,
  };
}

const nameOf = (plans: readonly PlanView[]) => (key: string) => planOf(plans, key)?.name ?? key;

// ---------------------------------------------------------------- views

const orNull = (v: unknown): string | null => str(v) || null;

export function paymentView(r: Row, plans: readonly PlanView[]): PaymentView {
  return {
    id: str(r.ItemId),
    kind: (str(r.Kind) || "new") as PaymentView["kind"],
    planKey: str(r.PlanKey),
    planName: nameOf(plans)(str(r.PlanKey)),
    fromPlanKey: orNull(r.FromPlanKey),
    provider: (str(r.Provider) || "coupon") as PaymentProviderId,
    amountUsd: centsToUsd(toCents(num(r.AmountUsd))),
    discountUsd: centsToUsd(toCents(num(r.DiscountUsd))),
    paidUsd: centsToUsd(toCents(num(r.PaidUsd))),
    creditUsd: centsToUsd(toCents(num(r.CreditUsd))),
    couponCode: orNull(r.CouponCode),
    status: (str(r.Status) || "open") as PaymentView["status"],
    receiptNo: orNull(r.ReceiptNo),
    periodStart: str(r.PeriodStart),
    periodEnd: str(r.PeriodEnd),
    paidThrough: orNull(r.PaidThroughAt),
    paidAt: orNull(r.PaidAt),
    note: str(r.Note),
  };
}

export function subscriptionView(sub: Row | null, plans: readonly PlanView[]): SubscriptionView {
  const status = (sub ? str(sub.Status) || "active" : "active") as SubscriptionView["status"];
  const key = sub && status !== "cancelled" ? str(sub.PlanKey) || "free" : "free";
  // a plan the catalogue does not list keeps its key, with no price (never another plan's or a built-in one's)
  const plan = planOf(plans, key);
  const next = sub ? str(sub.NextPlanKey) : "";
  return {
    planKey: key,
    planName: plan?.name ?? key,
    priceUsd: plan ? plan.priceUsd : null,
    status,
    startedAt: orNull(sub?.StartedAt),
    currentPeriodStart: orNull(sub?.CurrentPeriodStart) ?? orNull(sub?.StartedAt),
    renewsAt: orNull(sub?.RenewsAt),
    paidThrough: orNull(sub?.PaidThroughAt),
    cancelAtPeriodEnd: sub?.CancelAtPeriodEnd === true,
    nextPlan: next ? { key: next, name: nameOf(plans)(next) } : null,
    provider: (orNull(sub?.Provider) as PaymentProviderId | null) ?? null,
    couponCode: orNull(sub?.CouponCode),
    statusNote: str(sub?.StatusNote),
    pastDueSince: orNull(sub?.PastDueSince),
  };
}

interface StoredBase extends CheckoutBase {
  v: 1;
  quote?: CodeQuote | null;
}

function baseOf(r: Row): StoredBase | null {
  try {
    const v = JSON.parse(str(r.DetailJson) || "null") as StoredBase | null;
    return v && v.v === 1 ? v : null;
  } catch {
    return null;
  }
}

function isExpired(r: Row, nowIso: string): boolean {
  return str(r.Status) === "open" && Boolean(str(r.ExpiresAt)) && str(r.ExpiresAt) <= nowIso;
}

function checkoutView(r: Row, plans: readonly PlanView[], settings: PaymentSettings, nowIso: string): CheckoutView {
  const base = baseOf(r);
  const plan = planOf(plans, str(r.PlanKey)) ?? unlistedPlan(str(r.PlanKey));
  const provider = providerOf(settings.provider, nameOf(plans)).status();
  const quote = base?.quote ?? null;
  const amount = toCents(num(r.AmountUsd));
  const discount = toCents(num(r.DiscountUsd));
  const due = Math.max(0, amount - discount);
  const status = isExpired(r, nowIso) ? "expired" : ((str(r.Status) || "open") as CheckoutView["status"]);
  let blocker: string | null = null;
  if (status === "open" && due > 0 && !provider.acceptsCards) {
    blocker = discount > 0
      ? `The code takes ${usd(discount)} off. The remaining ${usd(due)} needs a card payment, and card payments are being connected. A plan code pays the whole plan.`
      : provider.message;
  }
  const from = str(r.FromPlanKey);
  return {
    id: str(r.ItemId),
    workspaceId: str(r.WorkspaceId),
    status,
    kind: str(r.Kind) === "upgrade" ? "upgrade" : "new",
    plan,
    fromPlan: from ? { key: from, name: nameOf(plans)(from) } : null,
    amountUsd: centsToUsd(amount),
    creditUsd: centsToUsd(toCents(num(r.CreditUsd))),
    periodStart: str(r.PeriodStart),
    renewsOn: str(r.PeriodEnd),
    code: str(r.CouponCode) && quote ? { code: str(r.CouponCode), kind: quote.kind, description: quote.description } : null,
    discountUsd: centsToUsd(discount),
    dueUsd: centsToUsd(due),
    paidThrough: orNull(r.PaidThroughAt),
    provider,
    canConfirm: status === "open" && (due === 0 || provider.acceptsCards),
    blocker,
    expiresAt: str(r.ExpiresAt),
    receipt: status === "paid" ? paymentView(r, plans) : null,
  };
}

// ---------------------------------------------------------------- helpers

async function openOwner(ctx: OpCtx, deps: OpDeps, workspaceId: string) {
  if (!workspaceId) return { ok: false as const, error: { code: "invalid_input" as const, messageKey: "tenancy.invalidArgs", params: { keys: ["workspaceId"] } } };
  return openOp(ctx, deps, { scope: "workspace", workspaceId, permission: MANAGE });
}

async function loadPayment(g: Gateway, id: string): Promise<Row | null> {
  if (!id) return null;
  const rows = await g.listAll<Row>(BILLING_SCHEMA.payment, { filter: { ItemId: id }, fields: PAYMENT_FIELDS, maxItems: 1 });
  return rows[0] ?? null;
}

/** What a checkout for `plan` costs now: a new plan (monthly price) or an upgrade (prorated difference). */
function checkoutBase(plan: PlanView, sub: Row | null, plans: readonly PlanView[], nowIso: string):
  | { ok: true; base: CheckoutBase; fromPlanKey: string }
  | { ok: false; error: OpAnswer<never> } {
  if (!plan.active || plan.contactSales || plan.priceUsd === null) return { ok: false, error: fail("conflict", "billing.plan.contactSales") };
  if (plan.priceUsd <= 0) return { ok: false, error: fail("conflict", "billing.checkout.freePlan") };
  const status = sub ? str(sub.Status) : "";
  const curKey = sub && status === "active" ? str(sub.PlanKey) : "";
  const cur = curKey ? planOf(plans, curKey) : null;
  const price = toCents(plan.priceUsd);
  const credit = toCents(plan.creditUsd);
  const fresh = { ok: true as const, base: { planKey: plan.key, kind: "new" as const, priceCents: price, amountCents: price, creditCents: credit, monthCreditCents: credit, periodStart: nowIso, periodEnd: addMonth(nowIso) }, fromPlanKey: "" };
  if (!cur || !cur.priceUsd || cur.priceUsd <= 0) return fresh;
  const dir = changeDirection(cur, plan);
  if (dir === "same") return { ok: false, error: fail("conflict", "billing.checkout.alreadyOnPlan") };
  if (dir === "downgrade") return { ok: false, error: fail("conflict", "billing.checkout.downgradeAtRenewal") };
  const start = str(sub!.CurrentPeriodStart) || str(sub!.StartedAt);
  const end = str(sub!.RenewsAt);
  if (!start || !end || end <= nowIso) return { ...fresh, fromPlanKey: cur.key };
  return {
    ok: true,
    fromPlanKey: cur.key,
    base: {
      planKey: plan.key,
      kind: "upgrade",
      priceCents: price,
      amountCents: prorateCents(price - toCents(cur.priceUsd), start, end, nowIso),
      creditCents: prorateCents(Math.max(0, credit - toCents(cur.creditUsd)), start, end, nowIso),
      monthCreditCents: credit,
      periodStart: nowIso,
      periodEnd: end,
    },
  };
}

/** The base fields of a checkout row (no code). */
function baseFields(b: CheckoutBase): Row {
  return {
    AmountUsd: centsToUsd(b.amountCents),
    DiscountUsd: 0,
    PaidUsd: 0,
    CreditUsd: centsToUsd(b.creditCents),
    CouponCode: "",
    PeriodStart: b.periodStart,
    PeriodEnd: b.periodEnd,
    PaidThroughAt: "",
    DetailJson: JSON.stringify({ v: 1, ...b, quote: null } satisfies StoredBase),
  };
}

function quoteFields(b: CheckoutBase, q: CodeQuote): Row {
  return {
    DiscountUsd: centsToUsd(q.discountCents),
    CreditUsd: centsToUsd(q.creditCents),
    CouponCode: q.code,
    PeriodStart: q.periodStart,
    PeriodEnd: q.periodEnd,
    PaidThroughAt: q.paidThrough ?? "",
    DetailJson: JSON.stringify({ v: 1, ...b, quote: q } satisfies StoredBase),
  };
}

interface CodeCheck {
  ok: true;
  coupon: Row;
  /** The credit entries of this code (every redemption slot). */
  entries: Row[];
  /** This payment's own slot, when a confirm already wrote it. */
  mine: Row | null;
}

const slotPaymentId = (e: Row): string => {
  try {
    return str((JSON.parse(str(e.DetailJson) || "{}") as { paymentId?: unknown }).paymentId);
  } catch {
    return "";
  }
};

/** Whether `code` may be used by this organization and person now (this payment's own slot does not count). */
async function checkCode(g: Gateway, o: { code: string; workspaceId: string; userId: string; paymentId: string; nowIso: string }): Promise<CodeCheck | { ok: false; error: OpAnswer<never> }> {
  const [coupons, entries] = await Promise.all([
    g.listAll<Row>(BILLING_SCHEMA.coupon, { filter: { Code: o.code }, fields: COUPON_FIELDS, maxItems: 2 }),
    g.listAll<Row>(BILLING_SCHEMA.creditEntry, { filter: { CouponCode: o.code }, fields: CREDIT_FIELDS, maxItems: 5000 }),
  ]);
  const coupon = coupons[0];
  if (!coupon) return { ok: false, error: fail("not_found", "billing.couponUnknown") };
  const mine = o.paymentId ? entries.find((e) => slotPaymentId(e) === o.paymentId) ?? null : null;
  const others = entries.filter((e) => e !== mine);
  if (others.some((e) => e.WorkspaceId === o.workspaceId)) return { ok: false, error: fail("conflict", "billing.couponAlreadyRedeemed") };
  if (!mine) {
    const refusal = couponRefusal(coupon, o.nowIso, others.length);
    if (refusal) return { ok: false, error: fail(refusal === "used-up" ? "limit_reached" : "forbidden", `billing.coupon.${refusal}`) };
  }
  const terms = couponTermsOf(coupon);
  if (terms.perPersonLimit > 0 && others.filter((e) => e.UserId === o.userId).length >= terms.perPersonLimit) {
    return { ok: false, error: fail("limit_reached", "billing.coupon.personLimit", { limit: terms.perPersonLimit }) };
  }
  return { ok: true, coupon, entries, mine };
}

function codeRefusal(reason: string, coupon: Row, plans: readonly PlanView[]): OpAnswer<never> {
  const t = couponTermsOf(coupon);
  if (reason === "credit-code") return fail("conflict", "billing.coupon.creditCode", { amountUsd: centsToUsd(t.amountCents) });
  if (reason === "plan-not-allowed") return fail("conflict", "billing.coupon.planNotAllowed", { plans: t.planKeys.map(nameOf(plans)) });
  return fail("conflict", "billing.coupon.notForPlan");
}

// ---------------------------------------------------------------- checkout ops

export async function checkoutStart(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ checkout: CheckoutView }>> {
  const a = readArgs(args, { workspaceId: "string", planKey: "string", code: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, planKey } = a.value;
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(planKey)) return bad(["planKey"]);
  const open = await openOwner(ctx, deps, workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const now = deps.clock.now();
  const [{ plans }, sub, settings, openRows] = await Promise.all([
    readPlans(g),
    subscriptionOf(g, workspaceId),
    readPaymentSettings(g),
    g.listAll<Row>(BILLING_SCHEMA.payment, { filter: { WorkspaceId: workspaceId, Status: "open" }, fields: PAYMENT_FIELDS, maxItems: 50 }),
  ]);
  const plan = planOf(plans, planKey);
  if (!plan) return fail("not_found", "billing.planUnknown");
  const based = checkoutBase(plan, sub, plans, now);
  if (!based.ok) return based.error;
  // The same organization, plan and kind within the day: the same checkout (a refresh shows the same summary and code).
  const reuse = openRows
    .filter((r) => !isExpired(r, now) && str(r.PlanKey) === planKey && str(r.Kind) === based.base.kind && str(r.UserId) === caller.userId)
    .sort((x, y) => str(y.ExpiresAt).localeCompare(str(x.ExpiresAt)))[0];
  let row: Row;
  if (reuse) row = reuse;
  else {
    const res = await g.insertOnce<Row>(
      BILLING_SCHEMA.payment,
      {
        WorkspaceId: workspaceId,
        UserId: caller.userId,
        UserEmail: caller.email,
        Kind: based.base.kind,
        PlanKey: planKey,
        FromPlanKey: based.fromPlanKey,
        Provider: settings.provider,
        ProviderRef: "",
        Status: "open",
        ReceiptNo: "",
        PaidAt: "",
        ExpiresAt: new Date(Date.parse(now) + CHECKOUT_TTL_MS).toISOString(),
        Note: "",
        ...baseFields(based.base),
        CreatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      },
      `checkout:${ctx.requestId}`,
    );
    row = res.item;
  }
  if (a.value.code) {
    const applied = await applyToRow(g, row, a.value.code, { userId: caller.userId, plans, settings, nowIso: now });
    if (!applied.ok) return applied.error;
    row = applied.row;
  }
  return ok({ checkout: checkoutView(row, plans, settings, now) });
}

async function applyToRow(
  g: Gateway,
  row: Row,
  rawCode: string,
  o: { userId: string; plans: readonly PlanView[]; settings: PaymentSettings; nowIso: string },
): Promise<{ ok: true; row: Row } | { ok: false; error: OpAnswer<never> }> {
  const base = baseOf(row);
  if (!base) return { ok: false, error: fail("conflict", "billing.checkout.stale") };
  const id = str(row.ItemId);
  if (!rawCode.trim()) {
    const set = { ...baseFields(base), UpdatedByUserId: o.userId };
    await g.update(BILLING_SCHEMA.payment, id, set);
    return { ok: true, row: { ...row, ...set } };
  }
  const code = normalizeCouponCode(rawCode);
  if (!COUPON_CODE.test(code)) return { ok: false, error: bad(["code"]) };
  const checked = await checkCode(g, { code, workspaceId: str(row.WorkspaceId), userId: o.userId, paymentId: id, nowIso: o.nowIso });
  if (!checked.ok) return checked;
  const provider = providerOf(o.settings.provider, nameOf(o.plans));
  const quoted = provider.applyCode(base, couponTermsOf(checked.coupon), o.nowIso);
  if (!quoted.ok) return { ok: false, error: codeRefusal(quoted.reason, checked.coupon, o.plans) };
  const set = { ...quoteFields(base, quoted.quote), UpdatedByUserId: o.userId };
  await g.update(BILLING_SCHEMA.payment, id, set);
  return { ok: true, row: { ...row, ...set } };
}

async function openCheckout(ctx: OpCtx, deps: OpDeps, checkoutId: string) {
  const row = await loadPayment(deps.gateway, checkoutId);
  if (!row) return { ok: false as const, error: fail("not_found") };
  const open = await openOwner(ctx, deps, str(row.WorkspaceId));
  if (!open.ok) return { ok: false as const, error: { ok: false, error: open.error } as OpAnswer<never> };
  return { ok: true as const, row, caller: open.caller };
}

export async function checkoutApplyCode(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ checkout: CheckoutView }>> {
  const a = readArgs(args, { checkoutId: "string", code: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  if (a.value.code.length > 64) return bad(["code"]);
  const opened = await openCheckout(ctx, deps, a.value.checkoutId);
  if (!opened.ok) return opened.error;
  const g = deps.gateway;
  const now = deps.clock.now();
  const [{ plans }, settings] = await Promise.all([readPlans(g), readPaymentSettings(g)]);
  if (str(opened.row.Status) !== "open" || isExpired(opened.row, now)) return fail("conflict", "billing.checkout.closed");
  const applied = await applyToRow(g, opened.row, a.value.code, { userId: opened.caller.userId, plans, settings, nowIso: now });
  if (!applied.ok) return applied.error;
  return ok({ checkout: checkoutView(applied.row, plans, settings, now) });
}

export async function checkoutConfirm(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ checkout: CheckoutView; balanceUsd: number }>> {
  const a = readArgs(args, { checkoutId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const opened = await openCheckout(ctx, deps, a.value.checkoutId);
  if (!opened.ok) return opened.error;
  const { caller } = opened;
  let row = opened.row;
  const g = deps.gateway;
  const now = deps.clock.now();
  const id = str(row.ItemId);
  const workspaceId = str(row.WorkspaceId);
  const [{ plans }, settings] = await Promise.all([readPlans(g), readPaymentSettings(g)]);
  const balance = async () => centsToUsd(billingTotals(await workspaceEntries(g, workspaceId)).balanceCents);
  // Already paid (a refresh, a retry, a second tab): the same receipt, nothing granted again.
  if (str(row.Status) === "paid") return ok({ checkout: checkoutView(row, plans, settings, now), balanceUsd: await balance() });
  if (str(row.Status) !== "open" || isExpired(row, now)) return fail("conflict", "billing.checkout.closed");
  const base = baseOf(row);
  const plan = planOf(plans, str(row.PlanKey));
  if (!base || !plan) return fail("conflict", "billing.checkout.stale");
  const code = str(row.CouponCode);
  let checked: CodeCheck | null = null;
  if (code) {
    const c = await checkCode(g, { code, workspaceId, userId: caller.userId, paymentId: id, nowIso: now });
    if (!c.ok) return c.error;
    checked = c;
  }
  const due = Math.max(0, toCents(num(row.AmountUsd)) - toCents(num(row.DiscountUsd)));
  const provider = providerOf(settings.provider, nameOf(plans));
  const paid = await provider.confirm({
    paymentId: id, workspaceId, planKey: plan.key, dueCents: due, periodStart: str(row.PeriodStart), periodEnd: str(row.PeriodEnd),
    customerEmail: str(row.UserEmail), providerRef: str(row.ProviderRef),
  });
  if (!paid.ok) {
    return fail("conflict", paid.code === "not_connected" || paid.code === "payment_required" ? "billing.checkout.paymentRequired" : "billing.checkout.paymentFailed", {
      dueUsd: centsToUsd(due), message: paid.message,
    });
  }
  // The credit (and the code's redemption slot) under a once key carrying this payment's id.
  const creditCents = Math.max(0, toCents(num(row.CreditUsd)));
  const detail = JSON.stringify({ paymentId: id });
  const entry = {
    workspaceId, kind: "plan" as const, cents: creditCents, userId: caller.userId, planKey: plan.key, couponCode: code,
    note: base.kind === "upgrade" && !(base.quote?.kind === "plan") ? `${plan.name} plan: credit for the rest of this month` : `${plan.name} plan credit`,
    detailJson: detail,
  };
  if (checked && !checked.mine) {
    const max = num(checked.coupon.MaxRedemptions);
    let slot = checked.entries.length + 1;
    let won = false;
    for (let tries = 0; tries < 5 && (max === 0 || slot <= max); tries++, slot++) {
      const res = await g.insertOnce<Row>(BILLING_SCHEMA.creditEntry, entryRow(entry, now, caller.userId), `coupon:${code}:${slot}`);
      if (res.created || slotPaymentId(res.item) === id) {
        won = true;
        break;
      }
    }
    if (!won) return fail("limit_reached", "billing.coupon.used-up");
    await g.update(BILLING_SCHEMA.coupon, str(checked.coupon.ItemId), { Redemptions: Math.max(num(checked.coupon.Redemptions), slot), UpdatedByUserId: caller.userId });
  } else if (!checked && creditCents > 0) {
    await g.insertOnce<Row>(BILLING_SCHEMA.creditEntry, entryRow(entry, now, caller.userId), `payment:${id}`);
  }
  const sub = await subscriptionOf(g, workspaceId);
  const quote = base.quote ?? null;
  // An upgrade inside the period keeps the period's start (a plan code instead starts a fresh period today).
  const keepsPeriod = base.kind === "upgrade" && quote?.kind !== "plan" && sub;
  const subSet: Row = {
    PlanKey: plan.key,
    Status: "active",
    CurrentPeriodStart: keepsPeriod ? str(sub.CurrentPeriodStart) || str(sub.StartedAt) || str(row.PeriodStart) : str(row.PeriodStart),
    RenewsAt: str(row.PeriodEnd),
    PaidThroughAt: str(row.PaidThroughAt),
    CancelAtPeriodEnd: false,
    NextPlanKey: "",
    Provider: settings.provider,
    ProviderRef: paid.value.providerRef,
    CouponCode: code,
    DiscountUntil: quote?.discountUntil ?? "",
    StatusNote: "",
    PastDueSince: "",
    UpdatedByUserId: caller.userId,
  };
  if (!sub || str(sub.PlanKey) !== plan.key || str(sub.Status) !== "active") subSet.StartedAt = now;
  if (sub) await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), subSet);
  else {
    const res = await g.insertOnce<Row>(BILLING_SCHEMA.subscription, { WorkspaceId: workspaceId, StartedAt: now, ...subSet, CreatedByUserId: caller.userId }, `subscription:${workspaceId}`);
    if (!res.created) await g.update(BILLING_SCHEMA.subscription, res.item.ItemId, subSet);
  }
  const paySet: Row = {
    Status: "paid",
    PaidAt: now,
    PaidUsd: centsToUsd(paid.value.paidCents),
    ProviderRef: paid.value.providerRef,
    Provider: settings.provider,
    ReceiptNo: receiptNumber(id, now),
    UpdatedByUserId: caller.userId,
  };
  await g.update(BILLING_SCHEMA.payment, id, paySet);
  row = { ...row, ...paySet };
  await audit(deps, ctx, caller, {
    workspaceId, targetType: "payment", targetId: id,
    details: { planKey: plan.key, kind: base.kind, amountUsd: num(row.AmountUsd), discountUsd: num(row.DiscountUsd), paidUsd: num(row.PaidUsd), creditUsd: centsToUsd(creditCents), code: code || null, provider: settings.provider },
  });
  return ok({ checkout: checkoutView(row, plans, settings, now), balanceUsd: await balance() });
}

// ---------------------------------------------------------------- subscription ops

export async function subscriptionChange(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<ChangeAnswer>> {
  const a = readArgs(args, { workspaceId: "string", planKey: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const workspaceId = a.value.workspaceId;
  const [{ plans }, sub] = await Promise.all([readPlans(g), subscriptionOf(g, workspaceId)]);
  const target = planOf(plans, a.value.planKey);
  if (!target || !target.active) return fail("not_found", "billing.planUnknown");
  const status = sub ? str(sub.Status) : "";
  const cur = sub && status === "active" ? planOf(plans, str(sub.PlanKey)) : null;
  const dir = changeDirection(cur, target);
  if (dir === "contact-sales") return fail("conflict", "billing.plan.contactSales");
  const curPaid = Boolean(cur && cur.priceUsd && cur.priceUsd > 0);
  if (dir === "upgrade" || (!curPaid && (target.priceUsd ?? 0) > 0)) return ok({ action: "checkout", planKey: target.key });
  if (sub && status === "past_due" && (target.priceUsd ?? 0) <= 0) {
    // Nothing is paid for the period that started: moving to Free ends the plan now.
    const now = deps.clock.now();
    const from = planOf(plans, str(sub.PlanKey));
    const set = {
      PlanKey: target.key, Status: "active", StartedAt: now, CurrentPeriodStart: now, RenewsAt: "", PaidThroughAt: "", CancelAtPeriodEnd: false, NextPlanKey: "",
      CouponCode: "", DiscountUntil: "", Provider: "", ProviderRef: "", PastDueSince: "", StatusNote: `The ${from?.name ?? str(sub.PlanKey)} plan ended. You are on ${target.name}.`,
      UpdatedByUserId: caller.userId,
    };
    await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), set);
    await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { from: str(sub.PlanKey), to: target.key, pastDue: true } });
    return ok({ action: "scheduled", planKey: target.key, effectiveAt: now, subscription: subscriptionView({ ...sub, ...set }, plans) });
  }
  if (dir === "same") {
    // Choosing the current plan keeps it: a scheduled downgrade or cancel is undone.
    if (sub && (str(sub.NextPlanKey) || sub.CancelAtPeriodEnd === true)) {
      const set = { NextPlanKey: "", CancelAtPeriodEnd: false, UpdatedByUserId: caller.userId };
      await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), set);
      await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { kept: target.key } });
      return ok({ action: "kept", subscription: subscriptionView({ ...sub, ...set }, plans) });
    }
    return ok({ action: "kept", subscription: subscriptionView(sub, plans) });
  }
  if (!sub || !curPaid) return ok({ action: "kept", subscription: subscriptionView(sub, plans) });
  // A downgrade (a lower price or Free) takes effect on the renewal day.
  const set = { NextPlanKey: target.key, CancelAtPeriodEnd: false, UpdatedByUserId: caller.userId };
  await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), set);
  await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { from: cur!.key, to: target.key, at: str(sub.RenewsAt) } });
  return ok({ action: "scheduled", planKey: target.key, effectiveAt: str(sub.RenewsAt), subscription: subscriptionView({ ...sub, ...set }, plans) });
}

export async function subscriptionCancel(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ subscription: SubscriptionView }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const workspaceId = a.value.workspaceId;
  const [{ plans }, sub, settings] = await Promise.all([readPlans(g), subscriptionOf(g, workspaceId), readPaymentSettings(g)]);
  const cur = sub ? planOf(plans, str(sub.PlanKey)) : null;
  if (!sub || !cur || !cur.priceUsd || cur.priceUsd <= 0 || !["active", "past_due"].includes(str(sub.Status))) return fail("conflict", "billing.subscription.nothingToCancel");
  let set: Row;
  if (str(sub.Status) === "past_due") {
    // Nothing is paid for the period that started: the plan ends now and the organization is on Free.
    set = { PlanKey: "free", Status: "active", StartedAt: deps.clock.now(), RenewsAt: "", CurrentPeriodStart: deps.clock.now(), PaidThroughAt: "", CancelAtPeriodEnd: false, NextPlanKey: "", CouponCode: "", Provider: "", ProviderRef: "", StatusNote: `The ${cur.name} plan was cancelled. You are on Free.`, PastDueSince: "", UpdatedByUserId: caller.userId };
  } else {
    if (str(sub.Provider) === "blocks") {
      const res = await providerOf(settings.provider, nameOf(plans)).cancel({ workspaceId, providerRef: str(sub.ProviderRef) });
      if (!res.ok && res.code !== "not_connected") return fail("unavailable", "billing.provider.unavailable", { message: res.message });
    }
    set = { CancelAtPeriodEnd: true, NextPlanKey: "", UpdatedByUserId: caller.userId };
  }
  await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), set);
  await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { cancel: cur.key, at: str(sub.RenewsAt) || null } });
  return ok({ subscription: subscriptionView({ ...sub, ...set }, plans) });
}

export async function subscriptionResume(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ subscription: SubscriptionView }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const workspaceId = a.value.workspaceId;
  const [{ plans }, sub, settings] = await Promise.all([readPlans(g), subscriptionOf(g, workspaceId), readPaymentSettings(g)]);
  if (!sub) return fail("conflict", "billing.subscription.nothingToResume");
  if (str(sub.Status) === "past_due") return fail("conflict", "billing.subscription.payToResume", { planKey: str(sub.PlanKey) });
  if (sub.CancelAtPeriodEnd !== true && !str(sub.NextPlanKey)) return ok({ subscription: subscriptionView(sub, plans) });
  if (str(sub.Provider) === "blocks" && sub.CancelAtPeriodEnd === true) {
    const res = await providerOf(settings.provider, nameOf(plans)).resume({ workspaceId, providerRef: str(sub.ProviderRef) });
    if (!res.ok && res.code !== "not_connected") return fail("unavailable", "billing.provider.unavailable", { message: res.message });
  }
  const set = { CancelAtPeriodEnd: false, NextPlanKey: "", UpdatedByUserId: caller.userId };
  await g.update(BILLING_SCHEMA.subscription, str(sub.ItemId), set);
  await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { resumed: str(sub.PlanKey) } });
  return ok({ subscription: subscriptionView({ ...sub, ...set }, plans) });
}

const HISTORY = ["paid", "failed", "refunded"];

export async function paymentsList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<BillingAccountView>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const workspaceId = a.value.workspaceId;
  if (!workspaceId) return bad(["workspaceId"]);
  const open = await openOp(ctx, deps, { scope: "workspace", workspaceId, permission: null });
  if (!open.ok) return { ok: false, error: open.error };
  const g = deps.gateway;
  const [{ plans }, sub, settings, rows] = await Promise.all([
    readPlans(g),
    subscriptionOf(g, workspaceId),
    readPaymentSettings(g),
    g.listAll<Row>(BILLING_SCHEMA.payment, { filter: { WorkspaceId: workspaceId, Status: { in: HISTORY } }, fields: PAYMENT_FIELDS, maxItems: 500 }),
  ]);
  const payments = rows
    .map((r) => paymentView(r, plans))
    .sort((x, y) => (y.paidAt ?? y.periodStart).localeCompare(x.paidAt ?? x.periodStart));
  return ok({
    subscription: subscriptionView(sub, plans),
    payments,
    canManage: open.caller.access?.permissions.includes(MANAGE) === true,
    provider: providerOf(settings.provider, nameOf(plans)).status(),
  });
}

// ---------------------------------------------------------------- paywall

/** Whether new engine work may start for the organization (the same rule the job queue applies). */
export async function access(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<AccessView>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  if (!a.value.workspaceId) return bad(["workspaceId"]);
  const open = await openOp(ctx, deps, { scope: "workspace", workspaceId: a.value.workspaceId, permission: null });
  if (!open.ok) return { ok: false, error: open.error };
  const g = deps.gateway;
  const [settings, entries, sub] = await Promise.all([readPaymentSettings(g), workspaceEntries(g, a.value.workspaceId), subscriptionOf(g, a.value.workspaceId)]);
  const internal = settings.internalWorkspaceIds.includes(a.value.workspaceId);
  const balanceCents = billingTotals(entries).balanceCents;
  const verdict = paywallVerdict({ enforce: settings.enforce, internal, balanceCents });
  return ok({
    allowed: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    enforce: settings.enforce,
    internal,
    balanceUsd: centsToUsd(balanceCents),
    planKey: sub && str(sub.Status) !== "cancelled" ? str(sub.PlanKey) || "free" : "free",
  });
}

export async function paywallGet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<PaywallSettings>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const s = await readPaymentSettings(deps.gateway);
  return ok({ source: s.source, enforce: s.enforce, internalWorkspaceIds: s.internalWorkspaceIds, provider: s.provider, providerStatus: providerOf(s.provider).status() });
}

export async function paywallSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<PaywallSettings>> {
  const a = readArgs(args, { enforce: "boolean?", internalWorkspaceIds: "string[]?", provider: "string?", source: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { enforce, internalWorkspaceIds, provider } = a.value;
  const source = a.value.source as BillingSource | undefined;
  const keys: string[] = [];
  if (provider !== undefined && !(PAYMENT_PROVIDERS as readonly string[]).includes(provider)) keys.push("provider");
  if (source !== undefined && !(BILLING_SOURCES as readonly string[]).includes(source)) keys.push("source");
  if (internalWorkspaceIds !== undefined && (internalWorkspaceIds.length > 500 || internalWorkspaceIds.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id)))) keys.push("internalWorkspaceIds");
  if (keys.length) return bad(keys);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const before = await readPaymentSettings(g);
  // Switching to Blocks Utilities only when its catalogue answers on the service identity.
  if (source === "blocks-utilities" && before.source !== "blocks-utilities") {
    if (!deps.utilities) return fail("unavailable", "billing.provider.unavailable", { utilitiesCode: "utilities_not_configured" });
    try {
      await deps.utilities.service.plans.list({ status: "All" });
    } catch (e) {
      return utilitiesFailure(e, "catalogue");
    }
  }
  const ids = internalWorkspaceIds !== undefined ? [...new Set(internalWorkspaceIds)] : undefined;
  if (ids?.length) {
    const known = await workspaceNames(g, ids);
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) return bad(["internalWorkspaceIds"]);
  }
  const write = async (key: string, value: unknown, description: string) => {
    const existing = before.rows.find((r) => r.Key === key);
    const valueJson = JSON.stringify(value);
    if (existing) await g.update(BILLING_SCHEMA.platformSetting, str(existing.ItemId), { ValueJson: valueJson, UpdatedByUserId: caller.userId });
    else {
      const res = await g.insertOnce<Row>(
        BILLING_SCHEMA.platformSetting,
        { Key: key, Values: [], ValueJson: valueJson, Description: description, ReaderIds: [], CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId },
        `setting:${key}`,
      );
      if (!res.created) await g.update(BILLING_SCHEMA.platformSetting, res.item.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
    }
  };
  await Promise.all([
    enforce !== undefined ? write(SETTING_ENFORCE, enforce, "On: builds, analyses and fix rounds need credit left.") : null,
    ids !== undefined ? write(SETTING_INTERNAL_WORKSPACES, ids, "Organizations the paywall never stops.") : null,
    provider !== undefined ? write(SETTING_PROVIDER, provider, "How plans are paid: coupon (codes) or blocks (the Blocks payment gateway).") : null,
    source !== undefined ? write(SETTING_SOURCE, source, "Where plans, codes and subscriptions live: factory or blocks-utilities.") : null,
  ]);
  if (source !== undefined && source !== before.source) noteBillingWrite();
  const next = {
    source: source ?? before.source,
    enforce: enforce ?? before.enforce,
    internalWorkspaceIds: ids ?? before.internalWorkspaceIds,
    provider: (provider as PaymentProviderId | undefined) ?? before.provider,
  };
  await audit(deps, ctx, caller, {
    targetType: "platform-setting", targetId: "billing.paywall",
    details: { before: { source: before.source, enforce: before.enforce, internalWorkspaceIds: before.internalWorkspaceIds.length, provider: before.provider }, after: { ...next, internalWorkspaceIds: next.internalWorkspaceIds.length } },
  });
  return ok({ ...next, providerStatus: providerOf(next.provider).status() });
}

// ---------------------------------------------------------------- renewal (manual run; the engine worker runs it hourly)

export async function renewalsRun(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<RenewalReport>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const g = deps.gateway;
  const [{ plans }, settings] = await Promise.all([readPlans(g), readPaymentSettings(g)]);
  const report = await renewDue({ gateway: g, nowIso: deps.clock.now(), plans, providerConnected: providerOf(settings.provider).status().connected && settings.provider === "blocks", by: open.caller.userId });
  if (report.renewed.length || report.pastDue.length || report.ended.length) {
    await audit(deps, ctx, open.caller, { targetType: "subscription", targetId: "renewals", details: { renewed: report.renewed.length, pastDue: report.pastDue.length, ended: report.ended.length } });
  }
  return ok(report);
}
