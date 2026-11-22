/** The page tree of a wiki: pages in their groups, the open page marked, and (while searching) only the matches. */
import { Link } from "react-router-dom";
import { wikiGroupLabel } from "./groupLabel";
import { WIKI_GROUPS, type WikiPage } from "@/data/wiki/types";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/ui/kit";
import { useT } from "@/i18n";

export function WikiTree({ pages, activeSlug, matches, onPick }: {
  pages: WikiPage[]; activeSlug: string; matches: Set<string> | null; onPick?: () => void;
}) {
  const t = useT();
  const groups = WIKI_GROUPS
    .map((g) => ({ ...g, items: pages.filter((p) => p.group === g.id && (!matches || matches.has(p.slug))).sort((a, b) => a.order - b.order) }))
    .filter((g) => g.items.length > 0);
  if (matches && groups.length === 0) return <EmptyState title={t("wiki.tree.noMatchTitle", "No page matches")} text={t("wiki.tree.noMatchText", "Try another word.")} />;
  return (
    <nav aria-label={t("wiki.tree.label", "Wiki pages")} className="flex flex-col">
      {groups.map((g) => (
        <div key={g.id} className="mt-4 first:mt-0">
          <div className="mb-2 flex items-baseline justify-between px-3 text-[12px] font-medium uppercase leading-4 tracking-wider text-ink3">
            <span>{wikiGroupLabel(g.id)}</span><span className="num">{g.items.length}</span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((p) => {
              const here = p.slug === activeSlug;
              return (
                <li key={p.slug}>
                  <Link to={`?page=${p.slug}`} aria-current={here ? "page" : undefined} onClick={onPick}
                    className={cn("relative flex min-h-[38px] items-center rounded-block px-3 py-1.5 text-[14px] leading-5 outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                      here ? "bg-surface2 font-medium text-ink" : "text-ink2 hover:bg-surface2 hover:text-ink")}>
                    {here && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
