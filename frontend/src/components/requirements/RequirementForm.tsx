/** Add or edit one requirement: title, detail, priority and (when adding) acceptance criteria, one per line.
 *  The limits mirror src/domain/requirements.ts; the function re-checks everything, the browser is never trusted. */
import { t, useT } from "@/i18n";
import { useId, useState } from "react";
import { Button, Input, Label, Select, Textarea } from "@/ui/kit";
import type { RequirementRecord } from "@/blocks/requirements/records";
import { PRIORITY_HINT, PRIORITY_ORDER, PRIORITY_WORD } from "./priority";

type Priority = RequirementRecord["priority"];

const TITLE_MAX = 200;
const DETAIL_MAX = 5000;
const CRITERIA_MAX = 20;
const CRITERION_MAX = 500;

/** Must / Should / Could, each with what it means (stored as must / nice / later; see ./priority.ts). */
const priorityOptions = () => PRIORITY_ORDER.map((p) => ({ value: p, label: `${PRIORITY_WORD[p]}: ${PRIORITY_HINT[p].toLowerCase()}` }));

export interface RequirementFormValue { title: string; detail: string; priority: Priority; criteria: string[] }

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The first problem with the values, or null. */
function problemOf(title: string, detail: string, criteria: string[], withCriteria: boolean): string | null {
  if (!title.trim()) return t("analysis.requirements.formTitleRequired", "Give the requirement a title.");
  if (title.trim().length > TITLE_MAX) return t("analysis.requirements.formTitleTooLong", "The title can hold up to {max} characters.", { max: TITLE_MAX });
  if (detail.length > DETAIL_MAX) return t("analysis.requirements.formDetailTooLong", "The detail can hold up to {max} characters.", { max: DETAIL_MAX });
  if (withCriteria) {
    if (criteria.length > CRITERIA_MAX) return t("analysis.requirements.formCriteriaTooMany", "Up to {max} acceptance criteria.", { max: CRITERIA_MAX });
    if (criteria.some((c) => c.length > CRITERION_MAX)) return t("analysis.requirements.formCriterionTooLong", "Each criterion can hold up to {max} characters.", { max: CRITERION_MAX });
  }
  return null;
}

export function RequirementForm({ mode, initial, busy, error, onSubmit, onCancel }: {
  mode: "create" | "edit";
  initial?: { title: string; detail: string; priority: Priority; criteria?: string[] };
  busy: boolean;
  error: string | null;
  onSubmit: (v: RequirementFormValue) => void;
  onCancel: () => void;
}) {
  useT();
  const uid = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "must");
  const [criteriaText, setCriteriaText] = useState((initial?.criteria ?? []).join("\n"));
  const [touched, setTouched] = useState(false);
  const create = mode === "create";
  const criteria = linesOf(criteriaText);
  const problem = problemOf(title, detail, criteria, create);
  const shown = (touched && problem) || error;

  const submit = () => {
    setTouched(true);
    if (problem || busy) return;
    onSubmit({ title: title.trim(), detail: detail.trim(), priority, criteria: create ? criteria : [] });
  };

  return (
    <form className="space-y-3 rounded-block bg-surface2 p-4" noValidate aria-label={create ? t("analysis.requirements.formAddLabel", "Add a requirement") : t("analysis.requirements.formEditLabel", "Edit the requirement")}
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div>
        <label htmlFor={`${uid}-title`}><Label>{t("analysis.requirements.formTitle", "Title")}</Label></label>
        <Input id={`${uid}-title`} value={title} maxLength={TITLE_MAX} disabled={busy} autoFocus
          placeholder={t("analysis.requirements.formTitlePlaceholder", "What the product must do")} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${uid}-detail`}><Label>{t("analysis.requirements.formDetail", "Detail")}</Label></label>
        <Textarea id={`${uid}-detail`} value={detail} maxLength={DETAIL_MAX} disabled={busy} rows={3}
          placeholder={t("analysis.requirements.formDetailPlaceholder", "Optional: who needs it and why")} onChange={(e) => setDetail(e.target.value)} />
        <div className="num mt-1 text-right text-[12px] text-ink3">{detail.length} / {DETAIL_MAX}</div>
      </div>
      <div className="max-w-md">
        <Label>{t("analysis.requirements.formPriority", "Priority")}</Label>
        <Select label={t("analysis.requirements.formPriority", "Priority")} value={priority} options={priorityOptions()} disabled={busy}
          onChange={(v) => setPriority(v as Priority)} />
      </div>
      {create && (
        <div>
          <label htmlFor={`${uid}-criteria`}><Label>{t("analysis.requirements.formCriteria", "Acceptance criteria")}</Label></label>
          <Textarea id={`${uid}-criteria`} value={criteriaText} disabled={busy} rows={3}
            placeholder={t("analysis.requirements.formCriteriaPlaceholder", "One criterion per line (optional)")} onChange={(e) => setCriteriaText(e.target.value)} />
        </div>
      )}
      <div role="alert" className="min-h-[1px] text-[13px] text-[rgb(var(--c-danger-text))]">{shown || null}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{create ? t("analysis.requirements.formAdd", "Add requirement") : t("analysis.requirements.saveChanges", "Save changes")}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{t("analysis.requirements.cancel", "Cancel")}</Button>
      </div>
    </form>
  );
}
