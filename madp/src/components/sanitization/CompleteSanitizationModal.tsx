/** The confirmation before Product sanitization completes: what still blocks it, and the one confirming action. */
import { isLandingJob } from "@/domain/landingPage";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cancelEngineJob, engineErrorMessage } from "@/blocks/engine/actions";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob } from "@/blocks/engine/types";
import { useClarifications, useRequirementsV1 } from "@/blocks/sanitization/hooks";
import { blockerSection, blockerText, sanitizationErrorText } from "@/blocks/sanitization/messages";
import { useCompleteSanitization } from "@/blocks/sanitization/ops";
import { formatNumber } from "@/domain/numbering";
import { completionBlockers } from "@/domain/sanitization";
import { Button, Modal } from "@/ui/kit";
import type { UnsavedItem } from "./requirementsDraft";
import { sectionHref } from "./shared";
import { settleV1Autosave, v1FieldId } from "./v1Autosave";
import { t, useT } from "@/i18n";

interface Blocker { messageKey: string; params?: Record<string, unknown> }

/** Runs `start` once while a call is in flight: the flag is set synchronously, `start` hands back the reset. */
export function startOnce(flag: { current: boolean }, start: (done: () => void) => void): boolean {
  if (flag.current) return false;
  flag.current = true;
  start(() => { flag.current = false; });
  return true;
}

/** The blocker line for something in the Requirements v1 editor that is not saved yet. */
export function unsavedText(item: UnsavedItem): string {
  if (item.kind === "objective") return t("settings.sanitization.complete.unsavedObjective", "You have unsaved changes in the objective.");
  if (item.kind === "requirement") {
    return item.number !== null
      ? t("settings.sanitization.complete.unsavedRequirement", "You have unsaved changes in {number}.", { number: formatNumber("R", item.number) })
      : t("settings.sanitization.complete.unsavedNew", "You have unsaved changes in a new requirement.");
  }
  return item.count === 1
    ? t("settings.sanitization.complete.unsavedOneRemoved", "You have unsaved changes: a removed requirement isn't saved yet.")
    : t("settings.sanitization.complete.unsavedRemoved", "You have unsaved changes: {count} removed requirements aren't saved yet.", { count: item.count });
}

/** Whether "Confirm understanding" must stay disabled. */
export function completeDisabled(s: { loading: boolean; settling: boolean; pending: boolean; unsaved: readonly unknown[]; blockers: readonly unknown[] }): boolean {
  return s.loading || s.settling || s.pending || s.unsaved.length > 0 || s.blockers.length > 0;
}

/** Sends every pending Requirements v1 autosave, waits for it, and completes only when nothing is left unsaved. */
export async function settleThenComplete(
  projectId: string, complete: () => void,
  settle: (projectId: string) => Promise<UnsavedItem[]> = settleV1Autosave,
): Promise<UnsavedItem[]> {
  const left = await settle(projectId);
  if (left.length === 0) complete();
  return left;
}

export function CompletionChecklist({ projectId, blockers, draftJobId, onNavigate, onCancelDraft, cancelling, unsaved = [] }: {
  projectId: string; blockers: readonly Blocker[]; draftJobId: string | null; onNavigate: () => void; onCancelDraft: () => void; cancelling: boolean;
  unsaved?: readonly UnsavedItem[];
}) {
  const t = useT();
  if (blockers.length === 0 && unsaved.length === 0) {
    return <p className="text-[14px] text-ink2">{t("settings.sanitization.complete.ready", "Everything is ready. The draft requirements are saved as the first version and the project moves on to Goals & requirements.")}</p>;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {unsaved.map((item, i) => {
        const id = v1FieldId(item);
        return (
          <li key={`unsaved-${i}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[14px]">
            <span className="min-w-0 break-words text-ink2">{unsavedText(item)}</span>
            <Link to={sectionHref(projectId, "requirements") + (id ? "#" + id : "")} onClick={onNavigate}
              className="rounded-md font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
              {id ? t("settings.sanitization.complete.openField", "Open field") : t("settings.sanitization.complete.openSection", "Open section")}
            </Link>
          </li>
        );
      })}
      {blockers.map((b, i) => (
        <li key={`${b.messageKey}-${i}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[14px]">
          <span className="min-w-0 break-words text-ink2">{blockerText(b)}</span>
          <Link to={sectionHref(projectId, blockerSection(b.messageKey))} onClick={onNavigate}
            className="rounded-md font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
            {t("settings.sanitization.complete.openSection", "Open section")}
          </Link>
          {/draft/i.test(b.messageKey) && draftJobId && (
            <Button size="sm" variant="ghost" disabled={cancelling} onClick={onCancelDraft}>{t("settings.sanitization.complete.cancelDraft", "Cancel the MADP draft")}</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CompleteSanitizationModal({ open, onClose, workspaceId, projectId }: {
  open: boolean; onClose: () => void; workspaceId: string; projectId: string;
}) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const navigate = useNavigate();
  const clarifications = useClarifications(ctx);
  const requirements = useRequirementsV1(ctx);
  const jobs = useEngineJobs(projectId, ["requirements.draft"]);
  const complete = useCompleteSanitization(ctx);
  const [cancelling, setCancelling] = useState(false);
  const [cancelResult, setCancelResult] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [unsaved, setUnsaved] = useState<UnsavedItem[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setSettling(true);
    void settleV1Autosave(projectId).then((left) => {
      if (!live) return;
      setUnsaved(left);
      setSettling(false);
    });
    return () => { live = false; };
  }, [open, projectId]);

  const draft = latestEngineJob((jobs.data ?? []).filter((j) => !isLandingJob(j)), "requirements.draft");
  const blockers = completionBlockers({
    clarifications: (clarifications.data ?? []).map((c) => ({ status: c.Status })),
    requirements: (requirements.requirements ?? []).map((r) => ({
      number: r.Number, title: r.Title ?? "", acceptanceCriteria: r.AcceptanceCriteria ?? [],
    })),
    objective: requirements.objective ? { statement: requirements.objective.Statement ?? "" } : null,
    activeDraftJob: draft && isActiveEngineJob(draft) ? { id: draft.id, status: draft.status } : null,
  });
  const loading = clarifications.isLoading || requirements.isLoading || jobs.isLoading;

  const cancelDraft = async () => {
    if (!draft) return;
    setCancelling(true);
    try { await cancelEngineJob(draft.id); setCancelResult(t("settings.sanitization.complete.draftCancelled", "The MADP draft was cancelled.")); }
    catch (e) { setCancelResult(engineErrorMessage(e)); }
    finally { setCancelling(false); }
  };

  const inFlight = useRef(false);
  const confirm = () => {
    startOnce(inFlight, (done) => {
      setSettling(true);
      // Awaited, not a mutate() callback: the completed project refetches before the call settles, and this modal (shown
      // only while the step is open) unmounts with it, which would drop a per-call onSuccess and leave the person here.
      void settleThenComplete(projectId, () => {
        complete.mutateAsync({ projectId }).then(
          () => navigate("/p/" + projectId + "/requirements"),
          () => undefined, // the error is shown from complete.error
        ).finally(done);
      }).then((left) => {
        setUnsaved(left);
        setSettling(false);
        if (left.length > 0) done();
      });
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t("settings.sanitization.complete.title", "Confirm understanding")}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("settings.sanitization.complete.notYet", "Not yet")}</Button>
          <Button variant="primary" disabled={completeDisabled({ loading, settling, pending: complete.isPending, unsaved, blockers })} aria-busy={complete.isPending || settling} onClick={confirm}>{t("settings.sanitization.complete.title", "Confirm understanding")}</Button>
        </>
      )}>
      <div className="flex min-w-0 flex-col gap-4">
        {settling && <p role="status" className="text-[13px] text-ink2">{t("settings.sanitization.complete.settling", "Saving your latest Requirements v1 changes…")}</p>}
        <CompletionChecklist projectId={projectId} blockers={blockers} draftJobId={draft?.id ?? null} unsaved={unsaved}
          onNavigate={onClose} onCancelDraft={() => void cancelDraft()} cancelling={cancelling} />
        {cancelResult && <p role="status" className="text-[13px] text-ink2">{cancelResult}</p>}
        {complete.error != null && <p role="alert" className="break-words text-[13px] text-danger">{sanitizationErrorText(complete.error)}</p>}
      </div>
    </Modal>
  );
}
