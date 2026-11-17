/** A job's percentage on the shimmer bar: the value the job recorded, never ahead of it (progressEase); the bar's own
 *  transition slides from one recorded value to the next and its sweep shows the job is at work, and it never shows
 *  100 % before the job is done. A job that reports no percentage keeps the plain "Working" bar, with no number. */
import { ShimmerProgress, type ShimmerProgressProps } from "@/ui/ShimmerProgress";
import { useT } from "@/i18n";
import { useEasedProgress } from "./progressEase";

export function EasedJobBar({ progress, working = true, resetKey = "", ...bar }: {
  /** The job's recorded progress (0-100), or null when it reports none. */
  progress: number | null | undefined;
  /** True while the job is picked up and working. */
  working?: boolean;
  /** Names the job. */
  resetKey?: string;
} & Omit<ShimmerProgressProps, "step" | "total" | "valueText">) {
  const t = useT();
  const known = typeof progress === "number" && Number.isFinite(progress);
  const shown = useEasedProgress(known ? progress : 0, { active: working && known, resetKey });
  return (
    <ShimmerProgress step={known ? shown : 30} total={100} valueText={known ? `${shown}%` : t("studio.engine.bar.working", "Working")} {...bar} />
  );
}
