/** A small window onto the factory floor for my project: its current step, its active engine job exactly as the
 *  engine reports it, and the 3D office (compact, display only) driven by that job's progress. Nothing is simulated:
 *  without an active job the office stands idle. */
import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard } from "lucide-react";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import type { EngineJob } from "@/madp/blocks/engine/types";
import type { StageId } from "@/madp/data/types";
import type { StageState } from "@/madp/data/pipeline";
import { ArrowButton, Card } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { FactoryOffice } from "./factoryOffice";
import { useMyProject } from "./useMyProject";
import { useT } from "@/madp/i18n";
import { phaseNameOf } from "@/madp/components/project/stepNames";


/** The 3D stage loads and renders on its own: if it is still loading or cannot start (e.g. no WebGL), the rest of
 *  Home keeps working. */
export class StageBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** In the stage's place while it loads or cannot show: close to the colours of the 3D stage's surroundings (a light haze
 *  over a grey ground in the light theme, the night stage in the dark one; components/office/office.css fo-stage-env),
 *  from the app's own tokens because the office's are not loaded yet. */
export function StageFallback({ text, pulse }: { text: string; pulse?: boolean }) {
  return (
    <div className="grid min-h-[260px] flex-1 place-items-center rounded-block bg-gradient-to-b from-surface2 to-line px-6 text-center dark:from-stage dark:to-stage">
      <span className={cn("text-[13px] text-ink3 dark:text-white/70", pulse && "animate-pulse-dot")}>{text}</span>
    </div>
  );
}

const STAGE_IDS: readonly StageId[] = ["01", "02", "03", "04", "05", "06", "07", "deploy"];

/** The office's stations from the real job: a running build.run / change.build puts its Progress on the stations in
 *  order; any other state leaves the floor idle (a finished build shows every station done, a failed one blocked). */
export function stagesFromJob(job: EngineJob | null): StageState[] {
  const build = job !== null && (job.kind === "build.run" || job.kind === "change.build");
  const n = STAGE_IDS.length;
  const at = build && (job.status === "claimed" || job.status === "running") ? Math.min(n - 1, Math.floor((job.progress / 100) * n)) : -1;
  return STAGE_IDS.map((id, i) => {
    if (build && job.status === "succeeded") return { id, status: "done" };
    if (build && job.status === "failed" && i === Math.min(n - 1, Math.floor((job.progress / 100) * n))) return { id, status: "blocked" };
    if (at < 0) return { id, status: "planned" };
    return { id, status: i < at ? "done" : i === at ? "active" : "planned" };
  });
}

export function LiveFactoryCard({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { project, step, stepHref, activeJob, isLoading } = useMyProject();
  // the step's name is read here, at render time, so it follows the chosen language
  const stepLabel = step ? phaseNameOf(step) : "";
  const stages = useMemo(() => stagesFromJob(activeJob), [activeJob]);
  const empty = project === null;
  return (
    <Card className={cn("flex flex-col", className)} bodyClassName="flex flex-1 flex-col gap-4" title={t("shell.home.teamAtWork", "Your team at work")} icon={<Clapperboard size={18} strokeWidth={1.75} />}
      action={project ? <ArrowButton label={t("shell.dashboard.openStep", "Open {step}", { step: stepLabel })} onClick={() => navigate(stepHref)} /> : undefined}>
      {isLoading ? (
        <div role="status" aria-label={t("shell.home.loadingProject", "Loading your project")} className="space-y-2">
          <div aria-hidden className="h-4 w-2/3 animate-pulse rounded-card bg-surface2" />
          <div aria-hidden className="h-4 w-1/3 animate-pulse rounded-card bg-surface2" />
        </div>
      ) : empty ? (
        <p className="text-[14px] text-ink2">{t("shell.home.noneStarted", "None of your projects has started yet. Start one above and you can watch your team work on it here.")}</p>
      ) : (
        <div>
          <p className="text-[15px] font-medium text-ink">{project.name}</p>
          <p className="text-[13px] text-ink2">{stepLabel}</p>
          <EngineJobStatus job={activeJob} variant="compact" className="mt-2" />
          {!activeJob && <p className="mt-2 text-[13px] text-ink3">{t("shell.dashboard.nobodyWorking", "Nobody is working on it right now.")}</p>}
        </div>
      )}
      {/* grows with the card (up to a cap) when the card beside it is taller */}
      <div className="flex max-h-[440px] min-h-[260px] flex-1 flex-col overflow-hidden rounded-block">
        <StageBoundary fallback={<StageFallback text={t("shell.dashboard.teamViewUnavailable", "The team view can't be shown on this screen.")} />}>
          <Suspense fallback={<StageFallback text={t("shell.dashboard.teamViewOpening", "Opening the team view…")} pulse />}>
            <FactoryOffice variant="compact" stages={stages} chat={project !== null} projectId={project?.id ?? null} follow className="min-h-[260px] w-full flex-1" />
          </Suspense>
        </StageBoundary>
      </div>
    </Card>
  );
}
