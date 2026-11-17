// Plans, credit and usage: the pure rules shared by the billing functions (functions/billing), the engine's usage
// capture (server/local/engine/usage.ts), the backfill script and the screens. Money is integer cents inside; the API
// speaks USD numbers with at most two decimals. A balance is only ever summed on the server (billingTotals).

export const PLAN_KEYS = ["free", "classic", "speed", "enterprise"] as const;
export type DefaultPlanKey = (typeof PLAN_KEYS)[number];
export const ASSISTED = ["none", "tech-lead", "business", "dedicated"] as const;
export type Assisted = (typeof ASSISTED)[number];
export const CREDIT_KINDS = ["signup", "plan", "coupon", "purchase", "usage", "adjustment"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];
/** past_due: a paid plan whose next period is not paid (no code covers it); its monthly credit stops. */
export const SUBSCRIPTION_STATUSES = ["active", "pending", "cancelled", "past_due"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const PURCHASE_STATUSES = ["pending", "approved", "declined"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const USAGE_GROUPS = ["workspace", "project", "user", "model", "day"] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];

/** Platform permissions of the billing screens and ops (the same strings the platform roles hold). */
export const BILLING_MANAGE = "platform.billing.manage";
export const USAGE_VIEW = "platform.usage.view";

/** PlatformSetting keys (ValueJson holds the number). */
export const SETTING_PRICE_FACTOR = "billing.priceFactor";
export const SETTING_SIGNUP_CREDIT = "billing.signupCreditUsd";
export const DEFAULT_PRICE_FACTOR = 1;
export const DEFAULT_SIGNUP_CREDIT_USD = 50;
export const MAX_PRICE_FACTOR = 100;
export const MAX_AMOUNT_USD = 1_000_000;
export const MAX_FEATURES = 20;
export const MAX_FEATURE_LENGTH = 160;
export const MAX_NOTE_LENGTH = 500;

export interface PlanView {
  key: string;
  name: string;
  /** null: contact sales (no list price). */
  priceUsd: number | null;
  /** Credit granted when the plan starts (per month for paid plans; the sign-up credit for Free). */
  creditUsd: number;
  assisted: Assisted;
  /** null: custom (agreed with sales). */
  maxParallelStreams: number | null;
  /** Queue weight: higher goes first. */
  priority: number;
  features: string[];
  contactSales: boolean;
  active: boolean;
  sortOrder: number;
}

export const DEFAULT_PLANS: readonly PlanView[] = [
  {
    key: "free", name: "Free", priceUsd: 0, creditUsd: DEFAULT_SIGNUP_CREDIT_USD, assisted: "none", maxParallelStreams: 1,
    priority: 1, contactSales: false, active: true, sortOrder: 1,
    features: ["50 USD credit when you sign up", "One change built at a time", "Self-serve"],
  },
  {
    key: "classic", name: "Classic", priceUsd: 199, creditUsd: 200, assisted: "tech-lead", maxParallelStreams: 2,
    priority: 2, contactSales: false, active: true, sortOrder: 2,
    features: ["200 USD credit every month", "A tech-lead consultant assists you", "Two changes built side by side"],
  },
  {
    key: "speed", name: "Speed", priceUsd: 399, creditUsd: 400, assisted: "business", maxParallelStreams: 5,
    priority: 3, contactSales: false, active: true, sortOrder: 3,
    features: ["400 USD credit every month", "A business consultant assists you", "Five changes built side by side", "Your work goes first in the queue"],
  },
  {
    key: "enterprise", name: "Enterprise", priceUsd: null, creditUsd: 0, assisted: "dedicated", maxParallelStreams: null,
    priority: 4, contactSales: true, active: true, sortOrder: 4,
    features: ["Credit agreed with you", "A dedicated team", "Parallel builds to your needs"],
  },
];

// ---------------------------------------------------------------- money

/** USD -> integer cents, half away from zero; the float noise of a decimal USD value is removed first. */
export function toCents(usd: number): number {
  if (!Number.isFinite(usd)) return 0;
  const scaled = Number((Math.abs(usd) * 100).toFixed(6));
  return Math.sign(usd) * Math.round(scaled);
}

/** Integer cents -> USD with two decimals. */
export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

/** A USD amount as the API accepts it: finite, at most two decimals, within ±MAX_AMOUNT_USD. */
export function isUsdAmount(x: unknown, o: { allowZero?: boolean; allowNegative?: boolean } = {}): x is number {
  if (typeof x !== "number" || !Number.isFinite(x)) return false;
  if (Math.abs(x) > MAX_AMOUNT_USD) return false;
  if (!o.allowNegative && x < 0) return false;
  if (!o.allowZero && x === 0) return false;
  return Math.abs(toCents(x) - x * 100) < 1e-6;
}

/** What a job's measured cost is charged: cost x price factor, in cents (rounded once, per job). */
export function usageChargeCents(costUsd: number, priceFactor: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  const factor = Number.isFinite(priceFactor) && priceFactor > 0 ? priceFactor : DEFAULT_PRICE_FACTOR;
  return Math.round(Number((costUsd * factor * 100).toFixed(6)));
}

/** A setting's number (PlatformSetting.ValueJson), or the fallback when it is missing or not a valid number. */
export function settingNumber(valueJson: unknown, fallback: number, o: { min?: number; max?: number } = {}): number {
  if (typeof valueJson !== "string" || !valueJson.trim()) return fallback;
  let v: unknown;
  try {
    v = JSON.parse(valueJson);
  } catch {
    return fallback;
  }
  if (typeof v === "object" && v !== null && "value" in v) v = (v as { value: unknown }).value;
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  if (o.min !== undefined && v < o.min) return fallback;
  if (o.max !== undefined && v > o.max) return fallback;
  return v;
}

export interface CreditLike {
  Kind?: unknown;
  AmountCents?: unknown;
  AmountUsd?: unknown;
  Tokens?: unknown;
}

/** An entry's amount in cents: AmountCents when stored, else AmountUsd. */
export function entryCents(e: CreditLike): number {
  if (typeof e.AmountCents === "number" && Number.isFinite(e.AmountCents)) return Math.round(e.AmountCents);
  return typeof e.AmountUsd === "number" ? toCents(e.AmountUsd) : 0;
}

export interface BillingTotals {
  balanceCents: number;
  /** Every grant and adjustment (net). */
  grantedCents: number;
  /** What usage took (positive). */
  consumedCents: number;
  tokens: number;
}

/** The only place a balance is summed: balance = granted - consumed, all in integer cents. */
export function billingTotals(entries: readonly CreditLike[]): BillingTotals {
  let granted = 0;
  let consumed = 0;
  let tokens = 0;
  for (const e of entries) {
    const cents = entryCents(e);
    if (e.Kind === "usage") {
      consumed -= cents;
      tokens += typeof e.Tokens === "number" && Number.isFinite(e.Tokens) ? e.Tokens : 0;
    } else granted += cents;
  }
  return { balanceCents: granted - consumed, grantedCents: granted, consumedCents: consumed, tokens };
}

// ---------------------------------------------------------------- coupons

export const COUPON_CODE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** A readable random code (no 0/O/1/I), e.g. "MF-7KQ3-XW9P". */
export function newCouponCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
  return `MF-${part()}-${part()}`;
}

export interface CouponLike {
  Active?: unknown;
  ExpiresAt?: unknown;
  MaxRedemptions?: unknown;
  Redemptions?: unknown;
}

export type CouponRefusal = "inactive" | "expired" | "used-up";

/** Why a coupon cannot be redeemed now (null: it can). MaxRedemptions 0 means no limit. */
export function couponRefusal(c: CouponLike, nowIso: string, redeemedSoFar?: number): CouponRefusal | null {
  if (c.Active !== true) return "inactive";
  if (typeof c.ExpiresAt === "string" && c.ExpiresAt && Date.parse(c.ExpiresAt) <= Date.parse(nowIso)) return "expired";
  const max = typeof c.MaxRedemptions === "number" ? c.MaxRedemptions : 0;
  const used = redeemedSoFar ?? (typeof c.Redemptions === "number" ? c.Redemptions : 0);
  if (max > 0 && used >= max) return "used-up";
  return null;
}

// ---------------------------------------------------------------- usage

export interface UsageTokens {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** EngineJob.UsageJson: what the job's lanes measured. */
export interface JobUsage {
  v: 1;
  tokens: UsageTokens;
  costUsd: number;
  models: string[];
  /** Agent calls, when the lane's report lists them (0: not known). */
  agents: number;
  /** Lane runs that reported usage. */
  lanes: number;
}

export const EMPTY_USAGE: JobUsage = Object.freeze({
  v: 1, tokens: Object.freeze({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 }), costUsd: 0, models: [], agents: 0, lanes: 0,
}) as JobUsage;

const NUM = String.raw`([\d,]+)`;
/**
 * A lane's summary line (MADP/orchestrator/primitives/quick_ops.py usage_line):
 * "tokens: 5325798 (in 152 / out 70351 / cache-read 4814281 / cache-write 441014), cost $3.6831, models a+b".
 */
const USAGE_LINE = new RegExp(
  String.raw`tokens:\s*${NUM}\s*\(\s*in\s+${NUM}\s*/\s*out\s+${NUM}\s*/\s*cache-read\s+${NUM}\s*/\s*cache-write\s+${NUM}\s*\)\s*,\s*cost\s*\$\s*(\d+(?:\.\d+)?)\s*,\s*models?\s+([^\s|*` + "`" + String.raw`]+)`,
  "g",
);
/** The feature lane's benchmark total row: "| **all** | 7 call(s) | ...". */
const AGENT_CALLS = /\|\s*\*\*all\*\*\s*\|\s*(\d+)\s+call\(s\)/g;

const int = (s: string): number => Number(s.replace(/,/g, ""));

/** Every usage line in a lane's output or report, in order. */
export function parseUsageLines(text: string): JobUsage[] {
  const out: JobUsage[] = [];
  for (const m of text.matchAll(USAGE_LINE)) {
    const models = m[7]!.split("+").map((x) => x.trim()).filter((x) => x && x !== "-");
    out.push({
      v: 1,
      tokens: { total: int(m[1]!), in: int(m[2]!), out: int(m[3]!), cacheRead: int(m[4]!), cacheWrite: int(m[5]!) },
      costUsd: Number(m[6]),
      models,
      agents: 0,
      lanes: 1,
    });
  }
  return out;
}

/** The usage of one lane run's text: its usage lines summed (a lane prints one), with the agent calls its report lists. */
export function parseLaneUsage(text: string): JobUsage | null {
  const lines = parseUsageLines(text);
  if (!lines.length) return null;
  const sum = lines.reduce(addUsage, EMPTY_USAGE);
  let agents = 0;
  for (const m of text.matchAll(AGENT_CALLS)) agents += Number(m[1]);
  return { ...sum, agents: agents || sum.agents, lanes: 1 };
}

/** a + b: tokens and cost summed (cost kept to 6 decimals), models merged in order. */
export function addUsage(a: JobUsage, b: JobUsage): JobUsage {
  const models = [...a.models];
  for (const m of b.models) if (!models.includes(m)) models.push(m);
  return {
    v: 1,
    tokens: {
      in: a.tokens.in + b.tokens.in,
      out: a.tokens.out + b.tokens.out,
      cacheRead: a.tokens.cacheRead + b.tokens.cacheRead,
      cacheWrite: a.tokens.cacheWrite + b.tokens.cacheWrite,
      total: a.tokens.total + b.tokens.total,
    },
    costUsd: Number((a.costUsd + b.costUsd).toFixed(6)),
    models,
    agents: a.agents + b.agents,
    lanes: a.lanes + b.lanes,
  };
}

const nonNeg = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** EngineJob.UsageJson -> JobUsage (null when absent or not usage). */
export function parseJobUsage(raw: unknown): JobUsage | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const t = (typeof o.tokens === "object" && o.tokens !== null ? o.tokens : {}) as Record<string, unknown>;
  return {
    v: 1,
    tokens: { in: nonNeg(t.in), out: nonNeg(t.out), cacheRead: nonNeg(t.cacheRead), cacheWrite: nonNeg(t.cacheWrite), total: nonNeg(t.total) },
    costUsd: nonNeg(o.costUsd),
    models: Array.isArray(o.models) ? o.models.filter((m): m is string => typeof m === "string").slice(0, 20) : [],
    agents: nonNeg(o.agents),
    lanes: nonNeg(o.lanes),
  };
}

/** The label a usage report groups models under: "claude-opus-4+claude-sonnet-4" or "Not recorded". */
export function modelLabel(models: readonly string[]): string {
  return models.length ? models.join(" + ") : "Not recorded";
}

// ---------------------------------------------------------------- API shapes (callFunction("billing", ...))

export interface BillingSummary {
  /** null: the catalogue does not list the organization's plan. */
  plan: { key: string; name: string; assisted: Assisted; maxParallelStreams: number | null } | null;
  subscription: { status: SubscriptionStatus; startedAt: string; renewsAt: string; cancelAtPeriodEnd?: boolean } | null;
  balanceUsd: number;
  grantedUsd: number;
  consumedUsd: number;
  tokens: number;
  /** Used since the first day of this month (UTC). */
  monthUsedUsd: number;
  monthTokens: number;
  perProject: { projectId: string; name: string; costUsd: number; tokens: number }[];
  activeAgents: number;
  runningJobs: number;
  pendingRequests: PurchaseView[];
}

export interface CouponView {
  id: string;
  /** credit | plan | discount (src/domain/payments.ts). */
  kind: "credit" | "plan" | "discount";
  /** Saved before kinds: credit plus the optional plan. */
  legacy: boolean;
  planKeys: string[];
  durationMonths: number;
  percentOff: number;
  amountOffUsd: number;
  /** How many times one person may use it; 0 = no limit. */
  perPersonLimit: number;
  /** The plain sentence the code reads as. */
  description: string;
  code: string;
  amountUsd: number;
  planKey: string | null;
  maxRedemptions: number;
  redemptions: number;
  expiresAt: string | null;
  active: boolean;
  note: string;
}

export interface PurchaseView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userEmail: string;
  planKey: string | null;
  amountUsd: number | null;
  status: PurchaseStatus;
  note: string;
  createdAt: string;
  decidedBy: string;
  decidedAt: string;
}

export interface BalanceRow {
  workspaceId: string;
  name: string;
  planKey: string;
  planName: string;
  balanceUsd: number;
  grantedUsd: number;
  consumedUsd: number;
  tokens: number;
}

export interface CreditEntryView {
  id: string;
  workspaceId: string;
  kind: CreditKind;
  amountUsd: number;
  tokens: number;
  note: string;
  at: string;
  userId: string;
  projectId: string;
  jobId: string;
}

export interface UsageRow {
  key: string;
  label: string;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** What the organizations were charged (measured cost x billing.priceFactor), USD. */
  costUsd: number;
  /** The same as costUsd (kept for readers that name it so). */
  chargedUsd: number;
  /** The engine's measured cost before the price factor, USD (4 decimals). */
  rawCostUsd: number;
  jobs: number;
}

export interface UsageReport {
  from: string;
  to: string;
  groupBy: UsageGroup;
  rows: UsageRow[];
  totals: Omit<UsageRow, "key" | "label">;
  /** Engine jobs running on the platform as the report was made (the page reads faster while any runs). */
  runningJobs?: number;
}

/** billing.jobs.usage → jobs[]: one job's usage entry as charged (never the measured cost). */
export interface JobUsageEntry {
  jobId: string;
  costUsd: number;
  tokens: number;
  at: string;
}

export interface BillingSettings {
  priceFactor: number;
  signupCreditUsd: number;
  /** Where plans, codes and subscriptions live (PlatformSetting billing.source): this platform or Blocks Utilities. */
  source?: "factory" | "blocks-utilities";
}

/** The first instant of the UTC month of `iso`. */
export function monthStart(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** One month after `iso` (UTC; the 31st falls back to the month's last day). */
export function addMonth(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).toISOString();
}
