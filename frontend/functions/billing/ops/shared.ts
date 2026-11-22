// Shared reads, writes and checks of the billing ops. Plain functions only (warm sandboxes are shared across callers).
import {
  BILLING_MANAGE,
  DEFAULT_PRICE_FACTOR,
  DEFAULT_SIGNUP_CREDIT_USD,
  MAX_PRICE_FACTOR,
  SETTING_PRICE_FACTOR,
  SETTING_SIGNUP_CREDIT,
  ASSISTED,
  billingTotals,
  centsToUsd,
  entryCents,
  settingNumber,
  toCents,
  type Assisted,
  type BillingSettings,
  type CouponView,
  type CreditEntryView,
  type CreditKind,
  type PlanView,
  type PurchaseView,
} from "../../../src/domain/billing";
import { couponTermsOf, describeCoupon } from "../../../src/domain/payments";
import { SETTING_SOURCE, settingSource } from "../../../src/domain/utilitiesBilling";
import { openOp, type Caller } from "../../workspace/ops/_shared/core";
import type { Gateway, OpCtx, OpDeps, OpError } from "../../workspace/ops/_shared/ports";
import { noteBillingWrite } from "./readCache";

export const BILLING_SCHEMA = {
  plan: "Plan",
  subscription: "Subscription",
  creditEntry: "CreditEntry",
  coupon: "Coupon",
  purchaseRequest: "PurchaseRequest",
  payment: "Payment",
  platformSetting: "PlatformSetting",
  workspace: "Workspace",
  project: "Project",
  engineJob: "EngineJob",
  membership: "Membership",
} as const;

export const PLAN_FIELDS = [
  "ItemId", "Key", "Name", "PriceUsd", "CreditUsd", "Assisted", "MaxParallelStreams", "Priority", "FeaturesJson", "ContactSales", "Active", "SortOrder",
] as const;
export const SUBSCRIPTION_FIELDS = [
  "ItemId", "WorkspaceId", "PlanKey", "Status", "StartedAt", "RenewsAt", "CurrentPeriodStart", "PaidThroughAt", "CancelAtPeriodEnd", "NextPlanKey",
  "Provider", "ProviderRef", "CouponCode", "DiscountUntil", "StatusNote", "PastDueSince",
] as const;
export const CREDIT_FIELDS = [
  "ItemId", "WorkspaceId", "UserId", "ProjectId", "JobId", "Kind", "AmountUsd", "AmountCents", "Tokens", "Note", "At", "CouponCode", "PlanKey", "DetailJson",
] as const;
export const COUPON_FIELDS = [
  "ItemId", "Code", "AmountUsd", "PlanKey", "MaxRedemptions", "Redemptions", "ExpiresAt", "Active", "Note",
  "Kind", "PlanKeys", "DurationMonths", "PercentOff", "AmountOffUsd", "PerPersonLimit",
] as const;
export const PAYMENT_FIELDS = [
  "ItemId", "WorkspaceId", "UserId", "UserEmail", "Kind", "PlanKey", "FromPlanKey", "Provider", "ProviderRef", "AmountUsd", "DiscountUsd",
  "PaidUsd", "CreditUsd", "CouponCode", "Status", "ReceiptNo", "PeriodStart", "PeriodEnd", "PaidThroughAt", "PaidAt", "ExpiresAt", "Note",
  "DetailJson", "CreatedDate",
] as const;
export const PURCHASE_FIELDS = [
  "ItemId", "WorkspaceId", "UserId", "UserEmail", "PlanKey", "AmountUsd", "Status", "Note", "DecisionNote", "DecidedBy", "DecidedAt", "CreatedDate",
] as const;

export type Row = Record<string, unknown>;
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Platform permission check: the super admin holds every one; a platform role holds what it lists. */
export function holdsPlatform(caller: Caller, perms: readonly string[]): boolean {
  if (caller.isSuperAdmin) return true;
  const held = caller.platform.permissions as readonly string[];
  return perms.some((p) => held.includes(p));
}

export type Opened = { ok: true; caller: Caller } | { ok: false; error: OpError };

/** Opens a platform op: signed in, and holding one of `perms`. */
export async function openPlatform(ctx: OpCtx, deps: OpDeps, perms: readonly string[] = [BILLING_MANAGE]): Promise<Opened> {
  const open = await openOp(ctx, deps, { scope: "platform" });
  if (!open.ok) return open;
  if (!holdsPlatform(open.caller, perms)) {
    return { ok: false, error: { code: "forbidden", messageKey: "tenancy.notHeld", params: { permissions: [...perms] } } };
  }
  return open;
}

/** Opens an organization op: the caller is a member of the workspace (or a platform manager openOp lets in). */
export async function openMember(ctx: OpCtx, deps: OpDeps, workspaceId: string): Promise<Opened> {
  if (!workspaceId) return { ok: false, error: { code: "invalid_input", messageKey: "tenancy.invalidArgs", params: { keys: ["workspaceId"] } } };
  return openOp(ctx, deps, { scope: "workspace", workspaceId, permission: null });
}

// ---------------------------------------------------------------- settings

export async function readSettings(gateway: Pick<Gateway, "listAll">): Promise<Required<BillingSettings> & { rows: Row[] }> {
  const rows = await gateway.listAll<Row>(BILLING_SCHEMA.platformSetting, {
    filter: { Key: { in: [SETTING_PRICE_FACTOR, SETTING_SIGNUP_CREDIT, SETTING_SOURCE] } },
    fields: ["ItemId", "Key", "ValueJson"],
  });
  const value = (key: string) => rows.find((r) => r.Key === key)?.ValueJson;
  return {
    priceFactor: settingNumber(value(SETTING_PRICE_FACTOR), DEFAULT_PRICE_FACTOR, { min: 0.000001, max: MAX_PRICE_FACTOR }),
    signupCreditUsd: settingNumber(value(SETTING_SIGNUP_CREDIT), DEFAULT_SIGNUP_CREDIT_USD, { min: 0, max: 100_000 }),
    source: settingSource(value(SETTING_SOURCE)),
    rows,
  };
}

// ---------------------------------------------------------------- plans

export function planFromRow(r: Row): PlanView {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(str(r.FeaturesJson) || "[]") as unknown;
    if (Array.isArray(parsed)) features = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    features = [];
  }
  const contactSales = r.ContactSales === true;
  const streams = num(r.MaxParallelStreams);
  return {
    key: str(r.Key),
    name: str(r.Name),
    priceUsd: contactSales ? null : num(r.PriceUsd),
    creditUsd: num(r.CreditUsd),
    assisted: (ASSISTED as readonly string[]).includes(str(r.Assisted)) ? (str(r.Assisted) as Assisted) : "none",
    maxParallelStreams: streams > 0 ? streams : null,
    priority: num(r.Priority),
    features,
    contactSales,
    active: r.Active === true,
    sortOrder: num(r.SortOrder),
  };
}

export function planToRow(p: PlanView): Row {
  return {
    Key: p.key,
    Name: p.name,
    PriceUsd: p.contactSales || p.priceUsd === null ? 0 : p.priceUsd,
    CreditUsd: p.creditUsd,
    Assisted: p.assisted,
    MaxParallelStreams: p.maxParallelStreams ?? 0,
    Priority: p.priority,
    FeaturesJson: JSON.stringify(p.features),
    ContactSales: p.contactSales || p.priceUsd === null,
    Active: p.active,
    SortOrder: p.sortOrder,
  };
}

/** The stored plans, and only those: a plan that is not stored is not in the catalogue (never a built-in plan with its
 *  built-in price). An empty catalogue is filled by the platform's own seed action (billing.plans.seed). */
export async function readPlans(gateway: Pick<Gateway, "listAll">): Promise<{ plans: PlanView[]; rows: Row[] }> {
  const rows = await gateway.listAll<Row>(BILLING_SCHEMA.plan, { filter: {}, fields: PLAN_FIELDS });
  const plans = rows.map(planFromRow).filter((p) => p.key !== "");
  plans.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return { plans, rows };
}

export function planOf(plans: readonly PlanView[], key: string): PlanView | null {
  return plans.find((p) => p.key === key) ?? null;
}

/** A plan a record names that the catalogue does not list: its key as its name and no figures of its own (no price, no
 *  credit), never a built-in plan's. */
export function unlistedPlan(key: string): PlanView {
  return {
    key, name: key, priceUsd: null, creditUsd: 0, assisted: "none", maxParallelStreams: null, priority: 0, features: [],
    contactSales: false, active: false, sortOrder: 0,
  };
}

// ---------------------------------------------------------------- credit

export interface NewEntry {
  workspaceId: string;
  kind: CreditKind;
  cents: number;
  userId?: string;
  projectId?: string;
  jobId?: string;
  tokens?: number;
  note?: string;
  couponCode?: string;
  planKey?: string;
  detailJson?: string;
}

export function entryRow(e: NewEntry, at: string, by: string): Row {
  return {
    WorkspaceId: e.workspaceId,
    UserId: e.userId ?? "",
    ProjectId: e.projectId ?? "",
    JobId: e.jobId ?? "",
    Kind: e.kind,
    AmountUsd: centsToUsd(e.cents),
    AmountCents: e.cents,
    Tokens: e.tokens ?? 0,
    Note: (e.note ?? "").slice(0, 500),
    At: at,
    CouponCode: e.couponCode ?? "",
    PlanKey: e.planKey ?? "",
    DetailJson: e.detailJson ?? "",
    CreatedByUserId: by,
    UpdatedByUserId: by,
  };
}

/** Writes one credit entry under its once key (a retry or a second writer finds the same row). */
export async function writeEntry(deps: OpDeps, e: NewEntry, onceKey: string, by: string): Promise<{ row: Row; created: boolean }> {
  try {
    const res = await deps.gateway.insertOnce<Row>(BILLING_SCHEMA.creditEntry, entryRow(e, deps.clock.now(), by), onceKey);
    return { row: res.item, created: res.created };
  } finally {
    // the organization's summary and the usage reports are read afresh (readCache.ts)
    noteBillingWrite(e.workspaceId);
  }
}

export async function workspaceEntries(gateway: Pick<Gateway, "listAll">, workspaceId: string): Promise<Row[]> {
  return gateway.listAll<Row>(BILLING_SCHEMA.creditEntry, { filter: { WorkspaceId: workspaceId }, fields: CREDIT_FIELDS, maxItems: 5000 });
}

export async function balanceCentsOf(gateway: Pick<Gateway, "listAll">, workspaceId: string): Promise<number> {
  return billingTotals(await workspaceEntries(gateway, workspaceId)).balanceCents;
}

export function entryView(r: Row): CreditEntryView {
  return {
    id: str(r.ItemId),
    workspaceId: str(r.WorkspaceId),
    kind: str(r.Kind) as CreditKind,
    amountUsd: centsToUsd(entryCents(r)),
    tokens: num(r.Tokens),
    note: str(r.Note),
    at: str(r.At),
    userId: str(r.UserId),
    projectId: str(r.ProjectId),
    jobId: str(r.JobId),
  };
}

// ---------------------------------------------------------------- subscriptions

export async function subscriptionOf(gateway: Pick<Gateway, "list">, workspaceId: string): Promise<Row | null> {
  const res = await gateway.list<Row>(BILLING_SCHEMA.subscription, { filter: { WorkspaceId: workspaceId }, fields: SUBSCRIPTION_FIELDS, page: 1, pageSize: 1 });
  return res.items[0] ?? null;
}

/** Puts the organization on a plan (one Subscription row per workspace) and returns the row's fields. */
export async function setSubscription(
  deps: OpDeps,
  o: { workspaceId: string; planKey: string; startedAt: string; renewsAt: string; by: string; existing?: Row | null },
): Promise<void> {
  const existing = o.existing !== undefined ? o.existing : await subscriptionOf(deps.gateway, o.workspaceId);
  const set = {
    PlanKey: o.planKey, Status: "active", StartedAt: o.startedAt, RenewsAt: o.renewsAt, CurrentPeriodStart: o.startedAt, CancelAtPeriodEnd: false,
    NextPlanKey: "", StatusNote: "", PastDueSince: "", UpdatedByUserId: o.by,
  };
  if (existing) {
    await deps.gateway.update(BILLING_SCHEMA.subscription, str(existing.ItemId), set);
    return;
  }
  const res = await deps.gateway.insertOnce<Row>(
    BILLING_SCHEMA.subscription,
    { WorkspaceId: o.workspaceId, ...set, CreatedByUserId: o.by },
    `subscription:${o.workspaceId}`,
  );
  if (!res.created) await deps.gateway.update(BILLING_SCHEMA.subscription, res.item.ItemId, set);
}

/**
 * The sign-up grant: a Free subscription for a new organization and the sign-up credit (billing.signupCreditUsd) once
 * per person who creates organizations (RequestKey signup:user:<id>), so making more organizations grants nothing more.
 */
export async function grantSignup(deps: OpDeps, o: { workspaceId: string; userId: string }): Promise<{ granted: boolean }> {
  const now = deps.clock.now();
  const [settings] = await Promise.all([
    readSettings(deps.gateway),
    deps.gateway.insertOnce<Row>(
      BILLING_SCHEMA.subscription,
      { WorkspaceId: o.workspaceId, PlanKey: "free", Status: "active", StartedAt: now, RenewsAt: "", CreatedByUserId: o.userId, UpdatedByUserId: o.userId },
      `subscription:${o.workspaceId}`,
    ),
  ]);
  const cents = toCents(settings.signupCreditUsd);
  if (cents <= 0) return { granted: false };
  const res = await writeEntry(
    deps,
    { workspaceId: o.workspaceId, kind: "signup", cents, userId: o.userId, note: "Sign-up credit", planKey: "free" },
    `signup:user:${o.userId}`,
    o.userId,
  );
  return { granted: res.created };
}

// ---------------------------------------------------------------- views

export function couponView(r: Row): CouponView {
  const t = couponTermsOf(r);
  return {
    kind: t.kind,
    legacy: t.legacy,
    planKeys: t.planKeys,
    durationMonths: t.durationMonths,
    percentOff: t.percentOff,
    amountOffUsd: centsToUsd(t.amountOffCents),
    perPersonLimit: t.perPersonLimit,
    description: describeCoupon(t),
    id: str(r.ItemId),
    code: str(r.Code),
    amountUsd: centsToUsd(toCents(num(r.AmountUsd))),
    planKey: str(r.PlanKey) || null,
    maxRedemptions: num(r.MaxRedemptions),
    redemptions: num(r.Redemptions),
    expiresAt: str(r.ExpiresAt) || null,
    active: r.Active === true,
    note: str(r.Note),
  };
}

export function purchaseView(r: Row, names: ReadonlyMap<string, string> = new Map()): PurchaseView {
  const amount = num(r.AmountUsd);
  return {
    id: str(r.ItemId),
    workspaceId: str(r.WorkspaceId),
    workspaceName: names.get(str(r.WorkspaceId)) ?? "",
    userId: str(r.UserId),
    userEmail: str(r.UserEmail),
    planKey: str(r.PlanKey) || null,
    amountUsd: amount > 0 ? centsToUsd(toCents(amount)) : null,
    status: (str(r.Status) || "pending") as PurchaseView["status"],
    note: str(r.Note),
    createdAt: str(r.CreatedDate),
    decidedBy: str(r.DecidedBy),
    decidedAt: str(r.DecidedAt),
  };
}

export async function workspaceNames(gateway: Pick<Gateway, "listAll">, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await gateway.listAll<Row>(BILLING_SCHEMA.workspace, { filter: { ItemId: { in: unique } }, fields: ["ItemId", "Name"] });
  return new Map(rows.map((r) => [str(r.ItemId), str(r.Name)]));
}
