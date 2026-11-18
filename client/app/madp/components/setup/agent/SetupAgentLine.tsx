/** One calm line on the Project setup page about the business agent's work:
 *    while it reads   "Your business agent is reading 3 new files…" with the shimmer bar
 *    when it is done  "Filed 8 documents into 3 folders · found 4 must-haves and 2 workflows in PRD v2.pdf — Review"
 *  The agent starts by itself when people share material (and when the page opens with material nobody has read);
 *  "Review" opens the window where each finding is added, changed or ignored. Renders nothing before the agent has
 *  done anything, and after the hand-over unless something is still waiting for review. */
import { useState } from "react";
import { ArrowRight, FileSearch, RotateCcw } from "lucide-react";
import { useProject } from "@/madp/blocks/projects/reads";
import { useProjectsContext } from "@/madp/blocks/projects/context";
import { can } from "@/madp/domain/rbac";
import { MAX_JOB_ATTEMPTS } from "@/madp/domain/engineJob";
import { engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import { doneLine, workingLine } from "@/madp/domain/setupAgent";
import { Button } from "@/madp/ui/kit";
import { EasedJobBar } from "@/madp/components/engine/EasedJobBar";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { factsOf, inputOf, useSetupAgent, useWakeOnOpen, wakeSetupAgent } from "./data";
import { SetupAgentReview } from "./SetupAgentReview";
import { reviewReadOnlyReason } from "./reviewReason";

export interface SetupAgentLineProps {
  projectId: string;
  className?: string;
}

export function SetupAgentLine({ projectId, className }: SetupAgentLineProps) {
  const t = useT();
  const project = useProject(projectId).data ?? null;
  const ctx = useProjectsContext();
  const canEdit = ctx.isSuperAdmin || can(ctx.permissions, "business.edit");
  const inSetup = Boolean(project && !project.handedOverAt && project.step === "business");
  const agent = useSetupAgent(projectId, { live: inSetup });
  useWakeOnOpen(projectId, inSetup && canEdit);
  const [reviewing, setReviewing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!project) return null;
  const { job, working, open } = agent;
  if (!job && open.length === 0) return null;
  if (!inSetup && open.length === 0) return null;

  const failed = job?.status === "failed" || job?.status === "cancelled";
  // "Try again": the failed reading runs again (job.retry) while it has attempts left; otherwise the agent is woken,
  // which queues a new reading of what is still unread. A refusal is shown, never dropped.
  const tryAgain = async () => {
    if (!job || retrying || !ctx.workspaceId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      if (job.status === "failed" && job.attempts < MAX_JOB_ATTEMPTS) await retryEngineJob(job.id);
      else await wakeSetupAgent(ctx.workspaceId, projectId);
    } catch (e) {
      setRetryError(engineErrorMessage(e));
    } finally {
      setRetrying(false);
    }
  };
  const input = inputOf(job);
  const text = working
    ? workingLine(input.fileIds.length, input.noteIds.length)
    : failed
      ? t("shell.setup.agent.failed", "Your business analyst couldn't finish reading the new material.")
      : doneLine(factsOf(agent.lastDone), open, agent.suggestions.length - open.length);

  return (
    <section aria-label={t("shell.setup.agent.name", "Your business analyst")} className={cn("mb-6 overflow-hidden rounded-card bg-surface shadow-card dark:ring-1 dark:ring-line", className)}>
      <div className="flex min-h-[56px] items-center gap-3 px-4 py-3 sm:px-5">
        <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ai-soft text-[rgb(var(--c-ai-text))]", working && "animate-pulse")}>
          <FileSearch size={16} />
        </span>
        <p className="min-w-0 flex-1 text-[14px] text-ink" aria-live="polite">
          <span className="font-medium">{text}</span>
          {working && job?.message && job.message !== text && (
            <span className="ml-2 hidden truncate text-[13px] text-ink3 sm:inline">{job.message}</span>
          )}
        </p>
        {!working && open.length > 0 && (
          <Button size="sm" variant="secondary" className="shrink-0" iconRight={<ArrowRight size={14} aria-hidden />}
            onClick={() => setReviewing(true)} aria-label={t("shell.setup.agent.reviewLabel", "Review what your business analyst found ({count})", { count: open.length })}>
            {t("shell.setup.agent.review", "Review")}
          </Button>
        )}
        {failed && canEdit && inSetup && (
          <Button size="sm" variant="secondary" className="shrink-0" icon={<RotateCcw size={14} aria-hidden />} disabled={retrying} onClick={() => void tryAgain()}>{retrying ? t("shell.setup.agent.tryingAgain", "Trying again…") : t("common.actions.tryAgain", "Try again")}</Button>
        )}
      </div>
      {failed && retryError && <p role="alert" className="px-4 pb-3 text-[13px] text-danger sm:px-5">{retryError}</p>}
      {working && (
        <EasedJobBar progress={job?.progress ?? 0} working={job?.status === "claimed" || job?.status === "running"} resetKey={job?.id ?? ""}
          ticks={false} size="sm" label={t("shell.setup.agent.reading", "Your business analyst is reading")} className="rounded-none" />
      )}
      {reviewing && <SetupAgentReview project={project} canEdit={canEdit && inSetup} readOnlyReason={reviewReadOnlyReason({ inSetup, canEdit })}
        onClose={() => setReviewing(false)} />}
    </section>
  );
}
