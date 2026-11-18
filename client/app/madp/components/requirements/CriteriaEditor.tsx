// Acceptance-criteria list for the objective or one requirement. Writes only through
// acceptance.save (s8's useSaveAcceptance); one version per save.
import { t, useT } from "@/madp/i18n";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button, Input } from "@/madp/ui/kit";
import { useItemVersionsMeta } from "@/madp/blocks/requirements/hooks";
import { newRequestId, FunctionError } from "@/madp/blocks/fn";
import { queryClient } from "@/madp/blocks/queryClient";
import { useActiveWorkspaceId } from "@/madp/blocks/requirements/context";
import { SCHEMA } from "@/madp/blocks/requirements/records";
import { useSaveAcceptance } from "@/madp/blocks/requirements/mutations";
import { ACCEPTANCE_OBJECTIVE_KEY, acceptanceItemKey, checkCriteria, currentVersionOf, normaliseCriteria } from "@/madp/domain/requirements";
import { requirementsErrorMessage } from "./messages";
import { VersionChip } from "./VersionHistory";
import { useReportEditing } from "./editingGuard";

type Parent = { type: "objective" } | { type: "requirement"; id: string };

const MAX = 20;
const MAX_CHARS = 500;

function problemOf(r: ReturnType<typeof checkCriteria>): string | null {
  if (r.ok) return null;
  return r.reason === "too_many"
    ? t("analysis.requirements.criteriaTooMany", "Use at most {max} criteria.", { max: MAX })
    : t("analysis.requirements.criterionTooLong", "Keep each criterion under {max} characters.", { max: MAX_CHARS });
}

export function CriteriaEditorView({ criteria, draft, editing, editable, saving, error, itemKey, versionChip, label,
  onEdit, onChange, onMove, onRemove, onAdd, onSave, onCancel, onRetry }: {
  criteria: readonly string[]; draft: readonly string[]; editing: boolean; editable: boolean; saving: boolean;
  error: string | null; itemKey?: string; versionChip?: React.ReactNode; label?: string;
  onEdit: () => void; onChange: (i: number, v: string) => void; onMove: (i: number, dir: -1 | 1) => void;
  onRemove: (i: number) => void; onAdd: () => void; onSave: () => void; onCancel: () => void; onRetry?: () => void;
}) {
  useT();
  const what = label ?? t("analysis.requirements.acceptanceCriteriaLower", "acceptance criteria");
  if (!editing) {
    return (
      <div data-key={itemKey}>
        {criteria.length === 0 ? (
          <p className="text-[14px] text-ink2">{t("analysis.requirements.noCriteria", "No acceptance criteria yet.")}</p>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px] text-ink2">
            {criteria.map((c, i) => <li key={i} className="break-words">{c}</li>)}
          </ol>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {versionChip}
          {editable && <Button size="sm" variant="ghost" onClick={onEdit}>{t("analysis.requirements.editCriteria", "Edit criteria")}</Button>}
        </div>
        <p role="status" aria-live="polite" className="sr-only">{error ?? ""}</p>
      </div>
    );
  }
  const atLimit = draft.length >= MAX;
  return (
    <div>
      <ul className="space-y-2" aria-label={t("analysis.requirements.editWhat", "Edit {what}", { what })}>
        {draft.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input value={c} maxLength={MAX_CHARS} aria-label={t("analysis.requirements.criterionN", "Criterion {n}", { n: i + 1 })} disabled={saving}
                onChange={(e) => onChange(i, e.target.value)} />
            </div>
            <Button size="sm" variant="ghost" aria-label={t("analysis.requirements.moveCriterionUp", "Move criterion {n} up", { n: i + 1 })} disabled={saving || i === 0}
              onClick={() => onMove(i, -1)} icon={<ArrowUp size={14} strokeWidth={1.75} />} />
            <Button size="sm" variant="ghost" aria-label={t("analysis.requirements.moveCriterionDown", "Move criterion {n} down", { n: i + 1 })} disabled={saving || i === draft.length - 1}
              onClick={() => onMove(i, 1)} icon={<ArrowDown size={14} strokeWidth={1.75} />} />
            <Button size="sm" variant="ghost" aria-label={t("analysis.requirements.removeCriterion", "Remove criterion {n}", { n: i + 1 })} disabled={saving}
              onClick={() => onRemove(i)} icon={<X size={14} strokeWidth={1.75} />} />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" disabled={atLimit || saving} onClick={onAdd} icon={<Plus size={14} strokeWidth={1.75} />}>{t("analysis.requirements.addCriterion", "Add a criterion")}</Button>
        <span className="text-[12px] text-ink3">{t("analysis.requirements.criteriaLimit", "Up to {max} criteria, {chars} characters each", { max: MAX, chars: MAX_CHARS })}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={saving} onClick={onSave}>{saving ? t("analysis.requirements.saving", "Saving…") : t("analysis.requirements.saveCriteria", "Save criteria")}</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>{t("analysis.requirements.cancel", "Cancel")}</Button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[18px] text-[13px]">
        {saving ? <span className="text-ink2">{t("analysis.requirements.saving", "Saving…")}</span> : error ? (
          <span className="text-danger">
            {t("analysis.requirements.notSaved", "Not saved: {error}", { error })}
            {onRetry && <Button size="sm" variant="ghost" className="ml-2" onClick={onRetry}>{t("analysis.requirements.retry", "Retry")}</Button>}
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function CriteriaEditor({ projectId, parent, criteria, editable, label, onEditingChange }: {
  projectId: string; parent: Parent; criteria: readonly string[]; editable: boolean; label?: string;
  onEditingChange?: (editing: boolean) => void;
}) {
  useT();
  const ws = useActiveWorkspaceId();
  const itemKey = parent.type === "objective" ? ACCEPTANCE_OBJECTIVE_KEY : acceptanceItemKey(parent.id);
  const meta = useItemVersionsMeta(projectId);
  const save = useSaveAcceptance(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { onEditingChange?.(editing); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Requirements page keeps Confirm disabled while this list is half-edited (wherever the editor sits)
  useReportEditing(editing);
  useEffect(() => { if (!editable && editing) setEditing(false); }, [editable, editing]);
  useEffect(() => () => onEditingChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // one requestId per save action: Retry of the same list re-sends it so the server replays the stored outcome
  const rid = useRef<{ key: string; id: string } | null>(null);
  const uncertain = useRef(false); // an earlier attempt timed out and may have landed
  const serverRef = useRef(criteria);
  serverRef.current = criteria;
  const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  /** Re-read the stored criteria and the version; resolves with the current base version. */
  const refresh = async (): Promise<number> => {
    const [m] = await Promise.all([
      meta.refetch(),
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "ws" && q.queryKey[1] === ws && (q.queryKey[2] === SCHEMA.objective || q.queryKey[2] === SCHEMA.requirement) }),
    ]);
    await new Promise((r) => setTimeout(r, 0)); // let the re-read criteria reach this component
    return m?.data ? currentVersionOf(m.data.latest, itemKey) : 0;
  };

  const onSave = async () => {
    const list = normaliseCriteria(draft);
    const problem = problemOf(checkCriteria(list));
    if (problem) { setError(problem); return; }
    const listKey = JSON.stringify(list);
    if (rid.current?.key !== listKey) rid.current = { key: listKey, id: newRequestId() };
    setSaving(true); setError(null);
    try {
      let base = meta.data ? currentVersionOf(meta.data.latest, itemKey) : 0;
      if (uncertain.current) {
        base = await refresh();
        if (sameList(serverRef.current, list)) { uncertain.current = false; setEditing(false); return; }
      }
      await save.mutateAsync({ parent, criteria: list, baseVersion: base, requestId: rid.current.id });
      uncertain.current = false;
      setEditing(false);
    } catch (e: unknown) {
      const code = e instanceof FunctionError ? e.code : "";
      if (code === "timeout" || code === "unavailable") uncertain.current = true;
      if (uncertain.current && (code === "timeout" || code === "unavailable" || code === "version.stale" || (e instanceof FunctionError && e.messageKey === "version.stale"))) {
        await refresh();
        if (sameList(serverRef.current, list)) { uncertain.current = false; setEditing(false); return; } // the save landed
      }
      setError(requirementsErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <CriteriaEditorView criteria={criteria} draft={draft} editing={editing} editable={editable} saving={saving}
      error={error} itemKey={itemKey} label={label}
      versionChip={<VersionChip projectId={projectId} itemKey={itemKey} editable={editable} label={label ?? t("analysis.requirements.acceptanceCriteriaLower", "acceptance criteria")} />}
      onEdit={() => { setDraft([...criteria]); setError(null); uncertain.current = false; rid.current = null; setEditing(true); }}
      onChange={(i, v) => setDraft((d) => d.map((x, j) => (j === i ? v : x)))}
      onMove={(i, dir) => setDraft((d) => { const j = i + dir; if (j < 0 || j >= d.length) return d; const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; })}
      onRemove={(i) => setDraft((d) => d.filter((_, j) => j !== i))}
      onAdd={() => setDraft((d) => (d.length >= MAX ? d : [...d, ""]))}
      onSave={() => { void onSave(); }} onRetry={() => { void onSave(); }}
      onCancel={() => { setEditing(false); setError(null); uncertain.current = false; }} />
  );
}
