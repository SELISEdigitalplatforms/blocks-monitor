/** A page's earlier bodies (at most 50): who wrote each, when, and a way back to it. */
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { WikiPage } from "@/madp/data/wiki/types";
import { Markdown } from "@/madp/components/wiki/Markdown";
import { formatWhen } from "@/madp/components/wiki/useWiki";
import { useMemberName } from "@/madp/blocks/collab/context";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { newRequestId } from "@/madp/blocks/fn";
import { useRestoreWikiPage, useWikiHistory } from "@/madp/blocks/collab/wiki";
import type { WikiHistoryRecord } from "@/madp/blocks/collab/records";
import { cn } from "@/madp/lib/cn";
import { Button, Chip, Drawer } from "@/madp/ui/kit";
import { t, useT } from "@/madp/i18n";

/** Who the Factory's own edits are shown as. */
export const factoryEditor = (): string => t("wiki.history.factoryEditor", "Your team");

function Editor({ entry }: { entry: WikiHistoryRecord }) {
  useT();
  const name = useMemberName(entry.editedByUserId);
  return <span className="text-[14px] font-medium">{entry.origin === "factory" ? factoryEditor() : name}</span>;
}

export function WikiHistoryDrawer({ page, canEdit, onClose }: { page: WikiPage | null; canEdit: boolean; onClose: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const history = useWikiHistory(page?.id);
  const restore = useRestoreWikiPage();
  useEffect(() => { setOpen(null); setStatus(null); }, [page?.id]);
  if (!page) return null;
  const entries = history.data ?? [];
  const currentId = entries.find((e) => e.bodyMd === page.bodyMd)?.id;

  const run = (entry: WikiHistoryRecord) => {
    setBusy(entry.id);
    setStatus(null);
    restore.mutate({ projectId: page.projectId, pageId: page.id, historyId: entry.id, expectedUpdatedAt: page.updatedAt, requestId: newRequestId() }, {
      onSuccess: () => { setBusy(null); setStatus({ tone: "ok", text: t("wiki.history.restored", "The earlier version is restored.") }); },
      onError: (e) => { setBusy(null); setStatus({ tone: "error", text: collabErrorMessage(e) }); },
    });
  };

  return (
    <Drawer open onClose={onClose} width={520} title={t("wiki.history.title", "History · {title}", { title: page.title })}>
      {status && (status.tone === "ok"
        ? <p role="status" className="mb-3 text-[13px] text-ink2">{status.text}</p>
        : <p role="alert" className="mb-3 text-[13px] text-danger">{status.text}</p>)}
      {history.isLoading ? (
        <div aria-hidden className="hatched h-24 rounded-block bg-surface2/60" />
      ) : history.error ? (
        <p role="alert" className="text-[14px] text-danger">{t("wiki.history.loadFailed", "We couldn't load the earlier versions. Close this and try again.")}</p>
      ) : entries.length === 0 ? (
        <p className="text-[14px] text-ink2">{t("wiki.history.none", "No earlier versions yet.")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => {
            const shown = open === e.id;
            const current = e.id === currentId;
            return (
              <li key={e.id} className="rounded-block bg-surface2">
                <div className="flex flex-wrap items-center gap-2 pr-3">
                  <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? null : e.id)}
                    className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-block px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50")}>
                    <Editor entry={e} />
                    <span className="num text-[12px] text-ink3">{formatWhen(e.at)}</span>
                    {current && <Chip tone="accent">{t("wiki.history.current", "Current")}</Chip>}
                  </button>
                  {canEdit && !current && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />}
                      disabled={busy !== null} onClick={() => run(e)}>
                      {busy === e.id ? t("wiki.history.restoring", "Restoring…") : t("wiki.history.restore", "Restore")}
                    </Button>
                  )}
                </div>
                {shown && <div className="px-4 pb-4"><Markdown md={e.bodyMd} compact /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
