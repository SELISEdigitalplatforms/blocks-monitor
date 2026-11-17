/** "Workflows & limits" of Goals & requirements: the key workflows (who does what, step by step), what is not included
 *  and the constraints (deadline, budget, compliance, languages, integrations…). Pre-filled from the project setup
 *  answers until the first edit imports them. Each item can be edited, moved, removed (undo for 10 seconds) and
 *  discussed in a comment thread like a requirement. Every write is a project function op (extrasMutations.ts). */
import { t, useT } from "@/i18n";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Ban, Pencil, Plus, Route, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { Button, Chip, Input, Label, Select, Textarea } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { VIEWER_TIP } from "@/domain/rbac";
import { useMemberName, useRequirementsContext } from "@/blocks/requirements/context";
import { useRequirementsExtras } from "@/blocks/requirements/extras";
import { useMoveExtra, useRemoveExtra, useSaveExtra, type SaveExtraArgs } from "@/blocks/requirements/extrasMutations";
import {
  CONSTRAINT_KINDS, EXTRA_LIMITS, freeConstraintKinds, type ConstraintKind, type ExtraKind, type ExtraRecord,
} from "@/domain/requirementsExtras";
import { constraintKindName, constraintPlaceholder, constraintTagName, constraintWords, extraLabel } from "./domainLabels";
import { targetKey } from "@/data/feedback";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { FEEDBACK_ITEM, FEEDBACK_OPEN, useIsFeedbackOpen, type FeedbackTarget } from "@/components/feedback/feedbackUi";
import { extraProblem, linesOf, type ExtraFormValue } from "./extrasForm";
import { requirementsErrorMessage } from "./messages";
import { UNDO_MS } from "./MustTab";
import { DocBlock } from "./ObjectiveTab";
import type { ReqTab } from "./requirementsTab";

export interface WorkflowsTabProps {
  projectId: string;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  onOpenTab: (tab: ReqTab) => void;
  onEditingChange?: (editing: boolean) => void;
  /** Opens the add form of a list (a checklist chip asked for it); `n` changes on every request. */
  addRequest?: { kind: ExtraKind; n: number } | null;
}

const ICON: Record<ExtraKind, ReactNode> = {
  workflow: <Route size={18} strokeWidth={1.75} />,
  exclusion: <Ban size={18} strokeWidth={1.75} />,
  constraint: <ShieldCheck size={18} strokeWidth={1.75} />,
};

/** One item's words for its feedback card and screen readers. */
export function extraTitle(e: Pick<ExtraRecord, "kind" | "title" | "constraintKind">): string {
  if (e.kind === "constraint") return constraintWords(e);
  return e.title;
}

function originLabel(e: ExtraRecord, author: string | null): string {
  if (e.fromSetup || e.origin === "setup") return t("analysis.requirements.extraFromSetup", "From the project setup");
  if (e.origin === "engine") return t("analysis.requirements.extraFromDraft", "From your business analyst's draft");
  if (e.origin === "live-product") return t("analysis.requirements.extraFromLive", "From the live product");
  return author?.trim()
    ? t("analysis.requirements.addedBy", "Added by {name}", { name: author.trim() })
    : t("analysis.requirements.addedByMember", "Added by a workspace member");
}

// ------------------------------------------------------------------------------------------------ the form

function ExtraForm({ kind, initial, usedKinds, busy, error, onSubmit, onCancel }: {
  kind: ExtraKind; initial?: ExtraRecord; usedKinds: ConstraintKind[]; busy: boolean; error: string | null;
  onSubmit: (v: ExtraFormValue) => void; onCancel: () => void;
}) {
  useT();
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
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

  const label = initial ? t("analysis.requirements.editExtra", "Edit: {item}", { item: extraLabel(kind).one }) : extraLabel(kind).add;
  return (
    <form ref={form} className="space-y-3 rounded-block bg-surface2 p-4" noValidate aria-label={label}
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {kind === "workflow" && (
        <>
          <div>
            <label htmlFor={`${uid}-title`}><Label>{t("analysis.requirements.whatHappens", "What happens")}</Label></label>
            <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
              placeholder={t("analysis.requirements.whatHappensPlaceholder", "For example: approve a leave request")} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="max-w-md">
            <label htmlFor={`${uid}-who`}><Label>{t("analysis.requirements.whoDoesIt", "Who does it")}</Label></label>
            <Input id={`${uid}-who`} value={who} maxLength={EXTRA_LIMITS.who} disabled={busy}
              placeholder={t("analysis.requirements.whoDoesItPlaceholder", "For example: team lead")} onChange={(e) => setWho(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-steps`}><Label>{t("analysis.requirements.steps", "Steps")}</Label></label>
            <Textarea id={`${uid}-steps`} value={stepsText} rows={4} disabled={busy}
              placeholder={t("analysis.requirements.stepsPlaceholder", "One step per line, for example:\nThe employee asks for the days off\nThe team lead approves or declines\nPayroll sees it on the next run")}
              onChange={(e) => setStepsText(e.target.value)} />
          </div>
        </>
      )}
      {kind === "exclusion" && (
        <div>
          <label htmlFor={`${uid}-title`}><Label>{t("analysis.requirements.whatWeLeaveOut", "What we leave out")}</Label></label>
          <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
            placeholder={t("analysis.requirements.leaveOutPlaceholder", "For example: a separate app for the app stores")} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}
      {kind === "constraint" && (
        <>
          <div className="max-w-xs">
            <Label>{t("analysis.requirements.kind", "Kind")}</Label>
            <Select label={t("analysis.requirements.kindOfConstraint", "Kind of constraint")} value={ck} options={kindOptions} disabled={busy} onChange={(v) => setCk(v as ConstraintKind)} />
          </div>
          <div>
            <label htmlFor={`${uid}-title`}><Label>{t("analysis.requirements.whatWeMustRespect", "What we must respect")}</Label></label>
            <Input id={`${uid}-title`} value={title} maxLength={EXTRA_LIMITS.title} disabled={busy} autoFocus
              placeholder={constraintPlaceholder(ck)} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </>
      )}
      <div role="alert" className="min-h-[1px] text-[13px] text-[rgb(var(--c-danger-text))]">{shown || null}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{initial ? t("analysis.requirements.saveChanges", "Save changes") : extraLabel(kind).add}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{t("analysis.requirements.cancel", "Cancel")}</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ one item

function ExtraLine({ e, index, count, editable, viewOnly, busy, author, onEdit, onRemove, onMove }: {
  e: ExtraRecord; index: number; count: number; editable: boolean; viewOnly: boolean; busy: boolean; author: string | null;
  onEdit: () => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  useT();
  const title = extraTitle(e);
  const closedNote = t("analysis.requirements.closedNote", "The requirements are confirmed, so this item stays as it is.");
  const target = useMemo<FeedbackTarget>(() => ({
    type: "extra", id: e.id, title, base: title, locked: !editable,
    lockedNote: viewOnly ? VIEWER_TIP : closedNote,
  }), [e.id, title, editable, viewOnly, closedNote]);
  const isOpen = useIsFeedbackOpen("extra", e.id);
  const ctl = "!h-8 !w-8 !p-0";
  const tag = e.kind === "constraint" ? constraintTagName(e.constraintKind) : "";
  const name = e.kind === "constraint" ? tag || title : `${extraLabel(e.kind).one} ${index + 1}`;
  return (
    <li className={cn("flex gap-3 px-2 py-2.5", FEEDBACK_ITEM, isOpen && FEEDBACK_OPEN)} data-feedback-item={targetKey("extra", e.id)}>
      <span className="num w-6 shrink-0 pt-[2px] text-[13px] text-ink3">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1">
        {e.kind === "constraint" ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {tag && <Chip tone="accent">{tag}</Chip>}
            <span className="break-words text-[15px] leading-snug">{e.title || <span className="text-ink3">{t("analysis.requirements.noDetailsYet", "No details yet")}</span>}</span>
          </div>
        ) : (
          <div className="break-words text-[15px] leading-snug">{e.title}</div>
        )}
        {e.kind === "workflow" && e.who && <div className="mt-0.5 text-[13px] text-ink2">{t("analysis.requirements.whoValue", "Who: {who}", { who: e.who })}</div>}
        {e.kind === "workflow" && e.steps.length > 0 && (
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] leading-snug text-ink2">
            {e.steps.map((s, i) => <li key={i} className="break-words">{s}</li>)}
          </ol>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><Chip>{originLabel(e, author)}</Chip></div>
      </div>
      <span className="flex shrink-0 flex-wrap items-start justify-end gap-1.5 self-start">
        {editable && (
          <>
            <Button variant="ghost" size="sm" className={ctl} icon={<ArrowUp size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.moveItemUp", "Move {name} up", { name })} title={t("analysis.requirements.moveUp", "Move up")} disabled={busy || index === 0} onClick={() => onMove(-1)} />
            <Button variant="ghost" size="sm" className={ctl} icon={<ArrowDown size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.moveItemDown", "Move {name} down", { name })} title={t("analysis.requirements.moveDown", "Move down")} disabled={busy || index >= count - 1} onClick={() => onMove(1)} />
            <Button variant="ghost" size="sm" className={ctl} icon={<Pencil size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.editItem", "Edit {name}", { name })} title={t("analysis.requirements.edit", "Edit")} disabled={busy} onClick={onEdit} />
            <Button variant="ghost" size="sm" className={ctl} icon={<Trash2 size={15} strokeWidth={1.75} />}
              aria-label={t("analysis.requirements.removeItem", "Remove {name}", { name })} title={t("analysis.requirements.remove", "Remove")} disabled={busy} onClick={onRemove} />
          </>
        )}
        {!e.fromSetup && <FeedbackButton target={target} className="-my-1" />}
      </span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ one section

type FormFor = { kind: ExtraKind; id: string | "new" } | null;

function Section({ kind, items, editable, viewOnly, busy, formFor, error, removed, nameOf, onOpenForm, onSubmit, onRemove, onUndo, onMove }: {
  kind: ExtraKind; items: ExtraRecord[]; editable: boolean; viewOnly: boolean; busy: boolean; formFor: FormFor; error: string | null;
  removed: { kind: ExtraKind; title: string } | null; nameOf: (id: string | null) => string | null;
  onOpenForm: (f: FormFor) => void; onSubmit: (kind: ExtraKind, v: ExtraFormValue, id: string | null) => void;
  onRemove: (e: ExtraRecord) => void; onUndo: () => void; onMove: (e: ExtraRecord, dir: -1 | 1) => void;
}) {
  useT();
  const l = extraLabel(kind);
  const mine = formFor?.kind === kind;
  const usedKinds = items.map((e) => e.constraintKind).filter((k): k is ConstraintKind => !!k);
  return (
    <section id={`doc-${kind}`} aria-label={l.title} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
    <DocBlock title={l.title} icon={ICON[kind]}
      action={<>
        <Chip>{items.length}</Chip>
        {editable && !(mine && formFor?.id === "new") && (
          <Button variant="ghost" size="sm" icon={<Plus size={15} strokeWidth={1.75} />} disabled={busy}
            onClick={() => onOpenForm({ kind, id: "new" })}>{l.add}</Button>
        )}
      </>}>
      <div role="status" aria-live="polite" className="text-[13px] text-ink2 empty:hidden">
        {removed?.kind === kind && (
          <span className="mb-3 flex flex-wrap items-center gap-2 rounded-block bg-surface2 px-3 py-2">
            <span>{t("analysis.requirements.removedItem", "Removed: {title}", { title: removed.title })}</span>
            {editable && <Button variant="ghost" size="sm" icon={<Undo2 size={14} strokeWidth={1.75} />} onClick={onUndo}>{t("analysis.requirements.undo", "Undo")}</Button>}
          </span>
        )}
      </div>
      {error && mine && formFor === null && <p role="alert" className="mb-3 text-[13px] text-[rgb(var(--c-danger-text))]">{error}</p>}
      {items.length === 0 && !(mine && formFor?.id === "new") && <p className="py-1 text-[14px] text-ink2">{l.empty}</p>}
      {items.length > 0 && (
        <ol className="divide-y divide-line">
          {items.map((e, i) => mine && formFor?.id === e.id ? (
            <li key={e.id} className="py-3">
              <ExtraForm kind={kind} initial={e} usedKinds={usedKinds} busy={busy} error={error}
                onSubmit={(v) => onSubmit(kind, v, e.id)} onCancel={() => onOpenForm(null)} />
            </li>
          ) : (
            <ExtraLine key={e.id} e={e} index={i} count={items.length} editable={editable} viewOnly={viewOnly} busy={busy}
              author={nameOf(e.authorUserId)} onEdit={() => onOpenForm({ kind, id: e.id })} onRemove={() => onRemove(e)} onMove={(d) => onMove(e, d)} />
          ))}
        </ol>
      )}
      {editable && mine && formFor?.id === "new" && (
        <div className="mt-3">
          <ExtraForm kind={kind} usedKinds={usedKinds} busy={busy} error={error} onSubmit={(v) => onSubmit(kind, v, null)} onCancel={() => onOpenForm(null)} />
        </div>
      )}
    </DocBlock>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ the tab

export function WorkflowsTab({ projectId, editable, readOnlyReason, onEditingChange, addRequest }: WorkflowsTabProps) {
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
  const clientKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clearTimer, []);
  useEffect(() => { onEditingChange?.(formFor !== null); }, [formFor, onEditingChange]);
  useEffect(() => { if (!editable) setFormFor(null); }, [editable]);

  const openForm = useCallback((f: FormFor) => {
    setError(null);
    clientKey.current = f?.id === "new" ? crypto.randomUUID() : null;
    setFormFor(f);
  }, []);
  useEffect(() => { if (addRequest && editable) openForm({ kind: addRequest.kind, id: "new" }); }, [addRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (await run(kind, () => save.mutateAsync(body))) openForm(null);
  };

  const onRemove = async (e: ExtraRecord) => {
    const ok = await run(e.kind, async () => {
      const a = await remove.mutateAsync({ id: e.id });
      const id = typeof a.extra?.ItemId === "string" ? a.extra.ItemId : e.id;
      clearTimer();
      setRemoved({ id, kind: e.kind, title: extraTitle(e) });
    });
    if (ok) timer.current = setTimeout(() => setRemoved(null), UNDO_MS);
  };

  const onUndo = async () => {
    if (!removed) return;
    const r = removed;
    clearTimer();
    if (await run(r.kind, () => save.mutateAsync({ id: r.id, kind: r.kind, restore: true }))) setRemoved(null);
  };

  const onMove = (e: ExtraRecord, dir: -1 | 1) => void run(e.kind, () => move.mutateAsync({ id: e.id, dir }));

  const viewOnly = readOnlyReason === "permission";
  const shared = {
    editable, viewOnly, busy, formFor, removed, nameOf: (id: string | null) => (id ? nameOf(id) : null),
    onOpenForm: openForm, onSubmit, onRemove, onUndo, onMove,
  };
  const errorOf = (k: ExtraKind) => (error?.kind === k ? error.text : null);
  return (
    <>
      <Section kind="workflow" items={extras.byKind.workflow} error={errorOf("workflow")} {...shared} />
      <Section kind="exclusion" items={extras.byKind.exclusion} error={errorOf("exclusion")} {...shared} />
      <Section kind="constraint" items={extras.byKind.constraint} error={errorOf("constraint")} {...shared} />
    </>
  );
}
