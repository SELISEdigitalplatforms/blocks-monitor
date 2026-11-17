/** MADP Factory's public landing page (/): a cinematic opener, then the story in five chapters, the pricing and the close.
 *  It has its own theme, dark by default (landingTheme in the store; the switch in the bar turns it light). BareShell
 *  puts it on <html>, so every token and dark: variant follows it. The hero and the bar over it are always dark; everything
 *  below follows the landing theme. In light mode the page turns light at a clean edge where the problem section starts,
 *  with no extra element. Every section sits on the one page canvas: no bands and no full-section panels. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { PricingSection } from "@/components/pricing/PricingSection";
import { useT } from "@/i18n";
import "./landing.css";
import { Closing, ClosingFooter } from "./Closing";
import { Hero } from "./Hero";
import { Journey } from "./Journey";
import { Line } from "./Line";
import { Nav } from "./Nav";
import { Platform } from "./Platform";
import { Problem } from "./Problem";
import { Proof } from "./Proof";
import { scrollToId } from "./motion";

export function LandingView() {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [overHero, setOverHero] = useState(true);
  const heroEnd = useRef<HTMLDivElement>(null);
  const [onHero, setOnHero] = useState(true);
  const [ctaInView, setCtaInView] = useState(true);

  /* the hero lies under the bar until its bottom edge scrolls above the bar's vertical middle; then the bar follows the theme */
  useEffect(() => {
    const el = heroEnd.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) =>
      setOnHero(e.isIntersecting || e.boundingClientRect.top > (e.rootBounds?.bottom ?? window.innerHeight)),
    { rootMargin: "-54px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* the bar is transparent only while the page rests at the very top; it turns into a frosted pill as soon as the page
     scrolls, so nothing in the hero (its buttons, the scene's lines and labels) ever passes under the bar's logo and
     links while it is still clear */
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOverHero(e.isIntersecting || e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* one primary action per screen: while the hero's or the close's own Sign in, or the plans with their focal button, is
     on screen (and not yet faded under the bar), the bar's Sign in steps back to a secondary pill */
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ctas = [...el.querySelectorAll('a[href="/sign-in"], [data-primary-cta]')].filter((a) => !a.closest("header"));
    const shown = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) shown.add(e.target);
        else shown.delete(e.target);
      }
      setCtaInView(shown.size > 0);
    }, { rootMargin: "-140px 0px 0px 0px" });
    ctas.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, []);

  /* a link to a chapter from another page (/#pricing, /#how …) opens the landing page at that chapter */
  const { hash } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!/^[a-z][a-z-]{1,30}$/.test(id)) return;
    const raf = requestAnimationFrame(() => scrollToId(id));
    return () => cancelAnimationFrame(raf);
  }, [hash]);

  const title = t("landing.page.documentTitle", "MADP Factory · Autonomous software factory");
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);

  return (
    <div ref={root} id="top" tabIndex={-1} className="lp-root relative min-h-screen overflow-x-clip bg-canvas text-ink outline-none">
      <a href="#problem"
        className="sr-only z-[60] rounded-full bg-accent text-[14px] font-medium text-white focus:not-sr-only focus:fixed focus:left-1/2 focus:top-4 focus:-translate-x-1/2 focus:px-4 focus:py-2">
        {t("landing.page.skipToContent", "Skip to content")}
      </a>
      <Nav overHero={overHero} quiet={ctaInView} onHero={onHero} />
      <main>
        <div className="relative">
          <Hero />
          <div ref={sentinel} aria-hidden className="pointer-events-none absolute inset-x-0 top-2 h-px" />
          <div ref={heroEnd} aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />
        </div>
        <Problem />
        <Journey />
        <Line />
        <Proof />
        <Platform />
        <PricingSection />
        <Closing />
      </main>
      <ClosingFooter />
    </div>
  );
}
