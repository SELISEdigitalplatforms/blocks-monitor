// "Draft v1 with MADP": the engine hold-up point of Requirements v1. It only queues a requirements.draft job and
// shows that job's real state; the editor beside it is never locked.
import { isLandingJob } from "@/domain/landingPage";
import { useId, useState } from "react";
import { Factory } from "lucide-react";
import { Button, Label, Textarea } from "@/ui/kit";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { cancelEngineJob, engineErrorMessage, retryEngineJob } from "@/blocks/engine/actions";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "@/blocks/engine/types";
import { useDraftInitial } from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { useT } from "@/i18n";

const INSTRUCTION_MAX = 2000;

export function DraftV1Panel({ workspaceId, projectId, canEdit, jobs }: {
  workspaceId: string; projectId: string; canEdit: boolean; jobs: readonly EngineJob[];
}) {
  const t = useT();
  const draft = useDraftInitial({ workspaceId, projectId });
  const [instruction, setInstruction] = useState("");
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const job = latestEngineJob(jobs.filter((j) => !isLandingJob(j)), "requirements.draft");
  const requestError = draft.error ? sanitizationErrorText(draft.error) : null;

  const retry = async () => {
    if (!job) return;
    setRetrying(true);
    setActionNote(null);
    try { await retryEngineJob(job.id); } catch (e) { setActionNote(engineErrorMessage(e)); } finally { setRetrying(false); }
  };
  const running = !!job && isActiveEngineJob(job);
  const runningId = useId();
  const cancel = async () => {
    if (!job) return;
    setActionNote(null);
    try { await cancelEngineJob(job.id); setActionNote(t("settings.sanitization.draft.cancelled", "The draft job was cancelled.")); } catch (e) { setActionNote(engineErrorMessage(e)); }
  };

  return (
    <section aria-label={t("settings.sanitization.draft.ariaLabel", "MADP draft")} className="space-y-3 rounded-block bg-surface2 p-4">
      {canEdit && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2"><Label>{t("settings.sanitization.draft.instructionLabel", "Anything the business analyst should keep in mind? (optional)")}</Label></div>
          <Textarea
            aria-label={t("settings.sanitization.draft.instructionAria", "Instruction for MADP (optional)")} value={instruction} maxLength={INSTRUCTION_MAX}
            onChange={(e) => setInstruction(e.target.value)} className="min-h-[72px]"
          />
          {/* while a draft runs the server hands back that job and ignores a new instruction: say so instead of accepting it */}
          <Button
            variant="secondary" icon={<Factory size={16} strokeWidth={1.75} aria-hidden />} disabled={draft.isPending || running}
            aria-describedby={running ? runningId : undefined}
            onClick={() => draft.mutate({ projectId, instruction: instruction.trim() === "" ? undefined : instruction.trim() })}
          >
            {job ? t("settings.sanitization.draft.writeAgain", "Write the draft again") : t("settings.sanitization.draft.write", "Write the draft requirements")}
          </Button>
          {running && <p id={runningId} className="text-[13px] text-ink3">{t("settings.sanitization.draft.running", "A draft is already running. Cancel it to start one with a new instruction.")}</p>}
        </div>
      )}
      {(job || requestError) && (
        <EngineJobStatus job={job} variant="full" canRetry={canEdit} onRetry={retry} retrying={retrying} requestError={requestError} />
      )}
      {canEdit && job && isActiveEngineJob(job) && (
        <Button variant="ghost" size="sm" onClick={cancel}>{t("settings.sanitization.draft.cancel", "Cancel")}</Button>
      )}
      {actionNote && <p role="status" className="text-[13px] text-ink2">{actionNote}</p>}
    </section>
  );
}
