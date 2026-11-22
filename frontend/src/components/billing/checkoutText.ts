// The words of checkout and the Billing page: dates, money and the lines of an order summary, from the server's answer.
import type { CheckoutView, PaymentView, SubscriptionView } from "@/domain/payments";
import { getCulture, t } from "@/i18n";
import { assistedText } from "./usageText";

/** "1 December 2026" ("1.12.2026" in German) (UTC, so a renewal day reads the same everywhere); "" for no date. */
export function dayText(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  if (getCulture() === "de-CH") return new Date(iso).toLocaleDateString("de-CH", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "USD 199.00". */
export function money(usd: number): string {
  return `USD ${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Builds one change at a time" / "Builds 5 changes in parallel" / "Parallel builds to your needs". */
export function buildsText(n: number | null): string {
  if (n === null) return t("billing.checkout.buildsCustom", "Parallel builds to your needs");
  return n <= 1 ? t("billing.checkout.buildsOne", "One build at a time") : t("billing.checkout.buildsMany", "{n} builds in parallel", { n });
}

export interface SummaryLine {
  label: string;
  value: string;
  tone?: "credit" | "discount" | "total";
}

/** The order summary: what the plan brings, then what is due today. */
export function summaryLines(c: CheckoutView): { plan: SummaryLine[]; money: SummaryLine[] } {
  const plan: SummaryLine[] = [
    { label: t("billing.checkout.price", "Price"), value: t("billing.checkout.perMonth", "{amount} a month", { amount: money(c.plan.priceUsd ?? 0) }) },
    { label: t("billing.checkout.creditIncluded", "Credit included"), value: t("billing.checkout.perMonth", "{amount} a month", { amount: money(c.plan.creditUsd) }) },
    { label: t("billing.checkout.help", "Help"), value: assistedText(c.plan.assisted) },
    { label: t("billing.checkout.builds", "Builds"), value: buildsText(c.plan.maxParallelStreams) },
    { label: t("billing.checkout.renewsOn", "Renews on"), value: dayText(c.renewsOn) },
  ];
  const lines: SummaryLine[] = [];
  if (c.kind === "upgrade" && c.fromPlan && !(c.code?.kind === "plan")) {
    lines.push({ label: t("billing.checkout.upgradeRest", "From {from} to {plan}, rest of this period", { from: c.fromPlan.name, plan: c.plan.name }), value: money(c.amountUsd) });
  } else lines.push({ label: t("billing.checkout.firstMonth", "{plan}, first month", { plan: c.plan.name }), value: money(c.amountUsd) });
  if (c.discountUsd > 0) lines.push({ label: c.code ? t("billing.checkout.codeLabel", "Code {code}", { code: c.code.code }) : t("billing.checkout.discount", "Discount"), value: `− ${money(c.discountUsd)}`, tone: "discount" });
  lines.push({ label: t("billing.checkout.dueToday", "Due today"), value: money(c.dueUsd), tone: "total" });
  if (c.creditUsd > 0) lines.push({ label: t("billing.checkout.creditAddedNow", "Credit added now"), value: money(c.creditUsd), tone: "credit" });
  return { plan, money: lines };
}

/** The sentence under "Due today". */
export function dueSentence(c: CheckoutView): string {
  if (c.dueUsd === 0 && c.paidThrough) return t("billing.checkout.dueNothingCode", "Nothing to pay today. Your code pays the {plan} plan until {date}.", { plan: c.plan.name, date: dayText(c.paidThrough) });
  if (c.dueUsd === 0) return t("billing.checkout.dueNothing", "Nothing to pay today.");
  if (c.blocker) return c.blocker;
  return t("billing.checkout.duePay", "You pay {amount} on the secure payment page.", { amount: money(c.dueUsd) });
}

/** The status of a plan in words, with its tone. */
export function subscriptionStatus(s: SubscriptionView): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (s.status === "past_due") return { label: t("billing.subscription.paymentDue", "Payment due"), tone: "danger" };
  if (s.cancelAtPeriodEnd) return { label: t("billing.subscription.endsOnRenewal", "Ends on renewal day"), tone: "warning" };
  if (s.nextPlan) return { label: t("billing.subscription.movesTo", "Moves to {plan}", { plan: s.nextPlan.name }), tone: "warning" };
  if (s.status === "active") return { label: t("billing.subscription.active", "Active"), tone: "success" };
  return { label: s.status === "pending" ? t("billing.subscription.waiting", "Waiting") : t("billing.subscription.ended", "Ended"), tone: "neutral" };
}

/** The line under the plan name: when it renews, ends or moves. */
export function renewalSentence(s: SubscriptionView): string {
  if (s.status === "past_due") return s.statusNote || t("billing.subscription.paymentDueSentence", "This plan's payment is due.");
  if (!s.renewsAt) return s.priceUsd ? "" : t("billing.subscription.freeNoRenewal", "Free has no renewal. Your credit stays until you use it.");
  if (s.cancelAtPeriodEnd) return t("billing.subscription.endsOn", "Ends on {date}. After that your organization is on Free; credit left stays.", { date: dayText(s.renewsAt) });
  if (s.nextPlan) return t("billing.subscription.movesOn", "Moves to {plan} on {date}.", { plan: s.nextPlan.name, date: dayText(s.renewsAt) });
  if (s.paidThrough && s.couponCode) return t("billing.subscription.renewsOnCode", "Renews on {date}. Your code pays it until {paidThrough}.", { date: dayText(s.renewsAt), paidThrough: dayText(s.paidThrough) });
  return t("billing.subscription.renewsOn", "Renews on {date}.", { date: dayText(s.renewsAt) });
}

/** "Classic, month from 1 November 2026". */
export function paymentLabel(p: PaymentView): string {
  const period = { plan: p.planName, from: dayText(p.periodStart), to: dayText(p.periodEnd) };
  if (p.kind === "upgrade") return t("billing.payments.upgradePeriod", "Upgrade to {plan}, {from} to {to}", period);
  if (p.kind === "renewal") return t("billing.payments.renewalPeriod", "{plan} renewal, {from} to {to}", period);
  return t("billing.payments.planPeriod", "{plan}, {from} to {to}", period);
}

/** How a payment was paid: "Code CLASSIC-3M", "Card", "Code CLASSIC-3M and card". */
export function paidWith(p: PaymentView): string {
  const card = p.paidUsd > 0;
  if (p.couponCode && card) return t("billing.payments.codeAndCard", "Code {code} and card", { code: p.couponCode });
  if (p.couponCode) return t("billing.checkout.codeLabel", "Code {code}", { code: p.couponCode });
  return card ? t("billing.payments.card", "Card") : t("billing.payments.nothingDue", "Nothing due");
}
