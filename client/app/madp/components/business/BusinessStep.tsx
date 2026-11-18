/** Step 1 "Project Setup" on the shared step frame: one header row (title · status · Start project analysis), the
 *  role line, the checklist chips (each opens its window: guided questions, Code, Material), the
 *  business agent's line, and the main area "Your material" (the tree with the Project brief pinned, the open note or
 *  file beside it). Files dropped anywhere on the page are added through the same upload queue. After the hand-over the
 *  layout stays: the chips open the saved answers read-only, "Analysis started by … on …", and the link to the next step. */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, FilePlus2, FolderPlus, Plus, Rocket, UploadCloud } from "lucide-react";
import { Banner, Button } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { useRouteProject } from "@/madp/blocks/projects/reads";
import { useMemberName, useProjectsContext } from "@/madp/blocks/projects/context";
import { NOT_CONFIGURED_MESSAGE, isProjectFunctionConfigured, messageFor } from "@/madp/blocks/projects/messages";
import { useDocTree, useNewSinceHandOver, type DocTreeData } from "@/madp/blocks/projects/docReads";
import { useCreateFolder } from "@/madp/blocks/projects/docMutations";
import { useUploadQueue } from "@/madp/blocks/projects/upload";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { stepPath } from "@/madp/domain/phases";
import { phaseName } from "@/madp/components/project/stepNames";
import { canCreateFolder } from "@/madp/domain/docs";
import { StepFrame, type StepSignOff } from "@/madp/components/step/StepFrame";
import { openSetupWindow } from "@/madp/components/setup";
import { CLIENT_DOCS_FOLDER, findTopFolder } from "@/madp/components/setup/shareModel";
import { DocTree } from "./DocTree";
import { DocSearch } from "./DocSearch";
import { NewFolderDialog } from "./NewFolderDialog";
import { UploadButton, UploadQueue } from "./UploadPanel";
import { useSetupChips } from "./SetupChecklistCard";
import { SetupAnswersWindow, type LiveProfile } from "./SetupAnswersWindow";
import { briefIdOf, liveProductAttached, setupChipMode, type SetupChipId } from "./setupChips";
import { useSetup } from "@/madp/components/sanitization/UnderstoodSection";
import { useLiveProductSnapshot } from "@/madp/blocks/delivery/environments";
import { documentedLine } from "@/madp/components/analysis-next/live/liveDoc";
import { codeHomeStillOpen } from "./NewRepositoryCard";
import { StartAnalysisWindow } from "./StartAnalysisWindow";
import { RepositoryWindow } from "./RepositoryWindow";
import { TypeChip } from "../project/TypeChip";
import { WebsiteLink } from "./WebsiteLink";
import { ItemPane, newDraft, type NoteDraft } from "./ItemPane";
import { needEdit, isEmptyProject, selectionFromSearch, withSelection } from "./businessUi";
import { useT } from "@/madp/i18n";
import { SetupAgentLine } from "./agentSlot";
import { dropMessage } from "./treeModel";

function Skeleton() {
  const t = useT();
  return (
    <div aria-busy="true" aria-label={t("analysis.business.loading", "Loading")} className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <div className="h-72 animate-pulse rounded-card bg-surface2" />
      <div className="h-72 animate-pulse rounded-card bg-surface2" />
    </div>
  );
}

function hasPermission(p: unknown, key: string): boolean {
  if (Array.isArray(p)) return p.includes(key);
  if (p instanceof Set) return p.has(key);
  return false;
}

/** ids of the ancestors of an item, whether the tree returns ids or records */
function ancestorIds(data: DocTreeData, id: string): string[] {
  const list = data.tree.ancestors(id) as unknown as Array<string | { id: string }>;
  return list.map((a) => (typeof a === "string" ? a : a.id));
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** `agentLine`: replaces the business agent's line (by default the SetupAgentLine of src/components/setup/agent). */
export function BusinessStep({ agentLine }: { agentLine?: ReactNode } = {}) {
  const t = useT();
  const route = useRouteProject();
  const frame = (main: ReactNode) => <StepFrame title={phaseName("setup")}>{main}</StepFrame>;
  if (!route.isBlocks) return frame(<Banner tone="accent" title={t("analysis.business.notOnBlocks", "This project's material isn't stored in the workspace. Start a new project to use Project Setup.")} />);
  if (route.isLoading) return frame(<Skeleton />);
  if (route.error) {
    return frame(<Banner tone="danger" title={t("analysis.business.projectLoadFailed", "The project could not be loaded.")}
      action={<Button variant="secondary" onClick={() => route.refetch()}>{t("analysis.business.retry", "Retry")}</Button>} />);
  }
  if (!route.project) return frame(<Banner tone="warning" title={t("analysis.business.projectNotFound", "This project could not be found.")} />);
  return <BlocksBusiness project={route.project} agentLine={agentLine} />;
}

function BlocksBusiness({ project, agentLine }: { project: ProjectRecord; agentLine?: ReactNode }) {
  const t = useT();
  const ctx = useProjectsContext();
  const canEdit = ctx.isSuperAdmin || hasPermission(ctx.permissions, "business.edit");
  const editReason = canEdit ? null : needEdit();
  const tree = useDocTree(project.id);
  const data = tree.data;
  const [params, setParams] = useSearchParams();
  const picked = selectionFromSearch(params);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [viewing, setViewing] = useState<SetupChipId | null>(null);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const handed = Boolean(project.handedOverAt);
  // an existing product attached as it is live, past its setup: no analysis to start (the server answers
  // business.alreadyHandedOver), its profile is shown read-only (project.setup answers project.setupLocked)
  const live = liveProductAttached({ type: project.type, step: project.step, handedOverAt: project.handedOverAt });
  const setupRead = useSetup(live ? ctx.workspaceId ?? "" : "", live ? project.id : "");
  const snapshot = useLiveProductSnapshot(project.id, live);
  const profile: LiveProfile | null = live ? {
    about: setupRead.brief,
    goal: (setupRead.row?.Goal ?? project.goal ?? "").trim(),
    users: (setupRead.row?.TargetUsers ?? project.targetUsers ?? "").trim(),
    documented: snapshot ? documentedLine(snapshot.documentedAt) : null,
  } : null;

  // in setup with edit rights the chips open their windows; afterwards (or without the rights) the saved answers
  const chipMode = setupChipMode({ canEdit, step: project.step, handedOverAt: project.handedOverAt, existing: project.type === "brownfield" });
  const { chips, values, material } = useSetupChips(project, data, {
    mode: chipMode,
    onCode: () => setCodeOpen(true),
    onView: setViewing,
  });

  // the Project brief opens by default: the step's deliverable is what the main area shows first
  const briefId = useMemo(() => briefIdOf(data), [data]);
  const selectedId = picked ?? (draft ? null : briefId);

  const select = (id: string | null) => {
    setDraft(null);
    setParams(withSelection(params, id), { replace: true });
  };

  // keep the same editor instance across the first save: it learns its id, nothing remounts
  const onNoteCreated = (id: string) => {
    setDraft((d) => (d ? { ...d, createdId: id } : d));
    setParams(withSelection(params, id), { replace: true });
  };

  // expand the ancestors of the selected item, on load and when ?item= changes
  useEffect(() => {
    if (!data || !selectedId) return;
    const ids = ancestorIds(data, selectedId);
    if (ids.length === 0) return;
    setExpanded((cur) => (ids.every((i) => cur.has(i)) ? cur : new Set([...cur, ...ids])));
  }, [data, selectedId]);

  const toggle = (folderId: string, open: boolean) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (open) next.add(folderId);
      else next.delete(folderId);
      return next;
    });

  const empty = useMemo(() => (data ? isEmptyProject(data) : false), [data]);
  const showPane = Boolean(picked || draft);
  const selectedFolder = data && selectedId && data.folders.some((f) => f.id === selectedId) ? selectedId : "";
  const newNote = () => { setParams(withSelection(params, null), { replace: true }); setDraft(newDraft(selectedFolder)); };
  const newFolder = () => {
    if (!data) return;
    const ok = canCreateFolder(data.tree, selectedFolder);
    if (!ok.ok) { setError(dropMessage(ok.messageKey)); return; }
    setError(null);
    setFolderOpen(true);
  };

  /* ── files dropped anywhere on the page: into the open folder, else "Client documents" ── */
  const queue = useUploadQueue(project.id);
  const createFolder = useCreateFolder();
  const canDrop = canEdit && Boolean(data);
  const dropFolderName = selectedFolder ? data?.folders.find((f) => f.id === selectedFolder)?.name ?? CLIENT_DOCS_FOLDER : CLIENT_DOCS_FOLDER;
  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length || !data) return;
    setError(null);
    try {
      let target = selectedFolder || findTopFolder(data.folders, CLIENT_DOCS_FOLDER);
      if (!target) target = (await createFolder.run({ projectId: project.id, parentId: "", name: CLIENT_DOCS_FOLDER, kind: "other" })).id;
      queue.add(files, target);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [data, selectedFolder, createFolder, project.id, queue]);
  const rootProps = {
    ref: pageRef,
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e) || !canDrop) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDropping(true);
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e) || !canDrop || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e) || !canDrop) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropping(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      dragDepth.current = 0;
      setDropping(false);
      // a drop zone inside (a folder's upload area) has taken it already
      if (!hasFiles(e) || !canDrop || e.defaultPrevented) return;
      e.preventDefault();
      void addFiles(Array.from(e.dataTransfer.files));
    },
  };

  /* ── after the hand-over: the same page, signed off ── */
  const by = useMemberName(project.handedOverByUserId ?? "");
  const since = useNewSinceHandOver(project.id);
  // the next step is Business Analysis, which opens on its first section, Project understanding (the hand-over opens it too)
  const nextLabel = phaseName("analysis");
  const signedOff: StepSignOff | null = live ? {
    text: t("analysis.business.signedOff.live", "Came to the Factory as a live product"),
    next: { label: t("analysis.business.signedOff.open", "Open {step}", { step: nextLabel }), href: stepPath(project.id, "understanding") },
  } : handed ? {
    verb: t("analysis.business.signedOff.started", "Analysis started"),
    by: project.handedOverByUserId ? by.trim() || t("analysis.business.formerMember", "a former member") : null,
    at: project.handedOverAt,
    extra: since.count > 0 ? t("analysis.business.signedOff.newSince", "{count} new since", { count: since.count }) : undefined,
    next: { label: t("analysis.business.signedOff.open", "Open {step}", { step: nextLabel }), href: stepPath(project.id, "understanding") },
  } : null;

  const line = agentLine !== undefined ? agentLine : SetupAgentLine ? <SetupAgentLine projectId={project.id} /> : null;

  const mainActions = data ? (
    <>
      <DocSearch projectId={project.id} onOpen={select} floating className="w-full sm:w-60 [&_input]:h-10" />
      <Button variant="secondary" disabled={!canEdit} title={editReason ?? undefined} icon={<Plus size={16} aria-hidden />}
        onClick={() => openSetupWindow("share", project.id)}>{t("analysis.business.addFiles", "Add files")}</Button>
      <Button variant="ghost" disabled={!canEdit} title={editReason ?? undefined}
        aria-label={selectedFolder ? t("analysis.business.tree.newNoteIn", "New note in {name}", { name: dropFolderName }) : t("analysis.business.tree.newNoteTop", "New note at the top level")}
        icon={<FilePlus2 size={16} aria-hidden />} onClick={newNote}>{t("analysis.business.tree.newNote", "New note")}</Button>
      <Button variant="ghost" disabled={!canEdit} title={editReason ?? undefined}
        icon={<FolderPlus size={16} aria-hidden />} onClick={newFolder}>{t("analysis.business.folder.new", "New folder")}</Button>
    </>
  ) : null;

  const pane = !data ? null : empty && !showPane ? (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-card border border-dashed border-line bg-surface p-8 text-center">
      <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]"><UploadCloud size={26} /></span>
      <p className="max-w-md text-[14px] text-ink2">{t("analysis.business.emptyText", "Nothing shared yet. Write in the Scratch pad or a note, add a folder for each kind of material, or upload files.")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="secondary" disabled={!canEdit} icon={<FolderPlus size={16} strokeWidth={1.75} aria-hidden />}
          onClick={newFolder}>{t("analysis.business.folder.new", "New folder")}</Button>
        <Button variant="secondary" disabled={!canEdit} icon={<FilePlus2 size={16} strokeWidth={1.75} aria-hidden />}
          onClick={() => setDraft(newDraft(""))}>{t("analysis.business.tree.newNote", "New note")}</Button>
        <UploadButton projectId={project.id} folderId="" disabled={!canEdit} />
      </div>
      <div className="w-full max-w-lg text-left"><UploadQueue projectId={project.id} folderId="" /></div>
    </div>
  ) : !selectedId && !draft ? (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-surface p-8 text-center">
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-surface2 text-ink3"><UploadCloud size={22} /></span>
      <p className="max-w-sm text-[14px] text-ink2">{t("analysis.business.pickText", "Pick a note or file on the left to read it here. Drop files anywhere on this page to add them.")}</p>
    </div>
  ) : (
    <ItemPane projectId={project.id} data={data} selectedId={selectedId} draft={draft} canEdit={canEdit}
      editReason={editReason} onCreated={onNoteCreated} onNewNote={(folderId) => setDraft(newDraft(folderId))} previewId={briefId} quiet onSelect={select} />
  );

  return (
    <>
      <StepFrame
        title={phaseName("setup")}
        subject={project.name}
        readyText={t("analysis.business.frame.ready", "Ready for analysis")}
        role={t("analysis.business.frame.role", "Business analyst")}
        deliverable={live ? t("analysis.business.frame.deliverableLive", "keeps the product's profile and your material") : t("analysis.business.frame.deliverable", "prepares your Project brief")}
        yourPart={live ? (canEdit ? t("analysis.business.frame.partLiveEdit", "read the profile, share what you have") : t("analysis.business.frame.partLiveRead", "read the profile and the material"))
          : canEdit ? t("analysis.business.frame.partEdit", "answer the questions, share what you have") : t("analysis.business.frame.partRead", "read the brief and the material")}
        primary={live ? null : { label: t("analysis.business.start.name", "Start project analysis"), icon: <Rocket size={16} aria-hidden />, onClick: () => setStarting(true) }}
        extras={<>
          <TypeChip type={project.type} />
          <WebsiteLink project={project} canEdit={canEdit} />
        </>}
        chips={chips}
        chipsLabel={t("analysis.business.frame.checklist", "Project Setup checklist")}
        agentLine={line}
        signedOff={signedOff}
        notices={<>
          {!isProjectFunctionConfigured() && <Banner tone="accent" title={NOT_CONFIGURED_MESSAGE} />}
          {!canEdit && (
            <p id="business-view-only" className="flex items-start gap-2 rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
              <Eye size={16} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
              <span>{t("analysis.business.viewOnly", "You can read the brief and all the material. Adding or changing it is up to the project team.")}</span>
            </p>
          )}
        </>}
        mainTitle={t("analysis.business.yourMaterial", "Your material")}
        mainActions={mainActions}
        fill
        rootProps={rootProps}
        overlay={dropping ? (
          <div aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-[rgb(var(--c-scrim)/0.18)] p-6 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-float">
              <UploadCloud size={32} className="text-[rgb(var(--c-accent-text))]" />
              <p className="text-[16px] font-medium">{t("analysis.business.dropToAdd", "Drop to add your files")}</p>
              <p className="text-[13px] text-ink2">{t("analysis.business.dropGoesInto", "They go into “{name}”.", { name: dropFolderName })}</p>
            </div>
          </div>
        ) : null}
      >
        {error && (
          <Banner tone="danger" title={error} className="mb-3"
            action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>{t("analysis.business.dismiss", "Dismiss")}</Button>} />
        )}
        {tree.isLoading && <Skeleton />}
        {!tree.isLoading && Boolean(tree.error) && (
          <Banner tone="danger" title={t("analysis.business.materialLoadFailed", "The project's material could not be loaded.")}
            action={<Button variant="secondary" onClick={() => tree.refetch()}>{t("analysis.business.retry", "Retry")}</Button>} />
        )}
        {data && (
          // lg:pb-20: the window-high area ends above the floating Team and assistant buttons, so they never cover the
          // note's character counter (bottom right)
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] lg:pb-20">
            <div className={cn("min-h-0 min-w-0 flex-col", showPane ? "hidden md:flex" : "flex")}>
              <DocTree projectId={project.id} data={data} selectedId={selectedId} onSelect={select} expanded={expanded}
                onToggle={toggle} onNewNote={(folderId) => { setParams(withSelection(params, null), { replace: true }); setDraft(newDraft(folderId)); }}
                canEdit={canEdit} editReason={editReason} handedOverAt={project.handedOverAt}
                toolbar={false} pinnedId={briefId} className="scroll-thin min-h-0 flex-1 overflow-y-auto"
                onDeleted={(item) => { if (item.id === picked || (picked && item.kind === "folder" && ancestorIds(data, picked).includes(item.id))) select(null); }} />
            </div>
            <div className={cn("scroll-thin min-h-0 min-w-0 lg:overflow-y-auto", showPane || empty ? "" : "hidden md:block")}>
              {showPane && (
                <Button variant="secondary" size="sm" className="mb-4 md:hidden" icon={<ArrowLeft size={16} strokeWidth={1.75} aria-hidden />}
                  onClick={() => select(null)}>{t("analysis.business.backToMaterial", "Back to your material")}</Button>
              )}
              {!selectedFolder && !empty && <div className="mb-3 empty:hidden"><UploadQueue projectId={project.id} activeOnly /></div>}
              {pane}
            </div>
          </div>
        )}
      </StepFrame>
      {/* outside the frame: it stays on screen while the hand-over lands and the next step opens */}
      {starting && !live && <StartAnalysisWindow project={project} data={data} canEdit={canEdit} onClose={() => setStarting(false)} />}
      <RepositoryWindow project={project} canEdit={canEdit} open={codeOpen} onClose={() => setCodeOpen(false)} />
      {viewing && chipMode.kind === "read" && (
        <SetupAnswersWindow project={project} section={viewing} values={values} material={material} note={chipMode.note} profile={profile}
          onClose={() => setViewing(null)}
          onOpenItem={(id) => { setViewing(null); select(id); }}
          onChangeCode={canEdit && codeHomeStillOpen(project) ? () => { setViewing(null); setCodeOpen(true); } : undefined} />
      )}
      <NewFolderDialog open={folderOpen} projectId={project.id} parentId={selectedFolder} onClose={() => setFolderOpen(false)}
        onCreated={(id) => { setFolderOpen(false); if (selectedFolder) toggle(selectedFolder, true); select(id); }} />
    </>
  );
}
