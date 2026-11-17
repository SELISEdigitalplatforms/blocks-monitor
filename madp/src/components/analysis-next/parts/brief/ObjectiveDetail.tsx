/** "Objective", opened in its row: today's ObjectivePart (the same record, version chip, save call objective.save and
 *  acceptance-criteria editor), without its card (the row already shows the title). "Edit" sits next to the text while
 *  the requirements are open and the person may edit them; read only otherwise. */
import { useT } from "@/i18n";
import { useEffect, useState } from "react";
import { PencilLine } from "lucide-react";
import { Button, Textarea } from "@/ui/kit";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { useItemVersionsMeta, useObjective } from "@/blocks/requirements/hooks";
import { useSaveObjective } from "@/blocks/requirements/mutations";
import { OBJECTIVE_ITEM_KEY, REQUIREMENT_LIMITS, checkObjectiveText, currentVersionOf } from "@/domain/requirements";
import { CriteriaEditor } from "@/components/requirements/CriteriaEditor";
import { VersionChip } from "@/components/requirements/VersionHistory";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import { PartLoading, PartPlaceholder } from "@/components/analysis/doc/PartCard";
import { partOpen } from "@/components/analysis/model";
import type { AnalysisCtx } from "../../model";

const MAX = REQUIREMENT_LIMITS.objectiveMax;

export function ObjectiveDetail({ projectId, step }: AnalysisCtx) {
  const t = useT();
  const WHEN = t("analysis.brief.whenAfterQuestions", "Written after you answer the open questions.");
  const open = partOpen("objective", step);
  const ctx = useRequirementsContext(projectId);
  const objective = useObjective(projectId);
  const meta = useItemVersionsMeta(projectId);
  const save = useSaveObjective(projectId);
  const editable = ctx.open && Boolean(ctx.canEditRequirements);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editable && editing) setEditing(false); }, [editable, editing]);

  if (!open) {
    return <PartPlaceholder what={t("analysis.brief.objectivePlaceholder", "Your business analyst writes the objective here: what this project should achieve, in a sentence or two, and how we'll know it worked.")} when={WHEN} />;
  }
  if (objective.isLoading) return <PartLoading />;

  const rec = objective.data ?? null;
  const text = rec?.text.trim() ?? "";
  const start = () => { setDraft(rec?.text ?? ""); setError(null); setSaved(false); setEditing(true); };
  const onSave = () => {
    const check = checkObjectiveText(draft);
    if (!check.ok) { setError(check.reason === "required" ? t("analysis.brief.objectiveRequired", "Write the objective first.") : t("analysis.brief.objectiveTooLong", "Keep the objective under {max} characters.", { max: MAX })); return; }
    const base = meta.data ? currentVersionOf(meta.data.latest, OBJECTIVE_ITEM_KEY) : 0;
    setSaving(true); setError(null); setSaved(false);
    save.mutateAsync({ text: check.value, baseVersion: base })
      .then(() => { setEditing(false); setSaved(true); })
      .catch((e: unknown) => setError(requirementsErrorMessage(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex min-w-0 flex-col">
      {editing ? (
        <div>
          <Textarea value={draft} maxLength={MAX} disabled={saving} aria-label={t("analysis.brief.objective", "Objective")} rows={5} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-1 text-right text-[12px] text-ink3">{draft.length} / {MAX}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={saving || !draft.trim()} onClick={onSave}>{saving ? t("analysis.brief.saving", "Saving…") : t("analysis.brief.save", "Save")}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(false); setError(null); }}>{t("analysis.brief.cancel", "Cancel")}</Button>
          </div>
        </div>
      ) : text ? (
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <p className="min-w-0 max-w-[78ch] flex-1 whitespace-pre-wrap break-words text-[16px] leading-relaxed text-ink">{text}</p>
            {editable && <Button size="sm" variant="ghost" icon={<PencilLine size={14} aria-hidden />} onClick={start} aria-label={t("analysis.brief.editObjective", "Edit the objective")}>{t("analysis.brief.edit", "Edit")}</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            <VersionChip projectId={projectId} itemKey={OBJECTIVE_ITEM_KEY} editable={editable} label={t("analysis.brief.theObjective", "the objective")} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PartPlaceholder what={editable ? t("analysis.brief.objectiveEmptyEditable", "No objective yet. Your business analyst writes it from your answers, or you can write it now.") : t("analysis.brief.objectiveEmpty", "No objective yet. Your business analyst writes it from your answers.")} when={WHEN} />
          {editable && <div><Button size="sm" variant="primary" onClick={start}>{t("analysis.brief.writeObjective", "Write the objective")}</Button></div>}
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-[13px] empty:hidden">
        {saving ? <span className="text-ink2">{t("analysis.brief.saving", "Saving…")}</span> : error ? <span className="text-danger">{t("analysis.brief.notSaved", "Not saved: {error}", { error })}</span> : saved ? <span className="text-success">{t("analysis.brief.saved", "Saved")}</span> : null}
      </p>
      {(text || (rec?.criteria.length ?? 0) > 0) && (
        <div className="mt-5 border-t border-line pt-4">
          <h4 className="mb-2 text-[13px] font-medium text-ink2">{t("analysis.brief.howWeKnow", "How we'll know it worked")}</h4>
          <CriteriaEditor projectId={projectId} parent={{ type: "objective" }} criteria={rec?.criteria ?? []} editable={editable} label={t("analysis.brief.theObjectiveCriteria", "the objective criteria")} />
        </div>
      )}
    </div>
  );
}
