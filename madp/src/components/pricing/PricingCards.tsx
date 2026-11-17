/** The plan cards of the pricing page: Free, Classic, Speed and Enterprise (whatever the catalogue lists), one of them the
 *  focal plan ("Most popular": the accent ring, the raised surface and the one accent button). Each card: the name and the
 *  person who helps, the price per month and the credit it brings, one action, then parallel builds, the queue and the
 *  plan's other lines. One column on a phone, two on a tablet, four from 1280 px. */
import { Link } from "react-router-dom";
import { ArrowRight, Check, RotateCw } from "lucide-react";
import type { PublicPlan } from "@/domain/publicPlans";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { HELP_LINE, buildsLine, creditLine, extraFeatures, focalKey, planAction, priceOf, queueLines, type PlanAction } from "./pricingText";

const ACTION_BASE = "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const ACTION_PRIMARY = "lp-accent-lift bg-accent text-white hover:bg-accent-hover";
const ACTION_SECONDARY = "lp-ghost bg-ink/[0.06] text-ink ring-1 ring-ink/15 hover:bg-ink/[0.1]";

function PlanButton({ action, plan, focal, onContactSales }: { action: PlanAction; plan: PublicPlan; focal: boolean; onContactSales?: (plan: PublicPlan) => void }) {
  const cls = cn(ACTION_BASE, focal ? ACTION_PRIMARY : ACTION_SECONDARY);
  const label = action.label;
  const arrow = <ArrowRight size={17} strokeWidth={1.75} aria-hidden className="transition-transform group-hover:translate-x-0.5" />;
  if (action.kind === "sales") {
    return (
      <button type="button" className={cls} onClick={() => onContactSales?.(plan)} aria-haspopup="dialog">
        {label}{arrow}
      </button>
    );
  }
  return (
    <Link to={action.to} className={cls} data-plan-action={action.kind}>
      {label}{action.kind === "link" && arrow}
    </Link>
  );
}

export function PlanCard({ plan, focal, queue, signedIn, currentKey, headingLevel = 3, onContactSales }: {
  plan: PublicPlan; focal: boolean; queue: string; signedIn: boolean; currentKey: string | null;
  headingLevel?: 2 | 3; onContactSales?: (plan: PublicPlan) => void;
}) {
  const t = useT();
  const Name = headingLevel === 2 ? "h2" : "h3";
  const price = priceOf(plan);
  const action = planAction(plan, { signedIn, currentKey });
  const lines = [buildsLine(plan.maxParallelStreams), queue, ...extraFeatures(plan)];
  const titleId = `plan-${plan.key}-name`;
  return (
    <article aria-labelledby={titleId} data-plan={plan.key} data-focal={focal || undefined}
      className={cn("relative flex h-full min-w-0 flex-col rounded-card bg-surface p-6 md:p-7",
        // the focal plan's edge is an outline: the daylight finish of lp-panel (landing.css) owns the box-shadow, where a ring would be lost
        focal ? "lp-panel shadow-float outline outline-2 outline-accent dark:border dark:border-transparent" : "lp-card shadow-card dark:border dark:border-line")}>
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Name id={titleId} className="text-[20px] font-medium tracking-[-0.01em] text-ink">{plan.name}</Name>
        {action.kind === "current" ? (
          <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-line">{t("pricing.cards.yourPlan", "Your plan")}</span>
        ) : focal && <span className="rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-white">{t("pricing.cards.mostPopular", "Most popular")}</span>}
      </div>
      {/* room for two lines on every card, so the prices line up across the row */}
      <p className="mt-2 text-[15px] leading-snug text-ink2 sm:min-h-[42px]">{HELP_LINE[plan.assisted]}</p>

      <div className="mt-6">
        {price ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5" aria-label={t("pricing.cards.pricePerMonth", "{currency} {amount} per month", { currency: price.currency, amount: price.amount })}>
            <span className="text-[15px] font-medium text-ink2">{price.currency}</span>
            <span className="num text-[clamp(2.6rem,3.4vw,3.4rem)] font-medium leading-none tracking-[-0.04em] text-ink">{price.amount}</span>
            <span className="text-[15px] text-ink3">{t("pricing.cards.perMonth", "/ month")}</span>
          </p>
        ) : (
          <p className="text-[clamp(2.6rem,3.4vw,3.4rem)] font-medium leading-none tracking-[-0.04em] text-ink">{t("pricing.cards.custom", "Custom")}</p>
        )}
        <p className="num mt-3 text-[14px] text-ink2">{creditLine(plan)}</p>
      </div>

      <div className="mt-7">
        <PlanButton action={action} plan={plan} focal={focal} onContactSales={onContactSales} />
      </div>

      <ul className="mt-7 space-y-3 border-t border-line pt-6 text-[15px] leading-snug text-ink2">
        {lines.map((line) => (
          <li key={line} className="num flex items-start gap-3">
            <Check size={16} strokeWidth={2} aria-hidden className={cn("mt-[3px] shrink-0", focal ? "text-[rgb(var(--c-accent-text))]" : "text-ink3")} />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PlanCards({ plans, signedIn, currentKey, headingLevel = 3, onContactSales }: {
  plans: readonly PublicPlan[]; signedIn: boolean; currentKey: string | null; headingLevel?: 2 | 3; onContactSales?: (plan: PublicPlan) => void;
}) {
  const t = useT();
  const focal = focalKey(plans);
  const queue = queueLines(plans);
  return (
    <div className={cn("grid items-stretch gap-4 md:gap-5", plans.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : plans.length === 3 ? "md:grid-cols-3" : "sm:grid-cols-2")}>
      {plans.map((p) => (
        <PlanCard key={p.key} plan={p} focal={p.key === focal} queue={queue.get(p.key) ?? t("pricing.text.queueStandard", "Standard queue")}
          signedIn={signedIn} currentKey={currentKey} headingLevel={headingLevel} onContactSales={onContactSales} />
      ))}
    </div>
  );
}

/** While the first read runs: the cards' places, quietly hatched (no spinner, nothing that moves). */
export function PlanCardsLoading({ count = 4 }: { count?: number }) {
  const t = useT();
  return (
    <div role="status" className="grid gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-4">
      <span className="sr-only">{t("pricing.cards.loading", "Loading the plans")}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="lp-card lp-hatch h-[480px] rounded-card bg-surface/60 dark:border dark:border-line" />
      ))}
    </div>
  );
}

/** When the catalogue could not be read, or lists no plan: says so plainly and offers to read it again. Never plans or
 *  prices of the page's own. */
export function PlansUnavailable({ empty, retrying, onRetry }: { empty: boolean; retrying: boolean; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="status" data-plans-unavailable={empty ? "empty" : "unavailable"}
      className="lp-card flex flex-col items-start gap-5 rounded-card bg-surface p-6 shadow-card dark:border dark:border-line md:flex-row md:items-center md:justify-between md:p-8">
      <div className="min-w-0 max-w-[560px]">
        <p className="text-[20px] font-medium tracking-[-0.01em] text-ink">
          {empty ? t("pricing.cards.emptyTitle", "No plans are offered right now") : t("pricing.cards.unavailableTitle", "Plans couldn't be loaded")}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink2 [text-wrap:pretty]">
          {empty
            ? t("pricing.cards.emptyText", "The plans and their prices aren't published yet. Look again in a moment.")
            : t("pricing.cards.unavailableText", "We couldn't read the plans and their prices just now. Try again in a moment.")}
        </p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}
          className={cn(ACTION_BASE, ACTION_SECONDARY, "w-auto shrink-0 disabled:cursor-default disabled:opacity-60")}>
          <RotateCw size={17} strokeWidth={1.75} aria-hidden className={cn(retrying && "motion-safe:animate-spin")} />
          {retrying ? t("pricing.cards.retrying", "Trying again…") : t("pricing.cards.retry", "Try again")}
        </button>
      )}
    </div>
  );
}
