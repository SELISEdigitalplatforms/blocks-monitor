/** The floating top bar: transparent while the page rests at the top of the hero, a frosted pill as soon as it scrolls
 *  (so nothing ever slides under a clear bar), in the theme's colours either way. Its links mark the chapter in view.
 *  Its switch shows the current theme and changes the landing's own theme (dark by default), not the app's.
 *  On a page of its own (/pricing) the same bar links back to the landing page's chapters and marks its own one. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { PRODUCT } from "@/madp/data/facts";
import { t, useT } from "@/madp/i18n";
import { useDemo } from "@/madp/state/store";
import { cn } from "@/madp/lib/cn";
import { Logo } from "@/madp/ui/Shell";
import { LanguageSwitcher } from "@/madp/i18n/LanguageSwitcher";
import { scrollToId, scrollToTop } from "./motion";

/** the chapters in the bar; each label is read in the chosen language when it is used */
export const NAV_LINKS: readonly { id: string; readonly label: string }[] = [
  { id: "how", get label() { return t("landing.nav.how", "How it works"); } },
  { id: "line", get label() { return t("landing.nav.line", "The line"); } },
  { id: "proof", get label() { return t("landing.nav.proof", "Proof"); } },
  { id: "platform", get label() { return t("landing.nav.platform", "Platform"); } },
  { id: "pricing", get label() { return t("landing.nav.pricing", "Pricing"); } },
];

const PRICING_SHORT = "grid h-11 place-items-center rounded-full px-2.5 text-[14px] font-medium text-ink2 transition hover:bg-ink/[0.06] hover:text-ink lg:hidden";

/** the chapter that crosses the middle of the window (none over the hero, the problem and the close) */
function useCurrentSection(): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) setCurrent(e.target.id);
        else setCurrent((c) => (c === e.target.id ? null : c));
      }
    }, { rootMargin: "-50% 0px -49% 0px" });
    NAV_LINKS.forEach((l) => { const el = document.getElementById(l.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return current;
}

/** quiet: a primary Sign in of the page itself is on screen, so the bar's own steps back to a secondary pill.
 *  onHero: the hero still lies under the bar; the bar then always uses the dark tokens (data-theme="dark"), in light mode
 *  too, and follows the landing theme once the hero has scrolled away. */
export function Nav({ overHero, quiet, onHero, page }: {
  overHero: boolean; quiet: boolean; onHero: boolean;
  /** a page of its own (the chapter it shows, e.g. "pricing"): the links lead to the landing page's chapters */
  page?: string;
}) {
  const t = useT();
  const dark = useDemo((s) => s.landingTheme) === "dark";
  const inView = useCurrentSection();
  const current = page ?? inView;
  const themeLabel = dark ? t("landing.nav.themeDark", "Dark theme. Switch to light") : t("landing.nav.themeLight", "Light theme. Switch to dark");
  return (
    <header data-theme={onHero ? "dark" : undefined} className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-5 md:pt-6">
      <div className={cn("pointer-events-auto mx-auto flex h-[60px] w-[calc(100%-24px)] max-w-[1392px] items-center gap-4 rounded-full pl-3 pr-2 transition-[background-color,box-shadow,color] duration-500 md:w-[calc(100%-56px)] xl:w-[calc(100%-88px)]",
        overHero ? "bg-transparent text-ink" : "bg-surface/80 text-ink shadow-float ring-1 ring-line backdrop-blur-xl")}>
        {page ? (
          <Link to="/" className="flex items-center gap-3 rounded-full pr-2" aria-label={t("landing.nav.home", "{product}, home", { product: PRODUCT })}>
            <Logo size={38} />
            <span className="hidden text-[16px] font-medium tracking-tight sm:block">{PRODUCT}</span>
          </Link>
        ) : (
          <a href="#top" onClick={(e) => { e.preventDefault(); scrollToTop(); }}
            className="flex items-center gap-3 rounded-full pr-2" aria-label={t("landing.nav.backToTop", "{product}, back to top", { product: PRODUCT })}>
            <Logo size={38} />
            <span className="hidden text-[16px] font-medium tracking-tight sm:block">{PRODUCT}</span>
          </a>
        )}
        <nav aria-label={t("landing.nav.sections", "Sections")} className="mx-auto hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => {
            const cls = cn("rounded-full px-4 py-2 text-[14px] font-medium transition",
              current === l.id ? "bg-ink/[0.06] text-ink" : "text-ink2 hover:bg-ink/[0.06] hover:text-ink");
            const mark = current === l.id ? (page ? "page" : "true") : undefined;
            return page ? (
              <Link key={l.id} to={l.id === page ? `/${l.id}` : `/#${l.id}`} aria-current={mark} className={cls}>{l.label}</Link>
            ) : (
              <a key={l.id} href={`#${l.id}`} onClick={(e) => { e.preventDefault(); scrollToId(l.id); }} aria-current={mark} className={cls}>
                {l.label}
              </a>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:ml-0">
          {/* below the width of the chapter links, Pricing keeps a place of its own in the bar */}
          {!page ? (
            <a href="#pricing" onClick={(e) => { e.preventDefault(); scrollToId("pricing"); }} className={PRICING_SHORT}>{t("landing.nav.pricing", "Pricing")}</a>
          ) : page !== "pricing" && (
            <Link to="/pricing" className={PRICING_SHORT}>{t("landing.nav.pricing", "Pricing")}</Link>
          )}
          <LanguageSwitcher tone={overHero ? "glass" : "plain"} />
          <button type="button" onClick={() => useDemo.getState().toggleLandingTheme()} aria-label={themeLabel} title={themeLabel}
            className={cn("grid h-11 w-11 place-items-center rounded-full transition",
              overHero ? "lp-nav-glass bg-ink/[0.06] text-ink2 ring-1 ring-ink/10 hover:bg-ink/[0.1] hover:text-ink" : "bg-surface2 text-ink2 ring-1 ring-line hover:bg-line hover:text-ink")}>
            {dark ? <Moon size={18} strokeWidth={1.75} /> : <Sun size={18} strokeWidth={1.75} />}
          </button>
          <Link to="/sign-in"
            className={cn("group inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition sm:pr-4",
              !quiet ? "bg-accent text-white hover:bg-accent-hover"
                : overHero ? "lp-nav-glass bg-ink/[0.06] text-ink ring-1 ring-ink/10 hover:bg-ink/[0.1]"
                  : "bg-surface2 text-ink ring-1 ring-line hover:bg-line")}>
            {t("landing.cta.startBuilding", "Start building")}
            <ArrowRight size={16} strokeWidth={1.75} className="hidden transition-transform group-hover:translate-x-0.5 sm:block" />
          </Link>
        </div>
      </div>
    </header>
  );
}
