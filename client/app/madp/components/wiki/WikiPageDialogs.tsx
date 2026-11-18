/** Adding a page, renaming and deleting a person page. MADP pages are rewritten by the engine, so they offer neither. */
import { useEffect, useRef, useState } from "react";
import { wikiGroupLabel } from "./groupLabel";
import { WIKI_GROUPS, type WikiGroup, type WikiPage } from "@/madp/data/wiki/types";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { newRequestId } from "@/madp/blocks/fn";
import { useCreateWikiPage, useDeleteWikiPage, useSaveWikiPage } from "@/madp/blocks/collab/wiki";
import { TITLE_MAX } from "@/madp/domain/wiki";
import { Button, Input, Label, Modal, Select } from "@/madp/ui/kit";
import { startOnce } from "@/madp/components/sanitization/CompleteSanitizationModal";
import { useT } from "@/madp/i18n";

function Failure({ text }: { text: string | null }) {
  return text ? <p role="alert" className="mt-3 text-[13px] text-danger">{text}</p> : null;
}

export function WikiCreateDialog({ projectId, open, onClose, onCreated }: {
  projectId: string; open: boolean; onClose: () => void; onCreated: (slug: string) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState<WikiGroup>("overview");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const inFlight = useRef(false);
  const create = useCreateWikiPage();
  useEffect(() => { if (open) { setTitle(""); setGroup("overview"); setError(null); requestId.current = newRequestId(); } }, [open]);
  if (!open) return null;
  const clean = title.trim();
  const submit = () => {
    setError(null);
    startOnce(inFlight, (done) => create.mutate({ projectId, title: clean, pageGroup: group, requestId: requestId.current }, {
      onSuccess: (page) => { requestId.current = newRequestId(); onClose(); onCreated(page.slug); },
      onError: (e) => setError(collabErrorMessage(e)),
      onSettled: done,
    }));
  };
  return (
    <Modal open onClose={onClose} width={480} title={t("wiki.common.addPage", "Add a page")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("wiki.common.cancel", "Cancel")}</Button>
        <Button variant="primary" disabled={create.isPending || clean === "" || clean.length > TITLE_MAX} onClick={submit}>
          {create.isPending ? t("wiki.dialogs.adding", "Adding…") : t("wiki.dialogs.add", "Add page")}
        </Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (clean && !create.isPending) submit(); }}>
        <Label>{t("wiki.dialogs.title", "Title")}</Label>
        <Input value={title} maxLength={TITLE_MAX} autoFocus aria-label={t("wiki.dialogs.titleAria", "Page title")} onChange={(e) => setTitle(e.target.value)} />
        <div className="mt-4">
          <Label>{t("wiki.dialogs.group", "Group")}</Label>
          <Select label={t("wiki.dialogs.group", "Group")} value={group} onChange={(v) => setGroup(v as WikiGroup)}
            options={WIKI_GROUPS.map((g) => ({ value: g.id, label: wikiGroupLabel(g.id) }))} />
        </div>
        <Failure text={error} />
      </form>
    </Modal>
  );
}

export function WikiRenameDialog({ page, onClose }: { page: WikiPage | null; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const inFlight = useRef(false);
  const save = useSaveWikiPage();
  useEffect(() => { setTitle(page?.title ?? ""); setError(null); requestId.current = newRequestId(); }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page) return null;
  const clean = title.trim();
  const submit = () => {
    setError(null);
    startOnce(inFlight, (done) => save.mutate({ projectId: page.projectId, pageId: page.id, bodyMd: page.bodyMd, title: clean, expectedUpdatedAt: page.updatedAt, requestId: requestId.current }, {
      onSuccess: () => onClose(),
      onError: (e) => setError(collabErrorMessage(e)),
      onSettled: done,
    }));
  };
  return (
    <Modal open onClose={onClose} width={480} title={t("wiki.dialogs.renameTitle", "Rename · {title}", { title: page.title })}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("wiki.common.cancel", "Cancel")}</Button>
        <Button variant="primary" disabled={save.isPending || clean === "" || clean === page.title || clean.length > TITLE_MAX} onClick={submit}>
          {save.isPending ? t("wiki.common.saving", "Saving…") : t("wiki.dialogs.rename", "Rename")}
        </Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (clean && clean !== page.title && !save.isPending) submit(); }}>
        <Label>{t("wiki.dialogs.title", "Title")}</Label>
        <Input value={title} maxLength={TITLE_MAX} autoFocus aria-label={t("wiki.dialogs.titleAria", "Page title")} onChange={(e) => setTitle(e.target.value)} />
        <Failure text={error} />
      </form>
    </Modal>
  );
}

export function WikiDeleteDialog({ page, onClose, onDeleted }: { page: WikiPage | null; onClose: () => void; onDeleted: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const inFlight = useRef(false);
  const del = useDeleteWikiPage();
  useEffect(() => { setError(null); setRemaining(null); }, [page?.id]);
  if (!page) return null;
  const submit = () => {
    setError(null);
    startOnce(inFlight, (done) => del.mutate({ projectId: page.projectId, pageId: page.id, onProgress: setRemaining }, {
      onSuccess: () => { onClose(); onDeleted(); },
      onError: (e) => setError(collabErrorMessage(e)),
      onSettled: done,
    }));
  };
  return (
    <Modal open onClose={del.isPending ? () => undefined : onClose} width={480} title={t("wiki.dialogs.deleteTitle", "Delete this page?")}
      footer={<>
        <Button variant="ghost" disabled={del.isPending} onClick={onClose}>{t("wiki.dialogs.keepPage", "Keep the page")}</Button>
        <Button variant="danger" disabled={del.isPending} onClick={submit}>{del.isPending ? t("wiki.dialogs.deleting", "Deleting…") : t("wiki.dialogs.delete", "Delete page")}</Button>
      </>}>
      <p className="text-[14px] text-ink2">{t("wiki.dialogs.deleteText", "“{title}” and its earlier versions are removed for everyone. This cannot be undone.", { title: page.title })}</p>
      {del.isPending && remaining !== null && remaining > 0 && (
        <p role="status" className="num mt-3 text-[13px] text-ink2">{t("wiki.dialogs.deleteProgress", "{count} earlier versions left to remove…", { count: remaining })}</p>
      )}
      <Failure text={error} />
    </Modal>
  );
}
