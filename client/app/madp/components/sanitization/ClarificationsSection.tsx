/** "Questions for you": the business analyst's questions, answered like a conversation. One question at a time is open
 *  for an answer: a few suggested answers to pick with one click (the business analyst's own, else answerOptions.ts), "Other…" for your own words,
 *  "Not sure" and "Later"; answering moves on to the next one; "3 of 5 answered" with a bar.
 *  What was answered or set aside stays below as the conversation so far, where an answer can be changed and a
 *  set-aside question answered after all. Every row is a record; new questions arrive only through engine jobs or
 *  "Add a question of your own". Stays editable after completion. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { prefixPath } from "@/madp/lib/pathPrefix";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CircleHelp, Clock3, Factory, HelpCircle, MessageCircleQuestion, MoreHorizontal, PencilLine, Plus, Send } from "lucide-react";
import { Button, Card, Label, Modal, Select, Textarea, type SelectOption } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { cn } from "@/madp/lib/cn";
import { formatNumber } from "@/madp/domain/numbering";
import { canAnswerClarification } from "@/madp/domain/sanitization";
import { useBusinessRefs, engineOutputIds, latestAssistJob, clarificationsOptions, useSanitizationProject, FORMER_MEMBER } from "@/madp/blocks/sanitization/hooks";
import {
  useAnswerClarification, useAskMadp, useDeferClarification, useDeleteClarification, useReopenClarification, useSaveClarification,
} from "@/madp/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/madp/blocks/sanitization/messages";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { LoadError, WriteNote, formatAt, type SectionProps } from "./shared";
import { startOnce } from "./CompleteSanitizationModal";
import { activeQuestion, asideKindOf, asideReason, asideWords, questionsProgress, type AsideKind } from "./understandingModel";
import { optionsFor, type AnswerContext } from "./answerOptions";
import { useSetup } from "./UnderstoodSection";
import { ownerShown } from "@/madp/components/requirements/ownerName";
import { OptimisticAnswersContext, useOptimisticAnswers, useOptimisticAnswersContext, withPending } from "./optimisticAnswer";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import { useTalkAttachments } from "@/madp/blocks/collab/talkUpload";
import type { FeedbackAttachmentRecord } from "@/madp/blocks/collab/records";
import { t, useT } from "@/madp/i18n";

const EMPTY_FILES: ReadonlyMap<string, FeedbackAttachmentRecord[]> = new Map();
/** The files sent with each answer (by question id), read once for the section. */
const AnswerFilesContext = createContext<ReadonlyMap<string, FeedbackAttachmentRecord[]>>(new Map());

/** A member's name, or "" when the person isn't known (a former member, or still loading). */
const knownName = (n: string): string => (n === FORMER_MEMBER || n === "…" ? "" : n);

export type ClarificationFilter = "all" | "open" | "answered" | "deferred" | "mine";

interface Row {
  ItemId: string;
  Number: number;
  Question: string;
  Options?: string[] | null;
  Answer?: string | null;
  Status: string;
  OwnerUserId?: string | null;
  SourceType?: string | null;
  SourceRef?: string | null;
  DeferReason?: string | null;
  AnsweredByUserId?: string | null;
  AnsweredAt?: string | null;
  LastUpdatedDate?: string | null;
}

/** The filters of the answered questions, labelled in the current language (read at render time). */
function filters(): { key: ClarificationFilter; label: string }[] {
  return [
    { key: "all", label: t("settings.sanitization.questions.filter.all", "All") }, { key: "answered", label: t("settings.sanitization.questions.filter.answered", "Answered") },
    { key: "deferred", label: t("settings.sanitization.questions.filter.deferred", "Set aside") }, { key: "mine", label: t("settings.sanitization.questions.filter.mine", "For me") },
  ];
}

const MAX_QUESTION = 2000;
const MAX_ANSWER = 5000;
const MAX_REASON = 1000;
/** Shown in place of a note or file that is no longer in the material. */
const noSource = (): string => t("settings.sanitization.questions.noSource", "Source no longer in your material");

export function filterClarifications<T extends { Status: string; OwnerUserId?: string | null }>(rows: readonly T[], filter: ClarificationFilter, userId: string): T[] {
  switch (filter) {
    case "open": case "answered": case "deferred": return rows.filter((r) => r.Status === filter);
    case "mine": return rows.filter((r) => !!userId && r.OwnerUserId === userId);
    default: return [...rows];
  }
}

type NoteState = "idle" | "saving" | "saved" | "error";
interface Note { state: NoteState; error?: string }

/** Runs one mutation and tracks its result as a Note; a failure keeps the caller's draft. */
type WriteStart = (cb: { onSuccess: () => void; onError: (e: unknown) => void }) => void;

/** One server op per action: the flag is set before the call and cleared when it settles, so a double click runs once. */
export function runWriteOnce(flag: { current: boolean }, setNote: (n: Note) => void, start: WriteStart, done?: () => void): boolean {
  return startOnce(flag, (settle) => {
    setNote({ state: "saving" });
    start({
      onSuccess: () => { settle(); setNote({ state: "saved" }); done?.(); },
      onError: (e) => { settle(); setNote({ state: "error", error: sanitizationErrorText(e) }); },
    });
  });
}

function useWrite() {
  const [note, setNote] = useState<Note>({ state: "idle" });
  const [last, setLast] = useState<(() => void) | null>(null);
  const inFlight = useRef(false);
  const run = (start: WriteStart, done?: () => void) => {
    const go = () => { runWriteOnce(inFlight, setNote, start, done); };
    setLast(() => go);
    go();
  };
  const noteProps = { state: note.state, error: note.error, onRetry: last ?? undefined } as never;
  return { run, note, noteProps };
}

function memberOptions(members: SectionProps["members"], none: string): SelectOption[] {
  return [{ value: "", label: none }, ...members.list.map((m) => ({ value: m.userId, label: m.name }))];
}

function sourceOptions(refs: { id: string; type: string; title: string }[]): SelectOption[] {
  return [
    { value: "", label: t("settings.sanitization.questions.sourceNone", "None") },
    ...refs.filter((r) => r.type === "note").map((r) => ({ value: `note:${r.id}`, label: t("settings.sanitization.questions.sourceNote", "Note: {title}", { title: r.title }) })),
    ...refs.filter((r) => r.type === "file").map((r) => ({ value: `file:${r.id}`, label: t("settings.sanitization.questions.sourceFile", "File: {title}", { title: r.title }) })),
  ];
}

/** Keeps the stored source selectable while its note or file is not (yet) in the list. */
export function withStoredSource(options: SelectOption[], stored: string, title: string): SelectOption[] {
  return !stored || options.some((o) => o.value === stored) ? options : [...options, { value: stored, label: title }];
}

function splitSource(v: string): { sourceType: "note" | "file" | ""; sourceId?: string } {
  const i = v.indexOf(":");
  if (i < 0) return { sourceType: "" };
  return { sourceType: v.slice(0, i) as "note" | "file", sourceId: v.slice(i + 1) };
}

type Ctx = { workspaceId: string; projectId: string };
type Refs = { id: string; type: string; title: string }[];

function AddForm({ ctx, members, refs, onDone }: {
  ctx: Ctx; members: SectionProps["members"]; refs: Refs; onDone: () => void;
}) {
  const t = useT();
  const save = useSaveClarification(ctx);
  const [question, setQuestion] = useState("");
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const w = useWrite();
  const q = question.trim();
  const submit = () => {
    if (!q || q.length > MAX_QUESTION) return;
    w.run((cb) => save.mutate({ projectId: ctx.projectId, question: q, ownerUserId: owner, ...splitSource(source) }, cb),
      () => { setQuestion(""); setOwner(""); setSource(""); onDone(); });
  };
  return (
    <form className="grid gap-3 rounded-block bg-surface2 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div>
        <Label>{t("settings.sanitization.questions.add.label", "Your question")}</Label>
        <Textarea aria-label={t("settings.sanitization.questions.add.aria", "Question")} value={question} maxLength={MAX_QUESTION} onChange={(e) => setQuestion(e.target.value)} placeholder={t("settings.sanitization.questions.add.placeholder", "What should be cleared up?")} autoFocus />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>{t("settings.sanitization.questions.whoAnswers", "Who answers it")}</Label><Select label={t("settings.sanitization.questions.add.owner", "Owner")} value={owner} onChange={setOwner} options={memberOptions(members, t("settings.sanitization.questions.anyone", "Anyone"))} /></div>
        <div><Label>{t("settings.sanitization.questions.add.aboutMaterial", "About which material")}</Label><Select label={t("settings.sanitization.questions.add.source", "Source in Business")} value={source} onChange={setSource} options={sourceOptions(refs)} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={!q || w.note.state === "saving"}>{t("settings.sanitization.questions.add.submit", "Add question")}</Button>
        <Button variant="ghost" onClick={onDone}>{t("settings.sanitization.questions.cancel", "Cancel")}</Button>
        <WriteNote {...(w.noteProps as object as { state: never })} />
      </div>
    </form>
  );
}

/** The business analyst's side of the conversation: the question in a bubble, who it is for and what it comes from. */
function AskedBubble({ row, props, refs, fromMadp, muted, children }: {
  row: Row; props: SectionProps; refs: Refs; fromMadp: boolean; muted?: boolean; children?: ReactNode;
}) {
  const t = useT();
  const source = refs.find((r) => r.id === row.SourceRef);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span aria-hidden className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", fromMadp ? "bg-accent/10 text-accent" : "bg-surface2 text-ink2 ring-1 ring-line")}>
        {fromMadp ? <Factory size={15} strokeWidth={1.75} /> : <MessageCircleQuestion size={15} strokeWidth={1.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink3">
          <span className="font-medium text-ink2">{fromMadp ? t("settings.sanitization.questions.askedByAnalyst", "Business analyst") : t("settings.sanitization.questions.askedByTeam", "Added by the team")}</span>
          {/* who it is for: "you", a member's name, or nothing (never an unknown person's id or "Former member") */}
          {row.OwnerUserId && (() => {
            const name = row.OwnerUserId === props.access.userId ? t("settings.sanitization.questions.forYou", "you") : ownerShown(row.OwnerUserId, { selfId: null, name: knownName(props.members.nameOf(row.OwnerUserId)) });
            return name ? <span>{t("settings.sanitization.questions.forName", "· for {name}", { name })}</span> : null;
          })()}
          {row.SourceRef && (
            <span className="min-w-0">{t("settings.sanitization.questions.about", "· about")}{" "}
              <Link to={prefixPath(`/p/${props.projectId}/business?item=${row.SourceRef}`)} title={row.SourceRef}
                className="break-words font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{source?.title ?? noSource()}</Link>
            </span>
          )}
        </div>
        <p className={cn("mt-1 inline-block max-w-full whitespace-pre-wrap break-words rounded-[18px] rounded-tl-md px-4 py-2.5 text-[14px]",
          muted ? "bg-surface2 text-ink2" : "bg-surface2 text-ink")}>{row.Question}</p>
        {children}
      </div>
    </div>
  );
}

/** The person's side: their answer, or why the question was set aside. */
function ReplyBubble({ row, props }: { row: Row; props: SectionProps }) {
  const t = useT();
  const files = useContext(AnswerFilesContext).get(row.ItemId);
  if (row.Status === "deferred") {
    const kind = asideKindOf(row.DeferReason);
    const words = asideWords(row.DeferReason);
    return (
      <div className="mt-2 flex justify-end">
        <div className="max-w-[85%] rounded-[18px] rounded-tr-md bg-warning/10 px-4 py-2.5 text-[14px] text-ink">
          <span className="inline-flex items-center gap-1.5 font-medium">{kind === "notSure" ? <HelpCircle size={14} aria-hidden /> : <Clock3 size={14} aria-hidden />}{kind === "notSure" ? t("settings.sanitization.questions.notSureYet", "Not sure yet") : t("settings.sanitization.questions.later", "Later")}</span>
          {words && <p className="mt-0.5 whitespace-pre-wrap break-words text-ink2">{words}</p>}
          {kind === "notSure" && !words && <p className="mt-0.5 text-[13px] text-ink2">{t("settings.sanitization.questions.notSureNote", "The business analyst suggests an answer in the draft requirements.")}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 flex justify-end">
      <div className="max-w-[85%] rounded-[18px] rounded-tr-md bg-accent/10 px-4 py-2.5 text-[14px] text-ink">
        <p className="whitespace-pre-wrap break-words">{row.Answer}</p>
        <SentFiles projectId={props.projectId} files={files} />
        {row.AnsweredByUserId && row.AnsweredAt && (
          <p className="mt-1 text-[12px] text-ink3">{props.members.nameOf(row.AnsweredByUserId)} · {formatAt(row.AnsweredAt)}</p>
        )}
      </div>
    </div>
  );
}

/** Edit / Delete of a question (people who may edit the step). */
function QuestionTools({ row, props, refs, onEditing }: { row: Row; props: SectionProps; refs: Refs; onEditing?: (v: boolean) => void }) {
  const t = useT();
  const { projectId, workspaceId, members } = props;
  const ctx = { workspaceId, projectId };
  const save = useSaveClarification(ctx);
  const del = useDeleteClarification(ctx);
  const w = useWrite();
  const label = formatNumber("C", row.Number);
  const storedSource = row.SourceRef && (row.SourceType === "note" || row.SourceType === "file") ? `${row.SourceType}:${row.SourceRef}` : "";
  const sourceTitle = refs.find((r) => r.id === row.SourceRef)?.title ?? noSource();
  const [editing, setEditingState] = useState(false);
  const setEditing = (v: boolean) => { setEditingState(v); onEditing?.(v); };
  const [editBase, setEditBase] = useState(row.LastUpdatedDate ?? undefined);
  const [question, setQuestion] = useState(row.Question);
  const [owner, setOwner] = useState(row.OwnerUserId ?? "");
  const [source, setSource] = useState(storedSource);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!props.access.canEdit) return null;
  return (
    <>
      {editing ? (
        <div className="mt-3 grid gap-3 rounded-block bg-surface2 p-3">
          <Textarea aria-label={t("settings.sanitization.questions.tools.questionAria", "Question for {label}", { label })} value={question} maxLength={MAX_QUESTION} onChange={(e) => setQuestion(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t("settings.sanitization.questions.whoAnswers", "Who answers it")} value={owner} onChange={setOwner} options={memberOptions(members, t("settings.sanitization.questions.anyone", "Anyone"))} />
            <Select label={t("settings.sanitization.questions.tools.comesFrom", "Comes from")} value={source} onChange={setSource} options={withStoredSource(sourceOptions(refs), storedSource, sourceTitle)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" aria-label={t("settings.sanitization.questions.tools.saveAria", "Save {label}", { label })} disabled={!question.trim() || w.note.state === "saving"}
              onClick={() => w.run((cb) => save.mutate({ projectId, id: row.ItemId, question: question.trim(), ownerUserId: owner, ...splitSource(source), expectedUpdatedAt: editBase }, cb), () => setEditing(false))}>{t("settings.sanitization.questions.tools.save", "Save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setQuestion(row.Question); }}>{t("settings.sanitization.questions.cancel", "Cancel")}</Button>
          </div>
        </div>
      ) : (
        <span className="inline-flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.questions.tools.editAria", "Edit {label}", { label })} onClick={() => {
            // the form opens on the row as it is now, not as it was when the list first rendered
            setQuestion(row.Question); setOwner(row.OwnerUserId ?? ""); setSource(storedSource); setEditBase(row.LastUpdatedDate ?? undefined); setEditing(true);
          }}>{t("settings.sanitization.questions.tools.edit", "Edit question")}</Button>
          <Button size="sm" variant="ghost" className="text-danger" aria-label={t("settings.sanitization.questions.tools.deleteAria", "Delete {label}", { label })} onClick={() => setConfirmDelete(true)}>{t("settings.sanitization.questions.tools.delete", "Delete")}</Button>
        </span>
      )}
      <WriteNote {...(w.noteProps as object as { state: never })} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("settings.sanitization.questions.tools.confirmTitle", "Delete this question?")} width={440}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("settings.sanitization.questions.cancel", "Cancel")}</Button>
          <Button variant="danger" disabled={del.isPending || w.note.state === "saving"}
            onClick={() => w.run((cb) => del.mutate({ projectId, id: row.ItemId }, cb), () => setConfirmDelete(false))}>{t("settings.sanitization.questions.tools.delete", "Delete")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">{t("settings.sanitization.questions.tools.confirmText", "This removes the question and its answer.")}</p>
        {w.note.state === "error" && <p role="alert" className="mt-3 text-[13px] text-danger">{w.note.error}</p>}
      </Modal>
    </>
  );
}

/** One suggested answer: a click sends it as the answer (the same look as the other choice chips). */
const OPTION = "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3.5 py-1.5 text-left text-[13px] font-medium outline-none ring-1 transition focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45";

/** The composer under a question: a few suggested answers to pick with one click, "Other…" (own words), "Not sure"
 *  and "Later". `changing` = changing an answer already given (own words open, prefilled). */
function Composer({ row, props, active, onActivate, onDone, changing, answerCtx }: {
  row: Row; props: SectionProps; active: boolean; onActivate: () => void; onDone: () => void; changing?: boolean; answerCtx: AnswerContext;
}) {
  const t = useT();
  const { projectId, workspaceId, access } = props;
  const ctx = { workspaceId, projectId };
  const answer = useAnswerClarification(ctx);
  const defer = useDeferClarification(ctx);
  const optimistic = useOptimisticAnswersContext();
  const w = useWrite();
  const label = formatNumber("C", row.Number);
  const [draft, setDraft] = useState(changing ? row.Answer ?? "" : "");
  const [picked, setPicked] = useState<string | null>(null);
  const options = optionsFor(row, answerCtx);
  const [writing, setWriting] = useState(Boolean(changing) || options.length === 0);
  const ref = useRef<HTMLDivElement>(null);
  const mayAnswer = canAnswerClarification({ userId: access.userId ?? "", permissions: access.permissions }, { ownerUserId: row.OwnerUserId ?? "" });
  const expectedUpdatedAt = row.LastUpdatedDate ?? undefined;
  const text = draft.trim();
  useEffect(() => { if (active && changing) ref.current?.querySelector("textarea")?.focus({ preventScroll: true }); }, [active, changing]);
  // files sent with the answer (a design, a document): they go up while the person writes, and go with the answer
  const files = useAttachDraft({ projectId, owner: { ownerType: "clarification", forId: row.ItemId } });

  if (!mayAnswer) {
    const owner = row.OwnerUserId ? ownerShown(row.OwnerUserId, { selfId: null, name: knownName(props.members.nameOf(row.OwnerUserId)) }) : "";
    return <p className="mt-2 text-[13px] text-ink3">{owner ? t("settings.sanitization.questions.waitingFor", "Waiting for {name} to answer.", { name: owner }) : t("settings.sanitization.questions.waiting", "Waiting for an answer.")}</p>;
  }
  if (!active) {
    return (
      <div className="mt-2">
        <Button size="sm" variant="ghost" icon={<Send size={14} aria-hidden />} onClick={onActivate} aria-label={t("settings.sanitization.questions.answerAria", "Answer {label}", { label })}>{t("settings.sanitization.questions.answer", "Answer")}</Button>
      </div>
    );
  }
  // inside the section the answer shows at once and the conversation moves on; the section writes it (optimisticAnswer)
  const hold = attachHold(files);
  const send = (value: string) => {
    const v = value.trim().slice(0, MAX_ANSWER);
    if (!v || hold) return;
    const sent = files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : null;
    if (optimistic) {
      optimistic.submit(row, { kind: "answer", text: v, ...(sent ? { files: sent } : {}) });
      setDraft(""); setPicked(null); files.reset(); onDone(); return;
    }
    w.run((cb) => answer.mutate({ projectId, id: row.ItemId, answer: v, expectedUpdatedAt, ...(sent ?? {}) }, cb), () => { setDraft(""); setPicked(null); files.reset(); onDone(); });
  };
  const aside = (kind: AsideKind) => {
    const reason = asideReason(kind, draft).slice(0, MAX_REASON);
    if (optimistic) { optimistic.submit(row, { kind: "defer", reason }); setDraft(""); onDone(); return; }
    w.run((cb) => defer.mutate({ projectId, id: row.ItemId, reason, expectedUpdatedAt }, cb), () => { setDraft(""); onDone(); });
  };
  const busy = w.note.state === "saving";
  const openOwnWords = () => {
    setWriting(true);
    window.setTimeout(() => ref.current?.querySelector("textarea")?.focus({ preventScroll: true }), 0);
  };
  // the step's primary button ("Answer the questions") brings this into view: the first choice, or the answer box
  const firstMark = !changing && !writing ? { "data-open-answer": "" } : {};
  return (
    <AttachZone draft={files} className="mt-3">
    <div ref={ref} className="grid gap-2.5">
      {options.length > 0 && (
        <div role="group" aria-label={t("settings.sanitization.questions.suggestedAria", "Suggested answers to {label}", { label })} className="flex flex-wrap gap-1.5">
          {options.map((o, i) => {
            const on = picked === o || (changing === true && (row.Answer ?? "").trim() === o);
            return (
              <button key={o} type="button" {...(i === 0 ? firstMark : {})} disabled={busy || !!hold} aria-pressed={on}
                aria-label={t("settings.sanitization.questions.pickAria", "Answer {label}: {answer}", { label, answer: o })}
                onClick={() => { setPicked(o); send(o); }}
                className={cn(OPTION, on ? "bg-accent text-white ring-accent" : "bg-surface text-ink ring-line hover:bg-accent-soft hover:ring-accent/40")}>
                <span className="min-w-0 break-words">{o}</span>
              </button>
            );
          })}
          <button type="button" disabled={busy} aria-expanded={writing} onClick={openOwnWords}
            className={cn(OPTION, writing ? "bg-surface2 text-ink ring-line" : "bg-surface text-ink2 ring-line hover:bg-surface2 hover:text-ink")}>
            <PencilLine size={14} aria-hidden />{t("settings.sanitization.questions.other", "Other…")}
          </button>
          {!changing && access.canEdit && (
            <button type="button" disabled={busy} aria-label={t("settings.sanitization.questions.notSureAria", "Not sure about {label}", { label })} title={t("settings.sanitization.questions.notSureTitle", "The business analyst suggests an answer")}
              onClick={() => aside("notSure")}
              className={cn(OPTION, "bg-surface text-ink2 ring-line hover:bg-surface2 hover:text-ink")}>
              <HelpCircle size={14} aria-hidden />{t("settings.sanitization.questions.notSure", "Not sure")}
            </button>
          )}
        </div>
      )}
      {writing && (
        <Textarea {...(!changing ? { "data-open-answer": "" } : {})} aria-label={t("settings.sanitization.questions.yourAnswerAria", "Your answer to {label}", { label })} value={draft} maxLength={MAX_ANSWER}
          className="min-h-[84px] bg-surface ring-1 ring-line"
          placeholder={t("settings.sanitization.questions.answerPlaceholder", "Type your answer in your own words. A few words are enough.")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text && !busy && !hold) {
              e.preventDefault();
              send(text);
            }
          }} />
      )}
      <AttachChipList draft={files} disabled={busy} />
      {hold && <p className="text-[12px] text-ink3">{hold}</p>}
      {files.ids.length > 0 && !hold && !writing && <p className="text-[12px] text-ink3">{t("settings.sanitization.questions.filesGoWith", "The files go with the answer you pick.")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <AttachButton draft={files} disabled={busy} label={t("settings.sanitization.questions.attachLabel", "Attach files to the answer to {label}", { label })} />
        {writing && (
          <Button size="sm" variant="primary" icon={<Send size={14} aria-hidden />} aria-label={t("settings.sanitization.questions.sendAria", "Send the answer to {label}", { label })} disabled={!text || busy || !!hold}
            onClick={() => send(text)}>
            {changing ? t("settings.sanitization.questions.saveAnswer", "Save answer") : t("settings.sanitization.questions.sendAnswer", "Send answer")}
          </Button>
        )}
        {changing ? (
          <Button size="sm" variant="ghost" onClick={onDone}>{t("settings.sanitization.questions.cancel", "Cancel")}</Button>
        ) : access.canEdit && (
          <>
            {options.length === 0 && (
              <Button size="sm" variant="ghost" icon={<HelpCircle size={14} aria-hidden />} disabled={busy} aria-label={t("settings.sanitization.questions.notSureAria", "Not sure about {label}", { label })}
                title={t("settings.sanitization.questions.notSureTitle", "The business analyst suggests an answer")} onClick={() => aside("notSure")}>{t("settings.sanitization.questions.notSure", "Not sure")}</Button>
            )}
            <Button size="sm" variant="ghost" icon={<Clock3 size={14} aria-hidden />} disabled={busy} aria-label={t("settings.sanitization.questions.laterAria", "Answer {label} later", { label })}
              onClick={() => aside("later")}>{t("settings.sanitization.questions.later", "Later")}</Button>
          </>
        )}
        <span className="hidden text-[12px] text-ink3 sm:inline">{writing && text ? t("settings.sanitization.questions.ctrlEnter", "Ctrl + Enter sends") : !writing && options.length ? t("settings.sanitization.questions.pickOrWrite", "Pick an answer, or write your own") : ""}</span>
      </div>
      <WriteNote {...(w.noteProps as object as { state: never })} />
    </div>
    </AttachZone>
  );
}

/** One turn of the conversation that is done: the question and the reply, with "Change answer" / "Answer now". */
function DoneTurn({ row, props, refs, fromMadp, answerCtx }: { row: Row; props: SectionProps; refs: Refs; fromMadp: boolean; answerCtx: AnswerContext }) {
  const { projectId, workspaceId, access } = props;
  const t = useT();
  const reopen = useReopenClarification({ workspaceId, projectId });
  const w = useWrite();
  const [changing, setChanging] = useState(false);
  const label = formatNumber("C", row.Number);
  const mayAnswer = canAnswerClarification({ userId: access.userId ?? "", permissions: access.permissions }, { ownerUserId: row.OwnerUserId ?? "" });
  // the reply is shown already; while it is being written, changing it waits (the row's version is not known yet)
  const writing = useOptimisticAnswersContext()?.isPending(row.ItemId) ?? false;
  return (
    <li className="min-w-0">
      <AskedBubble row={row} props={props} refs={refs} fromMadp={fromMadp} muted>
        {changing ? (
          <Composer row={row} props={props} active changing onActivate={() => undefined} onDone={() => setChanging(false)} answerCtx={answerCtx} />
        ) : (
          <ReplyBubble row={row} props={props} />
        )}
        {!changing && writing && (
          <p role="status" className="mt-1 text-right text-[12px] text-ink3">{t("settings.sanitization.questions.saving", "Saving…")}</p>
        )}
        {!changing && !writing && (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
            {row.Status === "answered" && mayAnswer && <Button size="sm" variant="ghost" aria-label={t("settings.sanitization.questions.changeAria", "Change the answer to {label}", { label })} onClick={() => setChanging(true)}>{t("settings.sanitization.questions.change", "Change answer")}</Button>}
            {access.canEdit && (
              <Button size="sm" variant="ghost" aria-label={row.Status === "deferred" ? t("settings.sanitization.questions.answerNowAria", "Answer {label} now", { label }) : t("settings.sanitization.questions.reopenAria", "Reopen {label}", { label })} disabled={w.note.state === "saving"}
                onClick={() => w.run((cb) => reopen.mutate({ projectId, id: row.ItemId, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }, cb))}>
                {row.Status === "deferred" ? t("settings.sanitization.questions.answerNow", "Answer now") : t("settings.sanitization.questions.reopen", "Reopen")}
              </Button>
            )}
            <QuestionTools row={row} props={props} refs={refs} />
            <WriteNote {...(w.noteProps as object as { state: never })} />
          </div>
        )}
      </AskedBubble>
    </li>
  );
}

export function ClarificationsSection(props: SectionProps) {
  const { workspaceId, projectId, access } = props;
  const t = useT();
  const ctx = { workspaceId, projectId };
  const jobs = useEngineJobs(projectId, ["sanitization.assist"]);
  const jobList = jobs.data ?? [];
  const readingJob = latestAssistJob(jobList, "clarifications");
  const reading = !!readingJob && isActiveEngineJob(readingJob);
  // while the business analyst writes questions, they appear one by one
  const list = useQuery({ ...clarificationsOptions(ctx), refetchInterval: reading ? 3000 : false });
  const answers = useOptimisticAnswers(ctx, access.userId ?? null);
  const business = useBusinessRefs(ctx);
  const projectQ = useSanitizationProject(ctx);
  const setup = useSetup(workspaceId, projectId);
  const ask = useAskMadp(ctx);
  const [filter, setFilter] = useState<ClarificationFilter>("all");
  const [wanted, setWanted] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // an answer being written shows as given (a poll that lands first cannot put the question back)
  const rows = withPending((list.data ?? []) as Row[], answers.pending as ReadonlyMap<string, Row>) as Row[];
  const sentFiles = useTalkAttachments(projectId, "clarification", (list.data ?? []).filter((r) => (r as Row).Status === "answered").map((r) => (r as Row).ItemId));
  const refs = business.refs ?? [];
  const assistIds = new Set<string>(engineOutputIds(jobList, "sanitization.assist", "Clarification") as Iterable<string>);
  const open = rows.filter((r) => r.Status === "open");
  const doneRows = rows.filter((r) => r.Status !== "open");
  const done = filterClarifications(doneRows, filter, access.userId ?? "");
  const counts = { open: open.length, answered: rows.filter((r) => r.Status === "answered").length, deferred: rows.filter((r) => r.Status === "deferred").length };
  const progress = questionsProgress(counts);
  const activeId = activeQuestion(rows, wanted);
  const current = open.find((r) => r.ItemId === activeId) ?? null;
  const others = open.filter((r) => r.ItemId !== activeId);
  const fromMadp = (r: Row) => assistIds.has(r.ItemId) || r.SourceType === "engine" || (!!r.SourceType && r.SourceType.startsWith("doc-"));
  // the suggested answers read the project's own words: its goal and users, its region, what was answered so far
  const project = projectQ.data ?? null;
  const answerCtx: AnswerContext = {
    goal: setup.row?.Goal ?? project?.Goal ?? null, users: setup.row?.TargetUsers ?? project?.TargetUsers ?? null,
    region: project?.ClientRegion ?? null, client: project?.ClientName ?? null,
    words: [project?.Name ?? "", setup.brief, setup.row?.SetupMustHaves ?? "", setup.row?.SetupConstraints ?? "", ...rows.map((r) => r.Answer ?? "")].join(" "),
  };

  return (
    <OptimisticAnswersContext.Provider value={answers.value}>
    <AnswerFilesContext.Provider value={sentFiles.data ?? EMPTY_FILES}>
    <Card title={t("settings.sanitization.questions.title", "Questions for you")} icon={<CircleHelp size={18} strokeWidth={1.75} />}
      action={<span className="num text-[13px] font-medium text-ink2" aria-live="polite">{progress.total ? progress.text : ""}</span>}>
      {progress.total > 0 && (
        <ShimmerProgress step={progress.handled} total={progress.total} active={counts.open > 0} label={t("settings.sanitization.questions.progressLabel", "Questions answered")}
          valueText={progress.text} size="sm" ticks={progress.total <= 12} className="mb-5" />
      )}

      {list.isLoading ? (
        <div className="grid gap-3" aria-busy="true" aria-label={t("settings.sanitization.questions.loading", "Loading questions")}>
          {[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-block bg-surface2" />)}
        </div>
      ) : list.isError ? (
        <LoadError onRetry={() => { void list.refetch(); }} />
      ) : rows.length === 0 ? (
        <p className="py-2 text-[14px] text-ink2">
          {reading ? t("settings.sanitization.questions.emptyReading", "The first questions are on their way. They appear here one by one.")
            : readingJob?.status === "succeeded" ? t("settings.sanitization.questions.emptyClear", "No questions so far: your material was clear.")
            : t("settings.sanitization.questions.emptyWaiting", "The questions appear here once your business analyst has read your material.")}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-5">
          {doneRows.length > 0 && (
            <div>
              <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                <ChevronDown size={14} aria-hidden className={cn("transition", historyOpen && "rotate-180")} />
                {historyOpen ? t("settings.sanitization.questions.hideHistory", "Hide your answers so far") : t("settings.sanitization.questions.showHistory", "Your answers so far ({count})", { count: doneRows.length })}
              </button>
              {historyOpen && (
                <div className="mt-4">
                  <div role="group" aria-label={t("settings.sanitization.questions.filterAria", "Filter questions")} className="mb-4 flex flex-wrap gap-1.5">
                    {filters().map((f) => (
                      <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                        className={cn("h-7 rounded-full px-3 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                          filter === f.key ? "bg-ink text-canvas dark:bg-ink/15 dark:text-ink" : "bg-surface2 text-ink2 hover:bg-line hover:text-ink")}>
                        {f.label}{f.key === "deferred" && counts.deferred ? ` (${counts.deferred})` : ""}
                      </button>
                    ))}
                  </div>
                  {done.length === 0 ? <p className="text-[13px] text-ink3">{t("settings.sanitization.questions.filterEmpty", "Nothing here for this filter.")}</p> : (
                    <ul className="flex flex-col gap-5">
                      {done.map((r) => <DoneTurn key={r.ItemId} row={r} props={props} refs={refs} fromMadp={fromMadp(r)} answerCtx={answerCtx} />)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {answers.failure && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-block bg-danger-soft px-4 py-3 text-[13px] text-danger">
              <span className="min-w-0 break-words">{t("settings.sanitization.questions.failure", "Your answer to {label} was not saved. {message}", { label: answers.failure.label, message: answers.failure.message })}</span>
              <Button size="sm" variant="ghost" onClick={answers.failure.retry}>{t("settings.sanitization.questions.sendAgain", "Send it again")}</Button>
              <Button size="sm" variant="ghost" onClick={answers.dismiss}>{t("settings.sanitization.questions.dismiss", "Dismiss")}</Button>
            </div>
          )}

          {current ? (
            <div className="min-w-0 rounded-block bg-accent/[0.04] p-4 ring-1 ring-accent/15">
              <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
                <p className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("settings.sanitization.questions.position", "Question {n} of {total}", { n: Math.min(progress.handled + 1, progress.total), total: progress.total })}</p>
                {access.canEdit && !toolsOpen && (
                  <Button size="sm" variant="ghost" icon={<MoreHorizontal size={14} aria-hidden />} aria-label={t("settings.sanitization.questions.moreAria", "Edit or delete this question")} onClick={() => setToolsOpen(true)}>{t("settings.sanitization.questions.more", "More")}</Button>
                )}
              </div>
              <AskedBubble row={current} props={props} refs={refs} fromMadp={fromMadp(current)}>
                <Composer key={current.ItemId} row={current} props={props} active onActivate={() => undefined} onDone={() => { setWanted(null); setToolsOpen(false); }} answerCtx={answerCtx} />
              </AskedBubble>
              {access.canEdit && toolsOpen && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                  <QuestionTools key={current.ItemId} row={current} props={props} refs={refs} />
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-block bg-success/10 px-4 py-3 text-[14px] text-ink">
              {reading ? t("settings.sanitization.questions.doneReading", "You're up to date. More questions may still come while the business analyst reads.")
                : counts.deferred ? t("settings.sanitization.questions.doneAside", "Every question is answered or set aside. Thank you! The business analyst works with what you said.")
                : t("settings.sanitization.questions.doneAll", "Every question is answered. Thank you!")}
            </p>
          )}

          {others.length > 0 && (
            <div>
              <button type="button" aria-expanded={othersOpen} onClick={() => setOthersOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                <ChevronDown size={14} aria-hidden className={cn("transition", othersOpen && "rotate-180")} />
                {others.length === 1 ? t("settings.sanitization.questions.oneMore", "1 more question after this one") : t("settings.sanitization.questions.moreCount", "{count} more questions after this one", { count: others.length })}
              </button>
              {othersOpen && (
                <ul className="mt-3 flex flex-col gap-2">
                  {others.map((r) => (
                    <li key={r.ItemId} className="flex min-w-0 items-start gap-3 rounded-block bg-surface2 px-3 py-2.5">
                      <span className="min-w-0 flex-1 break-words text-[14px] text-ink2">{r.Question}</span>
                      <Button size="sm" variant="ghost" className="shrink-0" aria-label={t("settings.sanitization.questions.answerNowAria", "Answer {label} now", { label: formatNumber("C", r.Number) })}
                        onClick={() => { setWanted(r.ItemId); setOthersOpen(false); setToolsOpen(false); }}>{t("settings.sanitization.questions.answerThis", "Answer this one")}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {access.canEdit && readingJob && !reading && readingJob.status !== "succeeded" && (
        <EngineJobStatus variant="compact" job={readingJob} className="mt-4" requestError={ask.error ? sanitizationErrorText(ask.error) : null} />
      )}
      {access.canEdit && (
        <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-line pt-3">
          {adding ? (
            <div className="w-full pt-1"><AddForm ctx={ctx} members={props.members} refs={refs} onDone={() => setAdding(false)} /></div>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={<Plus size={14} aria-hidden />} onClick={() => setAdding(true)}>{t("settings.sanitization.questions.addOwn", "Add a question of your own")}</Button>
              <Button size="sm" variant="ghost" icon={<Factory size={14} aria-hidden />} disabled={ask.isPending || reading} onClick={() => ask.mutate({ projectId, focus: "clarifications" })}>
                {t("settings.sanitization.questions.askMore", "Ask for more questions")}
              </Button>
              {ask.error != null && <span role="alert" className="text-[13px] text-danger">{sanitizationErrorText(ask.error)}</span>}
            </>
          )}
        </div>
      )}
    </Card>
    </AnswerFilesContext.Provider>
    </OptimisticAnswersContext.Provider>
  );
}
