/** The right-hand pane of the Business step: the open scratch pad, note, file or folder. */
import { Folder, FilePlus2 } from "lucide-react";
import { Banner, Button, Card } from "@/ui/kit";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import type { DocTreeData } from "@/blocks/projects/docReads";
import { docKindName } from "./businessUi";
import { NoteEditor } from "./NoteEditor";
import { FileView } from "./FileView";
import { UploadPanel } from "./UploadPanel";
import { resolveSelection } from "./businessUi";
import { fileIconFor, folderKindIcon, NOTE_ICON } from "./icons";
import { formatSize } from "./fileUi";
import { useT } from "@/i18n";

export interface NoteDraft { folderId: string; createdId?: string; nonce: number }

let draftCounter = 0;
/** every New note action gets its own identity, so it opens a fresh editor even for a folder that already has a draft open */
export const newDraft = (folderId: string): NoteDraft => ({ folderId, nonce: ++draftCounter });
export const draftKey = (d: NoteDraft) => `draft:${d.folderId}:${d.nonce}`;

/** The folder card counts only files that finished uploading; pending rows from a failed presign are never shown. */
export const readyFileCount = (data: DocTreeData, folderId: string) =>
  data.files.filter((f) => f.folderId === folderId && f.status === "ready").length;

interface Props {
  projectId: string;
  data: DocTreeData;
  selectedId: string | null;
  draft: NoteDraft | null;
  canEdit: boolean;
  editReason: string | null;
  /** The page says why it is read only; the pane does not repeat it. */
  quiet?: boolean;
  onCreated: (noteId: string) => void;
  onNewNote: (folderId: string) => void;
  /** A note that opens on Preview (the Project brief: the step's deliverable, read like a document). */
  previewId?: string | null;
  /** Opens a folder, note or file listed in an open folder (the same as picking it in the tree). */
  onSelect?: (id: string) => void;
}

/** What is in a folder, listed under its counts: subfolders, notes, then the files that finished uploading. */
function FolderContents({ data, folderId, onSelect }: { data: DocTreeData; folderId: string; onSelect?: (id: string) => void }) {
  const t = useT();
  const byOrder = <T extends { sortOrder: number; createdDate: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.createdDate.localeCompare(b.createdDate);
  const rows = [
    ...data.folders.filter((f) => f.parentId === folderId && f.status === "active").sort(byOrder)
      .map((f) => ({ id: f.id, label: f.name, meta: docKindName(f.kind), Icon: folderKindIcon(f.kind) })),
    ...data.notes.filter((n) => n.folderId === folderId && !n.isScratch).sort(byOrder)
      .map((n) => ({ id: n.id, label: n.title || t("analysis.business.untitledNote", "Untitled note"), meta: t("analysis.business.pane.note", "Note"), Icon: NOTE_ICON })),
    ...data.files.filter((f) => f.folderId === folderId && f.status === "ready").sort(byOrder)
      .map((f) => ({ id: f.id, label: f.name, meta: formatSize(f.sizeBytes), Icon: fileIconFor(f) })),
  ];
  if (rows.length === 0) return null;
  return (
    <ul aria-label={t("analysis.business.pane.inFolder", "In this folder")} className="mt-4 divide-y divide-line overflow-hidden rounded-block ring-1 ring-line">
      {rows.map(({ id, label, meta, Icon }) => (
        <li key={id}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(id)}
            className="flex w-full min-w-0 items-center gap-3 bg-surface px-4 py-3 text-left outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 disabled:cursor-default disabled:hover:bg-surface">
            <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{label}</span>
            <span className="shrink-0 text-[12px] text-ink3">{meta}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ItemPane({ projectId, data, selectedId, draft, canEdit, editReason: reason, onCreated, onNewNote, previewId, quiet, onSelect }: Props) {
  const t = useT();
  // quiet: the page already says once why it is read only
  const editReason = quiet ? null : reason;
  if (draft) {
    return <NoteEditor key={draftKey(draft)} projectId={projectId} noteId={draft.createdId ?? null} scratch={false} folderId={draft.folderId}
      canEdit={canEdit} editReason={editReason} onCreated={onCreated} />;
  }
  const sel = resolveSelection(data, selectedId);
  switch (sel.kind) {
    case "scratch":
      return <NoteEditor key="scratch" projectId={projectId} noteId={data.scratch?.id ?? null} scratch folderId=""
        canEdit={canEdit} editReason={editReason} onCreated={onCreated} />;
    case "note":
      return <NoteEditor key={sel.id} projectId={projectId} noteId={sel.id} scratch={false}
        folderId={data.notes.find((n) => n.id === sel.id)?.folderId ?? ""}
        canEdit={canEdit} editReason={editReason} onCreated={onCreated} initialMode={sel.id === previewId ? "preview" : "write"} />;
    case "file": {
      const file = data.files.find((f) => f.id === sel.id);
      return file ? <FileView key={file.id} projectId={projectId} file={file} canEdit={canEdit} /> : null;
    }
    case "folder": {
      const folder = data.folders.find((f) => f.id === sel.id);
      if (!folder) return null;
      // the same rows FolderContents lists, so the counts and the list always agree
      const subfolders = data.folders.filter((f) => f.parentId === folder.id && f.status === "active").length;
      const notes = data.notes.filter((n) => n.folderId === folder.id && !n.isScratch).length;
      const files = readyFileCount(data, folder.id);
      return (
        <Card key={folder.id} title={folder.name} icon={<Folder size={18} strokeWidth={1.75} />}
          action={(
            <Button variant="secondary" size="sm" disabled={!canEdit} icon={<FilePlus2 size={16} strokeWidth={1.75} aria-hidden />}
              onClick={() => onNewNote(folder.id)}>{t("analysis.business.pane.newNoteHere", "New note here")}</Button>
          )}>
          <p className="text-[14px] text-ink2">
            {docKindName(folder.kind)} · {plural(subfolders, t("analysis.business.pane.folderOne", "folder"), t("analysis.business.pane.folderMany", "folders"))} · {plural(notes, t("analysis.business.pane.noteOne", "note"), t("analysis.business.pane.noteMany", "notes"))} · {plural(files, t("analysis.business.pane.fileOne", "file"), t("analysis.business.pane.fileMany", "files"))}
          </p>
          <FolderContents data={data} folderId={folder.id} onSelect={onSelect} />
          {!canEdit && editReason && <ViewOnlyNote id="folder-view-only" text={editReason} className="mt-3" />}
          <div className="mt-5">
            <UploadPanel projectId={projectId} folderId={folder.id} canEdit={canEdit} editReason={reason} />
          </div>
        </Card>
      );
    }
    case "missing":
      return <Banner tone="warning" title={t("analysis.business.tree.dropNotFound", "This item no longer exists.")} />;
    default:
      return <p className="rounded-card bg-surface p-6 text-[14px] text-ink3 ring-1 ring-line">{t("analysis.business.pane.select", "Select a folder, note or file.")}</p>;
  }
}
