/** 06 · Pricing: the plans (billing.plans.public through GET /api/public/plans; when it cannot be read, a plain "Plans
 *  couldn't be loaded" with Try again, never plans of the page's own),
 *  how credit works in three steps, and the questions people ask before they choose. The landing page's chapter
 *  (id "pricing", an h2) and the /pricing page (an h1) are this one section. */
import { useState } from "react";
import { Plus } from "lucide-react";
import type { PublicPlan } from "@/domain/publicPlans";
import { Container, Eyebrow, rich } from "@/components/landing/parts";
import { Reveal } from "@/components/landing/motion";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { ContactSalesDialog } from "./ContactSalesDialog";
import { PlanCards, PlanCardsLoading, PlansUnavailable } from "./PricingCards";
import { usePricingViewer, usePublicPlans, type PlansSource } from "./pricingData";
import { consultantsFaq, creditSteps, pricingFaq } from "./pricingText";

const TITLE_CLASS = "mt-6 text-[clamp(2.4rem,4.2vw,4.6rem)] font-medium leading-[1.0] tracking-[-0.04em] text-ink [text-wrap:balance]";

function Header({ level }: { level: 1 | 2 }) {
  const t = useT();
  const Title = level === 1 ? "h1" : "h2";
  return (
    <div className="max-w-[860px]">
      <Reveal><Eyebrow n="06">{t("pricing.header.eyebrow", "Pricing")}</Eyebrow></Reveal>
      <Reveal delay={80}>
        <Title id="pricing-title" className={TITLE_CLASS}>
          {rich(t("pricing.header.title", "Plans for every pace, {dim}"), {
            dim: <span className="lp-dim text-ink3">{t("pricing.header.titleDim", "credit included.")}</span>,
          })}
        </Title>
      </Reveal>
      <Reveal delay={160}>
        <p className="mt-6 max-w-[640px] text-[clamp(1.05rem,1.15vw,1.25rem)] leading-relaxed text-ink2 [text-wrap:pretty]">
          {t("pricing.header.lede", "Every plan comes with credit for the agents' work, measured by the engine and shown while it runs. The paid plans add a real person to your team.")}
        </p>
      </Reveal>
    </div>
  );
}

function CreditExplainer({ level }: { level: 1 | 2 }) {
  const t = useT();
  const Title = level === 1 ? "h2" : "h3";
  const Step = level === 1 ? "h3" : "h4";
  return (
    <section aria-labelledby="pricing-credit" className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <Reveal>
        <Title id="pricing-credit" className="text-[clamp(1.6rem,2.2vw,2.25rem)] font-medium leading-tight tracking-[-0.02em] text-ink">{t("pricing.credit.title", "How credit works")}</Title>
        <p className="mt-4 max-w-[440px] text-[16px] leading-relaxed text-ink2 [text-wrap:pretty]">
          {t("pricing.credit.text", "Plans are per organization, never per seat. Credit is the one measure of the work, and you see it wherever work happens.")}
        </p>
      </Reveal>
      <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-3">
        {creditSteps().map((s, i) => (
          <Reveal as="li" key={s.title} delay={80 + i * 80} className="border-t border-line pt-5">
            <span className="num font-mono text-[12px] font-medium tracking-[0.16em] text-[rgb(var(--c-accent-text))]">{String(i + 1).padStart(2, "0")}</span>
            <Step className="mt-3 text-[17px] font-medium tracking-tight text-ink">{s.title}</Step>
            <p className="mt-2 text-[15px] leading-relaxed text-ink2 [text-wrap:pretty]">{s.text}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

function Faq({ plans, level }: { plans: readonly PublicPlan[]; level: 1 | 2 }) {
  const t = useT();
  const Title = level === 1 ? "h2" : "h3";
  const people = consultantsFaq(plans);
  const faq = pricingFaq();
  const items = people ? [...faq, people] : faq;
  return (
    <section aria-labelledby="pricing-faq" className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <Reveal>
        <Title id="pricing-faq" className="text-[clamp(1.6rem,2.2vw,2.25rem)] font-medium leading-tight tracking-[-0.02em] text-ink">{t("pricing.faq.title", "Questions before you choose")}</Title>
      </Reveal>
      <Reveal delay={80}>
        <div className="border-t border-line">
          {items.map((item) => (
            <details key={item.q} className="group border-b border-line">
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-4 text-[17px] font-medium text-ink outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3 transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <p className="max-w-[640px] pb-6 pr-10 text-[15px] leading-relaxed text-ink2 [text-wrap:pretty]">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/** What the plans part shows: the cards' places while the first read runs, the catalogue's plans, or that there are
 *  none to show (it could not be read, or lists none). */
export function plansState(o: { ready: boolean; source: PlansSource; count: number }): "loading" | "live" | "empty" | "unavailable" {
  if (!o.ready) return "loading";
  if (o.source !== "live") return "unavailable";
  return o.count > 0 ? "live" : "empty";
}

/** The section's content for given plans and viewer (pure: rendered as is in the tests). */
export function PricingView({ plans, ready, source, signedIn, currentKey, level = 2, onContactSales, onRetry, retrying = false }: {
  plans: readonly PublicPlan[]; ready: boolean; source: PlansSource; signedIn: boolean; currentKey: string | null;
  level?: 1 | 2; onContactSales?: (plan: PublicPlan) => void; onRetry?: () => void; retrying?: boolean;
}) {
  const t = useT();
  const state = plansState({ ready, source, count: plans.length });
  return (
    <section id="pricing" aria-labelledby="pricing-title" tabIndex={-1} data-plans-source={state}
      className={cn("lp-sec relative scroll-mt-24 outline-none", level === 1 ? "pb-20 pt-36 md:pb-28 md:pt-44" : "py-20 md:py-28 xl:py-32")}>
      <Container>
        <Header level={level} />
        {/* the plans hold the page's primary action (the focal plan's button): while they are on screen the landing page's
            bar steps its own Start building back (LandingView); without plans there is none here */}
        <div className="mt-14 md:mt-16" data-primary-cta={state === "live" ? true : undefined}>
          <Reveal delay={200}>
            {state === "loading" ? <PlanCardsLoading count={4} />
              : state === "live" ? <PlanCards plans={plans} signedIn={signedIn} currentKey={currentKey} headingLevel={level === 1 ? 2 : 3} onContactSales={onContactSales} />
                : <PlansUnavailable empty={state === "empty"} retrying={retrying} onRetry={onRetry} />}
          </Reveal>
        </div>
        {state === "live" && <p className="mt-6 text-[13px] text-ink3">{t("pricing.section.note", "Prices in US dollars per month. Nothing is charged before you confirm at checkout.")}</p>}
        <div className="mt-24 space-y-24 md:mt-32 md:space-y-28">
          <CreditExplainer level={level} />
          <Faq plans={plans} level={level} />
        </div>
      </Container>
    </section>
  );
}

/** The Pricing chapter with its data: the public plans, who is looking, and Contact sales for a signed-in person. */
export function PricingSection({ level = 2 }: { level?: 1 | 2 }) {
  const { plans, ready, source, retrying, retry } = usePublicPlans();
  const { signedIn, currentKey } = usePricingViewer();
  const [sales, setSales] = useState<PublicPlan | null>(null);
  return (
    <>
      <PricingView plans={plans} ready={ready} source={source} signedIn={signedIn} currentKey={currentKey} level={level} onContactSales={setSales}
        onRetry={retry} retrying={retrying} />
      {signedIn && <ContactSalesDialog plan={sales} onClose={() => setSales(null)} />}
    </>
  );
}
