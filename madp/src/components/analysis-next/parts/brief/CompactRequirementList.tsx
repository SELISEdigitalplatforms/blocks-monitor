/** "Master features" on the Business Analysis page: the project's requirements as compact rows, grouped by priority
 *  (Must, Should, Could; the priorities are agreed with the business analyst, so changing one is a deliberate action in
 *  the row's ⋯ menu, not a toggle on every row). A row is one line (number, title, priority tag, how many checks, where
 *  it came from) and opens to its description, its numbered checks and its source in full.
 *  The same reads, writes and rules as "What it must do" (requirements/MustTab): every change is one Blocks Logic
 *  Function call (useSaveRequirement, useDeleteRequirement with 10 seconds to undo, useReorderRequirements,
 *  useSaveAcceptance for the checks), comments go through the one feedback card. A person who cannot edit sees the
 *  rows and, when allowed, comments. */
import { useT } from "@/i18n";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Flag, ListChecks, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { currentVersionOf } from "@/domain/requirements";
import { useMemberName } from "@/blocks/requirements/context";
import { useItemVersionsMeta, useRequirements } from "@/blocks/requirements/hooks";
import { useDeleteRequirement, useReorderRequirements, useSaveRequirement } from "@/blocks/requirements/mutations";
import type { RequirementRecord } from "@/blocks/requirements/records";
import { FEEDBACK_ITEM, FEEDBACK_OPEN } from "@/components/feedback/feedbackUi";
import { ChangeBadges } from "@/components/changes/ChangeHistory";
import { featureRef } from "@/data/changes";
import { LoadError } from "@/components/sanitization/shared";
import { RequirementForm, type RequirementFormValue } from "@/components/requirements/RequirementForm";
import { provenanceLabel } from "@/components/requirements/RequirementRow";
import { VersionChip } from "@/components/requirements/VersionHistory";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import { PRIORITY_HINT, PRIORITY_ORDER, PRIORITY_WORD, countPriorities, type PriorityCounts, type PriorityFilter } from "@/components/requirements/priority";
import {
  allOpen, checksLabel, commentEntry, expandAll, moveBounds, moveWithinPriority, priorityGroups, requirementActions, requirementSource,
  rowNumber, sameWords, toggleIn, type RequirementAction,
} from "./compactList";
import { ItemMenu, type MenuEntry } from "./ItemMenu";
import { ChecksEditor } from "./ChecksEditor";
import {
  AddButton, CommentCount, CommentSlot, ExpandAllButton, PriorityTag, ROWS_BOX, ROW_TOGGLE, SourceHint, SourceLine, UndoLine, useItemComments,
} from "./rowParts";

/** Ten seconds to take a delete back (as on the Requirements page). */
const UNDO_MS = 10_000;

type Priority = RequirementRecord["priority"];

const focusRowMenu = (id: string) => requestAnimationFrame(() => {
  document.querySelector<HTMLElement>(`[data-row-menu="${CSS.escape(id)}"]`)?.focus();
});

export function CompactRequirementList({ projectId, editable, readOnlyReason, stepOpen }: {
  projectId: string;
  /** The requirements are open and the person may edit them. */
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  /** The requirements step is open (comments can be added). */
  stepOpen: boolean;
}) {
  const t = useT();
  const reqs = useRequirements(projectId);
  const versions = useItemVersionsMeta(projectId);
  const nameOf = useMemberName();
  const save = useSaveRequirement(projectId);
  const del = useDeleteRequirement(projectId);
  const reorder = useReorderRequirements(projectId);
  const requirements = reqs.data ?? [];

  const [formFor, setFormFor] = useState<"new" | string | null>(null);
  const [checksFor, setChecksFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ id: string; title: string } | null>(null);
  const [filter, setFilter] = useState<PriorityFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [priorityBusyId, setPriorityBusyId] = useState<string | null>(null);
  // one key per open "Add" form: a double submit can never create two requirements
  const clientKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clearTimer, []);
  useEffect(() => { if (!editable) { setFormFor(null); setChecksFor(null); } }, [editable]);

  const openForm = useCallback((which: "new" | string | null) => {
    setError(null);
    clientKey.current = which === "new" ? crypto.randomUUID() : null;
    setFormFor(which);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(requirementsErrorMessage(e)); return false; } finally { setBusy(false); }
  };
  const baseOf = (id: string) => currentVersionOf(versions.data?.latest ?? new Map(), `requirement:${id}`);

  const onSubmit = async (v: RequirementFormValue) => {
    const editing = formFor !== null && formFor !== "new" ? formFor : null;
    const ok = await run(async () => {
      if (editing) {
        await save.mutateAsync({ id: editing, title: v.title, detail: v.detail, priority: v.priority, baseVersion: baseOf(editing) });
      } else {
        await save.mutateAsync({ clientKey: clientKey.current ?? crypto.randomUUID(), title: v.title, detail: v.detail, priority: v.priority, criteria: v.criteria });
      }
    });
    if (!ok) return;
    openForm(null);
    if (editing) focusRowMenu(editing);
  };

  const onDelete = async (r: RequirementRecord) => {
    const ok = await run(async () => { await del.mutateAsync({ id: r.id }); });
    if (!ok) return;
    clearTimer();
    if (checksFor === r.id) setChecksFor(null);
    setRemoved({ id: r.id, title: r.title });
    timer.current = setTimeout(() => setRemoved(null), UNDO_MS);
    requestAnimationFrame(() => undoButton.current?.focus());
  };

  const onUndo = async () => {
    if (!removed) return;
    const id = removed.id;
    clearTimer();
    const ok = await run(async () => { await save.mutateAsync({ id, restore: true }); });
    if (ok) { setRemoved(null); focusRowMenu(id); }
  };

  /** A deliberate priority change from the menu: the same save as an edit (a new version of the item), title and detail kept. */
  const onPriority = async (r: RequirementRecord, priority: Priority) => {
    if (priority === r.priority || priorityBusyId) return;
    setPriorityBusyId(r.id);
    try {
      const ok = await run(async () => {
        await save.mutateAsync({ id: r.id, title: r.title, detail: r.detail, priority, baseVersion: baseOf(r.id) });
      });
      if (ok) {
        // the row now sits in its new group: shown even when a filter hid that group
        if (filter !== "all" && filter !== priority) setFilter("all");
        focusRowMenu(r.id);
      }
    } finally { setPriorityBusyId(null); }
  };

  /** Up or down among the requirements of the same priority (the list is grouped by priority). */
  const onMove = async (r: RequirementRecord, dir: -1 | 1) => {
    const ids = moveWithinPriority(requirements, r.id, dir);
    if (!ids) return;
    if (await run(async () => { await reorder.mutateAsync({ orderedIds: ids }); })) focusRowMenu(r.id);
  };

  const openChecks = (id: string) => {
    setChecksFor(id);
    setExpanded((s) => new Set([...s, id]));
  };

  const failed = reqs.isError && requirements.length === 0;
  const groups = priorityGroups(requirements, filter);
  const shownIds = groups.flatMap((g) => g.items.map((x) => x.item.id));
  const viewOnly = readOnlyReason === "permission";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {requirements.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriorityFilterRadios value={filter} counts={countPriorities(requirements)} onChange={setFilter} />
          {shownIds.length > 0 && (
            <ExpandAllButton className="ml-auto" all={allOpen(shownIds, expanded)} onClick={() => setExpanded(expandAll(shownIds, expanded))} />
          )}
        </div>
      )}
      <UndoLine text={removed ? t("analysis.brief.requirementDeleted", "Requirement deleted: {title}", { title: removed.title }) : null} canUndo={editable} busy={busy} onUndo={() => void onUndo()} undoRef={undoButton} />
      {error && formFor === null && <p role="alert" className="text-[13px] text-[rgb(var(--c-danger-text))]">{t("analysis.brief.notSaved", "Not saved: {error}", { error })}</p>}
      {reqs.isLoading && <p className="text-[14px] text-ink2">{t("analysis.brief.loadingRequirements", "Loading the requirements…")}</p>}
      {failed && <LoadError onRetry={() => void reqs.refetch()} />}
      {requirements.length > 0 && groups.length === 0 && filter !== "all" && (
        <p className="px-1 py-2 text-[14px] text-ink2">{t("analysis.brief.noPriorityRequirements", "No {priority} requirements.", { priority: PRIORITY_WORD[filter].toLowerCase() })}</p>
      )}
      {groups.map((g) => (
        <PriorityGroupSection key={g.priority} priority={g.priority} count={g.items.length}>
          {g.items.map(({ item: r, n }) => formFor === r.id ? (
            <li key={r.id} className="p-3">
              <RequirementForm mode="edit" initial={{ title: r.title, detail: r.detail, priority: r.priority }}
                busy={busy} error={error} onSubmit={(v) => void onSubmit(v)} onCancel={() => { openForm(null); focusRowMenu(r.id); }} />
            </li>
          ) : (
            <RequirementLine key={r.id} projectId={projectId} r={r} n={n} open={expanded.has(r.id)}
              onToggle={() => setExpanded((s) => toggleIn(s, r.id))}
              editable={editable} viewOnly={viewOnly} stepOpen={stepOpen} busy={busy} priorityBusy={priorityBusyId === r.id}
              author={nameOf(r.authorUserId)} bounds={moveBounds(requirements, r.id)} checksOpen={checksFor === r.id}
              onEdit={() => { setChecksFor(null); openForm(r.id); }}
              onPriority={(p) => void onPriority(r, p)}
              onChecks={() => { openForm(null); openChecks(r.id); }}
              onChecksDone={() => { setChecksFor(null); focusRowMenu(r.id); }}
              onMove={(d) => void onMove(r, d)}
              onDelete={() => void onDelete(r)} />
          ))}
        </PriorityGroupSection>
      ))}
      {editable && !failed && formFor === "new" && (
        <RequirementForm mode="create" busy={busy} error={error} onSubmit={(v) => void onSubmit(v)} onCancel={() => openForm(null)} />
      )}
      {editable && !failed && formFor !== "new" && (
        <div><AddButton disabled={busy} onClick={() => { setChecksFor(null); openForm("new"); }}>{t("analysis.brief.addARequirement", "Add a requirement")}</AddButton></div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ a priority group

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function PriorityGroupSection({ priority, count, children }: { priority: Priority; count: number; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="flex flex-wrap items-baseline gap-x-2 px-1 pb-1.5 text-[12px]">
        <span className="font-semibold uppercase tracking-[0.06em] text-ink2">{PRIORITY_WORD[priority]}</span>
        <span className="num font-medium text-ink3">{count}</span>
        <span className="text-ink3">· {lowerFirst(PRIORITY_HINT[priority])}</span>
      </h3>
      <ol className={ROWS_BOX}>{children}</ol>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ the filter

const FILTERS: readonly PriorityFilter[] = ["all", ...PRIORITY_ORDER];

/** All · Must · Should · Could, each with its count (a radio group: the arrow keys move the choice). */
function PriorityFilterRadios({ value, counts, onChange }: { value: PriorityFilter; counts: PriorityCounts; onChange: (f: PriorityFilter) => void }) {
  const t = useT();
  const total = counts.must + counts.nice + counts.later;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (FILTERS.indexOf(value) + d + FILTERS.length) % FILTERS.length;
    onChange(FILTERS[i]);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t("analysis.brief.filterByPriority", "Show requirements by priority")} onKeyDown={onKey}
      className="inline-flex max-w-full flex-wrap rounded-full bg-surface2 p-0.5 ring-1 ring-inset ring-line">
      {FILTERS.map((f) => {
        const on = f === value;
        return (
          <button key={f} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(f)}
            className={cn("h-7 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
              on ? "bg-surface text-ink shadow-card dark:bg-ink/[0.14]" : "text-ink2 hover:text-ink")}>
            {f === "all" ? t("analysis.brief.filterAll", "All") : PRIORITY_WORD[f]} <span className="num text-ink3">{f === "all" ? total : counts[f]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ one requirement

function RequirementLine({
  projectId, r, n, open, onToggle, editable, viewOnly, stepOpen, busy, priorityBusy, author, bounds, checksOpen,
  onEdit, onPriority, onChecks, onChecksDone, onMove, onDelete,
}: {
  projectId: string; r: RequirementRecord; n: number; open: boolean; onToggle: () => void;
  editable: boolean; viewOnly: boolean; stepOpen: boolean; busy: boolean; priorityBusy: boolean; author: string | null;
  bounds: { up: boolean; down: boolean }; checksOpen: boolean;
  onEdit: () => void; onPriority: (p: Priority) => void; onChecks: () => void; onChecksDone: () => void;
  onMove: (dir: -1 | 1) => void; onDelete: () => void;
}) {
  const t = useT();
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  const name = r.label ? `${r.label} ${r.title}` : r.title;
  const c = useItemComments({ type: "requirement", id: r.id, title: r.title, editable, viewOnly, stepOpen });
  const source = requirementSource(r.origin);
  const sourceLabel = provenanceLabel(r.origin, author);
  const saving = busy ? t("analysis.brief.saving", "Saving…") : undefined;

  // "Edit checks": the first check takes the focus
  useEffect(() => {
    if (checksOpen) requestAnimationFrame(() => body.current?.querySelector<HTMLInputElement>("input")?.focus());
  }, [checksOpen]);

  const entry: Record<RequirementAction, () => MenuEntry> = {
    edit: () => ({ key: "edit", label: t("analysis.brief.edit", "Edit"), icon: Pencil, onSelect: onEdit, disabled: busy, disabledNote: saving }),
    priority: () => ({
      key: "priority", label: t("analysis.brief.changePriority", "Change priority"), icon: Flag, hint: PRIORITY_WORD[r.priority], disabled: busy || priorityBusy, disabledNote: saving,
      choices: PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_WORD[p], hint: PRIORITY_HINT[p], checked: p === r.priority, onSelect: () => onPriority(p) })),
    }),
    checks: () => ({ key: "checks", label: t("analysis.brief.editChecks", "Edit checks"), icon: ListChecks, onSelect: onChecks, disabled: busy, disabledNote: saving }),
    comment: () => ({ key: "comment", ...commentEntry(c.mode ?? "view", c.count), icon: MessageSquare, onSelect: c.open }),
    moveUp: () => ({ key: "moveUp", label: t("analysis.brief.moveUp", "Move up"), icon: ArrowUp, onSelect: () => onMove(-1), disabled: busy || !bounds.up,
      disabledNote: busy ? saving : t("analysis.brief.alreadyFirst", "Already first among the {priority} requirements", { priority: PRIORITY_WORD[r.priority].toLowerCase() }) }),
    moveDown: () => ({ key: "moveDown", label: t("analysis.brief.moveDown", "Move down"), icon: ArrowDown, onSelect: () => onMove(1), disabled: busy || !bounds.down,
      disabledNote: busy ? saving : t("analysis.brief.alreadyLast", "Already last among the {priority} requirements", { priority: PRIORITY_WORD[r.priority].toLowerCase() }) }),
    delete: () => ({ key: "delete", label: t("analysis.brief.delete", "Delete"), icon: Trash2, danger: true, onSelect: onDelete, disabled: busy, disabledNote: saving }),
  };
  const entries = requirementActions({ editable, comment: c.mode }).map((a) => entry[a]());

  return (
    <li className={cn(FEEDBACK_ITEM, c.isOpen && FEEDBACK_OPEN)} data-feedback-item={c.key}>
      <div className="flex min-w-0 items-center gap-1 pr-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className={ROW_TOGGLE}>
          <ChevronRight size={15} strokeWidth={1.75} aria-hidden
            className={cn("shrink-0 text-ink3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          <span className="num w-5 shrink-0 text-[12.5px] text-ink3">{rowNumber(n)}</span>
          <span className={cn("min-w-0 flex-1 break-words text-[14.5px] leading-snug text-ink", open ? "font-medium" : "line-clamp-2 sm:line-clamp-1")}>{r.title}</span>
          <PriorityTag value={r.priority} busy={priorityBusy} className="hidden sm:inline-flex" />
          <span className={cn("num shrink-0 whitespace-nowrap pl-1 text-right text-[12.5px] sm:w-[88px]", r.criteria.length ? "text-ink3" : "text-[rgb(var(--c-warning-text))]")}>
            {checksLabel(r.criteria.length)}
          </span>
          <SourceHint kind={source} label={sourceLabel} className="hidden sm:grid" />
        </button>
        <CommentSlot><CommentCount c={c} name={name} /></CommentSlot>
        <ItemMenu label={t("analysis.brief.actionsFor", "Actions for {name}", { name })} entries={entries} onOpen={c.closeOthers}
          triggerAttrs={{ "data-row-menu": r.id, ...(c.mode ? { "data-feedback-button": c.key } : {}) }} />
      </div>
      <div ref={body} id={bodyId} hidden={!open} className="pb-3.5 pl-[61px] pr-4">
        {open && (
          <>
            {r.detail && !sameWords(r.detail, r.title) && (
              <p className="text-pretty break-words text-[13.5px] leading-relaxed text-ink2">{r.detail}</p>
            )}
            <div className={cn(r.detail && !sameWords(r.detail, r.title) && "mt-2.5")}>
              <h4 className="text-[12px] font-medium text-ink3">{t("analysis.brief.howWeKnowItWorks", "How we'll know it works")}</h4>
              {checksOpen ? (
                <div className="mt-1.5">
                  <ChecksEditor projectId={projectId} requirementId={r.id} criteria={r.criteria} label={t("analysis.brief.acceptanceCriteriaFor", "Acceptance criteria for {name}", { name: r.label || r.title })}
                    onDone={onChecksDone} />
                </div>
              ) : r.criteria.length > 0 ? (
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13.5px] leading-snug text-ink2 marker:text-ink3">
                  {r.criteria.map((x, i) => <li key={i} className="break-words">{x}</li>)}
                </ol>
              ) : (
                <p className="mt-1 text-[13px] text-[rgb(var(--c-warning-text))]">{t("analysis.brief.noAcceptanceChecks", "No acceptance checks yet.")}</p>
              )}
            </div>
            <SourceLine kind={source} label={sourceLabel}>
              {r.label && <span className="num">{r.label}</span>}
              <VersionChip projectId={projectId} itemKey={`requirement:${r.id}`} editable={editable} label={t("analysis.brief.requirementLabel", "Requirement {label}", { label: r.label })} />
              <ChangeBadges featureRef={featureRef("requirement", r.id)} />
            </SourceLine>
          </>
        )}
      </div>
    </li>
  );
}
