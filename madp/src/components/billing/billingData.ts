// The billing function's reads and writes for the usage surfaces: billing.summary (on the live clock: every 10 s while
// an engine job runs, every 60 s otherwise, and at once when a job starts or ends; one read however many surfaces show
// it, src/blocks/billing/usage.ts), billing.jobs.usage (the build in focus), billing.plans.list, billing.redeemCoupon and
// billing.requestPurchase. A function that is not there yet, or that fails, reads as "not available": the surfaces stay
// calm and never invent a figure.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { FunctionError, callFunction, functionErrorMessage, type FunctionResult } from "@/blocks/fn";
import { FunctionNotConfiguredError, type FunctionName } from "@/blocks/functions";
import { liveEvery } from "@/blocks/data/livePoll";
import { t } from "@/i18n";
import { FRESHNESS_MS, freshnessQuery } from "@/blocks/data/freshness";
import { USAGE_BUSY_MS, USAGE_IDLE_MS, USAGE_STALE_MS, usageKeys, usagePace } from "@/blocks/billing/usage";
import {
  toBillingPlans, toBillingSummary, toJobUsages, type BillingPlan, type BillingSummary, type JobUsageView, type PurchaseRequestArgs,
} from "./types";

/** The billing function group (functions/billing). */
export const BILLING_FN = "billing" as FunctionName;

export type BillingCall = <T>(name: FunctionName, op: string, args?: Record<string, unknown>) => Promise<FunctionResult<T>>;

/** How often the summary is read again (the usage tier, docs/FRESHNESS.md): every 10 s while an engine job runs,
 *  every 60 s otherwise (the server answers repeats within 5 s from its cache). */
export const SUMMARY_BUSY_MS = USAGE_BUSY_MS;
export const SUMMARY_IDLE_MS = USAGE_IDLE_MS;

export const billingKeys = {
  summary: usageKeys.summary,
  job: usageKeys.job,
  plans: () => ["platform", "billing", "plans"] as const,
};

/** The function or the op is not deployed (yet): the surfaces show nothing, the card says it is not available. */
export function isBillingMissing(e: unknown): boolean {
  if (e instanceof FunctionNotConfiguredError) return true;
  if (e instanceof FunctionError) return e.code === "unknown_op" || e.code === "not_supported";
  // an unknown function name is refused before any request
  return e instanceof TypeError && /Unknown function/.test(e.message);
}

/** A plain sentence for a failed billing write (never server text). */
export function billingErrorText(e: unknown): string {
  if (isBillingMissing(e)) return t("billing.errors.notAvailable", "This isn't available yet. Try again later.");
  if (e instanceof FunctionError) {
    if (e.code === "forbidden") return t("billing.errors.workspaceOwnerOnly", "Only the workspace owner can do this.");
    if (e.code === "not_found" || e.code === "coupon_not_found") return t("billing.errors.couponUnknown", "We don't know this code. Check it and try again.");
    if (e.code === "conflict" || e.code === "coupon_used") return t("billing.errors.couponUsed", "This code has already been used.");
    if (e.code === "coupon_expired") return t("billing.errors.couponExpired", "This code has expired.");
    return e.message || functionErrorMessage(e.code);
  }
  return functionErrorMessage("unknown");
}

export async function fetchBillingSummary(workspaceId: string, call: BillingCall = callFunction): Promise<BillingSummary> {
  const r = await call<unknown>(BILLING_FN, "billing.summary", { workspaceId });
  const s = toBillingSummary(r.data);
  if (!s) throw new FunctionError("invalid_reply", t("billing.errors.usageUnavailable", "Usage isn't available right now."), r.requestId);
  return s;
}

/** What the given jobs of the workspace have cost so far (charged, tokens); a job without a charge is left out. */
export async function fetchJobUsage(workspaceId: string, jobIds: readonly string[], call: BillingCall = callFunction): Promise<JobUsageView[]> {
  const r = await call<unknown>(BILLING_FN, "billing.jobs.usage", { workspaceId, jobIds: [...jobIds] });
  return toJobUsages(r.data);
}

export async function fetchBillingPlans(call: BillingCall = callFunction): Promise<BillingPlan[]> {
  const r = await call<unknown>(BILLING_FN, "billing.plans.list", {});
  return toBillingPlans(r.data);
}

export async function redeemCoupon(workspaceId: string, code: string, call: BillingCall = callFunction): Promise<unknown> {
  const r = await call<unknown>(BILLING_FN, "billing.redeemCoupon", { workspaceId, code: normaliseCoupon(code) });
  return r.data;
}

export async function requestPurchase(args: PurchaseRequestArgs, call: BillingCall = callFunction): Promise<unknown> {
  const body: Record<string, unknown> = { workspaceId: args.workspaceId };
  if (args.planKey !== undefined) body.planKey = args.planKey;
  if (args.amountUsd !== undefined) body.amountUsd = args.amountUsd;
  if (args.note && args.note.trim()) body.note = args.note.trim();
  const r = await call<unknown>(BILLING_FN, "billing.requestPurchase", body);
  return r.data;
}

/** Coupon codes are upper case, without spaces. */
export const normaliseCoupon = (code: string): string => code.replace(/\s+/g, "").toUpperCase();

/** Why a coupon code cannot be sent yet, or null. */
export function couponProblem(code: string): string | null {
  const c = normaliseCoupon(code);
  if (!c) return t("billing.errors.codeEmpty", "Enter the code from your coupon.");
  if (!/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(c)) return t("billing.errors.codeFormat", "A code has 4 to 32 letters, digits or dashes.");
  return null;
}

/** The workspace's usage summary. A missing function never retries; the clock reads it again at its pace. */
export function useBillingSummary(workspaceId: string | null | undefined): UseQueryResult<BillingSummary> {
  const client = useQueryClient();
  const key = billingKeys.summary(workspaceId ?? "none");
  return useQuery({
    queryKey: key,
    queryFn: () => fetchBillingSummary(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: USAGE_STALE_MS,
    retry: (count, e) => count < 1 && !isBillingMissing(e),
    // the pace follows the latest summary: every render (each new summary re-renders) sets it again
    meta: liveEvery(summaryPace(client.getQueryData<BillingSummary>(key))),
  });
}

/** The live clock's pace for a summary on screen: fast while an engine job of the workspace runs. */
export function summaryPace(s: BillingSummary | undefined): number {
  return usagePace(Boolean(s && (s.activeAgents > 0 || s.runningJobs > 0)));
}

/** What one job has cost so far (null: nothing charged yet). It never polls on its own: it follows the workspace's
 *  summary (the same query the pills show, no extra read), and is read again whenever the summary's used credit or
 *  tokens change (a lane's charge landed: the job's entry is part of that sum, so both figures move in the same tick),
 *  when a job starts or ends, and on mount. */
export function useJobUsage(workspaceId: string | null | undefined, jobId: string | null | undefined): UseQueryResult<JobUsageView | null> {
  const summary = useBillingSummary(workspaceId);
  return useQuery({
    queryKey: [...billingKeys.job(workspaceId ?? "none", jobId ?? "none"), summaryVersion(summary.data)],
    queryFn: async () => (await fetchJobUsage(workspaceId as string, [jobId as string])).find((j) => j.jobId === jobId) ?? null,
    enabled: Boolean(workspaceId && jobId),
    staleTime: FRESHNESS_MS.calm.busy,
    placeholderData: sameJobPlaceholder(jobId),
    retry: (count, e) => count < 1 && !isBillingMissing(e),
  });
}

/** While a job's next figure loads its last one stays; another job's figure is never shown for it. */
export function sameJobPlaceholder(jobId: string | null | undefined) {
  return <T>(prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }): T | undefined =>
    jobId && prevQuery?.queryKey[5] === jobId ? prev : undefined;
}

/** What changes when a charge lands in the workspace: its used credit and tokens ("" before the summary is read). */
export function summaryVersion(s: BillingSummary | undefined): string {
  return s ? `${s.tokens}:${s.consumedUsd}` : "";
}

export function useBillingPlans(enabled: boolean): UseQueryResult<BillingPlan[]> {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: () => fetchBillingPlans(),
    enabled,
    ...freshnessQuery("calm"),
    retry: (count, e) => count < 1 && !isBillingMissing(e),
  });
}

export function useRedeemCoupon(workspaceId: string | null | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => redeemCoupon(workspaceId as string, code),
    onSuccess: () => client.invalidateQueries({ queryKey: billingKeys.summary(workspaceId ?? "none") }),
  });
}

export function useRequestPurchase(workspaceId: string | null | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: { planKey: string; note?: string } | { amountUsd: number; note?: string }) =>
      requestPurchase({ workspaceId: workspaceId as string, ...a } as PurchaseRequestArgs),
    onSuccess: () => client.invalidateQueries({ queryKey: billingKeys.summary(workspaceId ?? "none") }),
  });
}
