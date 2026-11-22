/** The step frame's agent line on Scope & success: which role is working behind the scenes, with the shimmer bar.
 *  The bar and its number are the job's recorded progress (progressEase): never ahead of it, never 100 % early. */
import { Loader } from "lucide-react";
import { ShimmerProgress } from "@/ui/ShimmerProgress";
import { useEasedProgress } from "@/components/engine/progressEase";

export function ScopeAgentLine({ text, progress, running = true }: { text: string; progress: number; running?: boolean }) {
  const shown = useEasedProgress(progress, { active: running, resetKey: text });
  return (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-[rgb(var(--c-ai-text))]">
        <Loader size={15} aria-hidden className="shrink-0 animate-pulse" />{text}…
      </p>
      <ShimmerProgress step={shown} total={100} ticks={false} active label={text} valueText={`${shown}%`} size="sm" />
    </div>
  );
}
