// Subscriptions and payments: the pure rules of checkout, codes (coupons), plan changes, renewal and the paywall,
// shared by the billing functions (functions/billing/ops/checkout.ts, subscriptions.ts), the engine worker's renewal
// task and the screens. Money is integer cents inside, USD numbers in the API (see billing.ts).
//
// Payment providers (PaymentProvider below):
// - "coupon" (default, works now): a code pays the plan for N months, takes a discount off, or adds credit.
// - "blocks" (the Blocks OS payment gateway, Stripe underneath): the same interface, refusing with "not connected"
//   until the host is configured (PlatformSetting billing.provider = "blocks" plus host secrets; never Blocks data or UI).
//
// Plan change rule (documented for the owner and the screens):
// - Upgrade (a higher monthly price) applies now. Paid by card: the price difference for the days left in the period
//   is charged ((new - old price) x days left / days in period) and the credit difference for the same share is added
//   now; the renewal day stays. Paid by a plan code: the code starts a fresh period today with the new plan's full
//   monthly credit (credit already granted stays in the balance).
// - Downgrade (a lower price, or Free) takes effect on the renewal day; nothing is refunded, nothing is taken back.
// - Cancel: the plan runs to the end of the paid period, then the organization is on Free. Resume undoes a cancel
//   (or a scheduled downgrade) before that day.
import { addMonth, centsToUsd, toCents, type PlanView } from "./billing";

export const PAYMENT_PROVIDERS = ["coupon", "blocks"] as const;
/** "blocks-utilities": the subscription and its payments are held by Blocks Utilities (PlatformSetting billing.source). */
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number] | "blocks-utilities";
export const DEFAULT_PROVIDER: PaymentProviderId = "coupon";

/** PlatformSetting keys (ValueJson holds the JSON value). */
export const SETTING_PROVIDER = "billing.provider";
export const SETTING_ENFORCE = "billing.enforce";
export const SETTING_INTERNAL_WORKSPACES = "billing.internalWorkspaceIds";

export const COUPON_KINDS = ["credit", "plan", "discount"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];
export const MAX_COUPON_MONTHS = 36;
export const MAX_PER_PERSON = 1000;

export const PAYMENT_STATUSES = ["open", "paid", "failed", "expired", "cancelled", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** new: a plan bought; upgrade: a change to a higher plan; renewal: a month renewed. */
export const PAYMENT_KINDS = ["new", "upgrade", "renewal"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
/** An open checkout is answered again (same summary, same code) for this long; after it a new one starts. */
export const CHECKOUT_TTL_MS = 24 * 3_600_000;
/** How many missed periods one renewal pass catches up at most. */
export const MAX_RENEWAL_STEPS = 24;

/** The engine work the paywall stops when billing.enforce is on: builds, analyses and fix rounds. */
export const PAYWALLED_JOB_KINDS: readonly string[] = ["build.run", "change.build", "change.analyse", "fix.analyse", "feedback.apply"];

// ---------------------------------------------------------------- coupons

export interface CouponTerms {
  code: string;
  kind: CouponKind;
  /** credit: the credit the code adds. */
  amountCents: number;
  /** plan / discount: the plans it may be used for (empty: every paid plan). */
  planKeys: string[];
  /** plan: months the code pays; discount: months the discount applies. */
  durationMonths: number;
  /** discount: whole percent off (0: none). */
  percentOff: number;
  /** discount: a fixed amount off (0: none). */
  amountOffCents: number;
  /** How many times one person may use it (0: no limit). */
  perPersonLimit: number;
  /** A coupon saved before Kind existed: credit plus an optional plan, redeemed as before. */
  legacy: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  if (typeof v === "string" && v.trim()) {
    try {
      return listOf(JSON.parse(v));
    } catch {
      return v.split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
}

/** A Coupon row's terms. Rows without Kind keep their old meaning (credit, and the plan they name). */
export function couponTermsOf(row: Record<string, unknown>): CouponTerms {
  const kind = str(row.Kind);
  const legacy = !(COUPON_KINDS as readonly string[]).includes(kind);
  const planKeys = listOf(row.PlanKeys);
  if (legacy && str(row.PlanKey)) planKeys.push(str(row.PlanKey));
  return {
    code: str(row.Code),
    kind: legacy ? (str(row.PlanKey) ? "plan" : "credit") : (kind as CouponKind),
    amountCents: toCents(num(row.AmountUsd)),
    planKeys: [...new Set(planKeys)],
    durationMonths: Math.max(1, Math.min(MAX_COUPON_MONTHS, Math.trunc(num(row.DurationMonths)) || 1)),
    percentOff: Math.max(0, Math.min(100, Math.trunc(num(row.PercentOff)))),
    amountOffCents: Math.max(0, toCents(num(row.AmountOffUsd))),
    perPersonLimit: Math.max(0, Math.trunc(num(row.PerPersonLimit))),
    legacy,
  };
}

export interface CouponTermsInput {
  kind?: unknown;
  amountUsd?: unknown;
  planKeys?: unknown;
  durationMonths?: unknown;
  percentOff?: unknown;
  amountOffUsd?: unknown;
  perPersonLimit?: unknown;
}

const isCents = (x: unknown, o: { allowZero?: boolean } = {}): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1_000_000 && (o.allowZero || x > 0) && Math.abs(toCents(x) - x * 100) < 1e-6;

/** The bad keys of a coupon's terms (empty: valid). Plan keys are checked against the catalogue by the caller. */
export function couponTermsProblems(i: CouponTermsInput): string[] {
  const keys: string[] = [];
  const kind = i.kind;
  if (!(COUPON_KINDS as readonly unknown[]).includes(kind)) return ["kind"];
  const months = i.durationMonths;
  const monthsOk = months === undefined || (Number.isInteger(months) && (months as number) >= 1 && (months as number) <= MAX_COUPON_MONTHS);
  if (!monthsOk) keys.push("durationMonths");
  const per = i.perPersonLimit;
  if (per !== undefined && !(Number.isInteger(per) && (per as number) >= 0 && (per as number) <= MAX_PER_PERSON)) keys.push("perPersonLimit");
  if (i.planKeys !== undefined && !(Array.isArray(i.planKeys) && i.planKeys.length <= 10 && i.planKeys.every((k) => typeof k === "string" && /^[a-z][a-z0-9-]{1,31}$/.test(k)))) keys.push("planKeys");
  const percent = i.percentOff ?? 0;
  const off = i.amountOffUsd ?? 0;
  const amount = i.amountUsd ?? 0;
  if (kind === "credit") {
    if (!isCents(amount)) keys.push("amountUsd");
    if (percent !== 0) keys.push("percentOff");
    if (off !== 0) keys.push("amountOffUsd");
  } else if (kind === "plan") {
    if (!Array.isArray(i.planKeys) || i.planKeys.length === 0) keys.push("planKeys");
    if (amount !== 0) keys.push("amountUsd");
    if (percent !== 0) keys.push("percentOff");
    if (off !== 0) keys.push("amountOffUsd");
  } else {
    if (amount !== 0) keys.push("amountUsd");
    const percentOk = Number.isInteger(percent) && (percent as number) >= 0 && (percent as number) <= 100;
    if (!percentOk) keys.push("percentOff");
    if (!isCents(off, { allowZero: true })) keys.push("amountOffUsd");
    // exactly one of the two
    if (percentOk && isCents(off, { allowZero: true }) && ((percent as number) > 0) === ((off as number) > 0)) keys.push("percentOff", "amountOffUsd");
  }
  return [...new Set(keys)];
}

/** The plain sentence a code's terms read as. */
export function describeCoupon(t: CouponTerms, planName: (key: string) => string = (k) => k): string {
  const plans = t.planKeys.length ? t.planKeys.map(planName).join(" or ") : "any paid plan";
  const months = (n: number) => (n === 1 ? "1 month" : `${n} months`);
  if (t.kind === "credit") return `Adds ${usd(t.amountCents)} credit`;
  if (t.kind === "plan") return `Pays the ${plans} plan for ${months(t.durationMonths)}`;
  const off = t.percentOff ? `${t.percentOff}% off` : `${usd(t.amountOffCents)} off`;
  return `${off} ${plans === "any paid plan" ? "any paid plan" : `the ${plans} plan`} for ${months(t.durationMonths)}`;
}

/** "USD 199.00" from cents. */
export function usd(cents: number): string {
  return `USD ${centsToUsd(cents).toFixed(2)}`;
}

/** iso + n months (the 31st falls back to the month's last day). */
export function addMonths(iso: string, n: number): string {
  let out = iso;
  for (let i = 0; i < n; i++) out = addMonth(out);
  return out;
}

// ---------------------------------------------------------------- checkout

export interface CheckoutBase {
  planKey: string;
  kind: "new" | "upgrade";
  /** The plan's monthly price. */
  priceCents: number;
  /** Due before any code: the monthly price (new) or the prorated difference (upgrade). */
  amountCents: number;
  /** Credit granted on payment: the monthly credit (new) or the prorated credit difference (upgrade). */
  creditCents: number;
  /** The plan's full monthly credit. */
  monthCreditCents: number;
  periodStart: string;
  /** The renewal day this payment runs to. */
  periodEnd: string;
}

export interface CodeQuote {
  code: string;
  kind: CouponKind;
  description: string;
  discountCents: number;
  dueCents: number;
  /** The code pays the plan through this instant (null: the code does not pay the whole amount). */
  paidThrough: string | null;
  /** A plan code restarts the period today with the full monthly credit; otherwise the base period and credit. */
  periodStart: string;
  periodEnd: string;
  creditCents: number;
  /** A discount the code keeps giving on later renewals (card payments), through this instant. */
  discountUntil: string | null;
}

export type CodeRefusal = "plan-not-allowed" | "credit-code" | "not-for-free";

/** What a code does to a checkout, or why it cannot be used there. */
export function quoteCode(base: CheckoutBase, terms: CouponTerms, nowIso: string, planName?: (key: string) => string): { ok: true; quote: CodeQuote } | { ok: false; reason: CodeRefusal } {
  if (terms.kind === "credit") return { ok: false, reason: "credit-code" };
  if (base.priceCents <= 0) return { ok: false, reason: "not-for-free" };
  if (terms.planKeys.length && !terms.planKeys.includes(base.planKey)) return { ok: false, reason: "plan-not-allowed" };
  const description = describeCoupon(terms, planName);
  if (terms.kind === "plan") {
    const periodEnd = addMonth(nowIso);
    return {
      ok: true,
      quote: {
        code: terms.code, kind: "plan", description, discountCents: base.amountCents, dueCents: 0,
        paidThrough: addMonths(nowIso, terms.durationMonths), periodStart: nowIso, periodEnd, creditCents: base.monthCreditCents,
        discountUntil: null,
      },
    };
  }
  const off = terms.percentOff ? Math.round((base.amountCents * terms.percentOff) / 100) : Math.min(terms.amountOffCents, base.amountCents);
  const due = Math.max(0, base.amountCents - off);
  const until = addMonths(base.periodEnd, terms.durationMonths - 1);
  return {
    ok: true,
    quote: {
      code: terms.code, kind: "discount", description, discountCents: base.amountCents - due, dueCents: due,
      paidThrough: due === 0 ? until : null, periodStart: base.periodStart, periodEnd: base.periodEnd, creditCents: base.creditCents,
      discountUntil: due === 0 ? null : until,
    },
  };
}

/** cents x the share of the period still ahead at `now` (0 when the period is over or empty). */
export function prorateCents(cents: number, periodStart: string, periodEnd: string, nowIso: string): number {
  const total = Date.parse(periodEnd) - Date.parse(periodStart);
  const left = Date.parse(periodEnd) - Date.parse(nowIso);
  if (!(total > 0) || !(left > 0) || cents <= 0) return 0;
  return Math.round(cents * Math.min(1, left / total));
}

export type ChangeDirection = "same" | "upgrade" | "downgrade" | "contact-sales";

/** How a change from `from` to `to` is made (prices compared; a contact-sales plan is never bought here). */
export function changeDirection(from: PlanView | null, to: PlanView): ChangeDirection {
  if (to.contactSales || to.priceUsd === null) return "contact-sales";
  if (from && from.key === to.key) return "same";
  const a = from?.priceUsd ?? 0;
  return to.priceUsd > a ? "upgrade" : "downgrade";
}

/** The receipt number of a paid payment: MF-YYYYMMDD-XXXXXX (from the payment id; stable across retries). */
export function receiptNumber(paymentId: string, paidAt: string): string {
  let h = 0x811c9dc5;
  for (const ch of paymentId) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const day = (Number.isFinite(Date.parse(paidAt)) ? new Date(paidAt) : new Date(0)).toISOString().slice(0, 10).replace(/-/g, "");
  return `MF-${day}-${h.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

// ---------------------------------------------------------------- paywall

export type PaywallReason = "no-credit";

export interface PaywallInput {
  enforce: boolean;
  internal: boolean;
  balanceCents: number;
}

/**
 * Whether new engine work may start. Off unless billing.enforce; internal organizations are never stopped. When on,
 * work needs credit left (balance > 0): a paid plan brings its monthly credit, a Free organization its sign-up credit.
 */
export function paywallVerdict(i: PaywallInput): { ok: true } | { ok: false; reason: PaywallReason } {
  if (!i.enforce || i.internal) return { ok: true };
  if (i.balanceCents > 0) return { ok: true };
  return { ok: false, reason: "no-credit" };
}

/** A boolean PlatformSetting (ValueJson true/false or {"value": bool}); the fallback otherwise. */
export function settingBool(valueJson: unknown, fallback: boolean): boolean {
  const v = parseSetting(valueJson);
  return typeof v === "boolean" ? v : fallback;
}

/** A string-list PlatformSetting (ValueJson ["a","b"] or {"value": [...]}). */
export function settingList(valueJson: unknown): string[] {
  const v = parseSetting(valueJson);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

/** The provider PlatformSetting ("coupon" | "blocks"); the default otherwise. */
export function settingProvider(valueJson: unknown): PaymentProviderId {
  const v = parseSetting(valueJson);
  return (PAYMENT_PROVIDERS as readonly unknown[]).includes(v) ? (v as PaymentProviderId) : DEFAULT_PROVIDER;
}

function parseSetting(valueJson: unknown): unknown {
  if (typeof valueJson !== "string" || !valueJson.trim()) return undefined;
  try {
    const v = JSON.parse(valueJson) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) && "value" in v ? (v as { value: unknown }).value : v;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- provider interface

/** What a provider says about itself (never a secret). */
export interface ProviderStatus {
  id: PaymentProviderId;
  /** The provider can take a payment now. */
  connected: boolean;
  /** Card payments can be taken (the coupon provider takes codes only). */
  acceptsCards: boolean;
  /** A plain sentence for the payment step. */
  message: string;
}

export interface ProviderCheckout {
  paymentId: string;
  workspaceId: string;
  planKey: string;
  /** What the provider is asked to collect, after codes. */
  dueCents: number;
  periodStart: string;
  periodEnd: string;
  customerEmail: string;
}

export type ProviderAnswer<T> = { ok: true; value: T } | { ok: false; code: "not_connected" | "payment_required" | "declined" | "unavailable"; message: string };

/** A provider's event (a webhook) as the billing functions understand it. */
export type ProviderEvent =
  | { type: "payment.succeeded"; paymentId: string; providerRef: string; paidCents: number; at: string }
  | { type: "payment.failed"; paymentId: string; providerRef: string; reason: string; at: string }
  | { type: "subscription.renewed"; workspaceId: string; providerRef: string; paidCents: number; periodStart: string; periodEnd: string; at: string }
  | { type: "subscription.cancelled"; workspaceId: string; providerRef: string; at: string };

/**
 * The payment provider seam. Codes (coupons) are this platform's own and are applied before a provider is asked for
 * anything: applyCode answers what a code does to the checkout; the provider only collects what is still due.
 */
export interface PaymentProvider {
  status(): ProviderStatus;
  /** Opens a payment for what is due (a hosted page URL for card providers; null for codes). */
  createCheckout(c: ProviderCheckout): Promise<ProviderAnswer<{ providerRef: string; redirectUrl: string | null }>>;
  /** What a code does to the checkout (the same rules for every provider). */
  applyCode(base: CheckoutBase, terms: CouponTerms, nowIso: string): ReturnType<typeof quoteCode>;
  /** Settles the payment: with nothing due, codes settle it; otherwise the provider must confirm the money arrived. */
  confirm(c: ProviderCheckout & { providerRef: string }): Promise<ProviderAnswer<{ paidCents: number; providerRef: string }>>;
  /** Stops renewing at the end of the period (the provider's own subscription, if any). */
  cancel(o: { workspaceId: string; providerRef: string }): Promise<ProviderAnswer<Record<string, never>>>;
  /** Undoes a cancel before the period ends. */
  resume(o: { workspaceId: string; providerRef: string }): Promise<ProviderAnswer<Record<string, never>>>;
  /** The provider's self-service page (cards, invoices); null when there is none. */
  portalUrl(o: { workspaceId: string; providerRef: string; returnUrl: string }): Promise<ProviderAnswer<{ url: string | null }>>;
  /** Verifies and normalizes a provider event (signature checked by the provider adapter). */
  handleEvent(raw: { body: string; headers: Readonly<Record<string, string>> }): Promise<ProviderAnswer<ProviderEvent>>;
}

export const CARD_NOT_CONNECTED = "Card payments are being connected. Until then a code pays for a plan.";

/** The "coupon" provider: codes only. Nothing due -> settled; anything due -> a plain refusal (never a fake payment). */
export function couponProvider(planName?: (key: string) => string): PaymentProvider {
  const refuse = <T,>(): ProviderAnswer<T> => ({ ok: false, code: "payment_required", message: CARD_NOT_CONNECTED });
  return {
    status: () => ({ id: "coupon", connected: true, acceptsCards: false, message: CARD_NOT_CONNECTED }),
    async createCheckout(c) {
      return { ok: true, value: { providerRef: `coupon:${c.paymentId}`, redirectUrl: null } };
    },
    applyCode: (base, terms, nowIso) => quoteCode(base, terms, nowIso, planName),
    async confirm(c) {
      if (c.dueCents > 0) return refuse();
      return { ok: true, value: { paidCents: 0, providerRef: c.providerRef || `coupon:${c.paymentId}` } };
    },
    async cancel() {
      return { ok: true, value: {} };
    },
    async resume() {
      return { ok: true, value: {} };
    },
    async portalUrl() {
      return { ok: true, value: { url: null } };
    },
    async handleEvent() {
      return { ok: false, code: "not_connected", message: "The code provider sends no events." };
    },
  };
}

/** USD view of cents for the API. */
export const usdOf = (cents: number): number => centsToUsd(cents);

// ---------------------------------------------------------------- API shapes (callFunction("billing", ...))

export interface PaymentView {
  id: string;
  kind: PaymentKind;
  planKey: string;
  planName: string;
  fromPlanKey: string | null;
  provider: PaymentProviderId;
  /** Due before the code, USD. */
  amountUsd: number;
  discountUsd: number;
  /** Collected by the provider, USD (0 when a code paid it all). */
  paidUsd: number;
  creditUsd: number;
  couponCode: string | null;
  status: PaymentStatus;
  receiptNo: string | null;
  periodStart: string;
  periodEnd: string;
  paidThrough: string | null;
  paidAt: string | null;
  note: string;
}

export interface CheckoutView {
  id: string;
  workspaceId: string;
  status: PaymentStatus;
  kind: "new" | "upgrade";
  plan: PlanView;
  fromPlan: { key: string; name: string } | null;
  /** Due before the code, USD. */
  amountUsd: number;
  /** Credit granted on payment, USD. */
  creditUsd: number;
  periodStart: string;
  /** The renewal day this payment runs to. */
  renewsOn: string;
  code: { code: string; kind: CouponKind; description: string } | null;
  discountUsd: number;
  dueUsd: number;
  /** The code pays the plan through this day (null: not paid ahead). */
  paidThrough: string | null;
  provider: ProviderStatus;
  /** Confirm can settle it now (nothing due, or a card provider is connected). */
  canConfirm: boolean;
  /** A plain sentence when it cannot be confirmed yet. */
  blocker: string | null;
  expiresAt: string;
  receipt: PaymentView | null;
  /** The hosted payment page to send the buyer to (Blocks Utilities with a card provider); null otherwise. */
  redirectUrl?: string | null;
}

export interface SubscriptionView {
  planKey: string;
  planName: string;
  priceUsd: number | null;
  status: "active" | "pending" | "cancelled" | "past_due";
  startedAt: string | null;
  currentPeriodStart: string | null;
  renewsAt: string | null;
  paidThrough: string | null;
  cancelAtPeriodEnd: boolean;
  nextPlan: { key: string; name: string } | null;
  provider: PaymentProviderId | null;
  couponCode: string | null;
  statusNote: string;
  pastDueSince: string | null;
}

export interface BillingAccountView {
  subscription: SubscriptionView;
  payments: PaymentView[];
  /** The caller may change the plan (organization owners). */
  canManage: boolean;
  provider: ProviderStatus;
  /** Where the plan is held: this platform, or Blocks Utilities. */
  source?: "factory" | "blocks-utilities";
  /** Blocks Utilities' invoices and credit notes of the organization (newest first); absent when not held there. */
  invoices?: InvoiceView[];
}

export interface InvoiceView {
  id: string;
  number: string;
  /** "Invoice" | "TrialInvoice" | "CreditNote". */
  type: string;
  status: string;
  issuedAt: string;
  planName: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  /** The document's total in its currency (USD for the Factory's prices). */
  total: number;
}

export interface PaywallSettings {
  /** Where plans, codes and subscriptions live (PlatformSetting billing.source). */
  source?: "factory" | "blocks-utilities";
  enforce: boolean;
  internalWorkspaceIds: string[];
  provider: PaymentProviderId;
  providerStatus: ProviderStatus;
}

export interface AccessView {
  allowed: boolean;
  reason: PaywallReason | null;
  enforce: boolean;
  internal: boolean;
  balanceUsd: number;
  planKey: string;
}

export type ChangeAnswer =
  | { action: "checkout"; planKey: string }
  | { action: "scheduled"; planKey: string; effectiveAt: string; subscription: SubscriptionView }
  | { action: "kept"; subscription: SubscriptionView };
