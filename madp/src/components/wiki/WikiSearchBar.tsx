import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";
import type { WikiPage } from "@/data/wiki/types";
import { answerFromWiki, searchWiki, type WikiAnswer } from "@/data/wiki/search";
import { KBD } from "./useWiki";
import { IconButton } from "@/ui/kit";
import { AnswerCard } from "./AnswerCard";
import { useT } from "@/i18n";

/** "Search or ask about <project>…": typing filters (the parent does that from `query`), Enter shows an answer composed from the pages. */
export function WikiSearchBar({ projectName, pages, suggestions = [], loading = false, query, onQueryChange, onOpen }: {
  projectName: string;
  pages: WikiPage[];
  suggestions?: string[];
  /** True while the page bodies are still being read for a search. */
  loading?: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onOpen: (slug: string, sectionId: string) => void;
}) {
  const t = useT();
  const [answer, setAnswer] = useState<WikiAnswer | null>(null);
  const hintId = useId();
  const q = query.trim();

  const change = (v: string) => { onQueryChange(v); setAnswer(null); setAsked(null); };
  const [asked, setAsked] = useState<string | null>(null);
  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    if (loading) { setAsked(question); return; }
    setAnswer(answerFromWiki(pages, question));
  };
  useEffect(() => {
    if (asked !== null && !loading) { setAnswer(answerFromWiki(pages, asked)); setAsked(null); }
  }, [asked, loading, pages]);

  return (
    <div>
      <form role="search" aria-label={t("wiki.search.label", "Search or ask about {project}", { project: projectName })} onSubmit={(e) => { e.preventDefault(); ask(query); }}>
        <label className="flex h-12 items-center gap-3 rounded-full bg-surface px-5 text-ink3 shadow-card transition focus-within:ring-2 focus-within:ring-accent/40 dark:ring-1 dark:ring-line">
          <Search size={18} strokeWidth={1.75} className="shrink-0" />
          <input type="text" value={query} onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { onQueryChange(""); setAnswer(null); } }}
            aria-label={t("wiki.search.label", "Search or ask about {project}", { project: projectName })} aria-describedby={hintId}
            placeholder={t("wiki.search.placeholder", "Search or ask about {project}…", { project: projectName })}
            className="min-w-0 flex-1 text-ellipsis bg-transparent text-[14px] text-ink outline-none placeholder:text-ink3" />
          {query && <IconButton icon={<X size={16} strokeWidth={1.75} />} label={t("wiki.search.clear", "Clear the search")} className="h-8 w-8 bg-transparent dark:ring-0"
            onClick={() => change("")} />}
        </label>
        <p id={hintId} className="mt-2 px-2 text-[12px] text-ink3"><span className={KBD}>{t("wiki.search.enterKey", "Enter")}</span> {t("wiki.search.enterHint", "gets an answer from the wiki")}</p>
        {q && <span role="status" className="sr-only">{loading || asked !== null ? t("wiki.search.reading", "Reading the pages…") : (() => { const n = searchWiki(pages, q).length; return n === 1 ? t("wiki.search.matchOne", "1 page matches") : t("wiki.search.matchMany", "{count} pages match", { count: n }); })()}</span>}
      </form>
      {!answer && suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          <span className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("wiki.search.try", "Try")}</span>
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => { onQueryChange(s); ask(s); }}
              className="rounded-full bg-surface2 px-3 py-1.5 text-left text-[13px] text-ink2 hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              {s}
            </button>
          ))}
        </div>
      )}
      <div aria-live="polite">
        {answer && <AnswerCard answer={answer} onCite={onOpen} onClose={() => setAnswer(null)} />}
      </div>
    </div>
  );
}
