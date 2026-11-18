/** A project's wiki (/p/:id/wiki): the page tree on the left, the open page in the centre, search and questions on
 *  top. Below lg the tree folds behind a toggle. The team writes pages from the project's records; people add and edit
 *  their own. */
import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, Factory, Plus } from "lucide-react";
import { WikiArticle } from "@/madp/components/wiki/WikiArticle";
import { WikiEmpty, WikiJobLine, useWikiGenerate } from "@/madp/components/wiki/WikiEmpty";
import { WikiSearchBar } from "@/madp/components/wiki/WikiSearchBar";
import { WikiEditModal } from "@/madp/components/wiki/WikiEditor";
import { WikiHistoryDrawer } from "@/madp/components/wiki/WikiHistoryDrawer";
import { WikiCreateDialog, WikiDeleteDialog, WikiRenameDialog } from "@/madp/components/wiki/WikiPageDialogs";
import { WikiTree } from "@/madp/components/wiki/WikiTree";
import { reducedMotion, useCanEditWiki, useOpenPage, useWikiData, wikiEyebrow } from "@/madp/components/wiki/useWiki";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { useWikiBodies } from "@/madp/blocks/collab/wiki";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { useProject } from "@/madp/blocks/projects";
import { searchWiki } from "@/madp/data/wiki/search";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { cn } from "@/madp/lib/cn";
import { Banner, Button, Card, EmptyState, PageHeader } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

/** The wiki of a project that is only stored in this browser. */
export function LocalWikiNote() {
  const t = useT();
  return (
    <div className="flex w-full min-w-0 flex-col">
      <Card>
        <EmptyState icon={<BookOpen size={28} />} title={t("wiki.view.localTitle", "This wiki opens for projects saved in your workspace.")} text={t("wiki.view.localText", "Open the project from your projects list.")}
          action={<Link to="/projects" className="inline-flex h-10 items-center rounded-full bg-surface2 px-5 text-[14px] font-medium text-ink outline-none hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50">{t("wiki.view.goToProjects", "Go to projects")}</Link>} />
      </Card>
    </div>
  );
}

export function WikiView({ projectId }: { projectId: string }) {
  if (!isBlocksProjectId(projectId)) return <LocalWikiNote />;
  return <BlocksWiki projectId={projectId} />;
}

function BlocksWiki({ projectId }: { projectId: string }) {
  const t = useT();
  const canEdit = useCanEditWiki();
  const project = useProject(projectId);
  const { pages, loading, error, refetch } = useWikiData(projectId);
  const gen = useWikiGenerate(projectId);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState(false);
  const [flash, setFlash] = useState<{ id: string | null; n: number }>({ id: null, n: 0 });
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const treeId = useId();

  const searching = query.trim() !== "";
  const bodies = useWikiBodies(projectId, searching);
  const pool = bodies.data ?? [];
  const matches = useMemo(() => (searching && bodies.data ? new Set(searchWiki(pool, query).map((h) => h.slug)) : null), [searching, bodies.data, pool, query]);
  const wanted = params.get("page");
  const treePage = pages.find((p) => p.slug === wanted) ?? (matches ? pages.find((p) => matches.has(p.slug)) : undefined) ?? pages[0];
  const open = useOpenPage(treePage);
  const page = open.page;
  const slug = treePage?.slug ?? "";
  const section = params.get("section") ?? "";
  const cite = params.get("cite") === "1";

  useEffect(() => {
    if (!section || !page) return;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-wiki-section="${CSS.escape(section)}"]`);
      el?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      if (cite) setFlash((f) => ({ id: section, n: f.n + 1 }));
      setParams((p) => { const n = new URLSearchParams(p); n.delete("section"); n.delete("cite"); return n; }, { replace: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [slug, section, cite, setParams, page]);

  const onOpen = (to: string, sectionId: string) => setParams({ page: to, ...(sectionId ? { section: sectionId, cite: "1" } : {}) });

  if (project.isLoading || (loading && pages.length === 0)) {
    return <div className="flex w-full min-w-0 flex-col"><Card><div aria-hidden className="hatched h-40 rounded-block bg-surface2/60" /></Card></div>;
  }
  if (!project.data) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <Card><EmptyState icon={<BookOpen size={28} />} title={t("wiki.view.notFoundTitle", "We couldn't find this project")} text={t("wiki.view.notFoundText", "It may have been deleted or you may not have access. Pick a project from the Wiki page.")} /></Card>
      </div>
    );
  }
  const name = project.data.name;
  const empty = pages.length === 0;

  const actions = canEdit && !empty ? (
    <>
      <Button variant="secondary" icon={<Factory size={16} strokeWidth={1.75} aria-hidden />} disabled={gen.active || gen.requesting} onClick={gen.start}>
        {gen.requesting ? t("wiki.common.starting", "Starting…") : t("wiki.view.update", "Update the wiki")}
      </Button>
      <Button variant="ghost" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setAdding(true)}>{t("wiki.common.addPage", "Add a page")}</Button>
    </>
  ) : undefined;

  return (
    <div className="flex w-full min-w-0 flex-col">
      <PageHeader eyebrow={wikiEyebrow(name, project.data.clientName)} title={t("wiki.view.title", "Wiki")}
        subtitle={t("wiki.view.subtitle", "The handbook for {project}: what it does, how it works and what changed.", { project: name })} actions={actions} />
      {!canEdit && <ViewOnlyNote id="wiki-view-only" className="-mt-4 mb-6" />}
      {!empty && <WikiJobLine gen={gen} canEdit={canEdit} />}
      {error && (
        <Banner tone="danger" title={t("wiki.view.loadFailed", "We couldn't load the wiki.")} text={collabErrorMessage(error)} className="mb-6"
          action={<Button size="sm" variant="ghost" onClick={refetch}>{t("wiki.common.tryAgain", "Try again")}</Button>} />
      )}
      {empty ? (
        <WikiEmpty projectId={projectId} canEdit={canEdit} gen={gen} onAdd={() => setAdding(true)} />
      ) : (
        <>
          <div className="mb-6">
            <WikiSearchBar projectName={name} pages={pool} loading={searching && bodies.isLoading} query={query} onQueryChange={setQuery} onOpen={onOpen} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="min-w-0 lg:sticky lg:top-[calc(var(--project-nav-h,var(--topbar-h,0px))_+_1.5rem)] lg:self-start">
              <button type="button" aria-expanded={folded} aria-controls={treeId} onClick={() => setFolded((v) => !v)}
                className="flex w-full items-center justify-between rounded-card bg-surface px-5 py-3 text-[14px] font-medium shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:ring-1 dark:ring-line lg:hidden">
                <span>{t("wiki.view.pagesToggle", "Pages")} · <span className="num">{pages.length}</span></span>
                <ChevronDown size={16} className={cn("transition", folded && "rotate-180")} aria-hidden />
              </button>
              <div id={treeId} className={cn("mt-3 lg:mt-0 lg:block", folded ? "block" : "hidden")}>
                <Card bodyClassName="px-4 pb-4 pt-6" className="lg:max-h-[calc(100vh_-_var(--project-nav-h,var(--topbar-h,0px))_-_3rem)] lg:overflow-y-auto scroll-wiki [scrollbar-gutter:stable]">
                  <WikiTree pages={pages} activeSlug={slug} matches={matches} onPick={() => setFolded(false)} />
                </Card>
              </div>
            </aside>
            <div className="min-w-0">
              {page ? (
                <WikiArticle page={page} projectId={projectId} projectName={name} highlight={query} flashSection={flash.id} flashKey={flash.n}
                  canEdit={canEdit} onEdit={() => setEditing(true)} onHistory={() => setHistory(true)}
                  onRename={() => setRenaming(true)} onDelete={() => setDeleting(true)} />
              ) : open.error ? (
                <Card><p role="alert" className="text-[14px] text-danger">{collabErrorMessage(open.error)}</p></Card>
              ) : (
                <Card><div aria-hidden className="hatched h-40 rounded-block bg-surface2/60" /></Card>
              )}
            </div>
          </div>
        </>
      )}
      <WikiCreateDialog projectId={projectId} open={adding} onClose={() => setAdding(false)} onCreated={(s) => setParams({ page: s })} />
      <WikiEditModal page={editing ? page ?? null : null} onClose={() => setEditing(false)} />
      <WikiRenameDialog page={renaming ? page ?? null : null} onClose={() => setRenaming(false)} />
      <WikiDeleteDialog page={deleting ? page ?? null : null} onClose={() => setDeleting(false)} onDeleted={() => setParams({})} />
      <WikiHistoryDrawer page={history ? page ?? null : null} canEdit={canEdit} onClose={() => setHistory(false)} />
    </div>
  );
}
