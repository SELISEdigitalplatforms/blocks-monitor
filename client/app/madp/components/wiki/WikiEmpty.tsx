/** The empty wiki, and the one place that asks the team to write the wiki (also used by the header action). */
import { useState } from "react";
import { BookOpen, Factory, Plus } from "lucide-react";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { retryEngineJob, engineErrorMessage } from "@/madp/blocks/engine/actions";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { useGenerateWiki, useWikiJob } from "@/madp/blocks/collab/wiki";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { newRequestId } from "@/madp/blocks/fn";
import { Button, Card } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

/** Asking the team to write or update the wiki: the job's real state, the request, and Retry for a failed job. */
export function useWikiGenerate(projectId: string) {
  const { job } = useWikiJob(projectId);
  const generate = useGenerateWiki();
  const [requestId, setRequestId] = useState(newRequestId);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = job !== null && isActiveEngineJob(job);

  const start = () => {
    setError(null);
    generate.mutate({ projectId, requestId }, {
      onSuccess: () => setRequestId(newRequestId()),
      onError: (e) => setError(collabErrorMessage(e)),
    });
  };
  const retry = async () => {
    if (!job) return;
    setRetrying(true);
    setError(null);
    try { await retryEngineJob(job.id); } catch (e) { setError(engineErrorMessage(e)); } finally { setRetrying(false); }
  };
  return { job, active, requesting: generate.isPending, error, start, retry, retrying };
}

export type WikiGenerate = ReturnType<typeof useWikiGenerate>;

/** The job status line (compact) with its request error; nothing when there is no job and no error. */
export function WikiJobLine({ gen, canEdit }: { gen: WikiGenerate; canEdit: boolean }) {
  if (!gen.job && !gen.error) return null;
  return (
    <div role="status" className="mb-6">
      <EngineJobStatus job={gen.job} variant="compact" canRetry={canEdit} onRetry={gen.retry} retrying={gen.retrying} requestError={gen.error} />
    </div>
  );
}

export function WikiEmpty({ projectId, canEdit, gen, onAdd }: { projectId: string; canEdit: boolean; gen: WikiGenerate; onAdd: () => void }) {
  const t = useT();
  return (
    <Card>
      <div className="grid place-items-center rounded-block hatched bg-surface2 px-6 py-12 text-center" data-project={projectId}>
        <BookOpen size={28} strokeWidth={1.5} className="mb-3 text-ink3" aria-hidden />
        <div className="text-[16px] font-medium">{t("wiki.empty.title", "No pages yet")}</div>
        <p className="mt-1 max-w-md text-[14px] text-ink2">
          {t("wiki.empty.text", "Your team writes the wiki from what this project has agreed so far. You can also add a page yourself.")}
        </p>
        {gen.job || gen.error ? (
          <div className="mt-4 w-full max-w-md text-left">
            <EngineJobStatus job={gen.job} canRetry={canEdit} onRetry={gen.retry} retrying={gen.retrying} requestError={gen.error} />
          </div>
        ) : null}
        {canEdit ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {!gen.active && (
              <Button variant="primary" icon={<Factory size={16} strokeWidth={1.75} aria-hidden />} disabled={gen.requesting} onClick={gen.start}>
                {gen.requesting ? t("wiki.common.starting", "Starting…") : t("wiki.empty.write", "Write the wiki")}
              </Button>
            )}
            <Button variant="ghost" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={onAdd}>{t("wiki.common.addPage", "Add a page")}</Button>
          </div>
        ) : (
          <ViewOnlyNote id="wiki-view-only" className="mt-4" />
        )}
      </div>
    </Card>
  );
}
