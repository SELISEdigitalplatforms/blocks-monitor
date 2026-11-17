/** The conversation's building blocks in the business analyst's panel: what the business analyst says, what you said. */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

/** One thing the business analyst says (a message, or a question with its answer box under it). */
export function PmSays({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 gap-2.5", className)}>
      <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">BA</span>
      <div className="min-w-0 flex-1 rounded-block bg-surface2 px-3.5 py-2.5 text-[14px] leading-6 text-ink">{children}</div>
    </div>
  );
}

/** Your answer, on the other side. */
export function YouSaid({ children, label }: { children: ReactNode; label?: string }) {
  const t = useT();
  return (
    <div className="flex min-w-0 justify-end">
      <div className="min-w-0 max-w-[90%] rounded-block bg-accent-soft px-3.5 py-2 text-[14px] leading-6 text-ink">
        <span className="sr-only">{label ?? t("analysis.workspace.you", "You")}: </span>
        <span className="break-words">{children}</span>
      </div>
    </div>
  );
}

/** A quiet line under the conversation (who may do it, an error, a hint). */
export function TalkNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p role={tone === "danger" ? "alert" : undefined}
      className={cn("break-words text-[13px]", tone === "danger" ? "text-danger" : "text-ink3")}>{children}</p>
  );
}
