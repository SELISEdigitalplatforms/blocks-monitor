/** "Objective and the people who will use it": the analyst checks it knows what the project is for and who uses it.
 *  Missing or too thin → it asks, one question at a time, with a written answer. The same writes as today's panel
 *  (analysis/pm/BriefTalk.tsx): during Project Setup project.setup through useSetupProject (the guided start's answers
 *  with this one changed); after the hand-over clarification.answerBrief, one call that records the answer with the
 *  business analyst's own question in one write, where "What we understood" and the analysis read it. */
import { useState } from "react";
import { Send } from "lucide-react";
import type { ProjectRecord } from "@/blocks/projects/records";
import { useCan } from "@/blocks/projects/context";
import { useSetupProject } from "@/blocks/projects/mutations";
import { useAnswerBrief } from "@/blocks/sanitization/ops";
import { useStepAccess } from "@/blocks/sanitization/hooks";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { answersFromProject, toSetupArgs } from "@/domain/guidedStart";
import { Button, Textarea } from "@/ui/kit";
import { briefQuestions, isThin, myWords, sendsOnEnter } from "./analystModel";
import { AnalystSays, ErrorNote, Note, QuestionCard, YouSaid } from "./Talk";
import { useT } from "@/i18n";

const MAX = { goal: 2000, users: 1000 } as const;

export function BriefStep({ project, workspaceId, goal, users, missing, done }: {
  project: ProjectRecord; workspaceId: string | null; goal: string; users: string; missing: ("goal" | "users")[]; done: boolean;
}) {
  const t = useT();
  const q = briefQuestions(project.name);
  const inSetup = project.step === "business";
  const canSetup = useCan("project.edit");
  const access = useStepAccess({ workspaceId: workspaceId ?? "", projectId: project.id });
  const canAnswer = inSetup ? canSetup : access.canEdit;
  const setup = useSetupProject();
  const ctx = { workspaceId: workspaceId ?? "", projectId: project.id };
  const answerBrief = useAnswerBrief(ctx);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);

  if (done || missing.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <AnalystSays>{t("analysis.analyst.brief.whatIHave", "This is what I have on the objective and the people who will use it.")}</AnalystSays>
        <dl className="flex flex-col gap-1.5 rounded-block bg-surface2 px-4 py-3.5">
          <dt className="text-[12px] font-medium text-ink3">{t("analysis.workspace.brief.objective", "Objective")}</dt>
          <dd className="break-words text-[14px] leading-6 text-ink">{goal || t("analysis.workspace.brief.notWritten", "Not written down yet")}</dd>
          <dt className="mt-2 text-[12px] font-medium text-ink3">{t("analysis.analyst.brief.people", "The people who will use it")}</dt>
          <dd className="break-words text-[14px] leading-6 text-ink">{users || t("analysis.workspace.brief.notWritten", "Not written down yet")}</dd>
        </dl>
      </div>
    );
  }

  const asking = missing[0]!;
  const question = asking === "goal" ? q.goal : q.users;
  const text = draft.trim();

  const send = async () => {
    if (!text || busy) return;
    // the same rule that decides the brief is known: a word or two is not enough to work from
    if (isThin(text)) { setTooShort(true); return; }
    setBusy(true);
    setError(null);
    try {
      if (inSetup) {
        const a = answersFromProject(project);
        const next = asking === "goal" ? { ...a, goal: text.slice(0, MAX.goal), goalTags: [] } : { ...a, users: text.slice(0, MAX.users), userTags: [] };
        await setup.run(toSetupArgs(project.id, next, project.name));
      } else {
        await answerBrief.mutateAsync({ projectId: project.id, about: asking, answer: text.slice(0, MAX[asking]) });
      }
      setDraft("");
    } catch (e) {
      setError(myWords(sanitizationErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AnalystSays className="text-ink2">
        {asking === "goal"
          ? t("analysis.analyst.brief.beSure", "I'd like to be sure what this is for, in your own words.")
          : t("analysis.analyst.brief.oneMore", "Thank you. One more thing, so the analysis fits the people it is for.")}
      </AnalystSays>
      {asking === "users" && goal && <YouSaid>{goal}</YouSaid>}
      <QuestionCard question={question} label={question} action={!canAnswer}>
        {canAnswer ? (
          <div className="flex flex-col gap-2.5">
            <Textarea aria-label={question} value={draft} maxLength={MAX[asking]} data-analyst-action=""
              className="min-h-[96px] bg-surface text-[15px] ring-1 ring-line"
              placeholder={asking === "goal" ? t("analysis.workspace.brief.goalPlaceholder", "For example: let our customers book and pay for repairs online.") : t("analysis.workspace.brief.usersPlaceholder", "For example: our service desk, and customers on their phones.")}
              onChange={(e) => { setDraft(e.target.value); setTooShort(false); }}
              onKeyDown={(e) => { if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) { e.preventDefault(); void send(); } }} />
            {tooShort && <Note>{t("analysis.analyst.brief.tooShort", "Could you say a little more? A short sentence helps me more than a word or two.")}</Note>}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="md" variant="primary" icon={<Send size={15} aria-hidden />} disabled={!text || busy} onClick={() => void send()}>
                {busy ? t("analysis.workspace.saving", "Saving…") : t("analysis.analyst.answer", "Answer")}
              </Button>
              <span className="hidden text-[12px] text-ink3 sm:inline">{t("analysis.analyst.enterSends", "Enter sends · Shift + Enter for a new line")}</span>
            </div>
            {error && <ErrorNote text={error} busy={busy} onRetry={() => void send()} />}
          </div>
        ) : (
          <Note>{t("analysis.analyst.someoneAnswers", "Someone on the project team with edit rights answers this.")}</Note>
        )}
      </QuestionCard>
    </div>
  );
}
