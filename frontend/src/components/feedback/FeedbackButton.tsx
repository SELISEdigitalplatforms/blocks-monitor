import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { targetKey } from "@/data/feedback";
import { useThreadBadge } from "./feedbackData";
import { openFeedback, toggleFeedback, useFeedbackUi, useIsFeedbackOpen, type FeedbackTarget } from "./feedbackUi";
import { useT } from "@/i18n";

/** The small feedback icon on a line item; opens the item's floating feedback card. */
export function FeedbackButton({ target, className }: { target: FeedbackTarget; className?: string }) {
  const t = useT();
  const key = targetKey(target.type, target.id);
  const { count: n, resolved, working, updated } = useThreadBadge(target.type, target.id);
  const open = useIsFeedbackOpen(target.type, target.id);
  const stale = useFeedbackUi((s) => {
    const o = s.open;
    return !!o && targetKey(o.type, o.id) === key
      && (o.title !== target.title || o.base !== target.base || o.locked !== target.locked || o.lockedNote !== target.lockedNote);
  });

  const ref = useRef<HTMLButtonElement>(null);

  // the open card follows the item's current title and lock state; a hidden copy of the item (an editor kept mounted
  // behind the plan) leaves it alone
  useEffect(() => {
    if (stale && (ref.current?.getClientRects().length ?? 0) > 0) openFeedback(target);
  }, [stale, target]);

  const count = n === 0 ? "" : n === 1 ? t("settings.feedback.button.oneComment", ", 1 comment") : t("settings.feedback.button.comments", ", {n} comments", { n });
  const state = working ? t("settings.feedback.button.working", ", the team is working on it") : updated ? t("settings.feedback.button.updated", ", updated by the team") : "";
  const label = t("settings.feedback.button.label", "Feedback on {title}{count}{state}", { title: target.title, count, state });
  return (
    <button
      ref={ref}
      type="button"
      data-feedback-button={key}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => toggleFeedback(target)}
      className={cn(
        "relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink3 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50",
        open && "bg-accent-soft text-[rgb(var(--c-accent-text))]",
        n > 0 || open
          ? "opacity-100"
          : "opacity-0 group-hover/fb:opacity-100 group-focus-within/fb:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
      {n > 0 && (
        <span
          aria-hidden
          className={cn(
            "num absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] font-medium ring-2 ring-surface",
            resolved ? "bg-surface2 text-ink2" : "bg-accent text-white",
          )}
        >
          {n}
        </span>
      )}
      {(working || updated) && (
        <span aria-hidden className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full bg-surface">
          <span className={cn("h-2 w-2 rounded-full", working ? "bg-ai animate-pulse-dot" : "bg-accent")} />
        </span>
      )}
    </button>
  );
}
