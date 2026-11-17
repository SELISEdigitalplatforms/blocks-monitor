/** 06 · The close: "Your next release, verified.", slow light on the page canvas (no band, no panel), one action. Then the
 *  footer. */
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUp, KeyRound } from "lucide-react";
import { SamplesMenu } from "@/components/hero/SamplesMenu";
import { PRODUCT } from "@/data/facts";
import { useT } from "@/i18n";
import { Logo } from "@/ui/Shell";
import { Container, rich } from "./parts";
import { Reveal, scrollToTop } from "./motion";

export function Closing() {
  const t = useT();
  return (
      <section aria-labelledby="cta-title" className="lp-sec relative isolate overflow-hidden text-ink">
        <div aria-hidden className="lp-aurora pointer-events-none absolute -inset-[15%] -z-10" />
        {/* the light fades into the canvas at the top and bottom: no band, no edge */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(var(--c-canvas))_0%,transparent_28%,transparent_72%,rgb(var(--c-canvas))_100%)]" />
        <Container className="flex flex-col items-center py-24 text-center md:py-32">
          <Reveal><Logo size={60} /></Reveal>
          <Reveal delay={100}>
            <h2 id="cta-title" className="mt-10 text-[clamp(2.6rem,4.6vw,5.5rem)] font-medium leading-[0.96] tracking-[-0.045em] [text-wrap:balance]">
              {rich(t("landing.closing.title", "Your next release, verified. {glow}"), {
                glow: <span className="lp-glow-text">{t("landing.closing.titleGlow", "Live on SELISE Blocks.")}</span>,
              })}
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <p className="mx-auto mt-6 max-w-[560px] text-[clamp(1.05rem,1.15vw,1.25rem)] leading-relaxed text-ink2 [text-wrap:balance]">
              {t("landing.closing.lede", "Nothing to install. Open a browser, describe what you need, and watch it go from brief to production.")}
            </p>
          </Reveal>
          <Reveal delay={300} className="mt-11 flex flex-wrap items-center justify-center gap-3">
            <Link to="/sign-in"
              className="lp-accent-lift group inline-flex h-12 items-center gap-2 rounded-full bg-accent pl-6 pr-5 text-[15px] font-medium text-white shadow-[0_14px_50px_-12px_rgb(var(--c-accent)/0.9)] transition hover:bg-accent-hover">
              {t("landing.cta.startBuilding", "Start building")}
              <ArrowRight size={18} strokeWidth={1.75} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button type="button" onClick={scrollToTop}
              className="lp-ghost inline-flex h-12 items-center gap-2 rounded-full bg-ink/[0.06] pl-6 pr-5 text-[15px] font-medium text-ink ring-1 ring-ink/15 transition hover:bg-ink/[0.1]">
              {t("landing.closing.backToTop", "Back to the top")}
              <ArrowUp size={18} strokeWidth={1.75} />
            </button>
          </Reveal>
          <Reveal delay={380}>
            <p className="mt-10 flex items-center gap-2 text-[13px] text-ink3">
              <KeyRound size={14} strokeWidth={1.75} /> {t("landing.closing.sso", "Single sign-on with Blocks IAM.")}
            </p>
          </Reveal>
        </Container>
      </section>
  );
}

export function ClosingFooter() {
  const t = useT();
  return (
    <>
      {/* one row where the three groups fit (the samples menu exactly in the middle), a centred stack below */}
      <footer className="lp-sec">
        <Container className="flex flex-col items-center gap-5 py-9 text-[13px] text-ink3 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex items-center gap-3 whitespace-nowrap xl:justify-self-start">
            <Logo size={30} />
            <span className="font-medium text-ink">{PRODUCT}</span>
            <span className="hidden sm:inline">{t("landing.common.tagline", "Autonomous software factory")}</span>
          </div>
          <SamplesMenu />
          <div className="flex flex-wrap items-center justify-center gap-4 xl:col-start-3 xl:justify-self-end">
            <span>{t("landing.footer.builtOn", "Built on SELISE Blocks")}</span>
            <span>© {new Date().getFullYear()} SELISE</span>
          </div>
        </Container>
      </footer>
    </>
  );
}
