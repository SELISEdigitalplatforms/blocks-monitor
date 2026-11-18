/** One user story: who, "can", the text and the acceptance criteria. Edits are reported up; saving is the caller's. */
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button, Input, Label } from "@/madp/ui/kit";
import { normaliseCriteria } from "../../../domain/scope";
import { staleRowText } from "../../../blocks/scope/messages";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./ScopeFeedback";
import { useT } from "@/madp/i18n";

/** A story as the editor shows it: a stored row, or a new one that only has its clientKey yet. */
/** At most 20 criteria per story (SCOPE_LIMITS in src/domain/scope.ts). */
const MAX_CRITERIA = 20;

export interface StoryRow {
  key: string;
  id: string | null;
  clientKey: string | null;
  featureId: string;
  actor: string;
  text: string;
  acceptanceCriteria: string[];
  sortOrder: number;
  updatedAt: string | null;
}

export function StoryEditor({ story, editable, first, last, issues, conflicted, onChange, onBlur, onMove, onDelete, onReload }: {
  story: StoryRow;
  editable: boolean;
  first: boolean;
  last: boolean;
  issues: string[];
  conflicted: boolean;
  onChange: (patch: Partial<StoryRow>, flush?: boolean) => void;
  onBlur: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onReload: () => void;
}) {
  const t = useT();
  const uid = useId();
  // like Delete feature: a story with text is deleted only after a second click; an empty new one just goes
  const [confirming, setConfirming] = useState(false);
  const blank = !story.id && !story.actor.trim() && !story.text.trim() && story.acceptanceCriteria.every((c) => !c.trim());
  const setCriterion = (i: number, v: string) => onChange({ acceptanceCriteria: story.acceptanceCriteria.map((c, j) => (j === i ? v : c)) });
  const tidy = () => {
    const next = normaliseCriteria(story.acceptanceCriteria);
    if (next.length !== story.acceptanceCriteria.length || next.some((c, i) => c !== story.acceptanceCriteria[i])) onChange({ acceptanceCriteria: next }, true);
    else onBlur();
  };

  // the story in words, as the plan reads it ("As …" stays as written)
  const feedbackLabel = /^as\s/i.test(story.text.trim()) ? story.text.trim() : t("analysis.scope.story.whoCan", "{who} can {what}", { who: story.actor.trim(), what: story.text.trim() }).trim();
  if (!editable) {
    return (
      <FeedbackItem as="li" type="story" id={story.id ?? ""} className="flex gap-2 rounded-block bg-surface2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-ink [overflow-wrap:anywhere]"><span className="font-medium">{story.actor}</span> {t("analysis.scope.story.can", "can")} {story.text}</p>
          {story.acceptanceCriteria.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink2">
              {story.acceptanceCriteria.map((c, i) => <li key={i} className="[overflow-wrap:anywhere]">{c}</li>)}
            </ul>
          )}
        </div>
        {story.id && <ScopeFeedbackButton target={{ type: "story", id: story.id }} label={feedbackLabel} className="-my-1" />}
      </FeedbackItem>
    );
  }

  return (
    <FeedbackItem as="li" type="story" id={story.id ?? ""} className="rounded-block bg-surface2 px-4 py-3" data-story={story.key}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_auto_minmax(0,1fr)] sm:items-end">
        <div>
          <label htmlFor={`${uid}-actor`}><Label>{t("analysis.scope.story.who", "Who")}</Label></label>
          <Input id={`${uid}-actor`} value={story.actor} maxLength={60} onChange={(e) => onChange({ actor: e.target.value })} onBlur={onBlur} />
        </div>
        <span className="pb-3 text-[14px] text-ink2" aria-hidden>{t("analysis.scope.story.can", "can")}</span>
        <div>
          <label htmlFor={`${uid}-text`}><Label>{t("analysis.scope.story.what", "What they can do")}</Label></label>
          <Input id={`${uid}-text`} value={story.text} maxLength={500} onChange={(e) => onChange({ text: e.target.value })} onBlur={onBlur} />
        </div>
      </div>
      <fieldset className="mt-3">
        <legend><Label>{t("analysis.scope.story.criteria", "Acceptance criteria")}</Label></legend>
        <ul className="space-y-2">
          {story.acceptanceCriteria.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input aria-label={t("analysis.scope.story.criterionN", "Acceptance criterion {n}", { n: i + 1 })} value={c} maxLength={500} onChange={(e) => setCriterion(i, e.target.value)} onBlur={tidy} />
              <Button size="sm" variant="ghost" aria-label={t("analysis.scope.story.removeCriterionN", "Remove criterion {n}", { n: i + 1 })} icon={<X size={14} strokeWidth={1.75} aria-hidden />}
                onClick={() => onChange({ acceptanceCriteria: story.acceptanceCriteria.filter((_, j) => j !== i) }, true)} />
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" className="mt-2" disabled={story.acceptanceCriteria.length >= MAX_CRITERIA} icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
          onClick={() => onChange({ acceptanceCriteria: [...story.acceptanceCriteria, ""] })}>{t("analysis.scope.story.addCriterion", "Add a criterion")}</Button>
      </fieldset>
      {conflicted && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[rgb(var(--c-warning-text))]">
          {staleRowText()}
          <Button size="sm" variant="ghost" onClick={onReload}>{t("analysis.scope.editor.changedReload", "Changed by someone else · Reload")}</Button>
        </p>
      )}
      {issues.length > 0 && (
        <ul role="alert" className="mt-2 space-y-0.5 text-[13px] text-[rgb(var(--c-danger-text))]">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={first} aria-label={t("analysis.scope.story.moveUp", "Move story up")} icon={<ArrowUp size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onMove(-1)}>{t("analysis.scope.moveUp", "Move up")}</Button>
        <Button size="sm" variant="ghost" disabled={last} aria-label={t("analysis.scope.story.moveDown", "Move story down")} icon={<ArrowDown size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onMove(1)}>{t("analysis.scope.moveDown", "Move down")}</Button>
        {confirming ? (
          <span role="group" aria-label={t("analysis.scope.story.delete", "Delete story")} className="inline-flex flex-wrap items-center gap-2 text-[13px] text-ink">
            {t("analysis.scope.story.deleteConfirm", "Delete this story?")}
            <Button size="sm" variant="danger" onClick={() => { setConfirming(false); onDelete(); }}>{t("analysis.scope.delete", "Delete")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("analysis.scope.keep", "Keep")}</Button>
          </span>
        ) : (
          <Button size="sm" variant="danger" aria-label={t("analysis.scope.story.delete", "Delete story")} icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}
            onClick={() => (blank ? onDelete() : setConfirming(true))}>{t("analysis.scope.delete", "Delete")}</Button>
        )}
        {story.id && <ScopeFeedbackButton target={{ type: "story", id: story.id }} label={feedbackLabel} />}
      </div>
    </FeedbackItem>
  );
}
