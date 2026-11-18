/** One requirement in "What it must do": number, title, detail, priority and provenance chips, version chip, its
 *  acceptance criteria and (when editable) Edit, Delete, Move up and Move down. The feedback entry point targets the Blocks
 *  requirement id. Change requests target features (Blocks accepts no requirement target), so their menu sits on the
 *  scope's feature rows; a requirement only shows its change badges. */
import { t, useT } from "@/madp/i18n";
import { useMemo } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button, Chip } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { VIEWER_TIP } from "@/madp/domain/rbac";
import type { RequirementRecord } from "@/madp/blocks/requirements/records";
import { FeedbackButton } from "@/madp/components/feedback/FeedbackButton";
import { ChangeBadges } from "@/madp/components/changes/ChangeHistory";
import { featureRef } from "@/madp/data/changes";
import { targetKey } from "@/madp/data/feedback";
import { FEEDBACK_ITEM, FEEDBACK_OPEN, useIsFeedbackOpen, type FeedbackTarget } from "@/madp/components/feedback/feedbackUi";
import { CriteriaEditor } from "./CriteriaEditor";
import { VersionChip } from "./VersionHistory";
import { PriorityChips } from "./PriorityChips";
import { PRIORITY_WORD } from "./priority";

/** Must / Should / Could (the stored values stay must / nice / later; see ./priority.ts). */
export const PRIORITY_LABEL: Record<RequirementRecord["priority"], string> = PRIORITY_WORD;

/** Where a requirement came from, in words. `authorName` is the member who added it (null when unknown). */
export function provenanceLabel(origin: RequirementRecord["origin"], authorName: string | null): string {
  switch (origin) {
    case "sanitization": return t("analysis.requirements.originSanitization", "From Understanding your project");
    case "suggestion": return t("analysis.requirements.originSuggestion", "From a suggestion");
    case "second-opinion": return t("analysis.requirements.originSecondOpinion", "From the second opinion");
    case "feedback": return t("analysis.requirements.originFeedback", "From feedback");
    default: return authorName?.trim()
      ? t("analysis.requirements.addedBy", "Added by {name}", { name: authorName.trim() })
      : t("analysis.requirements.addedByMember", "Added by a workspace member");
  }
}

/** The detail only repeats the title (the draft's "Title." under "Title"): shown once. */
const sameWords = (a: string, b: string) => a.trim().replace(/[.;!]+$/, "").toLowerCase() === b.trim().replace(/[.;!]+$/, "").toLowerCase();

export function RequirementRow({
  projectId, requirement: r, index, count, editable, viewOnly, authorName, onEdit, onDelete, onMove, busy, onPriority, priorityBusy, canMove = true,
}: {
  projectId: string;
  requirement: RequirementRecord;
  index: number;
  count: number;
  editable: boolean;
  viewOnly: boolean;
  authorName: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  busy: boolean;
  /** One-click priority change (editable rows). */
  onPriority?: (p: RequirementRecord["priority"]) => void;
  priorityBusy?: boolean;
  /** false while the list is filtered or grouped: the order can only change in the full list. */
  canMove?: boolean;
}) {
  useT();
  const closedNote = t("analysis.requirements.closedNote", "The requirements are confirmed, so this item stays as it is.");
  const target = useMemo<FeedbackTarget>(() => ({
    type: "requirement", id: r.id, title: r.title, base: r.title, locked: !editable,
    lockedNote: viewOnly ? VIEWER_TIP : closedNote,
  }), [r.id, r.title, editable, viewOnly, closedNote]);
  const isOpen = useIsFeedbackOpen("requirement", r.id);
  const ctl = "!h-8 !w-8 !p-0";
  return (
    <li className={cn("flex gap-3 px-2 py-3", FEEDBACK_ITEM, isOpen && FEEDBACK_OPEN)}
      data-feedback-item={targetKey("requirement", r.id)}>
      <span className="num w-6 shrink-0 pt-[2px] text-[13px] text-ink3">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px] leading-snug">{r.title}</div>
        {r.detail && !sameWords(r.detail, r.title) && <div className="mt-0.5 text-pretty break-words text-[13px] leading-snug text-ink2">{r.detail}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PriorityChips value={r.priority} editable={editable && !!onPriority} busy={busy || priorityBusy}
            label={t("analysis.requirements.priorityOf", "Priority of {name}", { name: r.label || r.title })} onChange={onPriority} />
          <Chip>{provenanceLabel(r.origin, authorName)}</Chip>
          <VersionChip projectId={projectId} itemKey={`requirement:${r.id}`} editable={editable} label={t("analysis.requirements.requirementLabel", "Requirement {label}", { label: r.label })} />
          <ChangeBadges featureRef={featureRef("requirement", r.id)} />
        </div>
        <div className="mt-2">
          <CriteriaEditor projectId={projectId} parent={{ type: "requirement", id: r.id }} criteria={r.criteria}
            editable={editable} label={t("analysis.requirements.criteriaFor", "Acceptance criteria for {name}", { name: r.label })} />
        </div>
      </div>
      <span className="flex shrink-0 flex-wrap items-start justify-end gap-1.5 self-start">
        {editable && (
          <>
            {canMove && <>
            <Button variant="ghost" size="sm" className={ctl} icon={<ArrowUp size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.moveItemUp", "Move {name} up", { name: r.label })} title={t("analysis.requirements.moveUp", "Move up")} disabled={busy || index === 0} onClick={() => onMove(-1)} />
            <Button variant="ghost" size="sm" className={ctl} icon={<ArrowDown size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.moveItemDown", "Move {name} down", { name: r.label })} title={t("analysis.requirements.moveDown", "Move down")} disabled={busy || index >= count - 1} onClick={() => onMove(1)} />
            </>}
            <Button variant="ghost" size="sm" className={ctl} icon={<Pencil size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.editItem", "Edit {name}", { name: r.label })} title={t("analysis.requirements.edit", "Edit")} disabled={busy} onClick={onEdit} />
            <Button variant="ghost" size="sm" className={ctl} icon={<Trash2 size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.deleteItem", "Delete {name}", { name: r.label })} title={t("analysis.requirements.delete", "Delete")} disabled={busy} onClick={onDelete} />
          </>
        )}
        <FeedbackButton target={target} className="-my-1" />
      </span>
    </li>
  );
}
