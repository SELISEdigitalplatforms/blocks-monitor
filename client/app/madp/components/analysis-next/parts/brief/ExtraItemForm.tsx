/** Add or edit one key workflow, "not included" item or constraint, in place of its compact row. The same fields, limits
 *  and checks as the Workflows tab's form (extrasForm.ts; the op checks again with checkExtra). */
import { useT } from "@/madp/i18n";
import { useId, useState } from "react";
import { Button, Input, Label, Select, Textarea } from "@/madp/ui/kit";
import { CONSTRAINT_KINDS, EXTRA_LIMITS, freeConstraintKinds, type ConstraintKind, type ExtraKind, type ExtraRecord } from "@/madp/domain/requirementsExtras";
import { constraintKindName, constraintPlaceholder, extraLabel } from "@/madp/components/requirements/domainLabels";
import { extraProblem, linesOf, type ExtraFormValue } from "@/madp/components/requirements/extrasForm";

export function ExtraItemForm({ kind, initial, usedKinds, busy, error, onSubmit, onCancel }: {
  kind: ExtraKind; initial?: ExtraRecord; usedKinds: ConstraintKind[]; busy: boolean; error: string | null;
  onSubmit: (v: ExtraFormValue) => void; onCancel: () => void;
}) {
  const t = useT();
  const uid = useId();
  const free = freeConstraintKinds(usedKinds.map((k) => ({ constraintKind: k })));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [who, setWho] = useState(initial?.who ?? "");
  const [stepsText, setStepsText] = useState((initial?.steps ?? []).join("\n"));
  const [ck, setCk] = useState<ConstraintKind>((initial?.constraintKind || free[0] || "other") as ConstraintKind);
  const [touched, setTouched] = useState(false);
  const value: ExtraFormValue = { title, who, steps: linesOf(stepsText), constraintKind: ck };
  const problem = extraProblem(kind, value);
  const shown = (touched && problem) || error;
  const kindOptions = CONSTRAINT_KINDS.filter((k) => k === ck || free.includes(k)).map((k) => ({ value: k, label: constraintKindName(k) }));

  const submit = () => {
    setTouched(true);
    if (problem || busy) return;
    onSubmit({ ...value, title: title.trim(), who: who.trim() });
  };

  const label = initial ? t("analysis.brief.editExtra", "Edit: {item}", { item: extraLabel(kind).one }) : extraLabel(kind).add;
  return (
    <form className="space-y-3 rounded-block bg-surface2 p-4" noValidate aria-label={label}
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {kind === "workflow" && (
        <>
          <div>
            <label htmlFor={`${uid}-title`}><Label>{t("analysis.brief.whatHappens", "What happens")}</Label></label>
            <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
              placeholder={t("analysis.brief.whatHappensPlaceholder", "For example: approve a leave request")} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="max-w-md">
            <label htmlFor={`${uid}-who`}><Label>{t("analysis.brief.whoDoesIt", "Who does it")}</Label></label>
            <Input id={`${uid}-who`} value={who} maxLength={EXTRA_LIMITS.who} disabled={busy}
              placeholder={t("analysis.brief.whoDoesItPlaceholder", "For example: team lead")} onChange={(e) => setWho(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-steps`}><Label>{t("analysis.brief.steps", "Steps")}</Label></label>
            <Textarea id={`${uid}-steps`} value={stepsText} rows={4} disabled={busy}
              placeholder={t("analysis.brief.stepsPlaceholder", "One step per line, for example:\nThe employee asks for the days off\nThe team lead approves or declines\nPayroll sees it on the next run")}
              onChange={(e) => setStepsText(e.target.value)} />
          </div>
        </>
      )}
      {kind === "exclusion" && (
        <div>
          <label htmlFor={`${uid}-title`}><Label>{t("analysis.brief.whatWeLeaveOut", "What we leave out")}</Label></label>
          <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
            placeholder={t("analysis.brief.leaveOutPlaceholder", "For example: a separate app for the app stores")} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}
      {kind === "constraint" && (
        <>
          <div className="max-w-xs">
            <Label>{t("analysis.brief.kind", "Kind")}</Label>
            <Select label={t("analysis.brief.kindOfConstraint", "Kind of constraint")} value={ck} options={kindOptions} disabled={busy} onChange={(v) => setCk(v as ConstraintKind)} />
          </div>
          <div>
            <label htmlFor={`${uid}-title`}><Label>{t("analysis.brief.whatWeMustRespect", "What we must respect")}</Label></label>
            <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
              placeholder={constraintPlaceholder(ck)} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </>
      )}
      <div role="alert" className="min-h-[1px] text-[13px] text-[rgb(var(--c-danger-text))]">{shown || null}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{initial ? t("analysis.brief.saveChanges", "Save changes") : extraLabel(kind).add}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{t("analysis.brief.cancel", "Cancel")}</Button>
      </div>
    </form>
  );
}
