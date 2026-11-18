/** "New folder": a name and a kind. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Banner, Button, Input, Label, Modal, Select } from "@/madp/ui/kit";
import { useCreateFolder } from "@/madp/blocks/projects/docMutations";
import { showToast } from "@/madp/ui/Toast";
import { useDocTree } from "@/madp/blocks/projects/docReads";
import { messageFor } from "@/madp/blocks/projects/messages";
import { useT } from "@/madp/i18n";
import { checkFolderName, DOC_KINDS, FOLDER_NAME_MAX, type DocKind } from "../../domain/docs";
import { docKindName } from "./businessUi";
import { checkMessage } from "./treeModel";

export interface NewFolderDialogProps {
  open: boolean;
  projectId: string;
  parentId: string;
  onClose: () => void;
  onCreated: (folderId: string) => void;
}

export function NewFolderDialog({ open, projectId, parentId, onClose, onCreated }: NewFolderDialogProps) {
  const t = useT();
  // read at render time, so the kinds follow the current language
  const KIND_OPTIONS = DOC_KINDS.map((k) => ({ value: k, label: docKindName(k) }));
  const { run, isPending } = useCreateFolder();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocKind>("meeting");
  const [error, setError] = useState<string | null>(null);
  const [topLevel, setTopLevel] = useState(false);
  const folders = useDocTree(projectId).data?.folders;
  const parentName = parentId ? folders?.find((f) => f.id === parentId)?.name ?? t("analysis.business.folder.thisFolder", "this folder") : "";

  useEffect(() => {
    if (open) { setName(""); setKind("meeting"); setError(null); setTopLevel(false); }
  }, [open]);

  const sending = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current || isPending) return;
    const check = checkFolderName(name);
    if (!check.ok) { setError(checkMessage(check)); return; }
    setError(null);
    sending.current = true;
    try {
      const folder = await run({ projectId, parentId: topLevel ? "" : parentId, name: check.value, kind });
      showToast(t("analysis.business.folder.created", "Folder '{name}' created.", { name: check.value }));
      onCreated(folder.id);
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      sending.current = false;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("analysis.business.folder.new", "New folder")} width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("analysis.business.cancel", "Cancel")}</Button>
          <Button variant="secondary" type="submit" form="new-folder-form" disabled={isPending}>{isPending ? t("analysis.business.folder.creating", "Creating…") : t("analysis.business.folder.create", "Create folder")}</Button>
        </>
      }>
      <form id="new-folder-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink2">{t("analysis.business.folder.where", "Where")}</legend>
          {parentId ? (
            <div className="flex flex-col gap-1.5 text-[14px] text-ink">
              <label className="flex items-center gap-2">
                <input type="radio" name="new-folder-where" checked={!topLevel} onChange={() => setTopLevel(false)} className="accent-accent" />
                <span className="min-w-0 break-words">{t("analysis.business.folder.inside", "Inside '{name}'", { name: parentName })}</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="new-folder-where" checked={topLevel} onChange={() => setTopLevel(true)} className="accent-accent" />
                <span>{t("analysis.business.folder.atTop", "At the top level")}</span>
              </label>
            </div>
          ) : <p className="text-[14px] text-ink">{t("analysis.business.folder.atTop", "At the top level")}</p>}
        </fieldset>
        <div>
          <Label>{t("analysis.business.name", "Name")}</Label>
          <Input data-autofocus value={name} maxLength={FOLDER_NAME_MAX} aria-label={t("analysis.business.folder.name", "Folder name")} aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)} placeholder={t("analysis.business.folder.placeholder", "Kick-off")} />
        </div>
        <div>
          <Label>{t("analysis.business.kindLabel", "Kind")}</Label>
          <Select label={t("analysis.business.folder.kind", "Folder kind")} value={kind} onChange={(v) => setKind(v as DocKind)} options={KIND_OPTIONS} />
        </div>
        {error && <Banner tone="danger" title={error} />}
      </form>
    </Modal>
  );
}
