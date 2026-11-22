/** One sample row. SampleCardView is presentational; SampleCard holds the thumbnail query (useSampleUrl) and the remove write. */
import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, FileText, RotateCw, Trash2 } from "lucide-react";
import { Button, Chip } from "@/ui/kit";
import { useSampleUrl } from "@/blocks/requirements/hooks";
import { useDeleteSample } from "@/blocks/requirements/mutations";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import { formatBytes, failedReasonText, pick, rejectReasonText, type SampleEntry } from "./designUi";
import { useT } from "@/i18n";

export function SampleCardView({ entry, editable, canUp, canDown, error, removing = false, onRemove, onUp, onDown, onRetry, onImageError }: {
  entry: SampleEntry; editable: boolean; canUp: boolean; canDown: boolean; error?: string | null; removing?: boolean;
  onRemove?: () => void; onUp?: () => void; onDown?: () => void; onRetry?: () => void; onImageError?: () => void;
}) {
  const t = useT();
  // the uploaded file is deleted for good: Remove asks once, and stays off while the delete runs
  const [confirming, setConfirming] = useState(false);
  const isImage = entry.mime.startsWith("image/");
  const url = entry.url ?? null;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 p-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-block bg-surface text-ink2 ring-1 ring-line">
        {isImage && entry.state === "ready" && url
          ? <img src={url} alt={entry.fileName} referrerPolicy="no-referrer" loading="lazy" onError={onImageError} className="h-full w-full object-cover" />
          : <FileText size={22} strokeWidth={1.75} aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{entry.fileName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink3">
          <span>{formatBytes(entry.sizeBytes)}</span>
          {entry.state === "uploading" && <Chip tone="accent">{t("analysis.design.sample.uploading", "Uploading…")}</Chip>}
          {entry.state === "ready" && <Chip tone="success">{t("analysis.design.sample.ready", "Ready")}</Chip>}
          {entry.state === "rejected" && <Chip tone="danger">{t("analysis.design.sample.rejected", "Rejected")}</Chip>}
          {entry.state === "failed" && <Chip tone="danger">{t("analysis.design.sample.failed", "Upload failed")}</Chip>}
        </p>
        {entry.state === "rejected" && <p className="mt-1 text-[12px] text-danger">{rejectReasonText(entry.reason)}</p>}
        {entry.state === "failed" && <p className="mt-1 text-[12px] text-danger">{failedReasonText(entry.reason, entry.message)}</p>}
        {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!isImage && entry.state === "ready" && url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line hover:bg-line">
            Open<ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </a>
        )}
        {entry.state === "failed" && entry.reason !== "storage" && onRetry && <Button size="sm" variant="ghost" icon={<RotateCw size={14} strokeWidth={1.75} aria-hidden />} onClick={onRetry}>{t("analysis.design.sample.retry", "Retry")}</Button>}
        {editable && entry.state === "ready" && entry.attachmentId && (
          <>
            <Button size="sm" variant="ghost" disabled={!canUp} onClick={onUp} aria-label={t("analysis.design.sample.moveUpAria", "Move up {name}", { name: entry.fileName })} icon={<ArrowUp size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.design.sample.moveUp", "Move up")}</Button>
            <Button size="sm" variant="ghost" disabled={!canDown} onClick={onDown} aria-label={t("analysis.design.sample.moveDownAria", "Move down {name}", { name: entry.fileName })} icon={<ArrowDown size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.design.sample.moveDown", "Move down")}</Button>
            {confirming ? (
              <span role="group" aria-label={t("analysis.design.sample.removeAria", "Remove {name}", { name: entry.fileName })} className="inline-flex flex-wrap items-center gap-1.5 text-[13px]">
                {t("analysis.design.sample.deleteConfirm", "Delete this file?")}
                <Button size="sm" variant="ghost" disabled={removing} onClick={() => setConfirming(false)}>{t("analysis.design.sample.keep", "Keep")}</Button>
                <Button size="sm" variant="danger" disabled={removing} aria-busy={removing || undefined} onClick={() => { setConfirming(false); onRemove?.(); }}>{t("analysis.design.sample.remove", "Remove")}</Button>
              </span>
            ) : (
              <Button size="sm" variant="danger" disabled={removing} onClick={() => setConfirming(true)} aria-label={t("analysis.design.sample.removeAria", "Remove {name}", { name: entry.fileName })} icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.design.sample.remove", "Remove")}</Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function SampleCard({ projectId, entry, editable, canUp, canDown, onMove, onRetry }: {
  projectId: string; entry: SampleEntry; editable: boolean; canUp: boolean; canDown: boolean;
  onMove: (dir: -1 | 1) => void; onRetry?: () => void;
}) {
  const showUrl = entry.state === "ready" && entry.attachmentId ? entry.attachmentId : null;
  const q = useSampleUrl(projectId, showUrl);
  const del = useDeleteSample(projectId);
  const [error, setError] = useState<string | null>(null);
  const data = pick(q as unknown as { data?: { url: string } | null });
  const refetch = (q as unknown as { refetch?: () => unknown }).refetch;
  const remove = async () => {
    if (!entry.attachmentId) return;
    setError(null);
    try { await del.mutateAsync({ attachmentId: entry.attachmentId }); } catch (e) { setError(requirementsErrorMessage(e)); }
  };
  return (
    <SampleCardView entry={{ ...entry, url: data?.url ?? null }} editable={editable} canUp={canUp} canDown={canDown} error={error} removing={del.isPending}
      onRemove={remove} onUp={() => onMove(-1)} onDown={() => onMove(1)} onRetry={onRetry} onImageError={() => { void refetch?.(); }} />
  );
}
