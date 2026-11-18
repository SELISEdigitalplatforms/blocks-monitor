/** The conversation's building blocks in the analyst's column: what the analyst says, what you said, a quiet note,
 *  a plain-words error with Retry, the short acknowledgement after an answer, and the question card. */
import { forwardRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, RotateCcw } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

/** One short thing the analyst says. */
export function AnalystSays({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("break-words text-[15px] leading-6 text-ink", className)}>{children}</p>;
}

/** Your answer, on the right. */
export function YouSaid({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-w-0 justify-end">
      <div className="min-w-0 max-w-[90%] rounded-block bg-accent-soft px-3.5 py-2 text-[14px] leading-6 text-ink">
        <span className="sr-only">{t("analysis.analyst.youSaid", "You said:")} </span>
        <span className="break-words">{children}</span>
      </div>
    </div>
  );
}

/** A quiet line (who does this, a hint). */
export function Note({ children }: { children: ReactNode }) {
  return <p className="break-words text-[13px] leading-5 text-ink3">{children}</p>;
}

/** Something didn't work: the reason in plain words, and Retry when trying again can help. */
export function ErrorNote({ text, onRetry, busy }: { text: string; onRetry?: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-block bg-danger-soft px-3.5 py-2.5">
      <p className="min-w-0 flex-1 break-words text-[13px] leading-5 text-[rgb(var(--c-danger-text))]">{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[13px] font-medium text-ink ring-1 ring-line transition hover:bg-surface2 disabled:opacity-45">
          <RotateCcw size={13} aria-hidden />{t("analysis.analyst.retry", "Retry")}
        </button>
      )}
    </div>
  );
}

/** The short friendly word after an answer ("Got it. …"). */
export function Ack({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[14px] leading-6 text-ink2 animate-rise motion-reduce:animate-none">
      <span aria-hidden className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check size={11} strokeWidth={3} /></span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** The card a question sits in: the question in clear type, then whatever answers it. Focusable, so the "Next for you"
 *  button can bring you straight here and the number keys work. */
export const QuestionCard = forwardRef<HTMLDivElement, {
  question: ReactNode; label: string; children: ReactNode; onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void; action?: boolean;
}>(function QuestionCard({ question, label, children, onKeyDown, action }, ref) {
  return (
    <div ref={ref} role="group" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown} data-analyst-action={action ? "" : undefined}
      className="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5 shadow-[0_4px_16px_-10px_rgb(10_12_20/0.18)] outline-none ring-1 ring-line transition-shadow focus:ring-2 focus:ring-accent/45 animate-rise motion-reduce:animate-none">
      <div className="break-words text-[16px] font-medium leading-7 text-ink">{question}</div>
      {children}
    </div>
  );
});

/** A part's name in a sentence, opening that part on the right. */
export function PartLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded font-medium text-[rgb(var(--c-accent-text))] underline decoration-accent/30 underline-offset-[3px] outline-none hover:decoration-accent focus-visible:ring-2 focus-visible:ring-accent/50">
      {children}
    </button>
  );
}
