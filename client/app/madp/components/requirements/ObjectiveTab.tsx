// Objective tab: the objective sentence and its acceptance criteria as real Blocks records.
// No prefilled text; writes only through objective.save / acceptance.save.
import { useT } from "@/madp/i18n";
import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { Button, Card, EmptyState, Textarea } from "@/madp/ui/kit";
import { VIEWER_TIP } from "@/madp/domain/rbac";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { useItemVersionsMeta, useObjective } from "@/madp/blocks/requirements/hooks";
import { useSaveObjective } from "@/madp/blocks/requirements/mutations";
import { OBJECTIVE_ITEM_KEY, checkObjectiveText, currentVersionOf } from "@/madp/domain/requirements";
import { requirementsErrorMessage } from "./messages";
import type { ReqTab } from "./requirementsTab";
import { CriteriaEditor } from "./CriteriaEditor";
import { VersionChip } from "./VersionHistory";

const MAX = 2000;
const NOTE_ID = "objective-view-only";

export function ObjectiveView({ text, editable, editing, draft, saving, error, saved, versionChip, readOnlyReason, criteria,
  onStart, onDraft, onSave, onCancel, bare }: {
  text: string; editable: boolean; editing: boolean; draft: string; saving: boolean; error: string | null; saved?: boolean;
  versionChip?: React.ReactNode; readOnlyReason: "closed" | "permission" | null; criteria?: React.ReactNode;
  onStart: () => void; onDraft: (v: string) => void; onSave: () => void; onCancel: () => void;
  /** The Requirements document's "Goal" section: no cards, the criteria as "How we'll know it worked". */
  bare?: boolean;
}) {
  const t = useT();
  const Box = bare ? DocBlock : Card;
  return (
    <div className={bare ? "space-y-4" : "space-y-5"}>
      <Box title={bare ? t("analysis.requirements.goal", "Goal") : t("analysis.requirements.tabObjective", "Objective")} icon={<Target size={18} strokeWidth={1.75} />}
        action={editable ? <>
          {!editing && text && <Button size="sm" variant="ghost" onClick={onStart}>{t("analysis.requirements.edit", "Edit")}</Button>}
        </> : undefined}>
        {editing ? (
          <div>
            <Textarea value={draft} maxLength={MAX} disabled={saving} aria-label={bare ? t("analysis.requirements.goal", "Goal") : t("analysis.requirements.tabObjective", "Objective")} rows={5}
              onChange={(e) => onDraft(e.target.value)} />
            <div className="mt-1 text-right text-[12px] text-ink3">{draft.length} / {MAX}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={saving || !draft.trim()} onClick={onSave}>{saving ? t("analysis.requirements.saving", "Saving…") : t("analysis.requirements.save", "Save")}</Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>{t("analysis.requirements.cancel", "Cancel")}</Button>
            </div>
          </div>
        ) : text ? (
          <div>
            <p className={bare ? "max-w-[78ch] whitespace-pre-wrap break-words text-[16px] leading-relaxed text-ink" : "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink"}>{text}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">{versionChip}</div>
          </div>
        ) : (
          <EmptyState icon={<Target size={22} strokeWidth={1.75} />} title={bare ? t("analysis.requirements.noGoalYet", "No goal yet.") : t("analysis.requirements.noObjectiveYet", "No objective yet.")}
            text={editable ? t("analysis.requirements.objectiveEmptyHint", "Say in a sentence or two what this project should achieve.") : undefined}
            action={editable ? <Button size="sm" variant="primary" onClick={onStart}>{bare ? t("analysis.requirements.writeGoal", "Write the goal") : t("analysis.requirements.writeObjective", "Write the objective")}</Button> : undefined} />
        )}
        <p role="status" aria-live="polite" className={bare ? "mt-2 text-[13px] empty:hidden" : "mt-2 min-h-[18px] text-[13px]"}>
          {saving ? <span className="text-ink2">{t("analysis.requirements.saving", "Saving…")}</span> : error ? <span className="text-danger">{t("analysis.requirements.notSaved", "Not saved: {error}", { error })}</span> : saved ? <span className="text-success">{t("analysis.requirements.saved", "Saved")}</span> : null}
        </p>
        {readOnlyReason === "permission" && !bare && <ViewOnlyNote id={NOTE_ID} text={VIEWER_TIP} />}
      </Box>
      <Box title={bare ? t("analysis.requirements.howWeKnow", "How we'll know it worked") : t("analysis.requirements.formCriteria", "Acceptance criteria")} sub={bare}>{criteria}</Box>
    </div>
  );
}

/** A titled block of the Requirements document (no card): the heading, its actions on the right, then the body. */
export function DocBlock({ title, icon, action, sub, children }: { title: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; sub?: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        {!sub && icon && <span aria-hidden className="text-ink3">{icon}</span>}
        {sub
          ? <h4 className="text-[13px] font-medium text-ink2">{title}</h4>
          : <h3 className="text-[17px] font-semibold tracking-[-0.005em] text-ink">{title}</h3>}
        {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function ObjectiveTab({ projectId, editable, readOnlyReason, onEditingChange, bare }: {
  projectId: string; editable: boolean; readOnlyReason: "closed" | "permission" | null;
  onOpenTab: (tab: ReqTab) => void; onEditingChange?: (editing: boolean) => void; bare?: boolean;
}) {
  const t = useT();
  const objective = useObjective(projectId);
  const meta = useItemVersionsMeta(projectId);
  const save = useSaveObjective(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = objective.data ?? null;
  const criteriaEditing = useState(false);
  useEffect(() => { onEditingChange?.(editing || criteriaEditing[0]); }, [editing, criteriaEditing[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!editable && editing) setEditing(false); }, [editable, editing]);
  useEffect(() => () => onEditingChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = () => {
    const check = checkObjectiveText(draft);
    if (!check.ok) { setError(check.reason === "required" ? t("analysis.requirements.objectiveRequired", "Write the objective first.") : t("analysis.requirements.objectiveTooLong", "Keep the objective under {max} characters.", { max: MAX })); return; }
    const base = meta.data ? currentVersionOf(meta.data.latest, OBJECTIVE_ITEM_KEY) : 0;
    setSaving(true); setError(null); setSaved(false);
    save.mutateAsync({ text: check.value, baseVersion: base })
      .then(() => { setEditing(false); setSaved(true); })
      .catch((e: unknown) => setError(requirementsErrorMessage(e)))
      .finally(() => setSaving(false));
  };
  return (
    <ObjectiveView bare={bare} text={rec?.text ?? ""} editable={editable} editing={editing} draft={draft} saving={saving}
      error={error} saved={saved} readOnlyReason={readOnlyReason}
      versionChip={<VersionChip projectId={projectId} itemKey={OBJECTIVE_ITEM_KEY} editable={editable} label={t("analysis.requirements.theObjective", "the objective")} />}
      criteria={<CriteriaEditor projectId={projectId} parent={{ type: "objective" }} criteria={rec?.criteria ?? []}
        editable={editable} label={t("analysis.requirements.theObjectiveCriteria", "the objective criteria")} onEditingChange={criteriaEditing[1]} />}
      onStart={() => { setDraft(rec?.text ?? ""); setError(null); setSaved(false); setEditing(true); }}
      onDraft={setDraft} onSave={onSave} onCancel={() => { setEditing(false); setError(null); }} />
  );
}
