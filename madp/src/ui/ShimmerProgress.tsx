/** A step progress bar that never looks stuck: a gradient fill up to the current step, a light shimmer sweeping
 *  forward inside the fill and a soft push into the next step while the person is on this one, and an eased move
 *  forward when they continue. Reusable: the guided project start uses it, the project journey can too.
 *  Reduced motion: the fill and the ticks only (no sweep, no push, no easing). */
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

export interface ShimmerProgressProps {
  /** The current step, 1-based (filled up to and including it). */
  step: number;
  /** How many steps there are (a tick marks each boundary). */
  total: number;
  /** The shimmer and push run while true (the step is in progress). */
  active?: boolean;
  /** The accessible name ("Project start progress"). */
  label: string;
  /** What a screen reader hears ("Step 2 of 5: About the project"); default "Step n of total". */
  valueText?: string;
  /** Bar thickness. */
  size?: "sm" | "md";
  /** A tick at each step boundary (default true; off for a percentage bar). */
  ticks?: boolean;
  className?: string;
}

export function progressPercent(step: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, (Math.min(step, total) / total) * 100));
}

export function ShimmerProgress({ step, total, active = true, label, valueText, size = "md", ticks = true, className }: ShimmerProgressProps) {
  const t = useT();
  const pct = progressPercent(step, total);
  const segment = total > 0 ? 100 / total : 0;
  const pushing = active && pct < 100;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      aria-valuetext={valueText ?? t("shell.progress.stepOf", "Step {step} of {total}", { step: Math.min(step, total), total })}
      style={{ "--sp-pct": `${pct}%`, "--sp-seg": `${segment}%` } as CSSProperties}
      className={cn("shimmer-progress relative w-full overflow-hidden rounded-full bg-surface2 dark:bg-ink/[0.08]", size === "md" ? "h-2" : "h-1.5", className)}>
      {/* the push: a soft glow growing from the fill into the next step, again and again */}
      {pushing && <span aria-hidden className="shimmer-progress-push" />}
      <span aria-hidden className="shimmer-progress-fill">
        {active && <span className="shimmer-progress-sweep" />}
      </span>
      {ticks && Array.from({ length: Math.max(0, total - 1) }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-surface dark:bg-canvas" style={{ left: `${((i + 1) / total) * 100}%` }} />
      ))}
    </div>
  );
}
