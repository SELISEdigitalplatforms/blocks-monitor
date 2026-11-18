/** The ONE confirm dialog for locking the scope and its milestones together (design 13.1). Comments the team is still
 *  working on, and updates waiting for the person, are listed first; the person may lock anyway or go back. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";
import { queryClient } from "@/madp/blocks/queryClient";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { isEngineJobQuery } from "@/madp/blocks/engine/actions";
import { useProjectThreads } from "@/madp/blocks/collab/feedback";
import { useDesignBrief, useDesignScreens, useFeatures, useMilestones, useStories } from "@/madp/blocks/scope/hooks";
import { cachedScopeVersionStatus, isPendingScopeError, rereadScope, useScopeLock } from "@/madp/blocks/scope/mutations";
import { SCOPE_FEEDBACK_TARGETS } from "@/madp/blocks/scope/records";
import type { ScopeContext } from "@/madp/blocks/scope/context";
import { scopeErrorMessage } from "@/madp/blocks/scope/messages";
import { PendingFeedbackNote } from "@/madp/components/step/PendingFeedbackNote";
import { hasPendingFeedback, NO_PENDING_FEEDBACK, pendingFeedback, type PendingFeedback } from "@/madp/domain/pendingFeedback";
import { SUCCESS_KEYS, type SuccessKey } from "@/madp/domain/successTargets";
import { successShortName } from "@/madp/components/requirements/domainLabels";
import { parseProductPrototype } from "@/madp/domain/factoryDesign";
import { Button, Modal } from "@/madp/ui/kit";
import { boardPath } from "../links";
import { storySentence } from "./FeaturesPlan";
import { pendingOutcome } from "./UnlockDialog";
import { t, useT } from "@/madp/i18n";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface LockMilestoneLine { id: string; number: number; name: string; featureCount: number }
export interface LockCounts {
  features: number; stories: number;
  /** the scope's own screens (DesignScreen rows: drawn for the scope, often after the lock) */
  screens: number;
  /** the product design those screens follow from (the design brief); the dialog reads it when not given */
  design?: LockDesign | null;
}
/** The product design: its screen designs (0 for a design without a list of screens) and whether it was approved. */
export interface LockDesign { approved: boolean; screens: number }

/** The design part of the counts, from the design brief (null: no design yet), counted as the screens part counts it. */
export function lockDesign(brief: { status: string; prototypeJson: string | null } | null | undefined): LockDesign | null {
  const prototype = parseProductPrototype(brief?.prototypeJson);
  if (!prototype) return null;
  return { approved: brief?.status === "confirmed", screens: prototype.provider === "figma-design" ? prototype.screens.length : 0 };
}

/** The screens in the dialog's count line: the scope's own screens once there are any; before that the screens of the
 *  product design they follow from ("10 approved screen designs"), never "0 screens" over an approved design. */
export function lockScreensText(counts: LockCounts): string {
  const d = counts.design;
  if (counts.screens > 0 || !d) return plural(counts.screens, t("analysis.scope.word.screen", "screen"), t("analysis.scope.word.screens", "screens"));
  if (d.screens > 0) return d.approved
    ? plural(d.screens, t("analysis.scope.lockDialog.approvedDesignOne", "approved screen design"), t("analysis.scope.lockDialog.approvedDesignMany", "approved screen designs"))
    : plural(d.screens, t("analysis.scope.lockDialog.designOne", "screen design"), t("analysis.scope.lockDialog.designMany", "screen designs"));
  return d.approved ? t("analysis.scope.lockDialog.followApproved", "screens follow from the approved design") : t("analysis.scope.lockDialog.followDesign", "screens follow from the design");
}

export const LOCK_TEXT = "The scope and the milestones are frozen together. Your business analyst then plans the work on the board, milestone by milestone. You can unlock them until the build starts.";

export const lockDialogTitle = (n: number, milestones: number): string =>
  n > 1
    ? (milestones === 1 ? t("analysis.scope.lockDialog.titleVersionOne", "Lock scope version {n} and its 1 milestone?", { n })
      : t("analysis.scope.lockDialog.titleVersion", "Lock scope version {n} and its {count} milestones?", { n, count: milestones }))
    : (milestones === 1 ? t("analysis.scope.lockDialog.titleOne", "Lock the scope and its 1 milestone?")
      : t("analysis.scope.lockDialog.title", "Lock the scope and its {count} milestones?", { count: milestones }));

export const SLOW_NOTE = "MADP Factory is taking longer than usual. It is still working; keep this dialog open.";

/** True once `pending` has lasted `ms`; resets when it ends and clears its timer on unmount. */
export function useSlowNote(pending: boolean, ms = 25_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(timer);
  }, [pending, ms]);
  return slow;
}

/** Progress text while a lock or unlock runs; the slow note joins it after 25 s. */
export function LockProgress({ pending, slow, text }: { pending: boolean; slow: boolean; text: string }) {
  if (!pending) return null;
  return (
    <div role="status" className="mt-3 flex flex-col gap-1 text-[13px] text-ink2">
      <p>{text}</p>
      {slow && <p className="text-warning">{t("analysis.scope.lockDialog.slow", "MADP Factory is taking longer than usual. It is still working; keep this dialog open.")}</p>}
    </div>
  );
}


export const LOCK_WORKING_NOTE = "Your team is still answering these comments. If you lock now, the scope is frozen without their changes.";
export const LOCK_WAITING_NOTE = "Your team changed these after your comments. Have a look before you lock, or lock anyway.";

/** The scope items' plain names, for the feedback warning (null: the item is not in this scope version any more). */
export interface ScopeItemNames {
  features: readonly { id: string; name: string }[];
  stories: readonly { id: string; actor: string; text: string }[];
  milestones: readonly { id: string; number: number; name: string }[];
  screens: readonly { id: string; name: string; viewport: string }[];
}

export function scopeItemName(items: ScopeItemNames, type: string, id: string): string | null {
  switch (type) {
    case "feature": { const f = items.features.find((x) => x.id === id); return f ? f.name : null; }
    case "story": { const s = items.stories.find((x) => x.id === id); return s ? storySentence(s.actor, s.text) : null; }
    case "milestone": { const m = items.milestones.find((x) => x.id === id); return m ? (m.name.trim() || t("analysis.scope.milestoneN", "Milestone {n}", { n: m.number })) : null; }
    case "screen": {
      const s = items.screens.find((x) => x.id === id);
      return s ? (s.viewport === "mobile" ? t("analysis.scope.lockDialog.screenMobile", "{name} screen on mobile", { name: s.name }) : t("analysis.scope.lockDialog.screen", "{name} screen", { name: s.name })) : null;
    }
    case "success": return (SUCCESS_KEYS as readonly string[]).includes(id) ? successShortName(id as SuccessKey) : null;
    default: return null;
  }
}

/** The scope's comments still under way, read from the data the page already has. */
export function useScopePendingFeedback(ctx: ScopeContext, projectId: string, versionNumber: number): PendingFeedback {
  const threads = useProjectThreads(projectId).data;
  const features = useFeatures(ctx, versionNumber).data?.items;
  const stories = useStories(ctx, versionNumber).data?.items;
  const milestones = useMilestones(ctx, versionNumber).data?.items;
  const screens = useDesignScreens(ctx).data?.items;
  return useMemo(() => {
    if (!threads) return NO_PENDING_FEEDBACK;
    const items: ScopeItemNames = { features: features ?? [], stories: stories ?? [], milestones: milestones ?? [], screens: screens ?? [] };
    return pendingFeedback(threads.values(), SCOPE_FEEDBACK_TARGETS, (type, id) => scopeItemName(items, type, id));
  }, [threads, features, stories, milestones, screens]);
}

/** Shown while the dialog re-reads the milestones it lists (it opens on the latest plan, never an old one). */
export const READING_TEXT = "Reading the latest milestones…";
/** Why the lock waits in the dialog while a milestone re-plan runs (same words as the lock card). */
export const REPLAN_DIALOG_TEXT = "Your business analyst is re-planning the milestones. The list below updates when the new plan is in; you can lock then.";

/** What the dialog says (also rendered on its own in tests: the Modal itself is a portal). */
export function LockDialogBody({ counts, milestones, advisories, error, replanning = false, feedback = NO_PENDING_FEEDBACK }: {
  counts: LockCounts; milestones: readonly LockMilestoneLine[]; advisories: readonly string[]; error: string | null; replanning?: boolean;
  /** comments still under way on the scope's items */
  feedback?: PendingFeedback;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <PendingFeedbackNote pending={feedback}
        workingNote={t("analysis.scope.lockDialog.workingNote", "Your team is still answering these comments. If you lock now, the scope is frozen without their changes.")}
        waitingNote={t("analysis.scope.lockDialog.waitingNote", "Your team changed these after your comments. Have a look before you lock, or lock anyway.")} />
      <p className="text-[14px] text-ink2">
        {plural(counts.features, t("analysis.scope.word.feature", "feature"), t("analysis.scope.word.features", "features"))} · {plural(counts.stories, t("analysis.scope.word.userStory", "user story"), t("analysis.scope.word.userStories", "user stories"))} · {lockScreensText(counts)}
      </p>
      <ol className="divide-y divide-line overflow-hidden rounded-block bg-surface2">
        {milestones.map((m) => (
          <li key={m.id} className="flex items-baseline gap-3 px-4 py-2.5 text-[13.5px]">
            <span className="w-6 shrink-0 font-mono text-[11.5px] text-ink3">{m.number}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
            <span className="num shrink-0 text-ink3">{plural(m.featureCount, t("analysis.scope.word.feature", "feature"), t("analysis.scope.word.features", "features"))}</span>
          </li>
        ))}
      </ol>
      {advisories.length > 0 && (
        <ul className="space-y-1 text-[13px] text-ink2">{advisories.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
      {replanning && <p role="status" className="text-[13px] text-warning">{t("analysis.scope.lockDialog.replan", "Your business analyst is re-planning the milestones. The list below updates when the new plan is in; you can lock then.")}</p>}
      <p className="text-[13px] text-ink2">{t("analysis.scope.lockDialog.text", "The scope and the milestones are frozen together. Your business analyst then plans the work on the board, milestone by milestone. You can unlock them until the build starts.")}</p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function LockDialog({ ctx, open, onClose, projectId, versionId, versionNumber, counts, milestones, advisories, replanning = false }: {
  ctx: ScopeContext; open: boolean; onClose: () => void; projectId: string; versionId: string; versionNumber: number;
  counts: LockCounts; milestones: readonly LockMilestoneLine[]; advisories: readonly string[];
  /** a milestones.suggest job is still queued or running: the lock waits for its plan */
  replanning?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const lock = useScopeLock(ctx);
  const feedback = useScopePendingFeedback(ctx, projectId, versionNumber);
  // the screens of the product design (the same read as the screens part): the scope's own are drawn later
  const brief = useDesignBrief(ctx).data ?? null;
  const design = useMemo(() => lockDesign(brief), [brief]);
  const shown = useMemo(() => (counts.design === undefined ? { ...counts, design } : counts), [counts, design]);
  const pending = hasPendingFeedback(feedback);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const workspaceId = ctx.workspaceId ?? "";
  // on open, the milestones and the jobs are read again: the list shown is what the lock freezes
  useEffect(() => {
    if (!open || !workspaceId) return;
    void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Milestone") }).catch(() => undefined);
    void queryClient.invalidateQueries({ predicate: isEngineJobQuery }).catch(() => undefined);
  }, [open, workspaceId]);
  const reading = useIsFetching({ queryKey: blocksKeys.schema(workspaceId, "Milestone") }) > 0 && open;
  const busy = lock.isPending || checking;
  const slow = useSlowNote(lock.isPending);
  const close = () => { setError(null); onClose(); };
  const confirm = () => {
    if (replanning || reading) return;
    setError(null);
    lock.mutate({ projectId, scopeVersionId: versionId }, {
      onSuccess: () => { onClose(); navigate(boardPath(projectId)); },
      onError: async (e: unknown) => {
        if (!isPendingScopeError(e)) { setError(scopeErrorMessage(e)); return; }
        setChecking(true);
        try {
          await rereadScope(queryClient, ctx.workspaceId ?? "", "scope.lock", projectId);
          if (pendingOutcome("scope.lock", cachedScopeVersionStatus(queryClient, ctx.workspaceId ?? "", versionId)) === "landed") {
            setChecking(false);
            onClose();
            navigate(boardPath(projectId));
            return;
          }
        } catch { /* fall through to the error */ }
        setChecking(false);
        setError(scopeErrorMessage(e));
      },
    });
  };
  return (
    <Modal open={open} onClose={close} title={lockDialogTitle(versionNumber, milestones.length)}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={checking}>{pending ? t("analysis.scope.lockDialog.goBack", "Go back") : t("analysis.scope.cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={confirm} disabled={busy || replanning || reading}>{busy ? t("analysis.scope.lockDialog.locking", "Locking…") : pending ? t("analysis.scope.lockDialog.lockAnyway", "Lock anyway") : t("analysis.scope.lock.lockScope", "Lock the scope")}</Button>
      </>}>
      <LockDialogBody counts={shown} milestones={milestones} advisories={advisories} error={error} replanning={replanning} feedback={feedback} />
      {reading && !busy && !replanning && <p role="status" className="mt-3 text-[13px] text-ink2">{t("analysis.scope.lockDialog.reading", "Reading the latest milestones…")}</p>}
      <LockProgress pending={busy} slow={slow} text={checking ? t("analysis.scope.lockDialog.checking", "Checking whether the lock went through…") : t("analysis.scope.lockDialog.lockingAll", "Locking the scope and its milestones…")} />
    </Modal>
  );
}
