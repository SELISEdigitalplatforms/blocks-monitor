/** "Questions still open": only what your files ask and your answers do not settle yet. The business analyst asks you
 *  these on the next step, one at a time. */
import { useT } from "@/i18n";
import { HelpCircle } from "lucide-react";
import { Card } from "@/ui/kit";
import type { BriefQuestion } from "./briefApi";

export function QuestionsCard({ questions, nextLabel }: { questions: readonly BriefQuestion[]; nextLabel: string }) {
  const t = useT();
  if (!questions.length) return null;
  return (
    <Card title={t("analysis.understanding.questionsTitle", "Questions still open")} icon={<HelpCircle size={18} strokeWidth={1.75} />}>
      <p className="mb-3 text-[13px] text-ink2">{t("analysis.understanding.questionsIntro", "Your business analyst asks you these in {step}, one at a time. Nothing to do here.", { step: nextLabel })}</p>
      <ul className="flex flex-col gap-2">
        {questions.map((q) => (
          <li key={q.key} className="rounded-block bg-surface2 px-4 py-3">
            <p className="break-words text-[15px] leading-snug text-ink">{q.question}</p>
            {q.context && <p className="mt-0.5 text-[12px] text-ink3">{q.context}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
