/** Open questions tab: the open or deferred Clarifications, read only. They are answered in Product sanitization. */
import { useT } from "@/i18n";
import { Link } from "react-router-dom";
import { ArrowRight, CircleQuestionMark } from "lucide-react";
import { useOpenClarifications } from "@/blocks/requirements/hooks";
import { FORMER_MEMBER, useMemberName, useProjectsContext } from "@/blocks/projects/context";
import { NAME_LOADING } from "@/blocks/context";
import { isPersonId, ownerShown } from "./ownerName";
import { Card, Chip } from "@/ui/kit";
import { LoadError } from "@/components/sanitization/shared";

export interface QuestionRow { id: string; question: string; status: string; owner?: string }

function OwnerLine({ owner }: { owner: string }) {
  const t = useT();
  const selfId = useProjectsContext().userId;
  const name = useMemberName(isPersonId(owner) ? owner.trim() : "");
  const shown = ownerShown(owner, { selfId, name: name === FORMER_MEMBER || name === NAME_LOADING ? "" : name });
  return shown ? <div className="mt-0.5 text-[13px] text-ink3">{t("analysis.requirements.owner", "Owner: {name}", { name: shown })}</div> : null;
}

export function QuestionsView({ projectId, questions, loading = false, onRetry }: {
  projectId: string; questions: QuestionRow[];
  /** While the read runs nothing is claimed; a failed read (onRetry given) offers a retry, never "No open questions." */
  loading?: boolean; onRetry?: () => void;
}) {
  const t = useT();
  return (
    <Card title={t("analysis.requirements.tabQuestions", "Open questions")} icon={<CircleQuestionMark size={18} strokeWidth={1.75} />}>
      {onRetry && questions.length === 0 ? (
        <LoadError onRetry={onRetry} />
      ) : loading && questions.length === 0 ? (
        <p role="status" className="text-[14px] leading-relaxed text-ink2">{t("analysis.requirements.loadingQuestions", "Loading the open questions…")}</p>
      ) : questions.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-ink2">{t("analysis.requirements.noOpenQuestions", "No open questions.")}</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-2 py-3">
              <div className="min-w-0 flex-1 basis-60">
                <div className="text-[15px] leading-snug [overflow-wrap:anywhere]">{q.question}</div>
                {q.owner && <OwnerLine owner={q.owner} />}
              </div>
              <Chip tone={q.status === "deferred" ? "neutral" : "warning"}>{q.status === "deferred" ? t("analysis.requirements.deferred", "Deferred") : t("analysis.requirements.open", "Open")}</Chip>
            </li>
          ))}
        </ul>
      )}
      <Link to={`/p/${projectId}/sanitization`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
        {t("analysis.requirements.answerInSanitization", "Answer in Understanding your project")} <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
      </Link>
    </Card>
  );
}

export function QuestionsTab({ projectId }: { projectId: string }) {
  const q = useOpenClarifications(projectId);
  const rows = (q.data ?? []).map((c) => ({
    id: String(c.id), question: c.question, status: String(c.status ?? "open"),
    owner: c.owner || undefined,
  }));
  return <QuestionsView projectId={projectId} questions={rows} loading={q.isPending}
    onRetry={q.isError ? () => void q.refetch() : undefined} />;
}
