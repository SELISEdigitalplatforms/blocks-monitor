/** "Share what you already have" (existing products: "Share your existing documentation"): drop or pick documents,
 *  they upload through the Business page's own upload queue (check → presign → upload → verify) into the project's
 *  "Client documents" folder, which is created when it is missing. Each file shows how far it is and when it is filed.
 *  Step 2 confirms what was filed. Opened by the Project setup page's "What to do now" card. */
import { useCallback, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, FileUp, FolderOpen, RotateCw, UploadCloud, X } from "lucide-react";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useProjectsContext } from "@/madp/blocks/projects/context";
import { useDocTree } from "@/madp/blocks/projects/docReads";
import { useCreateFolder } from "@/madp/blocks/projects/docMutations";
import { useUploadQueue, useUploadStore, type UploadItem } from "@/madp/blocks/projects/upload";
import { messageFor } from "@/madp/blocks/projects/messages";
import { ACCEPTED_EXTENSIONS } from "@/madp/domain/docs";
import { can } from "@/madp/domain/rbac";
import { Banner, Button } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { StepHeading, withNode } from "@/madp/components/guided/GuidedSteps";
import { fileIconFor } from "@/madp/components/business/icons";
import { formatSize } from "@/madp/components/business/fileUi";
import { Illustration, SetupWindow } from "./SetupWindow";
import { CLIENT_DOCS_FOLDER, PHASE_STEPS, findTopFolder, isBusy, phaseStep, phaseText, shareSummary, shareWording } from "./shareModel";

export interface ShareMaterialWindowProps {
  project: ProjectRecord;
  open: boolean;
  onClose: () => void;
  /** After "Done" on the last step: the folder the documents went to and how many were filed. */
  onDone?: (result: { folderId: string; filed: number }) => void;
}

const accept = ACCEPTED_EXTENSIONS.split(",").map((e) => e.trim()).join(",");
const NO_ITEMS: UploadItem[] = [];

export function ShareMaterialWindow(props: ShareMaterialWindowProps) {
  if (!props.open) return null;
  return <ShareMaterial {...props} />;
}

function ShareMaterial({ project, onClose, onDone }: ShareMaterialWindowProps) {
  const t = useT();
  const ctx = useProjectsContext();
  const canEdit = ctx.isSuperAdmin || can(ctx.permissions, "business.edit");
  const existing = project.type === "brownfield";
  const words = shareWording(existing);
  const tree = useDocTree(project.id);
  const createFolder = useCreateFolder();
  const queue = useUploadQueue(project.id);
  const all = useUploadStore((s) => s.byProject[project.id]) ?? NO_ITEMS;
  const [mine, setMine] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [over, setOver] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const folderId = useRef<string | null>(null);
  const folderFlight = useRef<Promise<string> | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();

  const items = useMemo(() => {
    const ids = new Set(mine);
    return all.filter((i) => ids.has(i.id));
  }, [all, mine]);
  const sum = shareSummary(items);
  const ready = Boolean(tree.data);

  // the "Client documents" folder: the one there is, else a new one (created once, however many drops)
  const ensureFolder = useCallback((): Promise<string> => {
    if (folderId.current) return Promise.resolve(folderId.current);
    const found = tree.data ? findTopFolder(tree.data.folders, CLIENT_DOCS_FOLDER) : null;
    if (found) { folderId.current = found; return Promise.resolve(found); }
    folderFlight.current ??= createFolder.run({ projectId: project.id, parentId: "", name: CLIENT_DOCS_FOLDER, kind: "other" })
      .then((f) => { folderId.current = f.id; return f.id; })
      .finally(() => { folderFlight.current = null; });
    return folderFlight.current;
  }, [tree.data, createFolder, project.id]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length || !canEdit) return;
    setFailure(null);
    setHint(null);
    let target: string;
    try {
      target = await ensureFolder();
    } catch (e) {
      setFailure(messageFor(e));
      return;
    }
    const before = new Set((useUploadStore.getState().byProject[project.id] ?? []).map((i) => i.id));
    queue.add(files, target);
    const added = (useUploadStore.getState().byProject[project.id] ?? []).filter((i) => !before.has(i.id)).map((i) => i.id);
    setMine((m) => [...m, ...added]);
  }, [canEdit, ensureFolder, project.id, queue]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };
  const onDrag = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (canEdit && ready) setOver(true);
  };

  const next = () => {
    if (step === 1) {
      onDone?.({ folderId: folderId.current ?? "", filed: sum.done });
      onClose();
      return;
    }
    if (sum.busy > 0) {
      setHint(sum.busy === 1 ? t("shell.setup.share.stillFilingOne", "Still filing 1 document. One moment…")
        : t("shell.setup.share.stillFilingMany", "Still filing {count} documents. One moment…", { count: sum.busy }));
      return;
    }
    if (sum.done === 0) { setHint(t("shell.setup.share.addOne", "Add at least one document, or choose “Skip for now”.")); return; }
    setHint(null);
    setDir(1);
    setStep(1);
  };

  const nextLabel = step === 1 ? t("common.actions.done", "Done") : sum.busy > 0 ? t("shell.setup.share.filingCount", "Filing {count}…", { count: sum.busy }) : t("common.actions.continue", "Continue");

  return (
    <SetupWindow name={t("shell.setup.share.windowName", "Project setup")} steps={[words.title, t("shell.setup.share.filedStep", "Filed")]} step={step} dir={dir} headingId={headingId} formRef={form}
      onClose={onClose} onBack={() => { setDir(-1); setStep(0); }} onNext={next} nextLabel={nextLabel}
      busy={false} footerNote={t("shell.setup.share.filesGoTo", "Files go to “{folder}”", { folder: CLIENT_DOCS_FOLDER })}
      secondary={step === 0 && sum.done === 0 && sum.busy === 0 ? <Button variant="ghost" onClick={onClose}>{t("shell.setup.share.skip", "Skip for now")}</Button> : undefined}>
      {step === 0 ? (
        <div onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }} onDrop={onDrop}>
          <StepHeading id={headingId} title={words.title} text={words.text} />
          {!canEdit && <div className="mb-5"><Banner tone="warning" title={t("shell.setup.share.viewerTitle", "You can look, but not add documents.")} text={t("shell.setup.share.viewerText", "Ask a Workspace admin for the Member role to share documents.")} /></div>}
          {failure && <div className="mb-5"><Banner tone="danger" title={t("shell.setup.share.folderFailed", "The “{folder}” folder could not be created.", { folder: CLIENT_DOCS_FOLDER })} text={failure} /></div>}
          <div role="group" aria-label={t("shell.setup.share.dropZone", "Drop documents here")} tabIndex={canEdit && ready ? 0 : -1} data-step-focus=""
            onKeyDown={(e) => { if (canEdit && ready && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
            onClick={(e) => { if (canEdit && ready && e.target === e.currentTarget) input.current?.click(); }}
            className={cn("flex flex-col items-center gap-4 rounded-card border-2 border-dashed px-6 py-10 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50 sm:py-12",
              over ? "border-accent bg-accent-soft" : "border-line bg-surface2/60 hover:border-accent/60",
              (!canEdit || !ready) && "opacity-60")}>
            <Illustration icon={<UploadCloud size={30} strokeWidth={1.5} />} badge={<FileUp size={14} />} />
            <div className="pointer-events-none">
              <p className="text-[18px] font-medium text-ink">{over ? t("shell.setup.share.dropNow", "Drop to share them") : t("shell.setup.share.dragHere", "Drag & drop your documents here")}</p>
              <p className="mt-1 text-[14px] text-ink2">{t("shell.setup.share.examplesLimit", "{examples}. Up to 10 MB each.", { examples: words.examples })}</p>
            </div>
            <input ref={input} type="file" multiple accept={accept} className="hidden" tabIndex={-1} aria-hidden disabled={!canEdit || !ready}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void addFiles(files);
              }} />
            <Button variant="secondary" size="lg" disabled={!canEdit || !ready} onClick={() => input.current?.click()}
              icon={<FolderOpen size={16} strokeWidth={1.75} aria-hidden />}>{ready ? t("shell.setup.share.chooseFiles", "Choose files") : t("shell.setup.share.gettingReady", "Getting ready…")}</Button>
          </div>
          {hint && <p role="status" className="mt-3 text-[13px] text-ink2">{hint}</p>}
          {items.length > 0 && (
            <ul aria-label={t("shell.setup.share.yourDocuments", "Your documents")} aria-live="polite" className="mt-5 flex flex-col gap-2">
              {items.map((it) => <FileRow key={it.id} item={it} onRetry={() => queue.retry(it.id)} onCancel={() => queue.cancel(it.id)}
                onRemove={() => { queue.remove(it.id); setMine((m) => m.filter((x) => x !== it.id)); }} />)}
            </ul>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-6 flex flex-col items-start gap-5 sm:mb-8 sm:flex-row sm:items-center">
            <Illustration icon={<FolderOpen size={30} strokeWidth={1.5} />} badge={<Check size={14} strokeWidth={2.5} />} tone="success" />
            <div className="min-w-0">
              <h2 id={headingId} tabIndex={-1} className="text-[26px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{words.doneTitle}</h2>
              <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink2">
                {withNode(sum.done === 1
                  ? t("shell.setup.share.doneOne", "1 document is in the {folder} folder of {project}. Your business analyst reads it now and files it where it belongs. You can add more at any time.", { project: project.name || t("shell.setup.share.yourProject", "your project") })
                  : t("shell.setup.share.doneMany", "{count} documents are in the {folder} folder of {project}. Your business analyst reads them now and files them where they belong. You can add more at any time.", { count: sum.done, project: project.name || t("shell.setup.share.yourProject", "your project") }),
                "{folder}", <span className="font-medium text-ink">{CLIENT_DOCS_FOLDER}</span>)}
              </p>
            </div>
          </div>
          <ul aria-label={t("shell.setup.share.filedDocuments", "Filed documents")} className="divide-y divide-line rounded-block bg-surface2 px-4">
            {items.filter((i) => i.phase === "done").map((it) => {
              const Icon = fileIconFor({ name: it.name, mime: "" });
              return (
                <li key={it.id} className="flex items-center gap-3 py-3">
                  <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink2" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.name}</span>
                  <span className="text-[13px] text-ink3">{formatSize(it.sizeBytes)}</span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success"><Check size={14} strokeWidth={2.25} aria-hidden />{t("shell.setup.share.phase.filed", "Filed")}</span>
                </li>
              );
            })}
          </ul>
          {sum.failed > 0 && <p className="mt-3 text-[13px] text-ink2">{sum.failed === 1
            ? t("shell.setup.share.failedOne", "1 file was not uploaded. Go back to try it again.")
            : t("shell.setup.share.failedMany", "{count} files were not uploaded. Go back to try them again.", { count: sum.failed })}</p>}
        </div>
      )}
    </SetupWindow>
  );
}

function FileRow({ item, onRetry, onCancel, onRemove }: { item: UploadItem; onRetry: () => void; onCancel: () => void; onRemove: () => void }) {
  const t = useT();
  const Icon = fileIconFor({ name: item.name, mime: "" });
  const busy = isBusy(item.phase);
  const done = item.phase === "done";
  const failed = item.phase === "failed";
  return (
    <li className={cn("flex flex-col gap-2 rounded-block px-4 py-3 ring-1 transition", done ? "bg-success-soft/50 ring-success/20" : failed ? "bg-surface2 ring-danger/30" : "bg-surface2 ring-line")}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", done ? "bg-success text-white" : "bg-surface text-ink2")}>
          {done ? <Check size={16} strokeWidth={2.25} /> : <Icon size={17} strokeWidth={1.75} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{item.name}</span>
          <span className={cn("block text-[13px]", failed ? "text-danger" : done ? "text-success" : "text-ink3")}>
            {formatSize(item.sizeBytes)} · {phaseText(item.phase)}{failed && item.message ? ` ${item.message}` : ""}
          </span>
        </span>
        {failed && item.retryable !== false && (
          <Button size="sm" variant="ghost" onClick={onRetry} icon={<RotateCw size={14} strokeWidth={1.75} aria-hidden />}>{t("common.actions.tryAgain", "Try again")}</Button>
        )}
        {busy
          ? <Button size="sm" variant="ghost" onClick={onCancel} aria-label={t("shell.setup.share.cancelFile", "Cancel {name}", { name: item.name })} icon={<X size={14} strokeWidth={1.75} aria-hidden />}>{t("common.actions.cancel", "Cancel")}</Button>
          : !done && <Button size="sm" variant="ghost" onClick={onRemove} aria-label={t("shell.setup.share.removeFile", "Remove {name}", { name: item.name })} icon={<X size={14} strokeWidth={1.75} aria-hidden />}>{t("common.actions.remove", "Remove")}</Button>}
      </div>
      {!failed && (
        <ShimmerProgress step={phaseStep(item.phase)} total={PHASE_STEPS} active={busy} size="sm" label={t("shell.setup.share.fileUpload", "{name} upload", { name: item.name })}
          valueText={phaseText(item.phase)} />
      )}
    </li>
  );
}
