// The words and figures every usage surface shares (the pill, its breakdown, the account menu line and the Plan and
// usage card), so the same fact reads the same everywhere.
import { getCulture, t } from "@/madp/i18n";
import type { Assisted, BillingPlan, BillingSummary } from "./types";

/** "12.40": two decimals, thousands grouped. */
export function money(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "USD 12.40" */
export const usd = (v: number): string => `USD ${money(v)}`;

/** "Classic plan", "Free plan" (a name that already says plan keeps it). */
export const planName = (name: string): string => (/\bplan$/i.test(name) ? name : t("billing.creditPill.planName", "{name} plan", { name }));

/** A whole price: "USD 199" (cents only when there are any). */
export function price(v: number): string {
  return Number.isInteger(v) ? `USD ${v.toLocaleString("en-US")}` : usd(v);
}

/** "830 tokens", "48,200 tokens", "1.24 million tokens". */
export function tokensText(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v >= 1_000_000) return t("billing.usage.tokensMillion", "{n} million tokens", { n: (v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) });
  return v === 1 ? t("billing.usage.tokensOne", "{n} token", { n: "1" }) : t("billing.usage.tokensMany", "{n} tokens", { n: v.toLocaleString("en-US") });
}

/** "1 agent working", "4 agents working", "No agents working". */
export function agentsText(n: number): string {
  if (n <= 0) return t("billing.usage.agentsNone", "No agents working");
  return n === 1 ? t("billing.usage.agentsOne", "{n} agent working", { n }) : t("billing.usage.agentsMany", "{n} agents working", { n });
}

/** "1 job running", "3 jobs running". */
export function jobsText(n: number): string {
  return n === 1 ? t("billing.usage.jobsOne", "{n} job running", { n }) : t("billing.usage.jobsMany", "{n} jobs running", { n });
}

/** Below this share of the granted credit, or this many dollars, the credit is low. */
export const LOW_CREDIT_SHARE = 0.2;
export const LOW_CREDIT_USD = 5;

export type CreditState = "ok" | "low" | "out";

export function creditState(s: Pick<BillingSummary, "balanceUsd" | "grantedUsd">): CreditState {
  if (s.balanceUsd <= 0.005) return "out";
  if (s.balanceUsd < LOW_CREDIT_USD || (s.grantedUsd > 0 && s.balanceUsd / s.grantedUsd < LOW_CREDIT_SHARE)) return "low";
  return "ok";
}

/** The credit that is left, never below zero (an overdraft reads as none left). */
export const leftUsd = (s: Pick<BillingSummary, "balanceUsd">): number => Math.max(0, s.balanceUsd);

/** The share of the granted credit used, 0–100 (0 without a grant). */
export function usedShare(s: Pick<BillingSummary, "consumedUsd" | "grantedUsd">): number {
  if (s.grantedUsd <= 0) return 0;
  return Math.min(100, Math.max(0, (s.consumedUsd / s.grantedUsd) * 100));
}

/** What was used: this month when the function says (the usual case), else everything so far. */
export function usedOf(s: BillingSummary): { usd: number; tokens: number; label: string } {
  return typeof s.monthUsedUsd === "number"
    ? { usd: s.monthUsedUsd, tokens: s.monthTokens ?? 0, label: t("billing.usage.usedThisMonth", "Used this month") }
    : { usd: s.consumedUsd, tokens: s.tokens, label: t("billing.usage.usedSoFar", "Used so far") };
}

/** The pill: "USD 12.40 used · 37.60 left · 4 agents working". */
export function pillText(s: BillingSummary): string {
  return t("billing.usage.pill", "{used} used · {left} left · {agents}", { used: usd(usedOf(s).usd), left: money(leftUsd(s)), agents: agentsText(s.activeAgents) });
}

/** "Your request for Classic waits for approval." for the workspace's pending requests (plan names from the list). */
export function pendingText(s: BillingSummary, planName: (key: string) => string = (k) => k.charAt(0).toUpperCase() + k.slice(1)): string | null {
  const p = s.pendingRequests ?? [];
  if (p.length === 0) return null;
  const first = p[0];
  const more = p.length - 1;
  if (first.planKey) {
    const plan = planName(first.planKey);
    return more === 0
      ? t("billing.usage.pendingPlan", "Your request for the {plan} plan waits for a platform administrator.", { plan })
      : t("billing.usage.pendingPlanMore", "Your request for the {plan} plan and {more} more wait for a platform administrator.", { plan, more });
  }
  if (first.amountUsd !== null) {
    const amount = usd(first.amountUsd);
    return more === 0
      ? t("billing.usage.pendingAmount", "Your request for {amount} of credit waits for a platform administrator.", { amount })
      : t("billing.usage.pendingAmountMore", "Your request for {amount} of credit and {more} more wait for a platform administrator.", { amount, more });
  }
  return more === 0
    ? t("billing.usage.pendingCredit", "Your request for credit waits for a platform administrator.")
    : t("billing.usage.pendingCreditMore", "Your request for credit and {more} more wait for a platform administrator.", { more });
}

/** "Next credit on 1 Dec 2026" from the subscription's renewal date. */
export function renewsText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = getCulture() === "de-CH"
    ? d.toLocaleDateString("de-CH", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return t("billing.usage.nextCredit", "Next credit on {date}", { date });
}

/** The account menu's line: "Credit: USD 37.60 left" (or that none is left). */
export function creditLine(s: BillingSummary): string {
  return creditState(s) === "out"
    ? t("billing.creditMenu.noneLeft", "Credit: none left")
    : t("billing.creditMenu.left", "Credit: {amount} left", { amount: usd(leftUsd(s)) });
}

/** What the low and out states say, and the one next step. */
export function creditNotice(s: BillingSummary): { title: string; text: string } | null {
  const state = creditState(s);
  if (state === "out") {
    return {
      title: t("billing.usage.outTitle", "Your credit is used up"),
      text: t("billing.usage.outText", "New work waits until credit is added. Redeem a coupon or change your plan; work already running finishes."),
    };
  }
  if (state === "low") {
    return {
      title: t("billing.usage.lowTitle", "Your credit is running low"),
      text: t("billing.usage.lowText", "{amount} left. Add credit before the next build: redeem a coupon or change your plan.", { amount: usd(leftUsd(s)) }),
    };
  }
  return null;
}

/** "Self-serve", "With a business consultant", … in the current language. */
export function assistedText(a: Assisted): string {
  switch (a) {
    case "none": return t("billing.usage.assistedNone", "Self-serve");
    case "tech-lead": return t("billing.usage.assistedTechLead", "With a tech-lead consultant");
    case "business": return t("billing.usage.assistedBusiness", "With a business consultant");
    case "dedicated": return t("billing.usage.assistedDedicated", "Dedicated team");
  }
  return a;
}

/** The same labels by key, read when used (each lookup is in the current language). Prefer assistedText(). */
export const ASSISTED_TEXT: Record<Assisted, string> = Object.defineProperties({} as Record<Assisted, string>, {
  none: { enumerable: true, get: () => assistedText("none") },
  "tech-lead": { enumerable: true, get: () => assistedText("tech-lead") },
  business: { enumerable: true, get: () => assistedText("business") },
  dedicated: { enumerable: true, get: () => assistedText("dedicated") },
});

/** "1 parallel stream", "5 parallel streams", "Custom parallel streams". */
export function streamsText(n: number | null): string {
  if (n === null) return t("billing.usage.streamsCustom", "Custom parallel streams");
  return n === 1 ? t("billing.usage.streamsOne", "{n} parallel stream", { n }) : t("billing.usage.streamsMany", "{n} parallel streams", { n });
}

/** A plan card's short line under its name (the plan's own help and what sets it apart). */
export function planTagline(p: Pick<BillingPlan, "key" | "assisted" | "contactSales" | "maxParallelStreams">): string {
  if (p.contactSales) return t("billing.usage.taglineCustom", "{help} · built to your needs", { help: assistedText(p.assisted) });
  if (p.key === "speed" || (p.assisted === "business" && (p.maxParallelStreams ?? 0) > 2)) return t("billing.usage.taglineSpeed", "With a business consultant · more parallel streams · priority");
  return assistedText(p.assisted);
}

/** "USD 199 / month", "USD 0 / month", or null for contact sales. */
export function planPriceText(p: Pick<BillingPlan, "priceUsd" | "contactSales">): string | null {
  if (p.contactSales || p.priceUsd === null) return null;
  return t("billing.usage.pricePerMonth", "{price} / month", { price: price(p.priceUsd) });
}

/** "USD 200 credit per month", "USD 50 credit when you sign up", "Custom credit". */
export function planCreditText(p: Pick<BillingPlan, "creditUsd" | "priceUsd" | "contactSales">): string {
  if (p.contactSales || p.creditUsd === null) return t("billing.usage.creditCustom", "Custom credit");
  return p.priceUsd === 0
    ? t("billing.usage.creditSignUp", "{amount} credit when you sign up", { amount: price(p.creditUsd) })
    : t("billing.usage.creditPerMonth", "{amount} credit per month", { amount: price(p.creditUsd) });
}

/** The prefilled message of a contact-sales request. */
export function contactSalesDraft(workspace: string | null, plan = "Enterprise"): string {
  return [
    workspace
      ? t("billing.usage.salesDraftIntroFor", "We would like to talk about the {plan} plan for {workspace}.", { plan, workspace })
      : t("billing.usage.salesDraftIntro", "We would like to talk about the {plan} plan.", { plan }),
    t("billing.usage.salesDraftTeam", "Team size: "),
    t("billing.usage.salesDraftProjects", "Projects we plan to build: "),
    t("billing.usage.salesDraftTime", "Best time to reach us: "),
  ].join("\n");
}

/** The longest contact-sales note billing.requestPurchase keeps. */
export const NOTE_MAX = 500;
