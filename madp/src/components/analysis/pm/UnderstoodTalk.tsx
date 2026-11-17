/** "Confirm what we understood": the business analyst sums up what it read and asks you to confirm. The confirm is the
 *  Project understanding step's own action (UnderstandingStep.tsx): confirmBrief (POST /api/brief/:id/confirm), then
 *  the business analyst's questions job (sanitization.assist, focus clarifications) when it never ran. */
import { useState } from "react";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectRecord } from "@/blocks/projects/records";
import { useCan } from "@/blocks/projects/context";
import { blocksKeys } from "@/blocks/data/keys";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob } from "@/blocks/engine/types";
import { latestAssistJob } from "@/blocks/sanitization/hooks";
import { useAskMadp } from "@/blocks/sanitization/ops";
import { stepIndex } from "@/domain/journey";
import { BriefRequestError, confirmBrief, type Brief } from "@/components/understanding/briefApi";
import { fileCounts, fileState } from "@/components/understanding/model";
import { Button } from "@/ui/kit";
import { readLine } from "./pmModel";
import { PmSays, TalkNote } from "./Talk";
import { useT } from "@/i18n";

export const briefKey = (projectId: string) => ["understanding-brief", projectId] as const;

export function UnderstoodTalk({ project, workspaceId, brief, briefError, waitingForBrief }: {
  project: ProjectRecord; workspaceId: string | null; brief: Brief | null; briefError: boolean; waitingForBrief: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = useCan("business.edit");
  const jobs = useEngineJobs(project.id, ["sanitization.assist"]).data ?? [];
  const ask = useAskMadp({ workspaceId: workspaceId ?? "", projectId: project.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!brief) {
    return <PmSays>{briefError ? t("analysis.workspace.understood.openFailed", "I couldn't open what I read from your project just now. Try again in a moment.") : t("analysis.workspace.understood.reading", "I'm reading your project setup and files…")}</PmSays>;
  }
  // "I read … N files": the files really read (not those still being read, failed, not read or not supported)
  const files = fileCounts(brief.attachmentStatus).read;
  const reading = brief.attachmentStatus.filter((f) => ["processing", "pending"].includes(fileState(f.status))).length;
  const requirements = brief.features.reduce((n, f) => n + f.confirmedRequirements.length + f.proposedRequirements.length, 0);
  const conflicts = brief.conflicts.filter((c) => !c.resolution).length;
  const signed = Boolean(brief.confirmedAt) || stepIndex(project.step) > stepIndex("sanitization");

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(briefKey(project.id), await confirmBrief(project.id));
      const job = latestAssistJob(jobs, "clarifications");
      if (workspaceId && (!job || !(isActiveEngineJob(job) || job.status === "succeeded"))) {
        await ask.mutateAsync({ projectId: project.id, focus: "clarifications" }).catch(() => undefined);
      }
      if (workspaceId) await qc.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Project") });
    } catch (e) {
      setError(e instanceof BriefRequestError && e.code === "conflicts_open" ? t("analysis.workspace.understood.settleFirst", "Settle the disagreements first; they are marked on the right.")
        : e instanceof BriefRequestError && e.status === 401 ? t("analysis.workspace.sessionEnded", "Your session has ended. Sign in again to continue.")
        : e instanceof BriefRequestError && (e.status === 403 || e.status === 404) ? t("analysis.workspace.noAccess", "You don't have access to this project.")
        : t("analysis.workspace.saveFailed", "We couldn't save that just now. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const summary = [
    readLine(files),
    requirements === 1 ? t("analysis.workspace.understood.foundOne", "I found one requirement so far.")
      : requirements ? t("analysis.workspace.understood.foundMany", "I found {count} requirements so far.", { count: requirements })
      : t("analysis.workspace.understood.noneNamed", "Your material didn't name requirements yet; we'll work them out together."),
    conflicts === 1 ? t("analysis.workspace.understood.conflictOne", "One point disagrees between your sources; please settle it on the right.")
      : conflicts ? t("analysis.workspace.understood.conflictMany", "{count} points disagree between your sources; please settle them on the right.", { count: conflicts })
      : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-3">
      <PmSays>{summary} {signed ? "" : t("analysis.workspace.understood.haveALook", "Have a look at “What we understood” on the right. If it's right, confirm it and I'll move on to my questions.")}</PmSays>
      {reading > 0 && <TalkNote>{reading === 1 ? t("analysis.workspace.understood.oneReading", "One file is still being read.") : t("analysis.workspace.understood.manyReading", "{count} files are still being read.", { count: reading })} {t("analysis.workspace.understood.confirmOnceDone", "You can confirm once it's done.")}</TalkNote>}
      {signed ? (
        <p className="flex items-center gap-2 text-[13px] text-success"><Check size={14} aria-hidden />{t("analysis.workspace.understood.confirmed", "Confirmed")}</p>
      ) : canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} disabled={busy || reading > 0 || waitingForBrief} onClick={() => void confirm()}>
            {busy ? t("analysis.workspace.understood.confirming", "Confirming…") : t("analysis.workspace.understood.confirm", "Confirm understanding")}
          </Button>
        </div>
      ) : (
        <TalkNote>{t("analysis.workspace.understood.teamConfirms", "The project team confirms this.")}</TalkNote>
      )}
      {error && <TalkNote tone="danger">{error}</TalkNote>}
    </div>
  );
}
