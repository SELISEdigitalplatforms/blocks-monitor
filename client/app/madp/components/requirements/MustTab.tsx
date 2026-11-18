/** "What it must do": the project's real requirements, in order. Every change is one Blocks Logic Function call
 *  (mutations.ts); the browser holds no write rights. A delete is soft and can be undone for 10 seconds. */
import { useT } from "@/madp/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks, Plus, Undo2 } from "lucide-react";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { VIEWER_TIP } from "@/madp/domain/rbac";
import { currentVersionOf } from "@/madp/domain/requirements";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { LoadError } from "@/madp/components/sanitization/shared";
import { useItemVersionsMeta, useRequirements } from "@/madp/blocks/requirements/hooks";
import { useMemberName } from "@/madp/blocks/requirements/context";
import { useDeleteRequirement, useReorderRequirements, useSaveRequirement } from "@/madp/blocks/requirements/mutations";
import type { RequirementRecord } from "@/madp/blocks/requirements/records";
import { RequirementForm, type RequirementFormValue } from "./RequirementForm";
import { RequirementRow } from "./RequirementRow";
import { DocBlock } from "./ObjectiveTab";
import { requirementsErrorMessage } from "./messages";
import { PriorityFilterBar } from "./PriorityChips";
import { PRIORITY_HINT, PRIORITY_WORD, countPriorities, filterByPriority, groupByPriority, type PriorityFilter } from "./priority";
import { cn } from "@/madp/lib/cn";
import type { ReqTab } from "./requirementsTab";

export interface MustTabProps {
  projectId: string;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  onOpenTab: (tab: ReqTab) => void;
  onEditingChange?: (editing: boolean) => void;
  bare?: boolean;
  note?: React.ReactNode;
}

export const UNDO_MS = 10_000;

export interface MustViewProps {
  projectId: string;
  requirements: RequirementRecord[];
  loading?: boolean;
  /** The read failed: a retry is offered instead of "No requirements yet." and its Add button (a duplicate trap). */
  loadError?: boolean;
  onRetry?: () => void;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  nameOf: (userId: string | null) => string | null;
  /** "new" while the add form is open, a requirement id while that one is edited, else null. */
  formFor: "new" | string | null;
  busy: boolean;
  error: string | null;
  /** The title of a requirement just removed (shows the Undo line), else null. */
  removed: string | null;
  onOpenTab: (tab: ReqTab) => void;
  onOpenForm: (which: "new" | string | null) => void;
  onSubmit: (v: RequirementFormValue) => void;
  onDelete: (r: RequirementRecord) => void;
  onUndo: () => void;
  onMove: (index: number, dir: -1 | 1) => void;
  /** One-click priority change; the id of the requirement whose priority is being saved. */
  onPriority?: (r: RequirementRecord, priority: RequirementRecord["priority"]) => void;
  priorityBusyId?: string | null;
  /** Show all or one priority; group the list by priority. */
  filter?: PriorityFilter;
  grouped?: boolean;
  onFilter?: (f: PriorityFilter) => void;
  onGroup?: (g: boolean) => void;
  /** The Requirements document's section (no card); `note` shows above the list (e.g. who prepared the draft). */
  bare?: boolean;
  note?: React.ReactNode;
}

export function MustView(p: MustViewProps) {
  const t = useT();
  const { editable, readOnlyReason, requirements } = p;
  const Frame = p.bare ? DocBlock : Card;
  const failed = !!p.loadError && requirements.length === 0;
  const empty = !p.loading && !failed && requirements.length === 0;
  const filter = p.filter ?? "all";
  const grouped = p.grouped ?? false;
  const visible = filterByPriority(requirements, filter);
  const groups: { priority: RequirementRecord["priority"] | null; items: RequirementRecord[] }[] =
    grouped ? groupByPriority(visible) : visible.length > 0 ? [{ priority: null, items: visible }] : [];
  return (
    <Frame title={t("analysis.requirements.tabMust", "What it must do")} icon={<ListChecks size={18} strokeWidth={1.75} />}
      action={<Chip>{requirements.length}</Chip>}>
      {p.note}
      {readOnlyReason === "permission" && !p.bare && <ViewOnlyNote id="must-view-only" text={VIEWER_TIP} className="mb-3" />}
      <div role="status" aria-live="polite" className="text-[13px] text-ink2 empty:hidden">
        {p.removed !== null && (
          <span className="mb-3 flex flex-wrap items-center gap-2 rounded-block bg-surface2 px-3 py-2">
            <span>{t("analysis.requirements.requirementRemoved", "Requirement removed.")}</span>
            {editable && (
              <Button variant="ghost" size="sm" icon={<Undo2 size={14} strokeWidth={1.75} />} onClick={p.onUndo}>{t("analysis.requirements.undo", "Undo")}</Button>
            )}
          </span>
        )}
      </div>
      {p.error && p.formFor === null && <p role="alert" className="mb-3 text-[13px] text-[rgb(var(--c-danger-text))]">{p.error}</p>}
      {p.loading && <p className="text-[14px] text-ink2">{t("analysis.requirements.loadingRequirements", "Loading the requirements…")}</p>}
      {failed && <LoadError onRetry={() => p.onRetry?.()} />}
      {empty && (
        <div className="py-2">
          <p className="text-[15px]">{t("analysis.requirements.noRequirementsYet", "No requirements yet.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && p.formFor === null && (
              <Button variant="primary" size="sm" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => p.onOpenForm("new")}>{t("analysis.requirements.formAddLabel", "Add a requirement")}</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => p.onOpenTab("suggestions")}>{t("analysis.requirements.seeSuggestions", "See the suggestions")}</Button>
          </div>
        </div>
      )}
      {requirements.length > 0 && p.onFilter && p.onGroup && (
        <PriorityFilterBar value={filter} counts={countPriorities(requirements)} grouped={grouped} onChange={p.onFilter} onGroup={p.onGroup} />
      )}
      {requirements.length > 0 && visible.length === 0 && (
        <p className="py-2 text-[14px] text-ink2">{filter === "all" ? t("analysis.requirements.noRequirementsYet", "No requirements yet.")
          : t("analysis.requirements.noPriorityRequirementsYet", "No {priority} requirements yet.", { priority: PRIORITY_WORD[filter].toLowerCase() })}</p>
      )}
      {groups.map((g) => (
        <div key={g.priority ?? "all"} className={cn(g.priority && "mt-2 first:mt-0")}>
          {g.priority && (
            <h3 className="flex items-baseline gap-2 border-b border-line px-2 pb-2 pt-1 text-[13px] font-medium text-ink2">
              {PRIORITY_WORD[g.priority]} <span className="num text-ink3">{g.items.length}</span>
              <span className="font-normal text-ink3">· {PRIORITY_HINT[g.priority]}</span>
            </h3>
          )}
          <ol className="divide-y divide-line">
            {g.items.map((r) => {
              const i = requirements.indexOf(r);
              return p.formFor === r.id ? (
                <li key={r.id} className="py-3">
                  <RequirementForm mode="edit" initial={{ title: r.title, detail: r.detail, priority: r.priority }}
                    busy={p.busy} error={p.error} onSubmit={p.onSubmit} onCancel={() => p.onOpenForm(null)} />
                </li>
              ) : (
                <RequirementRow key={r.id} projectId={p.projectId} requirement={r} index={i} count={requirements.length}
                  editable={editable} viewOnly={readOnlyReason === "permission"} authorName={p.nameOf(r.authorUserId)}
                  busy={p.busy} onEdit={() => p.onOpenForm(r.id)} onDelete={() => p.onDelete(r)} onMove={(d) => p.onMove(i, d)}
                  onPriority={p.onPriority ? (v) => p.onPriority!(r, v) : undefined} priorityBusy={p.priorityBusyId === r.id}
                  canMove={filter === "all" && !grouped} />
              );
            })}
          </ol>
        </div>
      ))}
      {editable && !failed && p.formFor === "new" && (
        <div className="mt-3">
          <RequirementForm mode="create" busy={p.busy} error={p.error} onSubmit={p.onSubmit} onCancel={() => p.onOpenForm(null)} />
        </div>
      )}
      {editable && !empty && p.formFor === null && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => p.onOpenForm("new")}>{t("analysis.requirements.formAddLabel", "Add a requirement")}</Button>
        </div>
      )}
    </Frame>
  );
}

export function MustTab({ projectId, editable, readOnlyReason, onOpenTab, onEditingChange, bare, note }: MustTabProps) {
  const reqs = useRequirements(projectId);
  const versions = useItemVersionsMeta(projectId);
  const nameOf = useMemberName();
  const save = useSaveRequirement(projectId);
  const del = useDeleteRequirement(projectId);
  const reorder = useReorderRequirements(projectId);
  const requirements = reqs.data ?? [];

  const [formFor, setFormFor] = useState<"new" | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ id: string; title: string } | null>(null);
  const [filter, setFilter] = useState<PriorityFilter>("all");
  const [grouped, setGrouped] = useState(Boolean(bare));
  const [priorityBusyId, setPriorityBusyId] = useState<string | null>(null);
  // one key per open "Add" form: a double submit can never create two requirements
  const clientKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clearTimer, []);
  useEffect(() => { onEditingChange?.(formFor !== null); }, [formFor, onEditingChange]);
  useEffect(() => { if (!editable) setFormFor(null); }, [editable]);

  const openForm = useCallback((which: "new" | string | null) => {
    setError(null);
    clientKey.current = which === "new" ? crypto.randomUUID() : null;
    setFormFor(which);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(requirementsErrorMessage(e)); return false; } finally { setBusy(false); }
  };

  const onSubmit = async (v: RequirementFormValue) => {
    const editing = formFor !== null && formFor !== "new" ? formFor : null;
    const ok = await run(async () => {
      if (editing) {
        await save.mutateAsync({
          id: editing, title: v.title, detail: v.detail, priority: v.priority,
          baseVersion: currentVersionOf(versions.data?.latest ?? new Map(), `requirement:${editing}`),
        });
      } else {
        await save.mutateAsync({
          clientKey: clientKey.current ?? crypto.randomUUID(), title: v.title, detail: v.detail, priority: v.priority, criteria: v.criteria,
        });
      }
    });
    if (ok) openForm(null);
  };

  const onDelete = async (r: RequirementRecord) => {
    const ok = await run(async () => { await del.mutateAsync({ id: r.id }); });
    if (!ok) return;
    clearTimer();
    setRemoved({ id: r.id, title: r.title });
    timer.current = setTimeout(() => setRemoved(null), UNDO_MS);
  };

  const onUndo = async () => {
    if (!removed) return;
    const id = removed.id;
    clearTimer();
    const ok = await run(async () => { await save.mutateAsync({ id, restore: true } as Parameters<typeof save.mutateAsync>[0]); });
    if (ok) setRemoved(null);
  };

  /** One click on Must / Should / Could: the same save as an edit (a new version of the item), title and detail kept. */
  const onPriority = async (r: RequirementRecord, priority: RequirementRecord["priority"]) => {
    if (priority === r.priority || priorityBusyId) return;
    setPriorityBusyId(r.id);
    try {
      await run(async () => {
        await save.mutateAsync({
          id: r.id, title: r.title, detail: r.detail, priority,
          baseVersion: currentVersionOf(versions.data?.latest ?? new Map(), `requirement:${r.id}`),
        });
      });
    } finally { setPriorityBusyId(null); }
  };

  const onMove = async (index: number, dir: -1 | 1) => {
    const ids = requirements.map((r) => r.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await run(async () => { await reorder.mutateAsync({ orderedIds: ids }); });
  };

  return (
    <MustView projectId={projectId} requirements={requirements} loading={reqs.isLoading} loadError={reqs.isError} onRetry={() => void reqs.refetch()} editable={editable}
      readOnlyReason={readOnlyReason} nameOf={(id) => (id ? nameOf(id) : null)} formFor={formFor} busy={busy} error={error}
      removed={removed ? removed.title : null} onOpenTab={onOpenTab} onOpenForm={openForm} onSubmit={onSubmit}
      onDelete={onDelete} onUndo={onUndo} onMove={onMove} onPriority={editable ? onPriority : undefined} priorityBusyId={priorityBusyId}
      filter={filter} grouped={grouped} onFilter={setFilter} onGroup={setGrouped} bare={bare} note={note} />
  );
}
