/** A project's work behind the scenes (its engine jobs), shown as "Team activity": each piece of work with its real
 *  state, newest first. */
import { useState } from "react";
import { Factory } from "lucide-react";
import { Card, Chip, EmptyState } from "@/madp/ui/kit";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import { isActiveEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import { type EngineJobKind } from "@/madp/domain/engineJob";
import { ENGINE_JOB_KIND_TEXT as ENGINE_JOB_KIND_LABEL } from "@/madp/components/engine/jobWords";
import { useT } from "@/madp/i18n";
import { EngineJobStatus, type EngineJobOutput } from "./EngineJobStatus";

export interface EngineJobListViewProps {
  /** Undefined while loading or when reading failed. */
  jobs: EngineJob[] | undefined;
  loading?: boolean;
  error?: string | null;
  engineConnected?: boolean;
  now?: number;
  canRetry?: boolean;
  onRetry?: (job: EngineJob) => void;
  retryingId?: string | null;
  /** The reason the last action on one job failed. */
  actionError?: { jobId: string; message: string } | null;
  /** Where a succeeded job's result can be opened. */
  outputFor?: (job: EngineJob) => EngineJobOutput | null | undefined;
}

export function EngineJobListView({
  jobs, loading, error, engineConnected, now, canRetry, onRetry, retryingId, actionError, outputFor,
}: EngineJobListViewProps) {
  const t = useT();
  const active = jobs ? jobs.filter(isActiveEngineJob).length : 0;
  return (
    <Card title={t("studio.engine.list.title", "Team activity")} icon={<Factory size={18} strokeWidth={1.75} aria-hidden />}
      action={active > 0 ? <Chip tone="accent">{t("studio.engine.list.inProgress", "{count} in progress", { count: active })}</Chip> : undefined}>
      {error ? (
        <p role="alert" className="text-[14px] text-[rgb(var(--c-danger-text))]">{error}</p>
      ) : !jobs ? (
        loading ? <p role="status" className="text-[14px] text-ink2">{t("studio.engine.list.loading", "Loading…")}</p> : null
      ) : jobs.length === 0 ? (
        <EmptyState icon={<Factory size={24} strokeWidth={1.75} aria-hidden />} title={t("studio.engine.list.emptyTitle", "Nothing in progress yet")}
          text={t("studio.engine.list.emptyText", "Work your team does on this project shows up here.")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id} className="min-w-0">
              <div className="mb-1 text-[13px] font-medium text-ink2">{ENGINE_JOB_KIND_LABEL[job.kind]}</div>
              <EngineJobStatus job={job} variant="compact" engineConnected={engineConnected} now={now}
                output={job.status === "succeeded" ? outputFor?.(job) : null}
                canRetry={canRetry} onRetry={onRetry ? () => onRetry(job) : undefined} retrying={retryingId === job.id} />
              {actionError?.jobId === job.id && (
                <p role="alert" className="mt-1 text-[13px] text-[rgb(var(--c-danger-text))]">{actionError.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The live list for one project: reads through the data layer, retries through the Logic Function. */
export function EngineJobList({ projectId, kinds, canRetry, engineConnected, outputFor }: {
  projectId: string;
  kinds?: readonly EngineJobKind[];
  canRetry?: boolean;
  engineConnected?: boolean;
  outputFor?: (job: EngineJob) => EngineJobOutput | null | undefined;
}) {
  const q = useEngineJobs(projectId, kinds);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ jobId: string; message: string } | null>(null);

  const retry = async (job: EngineJob) => {
    setRetryingId(job.id);
    setActionError(null);
    try {
      await retryEngineJob(job.id);
    } catch (e) {
      setActionError({ jobId: job.id, message: engineErrorMessage(e) });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <EngineJobListView jobs={q.data} loading={q.isLoading} error={q.error ? q.error.message : null}
      engineConnected={engineConnected} canRetry={canRetry} onRetry={retry} retryingId={retryingId}
      actionError={actionError} outputFor={outputFor} />
  );
}
