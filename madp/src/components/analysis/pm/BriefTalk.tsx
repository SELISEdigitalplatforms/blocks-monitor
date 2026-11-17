/** "Objective and end users": the business analyst checks it knows what the project is for and who uses it.
 *  Missing or too thin → it asks, one question at a time, with a text answer. While the project is still in Project
 *  Setup the answer is saved exactly like Project Setup saves it (project.setup through useSetupProject, the guided
 *  start's answers). After the hand-over that op refuses (project.setupLocked), so the answer is recorded with the
 *  business analyst's questions in one write (clarification.answerBrief), where the analysis reads it. */
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
import { briefQuestions } from "./pmModel";
import { PmSays, TalkNote, YouSaid } from "./Talk";
import { useT } from "@/i18n";

const MAX = { goal: 2000, users: 1000 } as const;

export function BriefTalk({ project, workspaceId, goal, users, missing, done }: {
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

  if (done || missing.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PmSays>{t("analysis.workspace.brief.taken", "From your description I took the objective and the people who will use it. Tell me if either is off; you can change them in Project Setup.")}</PmSays>
        <dl className="flex flex-col gap-2 rounded-block px-3.5 py-3 ring-1 ring-line">
          <dt className="text-[12px] font-medium uppercase tracking-wide text-ink3">{t("analysis.workspace.brief.objective", "Objective")}</dt>
          <dd className="break-words text-[14px] text-ink">{goal || t("analysis.workspace.brief.notWritten", "Not written down yet")}</dd>
          <dt className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink3">{t("analysis.workspace.brief.endUsers", "End users")}</dt>
          <dd className="break-words text-[14px] text-ink">{users || t("analysis.workspace.brief.notWritten", "Not written down yet")}</dd>
        </dl>
      </div>
    );
  }

  const asking = missing[0]!;
  const question = asking === "goal" ? q.goal : q.users;
  const text = draft.trim();

  const send = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (inSetup) {
        // the same write as Project Setup: the guided start's answers, with this one changed
        const a = answersFromProject(project);
        const next = asking === "goal" ? { ...a, goal: text.slice(0, MAX.goal), goalTags: [] } : { ...a, users: text.slice(0, MAX.users), userTags: [] };
        await setup.run(toSetupArgs(project.id, next, project.name));
      } else {
        await answerBrief.mutateAsync({ projectId: project.id, about: asking, answer: text.slice(0, MAX[asking]) });
      }
      setDraft("");
    } catch (e) {
      setError(sanitizationErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PmSays>
        {asking === "goal"
          ? t("analysis.workspace.brief.beforeWriting", "Before I write anything, I want to be sure what this is for.")
          : t("analysis.workspace.brief.oneMore", "Thanks. One more thing so the analysis fits the people it is for.")}
      </PmSays>
      {asking === "users" && goal && <YouSaid>{goal}</YouSaid>}
      <PmSays><span className="font-medium">{question}</span></PmSays>
      {canAnswer ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={question} value={draft} maxLength={MAX[asking]} className="min-h-[84px] bg-surface ring-1 ring-line"
            placeholder={asking === "goal" ? t("analysis.workspace.brief.goalPlaceholder", "For example: let our customers book and pay for repairs online.") : t("analysis.workspace.brief.usersPlaceholder", "For example: our service desk, and customers on their phones.")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={<Send size={14} aria-hidden />} disabled={!text || busy} onClick={() => void send()}>
              {busy ? t("analysis.workspace.saving", "Saving…") : t("analysis.workspace.sendAnswer", "Send answer")}
            </Button>
            <span className="hidden text-[12px] text-ink3 sm:inline">{t("analysis.workspace.ctrlEnterSends", "Ctrl + Enter sends")}</span>
          </div>
          {error && <TalkNote tone="danger">{error}</TalkNote>}
        </div>
      ) : (
        <TalkNote>{t("analysis.workspace.brief.teamAnswers", "The project team answers this.")}</TalkNote>
      )}
    </div>
  );
}
