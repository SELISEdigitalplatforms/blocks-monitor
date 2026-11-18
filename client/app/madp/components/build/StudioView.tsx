/** The Studio, the build's default view: the live 3D factory as the canvas with the pipeline below it, and on the right
 *  how far the build is, its automatic quality gates and the live feed. Everything comes from the running (or last)
 *  build job (a milestone's build.run or a change request's change.build), the tickets it works on and their events;
 *  the 3D stage itself is passed in by the build page. While the recorded build is replayed, the page passes every value
 *  as it stood at the replay clock, and the progress is the share of the build's tickets the records show in Done at
 *  that moment. */
import type { ReactNode } from "react";
import type { StageState } from "@/madp/data/pipeline";
import { cn } from "@/madp/lib/cn";
import { Bar, Card, Chip, Dot, EmptyState, Label } from "@/madp/ui/kit";
import { fmtElapsed, ms, type BuildFocus, type BuildWindow, type FeedItem, type Gate } from "./model";
import { LiveFeed, QualityGates } from "./Panels";
import { recordedProgress } from "@/madp/components/engine/progressEase";
import { waitingDetail, waitsForPerson } from "./buildStep";
import { StageStepper } from "./stageUi";
import { stoppedLine } from "@/madp/components/changes/changeStopped";
import { t, useT } from "@/madp/i18n";
import { estimateBuild } from "@/madp/domain/engineEstimate";
import { useEstimates } from "./EstimatesContext";
import { buildEstimateTitle, estimateCostText, estimateTimeText, noEstimateYet } from "./estimateText";

export interface StudioViewProps {
  /** the 3D factory floor (the build page owns its lazy loading) */
  stage: ReactNode;
  focus: BuildFocus;
  window: BuildWindow | null;
  stages: StageState[];
  gates: Gate[];
  feed: FeedItem[];
  /** the feed's time words */
  when: (at: number) => string;
  /** set while the recorded build is replayed: the done share and the latest recorded step at the replay clock */
  replay?: { pct: number; line: string | null; playing: boolean } | null;
  /** a small overlay at the stage's top left (the usage pill), clear of the office's own controls at the top right */
  hud?: ReactNode;
}

const statusNow = (status: string): string | undefined => ({
  queued: t("build.studio.now.queued", "The build starts in a moment."),
  claimed: t("build.studio.now.claimed", "The development team picked the build up."),
  running: t("build.studio.now.running", "The MADP agents are working."),
  succeeded: t("build.studio.now.succeeded", "The build finished."),
  failed: t("build.studio.now.stopped", "The build stopped before it finished."),
  cancelled: t("build.studio.now.stopped", "The build stopped before it finished."),
} as Record<string, string>)[status];

export function StudioView({ stage, focus, window: win, stages, gates, feed, when, replay = null, hud }: StudioViewProps) {
  const t = useT();
  const job = focus.job;
  // the build's recorded progress, the same number as its milestone row on the Timeline tab
  const progress = replay ? replay.pct : job ? recordedProgress(job) : 0;
  const done = job?.status === "succeeded";
  const stopped = job?.status === "failed" || job?.status === "cancelled";
  const fixing = stages.some((s) => s.status === "sent-back");
  // the live build waits for a person to connect the product to Blocks: nothing is being built until then
  const waiting = !replay && waitsForPerson(job);
  // live, but its steps after the deploy did not all finish (src/domain/afterDeploy.ts): never the done tone
  const unfinished = done ? focus.afterDeploy ?? null : null;
  const tone = done ? (unfinished ? (unfinished.security ? "danger" : "warning") : "success") : stopped ? "danger" : !job || !focus.live ? "neutral" : waiting || fixing ? "warning" : "accent";
  const pulse = replay ? replay.playing : focus.live && !waiting;
  // the real estimate: the build's time and cost on MADP from the builds it finished before (never the tickets' stored
  // person-hours); nothing while there are too few measured builds, then a plain "No estimate yet"
  const calibration = useEstimates();
  const estimate = estimateBuild(calibration, focus.tickets.map((tk) => tk.type));
  const noEstimate = estimate ? null : focus.tickets.length ? noEstimateYet(calibration) : null;
  const elapsed = win ? fmtElapsed(win.head - win.start) : null;
  const queuedFor = job && !win && ms(job.createdAt) !== null ? job.createdAt : null;
  // a stopped build, cancelled or failed, reads the same everywhere (src/components/changes/changeStopped.ts): the line
  // says how it stopped and, for a change request, that it starts again from there; never its last progress step
  const stoppedSays = stopped && !replay
    ? (focus.change ? stoppedLine(focus.change.code, job?.message) : stoppedLine(focus.milestone ? t("build.studio.milestoneLower", "milestone {number}", { number: focus.milestone.number }) : null, job?.message, false))
    : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* the stage grows with the column beside it, up to what still fits the window */}
        <div className="relative flex min-h-[clamp(320px,52vh,600px)] flex-1 xl:max-h-[calc(100vh-280px)]">
          {stage}
          {hud && <div data-stage-hud className="pointer-events-none absolute left-5 top-5 z-[31] max-w-[calc(100%-15rem)] [&>*]:pointer-events-auto">{hud}</div>}
        </div>
        <Card title={t("build.studio.pipeline", "Pipeline")} action={<span className="hidden text-[13px] text-ink3 sm:inline">{t("build.studio.pipelineHint", "Plan to release, every stage verified")}</span>}>
          <StageStepper stages={stages} />
        </Card>
      </div>

      <div className="min-w-0 space-y-5">
        <Card title={t("build.inspector.progress", "Progress")} action={
          <span className="flex items-center gap-2">
            {replay && <Chip tone="neutral" icon={replay.playing ? <Dot tone="accent" pulse /> : undefined}>{t("build.page.replay.replay", "Replay")}</Chip>}
            {focus.milestone ? <span className="text-[13px] text-ink3">{t("build.page.milestoneN", "Milestone {number}", { number: focus.milestone.number })}</span>
              : focus.change && (
                <span className="text-[13px] text-ink3">
                  {focus.change.code ?? t("build.step.chip.change", "Change")}
                  {focus.change.increment && focus.change.increment.of > 1 && <span className="num"> · {t("build.step.chip.incrementTitle", "Increment {n} of {of}", { n: focus.change.increment.n, of: focus.change.increment.of })}</span>}
                </span>
              )}
          </span>}>
          {!job ? (
            <EmptyState title={t("build.timeline.noBuild", "No build has run yet")} text={t("build.studio.emptyText", "Start the next milestone's build. Its progress, gates and feed show here as the team works.")} />
          ) : (<>
            <div className="flex items-end justify-between gap-4">
              <div className="num text-[64px] font-medium leading-[0.9] tracking-[-0.04em]">
                {Math.floor(progress)}<span className="text-[28px] tracking-normal text-ink3">%</span>
                {stopped && !replay && <span className="mt-1 block text-[12px] font-normal leading-none tracking-normal text-ink3">{t("build.studio.whereStopped", "where it stopped")}</span>}
              </div>
              <div className="min-w-0 text-right">
                <Label>{t("build.timeline.buildTime", "Build time")}</Label>
                <div className="num text-[17px] font-medium leading-tight">{elapsed ?? t("build.inspector.notStarted", "Not started")}</div>
                {estimate && (
                  <div className="num mt-0.5 text-[12px] text-ink3" title={buildEstimateTitle(estimate)} data-build-estimate="">
                    {t("build.timeline.estimated", "estimated {estimate}", { estimate: estimateTimeText(estimate.minutes) })}
                    {estimate.costUsd && <span className="block">{estimateCostText(estimate.costUsd)}</span>}
                  </div>
                )}
                {noEstimate && <div className="mt-0.5 text-[12px] text-ink3" title={noEstimate.title}>{noEstimate.text}</div>}
              </div>
            </div>
            <Bar value={progress} tone={tone} className="mt-4 h-2.5" />
            <p className={cn("mt-4 flex items-start gap-2.5 rounded-block px-4 py-3 text-[14px]",
              done ? "bg-success-soft text-ink" : stopped ? "bg-danger-soft text-ink" : waiting || fixing ? "bg-warning-soft text-ink" : "bg-surface2 text-ink2")}>
              <span className="mt-1.5"><Dot tone={tone} pulse={pulse} /></span>
              <span className="min-w-0 break-words">
                {!stoppedSays && <span className="font-medium text-ink">{replay ? t("build.studio.then", "Then: ") : done ? t("build.studio.done", "Done: ") : waiting ? t("build.studio.waiting", "Waiting for you: ") : t("build.studio.nowPrefix", "Now: ")}</span>}
                {stoppedSays ?? (replay ? replay.line ?? statusNow(job.status) : waiting && job.message ? waitingDetail(job.message) : job.message ?? statusNow(job.status))}
                {queuedFor && <span className="block text-[12px] text-ink3">{t("build.studio.requested", "Requested {when}", { when: when(ms(queuedFor) as number) })}</span>}
              </span>
            </p>
            <div className="mt-5 border-t border-line pt-4">
              <Label>{t("build.studio.gates", "Automatic quality gates")}</Label>
              <QualityGates gates={gates} />
            </div>
          </>)}
        </Card>
        <LiveFeed items={feed} live={replay ? replay.playing : focus.live} liveLabel={replay ? t("build.studio.replayWord", "replay") : t("build.studio.liveWord", "live")} when={when} maxHeight={208} />
      </div>
    </div>
  );
}
