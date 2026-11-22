/** One stored file: details, an inline preview for raster images, Open / Download on demand. URLs are never kept beyond their expiry. */
import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Banner, Button } from "@/ui/kit";
import { formatDateTime } from "@/lib/dates";
import { getFileUrl } from "@/blocks/projects/docMutations";
import { messageFor } from "@/blocks/projects/messages";
import { useMemberName } from "@/blocks/projects/context";
import type { DocFileRecord } from "@/blocks/projects/records";
import { extensionOf, formatSize, openMode } from "./fileUi";
import { fileIconFor } from "./icons";
import { t, useT } from "@/i18n";

export interface FileViewProps { projectId: string; file: DocFileRecord; canEdit: boolean }

function typeLabel(name: string, mime: string): string {
  const ext = extensionOf(name);
  return ext ? ext.toUpperCase() : mime || t("analysis.business.file.file", "File");
}

function when(iso: string): string {
  return formatDateTime(iso);
}

export function FileView({ projectId, file }: FileViewProps) {
  const t = useT();
  const mode = openMode(file);
  const uploader = useMemberName(file.createdByUserId);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = fileIconFor({ name: file.name, mime: file.mime });

  // inline preview: only for the selected raster image; refetched when the short-lived URL expires
  useEffect(() => {
    setImgUrl(null); setLink(null); setError(null);
    if (mode !== "inline-image" || file.status !== "ready") return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      getFileUrl(projectId, file.id).then(
        (r) => {
          if (dead) return;
          setImgUrl(r.url); setError(null);
          const wait = Math.max(5_000, new Date(r.expiresAt).getTime() - Date.now() - 10_000);
          timer = setTimeout(load, Number.isFinite(wait) ? wait : 60_000);
        },
        (e) => { if (!dead) setError(messageFor(e)); },
      );
    };
    load();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [projectId, file.id, file.status, mode]);

  const go = async () => {
    setBusy(true); setError(null); setLink(null);
    try {
      const { url } = await getFileUrl(projectId, file.id);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w === null) setLink(url);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <Icon size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink2" aria-hidden />
        <div className="min-w-0">
          <h2 className="break-words text-[18px] font-medium text-ink">{file.name}</h2>
          <p className="mt-1 text-[13px] text-ink2">
            {typeLabel(file.name, file.mime)} · {formatSize(file.sizeBytes)}
          </p>
          <p className="text-[13px] text-ink2">{t("analysis.business.file.uploadedBy", "Uploaded by {name} · {when}", { name: uploader, when: when(file.createdDate) })}</p>
        </div>
      </div>
      {error && <Banner tone="danger" title={error} />}
      {mode === "inline-image" && imgUrl && (
        <img src={imgUrl} alt={file.name} className="max-h-[480px] max-w-full rounded-block object-contain" />
      )}
      {file.status === "ready" ? (
        <div className="flex flex-wrap items-center gap-3">
          {mode !== "inline-image" && (
            <Button variant="secondary" disabled={busy} onClick={() => void go()}
              icon={mode === "open" ? <ExternalLink size={16} strokeWidth={1.75} aria-hidden /> : <Download size={16} strokeWidth={1.75} aria-hidden />}>
              {mode === "open" ? t("analysis.business.file.open", "Open") : t("analysis.business.file.download", "Download")}
            </Button>
          )}
          {mode === "inline-image" && (
            <Button variant="secondary" disabled={busy} onClick={() => void go()} icon={<Download size={16} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.file.download", "Download")}</Button>
          )}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-[14px] text-[rgb(var(--c-accent-text))] underline underline-offset-2">{t("analysis.business.file.openFile", "Open file")}</a>}
        </div>
      ) : (
        <p className="text-[13px] text-ink2">{t("analysis.business.file.notReady", "This file isn't ready yet.")}</p>
      )}
    </div>
  );
}
