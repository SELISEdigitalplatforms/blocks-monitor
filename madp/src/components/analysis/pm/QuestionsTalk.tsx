/** "Answer the open questions": the business analyst's questions (the Clarification records "Questions for you" shows),
 *  one at a time: the question, its suggested answers (optionsFor), your own words, "Not sure" and "Later" (the same
 *  set-aside reasons), and "Question 3 of 7". Answering calls clarification.answer, setting aside clarification.defer,
 *  exactly as ClarificationsSection does; answered ones collapse into the history. When none is open, the step's own
 *  next action (understandingNow: start, prepare, confirm = sanitization.complete). */
import { useState } from "react";
import { ChevronDown, Clock3, HelpCircle, PencilLine, Send } from "lucide-react";
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
import { activeQuestion, asideReason, questionsProgress, understandingNow, type AsideKind } from "@/components/sanitization/understandingModel";
import { jobView } from "@/components/sanitization/SanitizationStep";
import { useSetup } from "@/components/sanitization/UnderstoodSection";
import { Button, Textarea } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { questionCounter } from "./pmModel";
import { PmSays, TalkNote, YouSaid } from "./Talk";
import { useT } from "@/i18n";

interface Row {
  ItemId: string; Number: number; Question: string; Options?: string[] | null; Answer?: string | null; Status: string;
  OwnerUserId?: string | null; DeferReason?: string | null; LastUpdatedDate?: string | null;
}

const MAX_ANSWER = 5000;
const OPTION = "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-left text-[13px] ring-1 transition disabled:opacity-45";

export function QuestionsTalk({ projectId, workspaceId, projectName, existing }: {
  projectId: string; workspaceId: string; projectName: string; existing: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const rows = ((list.data ?? []) as Row[]).slice().sort((a, b) => a.Number - b.Number);
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

  const send = (row: Row, value: string) => {
    const v = value.trim().slice(0, MAX_ANSWER);
    if (!v || busy) return;
    setError(null);
    answer.mutate({ projectId, id: row.ItemId, answer: v, expectedUpdatedAt: row.LastUpdatedDate ?? undefined }, {
      onSuccess: () => { setDraft(""); setWriting(false); },
      onError: (e) => setError(sanitizationErrorText(e)),
    });
  };
  const aside = (row: Row, kind: AsideKind) => {
    if (busy) return;
    setError(null);
    defer.mutate({ projectId, id: row.ItemId, reason: asideReason(kind, draft), expectedUpdatedAt: row.LastUpdatedDate ?? undefined }, {
      onSuccess: () => { setDraft(""); setWriting(false); },
      onError: (e) => setError(sanitizationErrorText(e)),
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

  if (list.isLoading || projectQ.isLoading) return <PmSays>{t("analysis.workspace.questions.gettingReady", "Getting my questions ready…")}</PmSays>;
  if (list.isError) return <TalkNote tone="danger">{t("analysis.workspace.questions.loadFailed", "I couldn't load the questions just now. Try again in a moment.")}</TalkNote>;

  const mayAnswer = current ? canAnswerClarification({ userId: access.userId ?? "", permissions: access.permissions }, { ownerUserId: current.OwnerUserId ?? "" }) : false;
  const options = current ? optionsFor(current, answerCtx) : [];
  const text = draft.trim();

  return (
    <div className="flex flex-col gap-3">
      {current ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink3" aria-live="polite">{questionCounter(progress.handled, progress.total)}</p>
            {history.length > 0 && (
              <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-ink2 hover:text-ink">
                {t("analysis.workspace.questions.earlierAnswers", "Earlier answers ({count})", { count: history.length })}<ChevronDown size={14} aria-hidden className={cn("transition", historyOpen && "rotate-180")} />
              </button>
            )}
          </div>
          {historyOpen && <History rows={history} />}
          <PmSays><span className="font-medium">{current.Question}</span></PmSays>
          {!mayAnswer ? (
            <TalkNote>{t("analysis.workspace.questions.someoneElse", "Someone else on the team answers this one.")}</TalkNote>
          ) : (
            <div className="flex flex-col gap-2">
              {options.length > 0 && (
                <div role="group" aria-label={t("analysis.workspace.questions.suggested", "Suggested answers")} className="flex flex-wrap gap-1.5">
                  {options.map((o) => (
                    <button key={o} type="button" disabled={busy} onClick={() => send(current, o)}
                      className={cn(OPTION, "bg-surface text-ink ring-line hover:bg-accent-soft hover:ring-accent/40")}>
                      <span className="min-w-0 break-words">{o}</span>
                    </button>
                  ))}
                  <button type="button" disabled={busy} aria-expanded={writing} onClick={() => setWriting(true)}
                    className={cn(OPTION, writing ? "bg-surface2 text-ink ring-line" : "bg-surface text-ink2 ring-line hover:bg-surface2 hover:text-ink")}>
                    <PencilLine size={14} aria-hidden />{t("analysis.workspace.questions.other", "Other…")}
                  </button>
                </div>
              )}
              {(writing || options.length === 0) && (
                <Textarea aria-label={t("analysis.workspace.questions.yourAnswer", "Your answer")} value={draft} maxLength={MAX_ANSWER} className="min-h-[84px] bg-surface ring-1 ring-line"
                  placeholder={t("analysis.workspace.questions.placeholder", "Type your answer in your own words. A few words are enough.")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text) { e.preventDefault(); send(current, text); } }} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {(writing || options.length === 0) && (
                  <Button size="sm" variant="primary" icon={<Send size={14} aria-hidden />} disabled={!text || busy} onClick={() => send(current, text)}>
                    {answer.isPending ? t("analysis.workspace.sending", "Sending…") : t("analysis.workspace.sendAnswer", "Send answer")}
                  </Button>
                )}
                {access.canEdit && (
                  <>
                    <Button size="sm" variant="ghost" icon={<HelpCircle size={14} aria-hidden />} disabled={busy} title={t("analysis.workspace.questions.suggestTitle", "I'll suggest an answer")}
                      onClick={() => aside(current, "notSure")}>{t("analysis.workspace.questions.notSure", "Not sure")}</Button>
                    <Button size="sm" variant="ghost" icon={<Clock3 size={14} aria-hidden />} disabled={busy} onClick={() => aside(current, "later")}>{t("analysis.workspace.questions.later", "Later")}</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {history.length > 0 && (
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}
              className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-ink2 hover:text-ink">
              {t("analysis.workspace.questions.yourAnswers", "Your answers ({count})", { count: history.length })}<ChevronDown size={14} aria-hidden className={cn("transition", historyOpen && "rotate-180")} />
            </button>
          )}
          {historyOpen && <History rows={history} />}
          <PmSays>
            {reading ? t("analysis.workspace.questions.writing", "I'm writing my questions from your setup and files. They appear here one by one.")
              : completed ? t("analysis.workspace.questions.settled", "Thanks, that settles my questions.")
              : progress.total === 0 ? t("analysis.workspace.questions.noneOpen", "I have no open questions right now.")
              : t("analysis.workspace.questions.allForNow", "That's all my questions for now ({progress}).", { progress: progress.text.toLowerCase() })}
            {!completed && !reading && now.primary.kind === "prepare" && !now.stopped ? " " + t("analysis.workspace.questions.nextPrepare", "Next I'll prepare the first requirements from your answers.") : ""}
            {!completed && now.primary.kind === "preparing" ? " " + t("analysis.workspace.questions.preparing", "I'm preparing the first requirements from your answers.") : ""}
            {!completed && now.primary.kind === "confirm" ? " " + t("analysis.workspace.questions.firstReady", "The first requirements are ready. If you're happy with the answers, continue to review them.") : ""}
            {!completed && !reading && now.stopped ? " " + now.stopped.text : ""}
          </PmSays>
          {!completed && actionable && access.canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={now.primary.disabled || pending} onClick={onNext}>
                {pending ? t("analysis.workspace.working", "Working…") : now.primary.label}
              </Button>
            </div>
          )}
          {!completed && !access.canEdit && <TalkNote>{t("analysis.workspace.questions.teamConfirmsStep", "The project team confirms this step.")}</TalkNote>}
          {stepError != null && <TalkNote tone="danger">{sanitizationErrorText(stepError)}</TalkNote>}
        </>
      )}
      {error && <TalkNote tone="danger">{error}</TalkNote>}
    </div>
  );
}

/** What was answered or set aside, oldest first (read only here; changing an answer stays on the right). */
function History({ rows }: { rows: Row[] }) {
  const t = useT();
  return (
    <ol className="flex max-h-72 flex-col gap-2.5 overflow-y-auto rounded-block p-2.5 ring-1 ring-line">
      {rows.map((r) => (
        <li key={r.ItemId} className="flex flex-col gap-1.5">
          <p className="break-words text-[13px] text-ink2">{r.Question}</p>
          {r.Status === "answered" ? <YouSaid>{r.Answer ?? ""}</YouSaid>
            : <p className="text-right text-[12px] text-ink3">{/^not sure/i.test((r.DeferReason ?? "").trim()) ? t("analysis.workspace.questions.notSureYet", "Not sure yet") : t("analysis.workspace.questions.later", "Later")}</p>}
        </li>
      ))}
    </ol>
  );
}
