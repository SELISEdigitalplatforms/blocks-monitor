// The words and figures of the pricing page (the landing page's Pricing section and /pricing), all from the public plan
// fields, so a plan reads the same here as in Settings: prices and credit as "USD 199", one line per fact.
import type { Assisted } from "@/domain/billing";
import type { PublicPlan } from "@/domain/publicPlans";
import { getCulture, t } from "@/i18n";

/** The plan shown as the one to look at first ("Most popular"): the first of these keys that is listed. */
export const FOCAL_PLAN_KEYS = ["speed", "classic"] as const;

export function focalKey(plans: readonly PublicPlan[]): string | null {
  for (const key of FOCAL_PLAN_KEYS) if (plans.some((p) => p.key === key && !p.contactSales)) return key;
  return null;
}

/** "199", "1,250", "12.50": whole dollars without cents, cents only when there are any (German, Switzerland: "1'250"). */
export function amount(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  const s = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return getCulture() === "de-CH" ? s.replace(/,/g, "'") : s;
}

/** The price as the card shows it: { currency: "USD", amount: "399" }, or null for contact sales. */
export function priceOf(p: Pick<PublicPlan, "priceUsd" | "contactSales">): { currency: string; amount: string } | null {
  if (p.contactSales || p.priceUsd === null) return null;
  return { currency: "USD", amount: amount(p.priceUsd) };
}

/** "USD 50 credit when you sign up" (Free), "USD 200 credit every month", "Credit agreed with you". */
export function creditLine(p: Pick<PublicPlan, "creditUsd" | "priceUsd" | "contactSales">): string {
  if (p.contactSales || p.priceUsd === null) return t("pricing.text.creditAgreed", "Credit agreed with you");
  if (p.priceUsd === 0) {
    return p.creditUsd > 0
      ? t("pricing.text.creditSignUp", "USD {amount} credit when you sign up", { amount: amount(p.creditUsd) })
      : t("pricing.text.noCredit", "No credit included");
  }
  return p.creditUsd > 0
    ? t("pricing.text.creditMonthly", "USD {amount} credit every month", { amount: amount(p.creditUsd) })
    : t("pricing.text.creditAsNeeded", "Credit bought as you need it");
}

/** Who helps besides the agents: a real person on the paid plans (each read in the chosen language when used). */
export const HELP_LINE: Record<Assisted, string> = {
  get none() { return t("pricing.help.none", "Self-serve, at your own pace"); },
  get "tech-lead"() { return t("pricing.help.techLead", "With a tech-lead consultant"); },
  get business() { return t("pricing.help.business", "With a business consultant"); },
  get dedicated() { return t("pricing.help.dedicated", "With a dedicated team"); },
};

/** "One build at a time", "5 builds in parallel", "Parallel builds to your needs". */
export function buildsLine(n: number | null): string {
  if (n === null) return t("pricing.text.buildsCustom", "Parallel builds to your needs");
  return n <= 1 ? t("pricing.text.buildsOne", "One build at a time") : t("pricing.text.buildsOther", "{count} builds in parallel", { count: n });
}

/** The queue words of each plan, by its rank among the listed plans' priorities (higher goes first). */
export function queueLines(plans: readonly Pick<PublicPlan, "key" | "priority">[]): Map<string, string> {
  const levels = [...new Set(plans.map((p) => p.priority))].sort((a, b) => a - b);
  const n = levels.length;
  const word = (i: number): string => {
    if (i === 0) return t("pricing.text.queueStandard", "Standard queue");
    if (i === n - 1) return t("pricing.text.queueHighest", "Highest priority in the queue");
    if (i === n - 2) return t("pricing.text.queueHigh", "High priority in the queue");
    return t("pricing.text.queueRaised", "Raised priority in the queue");
  };
  return new Map(plans.map((p) => [p.key, word(levels.indexOf(p.priority))]));
}

/** The card states credit, help, parallel builds and the queue from the plan's own fields; a feature line on one of those
 *  topics would say the same thing twice, so only the other lines are added below them. */
const STATED = [/\bcredit\b/i, /consultant|dedicated team|self[- ]serve/i, /parallel|side by side|at a time/i, /\bqueue\b|\bpriority\b/i];

export function extraFeatures(p: Pick<PublicPlan, "features">): string[] {
  return p.features.filter((f) => !STATED.some((t) => t.test(f)));
}

/** What a plan's button does: a link (sign up, or checkout when signed in), contact sales, or the plan already held. */
export type PlanAction =
  | { kind: "link"; to: string; label: string }
  | { kind: "sales"; label: string }
  | { kind: "current"; to: string; label: string };

export function planAction(p: Pick<PublicPlan, "key" | "name" | "priceUsd" | "contactSales">, o: { signedIn: boolean; currentKey?: string | null }): PlanAction {
  const plan = encodeURIComponent(p.key);
  if (o.signedIn && o.currentKey === p.key) return { kind: "current", to: "/billing", label: t("pricing.actions.manage", "Manage your plan") };
  if (p.contactSales || p.priceUsd === null) {
    // signed out, the request needs an account first: sign-up remembers the plan
    const label = t("pricing.actions.contactSales", "Contact sales");
    return o.signedIn ? { kind: "sales", label } : { kind: "link", to: `/sign-up?plan=${plan}`, label };
  }
  const choose = t("pricing.actions.choose", "Choose {plan}", { plan: p.name });
  if (!o.signedIn) return { kind: "link", to: `/sign-up?plan=${plan}`, label: p.priceUsd === 0 ? t("pricing.actions.startFree", "Start for free") : choose };
  return { kind: "link", to: `/billing/checkout?plan=${plan}`, label: p.priceUsd === 0 ? t("pricing.actions.switchTo", "Switch to {plan}", { plan: p.name }) : choose };
}

/** How credit works, in three short steps (in the chosen language). */
export function creditSteps(): { title: string; text: string }[] {
  return [
    {
      title: t("pricing.credit.step1Title", "Your plan brings credit"),
      text: t("pricing.credit.step1Text", "Free starts with credit when you sign up. Paid plans add their credit at the start of every month."),
    },
    {
      title: t("pricing.credit.step2Title", "The work spends it"),
      text: t("pricing.credit.step2Text", "The engine measures each piece of work the agents do, in tokens, and its cost is taken from your credit. Reading and reviewing cost nothing."),
    },
    {
      title: t("pricing.credit.step3Title", "You always see where you are"),
      text: t("pricing.credit.step3Text", "What you used and what is left are on screen, per project and per build, while the work runs."),
    },
  ];
}

/** The questions people ask before they choose (in the chosen language). */
export function pricingFaq(): { q: string; a: string }[] {
  return [
    {
      q: t("pricing.faq.usageQ", "What counts as usage?"),
      a: t("pricing.faq.usageA", "Only work the engine does for you: analysing, planning, building, testing and releasing. The engine measures each piece of work in tokens, the units its models count, and its cost is taken from your credit. Signing in, reading, reviewing and approving cost nothing."),
    },
    {
      q: t("pricing.faq.runOutQ", "What happens when my credit runs out?"),
      a: t("pricing.faq.runOutA", "You see it coming: the usage on screen tells you when credit runs low. When none is left, new work waits until credit is added, by redeeming a code or changing your plan. Work that is already running finishes, and nothing you made is lost."),
    },
    {
      q: t("pricing.faq.changeQ", "Can I change my plan?"),
      a: t("pricing.faq.changeA", "Yes, at any time. Moving up starts at once, with the new plan's credit. Moving down takes effect at your next renewal. You can also cancel at the end of the current period, and resume before it ends."),
    },
    {
      q: t("pricing.faq.payQ", "How do I pay?"),
      a: t("pricing.faq.payA", "Today with a code: a voucher from our sales team pays for your plan or adds credit, and you enter it at checkout. Card payments are being connected and will appear at checkout once they are ready."),
    },
  ];
}

/** "on Classic a tech-lead consultant": the person a plan brings, or null when it brings no consultant */
function consultantOn(p: Pick<PublicPlan, "name" | "assisted">): string | null {
  if (p.assisted === "tech-lead") return t("pricing.faq.techLeadOn", "on {plan} a tech-lead consultant", { plan: p.name });
  if (p.assisted === "business") return t("pricing.faq.businessOn", "on {plan} a business consultant", { plan: p.name });
  return null;
}

const both = (items: string, last: string) => t("pricing.faq.listAnd", "{items} and {last}", { items, last });

/** "Are the consultants real people?", answered from the listed plans (null when no plan brings one). */
export function consultantsFaq(plans: readonly Pick<PublicPlan, "name" | "assisted">[]): { q: string; a: string } | null {
  const people = plans.map(consultantOn).filter((s): s is string => s !== null);
  const team = plans.filter((p) => p.assisted === "dedicated").map((p) => p.name);
  if (people.length === 0 && team.length === 0) return null;
  const parts: string[] = [t("pricing.faq.consultantsYes", "Yes.")];
  if (people.length) {
    const joined = people.length === 1 ? people[0] : both(people.slice(0, -1).join(", "), people[people.length - 1]);
    const list = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
    parts.push(people.length === 1
      ? t("pricing.faq.peopleOne", "{list} works with you alongside the agents.", { list })
      : t("pricing.faq.peopleOther", "{list} work with you alongside the agents.", { list }));
  }
  if (team.length) {
    const plansText = team.reduce((a, b) => both(a, b));
    parts.push(team.length === 1
      ? t("pricing.faq.teamOne", "{plans} brings a dedicated team.", { plans: plansText })
      : t("pricing.faq.teamOther", "{plans} bring a dedicated team.", { plans: plansText }));
  }
  return { q: t("pricing.faq.consultantsQ", "Are the consultants real people?"), a: parts.join(" ") };
}
