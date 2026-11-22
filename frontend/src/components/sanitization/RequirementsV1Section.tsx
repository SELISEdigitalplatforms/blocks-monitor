// Requirements v1: the objective and the requirement list, autosaved 800 ms after typing stops. Read-only once
// sanitization is completed.
import { nameOr, priorityName } from "@/components/requirements/domainLabels";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, Label, Select, Textarea } from "@/ui/kit";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { FunctionError, newRequestId } from "@/blocks/fn";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { useRequirementsV1, useV1Versions, v1CompletedInfo, engineOutputIds } from "@/blocks/sanitization/hooks";
import { useSaveInitialRequirements } from "@/blocks/sanitization/ops";
import { REQUIREMENT_PRIORITIES } from "@/domain/sanitization";
import { formatNumber } from "@/domain/numbering";
import { FromMadpChip, LoadError, WriteNote, formatAt, type SectionProps } from "./shared";
import { DraftV1Panel } from "./DraftV1Panel";
import { hasV1Leftover, registerV1Editor, retireV1Editor, takeV1Leftover, v1FieldId, type V1EditorHandle } from "./v1Autosave";
import {
  MAX_CRITERIA, MAX_REQUIREMENTS, addRow, applySaveResult, buildSavePayload, contentOf, draftFromServer, editObjective, editRow, markFailed,
  markSending, mergeServer, moveCriterion, moveRow, needsTitle, putRow, rebaseObjective, rebaseRow, reloadObjective, reloadRow, removeRow,
  resolveAfterRead, sameContent,
  type Draft, type DraftPriority, type DraftRow, type SaveArgs, type SaveResult, type SentKeys, type ServerObjective, type ServerRequirement,
} from "./requirementsDraft";
import { t, useT } from "@/i18n";

const FLUSH_MS = 800;
const PRIORITY_OPTIONS = (REQUIREMENT_PRIORITIES as readonly string[]).map((p) => ({ value: p, label: nameOr(priorityName, REQUIREMENT_PRIORITIES, p) }));
const iconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

type Note = { state: "idle" | "saving" | "saved" | "error"; error?: unknown; onRetry?: () => void };
interface Flush { args: SaveArgs; requestId: string; sentKeys: SentKeys }

const rowLabel = (r: DraftRow) => (r.number === null ? t("settings.sanitization.requirements.newRow", "New") : formatNumber("R", r.number));

export function RequirementsV1Section(props: SectionProps) {
  return props.phase === "completed" ? <CompletedV1 {...props} /> : <OpenV1 {...props} />;
}

function CompletedV1({ workspaceId, projectId, members, existing }: SectionProps) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const v1 = useRequirementsV1(ctx);
  const versions = useV1Versions(ctx) as unknown;
  const rows = Array.isArray(versions) ? versions : ((versions as { versions?: unknown[]; rows?: unknown[]; data?: unknown[] })?.versions
    ?? (versions as { rows?: unknown[] })?.rows ?? (versions as { data?: unknown[] })?.data ?? []);
  const info = v1CompletedInfo(rows as never);
  return (
    <Card title={t("settings.sanitization.requirements.title", "Draft requirements")} icon={<ListChecks {...iconProps} />}>
      <div className="space-y-4">
        <p className="text-[14px] text-ink2">
          {info ? t("settings.sanitization.requirements.confirmedOnBy", "Confirmed on {at} by {name}", { at: formatAt(info.at), name: members.nameOf(info.byUserId) }) : t("settings.sanitization.requirements.confirmed", "Confirmed")}
          {" · "}
          <Link className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline" to={`/p/${projectId}/requirements`}>
            {existing ? t("settings.sanitization.requirements.openGoalsExisting", "Open Goals for the change") : t("settings.sanitization.requirements.openGoalsNew", "Open Goals & requirements")}
          </Link>
        </p>
        {v1.isError ? <LoadError onRetry={() => void v1.refetch()} /> : <ReadOnlyV1 v1={v1} />}
      </div>
    </Card>
  );
}

function Para({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return <div><Label>{label}</Label><p className="whitespace-pre-wrap break-words text-[14px] text-ink">{text}</p></div>;
}

function ReadOnlyV1({ v1, chipIds }: { v1: ReturnType<typeof useRequirementsV1>; chipIds?: ReadonlySet<string> }) {
  const t = useT();
  const reqs = v1.requirements ?? [];
  const o = v1.objective;
  const empty = reqs.length === 0 && !o?.Statement && !o?.HighLevelMd && !o?.ArchitectureMd;
  if (v1.isLoading) return <p className="text-[14px] text-ink2" role="status">{t("settings.sanitization.requirements.loading", "Loading…")}</p>;
  // the read-only view (no edit right, or the step is closed): nothing to tell the reader to add
  if (empty) return <EmptyState icon={<ListChecks {...iconProps} />} title={t("settings.sanitization.requirements.emptyReadOnly", "No requirements yet.")} />;
  return (
    <div className="space-y-4">
      <Para label={t("settings.sanitization.requirements.objective", "Objective")} text={o?.Statement} />
      <Para label={t("settings.sanitization.requirements.highLevel", "High-level details")} text={o?.HighLevelMd} />
      <Para label={t("settings.sanitization.requirements.architecture", "Architecture summary")} text={o?.ArchitectureMd} />
      <ol className="space-y-3">
        {reqs.map((r) => (
          <li key={r.ItemId} className="rounded-block bg-surface2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-ink3">{formatNumber("R", r.Number)}</span>
              <span className="text-[15px] font-medium text-ink">{r.Title}</span>
              <span className="text-[13px] text-ink2">{nameOr(priorityName, REQUIREMENT_PRIORITIES, r.Priority)}</span>
              {chipIds?.has(r.ItemId) && <FromMadpChip label={t("settings.sanitization.requirements.draftedByMadp", "Drafted by MADP")} />}
            </div>
            {r.Text && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink2">{r.Text}</p>}
            {(r.AcceptanceCriteria?.length ?? 0) > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-ink2">
                {r.AcceptanceCriteria!.map((c, i) => <li key={i} className="break-words">{c}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function OpenV1({ workspaceId, projectId, access }: SectionProps) {
  const t = useT();
  const editorRef = useRef<HTMLDivElement>(null);
  const me = access.userId ?? null;
  const ctx = { workspaceId, projectId };
  const v1 = useRequirementsV1(ctx);
  const jobsQuery = useEngineJobs(projectId, ["requirements.draft"]);
  const jobs = jobsQuery.data ?? [];
  const save = useSaveInitialRequirements(ctx);
  const canEdit = access.canEdit;

  const chipIds = useMemo(() => new Set<string>(Array.from(engineOutputIds(jobs, "requirements.draft", "Requirement") as Iterable<string>)), [jobs]);
  // an editor that was closed with unsaved text hands it on: wait for it instead of rebuilding from the server
  const adopting = useRef<boolean | null>(null);
  if (adopting.current === null) adopting.current = hasV1Leftover(projectId);
  const initial = useRef<Draft | null | undefined>(undefined);
  if (initial.current === undefined) {
    initial.current = adopting.current || v1.isLoading || v1.isError || !v1.requirements ? null : draftFromServer(v1.requirements as ServerRequirement[], v1.objective);
  }
  const [draft, setDraft] = useState<Draft | null>(initial.current);
  const [note, setNote] = useState<Note>({ state: "idle" });
  const [reloading, setReloading] = useState<string[]>([]);
  const draftRef = useRef<Draft | null>(initial.current);
  const removedRef = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const resolving = useRef(false);
  const lastError = useRef<unknown>(null);
  const settleRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const last = useRef<Flush | null>(null);
  const flushRef = useRef<(requestId?: string) => void>(() => undefined);
  const mounted = useRef(true);
  const wire = useRef<Promise<void> | null>(null);
  const serverRef = useRef<{ requirements: ServerRequirement[]; objective: ServerObjective | null | undefined } | null>(null);
  const { hash } = useLocation();

  // the save in flight (or the re-read after it); settles even after unmount
  const track = (p: Promise<unknown>) => {
    const t = p.then(() => undefined, () => undefined);
    wire.current = t;
    void t.then(() => { if (wire.current === t) wire.current = null; });
  };

  const update = useCallback((fn: (d: Draft) => Draft) => {
    const next = fn(draftRef.current as Draft);
    draftRef.current = next;
    setDraft(next);
  }, []);

  // server data in: first load builds the draft, later loads refresh only rows nobody is editing
  useEffect(() => {
    if (v1.isLoading || v1.isError || !v1.requirements) return;
    serverRef.current = { requirements: v1.requirements as ServerRequirement[], objective: v1.objective };
    if (adopting.current) return;
    const cur = draftRef.current;
    const next = cur ? mergeServer(resolveAfterRead(cur, v1.requirements as ServerRequirement[], v1.objective, me), v1.requirements as ServerRequirement[], v1.objective) : draftFromServer(v1.requirements as ServerRequirement[], v1.objective);
    draftRef.current = next;
    setDraft(next);
  }, [v1.isLoading, v1.isError, v1.requirements, v1.objective, me]);

  // a Reload waits until the server's version differs from the one the conflicting save was based on
  useEffect(() => {
    if (reloading.length === 0 || !draftRef.current) return;
    const done: string[] = [];
    let next = draftRef.current;
    for (const key of reloading) {
      if (key === "objective") {
        const o = v1.objective;
        if (!o || o.LastUpdatedDate !== next.objective.expectedUpdatedAt) { next = reloadObjective(next, o); done.push(key); }
        continue;
      }
      const row = next.rows.find((r) => r.localKey === key);
      if (!row) { done.push(key); continue; }
      const server = (v1.requirements as ServerRequirement[]).find((r) => r.ItemId === row.id);
      if (!server || server.LastUpdatedDate !== row.expectedUpdatedAt) { next = reloadRow(next, key, server); done.push(key); }
    }
    if (done.length) {
      draftRef.current = next;
      setDraft(next);
      setReloading((k) => k.filter((x) => !done.includes(x)));
    }
  }, [reloading, v1.requirements, v1.objective]);

  const anyFailed = () => {
    const d = draftRef.current;
    return !!d && (d.objective.state === "error" || d.rows.some((r) => r.state === "error"));
  };

  const send = useCallback((flush: Flush) => {
    inflight.current = true;
    last.current = flush;
    update((d) => markSending(d, flush.sentKeys));
    setNote({ state: "saving" });
    track(save.mutateAsync({ args: flush.args, requestId: flush.requestId } as never).then(
      (res: unknown) => {
        inflight.current = false;
        const data = ((res as { data?: SaveResult })?.data && !(res as SaveResult).requirements ? (res as { data: SaveResult }).data : res) as SaveResult;
        removedRef.current = removedRef.current.filter((id) => !(flush.args.remove ?? []).includes(id));
        update((d) => applySaveResult(d, flush.sentKeys, data));
        const conflicted = (data.conflicts?.length ?? 0) > 0;
        if (anyFailed()) setNote({ state: "error", error: lastError.current, onRetry: () => flushRef.current() });
        else setNote({ state: "saved" });
        if (conflicted) {
          // the conflict may be the person's own earlier write: re-read so it is recognised before anything is shown
          resolving.current = true;
          track(settleRef.current());
        } else if (buildSavePayload(draftRef.current as Draft, removedRef.current, projectId)) flushRef.current();
      },
      (e: unknown) => {
        inflight.current = false;
        const uncertain = e instanceof FunctionError && (e.code === "timeout" || e.code === "unavailable");
        update((d) => markFailed(d, flush.sentKeys, { reason: sanitizationErrorText(e), uncertain: uncertain ? { requestId: flush.requestId, args: flush.args } : undefined }));
        lastError.current = e;
        setNote({ state: "error", error: e, onRetry: () => flushRef.current() });
        if (uncertain) { resolving.current = true; track(settleRef.current()); }
      },
    ));
  }, [save, update, projectId]);

  // resolve first, then send: re-read the rows, fold the answer in, then let a waiting flush go out
  const settleRead = async () => {
    if (!mounted.current) { resolving.current = false; return; }
    try {
      const res = (await v1.refetch()) as unknown as Array<{ data?: unknown; isError?: boolean }>;
      const reqs = res?.[0], obj = res?.[1];
      if (reqs && !reqs.isError && Array.isArray(reqs.data) && draftRef.current) {
        const o = Array.isArray(obj?.data) ? ((obj!.data as ServerObjective[])[0] ?? null) : null;
        const next = resolveAfterRead(draftRef.current, reqs.data as ServerRequirement[], o, me);
        draftRef.current = next;
        setDraft(next);
      }
    } catch { /* the read failed: the next send resolves a conflict on its own */ }
    resolving.current = false;
    if (buildSavePayload(draftRef.current as Draft, removedRef.current, projectId)) schedule();
  };

  settleRef.current = settleRead;

  const flush = useCallback((requestId?: string) => {
    timer.current = null;
    if (!draftRef.current) return;
    if (resolving.current || inflight.current) { if (resolving.current) schedule(); return; }
    const payload = buildSavePayload(draftRef.current, removedRef.current, projectId);
    if (payload) send({ ...payload, requestId: requestId ?? newRequestId() });
  }, [projectId, send]);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    if (!mounted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), FLUSH_MS);
  }, []);

  // what the Complete dialog and the next editor see: pending text is sent, never dropped
  const handle = useRef<V1EditorHandle | null>(null);
  if (!handle.current) {
    handle.current = {
      draft: () => draftRef.current,
      removed: () => removedRef.current,
      busy: () => wire.current !== null,
      flushNow: async () => {
        for (let round = 0; round < 3; round++) {
          if (timer.current) { clearTimeout(timer.current); timer.current = null; }
          if (!wire.current && draftRef.current && buildSavePayload(draftRef.current, removedRef.current, projectId)) flushRef.current();
          if (!wire.current) return;
          while (wire.current) await wire.current;
        }
      },
    };
  }

  useEffect(() => {
    const me2 = handle.current as V1EditorHandle;
    mounted.current = true;
    let live = true;
    if (!adopting.current) registerV1Editor(projectId, me2);
    else {
      void takeV1Leftover(projectId).then((left) => {
        if (!live) {
          if (left) { registerV1Editor(projectId, left); retireV1Editor(projectId, left); }
          return;
        }
        adopting.current = false;
        const s = serverRef.current;
        let next: Draft | null = left?.draft() ?? null;
        if (next && s) next = mergeServer(resolveAfterRead(next, s.requirements, s.objective, me), s.requirements, s.objective);
        else if (!next && s) next = draftFromServer(s.requirements, s.objective);
        removedRef.current = left ? [...left.removed()] : [];
        if (next) { draftRef.current = next; setDraft(next); }
        registerV1Editor(projectId, me2);
        if (next && buildSavePayload(next, removedRef.current, projectId)) schedule();
      });
    }
    return () => {
      live = false;
      mounted.current = false;
      retireV1Editor(projectId, me2);
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a field link (#v1-…) from the Complete dialog scrolls to the field and focuses it
  useEffect(() => {
    if (!draft || !hash.startsWith("#v1-")) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    const target = el.matches("input, textarea") ? el : el.querySelector<HTMLElement>("input, textarea");
    target?.focus({ preventScroll: true });
  }, [hash, draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (fn: (d: Draft) => Draft) => { update(fn); schedule(); };

  const reload = (key: string) => {
    Promise.resolve(v1.refetch()).finally(() => setReloading((k) => (k.includes(key) ? k : [...k, key])));
  };
  const keepMine = (key: string) => {
    Promise.resolve(v1.refetch()).then((res) => {
      const [reqs, obj] = res as unknown as Array<{ data?: unknown[] }>;
      const cur = draftRef.current;
      if (!cur) return;
      if (key === "objective") update((d) => rebaseObjective(d, (obj?.data?.[0] as ServerObjective | undefined) ?? v1.objective));
      else {
        const id = cur.rows.find((r) => r.localKey === key)?.id;
        const list = (reqs?.data ?? v1.requirements ?? []) as ServerRequirement[];
        update((d) => rebaseRow(d, key, list.find((r) => r.ItemId === id)));
      }
      schedule();
    }).catch(() => undefined);
  };
  const retry = (row: DraftRow) => {
    const pw = row.pendingWrite;
    flushRef.current(pw && sameContent(pw.content, contentOf(row)) ? pw.requestId : undefined);
  };
  const retryObjective = () => {
    const pw = draftRef.current?.objective.pendingWrite;
    flushRef.current(pw ? pw.requestId : undefined);
  };
  const remove = (key: string) => {
    const r = removeRow(draftRef.current as Draft, key);
    if (r.removedId) removedRef.current = [...removedRef.current, r.removedId];
    change(() => r.draft);
  };

  if (v1.isError) return <Card title={t("settings.sanitization.requirements.title", "Draft requirements")} icon={<ListChecks {...iconProps} />}><LoadError onRetry={() => void v1.refetch()} /></Card>;

  return (
    <Card title={t("settings.sanitization.requirements.title", "Draft requirements")} icon={<ListChecks {...iconProps} />} action={canEdit ? <>
      <WriteNote {...note} />
    </> : undefined}>
      <div ref={editorRef} className="space-y-5">
        <DraftV1Panel workspaceId={workspaceId} projectId={projectId} canEdit={canEdit} jobs={jobs} />
        {!canEdit ? (
          <>
            <p className="text-[13px] text-ink2">{t("settings.sanitization.requirements.readOnly", "Your role can't edit this step.")}</p>
            <ReadOnlyV1 v1={v1} chipIds={chipIds} />
          </>
        ) : !draft ? (
          <p className="text-[14px] text-ink2" role="status">{t("settings.sanitization.requirements.loading", "Loading…")}</p>
        ) : (
          <>
            <ObjectiveFields draft={draft} change={change} onReload={() => reload("objective")} onKeep={() => keepMine("objective")} onRetry={retryObjective} />
            {draft.rows.length === 0 ? (
              <EmptyState icon={<ListChecks {...iconProps} />} title={t("settings.sanitization.requirements.empty", "No requirements yet. Let the business analyst write the draft, or add the first requirement yourself.")} />
            ) : (
              <ol className="space-y-4">
                {draft.rows.map((r, i) => (
                  <RequirementEditor key={r.localKey} row={r} first={i === 0} lastRow={i === draft.rows.length - 1}
                    fromMadp={r.id !== null && chipIds.has(r.id)}
                    onEdit={(patch) => change((d) => editRow(d, r.localKey, patch))}
                    onPut={(row) => change((d) => putRow(d, row))}
                    onMove={(dir) => change((d) => moveRow(d, r.localKey, dir))}
                    onRemove={() => remove(r.localKey)} onReload={() => reload(r.localKey)}
                    onKeep={() => keepMine(r.localKey)} onRetry={() => retry(r)} />
                ))}
              </ol>
            )}
            <Button variant="ghost" icon={<Plus {...iconProps} />} disabled={draft.rows.length >= MAX_REQUIREMENTS}
              onClick={() => change((d) => addRow(d, crypto.randomUUID()))}>
              {t("settings.sanitization.requirements.add", "Add requirement")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Conflict({ text, onKeep, onReload }: { text: string; onKeep: () => void; onReload: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-block bg-danger-soft p-3 text-[13px] text-[rgb(var(--c-danger-text))]">
      <span className="min-w-0 break-words">{text}</span>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onKeep}>{t("settings.sanitization.requirements.keepMine", "Keep my text")}</Button>
        <Button size="sm" variant="ghost" onClick={onReload}>{t("settings.sanitization.requirements.reloadTheirs", "Reload their version")}</Button>
      </span>
    </div>
  );
}

function NotSaved({ failure, onRetry }: { failure?: string | null; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-block bg-danger-soft p-3 text-[13px] text-[rgb(var(--c-danger-text))]">
      <span className="min-w-0 break-words">{failure
        ? t("settings.sanitization.requirements.notSavedReason", "Not saved: {reason} Your text is kept.", { reason: failure })
        : t("settings.sanitization.requirements.notSaved", "Not saved. Your text is kept.")}</span>
      <Button size="sm" variant="ghost" onClick={onRetry}>{t("settings.sanitization.requirements.retry", "Retry")}</Button>
    </div>
  );
}

function ObjectiveFields({ draft, change, onReload, onKeep, onRetry }: {
  draft: Draft; change: (fn: (d: Draft) => Draft) => void; onReload: () => void; onKeep: () => void; onRetry: () => void;
}) {
  const t = useT();
  const o = draft.objective;
  const field = (label: string, key: "statement" | "highLevelDetails" | "architectureSummary", max: number, rows: number) => (
    <div>
      <Label>{label}</Label>
      <Textarea aria-label={label} value={o[key]} maxLength={max} rows={rows}
        onChange={(e) => change((d) => editObjective(d, { [key]: e.target.value }))} />
    </div>
  );
  return (
    <div id={v1FieldId({ kind: "objective" }) ?? undefined} className="space-y-3">
      {o.state === "conflict" && <Conflict text={t("settings.sanitization.requirements.conflictObjective", "Someone else changed the objective. Keep your text or reload their version.")} onKeep={onKeep} onReload={onReload} />}
      {field(t("settings.sanitization.requirements.objective", "Objective"), "statement", 2000, 3)}
      {field(t("settings.sanitization.requirements.highLevel", "High-level details"), "highLevelDetails", 20000, 5)}
      {field(t("settings.sanitization.requirements.architecture", "Architecture summary"), "architectureSummary", 20000, 5)}
      {o.state === "error" && <NotSaved failure={o.failure} onRetry={onRetry} />}
    </div>
  );
}

export function RequirementEditor({ row, first, lastRow, fromMadp, onEdit, onPut, onMove, onRemove, onReload, onKeep, onRetry }: {
  row: DraftRow; first: boolean; lastRow: boolean; fromMadp: boolean;
  onEdit: (patch: Partial<Pick<DraftRow, "title" | "description" | "priority" | "criteria">>) => void;
  onPut: (row: DraftRow) => void; onMove: (dir: "up" | "down") => void; onRemove: () => void; onReload: () => void;
  onKeep: () => void; onRetry: () => void;
}) {
  const t = useT();
  const label = rowLabel(row);
  // a saved or filled-in requirement is deleted for good by the autosave: ask first; an empty new row just goes
  const [confirmRemove, setConfirmRemove] = useState(false);
  const blank = !row.id && !row.title.trim() && !row.description.trim() && row.criteria.every((c) => !c.trim());
  const askRemove = () => (blank ? onRemove() : setConfirmRemove(true));
  const setCriterion = (i: number, v: string) => onEdit({ criteria: row.criteria.map((c, k) => (k === i ? v : c)) });
  // the autosave holds a new row back until it has a title: say so on the row instead of silently not saving
  const held = needsTitle(row);
  const titleHint = useId();
  return (
    <li id={v1FieldId({ kind: "requirement", localKey: row.localKey, number: row.number }) ?? undefined} className="space-y-3 rounded-block bg-surface2 p-4" aria-label={t("settings.sanitization.requirements.rowAria", "Requirement {label}", { label })}>
      {row.state === "conflict" && <Conflict text={t("settings.sanitization.requirements.conflictRow", "Someone else changed this requirement. Keep your text or reload their version.")} onKeep={onKeep} onReload={onReload} />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-ink3">{label}</span>
        {fromMadp && <FromMadpChip label={t("settings.sanitization.requirements.draftedByMadp", "Drafted by MADP")} />}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.moveRowUp", "Move {label} up", { label })} disabled={first} onClick={() => onMove("up")} icon={<ArrowUp {...iconProps} />}>{t("settings.sanitization.requirements.moveUp", "Move up")}</Button>
          <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.moveRowDown", "Move {label} down", { label })} disabled={lastRow} onClick={() => onMove("down")} icon={<ArrowDown {...iconProps} />}>{t("settings.sanitization.requirements.moveDown", "Move down")}</Button>
          <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.removeRowAria", "Remove requirement {label}", { label })} disabled={confirmRemove} onClick={askRemove} icon={<Trash2 {...iconProps} />}>{t("settings.sanitization.requirements.removeRow", "Remove requirement")}</Button>
        </span>
      </div>
      {confirmRemove && (
        <div role="group" aria-label={t("settings.sanitization.requirements.removeRowAria", "Remove requirement {label}", { label })} className="flex flex-wrap items-center gap-2 rounded-block bg-warning-soft px-3 py-2 text-[14px]">
          <span className="min-w-0 flex-1">{t("settings.sanitization.requirements.removeConfirm", "Remove {label}? It is deleted from Requirements v1.", { label })}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>{t("settings.sanitization.requirements.keep", "Keep")}</Button>
          <Button size="sm" variant="danger" onClick={() => { setConfirmRemove(false); onRemove(); }}>{t("settings.sanitization.requirements.remove", "Remove")}</Button>
        </div>
      )}
      <div>
        <Label>{t("settings.sanitization.requirements.titleLabel", "Title")}</Label>
        <Input aria-label={t("settings.sanitization.requirements.titleAria", "Title, {label}", { label })} aria-describedby={held ? titleHint : undefined} value={row.title} maxLength={200}
          onChange={(e) => onEdit({ title: e.target.value })} />
        {held && <p id={titleHint} className="mt-1 text-[13px] text-ink2">{t("settings.sanitization.requirements.needsTitle", "Add a title to save this requirement.")}</p>}
      </div>
      <div>
        <Label>{t("settings.sanitization.requirements.descriptionLabel", "Description")}</Label>
        <Textarea aria-label={t("settings.sanitization.requirements.descriptionAria", "Description, {label}", { label })} value={row.description} maxLength={5000} onChange={(e) => onEdit({ description: e.target.value })} />
      </div>
      <div className="max-w-[260px]">
        <Label>{t("settings.sanitization.requirements.priorityLabel", "Priority")}</Label>
        <Select label={t("settings.sanitization.requirements.priorityAria", "Priority, {label}", { label })} value={row.priority} options={PRIORITY_OPTIONS} onChange={(v) => onEdit({ priority: v as DraftPriority })} />
      </div>
      <div>
        <Label>{t("settings.sanitization.requirements.criteriaLabel", "Acceptance criteria")}</Label>
        <ul className="space-y-2">
          {row.criteria.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input aria-label={t("settings.sanitization.requirements.criterionAria", "Acceptance criterion {n}, {label}", { n: i + 1, label })} className="min-w-0 flex-1" value={c} maxLength={500} onChange={(e) => setCriterion(i, e.target.value)} />
              <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.criterionUpAria", "Move criterion {n} up, {label}", { n: i + 1, label })} disabled={i === 0} onClick={() => onPut(moveCriterion(row, i, "up"))} icon={<ArrowUp {...iconProps} />}>{t("settings.sanitization.requirements.moveUp", "Move up")}</Button>
              <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.criterionDownAria", "Move criterion {n} down, {label}", { n: i + 1, label })} disabled={i === row.criteria.length - 1} onClick={() => onPut(moveCriterion(row, i, "down"))} icon={<ArrowDown {...iconProps} />}>{t("settings.sanitization.requirements.moveDown", "Move down")}</Button>
              <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.criterionRemoveAria", "Remove criterion {n}, {label}", { n: i + 1, label })} onClick={() => onEdit({ criteria: row.criteria.filter((_, k) => k !== i) })} icon={<Trash2 {...iconProps} />}>{t("settings.sanitization.requirements.remove", "Remove")}</Button>
            </li>
          ))}
        </ul>
        <Button className="mt-2" size="sm" variant="ghost" aria-label={t("settings.sanitization.requirements.addCriterionAria", "Add criterion, {label}", { label })} icon={<Plus {...iconProps} />} disabled={row.criteria.length >= MAX_CRITERIA}
          onClick={() => onEdit({ criteria: [...row.criteria, ""] })}>
          {t("settings.sanitization.requirements.addCriterion", "Add criterion")}
        </Button>
      </div>
      {row.state === "error" && <NotSaved failure={row.failure} onRetry={onRetry} />}
    </li>
  );
}
