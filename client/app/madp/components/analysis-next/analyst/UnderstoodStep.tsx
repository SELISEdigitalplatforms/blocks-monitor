/** "Check what I understood": the analyst sums up what it read and asks you to confirm. The confirm is the Project
 *  understanding step's own action, as in today's panel (analysis/pm/UnderstoodTalk.tsx): confirmBrief
 *  (POST /api/brief/:id/confirm), then the questions job (sanitization.assist, focus clarifications) when it never ran.
 *  A live product past the analysis (`live`): confirmed only when the brief itself was; otherwise it says only what was
 *  read (no confirm: there is no analysis to move on to). */
import { useState } from "react";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useCan } from "@/madp/blocks/projects/context";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { latestAssistJob } from "@/madp/blocks/sanitization/hooks";
import { useAskMadp } from "@/madp/blocks/sanitization/ops";
import { stepIndex } from "@/madp/domain/journey";
import { BriefRequestError, confirmBrief, type Brief } from "@/madp/components/understanding/briefApi";
import { fileCounts, fileState } from "@/madp/components/understanding/model";
import { Button } from "@/madp/ui/kit";
import { DOC_PART_LABEL, type DocPart } from "../model";
import { briefKey, liveReadLine, readLine } from "./analystModel";
import { AnalystSays, ErrorNote, Note, PartLink } from "./Talk";
import { useT } from "@/madp/i18n";

export function UnderstoodStep({ project, workspaceId, brief, briefError, waitingForBrief, live = false, onPart }: {
  project: ProjectRecord; workspaceId: string | null; brief: Brief | null; briefError: boolean; waitingForBrief: boolean;
  /** An existing product attached as it is live, past the analysis: its step says nothing about a confirmation. */
  live?: boolean;
  onPart: (part: DocPart) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = useCan("business.edit");
  const jobs = useEngineJobs(project.id, ["sanitization.assist"]).data ?? [];
  const ask = useAskMadp({ workspaceId: workspaceId ?? "", projectId: project.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRetry, setErrorRetry] = useState(true);

  if (!brief) {
    return briefError
      ? <ErrorNote text={t("analysis.analyst.understood.openFailed", "I couldn't open what I read from your project just now.")} onRetry={() => void qc.invalidateQueries({ queryKey: briefKey(project.id) })} />
      : <AnalystSays className="text-ink2">{t("analysis.workspace.understood.reading", "I'm reading your project setup and files…")}</AnalystSays>;
  }
  // "I read … N files": the files really read (not those still being read, failed, not read or not supported)
  const files = fileCounts(brief.attachmentStatus).read;
  const reading = brief.attachmentStatus.filter((f) => ["processing", "pending"].includes(fileState(f.status))).length;
  const requirements = brief.features.reduce((n, f) => n + f.confirmedRequirements.length + f.proposedRequirements.length, 0);
  const conflicts = brief.conflicts.filter((c) => !c.resolution).length;
  const signed = Boolean(brief.confirmedAt) || (!live && stepIndex(project.step) > stepIndex("sanitization"));
  if (live && !signed) {
    return (
      <AnalystSays>
        {liveReadLine(fileCounts(brief.attachmentStatus).read)} {t("analysis.analyst.understood.seeThemIn", "You can see them in")} <PartLink onClick={() => onPart("files")}>{DOC_PART_LABEL.files}</PartLink>.
      </AnalystSays>
    );
  }

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
      // disagreements, an ended session or no access: trying again cannot help
      setErrorRetry(!(e instanceof BriefRequestError && (e.code === "conflicts_open" || e.status === 401 || e.status === 403 || e.status === 404)));
      setError(e instanceof BriefRequestError && e.code === "conflicts_open" ? t("analysis.analyst.understood.settleFirst", "A few points still disagree between your sources. Settle them in “What we understood” first.")
        : e instanceof BriefRequestError && e.status === 401 ? t("analysis.workspace.sessionEnded", "Your session has ended. Sign in again to continue.")
        : e instanceof BriefRequestError && (e.status === 403 || e.status === 404) ? t("analysis.workspace.noAccess", "You don't have access to this project.")
        : t("analysis.analyst.understood.saveFailed", "I couldn't save that just now."));
    } finally {
      setBusy(false);
    }
  };

  const found = requirements === 1 ? t("analysis.workspace.understood.foundOne", "I found one requirement so far.")
    : requirements ? t("analysis.workspace.understood.foundMany", "I found {count} requirements so far.", { count: requirements })
    : t("analysis.analyst.understood.noneNamed", "Your material doesn't name requirements yet. We'll work them out together.");
  const retryable = error !== null && errorRetry;

  return (
    <div className="flex flex-col gap-3.5">
      <AnalystSays>{readLine(files)} {found}</AnalystSays>
      {conflicts > 0 && (
        <AnalystSays className="text-ink2">
          {conflicts === 1 ? t("analysis.analyst.understood.conflictOne", "One point disagrees between your sources.") : t("analysis.analyst.understood.conflictMany", "{count} points disagree between your sources.", { count: conflicts })} {conflicts === 1 ? t("analysis.analyst.understood.settleItIn", "Please settle it in") : t("analysis.analyst.understood.settleThemIn", "Please settle them in")}{" "}
          <PartLink onClick={() => onPart("understood")}>{t("analysis.analyst.understood.linkUnderstood", "What we understood")}</PartLink>.
        </AnalystSays>
      )}
      {!signed && (
        <AnalystSays className="text-ink2">
          {t("analysis.analyst.understood.haveALookAt", "Have a look at")} <PartLink onClick={() => onPart("understood")}>{t("analysis.analyst.understood.linkUnderstood", "What we understood")}</PartLink>.{" "}
          {/* the hand-over starts the questions straight away: once they run, confirming does not start them */}
          {stepIndex(project.step) >= stepIndex("sanitization") ? t("analysis.analyst.understood.ifRight", "If it's right, confirm it.") : t("analysis.analyst.understood.ifRightQuestions", "If it's right, confirm it and I'll move on to my questions.")}
        </AnalystSays>
      )}
      {reading > 0 && <Note>{reading === 1 ? t("analysis.workspace.understood.oneReading", "One file is still being read.") : t("analysis.workspace.understood.manyReading", "{count} files are still being read.", { count: reading })} {t("analysis.workspace.understood.confirmOnceDone", "You can confirm once it's done.")}</Note>}
      {signed ? (
        <p className="flex items-center gap-2 text-[14px] text-success"><Check size={15} aria-hidden />{t("analysis.workspace.understood.confirmed", "Confirmed")}</p>
      ) : canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="md" variant="primary" data-analyst-action="" icon={<Check size={15} aria-hidden />} disabled={busy || reading > 0 || waitingForBrief}
            onClick={() => void confirm()}>
            {busy ? t("analysis.workspace.understood.confirming", "Confirming…") : t("analysis.analyst.understood.confirm", "Confirm")}
          </Button>
        </div>
      ) : (
        <Note>{t("analysis.analyst.understood.someoneConfirms", "Someone on the project team with edit rights confirms this.")}</Note>
      )}
      {error && <ErrorNote text={error} busy={busy} onRetry={retryable ? () => void confirm() : undefined} />}
    </div>
  );
}

