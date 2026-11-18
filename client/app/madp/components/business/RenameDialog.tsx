/** Rename a folder (name and kind), a note (title) or a file (display name). */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Banner, Button, Input, Label, Modal, Select } from "@/madp/ui/kit";
import { useRenameFile, useRenameFolder, useSaveNote } from "@/madp/blocks/projects/docMutations";
import { useDocNoteBody } from "@/madp/blocks/projects/docReads";
import { showToast } from "@/madp/ui/Toast";
import { messageFor } from "@/madp/blocks/projects/messages";
import { useT } from "@/madp/i18n";
import {
  checkFolderName, checkNoteTitle, cleanDisplayName, DOC_KINDS, FILE_NAME_MAX, FOLDER_NAME_MAX, NOTE_TITLE_MAX,
  type DocItemKind, type DocKind,
} from "../../domain/docs";
import { docKindName } from "./businessUi";
import { checkMessage } from "./treeModel";

export interface RenameDialogProps {
  open: boolean;
  projectId: string;
  kind: DocItemKind;
  id: string;
  /** the current name / title */
  name: string;
  /** folders only */
  folderKind?: DocKind;
  onClose: () => void;
}

const MAX: Record<DocItemKind, number> = { folder: FOLDER_NAME_MAX, note: NOTE_TITLE_MAX, file: FILE_NAME_MAX };

export function RenameDialog({ open, projectId, kind, id, name: current, folderKind = "other", onClose }: RenameDialogProps) {
  const t = useT();
  // read at render time, so the kinds follow the current language
  const KIND_OPTIONS = DOC_KINDS.map((k) => ({ value: k, label: docKindName(k) }));
  const renameFolder = useRenameFolder();
  const renameFile = useRenameFile();
  const saveNote = useSaveNote();
  // a rename of a note is a save with the same body, so the body and its LastUpdatedDate are loaded first
  const body = useDocNoteBody(open && kind === "note" ? id : null);
  const [name, setName] = useState(current);
  const [folderK, setFolderK] = useState<DocKind>(folderKind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setName(current); setFolderK(folderKind); setError(null); }
  }, [open, current, folderKind]);

  const loading = kind === "note" && !body.data && !body.error;
  const noteMissing = kind === "note" && body.isSuccess && !body.data;

  const sending = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current || loading) return;
    const check = kind === "folder" ? checkFolderName(name) : kind === "note" ? checkNoteTitle(name) : cleanDisplayName(name);
    if (!check.ok) { setError(checkMessage(check)); return; }
    setError(null);
    sending.current = true;
    setBusy(true);
    try {
      if (kind === "folder") await renameFolder.run({ projectId, folderId: id, name: check.value, kind: folderK });
      else if (kind === "file") await renameFile.run({ projectId, fileId: id, name: check.value });
      else {
        const note = body.data;
        if (!note) throw new Error("note not loaded");
        await saveNote.run({
          projectId, noteId: id, folderId: note.folderId, title: check.value, bodyMd: note.bodyMd ?? "",
          expectedUpdatedAt: note.lastUpdatedDate,
        });
      }
      showToast(t("analysis.business.rename.renamed", "Renamed to '{name}'.", { name: check.value }));
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const title = kind === "folder" ? t("analysis.business.rename.folder", "Rename folder") : kind === "note" ? t("analysis.business.rename.note", "Rename note") : t("analysis.business.rename.file", "Rename file");
  return (
    <Modal open={open} onClose={onClose} title={title} width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("analysis.business.cancel", "Cancel")}</Button>
          <Button variant="secondary" type="submit" form="rename-form" disabled={busy || loading || noteMissing}>{busy ? t("analysis.business.saving", "Saving…") : t("analysis.business.rename.rename", "Rename")}</Button>
        </>
      }>
      <form id="rename-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label>{kind === "note" ? t("analysis.business.title", "Title") : t("analysis.business.name", "Name")}</Label>
          <Input data-autofocus value={name} maxLength={MAX[kind]} aria-label={kind === "note" ? t("analysis.business.rename.noteTitle", "Note title") : kind === "file" ? t("analysis.business.rename.fileName", "File name") : t("analysis.business.folder.name", "Folder name")}
            aria-invalid={error ? true : undefined} onChange={(e) => setName(e.target.value)} />
        </div>
        {kind === "folder" && (
          <div>
            <Label>{t("analysis.business.kindLabel", "Kind")}</Label>
            <Select label={t("analysis.business.folder.kind", "Folder kind")} value={folderK} onChange={(v) => setFolderK(v as DocKind)} options={KIND_OPTIONS} />
          </div>
        )}
        {loading && <p role="status" className="text-[13px] text-ink3">{t("analysis.business.rename.loadingNote", "Loading the note…")}</p>}
        {body.error ? <Banner tone="danger" title={messageFor(body.error)} /> : null}
        {noteMissing && <Banner tone="danger" title={t("analysis.business.tree.dropNotFound", "This item no longer exists.")} />}
        {error && <Banner tone="danger" title={error} />}
      </form>
    </Modal>
  );
}
