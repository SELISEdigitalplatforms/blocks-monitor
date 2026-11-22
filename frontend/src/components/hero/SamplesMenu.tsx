/** The landing's hero samples, linked in the footer: the homepage (Story) and the same page with each alternative
 *  hero concept (/samples/foundry, /samples/blueprint, /samples/line). The page on screen is marked. */
import { Link, useParams } from "react-router-dom";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { CONCEPTS, DEFAULT_CONCEPT, isConcept } from "./types";

const hrefOf = (id: string) => (id === DEFAULT_CONCEPT ? "/" : `/samples/${id}`);

export function SamplesMenu({ className }: { className?: string }) {
  const t = useT();
  const param = useParams().concept ?? null;
  const current = isConcept(param) ? param : DEFAULT_CONCEPT;
  return (
    <nav aria-label={t("landing.samples.navAria", "Hero concepts")} className={cn("flex flex-wrap items-center justify-center gap-x-1 gap-y-2", className)}>
      <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink3">{t("landing.samples.hero", "Hero")}</span>
      {CONCEPTS.map((c) => {
        const on = c.id === current;
        return (
          <Link key={c.id} to={hrefOf(c.id)} title={c.hint} aria-current={on ? "page" : undefined}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition",
              on ? "bg-surface text-ink shadow-card dark:border dark:border-line" : "text-ink3 hover:bg-ink/[0.05] hover:text-ink")}>
            {on && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
            {c.label}
          </Link>
        );
      })}
    </nav>
  );
}
