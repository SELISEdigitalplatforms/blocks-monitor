/** Projects: the workspace's projects and, for each, where it stands in plain words: the step, who is working on it
 *  and what is waiting for you. Shown as a grid of cards (the default) or a list (a table row from lg up, one stacked card
 *  below), the choice remembered per browser. A project opens its current step; each has quick actions (Docs, Tests,
 *  Watch the build, for where it stands: buttons on a card, the first group of the ⋯ menu in the list) and a small
 *  menu to open it, open its Wiki, rename or delete it.
 *  Delete closes its dialog at once; the row shows "Deleting…" until the server answers, and comes back with a message if it refuses. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import {
  messageFor, useDeleteProject, useMemberName, useProjectList,
  useProjectListCap, useProjectsContext, useRenameProject, type ProjectRecord,
} from "@/madp/blocks/projects";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { checkProjectName } from "@/madp/domain/projects";
import { projectActivityAt, projectsByActivity } from "@/madp/domain/dashboard";
import { PHASE_COUNT, phaseNumber } from "@/madp/domain/phases";
import { phaseNameOf } from "@/madp/components/project/stepNames";
import { openSlugOf, preloadStepChunk, prefetchProjectStep } from "@/madp/components/project/stepPrefetch";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { viewerTip } from "@/madp/data/rbac";
import { Banner, Button, Card, Chip, EmptyState, Input, Label, Modal, PageHeader } from "@/madp/ui/kit";
import { TypeChip } from "@/madp/components/project/TypeChip";
import { cn } from "@/madp/lib/cn";
import { openGuidedStart } from "@/madp/components/guided/store";
import type { ProjectNow } from "@/madp/domain/projectNow";
import { useProjectsNow, WaitingChips, WorkingLine } from "./ProjectNowParts";
import { buildingProjects, latestReleases, quickActions, relativeTime } from "./projects/projectCards";
import { ProjectActionsMenu as ActionsMenu, useCanDo, type ProjectActions as Actions } from "./projects/ProjectActionsMenu";
import { ProjectGrid, ProjectGridSkeleton } from "./projects/ProjectGrid";
import { useProjectsView, ViewToggle } from "./projects/ViewToggle";
import { t, useT } from "@/madp/i18n";
import { prefixPath } from "@/madp/lib/pathPrefix";

export { relativeTime };

const where = (p: ProjectRecord) => [p.clientName, p.clientRegion].filter(Boolean).join(" · ");

/** The error text of a name check: null when the name is fine (the check may answer a message, or {ok, error}). */
function nameProblem(name: string): string | null {
  const r = checkProjectName(name) as unknown;
  if (r === null || r === undefined || r === true) return null;
  if (typeof r === "string") return r;
  if (typeof r === "object") {
    const o = r as { ok?: boolean; error?: string; message?: string };
    if (o.ok === false || o.error) return o.error ?? o.message ?? t("shell.projects.nameProblem", "Enter a name of 1 to 80 characters.");
  }
  return null;
}

/** Pointer or keyboard focus on a project: load its step chunk and start its first-paint reads. */
function useWarmProject(): (p: ProjectRecord) => void {
  const client = useQueryClient();
  const { workspaceId } = useProjectsContext();
  return (p) => {
    if (p.status === "deleting") return;
    // the page the project opens on (an analysis step opens the Business Analysis page), not the stored step's old slug
    const slug = openSlugOf(p.step);
    preloadStepChunk(slug);
    if (workspaceId) prefetchProjectStep(client, workspaceId, p.id, slug);
  };
}

/** "New project" opens the guided project start over the page; nothing is created until its last step. */
function useCreate() {
  const create = async () => { openGuidedStart(); };
  return { creating: false, error: null as string | null, create };
}

/** A notice handed over by a redirect (location state); kept once, then cleared from the history entry. */
function useNotice(): [string | null, () => void] {
  const { state, pathname, search } = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(() => {
    const n = (state as { notice?: unknown } | null)?.notice;
    return typeof n === "string" ? n : null;
  });
  useEffect(() => {
    if (state !== null && state !== undefined && typeof (state as { notice?: unknown }).notice === "string") {
      navigate(pathname + search, { replace: true, state: null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [notice, () => setNotice(null)];
}

export function ProjectsView() {
  useT();
  const navigate = useNavigate();
  const query = useProjectList();
  const cap = useProjectListCap();
  const { creating, error, create } = useCreate();
  const ready = useWorkspaces((s) => s.ready);
  const canCreate = useCanDo("project.create");
  const [notice, dismissNotice] = useNotice();
  const noteId = useId();
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const deleter = useDeleteProject();
  const [deleteFailure, setDeleteFailure] = useState<DeleteFailure | null>(null);
  const failure = error ?? (query.isError ? messageFor(query.error) : null);
  const confirmDelete = () => {
    if (!deleting) return;
    startDelete(deleter.run, deleting, { close: () => setDeleting(null), clear: () => setDeleteFailure(null), fail: setDeleteFailure });
  };
  const warm = useWarmProject();
  const { now, records, activity } = useProjectsNow();
  // newest first: by each project's latest activity (a new release, job, change or done task moves it up)
  const items = useMemo(() => projectsByActivity((query.data ?? []).filter((p) => p.status === "active" || p.status === "deleting"), activity), [query.data, activity]);
  const building = useMemo(() => buildingProjects(records.jobs), [records.jobs]);
  const releases = useMemo(() => latestReleases(records.projects, records.releases), [records.projects, records.releases]);
  const [view, setView] = useProjectsView();
  const act: Actions = { onOpen: (p: ProjectRecord) => navigate(prefixPath(`/p/${p.id}`)), onWarm: warm, onRename: setRenaming, onDelete: setDeleting, now, building, releases, activity };

  return (
    <div className="pb-4">
      <PageHeader title={t("shell.projects.title", "Projects")} subtitle={t("shell.projects.subtitle", "Every project: the step it is at, who is working on it and what is waiting for you.")}
        actions={!query.isPending && items.length > 0 ? (<>
          <ViewToggle value={view} onChange={setView} />
          <div className="flex flex-col items-end gap-1">
            <Button variant="primary" disabled={creating || !ready || !canCreate} aria-busy={!ready || undefined} title={ready && !canCreate ? viewerTip() : undefined}
              aria-describedby={ready && !canCreate ? noteId : undefined} icon={<Plus size={16} strokeWidth={2} />} onClick={() => void create()}>{t("shell.projects.newProject", "New project")}</Button>
            {ready && !canCreate && <ViewOnlyNote id={noteId} text={viewerTip()} />}
          </div>
        </>) : undefined} />

      {notice && (
        <Banner tone="warning" title={notice} className="mb-6"
          action={<Button size="sm" variant="ghost" onClick={dismissNotice}>{t("common.actions.dismiss", "Dismiss")}</Button>} />
      )}

      {failure && (
        <Banner tone="danger" title={t("shell.projects.loadFailed", "We couldn't load your projects.")} text={failure} className="mb-6"
          action={query.isError ? <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("common.actions.tryAgain", "Try again")}</Button> : undefined} />
      )}

      {deleteFailure && (
        <div className="mb-6 flex items-center justify-between gap-3">
          <p role="alert" className="text-[13px] text-danger">{t("shell.projects.deleteFailed", "Couldn't delete '{name}'. {message}", { name: deleteFailure.name, message: deleteFailure.message })}</p>
          <Button size="sm" variant="ghost" onClick={() => setDeleteFailure(null)}>{t("common.actions.dismiss", "Dismiss")}</Button>
        </div>
      )}

      {query.isPending ? (
        view === "grid" ? <ProjectGridSkeleton /> : <Card><div aria-hidden className="hatched h-40 rounded-block bg-surface2/60" /></Card>
      ) : query.isError ? null : items.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderKanban size={28} strokeWidth={1.5} />} title={t("shell.projects.emptyTitle", "No projects yet")}
            text={t("shell.projects.emptyText", "Describe your idea and your team takes it from the first brief to the release. Your projects appear here.")}
            action={
              <div className="flex flex-col items-center gap-1">
                <Button variant="primary" disabled={!ready || !canCreate} aria-busy={!ready || undefined} title={ready && !canCreate ? viewerTip() : undefined}
                  aria-describedby={ready && !canCreate ? noteId : undefined} icon={<Plus size={16} strokeWidth={2} />} onClick={() => openGuidedStart()}>
                  {t("shell.projects.startFirst", "Start your first project")}
                </Button>
                {ready && !canCreate && <ViewOnlyNote id={noteId} text={viewerTip()} />}
              </div>
            } />
        </Card>
      ) : (
        <>
          {cap.capped && (
            <p className="mb-4 text-[13px] text-ink3">
              {t("shell.projects.capped", "Showing the {limit} most recently updated of {total} projects.", { limit: cap.limit.toLocaleString(), total: cap.totalCount.toLocaleString() })}
            </p>
          )}
          {view === "grid" ? <ProjectGrid items={items} {...act} /> : (<>
            <div className="flex flex-col gap-4 lg:hidden">
              {items.map((p) => <ProjectItem key={p.id} project={p} {...act} />)}
            </div>
            <ProjectTable items={items} {...act} />
          </>)}
        </>
      )}

      <RenameModal project={renaming} onClose={() => setRenaming(null)} />
      <DeleteModal project={deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  );
}

/** The assignee's display name, "Not assigned yet" when nobody is. */
function Assignee({ userId }: { userId: string }) {
  useT();
  const name = useMemberName(userId);
  return <>{userId ? name : t("shell.projects.notAssigned", "Not assigned yet")}</>;
}

/** The step chip (one of the four: Project Setup, Business Analysis, Software Engineering, Release) with "Step n of 4",
 *  or "Deleting…" for a project being deleted. */
function StepChip({ project, now }: { project: ProjectRecord; now?: ProjectNow }) {
  useT();
  return project.status === "deleting"
    ? <Chip tone="warning">{t("shell.projects.deleting", "Deleting…")}</Chip>
    : (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone="accent">{phaseNameOf(now?.step ?? project.step)}</Chip>
        <span className="num whitespace-nowrap text-[12px] text-ink3">{t("shell.projects.stepOf", "Step {step} of {total}", { step: phaseNumber(project.step), total: PHASE_COUNT })}</span>
      </span>
    );
}

/** Where it stands: the step, and under it who is working on it. */
function WhereItStands({ project, now }: { project: ProjectRecord; now?: ProjectNow }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <StepChip project={project} now={now} />
      {project.status !== "deleting" && now && <WorkingLine now={now} className="max-w-full" />}
    </div>
  );
}

/** Below lg: the project as one card, its current step as a full-width button. */
function ProjectItem({ project, ...act }: Actions & { project: ProjectRecord }) {
  useT();
  const isDeleting = project.status === "deleting";
  const now = act.now?.get(project.id);
  const warm = () => act.onWarm?.(project);
  return (
    <div onPointerEnter={warm} onFocus={warm}>
    <Card>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-[15px] font-medium leading-snug">{project.name}</div>
          <div className="break-words text-[13px] text-ink3">{where(project)}</div>
          <TypeChip type={project.type} className="mt-1.5" />
        </div>
        <ActionsMenu project={project} {...act} quick={quickActions(project, act.building?.has(project.id))} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StepChip project={project} now={now} />
        {!isDeleting && now && <WorkingLine now={now} />}
      </div>
      {!isDeleting && now && now.waiting.length > 0 && <WaitingChips now={now} className="mt-3" />}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-ink2">{project.assigneeUserId ? <>{t("shell.projects.assignedTo", "Assigned to")} <Assignee userId={project.assigneeUserId} /></> : t("shell.projects.notAssigned", "Not assigned yet")}</span>
        <span className="text-ink3">{relativeTime(projectActivityAt(project, act.activity))}</span>
      </div>
      {!isDeleting && (
        <Button variant="secondary" className="mt-5 w-full" onClick={() => act.onOpen(project)} iconRight={<ArrowRight size={16} strokeWidth={2} />}>
          {t("shell.projects.openStep", "Open {step}", { step: phaseNameOf(now?.step ?? project.step) })}
        </Button>
      )}
    </Card>
    </div>
  );
}

/** A row's cells: the hover band runs under the whole row, with the block radius at its ends. */
const cell = "px-3 py-4 align-middle transition-colors group-hover:bg-canvas first:rounded-l-block last:rounded-r-block dark:group-hover:bg-line";

/** From lg up: the projects as a table; the row opens the project at its current step. */
export function ProjectTable({ items, ...act }: Actions & { items: ProjectRecord[] }) {
  useT();
  return (
    <Card className="hidden lg:block" bodyClassName="px-3 pb-3 pt-2">
      <table className="relative w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{t("shell.projects.tableCaption", "Your projects, where each one stands and what is waiting for you. Select a project to open its current step.")}</caption>
        {/* fixed widths: the columns stay put as a project moves from step to step */}
        <thead>
          <tr className="text-[12px] font-medium uppercase tracking-wider text-ink3">
            <th scope="col" className="border-b border-line px-3 py-3 font-medium">{t("shell.projects.colProject", "Project")}</th>
            <th scope="col" className="w-[230px] border-b border-line px-3 py-3 font-medium">{t("shell.projects.colWhere", "Where it stands")}</th>
            <th scope="col" className="w-[250px] border-b border-line px-3 py-3 font-medium">{t("shell.projects.colWaiting", "Waiting for you")}</th>
            <th scope="col" className="w-[150px] border-b border-line px-3 py-3 font-medium">{t("shell.projects.colAssigned", "Assigned to")}</th>
            <th scope="col" className="hidden w-[130px] border-b border-line px-3 py-3 font-medium xl:table-cell">{t("shell.projects.colLastActivity", "Last activity")}</th>
            <th scope="col" className="w-[70px] border-b border-line px-3 py-3"><span className="sr-only">{t("shell.projects.colActions", "Actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((project) => {
            const isDeleting = project.status === "deleting";
            const now = act.now?.get(project.id);
            return (
              <tr key={project.id} onClick={isDeleting ? undefined : () => act.onOpen(project)}
                onPointerEnter={isDeleting ? undefined : () => act.onWarm?.(project)} onFocus={isDeleting ? undefined : () => act.onWarm?.(project)} className={cn("group", !isDeleting && "cursor-pointer")}>
                <td className={cell}>
                  {isDeleting ? (
                    <span className="block break-words text-[15px] font-medium">{project.name}</span>
                  ) : (
                    <Link to={prefixPath(`/p/${project.id}`)} onClick={(e) => e.stopPropagation()}
                      className="block break-words rounded-md text-left text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{project.name}</Link>
                  )}
                  {where(project) && <span className="block break-words text-[13px] text-ink3">{where(project)}</span>}
                  <TypeChip type={project.type} className="mt-1.5" />
                </td>
                <td className={cell}><WhereItStands project={project} now={now} /></td>
                <td className={cell}>
                  {/* the chip opens the place where you act, not the row's current step */}
                  {!isDeleting && now && <span className="block min-w-0" onClick={(e) => e.stopPropagation()}><WaitingChips now={now} /></span>}
                </td>
                <td className={cn(cell, "break-words text-[13px] text-ink2")}><Assignee userId={project.assigneeUserId} /></td>
                <td className={cn(cell, "hidden whitespace-nowrap text-[13px] text-ink2 xl:table-cell")}>{relativeTime(projectActivityAt(project, act.activity))}</td>
                <td className={cn(cell, "text-right")}>
                  <div className="flex items-center justify-end gap-2"><ActionsMenu project={project} {...act} quick={quickActions(project, act.building?.has(project.id))} /></div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function RenameModal({ project, onClose }: { project: ProjectRecord | null; onClose: () => void }) {
  useT();
  const renamer = useRenameProject();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = project?.id;
  useEffect(() => { setValue(project?.name ?? ""); setError(null); setBusy(false); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = useRef(false);
  const save = async () => {
    if (!project || saving.current) return;
    const problem = nameProblem(value.trim());
    if (problem) { setError(problem); return; }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await renamer.run({ projectId: project.id, name: value.trim() });
      onClose();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal open={project !== null} onClose={onClose} title={t("shell.projects.renameTitle", "Rename project")} width={440}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={onClose}>{t("common.actions.cancel", "Cancel")}</Button>
        <Button variant="primary" disabled={busy || value.trim() === ""} onClick={() => void save()}>{busy ? t("common.status.saving", "Saving…") : t("common.actions.save", "Save")}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Label><label htmlFor="rename-project">{t("shell.projects.projectName", "Project name")}</label></Label>
        <Input id="rename-project" value={value} maxLength={80} autoFocus onChange={(e) => setValue(e.target.value)} />
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

/** The body under the title: the title already names the project, so the body never repeats it. */
export function deleteDialogText(resuming: boolean): string {
  return resuming ? t("shell.projects.deleteResumeText", "This project is half deleted. Finish to remove what is left. This can't be undone.") : t("shell.projects.cannotUndo", "This can't be undone.");
}

/** The page-level notice after the server refused a delete. */
export interface DeleteFailure { name: string; message: string }

/** Confirms a delete: closes the dialog and clears an old notice at once, then runs the call without waiting for it; a rejection becomes the notice. */
export function startDelete(
  run: (projectId: string) => Promise<void>, project: { id: string; name: string },
  on: { close: () => void; clear: () => void; fail: (f: DeleteFailure) => void },
): Promise<void> {
  on.close();
  on.clear();
  return run(project.id).catch((e: unknown) => on.fail({ name: project.name, message: messageFor(e) }));
}

function DeleteModal({ project, onClose, onConfirm }: { project: ProjectRecord | null; onClose: () => void; onConfirm: () => void }) {
  useT();
  const resuming = project?.status === "deleting";
  return (
    <Modal open={project !== null} onClose={onClose}
      title={resuming ? t("shell.projects.finishDeletingTitle", "Finish deleting {name}?", { name: project?.name ?? t("shell.projects.projectWord", "project") }) : t("shell.projects.deleteTitle", "Delete '{name}'?", { name: project?.name ?? t("shell.projects.projectWord", "project") })} width={440}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t("common.actions.cancel", "Cancel")}</Button>
        <Button variant="danger" onClick={onConfirm}>{resuming ? t("shell.projects.finishDeleting", "Finish deleting") : t("shell.projects.deleteProject", "Delete project")}</Button>
      </>}>
      <p className="text-[14px] text-ink2">
        {deleteDialogText(resuming)}
      </p>
    </Modal>
  );
}
