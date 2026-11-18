/** One feature: name, description, priority, requirement trace, screens, feedback and its user stories. */
import { PRIORITY_WORD } from "@/madp/components/requirements/priority";
import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Chip, Input, Label, Select, Textarea } from "@/madp/ui/kit";
import { ChangeMenu } from "@/madp/components/changes/ChangeMenu";
import { FEATURE_FIELD_SUPPORT, type DesignScreenRecord } from "../../../blocks/scope/records";
import { staleRowText } from "../../../blocks/scope/messages";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./ScopeFeedback";
import { ScreenLinkPicker } from "./ScreenLinkPicker";
import { StoryEditor, type StoryRow } from "./StoryEditor";
import { t, useT } from "@/madp/i18n";

export type FeaturePriority = "must" | "nice" | "later" | "excluded";

/** A feature as the editor shows it: a stored row, or a new one that only has its clientKey yet. */
export interface FeatureRow {
  key: string;
  id: string | null;
  clientKey: string | null;
  name: string;
  description: string;
  priority: FeaturePriority;
  excludedReason: string;
  requirementIds: string[];
  screenIds: string[];
  sortOrder: number;
  updatedAt: string | null;
}

/** The same words as Goals & requirements (Must / Should / Could); the stored values stay must / nice / later. */
/** Read at render time: each word is looked up in the current language when it is read. */
export const PRIORITY_LABEL: Record<FeaturePriority, string> = {
  get must() { return PRIORITY_WORD.must; },
  get nice() { return PRIORITY_WORD.nice; },
  get later() { return PRIORITY_WORD.later; },
  get excluded() { return t("analysis.scope.notIncluded", "Not included"); },
};
const PRIORITY_KEYS: readonly FeaturePriority[] = ["must", "nice", "later", "excluded"];

export function FeatureEditor({
  feature, stories, editable, first, last, screens, requirementCodes, issues, storyIssues, conflicted, conflictedStories,
  suggestion, autoFocus, changeKey, onChange, onBlur, onMove, onDelete, onReload,
  onStoryAdd, onStoryChange, onStoryMove, onStoryDelete,
}: {
  feature: FeatureRow;
  stories: StoryRow[];
  editable: boolean;
  first: boolean;
  last: boolean;
  screens: DesignScreenRecord[];
  requirementCodes: Map<string, string>;
  issues: string[];
  storyIssues: Map<string, string[]>;
  conflicted: boolean;
  conflictedStories: ReadonlySet<string>;
  /** The "Suggested change" panel for this feature, when an accepted point is being applied. */
  suggestion?: ReactNode;
  autoFocus?: boolean;
  /** The stored Feature.Key of a saved feature: Change / Enhance (after a dev release) targets `feature:<key>`. */
  changeKey?: string | null;
  onChange: (patch: Partial<FeatureRow>, flush?: boolean) => void;
  onBlur: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onReload: (id: string) => void;
  onStoryAdd: () => void;
  onStoryChange: (story: StoryRow, patch: Partial<StoryRow>, flush?: boolean) => void;
  onStoryMove: (story: StoryRow, dir: -1 | 1) => void;
  onStoryDelete: (story: StoryRow) => void;
}) {
  const t = useT();
  const uid = useId();
  const [confirming, setConfirming] = useState(false);
  const label = feature.name.trim() || t("analysis.scope.thisFeature", "this feature");
  const PRIORITY_OPTIONS = PRIORITY_KEYS.map((value) => ({ value, label: PRIORITY_LABEL[value] }));
  const traces = feature.requirementIds.map((id) => requirementCodes.get(id)).filter((c): c is string => Boolean(c));

  const storyList = (
    <ul aria-label={t("analysis.scope.editor.storiesOf", "Stories of {name}", { name: label })} className="space-y-2">
      {stories.map((s, i) => (
        <StoryEditor key={s.key} story={s} editable={editable} first={i === 0} last={i === stories.length - 1}
          issues={storyIssues.get(s.key) ?? []} conflicted={s.id !== null && conflictedStories.has(s.id)}
          onChange={(p, f) => onStoryChange(s, p, f)} onBlur={onBlur} onMove={(d) => onStoryMove(s, d)} onDelete={() => onStoryDelete(s)}
          onReload={() => s.id && onReload(s.id)} />
      ))}
      {stories.length === 0 && <li className="text-[13px] text-ink3">{t("analysis.scope.editor.noStories", "No stories yet.")}</li>}
    </ul>
  );

  if (!editable) {
    return (
      <FeedbackItem as="li" type="feature" id={feature.id ?? ""} className="rounded-block bg-surface2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 text-[15px] font-medium text-ink [overflow-wrap:anywhere]">{feature.name}</h4>
          <Chip tone={feature.priority === "must" ? "accent" : "neutral"}>{PRIORITY_LABEL[feature.priority]}</Chip>
          {traces.map((c) => <Chip key={c}>{t("analysis.scope.editor.from", "From {code}", { code: c })}</Chip>)}
        </div>
        {feature.description && <p className="mt-1.5 text-[14px] text-ink2 [overflow-wrap:anywhere]">{feature.description}</p>}
        {feature.priority === "excluded" && FEATURE_FIELD_SUPPORT.excludedReason && feature.excludedReason && (
          <p className="mt-1.5 text-[13px] text-ink3 [overflow-wrap:anywhere]">{t("analysis.scope.editor.reasonLine", "Reason: {reason}", { reason: feature.excludedReason })}</p>
        )}
        {FEATURE_FIELD_SUPPORT.screenLinks && <div className="mt-3"><ScreenLinkPicker screens={screens} value={feature.screenIds} editable={false} onChange={() => {}} /></div>}
        <div className="mt-3">{storyList}</div>
        {(feature.id || changeKey) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {feature.id && <ScopeFeedbackButton target={{ type: "feature", id: feature.id }} label={feature.name.trim() || t("analysis.scope.thisFeature", "this feature")} />}
            {changeKey && <ChangeMenu target={{ type: "feature", id: changeKey, title: label, text: feature.name }} />}
          </div>
        )}
      </FeedbackItem>
    );
  }

  return (
    <FeedbackItem as="li" type="feature" id={feature.id ?? ""} className="rounded-block bg-surface2 p-4" data-feature={feature.key}>
      {suggestion}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div>
          <label htmlFor={`${uid}-name`}><Label>{t("analysis.scope.editor.name", "Feature name")}</Label></label>
          <Input id={`${uid}-name`} data-feature-name={feature.key} autoFocus={autoFocus} value={feature.name} maxLength={120}
            onChange={(e) => onChange({ name: e.target.value })} onBlur={onBlur} />
        </div>
        <Select label={t("analysis.scope.editor.priority", "Priority")} value={feature.priority} options={PRIORITY_OPTIONS}
          onChange={(v) => onChange({ priority: v as FeaturePriority }, true)} />
      </div>
      <div className="mt-3">
        <label htmlFor={`${uid}-desc`}><Label>{t("analysis.scope.editor.description", "Description")}</Label></label>
        <Textarea id={`${uid}-desc`} value={feature.description} maxLength={2000} rows={3}
          onChange={(e) => onChange({ description: e.target.value })} onBlur={onBlur} />
      </div>
      {feature.priority === "excluded" && FEATURE_FIELD_SUPPORT.excludedReason && (
        <div className="mt-3">
          <label htmlFor={`${uid}-reason`}><Label>{t("analysis.scope.editor.reason", "Reason")}</Label></label>
          <Input id={`${uid}-reason`} value={feature.excludedReason} maxLength={500}
            onChange={(e) => onChange({ excludedReason: e.target.value })} onBlur={onBlur} />
        </div>
      )}
      {traces.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{traces.map((c) => <Chip key={c}>{t("analysis.scope.editor.from", "From {code}", { code: c })}</Chip>)}</div>}
      {FEATURE_FIELD_SUPPORT.screenLinks && (
        <div className="mt-3"><ScreenLinkPicker screens={screens} value={feature.screenIds} editable onChange={(ids) => onChange({ screenIds: ids }, true)} /></div>
      )}
      {conflicted && (
        <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[rgb(var(--c-warning-text))]">
          {staleRowText()}
          <Button size="sm" variant="ghost" onClick={() => feature.id && onReload(feature.id)}>{t("analysis.scope.editor.changedReload", "Changed by someone else · Reload")}</Button>
        </p>
      )}
      {issues.length > 0 && (
        <ul role="alert" className="mt-3 space-y-0.5 text-[13px] text-[rgb(var(--c-danger-text))]">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={first} aria-label={t("analysis.scope.editor.moveUpName", "Move {name} up", { name: label })} icon={<ArrowUp size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onMove(-1)}>{t("analysis.scope.moveUp", "Move up")}</Button>
        <Button size="sm" variant="ghost" disabled={last} aria-label={t("analysis.scope.editor.moveDownName", "Move {name} down", { name: label })} icon={<ArrowDown size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onMove(1)}>{t("analysis.scope.moveDown", "Move down")}</Button>
        {feature.id && <ScopeFeedbackButton target={{ type: "feature", id: feature.id }} label={feature.name.trim() || t("analysis.scope.thisFeature", "this feature")} />}
        {confirming ? (
          <span role="group" aria-label={t("analysis.scope.editor.deleteName", "Delete {name}", { name: label })} className="inline-flex flex-wrap items-center gap-2 text-[13px] text-ink">
            {stories.length === 1
              ? t("analysis.scope.editor.deleteConfirmOne", "Delete {name} and its 1 story?", { name: label })
              : t("analysis.scope.editor.deleteConfirm", "Delete {name} and its {count} stories?", { name: label, count: stories.length })}
            <Button size="sm" variant="danger" onClick={() => { setConfirming(false); onDelete(); }}>{t("analysis.scope.delete", "Delete")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("analysis.scope.keep", "Keep")}</Button>
          </span>
        ) : (
          <Button size="sm" variant="danger" aria-label={t("analysis.scope.editor.deleteName", "Delete {name}", { name: label })} icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setConfirming(true)}>{t("analysis.scope.delete", "Delete")}</Button>
        )}
      </div>
      <div className="mt-4">
        <Label>{t("analysis.scope.editor.userStories", "User stories")}</Label>
        {storyList}
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus size={14} strokeWidth={1.75} aria-hidden />} onClick={onStoryAdd}>{t("analysis.scope.editor.addStory", "Add a story")}</Button>
      </div>
    </FeedbackItem>
  );
}
