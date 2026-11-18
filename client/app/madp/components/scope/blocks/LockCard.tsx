/** The lock card (aside): the checklist, the advisory lines, and the page's ONE primary action: "Lock scope and
 *  milestones" before the lock, "Open the board" after it. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Circle, Lock } from "lucide-react";
import type { ScopeContext } from "@/madp/blocks/scope/context";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { boardPath } from "../links";
import { dateOf, lockedLine } from "./ScopeHeader";
import { t, useT } from "@/madp/i18n";
import { LockDialog, type LockCounts, type LockMilestoneLine } from "./LockDialog";
import type { ChecklistItem, ScopePhase } from "./pageState";
import { UnlockDialog } from "./UnlockDialog";

export const BUILD_STARTED_TEXT = "The build has started. Changes after a release go through change requests.";
/** The English texts above and below are the source; the card shows them in the current language. */

/** The first reason the lock is not available, or null. */
/** Why someone without the lock permission sees the button disabled: who signs off instead. */
export const LOCK_BY_TEAM = "The project team locks the scope";

/** Why the lock waits while the milestones are being arranged again (an accepted second-opinion fix, or "Suggest milestones"). */
export const REPLAN_TEXT = "Your business analyst is re-planning the milestones. You can lock the scope once the new plan is in.";

export function lockDisabledReason(canLock: boolean, items: readonly ChecklistItem[], replanning = false): string | null {
  if (!canLock) return t("analysis.scope.lock.byTeam", "The project team locks the scope");
  if (replanning) return t("analysis.scope.lock.replan", "Your business analyst is re-planning the milestones. You can lock the scope once the new plan is in.");
  return items.find((i) => !i.ok)?.text ?? null;
}

export function LockCard({ ctx, projectId, phase, versionId, versionNumber, lockedAt, lockedBy, canLock, showUnlock, items, advisories, counts, milestones, replanning = false }: {
  ctx: ScopeContext; projectId: string; phase: ScopePhase; versionId: string | null; versionNumber: number | null;
  lockedAt: string | null; lockedBy: string | null; canLock: boolean; showUnlock: boolean;
  items: readonly ChecklistItem[]; advisories: readonly string[]; counts: LockCounts; milestones: readonly LockMilestoneLine[];
  /** a milestones.suggest job is still queued or running: the lock waits for its plan */
  replanning?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const draft = phase === "draft";
  const reason = draft ? lockDisabledReason(canLock, items, replanning) : null;
  const ready = draft && versionId !== null && versionNumber !== null;
  const date = dateOf(lockedAt);
  return (
    <Card title={draft ? t("analysis.scope.lock.beforeYouLock", "Before you lock") : t("analysis.scope.lock.locked", "Scope locked")}>
      {draft ? (
        <>
          {/* the unlock turns the card back to its draft side: the confirmation is shown here */}
          {unlocked && <p role="status" className="mb-3 text-[13px] text-ink2">{t("analysis.scope.lock.unlocked", "Scope unlocked. You can change it again.")}</p>}
          <ul className="space-y-1.5" aria-label={t("analysis.scope.lock.beforeYouLock", "Before you lock")}>
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-[13px]">
                {i.ok ? <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" aria-label={t("analysis.scope.lock.done", "Done")} />
                  : <Circle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink3" aria-label={t("analysis.scope.lock.open", "Open")} />}
                <span className={i.ok ? "text-ink2" : "text-ink"}>{i.text}</span>
              </li>
            ))}
          </ul>
          {advisories.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px] text-ink3">{advisories.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
          <div className="mt-4">
            <Button variant="secondary" className="w-full" icon={<Lock size={16} strokeWidth={1.75} aria-hidden />}
              disabled={!ready || reason !== null} aria-describedby={reason ? "scope-lock-reason" : undefined}
              onClick={() => setLockOpen(true)}>{t("analysis.scope.lock.lockScope", "Lock the scope")}</Button>
            {reason && <p id="scope-lock-reason" className="mt-2 text-[12.5px] text-ink3">{reason}</p>}
          </div>
          {ready && (
            <LockDialog ctx={ctx} open={lockOpen} onClose={() => setLockOpen(false)} projectId={projectId} versionId={versionId} versionNumber={versionNumber}
              counts={counts} milestones={milestones} advisories={advisories} replanning={replanning} />
          )}
        </>
      ) : (
        <>
          <Chip tone="success">{lockedLine(versionNumber, date, lockedBy)}</Chip>
          {phase === "buildStarted" || phase === "released" ? <p className="mt-3 text-[13px] text-ink2">{t("analysis.scope.lock.buildStarted", "The build has started. Changes after a release go through change requests.")}</p> : null}
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="secondary" className="w-full" onClick={() => navigate(boardPath(projectId))}>{t("analysis.scope.lock.openBoard", "Open the board")}</Button>
            {showUnlock && <Button variant="secondary" className="w-full" onClick={() => setUnlockOpen(true)}>{t("analysis.scope.lock.unlock", "Unlock")}</Button>}
          </div>
          {showUnlock && versionId && versionNumber !== null && (
            <UnlockDialog ctx={ctx} open={unlockOpen} onClose={() => setUnlockOpen(false)} onUnlocked={() => setUnlocked(true)}
              projectId={projectId} versionId={versionId} versionNumber={versionNumber} />
          )}
        </>
      )}
    </Card>
  );
}
