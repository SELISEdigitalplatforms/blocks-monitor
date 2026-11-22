/** "A few questions" at the meeting table: the business analyst asks the Clarification records one at a time, exactly
 *  as the analysis page does (analysis-next/analyst/QuestionsStep.tsx): the same reads, the same order (activeQuestion),
 *  the same suggested answers (optionsFor), the same writes (clarification.answer; "Later" and "Not sure" as
 *  clarification.defer with the standard reasons) and, once none is open, the step's own next action (understandingNow:
 *  start the reading, prepare the first requirements, or confirm = sanitization.complete). Here each question is said,
 *  the suggested answers are quick replies and your own words go in the composer. */
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { t, useT } from "@/i18n";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob } from "@/blocks/engine/types";
import { clarificationsOptions, latestAssistJob, useBusinessRefs, useRequirementsV1, useSanitizationProject, useStepAccess } from "@/blocks/sanitization/hooks";
import { useAnswerClarification, useAskMadp, useCompleteSanitization, useDeferClarification, useDraftInitial } from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { canAnswerClarification, sanitizationPhase } from "@/domain/sanitization";
import { isLandingJob } from "@/domain/landingPage";
import { optionsFor, type AnswerContext } from "@/components/sanitization/answerOptions";
import { activeQuestion, asideReason, questionsProgress, understandingNow, type AsideKind } from "@/components/sanitization/understandingModel";
import { jobView } from "@/components/sanitization/SanitizationStep";
import { useSetup } from "@/components/sanitization/UnderstoodSection";
import { myWords, progressPct, whyIAsk } from "@/components/analysis-next/analyst/analystModel";
import { ackFor } from "./acks";
import { intentOf } from "./intent";
import { useVisit } from "./store";
import { settleAck, useChat, type Reply } from "./chat";
import { useTurn, useWorking } from "./useTurn";

interface Row {
  ItemId: string; Number: number; Question: string; Options?: string[] | null; Answer?: string | null; Status: string;
  OwnerUserId?: string | null; DeferReason?: string | null; LastUpdatedDate?: string | null; SourceType?: string | null; SourceRef?: string | null;
}
interface Handled { at: number; status: "answered" | "deferred"; answer?: string; reason?: string }

const MAX_ANSWER = 5000;
const PM = "pm" as const;

export function QuestionsTalk({ projectId, workspaceId, projectName, existing }: {
  projectId: string; workspaceId: string; projectName: string; existing: boolean;
}) {
  const tr = useT();
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
  const [handled, setHandled] = useState<Record<string, Handled>>({});
  // the closing words ("That's all my questions for now") were said
  const closed = useRef(false);

  // the list as it stands, with what was handled here a moment ago until the list has read it back
  const readAt = list.dataUpdatedAt;
  const rows = ((list.data ?? []) as Row[]).slice().sort((a, b) => a.Number - b.Number).map((r) => {
    const h = handled[r.ItemId];
    return h && r.Status === "open" && readAt <= h.at ? { ...r, Status: h.status, Answer: h.answer ?? r.Answer, DeferReason: h.reason ?? r.DeferReason } : r;
  });
  const counts = {
    open: rows.filter((r) => r.Status === "open").length,
    answered: rows.filter((r) => r.Status === "answered").length,
    deferred: rows.filter((r) => r.Status === "deferred").length,
  };
  const progress = questionsProgress(counts);
  const current = rows.find((r) => r.ItemId === activeQuestion(rows, null)) ?? null;
  const project = projectQ.data ?? null;
  const completed = (project ? sanitizationPhase({ stage: project.Stage, resumeTo: project.ResumeTo ?? undefined }) : "notOpen") === "completed";
  const answerCtx: AnswerContext = {
    goal: setup.row?.Goal ?? project?.Goal ?? null, users: setup.row?.TargetUsers ?? project?.TargetUsers ?? null,
    region: project?.ClientRegion ?? null, client: project?.ClientName ?? null,
    words: [projectName, setup.brief, setup.row?.SetupMustHaves ?? "", setup.row?.SetupConstraints ?? "", ...rows.map((r) => r.Answer ?? "")].join(" "),
  };
  const refs = business.refs ?? [];
  const draftJob = latestEngineJob(jobs.filter((j) => !isLandingJob(j)), "requirements.draft");
  const now = understandingNow({
    existing, completed, canEdit: access.canEdit,
    notes: refs.filter((r) => r.type === "note").length, files: refs.filter((r) => r.type === "file").length,
    questions: counts, requirements: (v1.requirements ?? []).length, hasObjective: !!v1.objective?.Statement?.trim(),
    questionsJob: jobView(questionsJob), draftJob: jobView(draftJob),
  });
  const loading = list.isLoading || projectQ.isLoading;
  const chat = useChat.getState();

  const openSheet = useVisit((st) => st.openSheet);
  // the acknowledgement (short, about what was said) is said by the next turn first, or right after the save
  const expect = (kind: "answered" | "notSure" | "later", said = "") => chat.expectAck(PM, kind === "answered" ? ackFor("answer", said) : ackFor(kind));
  const settled = (row: Row, h: Handled) => {
    setHandled((m) => ({ ...m, [row.ItemId]: h }));
    window.setTimeout(() => settleAck(true), 0);
  };
  const send = async (row: Row, value: string) => {
    const v = value.trim().slice(0, MAX_ANSWER);
    if (!v) return;
    chat.you(v);
    expect("answered", v);
    try {
      await chat.whileBusy(PM, null, () => answer.mutateAsync({ projectId, id: row.ItemId, answer: v, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }));
      settled(row, { at: Date.now(), status: "answered", answer: v });
    } catch (e) {
      settleAck(false);
      void chat.say(PM, myWords(sanitizationErrorText(e)), { tone: "error" });
    }
  };
  const aside = async (row: Row, kind: AsideKind, words: string, said?: string) => {
    // the app's own "Later" / "Not sure" (clarification.defer with its standard reason)
    const reason = asideReason(kind, said ? "" : words);
    chat.you(said ?? (kind === "notSure" ? tr("studio.office.visit.q.notSure", "Not sure") : tr("studio.office.visit.q.later", "Later")));
    expect(kind);
    try {
      await chat.whileBusy(PM, null, () => defer.mutateAsync({ projectId, id: row.ItemId, reason, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }));
      settled(row, { at: Date.now(), status: "deferred", reason });
    } catch (e) {
      settleAck(false);
      void chat.say(PM, myWords(sanitizationErrorText(e)), { tone: "error" });
    }
  };
  const onNext = async () => {
    try {
      await chat.whileBusy(PM, null, async () => {
        switch (now.primary.kind) {
          case "start": await ask.mutateAsync({ projectId, focus: "clarifications" }); return;
          case "prepare": await draftOp.mutateAsync({ projectId }); return;
          case "confirm": await complete.mutateAsync({ projectId }); return;
          default: return;
        }
      });
    } catch (e) {
      void chat.say(PM, myWords(sanitizationErrorText(e)), { tone: "error" });
    }
  };

  // what the analyst is doing on their own (the records say it runs)
  useWorking(PM, loading ? tr("studio.office.visit.q.loading", "Getting my questions ready…")
    : !current && reading ? tr("studio.office.visit.q.writing", "Writing my questions from your setup and files")
    : !current && !completed && now.primary.kind === "preparing" ? tr("studio.office.visit.q.preparing", "Preparing the first requirements from your answers")
    : null);

  // the turn: a question, or what happens now that none is open
  const mayAnswer = current ? canAnswerClarification({ userId: access.userId ?? "", permissions: access.permissions }, { ownerUserId: current.OwnerUserId ?? "" }) : false;
  const options = current ? optionsFor(current, answerCtx).slice(0, 9) : [];
  const actionable = now.primary.kind === "start" || now.primary.kind === "prepare" || now.primary.kind === "confirm";
  const nextLabel = now.primary.kind === "prepare" || now.primary.kind === "confirm" ? tr("studio.office.visit.q.continue", "Continue to the requirements") : now.primary.label;

  let key: string | null = null;
  let lines: string[] = [];
  let replies: Reply[] = [];
  let writes = false;
  if (list.isError) {
    key = "q:error";
    lines = [tr("studio.office.visit.q.loadFailed", "I couldn't load the questions just now.")];
    replies = [{ id: "retry", label: tr("studio.office.visit.q.retry", "Try again"), primary: true }];
  } else if (loading) {
    key = null;
  } else if (current) {
    key = `q:${current.ItemId}`;
    lines = [
      ...(progress.handled === 0 ? [tr("studio.office.visit.q.intro", "A few things your setup and files leave open. Pick an answer or write your own; “Later” is always fine.")] : []),
      current.Question,
      ...(!mayAnswer ? [tr("studio.office.visit.q.someoneElse", "Someone else on the team answers this one.")] : []),
    ];
    if (mayAnswer) {
      writes = true;
      replies = [
        ...options.map((o, i) => ({ id: `o${i}`, label: o })),
        ...(access.canEdit ? [
          { id: "later", label: tr("studio.office.visit.q.later", "Later"), quiet: true },
          { id: "notSure", label: tr("studio.office.visit.q.notSureReply", "Not sure: suggest an answer"), quiet: true },
        ] : []),
      ];
    }
  } else if (!reading) {
    // the closing words once; then only what an actionable moment adds (while the analyst works, the typing says it)
    const kind = completed ? "completed" : actionable ? now.primary.kind : "working";
    key = `q:none:${kind}:${progress.total}${now.stopped ? ":stopped" : ""}`;
    const base = completed ? tr("studio.office.visit.q.settled", "Thank you, that settles my questions.")
      : progress.total === 0 ? tr("studio.office.visit.q.noneOpen", "I have no open questions right now.")
      : tr("studio.office.visit.q.allDone", "That's all my questions for now.");
    const suffix = completed ? ""
      : now.stopped ? now.stopped.text
      : now.primary.kind === "prepare" ? tr("studio.office.visit.q.nextPrepare", "Next I'll prepare the first requirements from your answers.")
      : now.primary.kind === "confirm" ? tr("studio.office.visit.q.nextConfirm", "The first requirements are ready. If you're happy with the answers, continue to review them.")
      : "";
    lines = [!closed.current ? (suffix ? `${base} ${suffix}` : base) : suffix].filter(Boolean);
    if (!completed && actionable && access.canEdit) replies = [{ id: "next", label: nextLabel, primary: true, disabled: now.primary.disabled }];
    if (!completed && !access.canEdit) lines.push(tr("studio.office.visit.q.teamConfirms", "Someone on the project team with edit rights confirms this step."));
  }

  useTurn(PM, key, lines, key === null ? null : {
    mode: writes ? "text" : "none",
    label: current?.Question ?? tr("studio.office.visit.q.label", "A few questions"),
    placeholder: tr("studio.office.visit.q.placeholder", "Or answer in your own words"),
    multiline: true,
    maxLength: MAX_ANSWER,
    replies,
    onSend: writes && current ? (text) => {
      const intent = intentOf(text);
      if (intent === "later" || intent === "notSure") { void aside(current, intent, "", text); return; }
      // a plain yes or no: the suggested answer that says so; "yes" / "ok" to a question it does not answer moves on
      // (the app's "Later"); a plain "no" is an answer in itself
      if (intent === "yes" || intent === "no") {
        const match = options.find((o) => (intent === "yes" ? /^(yes|ja)\b/i : /^(no|nein)\b/i).test(o.trim()));
        if (match) { void send(current, match); return; }
        if (intent === "yes") { void aside(current, "later", "", text); return; }
      }
      void send(current, text);
    } : actionable && access.canEdit && !completed ? (text) => {
      // nothing open: "yes" goes on; anything else waits for the person
      chat.you(text);
      if (intentOf(text) === "yes") void onNext();
    } : undefined,
    onReply: (id, typed) => {
      if (id === "retry") { void list.refetch(); return; }
      if (id === "next") { void onNext(); return; }
      if (!current) return;
      if (id === "later" || id === "notSure") { void aside(current, id, typed); return; }
      const i = Number(id.slice(1));
      if (Number.isInteger(i) && options[i]) void send(current, options[i]);
    },
  });

  // after the turn has said them (effects run in order: useTurn's first)
  useEffect(() => { if (key?.startsWith("q:none:")) closed.current = true; }, [key]);

  if (!current) return null;
  const why = whyIAsk({ question: current.Question, sourceType: current.SourceType, sourceRef: current.SourceRef, refs });
  const pct = progressPct(progress.handled, progress.total);
  return (
    <div key={current.ItemId} className="visit-desk visit-in pointer-events-auto flex max-w-full flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="num shrink-0 text-[12px] font-medium text-ink2" aria-live="polite">
          {t("studio.office.visit.q.counter", "Question {n} of {total}", { n: Math.min(progress.handled + 1, progress.total), total: progress.total })}
        </span>
        <span role="progressbar" aria-label={t("studio.office.visit.q.label", "A few questions")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-valuetext={progress.text} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.07]">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </span>
      </div>
      <p className="flex gap-2 text-[13px] leading-5 text-ink3">
        <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          <span className="font-medium text-ink2">{t("studio.office.visit.q.why", "Why I ask:")} </span>
          {why.from ? t("studio.office.visit.q.whyFrom", "it came up in {from}. Your answer goes into", { from: why.from }) : t("studio.office.visit.q.whyPart", "your answer goes into")}{" "}
          <button type="button" onClick={() => openSheet(why.part)} className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">{why.partLabel}</button>.
        </span>
      </p>
    </div>
  );
}
