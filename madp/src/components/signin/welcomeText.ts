// What the welcome says about the organization's plan and credit: read from its billing summary (the same billing.summary
// query as the credit pill), never assumed. Nothing plan-specific is said before the summary is known.
import { t } from "@/i18n";
import type { BillingSummary } from "@/components/billing/types";
import { creditState, leftUsd, planName, usd } from "@/components/billing/usageText";

/** The line about plan and credit, or null while the summary is not known (or says neither a plan nor any credit). */
export function welcomePlanLine(s: BillingSummary | null | undefined): string | null {
  if (!s) return null;
  const hasCredit = creditState(s) !== "out";
  const amount = usd(leftUsd(s));
  if (s.plan) {
    const plan = planName(s.plan.name);
    return hasCredit
      ? t("auth.welcome.planCredit", "Your organization is ready on the {plan}, with {amount} of credit to start.", { plan, amount })
      : t("auth.welcome.planNoCredit", "Your organization is on the {plan} and has no credit yet.", { plan });
  }
  return hasCredit ? t("auth.welcome.credit", "Your organization has {amount} of credit to start.", { amount }) : null;
}

/** The welcome's text: the plan and credit line when known, then what to do first. */
export function welcomeText(s: BillingSummary | null | undefined): string {
  const start = t("auth.welcome.start", "Describe what you want built and the team takes it from there.");
  const line = welcomePlanLine(s);
  return line ? `${line} ${start}` : start;
}
