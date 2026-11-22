/** "A few questions": the analyst's questions (the Clarification records), one at a time, as in today's panel
 *  (analysis/pm/QuestionsTalk.tsx) with the same ops: answering calls clarification.answer, "Not sure" and "Later"
 *  call clarification.defer with the standard reasons. Here the question sits in its own card with a "Why I ask" line,
 *  the suggested answers are large choices (number keys 1-9 pick one while the card has focus), "Other…" opens a text
 *  box (Enter sends), a short acknowledgement follows each answer, and the answered ones fold into "Earlier answers".
 *  When none is open, the step's own next action (understandingNow: start, prepare, confirm = sanitization.complete). */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Clock3, HelpCircle, Info, PencilLine, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob } from "@/blocks/engine/types";
import {
  clarificationsOptions, latestAssistJob, useBusinessRefs, useRequirementsV1, useSanitizationProject, useStepAccess,
} from "@/blocks/sanitization/hooks";
import {
  useAnswerClarification, useAskMadp, useCompleteSanitization, useDeferClarification, useDraftInitial,
} from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { canAnswerClarification, sanitizationPhase } from "@/domain/sanitization";
import { isLandingJob } from "@/domain/landingPage";
import { optionsFor, type AnswerContext } from "@/components/sanitization/answerOptions";
import { activeQuestion, asideKindOf, asideReason, questionsProgress, understandingNow, type AsideKind } from "@/components/sanitization/understandingModel";
import { jobView } from "@/components/sanitization/SanitizationStep";
import { useSetup } from "@/components/sanitization/UnderstoodSection";
import { Button, Textarea } from "@/ui/kit";
import { cn } from "@/lib/cn";
import type { DocPart } from "../model";
import { ackText, choiceIndex, myWords, progressPct, sendsOnEnter, whyIAsk, type AckKind } from "./analystModel";
import { Ack, AnalystSays, ErrorNote, Note, PartLink, QuestionCard, YouSaid } from "./Talk";
import { Working } from "./Working";
import { useDirtyDraft } from "@/components/project/dirtyDrafts";
import { useT } from "@/i18n";

interface Row {
  ItemId: string; Number: number; Question: string; Options?: string[] | null; Answer?: string | null; Status: string;
  OwnerUserId?: string | null; DeferReason?: string | null; LastUpdatedDate?: string | null;
  SourceType?: string | null; SourceRef?: string | null;
}

/** A question handled here whose new status the list has not read back yet (hidden from "now" until it has). */
interface Handled { at: number; status: "answered" | "deferred"; answer?: string; reason?: string }

const MAX_ANSWER = 5000;

export function QuestionsStep({ projectId, workspaceId, projectName, existing, onPart }: {
  projectId: string; workspaceId: string; projectName: string; existing: boolean; onPart: (part: DocPart) => void;
}) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const access = useStepAccess(ctx);
  const projectQ = useSanitizationProject(ctx);
  const jobs = useEngineJobs(projectId, ["sanitization.assist", "requirements.draft"]).data ?? [];
  const questionsJob = latestAssistJob(jobs, "clarifications");
  const reading = !!questionsJob && isActiveEngineJob(questionsJob);
  const list = useQuery({ ...clarificationsOptions(ctx), refetchInterval: reading ? 3000 : false });
  const v1 = useRequirementsV1(ctx);
  const business = useBusinessRefs(ctx);
  const setup = useSetup(workspaceId, projectId);
  const answer = useAnswerClarification(ctx);
  const defer = useDeferClarification(ctx);
  const ask = useAskMadp(ctx);
  const draftOp = useDraftInitial(ctx);
  const complete = useCompleteSanitization(ctx);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handled, setHandled] = useState<Record<string, Handled>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  // an answer typed in "Other…" and not sent: leaving the project says so (LeaveProjectDialog)
  useDirtyDraft(projectId, t("analysis.analyst.questions.dirtyDraft", "answer for your business analyst"), draft.trim() !== "");

  // the list as it stands, with what was handled here a moment ago until the list has read it back
  const readAt = list.dataUpdatedAt;
  const rows = ((list.data ?? []) as Row[]).slice().sort((a, b) => a.Number - b.Number).map((r) => {
    const h = handled[r.ItemId];
    return h && r.Status === "open" && readAt <= h.at
      ? { ...r, Status: h.status, Answer: h.answer ?? r.Answer, DeferReason: h.reason ?? r.DeferReason }
      : r;
  });
  const counts = {
    open: rows.filter((r) => r.Status === "open").length,
    answered: rows.filter((r) => r.Status === "answered").length,
    deferred: rows.filter((r) => r.Status === "deferred").length,
  };
  const progress = questionsProgress(counts);
  const currentId = activeQuestion(rows, null);
  const current = rows.find((r) => r.ItemId === currentId) ?? null;
  const history = rows.filter((r) => r.Status !== "open");
  const project = projectQ.data ?? null;
  const phase = project ? sanitizationPhase({ stage: project.Stage, resumeTo: project.ResumeTo ?? undefined }) : "notOpen";
  const completed = phase === "completed";
  const answerCtx: AnswerContext = {
    goal: setup.row?.Goal ?? project?.Goal ?? null, users: setup.row?.TargetUsers ?? project?.TargetUsers ?? null,
    region: project?.ClientRegion ?? null, client: project?.ClientName ?? null,
    words: [projectName, setup.brief, setup.row?.SetupMustHaves ?? "", setup.row?.SetupConstraints ?? "", ...rows.map((r) => r.Answer ?? "")].join(" "),
  };
  const busy = answer.isPending || defer.isPending;

  // after an answer the next question's card takes the focus, so the number keys keep working
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    cardRef.current?.focus({ preventScroll: true });
  }, [currentId]);

  const settled = (row: Row, kind: AckKind, h: Handled) => {
    const last = counts.open <= 1;
    setHandled((m) => ({ ...m, [row.ItemId]: h }));
    setAck(ackText(kind, { last }));
    setDraft("");
    setWriting(false);
    refocus.current = !last;
  };

  const send = (row: Row, value: string) => {
    const v = value.trim().slice(0, MAX_ANSWER);
    if (!v || busy) return;
    setError(null);
    setSending(v);
    answer.mutate({ projectId, id: row.ItemId, answer: v, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }, {
      onSuccess: () => settled(row, "answered", { at: Date.now(), status: "answered", answer: v }),
      onError: (e) => setError({ text: myWords(sanitizationErrorText(e)), retry: () => send(row, v) }),
      onSettled: () => setSending(null),
    });
  };
  const aside = (row: Row, kind: AsideKind) => {
    if (busy) return;
    setError(null);
    const reason = asideReason(kind, writing ? draft : "");
    defer.mutate({ projectId, id: row.ItemId, reason, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }, {
      onSuccess: () => settled(row, kind, { at: Date.now(), status: "deferred", reason }),
      onError: (e) => setError({ text: myWords(sanitizationErrorText(e)), retry: () => aside(row, kind) }),
    });
  };

  // the step's own next action once nothing is open (the same rules as "Understanding your project")
  const refs = business.refs ?? [];
  const draftJob = latestEngineJob(jobs.filter((j) => !isLandingJob(j)), "requirements.draft");
  const now = understandingNow({
    existing, completed, canEdit: access.canEdit,
    notes: refs.filter((r) => r.type === "note").length, files: refs.filter((r) => r.type === "file").length,
    questions: counts, requirements: (v1.requirements ?? []).length, hasObjective: !!v1.objective?.Statement?.trim(),
    questionsJob: jobView(questionsJob), draftJob: jobView(draftJob),
  });
  const pending = ask.isPending || draftOp.isPending || complete.isPending;
  const stepError = complete.error ?? ask.error ?? draftOp.error;
  const onNext = () => {
    switch (now.primary.kind) {
      case "start": ask.mutate({ projectId, focus: "clarifications" }); return;
      case "prepare": draftOp.mutate({ projectId }); return;
      case "confirm": complete.mutate({ projectId }); return;
      default: return;
    }
  };
  const actionable = now.primary.kind === "start" || now.primary.kind === "prepare" || now.primary.kind === "confirm";
  // on this page there is no separate "Goals & requirements" step to continue to: the requirements come next here
  const nextLabel = now.primary.kind === "prepare" || now.primary.kind === "confirm" ? t("analysis.analyst.questions.continueToRequirements", "Continue to the requirements") : now.primary.label;

  if (list.isLoading || projectQ.isLoading) return <AnalystSays className="text-ink2">{t("analysis.workspace.questions.gettingReady", "Getting my questions ready…")}</AnalystSays>;
  if (list.isError) return <ErrorNote text={t("analysis.analyst.questions.loadFailed", "I couldn't load the questions just now.")} onRetry={() => void list.refetch()} />;

  const mayAnswer = current ? canAnswerClarification({ userId: access.userId ?? "", permissions: access.permissions }, { ownerUserId: current.OwnerUserId ?? "" }) : false;
  const options = current ? optionsFor(current, answerCtx).slice(0, 9) : [];
  const text = draft.trim();
  const why = current ? whyIAsk({ question: current.Question, sourceType: current.SourceType, sourceRef: current.SourceRef, refs }) : null;
  const showBox = writing || options.length === 0;

  const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!current || !mayAnswer) return;
    const el = e.target as HTMLElement;
    const typing = el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable;
    const i = choiceIndex(e.key, options.length, { typing, modifier: e.altKey || e.ctrlKey || e.metaKey });
    if (i === null) return;
    e.preventDefault();
    send(current, options[i]!);
  };
  const openOther = () => setWriting(true);

  const historyToggle = history.length > 0 && (
    <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}
      className="inline-flex shrink-0 items-center gap-1 rounded text-[13px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
      {t("analysis.workspace.questions.earlierAnswers", "Earlier answers ({count})", { count: history.length })}<ChevronDown size={14} aria-hidden className={cn("transition motion-reduce:transition-none", historyOpen && "rotate-180")} />
    </button>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-3.5">
        {ack && <Ack>{ack}</Ack>}
        {historyToggle && <div>{historyToggle}</div>}
        {historyOpen && <History rows={history} />}
        {reading ? (
          <Working text={t("analysis.workspace.questions.writing", "I'm writing my questions from your setup and files. They appear here one by one.")} />
        ) : (
          <AnalystSays>
            {completed ? t("analysis.analyst.questions.settled", "Thank you, that settles my questions.")
              : progress.total === 0 ? t("analysis.workspace.questions.noneOpen", "I have no open questions right now.")
              : t("analysis.analyst.questions.allForNow", "That's all my questions for now.")}
            {!completed && now.primary.kind === "prepare" && !now.stopped ? " " + t("analysis.workspace.questions.nextPrepare", "Next I'll prepare the first requirements from your answers.") : ""}
            {!completed && now.primary.kind === "confirm" ? " " + t("analysis.workspace.questions.firstReady", "The first requirements are ready. If you're happy with the answers, continue to review them.") : ""}
            {!completed && now.stopped ? " " + now.stopped.text : ""}
          </AnalystSays>
        )}
        {!completed && now.primary.kind === "preparing" && <Working text={t("analysis.workspace.questions.preparing", "I'm preparing the first requirements from your answers.")} />}
        {!completed && actionable && access.canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="md" variant="primary" data-analyst-action="" disabled={now.primary.disabled || pending} onClick={onNext}>
              {pending ? t("analysis.analyst.workingOnItShort", "Working on it…") : nextLabel}
            </Button>
          </div>
        )}
        {!completed && !access.canEdit && <Note>{t("analysis.analyst.questions.someoneConfirmsStep", "Someone on the project team with edit rights confirms this step.")}</Note>}
        {stepError != null && <ErrorNote text={myWords(sanitizationErrorText(stepError))} busy={pending} onRetry={actionable ? onNext : undefined} />}
      </div>
    );
  }

  const pct = progressPct(progress.handled, progress.total);
  const counter = t("analysis.workspace.questionCounter", "Question {n} of {total}", { n: Math.min(progress.handled + 1, progress.total), total: progress.total });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="num text-[13px] font-medium text-ink2" aria-live="polite">{counter}</p>
          {historyToggle}
        </div>
        <div role="progressbar" aria-label={t("analysis.analyst.questions.progressAria", "Questions")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-valuetext={progress.text} className="h-1 w-full overflow-hidden rounded-full bg-surface2">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {historyOpen && <History rows={history} />}

      <div aria-live="polite">
        {ack ? <Ack>{ack}</Ack>
          : progress.handled === 0 ? <AnalystSays className="text-ink2">{t("analysis.analyst.questions.intro", "A few things your setup and files leave open. Pick an answer or write your own; “Later” is always fine.")}</AnalystSays>
          : null}
      </div>

      <QuestionCard key={current.ItemId} ref={cardRef} label={`${counter}: ${current.Question}`} onKeyDown={onCardKey} action
        question={current.Question}>
        {why && (
          <p className="-mt-1.5 flex gap-2 text-[13px] leading-5 text-ink3">
            <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              <span className="font-medium text-ink2">{t("analysis.analyst.questions.whyIAsk", "Why I ask:")} </span>
              {why.from ? t("analysis.analyst.questions.cameUpIn", "it came up in {from}. Your answer goes into", { from: why.from }) + " " : t("analysis.analyst.questions.goesInto", "your answer goes into") + " "}
              <PartLink onClick={() => onPart(why.part)}>{why.partLabel}</PartLink>.
            </span>
          </p>
        )}
        {!mayAnswer ? (
          <Note>{t("analysis.workspace.questions.someoneElse", "Someone else on the team answers this one.")}</Note>
        ) : (
          <div className="flex flex-col gap-2.5">
            {options.length > 0 && (
              <div role="group" aria-label={t("analysis.workspace.questions.suggested", "Suggested answers")} className="flex flex-col gap-2">
                {options.map((o, i) => (
                  <button key={o} type="button" disabled={busy} onClick={() => send(current, o)} aria-keyshortcuts={String(i + 1)}
                    className={cn("group flex min-h-12 w-full items-center gap-3 rounded-block bg-surface px-3.5 py-2.5 text-left text-[15px] leading-6 text-ink ring-1 ring-line outline-none transition",
                      "hover:bg-accent-soft/60 hover:ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
                      sending === o && "bg-accent-soft ring-accent/50 disabled:opacity-100")}>
                    <span aria-hidden className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface2 text-[12px] font-medium text-ink2 group-hover:bg-surface">{i + 1}</span>
                    <span className="min-w-0 flex-1 break-words">{o}</span>
                    {sending === o && <span className="shrink-0 text-[12px] text-ink3">{t("analysis.workspace.saving", "Saving…")}</span>}
                  </button>
                ))}
                {!writing && (
                  <button type="button" disabled={busy} onClick={openOther}
                    className="flex min-h-12 w-full items-center gap-3 rounded-block px-3.5 py-2.5 text-left border border-dashed border-line text-[15px] text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-45 motion-reduce:transition-none">
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center"><PencilLine size={15} /></span>
                    {t("analysis.workspace.questions.other", "Other…")}
                  </button>
                )}
              </div>
            )}
            {showBox && (
              <div className="flex flex-col gap-2">
                <Textarea autoFocus={writing} aria-label={t("analysis.workspace.questions.yourAnswer", "Your answer")} value={draft} maxLength={MAX_ANSWER} className="min-h-[88px] bg-surface text-[15px] ring-1 ring-line"
                  placeholder={t("analysis.analyst.questions.placeholder", "In your own words. A few words are enough.")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing }) && text) { e.preventDefault(); send(current, text); }
                  }} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="md" variant="primary" icon={<Send size={15} aria-hidden />} disabled={!text || busy} onClick={() => send(current, text)}>
                    {answer.isPending ? t("analysis.workspace.saving", "Saving…") : t("analysis.analyst.answer", "Answer")}
                  </Button>
                  <span className="hidden text-[12px] text-ink3 sm:inline">{t("analysis.analyst.enterSends", "Enter sends · Shift + Enter for a new line")}</span>
                </div>
              </div>
            )}
            {access.canEdit && (
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-0.5">
                <button type="button" disabled={busy} onClick={() => aside(current, "later")}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45">
                  <Clock3 size={14} aria-hidden />{t("analysis.analyst.later", "Later")}
                </button>
                <button type="button" disabled={busy} onClick={() => aside(current, "notSure")} title={t("analysis.analyst.questions.suggestTitle", "I'll suggest an answer for you to check")}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45">
                  <HelpCircle size={14} aria-hidden />{t("analysis.workspace.questions.notSure", "Not sure")}
                </button>
                {options.length > 1 && <span className="ml-auto hidden text-[12px] text-ink3 sm:inline">{t("analysis.analyst.questions.pressToPick", "Press 1–{count} to pick", { count: options.length })}</span>}
              </div>
            )}
            {error && <ErrorNote text={error.text} busy={busy} onRetry={error.retry} />}
          </div>
        )}
      </QuestionCard>
    </div>
  );
}

/** What was answered or set aside, oldest first (read only here; changing an answer stays in the analysis). */
function History({ rows }: { rows: Row[] }) {
  const t = useT();
  return (
    <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-block bg-surface2/60 p-3">
      {rows.map((r) => (
        <li key={r.ItemId} className="flex flex-col gap-1.5">
          <p className="break-words text-[13px] leading-5 text-ink2">{r.Question}</p>
          {r.Status === "answered" ? <YouSaid>{r.Answer ?? ""}</YouSaid>
            : <p className="text-right text-[12px] text-ink3">{asideKindOf(r.DeferReason) === "notSure" ? t("analysis.workspace.questions.notSureYet", "Not sure yet") : t("analysis.analyst.later", "Later")}</p>}
        </li>
      ))}
    </ol>
  );
}
