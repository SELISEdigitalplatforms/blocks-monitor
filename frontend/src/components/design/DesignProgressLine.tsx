/** The design job's agent line, in the stepper's style (ScopeAgentLine, the build line): who is working, the last real
 *  step, the shared shimmer bar and the time so far. The bar's value comes from designProgress (real progress or the
 *  time curve, never backwards); the clock ticks once a second while the job is waiting or working. Only the step text
 *  is a live region, so the ticking time is never read out every second. */
import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { ShimmerProgress } from "@/ui/ShimmerProgress";
import { cn } from "@/lib/cn";
import { designProgress, type DesignProgressJob, type DesignProgressMemo, type DesignProgressView } from "./designProgress";
import { useT } from "@/i18n";

/** The bar's state for the active job; the memory survives the job disappearing between reads, so a re-appearing job
 *  never starts lower. Null without a job. */
export function useDesignProgress(job: DesignProgressJob | null | undefined, fallback: string): DesignProgressView | null {
  const memo = useRef<DesignProgressMemo | null>(null);
  const [, setTick] = useState(0);
  const live = Boolean(job && ["queued", "claimed", "running"].includes(job.status));
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(t);
  }, [live]);
  if (!job) return null;
  const view = designProgress(memo.current, job, Date.now(), fallback);
  memo.current = view.memo;
  return view;
}

export function DesignProgressLine({ title, view, className }: {
  /** "Your business analyst is designing the screens" */
  title: string;
  /** The job's progress; null while the request is still being sent (the bar shimmers at its start). */
  view: DesignProgressView | null;
  className?: string;
}) {
  const t = useT();
  const shown = view?.shown ?? 4;
  return (
    <div className={cn("rounded-block bg-ai-soft px-4 py-3.5", className)} data-design-progress="">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-[rgb(var(--c-ai-text))] dark:bg-ink/10">
          <Palette size={16} className="animate-pulse motion-reduce:animate-none" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-[rgb(var(--c-ai-text))]">{title}</p>
          <p role="status" aria-live="polite" className="mt-0.5 break-words text-[13px] leading-relaxed text-ink2">
            {view ? view.stepText : t("analysis.design.progress.sending", "Sending your request to the business analyst…")}
          </p>
        </div>
      </div>
      <ShimmerProgress step={shown} total={100} ticks={false} active size="sm" className="mt-3"
        label={title} valueText={view ? view.valueText : t("analysis.design.progress.starting", "Starting")} />
      {view && <p className="num mt-2 text-[12px] text-ink3" data-idle={view.idle || undefined}>{view.timeText}</p>}
    </div>
  );
}
