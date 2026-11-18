/** Confirm a delete with what goes; a folder shows real progress and can be finished again when interrupted. */
import { useEffect, useRef, useState } from "react";
import { Banner, Button, Modal } from "@/madp/ui/kit";
import { useDeleteFile, useDeleteFolder, useDeleteNote } from "@/madp/blocks/projects/docMutations";
import { showToast } from "@/madp/ui/Toast";
import { messageFor } from "@/madp/blocks/projects/messages";
import { t, useT } from "@/madp/i18n";
import type { DocRef, DocTree } from "../../domain/docs";
import { deleteSummary } from "./treeModel";

export interface DeleteDialogProps {
  open: boolean;
  projectId: string;
  tree: DocTree;
  item: DocRef;
  onClose: () => void;
  /** called after the delete finished (the row is gone) */
  onDeleted?: (item: DocRef) => void;
}

export function progressText(remaining: number | null): string | null {
  if (remaining === null) return null;
  return remaining === 1 ? t("analysis.business.delete.oneLeft", "1 item left") : t("analysis.business.delete.itemsLeft", "{count} items left", { count: remaining });
}

export function DeleteDialog({ open, projectId, tree, item, onClose, onDeleted }: DeleteDialogProps) {
  const t = useT();
  const folder = useDeleteFolder();
  const note = useDeleteNote();
  const file = useDeleteFile();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(() => deleteSummary(tree, item));
  const nameRef = useRef(tree.byId.get(item.id)?.label ?? t("analysis.business.delete.thisItem", "This item"));

  // the text is fixed while the delete runs (the tree shrinks under it)
  useEffect(() => {
    if (open) { setSummary(deleteSummary(tree, item)); nameRef.current = tree.byId.get(item.id)?.label ?? t("analysis.business.delete.thisItem", "This item"); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  const going = useRef(false);
  const go = async () => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setError(null);
    try {
      if (item.kind === "folder") await folder.run({ projectId, folderId: item.id });
      else if (item.kind === "note") await note.run({ projectId, noteId: item.id });
      else await file.run({ projectId, fileId: item.id });
      showToast(t("analysis.business.delete.deleted", "'{name}' deleted.", { name: nameRef.current }));
      onDeleted?.(item);
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      going.current = false;
      setBusy(false);
    }
  };

  const progress = item.kind === "folder" ? progressText(folder.remaining) : null;
  const interrupted = item.kind === "folder" && Boolean(error);

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={summary.title} width={460}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t("analysis.business.cancel", "Cancel")}</Button>
          <Button variant="danger" disabled={busy} onClick={go}>
            {busy ? t("analysis.business.delete.deleting", "Deleting…") : interrupted ? t("analysis.business.delete.finish", "Finish deleting") : t("analysis.business.delete.delete", "Delete")}
          </Button>
        </>
      }>
      <p className="break-words text-[14px] text-ink2">{summary.message}</p>
      {progress && busy && <p role="status" aria-live="polite" className="mt-3 text-[13px] text-ink2">{progress}</p>}
      {error && (
        <Banner tone="danger" className="mt-4" title={error}
          text={interrupted ? t("analysis.business.delete.interrupted", "Some items are already gone. Finish deleting to remove the rest.") : undefined} />
      )}
    </Modal>
  );
}
