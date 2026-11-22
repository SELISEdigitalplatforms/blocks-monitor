/** "Edit checks" from a requirement's ⋯ menu: its acceptance checks, open for editing in the opened row. The same view
 *  and the same save as the Requirements page's CriteriaEditor (acceptance.save through useSaveAcceptance, one version
 *  per save, one requestId per list so a Retry replays the stored outcome, a timed-out save re-read before it is sent
 *  again), only opened from the menu instead of its own "Edit criteria" button. Closes on Save or Cancel. */
import { t } from "@/i18n";
import { useRef, useState } from "react";
import { newRequestId, FunctionError } from "@/blocks/fn";
import { queryClient } from "@/blocks/queryClient";
import { useActiveWorkspaceId } from "@/blocks/requirements/context";
import { useItemVersionsMeta } from "@/blocks/requirements/hooks";
import { useSaveAcceptance } from "@/blocks/requirements/mutations";
import { SCHEMA } from "@/blocks/requirements/records";
import { acceptanceItemKey, checkCriteria, currentVersionOf, normaliseCriteria } from "@/domain/requirements";
import { CriteriaEditorView } from "@/components/requirements/CriteriaEditor";
import { useReportEditing } from "@/components/requirements/editingGuard";
import { requirementsErrorMessage } from "@/components/requirements/messages";

const MAX = 20;
const MAX_CHARS = 500;

function problemOf(r: ReturnType<typeof checkCriteria>): string | null {
  if (r.ok) return null;
  return r.reason === "too_many"
    ? t("analysis.brief.criteriaTooMany", "Use at most {max} criteria.", { max: MAX })
    : t("analysis.brief.criterionTooLong", "Keep each criterion under {max} characters.", { max: MAX_CHARS });
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const noop = () => undefined;

export function ChecksEditor({ projectId, requirementId, criteria, label, onDone }: {
  projectId: string; requirementId: string; criteria: readonly string[]; label: string; onDone: () => void;
}) {
  const ws = useActiveWorkspaceId();
  const itemKey = acceptanceItemKey(requirementId);
  const meta = useItemVersionsMeta(projectId);
  const save = useSaveAcceptance(projectId);
  // a list without checks opens with one empty line to type into
  const [draft, setDraft] = useState<string[]>(() => (criteria.length ? [...criteria] : [""]));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useReportEditing(true);

  const rid = useRef<{ key: string; id: string } | null>(null);
  const uncertain = useRef(false); // an earlier attempt timed out and may have landed
  const serverRef = useRef(criteria);
  serverRef.current = criteria;

  /** Re-read the stored checks and the version; resolves with the current base version. */
  const refresh = async (): Promise<number> => {
    const [m] = await Promise.all([
      meta.refetch(),
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "ws" && q.queryKey[1] === ws && q.queryKey[2] === SCHEMA.requirement }),
    ]);
    await new Promise((r) => setTimeout(r, 0)); // let the re-read checks reach this component
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
        if (sameList(serverRef.current, list)) { uncertain.current = false; onDone(); return; }
      }
      await save.mutateAsync({ parent: { type: "requirement", id: requirementId }, criteria: list, baseVersion: base, requestId: rid.current.id });
      uncertain.current = false;
      onDone();
    } catch (e: unknown) {
      const code = e instanceof FunctionError ? e.code : "";
      if (code === "timeout" || code === "unavailable") uncertain.current = true;
      if (uncertain.current && (code === "timeout" || code === "unavailable" || code === "version.stale" || (e instanceof FunctionError && e.messageKey === "version.stale"))) {
        await refresh();
        if (sameList(serverRef.current, list)) { uncertain.current = false; onDone(); return; } // the save landed
      }
      setError(requirementsErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CriteriaEditorView criteria={criteria} draft={draft} editing editable saving={saving} error={error} itemKey={itemKey} label={label}
      onEdit={noop}
      onChange={(i, v) => setDraft((d) => d.map((x, j) => (j === i ? v : x)))}
      onMove={(i, dir) => setDraft((d) => { const j = i + dir; if (j < 0 || j >= d.length) return d; const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; })}
      onRemove={(i) => setDraft((d) => d.filter((_, j) => j !== i))}
      onAdd={() => setDraft((d) => (d.length >= MAX ? d : [...d, ""]))}
      onSave={() => { void onSave(); }} onRetry={() => { void onSave(); }}
      onCancel={() => { setError(null); uncertain.current = false; onDone(); }} />
  );
}
