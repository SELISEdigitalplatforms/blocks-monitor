/** The search box above the tree: names at once, note bodies after the first search. Results are a listbox. */
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/ui/kit";
import { useDocSearch } from "@/blocks/projects/docReads";
import { messageFor } from "@/blocks/projects/messages";
import type { DocItemKind, SearchHit } from "../../domain/docs";
import { folderKindIcon, NOTE_ICON, fileIconFor } from "./icons";
import { useT } from "@/i18n";

export interface DocSearchProps {
  projectId: string;
  onOpen: (id: string) => void;
  /** The results float under the field (a toolbar search) instead of pushing the content down. */
  floating?: boolean;
  className?: string;
}

/** Text with the given [start, end) ranges wrapped in <mark>, built from text nodes only. */
export function highlight(text: string, ranges: readonly (readonly [number, number])[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    const s = Math.max(a, at);
    const e = Math.min(b, text.length);
    if (e <= s) return;
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i} className="rounded-sm bg-accent-soft text-ink">{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function hitPath(h: Pick<SearchHit, "path">): string {
  const p: unknown = h.path;
  return Array.isArray(p) ? p.join(" / ") : typeof p === "string" ? p : "";
}

function HitIcon({ kind, title }: { kind: DocItemKind; title: string }) {
  const Icon = kind === "folder" ? folderKindIcon("other") : kind === "note" ? NOTE_ICON : fileIconFor({ name: title, mime: "" });
  return <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink2" aria-hidden />;
}

/** The results block (separate so it renders without a search box). */
export function SearchResults({ hits, query, bodiesLoading, error, active, listId, onOpen, onHover }: {
  hits: readonly SearchHit[]; query: string; bodiesLoading: boolean; error: unknown; active: number; listId: string;
  onOpen: (id: string) => void; onHover?: (i: number) => void;
}) {
  const t = useT();
  return (
    <div className="mt-3">
      {bodiesLoading && <p role="status" aria-live="polite" className="px-1 pb-2 text-[13px] text-ink3">{t("analysis.business.search.searchingNotes", "Searching notes…")}</p>}
      {error ? <p role="alert" className="px-1 pb-2 text-[13px] text-danger">{messageFor(error)}</p> : null}
      {hits.length > 0 ? (
        <ul id={listId} role="listbox" aria-label={t("analysis.business.search.results", "Search results")} className="flex flex-col gap-1">
          {hits.map((h, i) => {
            const path = hitPath(h);
            return (
              <li key={`${h.kind}-${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => onHover?.(i)} onClick={() => onOpen(h.id)}
                className={`flex cursor-pointer gap-3 rounded-block px-3 py-2.5 text-[14px] transition hover:bg-surface2 ${i === active ? "bg-surface2" : ""}`}>
                <HitIcon kind={h.kind} title={h.title} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium text-ink">{highlight(h.title, h.titleRanges)}</span>
                  {path && <span className="block break-words text-[12px] text-ink3">{path}</span>}
                  {h.snippet && <span className="mt-0.5 block break-words text-[13px] text-ink2">{highlight(h.snippet, h.snippetRanges)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        !bodiesLoading && !error && query.trim() !== "" && <p role="status" className="px-1 text-[13px] text-ink2">{t("analysis.business.search.noMatches", "No matches for '{query}'", { query: query.trim() })}</p>
      )}
    </div>
  );
}

export function DocSearch({ projectId, onOpen, floating, className }: DocSearchProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const { hits, bodiesLoading, error } = useDocSearch(projectId, query);
  const wanted = query.trim() !== "";

  const [shown, setShown] = useState(true);
  const open = (id: string) => { onOpen(id); if (floating) { setQuery(""); } };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); open(hits[Math.min(active, hits.length - 1)].id); }
  };

  return (
    <div className={floating ? `relative ${className ?? ""}` : className}
      onFocus={() => setShown(true)}
      onBlur={(e) => { if (floating && !e.currentTarget.contains(e.relatedTarget as Node | null)) setShown(false); }}>
      <div className="relative">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
        <Input type="search" aria-label={t("analysis.business.search.aria", "Search business material")} placeholder={floating ? t("analysis.business.search.placeholderShort", "Search your material") : t("analysis.business.search.placeholder", "Search folders, notes and files")} value={query}
          aria-controls={hits.length ? listId : undefined} aria-activedescendant={hits.length ? `${listId}-${Math.min(active, hits.length - 1)}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} className="pl-10" />
      </div>
      {wanted && (floating ? shown && (
        <div tabIndex={-1} className="scroll-thin absolute right-0 top-full z-30 mt-1 max-h-[min(420px,60dvh)] w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-card bg-surface p-2 shadow-float ring-1 ring-line [&>div]:mt-0">
          <SearchResults hits={hits} query={query} bodiesLoading={bodiesLoading} error={error} active={active} listId={listId} onOpen={open} onHover={setActive} />
        </div>
      ) : <SearchResults hits={hits} query={query} bodiesLoading={bodiesLoading} error={error} active={active} listId={listId} onOpen={open} onHover={setActive} />)}
    </div>
  );
}
