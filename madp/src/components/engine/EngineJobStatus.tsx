/** The ONE status block for every place that waits on work behind the scenes (an engine job). Everything shown is the
 *  job's real state: no invented output. The bar and its number are the job's recorded progress, never ahead of it and
 *  never 100 % before the job is done (progressEase). Plain words only: the client never
 *  sees "engine" or "job". */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Ban, CircleAlert, CircleCheck, Cpu, Factory, Hourglass, RotateCcw, type LucideIcon } from "lucide-react";
import { Bar, Button } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";
import type { EngineJob } from "@/blocks/engine/types";
import { JOB_STATUS_TEXT as JOB_STATUS_LABEL } from "@/components/engine/jobWords";
import { MAX_JOB_ATTEMPTS, jobDisplayState, waitingForEngine, type JobDisplayState } from "@/domain/engineJob";
import { jobAttention, type AfterDeployAttention } from "@/domain/afterDeploy";
import { elapsedSince, formatElapsed, safeOutputHref } from "./engineUi";
import { recordedProgress, useEasedProgress } from "./progressEase";
import { BlocksConnectCard, connectOfJob } from "./BlocksConnectCard";

/** Where a finished job's result can be opened. */
export interface EngineJobOutput {
  href: string;
  label: string;
}

export interface EngineJobStatusProps {
  /** What is open after the job's deploy as the page knows it (a change's checks record can clear its failing checks:
   *  afterDeployUi.ts withoutClearedChecks); absent: from the job alone. */
  attention?: AfterDeployAttention | null;
  job: EngineJob | null;
  variant?: "full" | "compact";
  /** The local engine is always connected; false shows a queued job with the longer "Waiting to start" line. */
  engineConnected?: boolean;
  /** Fixed clock for elapsed time; by default the clock ticks while the job is claimed or running. */
  now?: number;
  output?: EngineJobOutput | null;
  canRetry?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  /** The reason a job could not be requested at all (for example the function is not configured). */
  requestError?: string | null;
  /** Show the job's recorded progress (recordedProgress), not the eased one: where the page shows the same job's
   *  progress as a number elsewhere too (a build's milestone row next to its Studio), so the two always agree. */
  recorded?: boolean;
  className?: string;
}

const VIEW: Record<JobDisplayState, { icon: LucideIcon; tone: string }> = {
  waiting: { icon: Hourglass, tone: "text-ink2" },
  queued: { icon: Factory, tone: "text-ink2" },
  claimed: { icon: Cpu, tone: "text-[rgb(var(--c-accent-text))]" },
  running: { icon: Cpu, tone: "text-[rgb(var(--c-accent-text))]" },
  succeeded: { icon: CircleCheck, tone: "text-[rgb(var(--c-success-text))]" },
  failed: { icon: CircleAlert, tone: "text-[rgb(var(--c-danger-text))]" },
  cancelled: { icon: Ban, tone: "text-ink3" },
};

/** The state's one-line title, read at render time so it follows the chosen language. */
function viewTitle(state: JobDisplayState): string {
  return state === "waiting" ? t("studio.engine.status.waitingShort", "Waiting for the engine") : JOB_STATUS_LABEL[state];
}

function useNow(fixed: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined || !live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fixed, live]);
  return fixed ?? now;
}

function OutputLink({ output }: { output: EngineJobOutput }): ReactNode {
  const t = useT();
  const safe = safeOutputHref(output.href);
  if (!safe) return null;
  const cls = "inline-flex items-center gap-1 text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline";
  const text = t("studio.engine.status.openOutput", "Open {label}", { label: output.label });
  return safe.kind === "internal" ? (
    <Link to={safe.href} className={cls}>{text}<ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></Link>
  ) : (
    <a href={safe.href} target="_blank" rel="noopener noreferrer" className={cls}>{text}<ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></a>
  );
}

export function EngineJobStatus({
  job, variant = "full", engineConnected = true, now, output, canRetry, onRetry, retrying, requestError, recorded = false, className, attention: given,
}: EngineJobStatusProps) {
  const t = useT();
  const full = variant === "full";
  const clock = useNow(now, job?.status === "claimed" || job?.status === "running" || job?.status === "queued");
  const eased = useEasedProgress(job?.progress, { active: job?.status === "running" && !recorded, done: job?.status === "succeeded", resetKey: job?.id ?? "" });
  const progress = recorded && job ? recordedProgress(job) : eased;

  const requestFailure = requestError ? (
    <div role="alert" className={cn(full ? "rounded-block bg-danger-soft px-4 py-3" : "inline-flex flex-wrap items-center gap-x-2", "text-[14px]", className)}>
      <span className="inline-flex items-center gap-2 font-medium text-[rgb(var(--c-danger-text))]">
        <CircleAlert size={16} strokeWidth={1.75} aria-hidden />{t("studio.engine.status.couldNotStart", "Couldn't start")}
      </span>
      <span className={cn("text-ink2", full && "mt-1 block")}>{requestError}</span>
    </div>
  ) : null;

  if (!job) return requestFailure;

  // a job the engine has not picked up within its usual seconds: the engine is offline, the job waits for it
  const state = jobDisplayState(job.status, engineConnected && !waitingForEngine(job, clock));
  // a build whose code is live but whose steps after the deploy did not all finish (src/domain/afterDeploy.ts): it
  // never reads as done
  const attention = given !== undefined ? given : jobAttention(job);
  const { icon: Icon, tone } = attention
    ? { icon: CircleAlert, tone: attention.security ? "text-[rgb(var(--c-danger-text))]" : "text-[rgb(var(--c-warning-text))]" }
    : VIEW[state];
  const waitingFull = t("studio.engine.status.waitingFull", "Waiting for the MADP engine. Your team starts this as soon as it is online; nothing is lost meanwhile.");
  // a build that ended without finishing, failed or cancelled, reads "Stopped" (one rule: src/components/changes/changeStopped.ts)
  const buildEnded = (job.kind === "build.run" || job.kind === "change.build") && (state === "failed" || state === "cancelled");
  const title = full && state === "waiting" ? waitingFull
    : attention ? (attention.broken ? t("studio.engine.status.liveNotUsable", "Live, but not usable yet") : t("studio.engine.status.liveNotFinished", "Live, but not finished"))
    : buildEnded ? t("studio.engine.status.stopped", "Stopped") : viewTitle(state);
  const elapsed = state === "claimed" || state === "running" ? elapsedSince(job.claimedAt, clock) : null;
  const retryable = job.status === "failed" && canRetry === true;
  const exhausted = retryable && job.attempts >= MAX_JOB_ATTEMPTS;
  const message = job.status === "failed" ? (job.message ?? t("studio.engine.status.failedDefault", "This couldn't be finished. Try again.")) : job.message;
  // a job that waits for the product's Blocks sign-in shows the link and the code (the page's card has the steps)
  const connect = connectOfJob(job);

  const action: ReactNode = retryable && !exhausted && onRetry ? (
    <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={onRetry} disabled={retrying}>
      {retrying ? t("studio.engine.status.retrying", "Trying again…") : t("studio.engine.status.retry", "Try again")}
    </Button>
  ) : state === "succeeded" && output ? (
    <OutputLink output={output} />
  ) : null;

  return (
    <>
      <div role="status" aria-live="polite"
        className={cn(full ? "rounded-block bg-surface2 px-4 py-3" : "inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1", "text-[14px]", className)}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Icon size={16} strokeWidth={1.75} aria-hidden className={cn("shrink-0", tone)} />
          <span className="font-medium text-ink">{title}</span>
          {state === "running" && <span className="num text-ink2">{progress}%</span>}
          {elapsed !== null && <span className="num text-ink3">{formatElapsed(elapsed)}</span>}
        </div>
        {full && state === "running" && (
          <div role="progressbar" aria-label={t("studio.engine.status.progress", "Progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2">
            <Bar value={progress} hatchRest={false} />
          </div>
        )}
        {connect ? <BlocksConnectCard connect={connect} variant="compact" className={cn(full && "mt-1.5")} /> : message && state !== "waiting" && state !== "queued" && (
          <p className={cn("min-w-0 break-words text-ink2", full ? "mt-1.5 text-[14px]" : "text-[13px]")}>{message}</p>
        )}        {exhausted && <p className={cn("text-ink3", full ? "mt-1.5 text-[13px]" : "text-[13px]")}>{t("studio.engine.status.exhausted", "This can't be tried again. Ask your team for help.")}</p>}
        {action && <div className={cn(full && "mt-2")}>{action}</div>}
      </div>
      {requestFailure}
    </>
  );
}
