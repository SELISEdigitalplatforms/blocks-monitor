/** "Next for you": the one thing that moves the project on, at the top of the analyst's column. One primary button;
 *  when the action exists but can't be done yet, why, in plain words (never a dead disabled button); while the analyst
 *  works, a calm "I'm working on it". When focusSignal changes (the sticky bar asks), the card scrolls into view and
 *  its button takes the focus. */
import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3 } from "lucide-react";
import type { NextAction } from "../model";
import { WorkingDots } from "./Working";
import { useT } from "@/i18n";

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function NextCard({ next, onGo, focusSignal }: { next: NextAction; onGo: () => void; focusSignal?: number }) {
  const t = useT();
  const id = useId();
  const cardRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const seen = useRef(focusSignal);

  useEffect(() => {
    if (focusSignal === seen.current) return;
    seen.current = focusSignal;
    cardRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
    (buttonRef.current ?? cardRef.current)?.focus({ preventScroll: true });
  }, [focusSignal]);

  // an item to open, the documentation of a live product to start, or a change request to open
  const canGo = Boolean((next.item || next.action || next.href) && next.button) && !next.blockedBecause && !next.working;
  const GO = "mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-white outline-none transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none sm:w-fit";

  // a finished analysis shows nothing here: the work goes on in Software Engineering or Release (owner 15.11)
  if (next.finished) return null;
  return (
    <section ref={cardRef} tabIndex={-1} aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col rounded-card bg-surface p-5 shadow-[0_8px_24px_-14px_rgb(var(--c-accent)/0.45)] outline-none ring-1 ring-accent/20 focus:ring-2 focus:ring-accent/45 dark:ring-accent/30">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[rgb(var(--c-accent-text))]">{t("analysis.analyst.nextForYou", "Next for you")}</p>
      <h3 id={`${id}-title`} className="mt-1.5 break-words text-[17px] font-medium leading-6 text-ink">{next.title}</h3>
      {next.detail && <p className="mt-1 break-words text-[14px] leading-6 text-ink2">{next.detail}</p>}
      <div aria-live="polite" className="empty:hidden">
        {next.working ? (
          <p role="status" className="mt-4 flex items-center gap-2.5 rounded-block bg-surface2 px-3.5 py-2.5 text-[14px] leading-5 text-ink2">
            <WorkingDots className="shrink-0" />
            <span className="min-w-0 break-words">{t("analysis.analyst.workingOnIt", "I'm working on it. You can read the analysis meanwhile.")}</span>
          </p>
        ) : next.blockedBecause ? (
          <p className="mt-4 flex items-start gap-2.5 rounded-block bg-surface2 px-3.5 py-2.5 text-[14px] leading-5 text-ink2">
            <Clock3 size={15} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
            <span className="min-w-0 break-words">{next.blockedBecause}</span>
          </p>
        ) : null}
      </div>
      {canGo && (next.href ? (
        <Link ref={buttonRef} to={next.href} className={GO}>{next.button}<ArrowRight size={16} aria-hidden /></Link>
      ) : (
        <button ref={buttonRef} type="button" onClick={onGo} className={GO}>
          {next.button}<ArrowRight size={16} aria-hidden />
        </button>
      ))}
    </section>
  );
}
