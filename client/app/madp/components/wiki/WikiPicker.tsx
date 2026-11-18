/** Wiki: pick a project to open its handbook. Only projects stored in the workspace are listed. Cards show the
 *  project, the step it is at (one of the four) and how many pages its wiki has. */
import { openGuidedStart } from "@/madp/components/guided/store";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Search } from "lucide-react";
import { useProjectList, useProjectListCap } from "@/madp/blocks/projects";
import { useCanDo } from "@/madp/components/home/projects/ProjectActionsMenu";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { useWikiPageCounts } from "@/madp/blocks/collab/wiki";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { phaseLabelOf } from "@/madp/domain/phases";
import { Banner, Button, Card, Chip, EmptyState, Input, PageHeader } from "@/madp/ui/kit";
import { useCulture, useT } from "@/madp/i18n";

export function WikiPicker() {
  const t = useT();
  const culture = useCulture();
  const numberLocale = culture === "de-CH" ? "de-CH" : undefined;
  const projects = useProjectList();
  const cap = useProjectListCap();
  const counts = useWikiPageCounts();
  // only people who may start a project are offered to (as on Projects and the Dashboard)
  const ready = useWorkspaces((s) => s.ready);
  const canCreate = useCanDo("project.create") && ready;
  const [query, setQuery] = useState("");
  const q = query.trim();

  const list = useMemo(() => (projects.data ?? []).filter((p) => p.status !== "deleting"), [projects.data]);
  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return list;
    return list.filter((p) => [p.name, p.clientName, p.clientRegion, p.clientIndustry].some((v) => v?.toLowerCase().includes(needle)));
  }, [list, q]);

  return (
    <div className="flex w-full min-w-0 flex-col pb-4">
      <PageHeader title={t("wiki.picker.title", "Wiki")} subtitle={t("wiki.picker.subtitle", "Each project's handbook: what it does, how it works and what changed. Pick a project to open it.")} />

      {projects.error ? (
        <Banner tone="danger" title={t("wiki.picker.loadFailed", "We couldn't load your projects.")} text={collabErrorMessage(projects.error)}
          action={<Button size="sm" variant="ghost" onClick={() => void projects.refetch()}>{t("wiki.common.tryAgain", "Try again")}</Button>} />
      ) : projects.isLoading ? (
        <Card><div aria-hidden className="hatched h-40 rounded-block bg-surface2/60" /></Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen size={28} strokeWidth={1.5} />} title={t("wiki.picker.emptyTitle", "No wikis yet")}
            text={t("wiki.picker.emptyText", "Each project gets a wiki, written as its work goes on. Start a project and its wiki appears here.")}
            action={canCreate ? <Button variant="primary" onClick={() => openGuidedStart()}>{t("wiki.picker.newProject", "New project")}</Button> : undefined} />
        </Card>
      ) : (
        <>
          <label className="relative mb-6 block max-w-md">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <Input aria-label={t("wiki.picker.searchAria", "Search projects")} placeholder={t("wiki.picker.searchPlaceholder", "Search projects…")} value={query} className="pl-10"
              onChange={(e) => setQuery(e.target.value)} />
          </label>
          {cap.capped && (
            <p className="mb-4 text-[13px] text-ink3">
              {t("wiki.picker.capped", "Showing the {limit} most recently updated of {total} projects.", { limit: cap.limit.toLocaleString(numberLocale), total: cap.totalCount.toLocaleString(numberLocale) })}
            </p>
          )}
          {counts.error && <Banner tone="warning" title={t("wiki.picker.countFailed", "We couldn't count the pages right now. Every wiki still opens.")} className="mb-6" />}
          {shown.length === 0 ? (
            <Card><EmptyState icon={<Search size={28} strokeWidth={1.5} />} title={t("wiki.picker.noMatchTitle", "No project matches “{query}”", { query: q })} text={t("wiki.picker.noMatchText", "Try another word, or clear the search.")} /></Card>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {shown.map((p) => {
                const n = counts.data?.get(p.id) ?? 0;
                return (
                  <Card key={p.id} className="relative transition focus-within:ring-2 focus-within:ring-accent/50">
                    <div className="min-w-0">
                      <div className="break-words text-[15px] font-medium leading-snug">{p.name}</div>
                      <div className="break-words text-[13px] text-ink3">{[p.clientName, p.clientRegion].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Chip tone="accent">{phaseLabelOf(p.step)}</Chip>
                      <span className="num text-[13px] text-ink2">{counts.data
                        ? (n === 1 ? t("wiki.picker.pageCountOne", "1 page") : t("wiki.picker.pageCount", "{count} pages", { count: n }))
                        : t("wiki.picker.pageCountUnknown", "– pages")}</span>
                    </div>
                    <Link to={`/p/${p.id}/wiki`} aria-label={t("wiki.picker.openAria", "Open the wiki of {name}", { name: p.name })}
                      className="mt-5 inline-flex items-center gap-2 rounded-block text-[14px] font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-card">
                      <BookOpen size={16} /> {t("wiki.picker.open", "Open the wiki")}
                    </Link>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
