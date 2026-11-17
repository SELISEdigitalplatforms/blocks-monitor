// The Blocks OS Utilities service (blocks-utilities: subscription plans, discounts, subscriptions, credits, usage and
// payments) as the Factory calls it: the wire shapes, the enum values its requests take and the client contract the
// billing functions code against (implemented in functions/_lib/blocksUtilities.ts). Pure: no I/O here.
//
// Read from the service's own source (github.com/SELISEdigitalplatforms/blocks-utilities, server/Api/Controllers):
// - Every route is served as /api/<route> on the Utilities host and as <BLOCKS_API_URL>/utilities/v4/<route> through
//   the Blocks API gateway (the path the Factory uses by default; see utilitiesBaseOf).
// - Every answer is the envelope { success, data, error: { code, message, fields, traceId }, meta }.
// - Requests take numbers for the enums without a string converter (BillingInterval, DiscountKind, SubscriberScope,
//   MeterAggregation, MeterResetPolicy, EntitlementLimitKind, QuantityDiscountCombinationPolicy) and names for the ones
//   with it (DiscountScope, CampaignKind, CampaignPrecedence, TrialDurationKind). Answers carry names.
// - Every endpoint is a protected resource "blocks-utilities::<area>::read|manage" the caller's roles must reach.
// - Plans and discounts are the tenant's catalogue (organizationId omitted: sold to every organization). Everything a
//   subscription does (preview, subscribe, change, cancel, credits, usage) is scoped to the caller token's
//   organization: a body or query organizationId is honoured only for the Blocks console, ignored for everyone else.

/** Where the gateway serves Utilities, relative to BLOCKS_API_URL. */
export const UTILITIES_DEFAULT_BASE = "/utilities/v4";

export const BILLING_INTERVAL = { Day: 0, Week: 1, Month: 2, Year: 3 } as const;
export const DISCOUNT_KIND = { Percent: 0, FixedAmount: 1 } as const;
export const SUBSCRIBER_SCOPE = { Organization: 0, User: 1 } as const;
export const QUANTITY_DISCOUNT_POLICY = { BestDiscount: 0, QuantityOnly: 1, Stack: 2 } as const;
export const METER_AGGREGATION = { Sum: 0, Max: 1, LastValue: 2 } as const;
export const METER_RESET = { Periodic: 0, Never: 1, CarryForward: 2 } as const;
export const ENTITLEMENT_LIMIT_KIND = { Boolean: 0, Count: 1, Unlimited: 2 } as const;

/** Plan and discount codes: lowercase letters, digits, hyphens and underscores, at most 64. */
export const UTILITIES_CODE = /^[a-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------- answers

export interface UtilitiesPrice {
  priceId: string;
  currencyCode: string;
  unitAmountMinor: number;
  interval: string;
  intervalCount: number;
  billingAlignment?: string;
  displayPriceNote?: string | null;
  quantityItemKey?: string | null;
  taxRateBasisPoints?: number | null;
  taxMode?: string | null;
}

export interface UtilitiesMeter {
  meterKey: string;
  displayName: string;
  unitLabel: string;
  includedQuantity: number;
  overageAllowed: boolean;
  [key: string]: unknown;
}

export interface UtilitiesPlan {
  planId: string;
  code: string;
  displayName: string;
  description?: string | null;
  organizationId?: string | null;
  featuresJson?: string | null;
  familyCode?: string | null;
  familyRank?: number | null;
  /** "Active" | "Archived". */
  status: string;
  version: number;
  hasSubscribers: boolean;
  requirePaymentMethodUpfront?: boolean;
  usageInterval?: string;
  usageIntervalCount?: number;
  meters: UtilitiesMeter[];
  prices: UtilitiesPrice[];
  [key: string]: unknown;
}

export interface UtilitiesPlanVersion {
  version: number;
  supersededAtUtc: string;
  plan: UtilitiesPlan;
}

export interface UtilitiesDiscount {
  discountId: string;
  organizationId?: string | null;
  code: string;
  displayName: string;
  /** "Percent" | "FixedAmount". */
  kind: string;
  percentBasisPoints?: number | null;
  amountMinor?: number | null;
  currencyCode?: string | null;
  durationPeriods?: number | null;
  startsAtUtc?: string | null;
  expiresAtUtc?: string | null;
  applicablePlanCodes: string[];
  applicablePriceIds?: string[];
  /** "Subscription" | "CreditPurchase". */
  scope?: string;
  /** "Active" | "Archived". */
  status: string;
  version: number;
  oneUsePerOrganization: boolean;
  /** "Upcoming" | "Active" | "Expired" | "Archived". */
  effectiveState?: string;
  reservedRedemptions?: number;
  redeemedRedemptions?: number;
  releasedRedemptions?: number;
  [key: string]: unknown;
}

export interface UtilitiesPreviewBlocker {
  code: string;
  message: string;
}

export interface UtilitiesSubscriptionPreview {
  currencyCode: string;
  subtotalMinor: number;
  discountMinor: number;
  promotionalDiscountMinor?: number;
  taxMinor: number;
  totalDueNowMinor: number;
  prorated?: boolean;
  periodStartUtc: string;
  periodEndUtc: string;
  nextRenewalAtUtc?: string | null;
  nextRenewalAmountMinor?: number;
  requiresCardSetup?: boolean;
  blockers: UtilitiesPreviewBlocker[];
  quotedAtUtc?: string;
  [key: string]: unknown;
}

export interface UtilitiesDiscountPreview {
  /** The code's verdict; anything but an acceptance carries reasonCode and message. */
  status: string;
  reasonCode?: string | null;
  message?: string | null;
  quote: UtilitiesSubscriptionPreview;
}

export interface UtilitiesPendingPlanChange {
  targetPlanCode: string;
  targetPlanName: string;
  targetPriceId: string;
  effectiveAtUtc: string;
}

export interface UtilitiesPendingCheckout {
  purpose: string;
  state: string;
  errorCode?: string | null;
  checkoutUrl?: string | null;
}

export interface UtilitiesSubscription {
  subscriptionId: string;
  /** "Incomplete" | "IncompleteExpired" | "Trialing" | "Active" | "PastDue" | "Unpaid" | "Canceled". */
  status: string;
  planCode: string;
  planName: string;
  currencyCode: string;
  unitAmountMinor: number;
  interval: string;
  intervalCount: number;
  currentPeriodStartUtc: string;
  currentPeriodEndUtc: string;
  nextPaymentAtUtc?: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAtUtc?: string | null;
  pendingPlanChange?: UtilitiesPendingPlanChange | null;
  recurringAmountMinor?: number;
  promotionalDiscountMinor?: number;
  initialChargeAmountMinor?: number | null;
  /** The hosted payment page to send the buyer to (a card provider is configured and something is due). */
  checkoutUrl?: string | null;
  pendingCheckout?: UtilitiesPendingCheckout | null;
  hasPaymentMethod?: boolean | null;
  version: number;
  providerName?: string | null;
  [key: string]: unknown;
}

export interface UtilitiesPlanChangePreview {
  currencyCode: string;
  targetPlanCode: string;
  targetPriceId: string;
  chargeMinor: number;
  /** When the change applies ("Immediate" now, otherwise at the renewal). */
  timing: string;
  effectiveAtUtc: string;
  newPeriodStartUtc: string;
  newPeriodEndUtc: string;
  nextRenewalAmountMinor: number;
  blockers: UtilitiesPreviewBlocker[];
  [key: string]: unknown;
}

export interface UtilitiesCreditGrant {
  grantId: string;
  meterKey: string;
  source: string;
  quantity: number;
  remaining: number;
  status: string;
  grantedAtUtc: string;
  reason?: string | null;
  [key: string]: unknown;
}

export interface UtilitiesCreditPurchase {
  purchaseId: string;
  status: string;
  checkoutUrl?: string | null;
  grant?: UtilitiesCreditGrant | null;
  failureCode?: string | null;
  replayed?: boolean;
  [key: string]: unknown;
}

export interface UtilitiesUsage {
  allowed: boolean;
  meterKey: string;
  unitLabel: string;
  periodKey: string;
  periodStartUtc: string;
  periodEndUtc: string;
  included: number;
  used: number;
  remaining: number;
  overage: number;
  purchasedRemaining?: number | null;
  replayed: boolean;
  [key: string]: unknown;
}

export interface UtilitiesPaymentProvider {
  paymentProviderId: string;
  providerName: string;
  organizationId?: string | null;
  isEnabled: boolean;
  frontendResultUrl?: string | null;
  [key: string]: unknown;
}

export interface UtilitiesEntitlementSnapshot {
  hasSubscription: boolean;
  status: string;
  planCode: string;
  currentPeriodEndUtc?: string | null;
  entitlements: { key: string; [key: string]: unknown }[];
  featuresJson?: string | null;
  [key: string]: unknown;
}

export interface UtilitiesFinancialDocument {
  documentId: string;
  documentNumber: string;
  /** "Invoice" | "TrialInvoice" | "CreditNote". */
  documentType: string;
  status: string;
  issuedAtUtc: string;
  subscriptionId: string;
  currencyCode: string;
  planCode: string;
  planName: string;
  periodStartUtc?: string | null;
  periodEndUtc?: string | null;
  amounts: { grossSubtotalMinor?: number; promotionalDiscountMinor?: number; netSubtotalMinor?: number; taxMinor?: number; totalMinor?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface UtilitiesFinancialDocumentPage {
  items: UtilitiesFinancialDocument[];
  pageInfo: { pageSize: number; hasNextPage: boolean; nextCursor?: string | null };
}

export interface UtilitiesBillingProfile {
  legalName?: string;
  displayName?: string | null;
  billingContactName?: string;
  billingContactEmail?: string;
  billingContactLanguage?: string | null;
  address?: { line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; countryCode?: string | null } | null;
  taxRegistrationId?: string | null;
  [key: string]: unknown;
}

export interface UtilitiesMerchantProfile {
  legalName?: string;
  paymentProviderName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- requests

export interface UtilitiesEntitlementRequest {
  key: string;
  limitKind: number;
  limit?: number;
  meterKey?: string;
  unitLabel?: string;
}

export interface UtilitiesPlanDefinition {
  displayName: string;
  description?: string;
  /** A JSON object, stored verbatim and handed back untouched. */
  featuresJson?: string;
  trialRequiresPaymentMethod: boolean;
  oneTrialPerPlan: boolean;
  requirePaymentMethodUpfront: boolean;
  quantityDiscountCombinationPolicy: number;
  usageInterval: number;
  usageIntervalCount: number;
  familyCode?: string;
  familyRank?: number;
  quantityItems: unknown[];
  meters: UtilitiesMeterRequest[];
  entitlements: UtilitiesEntitlementRequest[];
  trialGrants: unknown[];
}

export interface UtilitiesMeterRequest {
  meterKey: string;
  displayName: string;
  unitLabel: string;
  aggregation: number;
  resetPolicy: number;
  quantityScale: number;
  includedQuantity: number;
  overageAllowed: boolean;
  thresholdPercents: number[];
  rateTables: unknown[];
  subLimits: unknown[];
  /** Buyable credits on this meter (POST /subscriptions/{id}/credits). */
  topUp?: {
    enabled: boolean;
    unitPrices: { currencyCode: string; unitAmountMinor: number }[];
    minQuantity: number;
    maxQuantity: number;
    expiryPolicy: number;
  };
}

export interface UtilitiesCreatePlan extends UtilitiesPlanDefinition {
  code: string;
  subscriberScope: number;
  organizationId?: string;
}

export interface UtilitiesUpdatePlan extends UtilitiesPlanDefinition {
  organizationId?: string;
}

export interface UtilitiesCreatePrice {
  planId: string;
  currencyCode: string;
  unitAmountMinor: number;
  interval: number;
  intervalCount: number;
  displayPriceNote?: string;
  organizationId?: string;
}

export interface UtilitiesDiscountTerms {
  displayName: string;
  kind: number;
  percentBasisPoints?: number;
  amountMinor?: number;
  currencyCode?: string;
  durationPeriods?: number;
  startsAtUtc?: string;
  expiresAtUtc?: string;
  applicablePlanCodes: string[];
  applicablePriceIds: string[];
  scope: "Subscription" | "CreditPurchase";
  applicableMeterKeys: string[];
  oneUsePerOrganization: boolean;
  requiresPaymentMethodUpfront?: boolean;
}

export interface UtilitiesCreateDiscount extends UtilitiesDiscountTerms {
  code: string;
  organizationId?: string;
}

export interface UtilitiesUpdateDiscount extends UtilitiesDiscountTerms {
  expectedVersion: number;
}

export interface UtilitiesSubscribe {
  planCode: string;
  priceId: string;
  quantities?: { itemKey: string; quantity: number }[];
  timeZoneId?: string;
  discountCode?: string;
  organizationId?: string;
  billingEmail?: string;
  billingName?: string;
  billingLanguage?: string;
}

export interface UtilitiesChangePlan {
  planCode: string;
  priceId: string;
  quantities?: { itemKey: string; quantity: number }[];
  organizationId?: string;
}

export interface UtilitiesRecordUsage {
  meterKey: string;
  quantity: number;
  idempotencyKey: string;
  occurredAtUtc?: string;
  enforce?: boolean;
  metadata?: Record<string, string>;
  organizationId?: string;
  userId?: string;
}

export interface UtilitiesGrantCredits {
  meterKey: string;
  quantity: number;
  reason: string;
  seatNumber?: number;
  organizationId?: string;
}

export interface UtilitiesCreditPurchaseRequest {
  meterKey: string;
  quantity: number;
  discountCode?: string;
  idempotencyKey?: string;
  seatNumber?: number;
  organizationId?: string;
}

// ---------------------------------------------------------------- the client contract

/** A refused or failed Utilities call: the service's own error code (or a transport one) and the HTTP status. */
export interface UtilitiesFailureInfo {
  /** The service's code ("subscription_discount_expired", …), or utilities_unavailable / utilities_unauthorized. */
  code: string;
  status: number | null;
  message: string;
  fields: Record<string, string[]>;
}

export type PlanFilter = "Active" | "Archived" | "All";

export interface UtilitiesApi {
  plans: {
    list(o?: { status?: PlanFilter; familyCode?: string; organizationId?: string }): Promise<UtilitiesPlan[]>;
    get(planId: string, o?: { organizationId?: string }): Promise<UtilitiesPlan>;
    versions(planId: string, o?: { organizationId?: string }): Promise<UtilitiesPlanVersion[]>;
    create(plan: UtilitiesCreatePlan): Promise<UtilitiesPlan>;
    update(planId: string, plan: UtilitiesUpdatePlan): Promise<UtilitiesPlan>;
    archive(planId: string, o?: { organizationId?: string }): Promise<UtilitiesPlan>;
    createPrice(price: UtilitiesCreatePrice): Promise<UtilitiesPlan>;
    archivePrice(priceId: string, o?: { organizationId?: string }): Promise<UtilitiesPlan>;
  };
  discounts: {
    list(o?: { organizationId?: string }): Promise<UtilitiesDiscount[]>;
    get(discountId: string, o?: { organizationId?: string }): Promise<UtilitiesDiscount>;
    create(d: UtilitiesCreateDiscount): Promise<UtilitiesDiscount>;
    update(discountId: string, d: UtilitiesUpdateDiscount, o?: { organizationId?: string }): Promise<UtilitiesDiscount>;
    archive(discountId: string, o?: { organizationId?: string }): Promise<UtilitiesDiscount>;
    /** Validates and prices a code against a subscription the caller's organization would take (nothing is stored). */
    preview(s: UtilitiesSubscribe): Promise<UtilitiesDiscountPreview>;
  };
  subscriptions: {
    preview(s: UtilitiesSubscribe): Promise<UtilitiesSubscriptionPreview>;
    /** Subscribes the caller's organization; a payable first charge answers checkoutUrl (the hosted payment page). */
    subscribe(s: UtilitiesSubscribe): Promise<UtilitiesSubscription>;
    /** The caller's organization's subscription, or null when it has none. */
    current(o?: { organizationId?: string }): Promise<UtilitiesSubscription | null>;
    mine(o?: { organizationId?: string }): Promise<unknown[]>;
    /** At the end of the paid period unless immediately. */
    cancel(subscriptionId: string, o?: { immediately?: boolean; reason?: string; organizationId?: string }): Promise<UtilitiesSubscription>;
    /** Withdraws a scheduled cancel (the "resume"). */
    withdrawCancellation(subscriptionId: string, o?: { organizationId?: string }): Promise<UtilitiesSubscription>;
    previewPlanChange(subscriptionId: string, c: UtilitiesChangePlan): Promise<UtilitiesPlanChangePreview>;
    changePlan(subscriptionId: string, c: UtilitiesChangePlan): Promise<UtilitiesSubscription>;
    cancelPendingPlanChange(subscriptionId: string, o?: { organizationId?: string }): Promise<UtilitiesSubscription>;
  };
  credits: {
    list(subscriptionId: string, o?: { meterKey?: string; status?: string; organizationId?: string }): Promise<UtilitiesCreditGrant[]>;
    grant(subscriptionId: string, g: UtilitiesGrantCredits): Promise<UtilitiesCreditGrant>;
    preview(subscriptionId: string, p: UtilitiesCreditPurchaseRequest): Promise<Record<string, unknown>>;
    purchase(subscriptionId: string, p: UtilitiesCreditPurchaseRequest): Promise<UtilitiesCreditPurchase>;
  };
  entitlements: {
    /** What the caller's organization's live subscription grants (plan code, entitlements, the plan's featuresJson). */
    get(o?: { organizationId?: string }): Promise<UtilitiesEntitlementSnapshot>;
  };
  invoices: {
    /** The organization's invoices and credit notes, newest first, one page at a time. */
    list(o?: { pageSize?: number; after?: string; subscriptionId?: string; organizationId?: string }): Promise<UtilitiesFinancialDocumentPage>;
  };
  billingProfile: {
    get(o?: { organizationId?: string }): Promise<UtilitiesBillingProfile | null>;
    /** The details an invoice must carry; a paid subscription is refused until they are complete. */
    put(p: UtilitiesBillingProfile & { organizationId?: string }): Promise<UtilitiesBillingProfile>;
  };
  usage: {
    /** Records usage (idempotent per subscription, meter and idempotencyKey) and answers where it leaves the allowance. */
    record(u: UtilitiesRecordUsage): Promise<UtilitiesUsage>;
    /** Current usage of every meter of the organization's live subscription (the balance). */
    current(o?: { organizationId?: string }): Promise<UtilitiesUsage[]>;
  };
  payments: {
    /** The tenant's payment providers (no credentials). */
    providers(): Promise<UtilitiesPaymentProvider[]>;
  };
  merchantProfile: {
    get(): Promise<UtilitiesMerchantProfile | null>;
  };
}

/** Utilities for the billing ops: the tenant catalogue on the platform's service identity, and organization-scoped
 *  calls on a token issued for that IAM organization (null when the host cannot issue one). */
export interface UtilitiesAccess {
  service: UtilitiesApi;
  forOrganization(organizationId: string): Promise<UtilitiesApi | null>;
}

/** The base the client puts in front of every route: a gateway path ("/utilities/v4") or the Utilities host's API
 *  root ("https://utilities.example/api"). Anything else falls back to the gateway path. */
export function utilitiesBaseOf(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return UTILITIES_DEFAULT_BASE;
  const v = raw.trim().replace(/\/+$/, "");
  if (/^\/[A-Za-z0-9._~/-]{1,200}$/.test(v) && !v.includes("..")) return v;
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(v) && !v.includes("..")) return v;
  return UTILITIES_DEFAULT_BASE;
}

/** The money of a USD amount in minor units (cents) as Utilities takes it. */
export const USD = "USD";
