// Checkout, plan changes, cancel and resume, the billing account (with invoices), buying credit and the subscription
// sync when Blocks Utilities holds the subscriptions (PlatformSetting billing.source = "blocks-utilities").
//
// Utilities is the source of truth for the subscription (plan, price, period, renewal, cancel, pending plan change),
// the price and the discount a code gives, the payment (its hosted checkout page and the provider's webhooks), the
// invoices, and bought credit. The Factory keeps, as before, its credit ledger (CreditEntry: the plan's monthly credit,
// sign-up credit, credit codes, adjustments, usage) that the paywall reads, a mirror of the subscription on its
// Subscription row (plan key, period, cancel/next plan, Provider "blocks-utilities", ProviderRef = Utilities'
// subscription id) and a Payment row per checkout for its receipts.
//
// Every call here is about one organization, so it goes out with a token issued for that organization's IAM
// organization (Workspace.IamOrganizationId): Utilities scopes a subscription to the bearer's organization and ignores
// a named one. Without such a token the op answers billing.utilities.organization and nothing is sent.
import { addMonth, billingTotals, centsToUsd, toCents, type PlanView } from "../../../src/domain/billing";
import type { UtilitiesApi, UtilitiesFinancialDocument, UtilitiesSubscription, UtilitiesSubscriptionPreview } from "../../../src/domain/blocksUtilities";
import {
  CHECKOUT_TTL_MS,
  changeDirection,
  prorateCents,
  receiptNumber,
  usd,
  type BillingAccountView,
  type ChangeAnswer,
  type CheckoutView,
  type InvoiceView,
  type ProviderStatus,
  type SubscriptionView,
} from "../../../src/domain/payments";
import {
  MAX_CREDIT_PURCHASE_CENTS,
  MIN_CREDIT_PURCHASE_CENTS,
  USAGE_METER,
  UTILITIES_PROVIDER,
  monthlyUsdPrice,
  subscriptionStatusOf,
  usdOfMinor,
  utilitiesCode,
} from "../../../src/domain/utilitiesBilling";
import { audit, fail, ok, openOp, readArgs, type Caller } from "../../workspace/ops/_shared/core";
import type { Gateway, OpAnswer, OpCtx, OpDeps } from "../../workspace/ops/_shared/ports";
import { paymentView, subscriptionView } from "./checkout";
import { noteBillingWrite } from "./readCache";
import {
  BILLING_SCHEMA,
  CREDIT_FIELDS,
  PAYMENT_FIELDS,
  entryRow,
  num,
  planOf,
  str,
  subscriptionOf,
  workspaceEntries,
  type Row,
} from "./shared";
import { readCatalogue, utilitiesFailure } from "./utilitiesCatalogue";

const bad = (keys: string[]): OpAnswer<never> => fail("invalid_input", "tenancy.invalidArgs", { keys });
const MANAGE = "workspace.manage" as const;
/** How many finished jobs one sync reports to the usage meter at most (each report is idempotent per job). */
export const USAGE_REPORTS_PER_SYNC = 100;

/** A refusal or failure Utilities answered (not a fault of this code). */
const isUtilitiesFailure = (e: unknown): boolean => typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" && "status" in e;

const nameOf = (plans: readonly PlanView[]) => (key: string) => planOf(plans, key)?.name ?? key;
const isLive = (s: UtilitiesSubscription | null): s is UtilitiesSubscription => !!s && ["active", "past_due"].includes(subscriptionStatusOf(s.status));

// ---------------------------------------------------------------- organization access

interface OrgAccess {
  org: UtilitiesApi;
  organizationId: string;
  workspaceName: string;
}

/** The Utilities client for the workspace's IAM organization (a token issued for it), or the answer why not. */
async function orgAccess(deps: OpDeps, workspaceId: string): Promise<{ ok: true; a: OrgAccess } | { ok: false; error: OpAnswer<never> }> {
  if (!deps.utilities) return { ok: false, error: fail("unavailable", "billing.provider.unavailable", { utilitiesCode: "utilities_not_configured" }) };
  const rows = await deps.gateway.listAll<Row>(BILLING_SCHEMA.workspace, { filter: { ItemId: workspaceId }, fields: ["ItemId", "Name", "IamOrganizationId"], maxItems: 1 });
  const organizationId = str(rows[0]?.IamOrganizationId);
  if (!organizationId) return { ok: false, error: fail("conflict", "billing.utilities.organization", { reason: "not_linked" }) };
  const org = await deps.utilities.forOrganization(organizationId);
  if (!org) return { ok: false, error: fail("conflict", "billing.utilities.organization", { reason: "no_token" }) };
  return { ok: true, a: { org, organizationId, workspaceName: str(rows[0]?.Name) } };
}

async function openOwner(ctx: OpCtx, deps: OpDeps, workspaceId: string) {
  if (!workspaceId) return { ok: false as const, error: { code: "invalid_input" as const, messageKey: "tenancy.invalidArgs", params: { keys: ["workspaceId"] } } };
  return openOp(ctx, deps, { scope: "workspace", workspaceId, permission: MANAGE });
}

/** Whether Utilities can take a card now (an enabled payment provider on the tenant). */
async function providerStatus(deps: OpDeps): Promise<ProviderStatus> {
  let cards = false;
  try {
    cards = (await deps.utilities!.service.payments.providers()).some((p) => p.isEnabled);
  } catch {
    cards = false;
  }
  return {
    id: UTILITIES_PROVIDER,
    connected: true,
    acceptsCards: cards,
    message: cards ? "Pay by card on the secure payment page." : "Card payments are being connected. Until then a code pays for a plan.",
  };
}

/** The Utilities plan of a key and its monthly USD price id. */
async function sellable(deps: OpDeps, key: string): Promise<{ ok: true; planCode: string; priceId: string } | { ok: false; error: OpAnswer<never> }> {
  const all = await deps.utilities!.service.plans.list({ status: "Active" });
  const plan = all.find((p) => p.code === key && !p.organizationId);
  const price = plan ? monthlyUsdPrice(plan) : null;
  if (!plan || !price) return { ok: false, error: fail("not_found", "billing.planUnknown") };
  return { ok: true, planCode: plan.code, priceId: price.priceId };
}

// ---------------------------------------------------------------- the mirror

/** The Factory's Subscription row brought to what Utilities holds (or Free when it holds nothing live). */
async function mirror(deps: OpDeps, workspaceId: string, s: UtilitiesSubscription | null, by: string, extra: Row = {}): Promise<Row> {
  const g = deps.gateway;
  const existing = await subscriptionOf(g, workspaceId);
  const live = isLive(s);
  const set: Row = live
    ? {
      PlanKey: s.planCode,
      Status: subscriptionStatusOf(s.status),
      CurrentPeriodStart: s.currentPeriodStartUtc,
      RenewsAt: s.cancelAtPeriodEnd ? s.currentPeriodEndUtc : s.nextPaymentAtUtc || s.currentPeriodEndUtc,
      CancelAtPeriodEnd: s.cancelAtPeriodEnd === true,
      NextPlanKey: s.pendingPlanChange?.targetPlanCode ?? "",
      Provider: UTILITIES_PROVIDER,
      ProviderRef: s.subscriptionId,
      PastDueSince: subscriptionStatusOf(s.status) === "past_due" ? str(existing?.PastDueSince) || s.currentPeriodStartUtc : "",
      StatusNote: "",
      UpdatedByUserId: by,
      ...extra,
    }
    : {
      PlanKey: "free", Status: "active", RenewsAt: "", CurrentPeriodStart: deps.clock.now(), CancelAtPeriodEnd: false, NextPlanKey: "", PaidThroughAt: "",
      Provider: "", ProviderRef: "", CouponCode: "", PastDueSince: "", UpdatedByUserId: by, ...extra,
    };
  if (existing && (!live || str(existing.PlanKey) !== s.planCode || str(existing.Status) !== "active")) set.StartedAt = live ? s.currentPeriodStartUtc : deps.clock.now();
  if (existing) await g.update(BILLING_SCHEMA.subscription, str(existing.ItemId), set);
  else {
    const res = await g.insertOnce<Row>(BILLING_SCHEMA.subscription, { WorkspaceId: workspaceId, StartedAt: deps.clock.now(), ...set, CreatedByUserId: by }, `subscription:${workspaceId}`);
    if (!res.created) await g.update(BILLING_SCHEMA.subscription, res.item.ItemId, set);
  }
  noteBillingWrite(workspaceId);
  return { ...(existing ?? { WorkspaceId: workspaceId }), ...set };
}

/** The plan's monthly credit for a paid Utilities period, once per period (RequestKey renewal:<ws>:<period start>). */
async function grantPeriodCredit(deps: OpDeps, workspaceId: string, plan: PlanView | null, s: UtilitiesSubscription, by: string, once?: string): Promise<boolean> {
  const cents = plan ? toCents(plan.creditUsd) : 0;
  if (!plan || cents <= 0 || subscriptionStatusOf(s.status) !== "active") return false;
  const key = once ?? `renewal:${workspaceId}:${s.currentPeriodStartUtc}`;
  const res = await deps.gateway.insertOnce<Row>(
    BILLING_SCHEMA.creditEntry,
    entryRow({ workspaceId, kind: "plan", cents, planKey: plan.key, userId: by, note: `${plan.name} plan credit`, detailJson: JSON.stringify({ utilitiesSubscriptionId: s.subscriptionId, periodStart: s.currentPeriodStartUtc }) }, deps.clock.now(), by),
    key,
  );
  noteBillingWrite(workspaceId);
  return res.created;
}

// ---------------------------------------------------------------- checkout

interface UtilitiesDetail {
  v: 1;
  utilities: { planCode: string; priceId: string; kind: "new" | "upgrade"; subscriptionId: string | null; checkoutUrl: string | null; fromPlanKey: string | null; renewsOn: string };
}

function detailOf(r: Row): UtilitiesDetail | null {
  try {
    const v = JSON.parse(str(r.DetailJson) || "null") as UtilitiesDetail | null;
    return v && v.v === 1 && v.utilities ? v : null;
  } catch {
    return null;
  }
}

function utilitiesCheckoutView(r: Row, plans: readonly PlanView[], provider: ProviderStatus, nowIso: string): CheckoutView {
  const d = detailOf(r)?.utilities;
  const plan = planOf(plans, str(r.PlanKey)) ?? plans[0]!;
  const amount = toCents(num(r.AmountUsd));
  const discount = toCents(num(r.DiscountUsd));
  const due = Math.max(0, amount - discount);
  const expired = str(r.Status) === "open" && str(r.ExpiresAt) !== "" && str(r.ExpiresAt) <= nowIso;
  const status = expired ? "expired" : ((str(r.Status) || "open") as CheckoutView["status"]);
  const from = d?.fromPlanKey ?? "";
  const blocker = status === "open" && due > 0 && !provider.acceptsCards
    ? discount > 0
      ? `The code takes ${usd(discount)} off. The remaining ${usd(due)} needs a card payment, and card payments are being connected. A plan code pays the whole plan.`
      : provider.message
    : null;
  return {
    id: str(r.ItemId),
    workspaceId: str(r.WorkspaceId),
    status,
    kind: d?.kind === "upgrade" ? "upgrade" : "new",
    plan,
    fromPlan: from ? { key: from, name: nameOf(plans)(from) } : null,
    amountUsd: centsToUsd(amount),
    creditUsd: centsToUsd(toCents(num(r.CreditUsd))),
    periodStart: str(r.PeriodStart),
    renewsOn: d?.renewsOn || str(r.PeriodEnd),
    code: str(r.CouponCode) ? { code: str(r.CouponCode), kind: discount >= amount && amount > 0 ? "plan" : "discount", description: str(r.Note) } : null,
    discountUsd: centsToUsd(discount),
    dueUsd: centsToUsd(due),
    paidThrough: str(r.PaidThroughAt) || null,
    provider,
    canConfirm: status === "open" && (due === 0 || provider.acceptsCards),
    blocker,
    expiresAt: str(r.ExpiresAt),
    receipt: status === "paid" ? paymentView(r, plans) : null,
    redirectUrl: status === "open" ? d?.checkoutUrl ?? null : null,
  };
}

/** The price of what the checkout buys, as Utilities quotes it (a code's verdict included). */
async function quote(o: OrgAccess, req: { planCode: string; priceId: string; code: string; subscriptionId: string | null }):
  Promise<{ ok: true; subtotal: number; discount: number; due: number; periodStart: string; periodEnd: string } | { ok: false; error: OpAnswer<never> }> {
  try {
    if (req.subscriptionId) {
      const p = await o.org.subscriptions.previewPlanChange(req.subscriptionId, { planCode: req.planCode, priceId: req.priceId });
      return { ok: true, subtotal: Math.max(0, num(p.chargeMinor)), discount: 0, due: Math.max(0, num(p.chargeMinor)), periodStart: p.newPeriodStartUtc, periodEnd: p.newPeriodEndUtc };
    }
    const body = { planCode: req.planCode, priceId: req.priceId, organizationId: o.organizationId, ...(req.code ? { discountCode: utilitiesCode(req.code) } : {}) };
    let q: UtilitiesSubscriptionPreview;
    if (req.code) {
      const d = await o.org.discounts.preview(body);
      if (!/^(accepted|applied|valid|ok)$/i.test(d.status)) {
        return { ok: false, error: utilitiesFailure({ code: d.reasonCode || "subscription_discount_not_applicable", status: 409 }) };
      }
      q = d.quote;
    } else q = await o.org.subscriptions.preview(body);
    return {
      ok: true, subtotal: num(q.subtotalMinor), discount: num(q.promotionalDiscountMinor, num(q.discountMinor)), due: num(q.totalDueNowMinor),
      periodStart: q.periodStartUtc, periodEnd: q.periodEndUtc,
    };
  } catch (e) {
    return { ok: false, error: utilitiesFailure(e) };
  }
}

export async function checkoutStart(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ checkout: CheckoutView }>> {
  const a = readArgs(args, { workspaceId: "string", planKey: "string", code: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, planKey } = a.value;
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(planKey)) return bad(["planKey"]);
  const open = await openOwner(ctx, deps, workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  const g = deps.gateway;
  const now = deps.clock.now();
  let plans: PlanView[];
  let current: UtilitiesSubscription | null;
  try {
    [{ plans }, current] = await Promise.all([readCatalogue(deps), o.org.subscriptions.current()]);
  } catch (e) {
    return utilitiesFailure(e);
  }
  const plan = planOf(plans, planKey);
  if (!plan || !plan.active) return fail("not_found", "billing.planUnknown");
  if (plan.contactSales || plan.priceUsd === null) return fail("conflict", "billing.plan.contactSales");
  if (plan.priceUsd <= 0) return fail("conflict", "billing.checkout.freePlan");
  const live = isLive(current) ? current : null;
  const from = live ? planOf(plans, live.planCode) : null;
  let kind: "new" | "upgrade" = "new";
  if (live && from && (from.priceUsd ?? 0) > 0) {
    const dir = changeDirection(from, plan);
    if (dir === "same") return fail("conflict", "billing.checkout.alreadyOnPlan");
    if (dir === "downgrade") return fail("conflict", "billing.checkout.downgradeAtRenewal");
    kind = "upgrade";
  }
  let target: Awaited<ReturnType<typeof sellable>>;
  try {
    target = await sellable(deps, plan.key);
  } catch (e) {
    return utilitiesFailure(e);
  }
  if (!target.ok) return target.error;
  const code = a.value.code ? a.value.code.trim().toUpperCase() : "";
  if (kind === "upgrade" && code) return fail("conflict", "billing.coupon.notForPlan");
  const q = await quote(o, { planCode: target.planCode, priceId: target.priceId, code, subscriptionId: kind === "upgrade" ? live!.subscriptionId : null });
  if (!q.ok) return q.error;
  // The Factory's credit for the purchase: the plan's monthly credit, or for an upgrade the credit difference for the
  // share of the period still ahead.
  const credit = kind === "upgrade" && from
    ? prorateCents(Math.max(0, toCents(plan.creditUsd) - toCents(from.creditUsd)), live!.currentPeriodStartUtc, live!.currentPeriodEndUtc, now)
    : toCents(plan.creditUsd);
  const detail: UtilitiesDetail = {
    v: 1,
    utilities: { planCode: target.planCode, priceId: target.priceId, kind, subscriptionId: kind === "upgrade" ? live!.subscriptionId : null, checkoutUrl: null, fromPlanKey: from?.key ?? null, renewsOn: q.periodEnd || addMonth(now) },
  };
  const res = await g.insertOnce<Row>(
    BILLING_SCHEMA.payment,
    {
      WorkspaceId: workspaceId, UserId: caller.userId, UserEmail: caller.email, Kind: kind, PlanKey: plan.key, FromPlanKey: from?.key ?? "", Provider: UTILITIES_PROVIDER,
      ProviderRef: "", Status: "open", ReceiptNo: "", PaidAt: "", ExpiresAt: new Date(Date.parse(now) + CHECKOUT_TTL_MS).toISOString(),
      Note: code ? `Code ${code}` : "", AmountUsd: centsToUsd(q.subtotal), DiscountUsd: centsToUsd(q.discount), PaidUsd: 0, CreditUsd: centsToUsd(credit), CouponCode: code,
      PeriodStart: q.periodStart || now, PeriodEnd: q.periodEnd || addMonth(now), PaidThroughAt: "", DetailJson: JSON.stringify(detail),
      CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId,
    },
    `checkout:${ctx.requestId}`,
  );
  return ok({ checkout: utilitiesCheckoutView(res.item, plans, await providerStatus(deps), now) });
}

async function openCheckout(ctx: OpCtx, deps: OpDeps, checkoutId: string) {
  if (!checkoutId) return { ok: false as const, error: bad(["checkoutId"]) };
  const rows = await deps.gateway.listAll<Row>(BILLING_SCHEMA.payment, { filter: { ItemId: checkoutId }, fields: PAYMENT_FIELDS, maxItems: 1 });
  const row = rows[0];
  if (!row || !detailOf(row)) return { ok: false as const, error: fail("not_found") };
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
  const row = opened.row;
  const now = deps.clock.now();
  if (str(row.Status) !== "open" || (str(row.ExpiresAt) && str(row.ExpiresAt) <= now)) return fail("conflict", "billing.checkout.closed");
  const d = detailOf(row)!.utilities;
  if (d.kind === "upgrade" && a.value.code.trim()) return fail("conflict", "billing.coupon.notForPlan");
  const access = await orgAccess(deps, str(row.WorkspaceId));
  if (!access.ok) return access.error;
  const code = a.value.code.trim().toUpperCase();
  const q = await quote(access.a, { planCode: d.planCode, priceId: d.priceId, code, subscriptionId: d.subscriptionId });
  if (!q.ok) return q.error;
  const set: Row = { AmountUsd: centsToUsd(q.subtotal), DiscountUsd: centsToUsd(q.discount), CouponCode: code, Note: code ? `Code ${code}` : "", UpdatedByUserId: opened.caller.userId };
  await deps.gateway.update(BILLING_SCHEMA.payment, str(row.ItemId), set);
  const { plans } = await readCatalogue(deps);
  return ok({ checkout: utilitiesCheckoutView({ ...row, ...set }, plans, await providerStatus(deps), now) });
}

/** The checkout is paid (Utilities holds the subscription live): the receipt, the credit and the mirror, once. */
async function settle(deps: OpDeps, ctx: OpCtx, caller: Caller, row: Row, s: UtilitiesSubscription, plans: readonly PlanView[]): Promise<Row> {
  const id = str(row.ItemId);
  const workspaceId = str(row.WorkspaceId);
  const now = deps.clock.now();
  const plan = planOf(plans, str(row.PlanKey));
  const creditCents = Math.max(0, toCents(num(row.CreditUsd)));
  if (creditCents > 0) {
    // A new plan's credit is the period's credit (the key a sync of the same period uses); an upgrade's is its own.
    const key = str(row.Kind) === "upgrade" ? `payment:${id}` : `renewal:${workspaceId}:${s.currentPeriodStartUtc}`;
    await deps.gateway.insertOnce<Row>(
      BILLING_SCHEMA.creditEntry,
      entryRow({
        workspaceId, kind: "plan", cents: creditCents, userId: caller.userId, planKey: str(row.PlanKey), couponCode: str(row.CouponCode),
        note: str(row.Kind) === "upgrade" ? `${plan?.name ?? str(row.PlanKey)} plan: credit for the rest of this month` : `${plan?.name ?? str(row.PlanKey)} plan credit`,
        detailJson: JSON.stringify({ paymentId: id, utilitiesSubscriptionId: s.subscriptionId, periodStart: s.currentPeriodStartUtc }),
      }, now, caller.userId),
      key,
    );
  }
  await mirror(deps, workspaceId, s, caller.userId, { CouponCode: str(row.CouponCode) });
  const paid = Math.max(0, num(s.initialChargeAmountMinor, toCents(num(row.AmountUsd)) - toCents(num(row.DiscountUsd))));
  const set: Row = {
    Status: "paid", PaidAt: now, PaidUsd: usdOfMinor(paid), ProviderRef: s.subscriptionId, Provider: UTILITIES_PROVIDER, ReceiptNo: receiptNumber(id, now),
    PeriodStart: s.currentPeriodStartUtc, PeriodEnd: s.currentPeriodEndUtc, UpdatedByUserId: caller.userId,
  };
  await deps.gateway.update(BILLING_SCHEMA.payment, id, set);
  await audit(deps, ctx, caller, {
    workspaceId, targetType: "payment", targetId: id,
    details: { planKey: str(row.PlanKey), kind: str(row.Kind), amountUsd: num(row.AmountUsd), discountUsd: num(row.DiscountUsd), paidUsd: usdOfMinor(paid), creditUsd: centsToUsd(creditCents), code: str(row.CouponCode) || null, provider: UTILITIES_PROVIDER },
  });
  return { ...row, ...set };
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
  const workspaceId = str(row.WorkspaceId);
  const balance = async () => centsToUsd(billingTotals(await workspaceEntries(g, workspaceId)).balanceCents);
  const [{ plans }, provider] = await Promise.all([readCatalogue(deps), providerStatus(deps)]);
  if (str(row.Status) === "paid") return ok({ checkout: utilitiesCheckoutView(row, plans, provider, now), balanceUsd: await balance() });
  if (str(row.Status) !== "open") return fail("conflict", "billing.checkout.closed");
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  const detail = detailOf(row)!;
  const d = detail.utilities;
  try {
    let s: UtilitiesSubscription | null;
    if (str(row.ProviderRef)) {
      // Back from the payment page (or a second tab): Utilities answers whether the money arrived (its webhook).
      s = await o.org.subscriptions.current();
      if (s && s.subscriptionId !== str(row.ProviderRef)) s = null;
    } else {
      if (str(row.ExpiresAt) && str(row.ExpiresAt) <= now) return fail("conflict", "billing.checkout.closed");
      const due = Math.max(0, toCents(num(row.AmountUsd)) - toCents(num(row.DiscountUsd)));
      if (due > 0 && !provider.acceptsCards) return fail("conflict", "billing.checkout.paymentRequired", { dueUsd: centsToUsd(due), message: provider.message });
      if (d.kind === "upgrade" && d.subscriptionId) s = await o.org.subscriptions.changePlan(d.subscriptionId, { planCode: d.planCode, priceId: d.priceId, organizationId: o.organizationId });
      else {
        const body = {
          planCode: d.planCode, priceId: d.priceId, organizationId: o.organizationId, billingEmail: caller.email, billingName: caller.actorName || caller.email,
          ...(str(row.CouponCode) ? { discountCode: utilitiesCode(str(row.CouponCode)) } : {}),
        };
        try {
          s = await o.org.subscriptions.subscribe(body);
        } catch (e) {
          if ((e as { code?: unknown }).code !== "subscription_billing_profile_incomplete") throw e;
          // The invoice needs the organization's billing details: its name and the owner who buys.
          await o.org.billingProfile.put({ legalName: o.workspaceName || caller.email, billingContactName: caller.actorName || caller.email, billingContactEmail: caller.email, organizationId: o.organizationId });
          s = await o.org.subscriptions.subscribe(body);
        }
      }
      const url = s?.checkoutUrl || s?.pendingCheckout?.checkoutUrl || null;
      const set: Row = { ProviderRef: s?.subscriptionId ?? "", DetailJson: JSON.stringify({ ...detail, utilities: { ...d, subscriptionId: s?.subscriptionId ?? d.subscriptionId, checkoutUrl: url } }), UpdatedByUserId: caller.userId };
      await g.update(BILLING_SCHEMA.payment, str(row.ItemId), set);
      row = { ...row, ...set };
    }
    const live = s && subscriptionStatusOf(s.status) === "active" && s.planCode === d.planCode && !s.pendingCheckout?.checkoutUrl;
    if (!live || !s) {
      // Waiting for the payment page (or the provider's webhook): the same checkout, with where to pay.
      return ok({ checkout: utilitiesCheckoutView(row, plans, provider, now), balanceUsd: await balance() });
    }
    row = await settle(deps, ctx, caller, row, s, plans);
    return ok({ checkout: utilitiesCheckoutView(row, plans, provider, now), balanceUsd: await balance() });
  } catch (e) {
    return utilitiesFailure(e);
  }
}

// ---------------------------------------------------------------- plan changes

export async function subscriptionChange(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<ChangeAnswer>> {
  const a = readArgs(args, { workspaceId: "string", planKey: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const workspaceId = a.value.workspaceId;
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  try {
    const [{ plans }, current] = await Promise.all([readCatalogue(deps), o.org.subscriptions.current()]);
    const target = planOf(plans, a.value.planKey);
    if (!target || !target.active) return fail("not_found", "billing.planUnknown");
    const live = isLive(current) ? current : null;
    const cur = live ? planOf(plans, live.planCode) : null;
    const dir = changeDirection(cur, target);
    if (dir === "contact-sales") return fail("conflict", "billing.plan.contactSales");
    const curPaid = Boolean(cur && (cur.priceUsd ?? 0) > 0);
    if (dir === "upgrade" || (!curPaid && (target.priceUsd ?? 0) > 0)) return ok({ action: "checkout", planKey: target.key });
    if (!live) return ok({ action: "kept", subscription: subscriptionView(await mirror(deps, workspaceId, null, caller.userId), plans) });
    let next: UtilitiesSubscription = live;
    if (dir === "same") {
      if (live.pendingPlanChange) next = await o.org.subscriptions.cancelPendingPlanChange(live.subscriptionId, { organizationId: o.organizationId });
      if (next.cancelAtPeriodEnd) next = await o.org.subscriptions.withdrawCancellation(live.subscriptionId, { organizationId: o.organizationId });
      const row = await mirror(deps, workspaceId, next, caller.userId);
      await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { kept: target.key, source: UTILITIES_PROVIDER } });
      return ok({ action: "kept", subscription: subscriptionView(row, plans) });
    }
    if ((target.priceUsd ?? 0) <= 0) {
      // To Free: the paid plan stops renewing and ends with its period (past due: it ends now).
      const immediately = subscriptionStatusOf(live.status) === "past_due";
      next = await o.org.subscriptions.cancel(live.subscriptionId, { immediately, reason: "Moved to Free", organizationId: o.organizationId });
      const row = await mirror(deps, workspaceId, immediately ? null : next, caller.userId, immediately ? {} : { NextPlanKey: target.key });
      await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { from: live.planCode, to: target.key, source: UTILITIES_PROVIDER } });
      return ok({ action: "scheduled", planKey: target.key, effectiveAt: immediately ? deps.clock.now() : live.currentPeriodEndUtc, subscription: subscriptionView(row, plans) });
    }
    // A lower paid plan: Utilities schedules it for the renewal.
    const sell = await sellable(deps, target.key);
    if (!sell.ok) return sell.error;
    next = await o.org.subscriptions.changePlan(live.subscriptionId, { planCode: sell.planCode, priceId: sell.priceId, organizationId: o.organizationId });
    const row = await mirror(deps, workspaceId, next, caller.userId, next.pendingPlanChange ? {} : { NextPlanKey: target.key });
    await audit(deps, ctx, caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { from: live.planCode, to: target.key, source: UTILITIES_PROVIDER } });
    return ok({ action: "scheduled", planKey: target.key, effectiveAt: next.pendingPlanChange?.effectiveAtUtc ?? live.currentPeriodEndUtc, subscription: subscriptionView(row, plans) });
  } catch (e) {
    return utilitiesFailure(e);
  }
}

export async function subscriptionCancel(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ subscription: SubscriptionView }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const workspaceId = a.value.workspaceId;
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  try {
    const [{ plans }, current] = await Promise.all([readCatalogue(deps), o.org.subscriptions.current()]);
    const cur = isLive(current) ? planOf(plans, current.planCode) : null;
    if (!isLive(current) || !cur || !cur.priceUsd || cur.priceUsd <= 0) return fail("conflict", "billing.subscription.nothingToCancel");
    const immediately = subscriptionStatusOf(current.status) === "past_due";
    const next = await o.org.subscriptions.cancel(current.subscriptionId, { immediately, organizationId: o.organizationId });
    const row = await mirror(deps, workspaceId, immediately ? null : next, open.caller.userId, immediately ? { StatusNote: `The ${cur.name} plan was cancelled. You are on Free.` } : {});
    await audit(deps, ctx, open.caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { cancel: cur.key, at: current.currentPeriodEndUtc, source: UTILITIES_PROVIDER } });
    return ok({ subscription: subscriptionView(row, plans) });
  } catch (e) {
    return utilitiesFailure(e);
  }
}

export async function subscriptionResume(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ subscription: SubscriptionView }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const workspaceId = a.value.workspaceId;
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  try {
    const [{ plans }, current] = await Promise.all([readCatalogue(deps), o.org.subscriptions.current()]);
    if (!isLive(current)) return fail("conflict", "billing.subscription.nothingToResume");
    if (subscriptionStatusOf(current.status) === "past_due") return fail("conflict", "billing.subscription.payToResume", { planKey: current.planCode });
    let next = current;
    if (next.pendingPlanChange) next = await o.org.subscriptions.cancelPendingPlanChange(current.subscriptionId, { organizationId: o.organizationId });
    if (next.cancelAtPeriodEnd) next = await o.org.subscriptions.withdrawCancellation(current.subscriptionId, { organizationId: o.organizationId });
    const row = await mirror(deps, workspaceId, next, open.caller.userId);
    await audit(deps, ctx, open.caller, { workspaceId, targetType: "subscription", targetId: workspaceId, details: { resumed: current.planCode, source: UTILITIES_PROVIDER } });
    return ok({ subscription: subscriptionView(row, plans) });
  } catch (e) {
    return utilitiesFailure(e);
  }
}

// ---------------------------------------------------------------- the account, invoices and the sync

export function invoiceView(d: UtilitiesFinancialDocument): InvoiceView {
  const a = d.amounts ?? {};
  const total = num(a.totalMinor, num(a.netSubtotalMinor) + num(a.taxMinor));
  return {
    id: d.documentId, number: d.documentNumber, type: d.documentType, status: d.status, issuedAt: d.issuedAtUtc, planName: d.planName,
    periodStart: d.periodStartUtc ?? null, periodEnd: d.periodEndUtc ?? null, currency: d.currencyCode, total: usdOfMinor(total),
  };
}

const HISTORY = ["paid", "failed", "refunded"];

/** billing.payments.list with Utilities: the live subscription and its invoices when the caller's token may ask,
 *  else the mirror; the Factory's receipts as before. Every member reads. */
export async function paymentsList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<BillingAccountView>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const workspaceId = a.value.workspaceId;
  if (!workspaceId) return bad(["workspaceId"]);
  const open = await openOp(ctx, deps, { scope: "workspace", workspaceId, permission: null });
  if (!open.ok) return { ok: false, error: open.error };
  const g = deps.gateway;
  const [catalogue, mirrored, rows, provider, access] = await Promise.all([
    readCatalogue(deps).catch(() => null),
    subscriptionOf(g, workspaceId),
    g.listAll<Row>(BILLING_SCHEMA.payment, { filter: { WorkspaceId: workspaceId, Status: { in: HISTORY } }, fields: PAYMENT_FIELDS, maxItems: 500 }),
    providerStatus(deps),
    orgAccess(deps, workspaceId),
  ]);
  if (!catalogue) return fail("unavailable", "billing.provider.unavailable");
  const plans = catalogue.plans;
  let sub = mirrored;
  let invoices: InvoiceView[] | undefined;
  if (access.ok) {
    const [current, docs] = await Promise.all([access.a.org.subscriptions.current().catch(() => undefined), access.a.org.invoices.list({ pageSize: 25 }).catch(() => null)]);
    if (current !== undefined) {
      const live = isLive(current) ? current : null;
      sub = live
        ? { ...(mirrored ?? {}), PlanKey: live.planCode, Status: subscriptionStatusOf(live.status), CurrentPeriodStart: live.currentPeriodStartUtc, RenewsAt: live.cancelAtPeriodEnd ? live.currentPeriodEndUtc : live.nextPaymentAtUtc || live.currentPeriodEndUtc, CancelAtPeriodEnd: live.cancelAtPeriodEnd, NextPlanKey: live.pendingPlanChange?.targetPlanCode ?? "", Provider: UTILITIES_PROVIDER, ProviderRef: live.subscriptionId }
        : mirrored && str(mirrored.Provider) === UTILITIES_PROVIDER ? null : mirrored;
    }
    if (docs) invoices = docs.items.map(invoiceView);
  }
  const payments = rows.map((r) => paymentView(r, plans)).sort((x, y) => (y.paidAt ?? y.periodStart).localeCompare(x.paidAt ?? x.periodStart));
  return ok({
    subscription: subscriptionView(sub, plans),
    payments,
    canManage: open.caller.access?.permissions.includes(MANAGE) === true,
    provider,
    source: "blocks-utilities",
    ...(invoices ? { invoices } : {}),
  });
}

export interface SyncReport {
  subscription: SubscriptionView;
  /** The plan credit of a new period was granted. */
  creditGranted: boolean;
  /** Bought credit Utilities granted that the ledger now holds. */
  purchasesMirrored: number;
  /** Finished jobs whose usage was reported to the usage meter (each once). */
  usageReported: number;
  /** Checkouts paid on the payment page that were settled here. */
  checkoutsSettled: number;
}

/**
 * billing.subscription.sync (any member, the caller's token): brings the mirror to Utilities' subscription, grants the
 * plan's monthly credit once for a new paid period, mirrors credit bought in Utilities into the ledger, and reports the
 * usage of finished jobs of the current period to the "ai-usage" meter (once per job: idempotency key job:<id>).
 */
export async function subscriptionSync(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<SyncReport>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const workspaceId = a.value.workspaceId;
  if (!workspaceId) return bad(["workspaceId"]);
  const open = await openOp(ctx, deps, { scope: "workspace", workspaceId, permission: null });
  if (!open.ok) return { ok: false, error: open.error };
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  const by = open.caller.userId;
  try {
    const [{ plans }, current] = await Promise.all([readCatalogue(deps), o.org.subscriptions.current()]);
    const live = isLive(current) ? current : null;
    // A checkout paid on the payment page (the buyer came back here, not to the checkout): its receipt and credit.
    let settled = 0;
    if (live && subscriptionStatusOf(live.status) === "active" && !live.pendingCheckout?.checkoutUrl) {
      const waiting = await deps.gateway.listAll<Row>(BILLING_SCHEMA.payment, { filter: { WorkspaceId: workspaceId, Status: "open", ProviderRef: live.subscriptionId }, fields: PAYMENT_FIELDS, maxItems: 5 });
      for (const w of waiting.filter((x) => str(x.PlanKey) === live.planCode && detailOf(x))) {
        await settle(deps, ctx, open.caller, w, live, plans);
        settled++;
      }
    }
    const row = settled ? (await subscriptionOf(deps.gateway, workspaceId)) ?? {} : await mirror(deps, workspaceId, live, by);
    const plan = live ? planOf(plans, live.planCode) : null;
    const creditGranted = live && plan && (plan.priceUsd ?? 0) > 0 ? await grantPeriodCredit(deps, workspaceId, plan, live, by) : false;
    let purchasesMirrored = 0;
    let usageReported = 0;
    if (live) {
      // Each part on its own: a member whose role may read the subscription but not its credits or usage still syncs
      // the plan and the period's credit (what was left is done by the next sync of someone who may).
      try {
        const grants = await o.org.credits.list(live.subscriptionId, { meterKey: USAGE_METER, organizationId: o.organizationId });
        for (const gr of grants.filter((x) => /^purchased$/i.test(x.source) && num(x.quantity) > 0)) {
          const res = await deps.gateway.insertOnce<Row>(
            BILLING_SCHEMA.creditEntry,
            entryRow({ workspaceId, kind: "purchase", cents: Math.round(num(gr.quantity)), userId: by, note: "Credit bought", detailJson: JSON.stringify({ utilitiesGrantId: gr.grantId }) }, deps.clock.now(), by),
            `utilities-grant:${gr.grantId}`,
          );
          if (res.created) purchasesMirrored++;
        }
      } catch (e) {
        if (!isUtilitiesFailure(e)) throw e;
      }
      try {
        usageReported = await reportUsage(deps, o, workspaceId, live);
      } catch (e) {
        if (!isUtilitiesFailure(e)) throw e;
      }
    }
    if (creditGranted || purchasesMirrored) noteBillingWrite(workspaceId);
    return ok({ subscription: subscriptionView(row, plans), creditGranted, purchasesMirrored, usageReported, checkoutsSettled: settled });
  } catch (e) {
    return utilitiesFailure(e);
  }
}

/** The usage (charged cents) of the jobs of this period whose usage is final, reported once per job. */
async function reportUsage(deps: OpDeps, o: OrgAccess, workspaceId: string, s: UtilitiesSubscription): Promise<number> {
  const g: Pick<Gateway, "listAll"> = deps.gateway;
  const entries = await g.listAll<Row>(BILLING_SCHEMA.creditEntry, { filter: { WorkspaceId: workspaceId, Kind: "usage", At: { gte: s.currentPeriodStartUtc } }, fields: CREDIT_FIELDS, maxItems: 1000 });
  const jobIds = [...new Set(entries.map((e) => str(e.JobId)).filter(Boolean))];
  if (!jobIds.length) return 0;
  const jobs = await g.listAll<Row>(BILLING_SCHEMA.engineJob, { filter: { ItemId: { in: jobIds } }, fields: ["ItemId", "Status"], maxItems: jobIds.length });
  const done = new Set(jobs.filter((j) => ["succeeded", "failed", "cancelled"].includes(str(j.Status))).map((j) => str(j.ItemId)));
  let reported = 0;
  for (const e of entries.filter((x) => done.has(str(x.JobId))).slice(0, USAGE_REPORTS_PER_SYNC)) {
    const cents = Math.max(0, -Math.round(typeof e.AmountCents === "number" ? e.AmountCents : toCents(num(e.AmountUsd))));
    if (cents <= 0) continue;
    const res = await o.org.usage.record({
      meterKey: USAGE_METER, quantity: cents, idempotencyKey: `job:${str(e.JobId)}`, occurredAtUtc: str(e.At) || undefined, organizationId: o.organizationId,
      metadata: { jobId: str(e.JobId), projectId: str(e.ProjectId), tokens: String(num(e.Tokens)) },
    });
    if (!res.replayed) reported++;
  }
  return reported;
}

/**
 * billing.credits.buy (organization owners): buys USD credit on the subscription's usage meter in Utilities (its
 * hosted payment page, or the card on file). The ledger takes it when Utilities has granted it (here, or the next sync).
 */
export async function creditsBuy(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ status: string; redirectUrl: string | null; creditedUsd: number }>> {
  const a = readArgs(args, { workspaceId: "string", amountUsd: "number?" });
  if (!a.ok) return { ok: false, error: a.error };
  const amount = a.value.amountUsd;
  if (amount === undefined) return bad(["amountUsd"]);
  const cents = toCents(amount);
  if (!(cents >= MIN_CREDIT_PURCHASE_CENTS && cents <= MAX_CREDIT_PURCHASE_CENTS) || Math.abs(cents - amount * 100) > 1e-6) return bad(["amountUsd"]);
  const open = await openOwner(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const workspaceId = a.value.workspaceId;
  const access = await orgAccess(deps, workspaceId);
  if (!access.ok) return access.error;
  const o = access.a;
  try {
    const current = await o.org.subscriptions.current();
    if (!isLive(current)) return fail("conflict", "billing.utilities.noSubscription");
    const p = await o.org.credits.purchase(current.subscriptionId, { meterKey: USAGE_METER, quantity: cents, idempotencyKey: `buy:${ctx.requestId}`, organizationId: o.organizationId });
    let credited = 0;
    if (p.grant && num(p.grant.quantity) > 0) {
      const res = await deps.gateway.insertOnce<Row>(
        BILLING_SCHEMA.creditEntry,
        entryRow({ workspaceId, kind: "purchase", cents: Math.round(num(p.grant.quantity)), userId: open.caller.userId, note: "Credit bought", detailJson: JSON.stringify({ utilitiesGrantId: p.grant.grantId }) }, deps.clock.now(), open.caller.userId),
        `utilities-grant:${p.grant.grantId}`,
      );
      if (res.created) credited = centsToUsd(Math.round(num(p.grant.quantity)));
      noteBillingWrite(workspaceId);
    }
    await audit(deps, ctx, open.caller, { workspaceId, targetType: "credit", targetId: workspaceId, details: { buyUsd: centsToUsd(cents), status: p.status, source: UTILITIES_PROVIDER } });
    return ok({ status: p.status, redirectUrl: p.checkoutUrl ?? null, creditedUsd: credited });
  } catch (e) {
    return utilitiesFailure(e);
  }
}
