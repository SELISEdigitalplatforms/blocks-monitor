import { useEffect } from "react";
import "@/components/landing/landing.css";
import { ClosingFooter } from "@/madp/components/landing/Closing";
import { Nav } from "@/madp/components/landing/Nav";
import { PricingSection } from "@/madp/components/pricing/PricingSection";
import { useT } from "@/madp/i18n";

/** The public pricing page (/pricing): the landing page's Pricing chapter on a page of its own, in the landing theme, with
 *  the same top bar (its chapter links lead back to the landing page) and footer. */
export default function Pricing() {
  const t = useT();
  const title = t("pricing.page.documentTitle", "Pricing · MADP Factory");
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
  return (
    <div id="top" tabIndex={-1} className="lp-root relative min-h-screen overflow-x-clip bg-canvas text-ink outline-none">
      <a href="#pricing"
        className="sr-only z-[60] rounded-full bg-accent text-[14px] font-medium text-white focus:not-sr-only focus:fixed focus:left-1/2 focus:top-4 focus:-translate-x-1/2 focus:px-4 focus:py-2">
        {t("pricing.page.skipToContent", "Skip to content")}
      </a>
      <Nav overHero={false} quiet onHero={false} page="pricing" />
      <main>
        <PricingSection level={1} />
      </main>
      <ClosingFooter />
    </div>
  );
}
