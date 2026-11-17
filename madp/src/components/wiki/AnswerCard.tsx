import { FileText, TextSearch, X } from "lucide-react";
import type { WikiAnswer } from "@/data/wiki/search";
import { Card, IconButton, Label } from "@/ui/kit";
import { useT } from "@/i18n";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function sourceName(pageTitle: string, heading: string) {
  return heading !== pageTitle ? `${pageTitle} › ${heading}` : pageTitle;
}

/** A documentation search result composed from wiki pages: short paragraphs with numbered citations to the exact sections. */
export function AnswerCard({ answer, onCite, onClose }: {
  answer: WikiAnswer;
  onCite: (slug: string, sectionId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const byN = new Map(answer.citations.map((c) => [c.n, c]));
  return (
    <Card className="mt-4" title={t("wiki.answer.title", "Answer from the wiki")} icon={<TextSearch size={18} strokeWidth={1.75} />}
      action={<IconButton icon={<X size={18} strokeWidth={1.75} />} label={t("wiki.answer.close", "Close the answer")} onClick={onClose} />}>
      <p className="text-[13px] text-ink3">{t("wiki.answer.question", "Question: {question}", { question: answer.question })}</p>
      {answer.found ? (
        <>
          {answer.paragraphs.map((p, i) => (
            <p key={i} className="mt-3 max-w-[72ch] text-[15px] leading-7 text-ink2">
              {p.text}
              {p.cites.map((n) => {
                const c = byN.get(n);
                if (!c) return null;
                return (
                  <button key={n} type="button" onClick={() => onCite(c.slug, c.sectionId)}
                    aria-label={t("wiki.answer.sourceAria", "Source {n}: {name}", { n, name: sourceName(c.pageTitle, c.heading) })}
                    className={`num ml-1 align-super text-[11px] text-[rgb(var(--c-accent-text))] ${FOCUS} rounded`}>
                    [{n}]
                  </button>
                );
              })}
            </p>
          ))}
          <div className="mt-5">
            <Label>{t("wiki.answer.sources", "Sources")}</Label>
            <ol className="flex flex-col items-start gap-1">
              {answer.citations.map((c) => (
                <li key={c.n} className="max-w-full">
                  <button type="button" onClick={() => onCite(c.slug, c.sectionId)}
                    className={`flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-ink2 hover:bg-surface2 hover:text-ink ${FOCUS}`}>
                    <FileText size={16} strokeWidth={1.75} className="shrink-0" />
                    <span className="min-w-0 break-words"><span className="num">{c.n}</span> · {sourceName(c.pageTitle, c.heading)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <p className="mt-3 max-w-[72ch] text-[15px] leading-7 text-ink2">{t("wiki.answer.none", "The wiki has no answer to this yet. Try other words, or open a page from the list.")}</p>
      )}
    </Card>
  );
}
