// Checkout and subscription reads and writes (functions/billing/ops/checkout.ts): billing.checkout.start / applyCode /
// confirm, billing.payments.list, billing.subscription.change / cancel / resume, billing.access and the platform's
// billing.paywall.get / save. Every answer is the server's; the screens never compute a price or a balance.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { freshnessQuery } from "@/madp/blocks/data/freshness";
import { FunctionError, callFunction } from "@/madp/blocks/fn";
import { t } from "@/madp/i18n";
import type { AccessView, BillingAccountView, ChangeAnswer, CheckoutView, PaymentProviderId, PaywallSettings, SubscriptionView } from "@/madp/domain/payments";
import { BILLING_FN, billingKeys, isBillingMissing } from "./billingData";

export const checkoutKeys = {
  account: (workspaceId: string) => ["ws", workspaceId, "billing", "account"] as const,
  access: (workspaceId: string) => ["ws", workspaceId, "billing", "access"] as const,
  paywall: () => ["platform", "billing", "paywall"] as const,
};

export async function startCheckout(a: { workspaceId: string; planKey: string; code?: string }): Promise<CheckoutView> {
  const r = await callFunction<{ checkout: CheckoutView }>(BILLING_FN, "billing.checkout.start", { ...a, ...(a.code ? { code: a.code } : {}) });
  return r.data.checkout;
}

export async function applyCheckoutCode(checkoutId: string, code: string): Promise<CheckoutView> {
  const r = await callFunction<{ checkout: CheckoutView }>(BILLING_FN, "billing.checkout.applyCode", { checkoutId, code });
  return r.data.checkout;
}

export async function confirmCheckout(checkoutId: string): Promise<{ checkout: CheckoutView; balanceUsd: number }> {
  const r = await callFunction<{ checkout: CheckoutView; balanceUsd: number }>(BILLING_FN, "billing.checkout.confirm", { checkoutId });
  return r.data;
}

export function useBillingAccount(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: checkoutKeys.account(workspaceId ?? "none"),
    queryFn: async () => (await callFunction<BillingAccountView>(BILLING_FN, "billing.payments.list", { workspaceId })).data,
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    retry: (count, e) => count < 1 && !isBillingMissing(e),
  });
}

export function useBillingAccess(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: checkoutKeys.access(workspaceId ?? "none"),
    queryFn: async () => (await callFunction<AccessView>(BILLING_FN, "billing.access", { workspaceId })).data,
    enabled: enabled && Boolean(workspaceId),
    staleTime: 30_000,
    retry: (count, e) => count < 1 && !isBillingMissing(e),
  });
}

/** After a payment or a plan change: the summary, the account and the access answer are read again. */
function useRefreshBilling(workspaceId: string | null | undefined) {
  const client = useQueryClient();
  return () => {
    const ws = workspaceId ?? "none";
    void client.invalidateQueries({ queryKey: billingKeys.summary(ws) });
    void client.invalidateQueries({ queryKey: checkoutKeys.account(ws) });
    void client.invalidateQueries({ queryKey: checkoutKeys.access(ws) });
  };
}

export function useConfirmCheckout(workspaceId: string | null | undefined) {
  const refresh = useRefreshBilling(workspaceId);
  return useMutation({ mutationFn: confirmCheckout, onSuccess: refresh });
}

export function useChangePlan(workspaceId: string | null | undefined) {
  const refresh = useRefreshBilling(workspaceId);
  return useMutation({
    mutationFn: async (planKey: string) => (await callFunction<ChangeAnswer>(BILLING_FN, "billing.subscription.change", { workspaceId, planKey })).data,
    onSuccess: refresh,
  });
}

export function useCancelPlan(workspaceId: string | null | undefined) {
  const refresh = useRefreshBilling(workspaceId);
  return useMutation({
    mutationFn: async () => (await callFunction<{ subscription: SubscriptionView }>(BILLING_FN, "billing.subscription.cancel", { workspaceId })).data.subscription,
    onSuccess: refresh,
  });
}

export function useResumePlan(workspaceId: string | null | undefined) {
  const refresh = useRefreshBilling(workspaceId);
  return useMutation({
    mutationFn: async () => (await callFunction<{ subscription: SubscriptionView }>(BILLING_FN, "billing.subscription.resume", { workspaceId })).data.subscription,
    onSuccess: refresh,
  });
}

/** Blocks Utilities holds the plan: the subscription, a renewed period's credit and bought credit are brought here
 *  (billing.subscription.sync), then the billing answers are read again. */
export function useSyncBilling(workspaceId: string | null | undefined) {
  const refresh = useRefreshBilling(workspaceId);
  return useMutation({
    mutationFn: async () => (await callFunction<{ creditGranted: boolean; purchasesMirrored: number; usageReported: number }>(BILLING_FN, "billing.subscription.sync", { workspaceId })).data,
    onSuccess: refresh,
  });
}

export function usePaywallSettings(enabled: boolean) {
  return useQuery({
    queryKey: checkoutKeys.paywall(),
    queryFn: async () => (await callFunction<PaywallSettings>(BILLING_FN, "billing.paywall.get", {})).data,
    enabled,
    ...freshnessQuery("calm"),
    retry: (count, e) => count < 1 && !isBillingMissing(e),
  });
}

export function useSavePaywall() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (a: { enforce?: boolean; internalWorkspaceIds?: string[]; provider?: PaymentProviderId; source?: "factory" | "blocks-utilities" }) =>
      (await callFunction<PaywallSettings>(BILLING_FN, "billing.paywall.save", a)).data,
    onSuccess: (data) => client.setQueryData(checkoutKeys.paywall(), data),
  });
}

/** A plain sentence for a refused checkout, code or plan change (never server text). */
export function checkoutErrorText(e: unknown): string {
  if (isBillingMissing(e)) return t("billing.errors.notAvailable", "This isn't available yet. Try again later.");
  if (!(e instanceof FunctionError)) return t("billing.errors.somethingWrong", "Something went wrong. Nothing was charged; try again.");
  const p = (e.params ?? {}) as Record<string, unknown>;
  switch (e.messageKey) {
    case "billing.couponUnknown":
      return t("billing.errors.couponUnknown", "We don't know this code. Check it and try again.");
    case "billing.couponAlreadyRedeemed":
      return t("billing.errors.couponAlreadyRedeemed", "Your organization has already used this code.");
    case "billing.coupon.expired":
      return t("billing.errors.couponExpired", "This code has expired.");
    case "billing.coupon.inactive":
      return t("billing.errors.couponInactive", "This code is no longer active.");
    case "billing.coupon.used-up":
      return t("billing.errors.couponUsedUp", "This code has been used as often as it allows.");
    case "billing.coupon.personLimit":
      return t("billing.errors.couponPersonLimit", "You have already used this code as often as it allows.");
    case "billing.coupon.creditCode":
      return typeof p.amountUsd === "number"
        ? t("billing.errors.creditCodeAmount", "This code adds USD {amount} credit. It does not pay for a plan.", { amount: p.amountUsd.toFixed(2) })
        : t("billing.errors.creditCode", "This code adds credit. It does not pay for a plan.");
    case "billing.coupon.planNotAllowed":
      if (!Array.isArray(p.plans) || !p.plans.length) return t("billing.errors.planOther", "This code is for another plan.");
      if (p.plans.length === 1) return t("billing.errors.planOne", "This code is for the {plan} plan.", { plan: String(p.plans[0]) });
      return t("billing.errors.planEither", "This code is for the {plans} or {last} plan.", { plans: p.plans.slice(0, -1).join(", "), last: String(p.plans[p.plans.length - 1]) });
    case "billing.coupon.notForPlan":
      return t("billing.errors.couponNotForPlan", "This code can't be used for this plan.");
    case "billing.coupon.useAtCheckout":
      return t("billing.errors.couponUseAtCheckout", "This code pays for a plan. Use it at checkout.");
    case "billing.checkout.paymentRequired":
      return t("billing.errors.paymentRequired", "Card payments are being connected. Until then a code pays for a plan.");
    case "billing.checkout.paymentFailed":
      return t("billing.errors.paymentFailed", "The payment did not go through. Nothing was charged; try again.");
    case "billing.checkout.closed":
      return t("billing.errors.checkoutClosed", "This checkout has closed. Start again to see today's price.");
    case "billing.checkout.stale":
      return t("billing.errors.checkoutStale", "This checkout is out of date. Start again.");
    case "billing.checkout.alreadyOnPlan":
      return t("billing.errors.alreadyOnPlan", "Your organization is already on this plan.");
    case "billing.checkout.downgradeAtRenewal":
      return t("billing.errors.downgradeAtRenewal", "A lower plan starts on your renewal day.");
    case "billing.checkout.freePlan":
      return t("billing.errors.freePlan", "Free needs no checkout.");
    case "billing.plan.contactSales":
      return t("billing.errors.planContactSales", "This plan is agreed with our sales team.");
    case "billing.planUnknown":
      return t("billing.errors.planUnknown", "This plan is not offered.");
    case "billing.subscription.nothingToCancel":
      return t("billing.errors.nothingToCancel", "There is no paid plan to cancel.");
    case "billing.subscription.payToResume":
      return t("billing.errors.payToResume", "This plan's payment is due. Pay with a code to keep it.");
    case "billing.provider.unavailable":
      return t("billing.errors.providerUnavailable", "The payment service did not answer. Nothing changed; try again in a moment.");
    case "billing.utilities.organization":
      return t("billing.errors.otherOrganization", "Your sign-in is for another organization. Switch to this organization to manage its plan.");
    case "billing.utilities.billingProfile":
      return t("billing.errors.billingProfile", "Add your organization's billing details before choosing a paid plan.");
    case "billing.utilities.refused":
      return t("billing.errors.billingRefused", "The billing service refused this change. Nothing was charged; try again later.");
    case "billing.utilities.noSubscription":
      return t("billing.errors.noSubscription", "Choose a plan first. Credit is bought on top of a plan.");
    default:
      break;
  }
  if (e.code === "forbidden") return t("billing.errors.ownersOnly", "Only the organization's owners can change the plan.");
  if (e.code === "not_member") return t("billing.errors.notMember", "You're not a member of this organization.");
  if (e.code === "invalid_input") return t("billing.errors.codeFormat", "A code has 4 to 32 letters, digits or dashes.");
  return t("billing.errors.somethingWrong", "Something went wrong. Nothing was charged; try again.");
}
