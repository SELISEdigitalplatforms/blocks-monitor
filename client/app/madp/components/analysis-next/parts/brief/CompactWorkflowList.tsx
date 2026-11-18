/** "Workflows, constraints & not included" on the Business Analysis page: three compact lists. A workflow is one line
 *  (title, who does it, how many steps) that opens to its steps; a constraint or an exclusion is one line. Every item has
 *  the same ⋯ menu as a requirement (Edit, Comment, Move up / down, Delete) and each list one quiet "Add" button.
 *  The same reads, writes and rules as the Requirements page's Workflows tab (requirements/WorkflowsTab): items shown
 *  from the setup answers until the first edit imports them, every write one project function op (useSaveExtra,
 *  useRemoveExtra with 10 seconds to undo, useMoveExtra), comments through the one feedback card. */
import { constraintTagName, extraLabel } from "@/madp/components/requirements/domainLabels";
import { useT } from "@/madp/i18n";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Ban, ChevronRight, MessageSquare, Pencil, Route, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useMemberName, useRequirementsContext } from "@/madp/blocks/requirements/context";
import { useRequirementsExtras } from "@/madp/blocks/requirements/extras";
import { useMoveExtra, useRemoveExtra, useSaveExtra, type SaveExtraArgs } from "@/madp/blocks/requirements/extrasMutations";
import { type ConstraintKind, type ExtraKind, type ExtraRecord } from "@/madp/domain/requirementsExtras";
import { FEEDBACK_ITEM, FEEDBACK_OPEN } from "@/madp/components/feedback/feedbackUi";
import { LoadError } from "@/madp/components/sanitization/shared";
import type { ExtraFormValue } from "@/madp/components/requirements/extrasForm";
import { extraTitle } from "@/madp/components/requirements/WorkflowsTab";
import { requirementsErrorMessage } from "@/madp/components/requirements/messages";
import {
  allOpen, commentEntry, expandAll, extraActions, extraSource, extraSourceLabel, rowNumber, stepsLabel, toggleIn, type ExtraAction,
} from "./compactList";
import { ItemMenu, type MenuEntry } from "./ItemMenu";
import { ExtraItemForm } from "./ExtraItemForm";
import {
  AddButton, CommentCount, CommentSlot, ExpandAllButton, ROWS_BOX, ROW_STATIC, ROW_TOGGLE, SourceHint, SourceLine, UndoLine, useItemComments,
} from "./rowParts";

/** Ten seconds to take a delete back (as on the Requirements page). */
const UNDO_MS = 10_000;

/** The part's order: workflows, constraints, then what is left out. */
const KINDS: readonly ExtraKind[] = ["workflow", "constraint", "exclusion"];

const ICON: Record<ExtraKind, ReactNode> = {
  workflow: <Route size={15} strokeWidth={1.75} aria-hidden />,
  constraint: <ShieldCheck size={15} strokeWidth={1.75} aria-hidden />,
  exclusion: <Ban size={15} strokeWidth={1.75} aria-hidden />,
};

type FormFor = { kind: ExtraKind; id: string | "new" } | null;

const focusRowMenu = (id: string) => requestAnimationFrame(() => {
  document.querySelector<HTMLElement>(`[data-row-menu="${CSS.escape(id)}"]`)?.focus();
});

export function CompactWorkflowList({ projectId, editable, readOnlyReason, stepOpen }: {
  projectId: string;
  /** The requirements are open and the person may edit them. */
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  /** The requirements step is open (comments can be added). */
  stepOpen: boolean;
}) {
  const t = useT();
  const ctx = useRequirementsContext(projectId);
  const extras = useRequirementsExtras(projectId, ctx.project?.setup);
  const nameOf = useMemberName();
  const save = useSaveExtra(projectId);
  const remove = useRemoveExtra(projectId);
  const move = useMoveExtra(projectId);
  const [formFor, setFormFor] = useState<FormFor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: ExtraKind; text: string } | null>(null);
  const [removed, setRemoved] = useState<{ id: string; kind: ExtraKind; title: string } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const clientKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clearTimer, []);
  useEffect(() => { if (!editable) setFormFor(null); }, [editable]);

  const openForm = useCallback((f: FormFor) => {
    setError(null);
    clientKey.current = f?.id === "new" ? crypto.randomUUID() : null;
    setFormFor(f);
  }, []);

  const run = async (kind: ExtraKind, fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError({ kind, text: requirementsErrorMessage(e) }); return false; } finally { setBusy(false); }
  };

  const onSubmit = async (kind: ExtraKind, v: ExtraFormValue, id: string | null) => {
    const body: SaveExtraArgs = {
      kind, title: v.title,
      ...(kind === "workflow" ? { who: v.who, steps: v.steps } : {}),
      ...(kind === "constraint" ? { constraintKind: v.constraintKind } : {}),
      ...(id ? { id } : { clientKey: clientKey.current ?? crypto.randomUUID() }),
    };
    if (await run(kind, () => save.mutateAsync(body))) {
      openForm(null);
      if (id) focusRowMenu(id);
    }
  };

  const onRemove = async (e: ExtraRecord) => {
    const ok = await run(e.kind, async () => {
      const a = await remove.mutateAsync({ id: e.id });
      const id = typeof a.extra?.ItemId === "string" ? a.extra.ItemId : e.id;
      clearTimer();
      setRemoved({ id, kind: e.kind, title: extraTitle(e) });
    });
    if (!ok) return;
    timer.current = setTimeout(() => setRemoved(null), UNDO_MS);
    requestAnimationFrame(() => undoButton.current?.focus());
  };

  const onUndo = async () => {
    if (!removed) return;
    const r = removed;
    clearTimer();
    if (await run(r.kind, () => save.mutateAsync({ id: r.id, kind: r.kind, restore: true }))) { setRemoved(null); focusRowMenu(r.id); }
  };

  const onMove = async (e: ExtraRecord, dir: -1 | 1) => {
    if (await run(e.kind, () => move.mutateAsync({ id: e.id, dir }))) focusRowMenu(e.id);
  };

  const viewOnly = readOnlyReason === "permission";
  const workflowIds = extras.byKind.workflow.map((w) => w.id);

  if (extras.error && !extras.hasRows && !extras.fromSetup) return <LoadError onRetry={extras.refetch} />;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {extras.loading && <p className="text-[14px] text-ink2">{t("analysis.brief.loading", "Loading…")}</p>}
      {KINDS.map((kind) => {
        const items = extras.byKind[kind];
        const mine = formFor?.kind === kind;
        const usedKinds = items.map((e) => e.constraintKind).filter((k): k is ConstraintKind => !!k);
        const err = error?.kind === kind ? error.text : null;
        return (
          <KindSection key={kind} kind={kind} count={items.length}
            tools={<>
              {kind === "workflow" && items.length > 1 && (
                <ExpandAllButton all={allOpen(workflowIds, expanded)} onClick={() => setExpanded(expandAll(workflowIds, expanded))} />
              )}
              {editable && !(mine && formFor?.id === "new") && (
                <AddButton disabled={busy} onClick={() => openForm({ kind, id: "new" })}>{extraLabel(kind).add}</AddButton>
              )}
            </>}>
            <UndoLine text={removed?.kind === kind ? t("analysis.brief.deletedItem", "Deleted: {title}", { title: removed.title }) : null} canUndo={editable} busy={busy}
              onUndo={() => void onUndo()} undoRef={removed?.kind === kind ? undoButton : undefined} />
            {err && formFor === null && <p role="alert" className="text-[13px] text-[rgb(var(--c-danger-text))]">{t("analysis.brief.notSaved", "Not saved: {error}", { error: err })}</p>}
            {items.length === 0 && !(mine && formFor?.id === "new") && !extras.loading && (
              <p className="px-1 text-[13.5px] text-ink3">{extraLabel(kind).empty}</p>
            )}
            {items.length > 0 && (
              <ol className={ROWS_BOX}>
                {items.map((e, i) => mine && formFor?.id === e.id ? (
                  <li key={e.id} className="p-3">
                    <ExtraItemForm kind={kind} initial={e} usedKinds={usedKinds} busy={busy} error={err}
                      onSubmit={(v) => void onSubmit(kind, v, e.id)} onCancel={() => { openForm(null); focusRowMenu(e.id); }} />
                  </li>
                ) : (
                  <ExtraLine key={e.id} e={e} n={i + 1} count={items.length} open={expanded.has(e.id)}
                    onToggle={() => setExpanded((s) => toggleIn(s, e.id))}
                    editable={editable} viewOnly={viewOnly} stepOpen={stepOpen} busy={busy} author={nameOf(e.authorUserId)}
                    onEdit={() => openForm({ kind, id: e.id })} onMove={(d) => void onMove(e, d)} onDelete={() => void onRemove(e)} />
                ))}
              </ol>
            )}
            {editable && mine && formFor?.id === "new" && (
              <ExtraItemForm kind={kind} usedKinds={usedKinds} busy={busy} error={err}
                onSubmit={(v) => void onSubmit(kind, v, null)} onCancel={() => openForm(null)} />
            )}
          </KindSection>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ one list

function KindSection({ kind, count, tools, children }: { kind: ExtraKind; count: number; tools: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section id={`doc-${kind}`} aria-labelledby={id} className="flex min-w-0 scroll-mt-28 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={id} className="flex items-center gap-2 px-1 text-[12px]">
          <span className="text-ink3">{ICON[kind]}</span>
          <span className="font-semibold uppercase tracking-[0.06em] text-ink2">{extraLabel(kind).title}</span>
          <span className="num font-medium text-ink3">{count}</span>
        </h3>
        <span className="ml-auto flex flex-wrap items-center gap-1">{tools}</span>
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ one item

function ExtraLine({ e, n, count, open, onToggle, editable, viewOnly, stepOpen, busy, author, onEdit, onMove, onDelete }: {
  e: ExtraRecord; n: number; count: number; open: boolean; onToggle: () => void;
  editable: boolean; viewOnly: boolean; stepOpen: boolean; busy: boolean; author: string | null;
  onEdit: () => void; onMove: (dir: -1 | 1) => void; onDelete: () => void;
}) {
  const t = useT();
  const bodyId = useId();
  const title = extraTitle(e);
  const one = extraLabel(e.kind).one;
  const name = e.kind === "constraint" ? title
    : t("analysis.brief.extraName", "{kind} {n}: {title}", { kind: `${one.charAt(0).toUpperCase()}${one.slice(1)}`, n, title: e.title });
  // an item shown from the setup answers has no row yet, so no thread (as on the Requirements page)
  const c = useItemComments({ type: "extra", id: e.id, title, editable, viewOnly, stepOpen, commentable: !e.fromSetup });
  const source = extraSource(e);
  const sourceLabel = extraSourceLabel(e, author);
  const saving = busy ? t("analysis.brief.saving", "Saving…") : undefined;
  const expandable = e.kind === "workflow";

  const entry: Record<ExtraAction, () => MenuEntry> = {
    edit: () => ({ key: "edit", label: t("analysis.brief.edit", "Edit"), icon: Pencil, onSelect: onEdit, disabled: busy, disabledNote: saving }),
    comment: () => ({ key: "comment", ...commentEntry(c.mode ?? "view", c.count), icon: MessageSquare, onSelect: c.open }),
    moveUp: () => ({ key: "moveUp", label: t("analysis.brief.moveUp", "Move up"), icon: ArrowUp, onSelect: () => onMove(-1), disabled: busy || n <= 1,
      disabledNote: busy ? saving : t("analysis.brief.alreadyFirstPlain", "Already first") }),
    moveDown: () => ({ key: "moveDown", label: t("analysis.brief.moveDown", "Move down"), icon: ArrowDown, onSelect: () => onMove(1), disabled: busy || n >= count,
      disabledNote: busy ? saving : t("analysis.brief.alreadyLastPlain", "Already last") }),
    delete: () => ({ key: "delete", label: t("analysis.brief.delete", "Delete"), icon: Trash2, danger: true, onSelect: onDelete, disabled: busy, disabledNote: saving }),
  };
  const entries = extraActions({ editable, comment: c.mode }).map((a) => entry[a]());

  const line = (
    <>
      <span className="num w-5 shrink-0 text-[12.5px] text-ink3">{rowNumber(n)}</span>
      {e.kind === "constraint" ? (
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {constraintTagName(e.constraintKind) && <span className="shrink-0 text-[12.5px] font-medium text-ink2">{constraintTagName(e.constraintKind)}</span>}
          <span className="min-w-0 break-words text-[14.5px] leading-snug text-ink">{e.title || <span className="text-ink3">{t("analysis.brief.noDetailsYet", "No details yet")}</span>}</span>
        </span>
      ) : e.kind === "exclusion" ? (
        <span className="min-w-0 flex-1 break-words text-[14.5px] leading-snug text-ink">{e.title}</span>
      ) : (
        <>
          <span className={cn("min-w-0 flex-1 break-words text-[14.5px] leading-snug text-ink", open ? "font-medium" : "line-clamp-2 sm:line-clamp-1")}>{e.title}</span>
          {e.who && <span className="hidden max-w-[30%] shrink truncate text-[12.5px] text-ink3 sm:inline" title={t("analysis.brief.whoValue", "Who: {who}", { who: e.who })}>{e.who}</span>}
          <span className={cn("num shrink-0 whitespace-nowrap pl-1 text-right text-[12.5px] sm:w-[88px]", e.steps.length ? "text-ink3" : "text-[rgb(var(--c-warning-text))]")}>
            {stepsLabel(e.steps.length)}
          </span>
        </>
      )}
      {/* on phones a workflow shows its source when opened; a one-line item keeps the icon */}
      <SourceHint kind={source} label={sourceLabel} className={expandable ? "hidden sm:grid" : undefined} />
    </>
  );

  return (
    <li className={cn(FEEDBACK_ITEM, c.isOpen && FEEDBACK_OPEN)} data-feedback-item={c.key}>
      <div className="flex min-w-0 items-center gap-1 pr-1.5">
        {expandable ? (
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className={ROW_TOGGLE}>
            <ChevronRight size={15} strokeWidth={1.75} aria-hidden
              className={cn("shrink-0 text-ink3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
            {line}
          </button>
        ) : (
          // one line, nothing more to open: the same spacing as a workflow's row, without its arrow
          <div className={ROW_STATIC}>
            <span aria-hidden className="w-[15px] shrink-0" />
            {line}
          </div>
        )}
        <CommentSlot><CommentCount c={c} name={name} /></CommentSlot>
        <ItemMenu label={t("analysis.brief.actionsFor", "Actions for {name}", { name })} entries={entries} onOpen={c.closeOthers}
          triggerAttrs={{ "data-row-menu": e.id, ...(c.mode ? { "data-feedback-button": c.key } : {}) }} />
      </div>
      {expandable && (
        <div id={bodyId} hidden={!open} className="pb-3.5 pl-[61px] pr-4">
          {open && (
            <>
              {e.who && <p className="text-[13px] text-ink2"><span className="text-ink3">{t("analysis.brief.whoLabel", "Who:")}</span> {e.who}</p>}
              {e.steps.length > 0 ? (
                <ol className={cn("list-decimal space-y-1 pl-5 text-[13.5px] leading-snug text-ink2 marker:text-ink3", e.who && "mt-1.5")}>
                  {e.steps.map((s, i) => <li key={i} className="break-words">{s}</li>)}
                </ol>
              ) : (
                <p className={cn("text-[13px] text-[rgb(var(--c-warning-text))]", e.who && "mt-1.5")}>{t("analysis.brief.noStepsYetSentence", "No steps yet.")}</p>
              )}
              <SourceLine kind={source} label={sourceLabel} />
            </>
          )}
        </div>
      )}
    </li>
  );
}
