/** Editing a wiki page: a simple markdown editor with a preview. A page someone else changed meanwhile is never overwritten silently. */
import { useEffect, useRef, useState } from "react";
import type { WikiPage } from "@/madp/data/wiki/types";
import { Markdown } from "@/madp/components/wiki/Markdown";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { newRequestId, FunctionError } from "@/madp/blocks/fn";
import { useSaveWikiPage, useWikiBody } from "@/madp/blocks/collab/wiki";
import { BODY_MAX } from "@/madp/domain/wiki";
import { Button, Modal, Tabs, Textarea } from "@/madp/ui/kit";
import { startOnce } from "@/madp/components/sanitization/CompleteSanitizationModal";
import { useCulture, useT } from "@/madp/i18n";

/** True for the answer of a save that found the page changed by someone else. */
export function isStaleSave(e: unknown): boolean {
  return e instanceof FunctionError && e.messageKey === "wiki.stale";
}

export function StaleNotice({ busy, onLoad, onKeep }: { busy: boolean; onLoad: () => void; onKeep: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="mb-4 rounded-block bg-warning-soft px-4 py-3 text-[14px]">
      <div className="font-medium">{t("wiki.editor.staleTitle", "Someone else changed this page.")}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onLoad}>{t("wiki.editor.loadTheirs", "Load their version")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onKeep}>{t("wiki.editor.keepMine", "Keep mine")}</Button>
      </div>
    </div>
  );
}

export function DiscardNotice({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="mb-4 rounded-block bg-warning-soft px-4 py-3 text-[14px]">
      <div className="font-medium">{t("wiki.editor.discardTitle", "Discard your changes to this page?")}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onKeep}>{t("wiki.editor.keepEditing", "Keep editing")}</Button>
        <Button size="sm" variant="danger" onClick={onDiscard}>{t("wiki.editor.discard", "Discard changes")}</Button>
      </div>
    </div>
  );
}

export function WikiEditModal({ page, onClose }: { page: WikiPage | null; onClose: () => void }) {
  const t = useT();
  const culture = useCulture();
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [expected, setExpected] = useState("");
  const [loadingTheirs, setLoadingTheirs] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestId = useRef(newRequestId());
  const inFlight = useRef(false);
  const save = useSaveWikiPage();
  const latest = useWikiBody(page?.id);
  useEffect(() => {
    setDraft(page?.bodyMd ?? "");
    setExpected(page?.updatedAt ?? "");
    setTab("write"); setError(null); setStale(false); setConfirmDiscard(false);
    requestId.current = newRequestId();
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page) return null;

  const send = (expectedUpdatedAt: string) => {
    setError(null);
    startOnce(inFlight, (done) => save.mutate({ projectId: page.projectId, pageId: page.id, bodyMd: draft, expectedUpdatedAt, requestId: requestId.current }, {
      onSuccess: () => { requestId.current = newRequestId(); onClose(); },
      onError: (e) => {
        if (isStaleSave(e)) { setStale(true); requestId.current = newRequestId(); } else setError(collabErrorMessage(e));
      },
      onSettled: done,
    }));
  };
  const theirs = async () => {
    setLoadingTheirs(true);
    try {
      const r = await latest.refetch();
      return r.data ?? null;
    } catch { return null; } finally { setLoadingTheirs(false); }
  };
  const loadTheirs = async () => {
    const got = await theirs();
    if (!got) { setError(t("wiki.editor.loadTheirsFailed", "We couldn't load their version. Try again.")); return; }
    setDraft(got.bodyMd); setExpected(got.updatedAt); setStale(false); setError(null);
  };
  const keepMine = async () => {
    const got = await theirs();
    if (!got) { setError(t("wiki.editor.loadTheirsFailed", "We couldn't load their version. Try again.")); return; }
    setExpected(got.updatedAt); setStale(false);
    send(got.updatedAt);
  };

  const tooLong = draft.length > BODY_MAX;
  // Cancel, Escape, the X and the scrim never drop typed Markdown without asking first
  const dirty = draft !== page.bodyMd;
  const requestClose = () => { if (dirty && !confirmDiscard) setConfirmDiscard(true); else onClose(); };
  return (
    <Modal open onClose={requestClose} width={760} title={t("wiki.editor.title", "Edit · {title}", { title: page.title })}
      footer={<>
        <Button variant="ghost" onClick={requestClose}>{t("wiki.common.cancel", "Cancel")}</Button>
        <Button variant="primary" disabled={save.isPending || stale || tooLong || draft === page.bodyMd} onClick={() => send(expected)}>
          {save.isPending ? t("wiki.common.saving", "Saving…") : t("wiki.common.save", "Save")}
        </Button>
      </>}>
      {confirmDiscard && <DiscardNotice onKeep={() => setConfirmDiscard(false)} onDiscard={onClose} />}
      {stale && <StaleNotice busy={loadingTheirs} onLoad={loadTheirs} onKeep={keepMine} />}
      <Tabs idPrefix="wiki-edit" label={t("wiki.editor.tabsLabel", "Editor")} value={tab} onChange={setTab} className="mb-4"
        tabs={[{ value: "write", label: t("wiki.editor.write", "Write") }, { value: "preview", label: t("wiki.editor.preview", "Preview") }]} />
      {tab === "write" ? (
        <div role="tabpanel" id="wiki-edit-panel-write" aria-labelledby="wiki-edit-tab-write">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t("wiki.editor.contentAria", "Page content in Markdown")} spellCheck
            className="min-h-[360px] font-mono text-[13px]" />
          <p className="mt-2 text-[12px] text-ink3">{t("wiki.editor.syntaxHint", "## Heading · - List · | Table | · ``` Code · > Note:")}</p>
          {tooLong && <p className="mt-1 text-[12px] text-danger">{t("wiki.editor.tooLong", "The page is longer than {max} characters.", { max: BODY_MAX.toLocaleString(culture === "de-CH" ? "de-CH" : "en-GB") })}</p>}
        </div>
      ) : (
        <div role="tabpanel" id="wiki-edit-panel-preview" aria-labelledby="wiki-edit-tab-preview" className="min-h-[360px] rounded-block bg-surface2 p-5">
          <Markdown md={draft} />
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
    </Modal>
  );
}
