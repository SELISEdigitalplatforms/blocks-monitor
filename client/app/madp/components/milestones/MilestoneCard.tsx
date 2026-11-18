import { useEffect, useId, useState, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Button, Input, Textarea } from "@/madp/ui/kit";
import { milestoneKey, type PlanMilestone } from "../../domain/milestones";
import { ScopeFeedbackButton } from "../scope/blocks/ScopeFeedback";
import { FEEDBACK_ITEM, FEEDBACK_OPEN, useIsFeedbackOpen } from "../feedback/feedbackUi";
import { targetKey } from "@/madp/data/feedback";
import { MoveMenu } from "./MoveMenu";
import { MilestoneFeatureRow, FEATURE_DRAG_PREFIX } from "./MilestoneFeatureRow";
import type { MilestoneIssues } from "./useMilestoneArrange";
import { t, useT } from "@/madp/i18n";

export const MILESTONE_DRAG_PREFIX = "milestone:";
export const LAST_MILESTONE_REASON = "A scope needs at least one milestone.";
/** LAST_MILESTONE_REASON in the current language (the constant stays the English source). */
export const lastMilestoneReason = (): string => t("build.milestones.lastReason", "A scope needs at least one milestone.");

export interface MilestoneCardProps {
  milestone: PlanMilestone;
  index: number;
  count: number;
  displayNumber: number;
  /** Numbers of the other milestones, in order, with their keys. */
  others: { key: string; number: number }[];
  featureName: (ref: string) => string;
  issues?: MilestoneIssues;
  editable: boolean;
  heldRef: string | null;
  heldSelf: boolean;
  onRename: (name: string) => void;
  onGoal: (goal: string) => void;
  onRemove: () => void;
  onMoveMilestone: (to: number) => void;
  onMoveFeature: (ref: string, toKey: string, toIndex: number) => void;
  onUnassign: (ref: string) => void;
  onDropFeature: (data: string, index: number) => void;
  onDropMilestone: (data: string) => void;
  onFeatureKey: (ref: string) => (e: KeyboardEvent<HTMLElement>) => void;
  onCardKey: (e: KeyboardEvent<HTMLElement>) => void;
  /** Just added: the name field takes the focus with its placeholder name selected (then onNameFocused). */
  focusName?: boolean;
  onNameFocused?: () => void;
}

/** Removing a milestone with a goal or features throws that work away: it is confirmed first. An empty one just goes. */
export const removeNeedsConfirm = (m: Pick<PlanMilestone, "goal" | "featureRefs">): boolean =>
  m.goal.trim() !== "" || m.featureRefs.length > 0;

export function MilestoneCard(p: MilestoneCardProps) {
  const t = useT();
  const m = p.milestone;
  const key = milestoneKey(m);
  const uid = useId();
  const nameId = `${uid}-name`, goalId = `${uid}-goal`, whyId = `${uid}-why`, helpId = `${uid}-help`, errId = `${uid}-err`;
  const last = p.count <= 1;
  const title = t("build.page.milestoneN", "Milestone {number}", { number: p.displayNumber });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { focusName, onNameFocused } = p;
  useEffect(() => {
    if (!focusName) return;
    const input = document.getElementById(nameId) as HTMLInputElement | null;
    input?.focus();
    input?.select();
    onNameFocused?.();
  }, [focusName, nameId, onNameFocused]);

  const featureList = m.featureRefs.map((ref, i) => {
    return (
      <MilestoneFeatureRow
        key={ref}
        featureRef={ref}
        name={p.featureName(ref)}
        index={i}
        count={m.featureRefs.length}
        targets={p.others}
        inMilestone
        editable={p.editable}
        picked={p.heldRef === ref}
        onMoveUp={() => p.onMoveFeature(ref, key, i - 1)}
        onMoveDown={() => p.onMoveFeature(ref, key, i + 1)}
        onMoveTo={(to) => p.onMoveFeature(ref, to, Number.MAX_SAFE_INTEGER)}
        onUnassign={() => p.onUnassign(ref)}
        onHandleKey={p.onFeatureKey(ref)}
        onDropBefore={(data) => p.onDropFeature(data, i)}
      />
    );
  });

  const over = (e: DragEvent<HTMLElement>) => {
    if (p.editable && e.dataTransfer.types.includes("text/plain")) e.preventDefault();
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    const data = e.dataTransfer.getData("text/plain");
    if (!p.editable) return;
    if (data.startsWith(FEATURE_DRAG_PREFIX)) {
      e.preventDefault();
      p.onDropFeature(data, Number.MAX_SAFE_INTEGER);
    } else if (data.startsWith(MILESTONE_DRAG_PREFIX)) {
      e.preventDefault();
      p.onDropMilestone(data);
    }
  };
  const feedbackOpen = useIsFeedbackOpen("milestone", m.id ?? "");
  const start = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData("text/plain", MILESTONE_DRAG_PREFIX + key);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <article
      aria-label={title}
      draggable={p.editable}
      onDragStart={p.editable ? start : undefined}
      onDragOver={over}
      onDrop={drop}
      data-feedback-item={m.id ? targetKey("milestone", m.id) : undefined}
      className={cn("flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5 shadow-card motion-safe:transition", FEEDBACK_ITEM, feedbackOpen && FEEDBACK_OPEN, p.heldSelf && "ring-2 ring-accent")}
    >
      <header className="flex items-center gap-2">
        {p.editable && (
          <button
            type="button"
            data-focus-id={`m:${key}`}
            aria-label={t("build.milestones.move", "Move {name}", { name: title })}
            aria-pressed={p.heldSelf}
            aria-describedby={helpId}
            onKeyDown={p.onCardKey}
            className="grid h-9 w-9 shrink-0 cursor-grab place-items-center rounded-full text-ink3 outline-none hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <GripVertical size={16} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <span id={helpId} className="sr-only">{t("build.milestones.cardKeys", "Space picks up and drops. Up and Down reorder, Enter drops, Escape cancels.")}</span>
        <h3 className="text-[12px] font-medium uppercase tracking-wider text-ink3">{title}</h3>
        <span className="ml-auto flex items-center gap-1">
          {p.editable && (
            <MoveMenu
              label={t("build.milestones.moveOptions", "Move options for {name}", { name: title })}
              items={[
                { key: "up", label: t("build.milestones.moveUp", "Move up"), onSelect: () => p.onMoveMilestone(p.index - 1), disabled: p.index <= 0 },
                { key: "down", label: t("build.milestones.moveDown", "Move down"), onSelect: () => p.onMoveMilestone(p.index + 1), disabled: p.index >= p.count - 1 },
              ]}
            />
          )}
          {m.id && <ScopeFeedbackButton target={{ type: "milestone", id: m.id }} label={m.name || title} className="-my-1" />}
        </span>
      </header>

      {p.editable ? (
        <div>
          <label htmlFor={nameId} className="sr-only">{t("build.milestones.nameOf", "{name} name", { name: title })}</label>
          <Input
            id={nameId}
            value={m.name}
            maxLength={60}
            aria-invalid={p.issues?.name ? true : undefined}
            aria-describedby={p.issues?.name ? errId : undefined}
            onChange={(e) => p.onRename(e.target.value)}
          />
          {p.issues?.name && <p id={errId} className="mt-1 text-[12px] text-danger">{p.issues.name}</p>}
        </div>
      ) : (
        <p className="text-[16px] font-semibold text-ink">{m.name}</p>
      )}

      {p.editable ? (
        <div>
          <label htmlFor={goalId} className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink3">{t("build.milestones.goal", "Goal")}</label>
          <Textarea id={goalId} value={m.goal} maxLength={500} rows={2} onChange={(e) => p.onGoal(e.target.value)} className="min-h-[64px]" />
        </div>
      ) : (
        m.goal && <p className="text-[14px] text-ink2">{m.goal}</p>
      )}

      {p.issues?.features && <p className="text-[12px] text-danger">{p.issues.features}</p>}
      {featureList.length ? (
        <ul aria-label={t("build.milestones.featuresOf", "{name} features", { name: title })} className="grid gap-2">{featureList}</ul>
      ) : (
        <p className="rounded-block border border-dashed border-line px-3 py-3 text-[13px] text-ink2">{t("build.milestones.noFeatures", "No features in this milestone yet.")}</p>
      )}

      <p className="text-[12px] text-ink3">{t("build.milestones.endsWithPreview", "Ends with a preview you can try")}</p>

      {p.editable && (
        <div className="mt-auto flex flex-col items-start gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}
            disabled={last || confirmRemove}
            aria-describedby={last ? whyId : undefined}
            onClick={() => (removeNeedsConfirm(m) ? setConfirmRemove(true) : p.onRemove())}
          >
            {t("build.milestones.remove", "Remove {name}", { name: title })}
          </Button>
          {last && <p id={whyId} className="text-[12px] text-ink2">{lastMilestoneReason()}</p>}
          {confirmRemove && !last && (
            <div role="group" aria-label={t("build.milestones.remove", "Remove {name}", { name: title })} className="flex w-full flex-wrap items-center gap-2 rounded-block bg-warning-soft px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{t("build.milestones.removeConfirm", "Remove {name}? Its goal is lost and its features go back to Not in a milestone.", { name: title })}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>{t("build.milestones.keep", "Keep")}</Button>
              <Button size="sm" variant="danger" onClick={() => { setConfirmRemove(false); p.onRemove(); }}>{t("build.milestones.removeButton", "Remove")}</Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
