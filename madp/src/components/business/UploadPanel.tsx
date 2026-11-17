/** Upload button, drop zone and the honest queue (states only; the SDK has no progress callback). */
import { useRef, useState, type DragEvent } from "react";
import { UploadCloud, X, RotateCw } from "lucide-react";
import { Button } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { useUploadQueue } from "@/blocks/projects/upload";
import { ACCEPTED_EXTENSIONS } from "../../domain/docs";
import { fileIconFor } from "./icons";
import { formatSize, uploadStatusText } from "./fileUi";
import { useT } from "@/i18n";

const accept = Array.isArray(ACCEPTED_EXTENSIONS)
  ? (ACCEPTED_EXTENSIONS as readonly string[]).map((e) => (e.startsWith(".") ? e : `.${e}`)).join(",")
  : String(ACCEPTED_EXTENSIONS);

export function UploadButton({ projectId, folderId, disabled }: { projectId: string; folderId: string; disabled?: boolean }) {
  const t = useT();
  const q = useUploadQueue(projectId);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" multiple accept={accept} className="hidden" tabIndex={-1} aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) q.add(files, folderId);
        }} />
      <Button variant="secondary" disabled={disabled} onClick={() => input.current?.click()}
        icon={<UploadCloud size={16} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.upload.files", "Upload files")}</Button>
    </>
  );
}

/** The queue rows: phase, size, the exact refusal reason, Retry and Cancel/Remove. Filtered by folder when one is given. */
export function UploadQueue({ projectId, folderId, activeOnly }: { projectId: string; folderId?: string; activeOnly?: boolean }) {
  const t = useT();
  const q = useUploadQueue(projectId);
  const inFolder = folderId === undefined ? q.items : q.items.filter((it) => it.folderId === folderId);
  // activeOnly: what is still on its way or failed (a finished file shows in the tree)
  const items = activeOnly ? inFolder.filter((it) => it.phase !== "done") : inFolder;
  if (activeOnly && items.length === 0) return null;
  return (
    <ul aria-live="polite" className="flex flex-col gap-2">
      {items.map((it) => {
        const Icon = fileIconFor({ name: it.name, mime: "" });
        const busy = it.phase === "checking" || it.phase === "uploading" || it.phase === "verifying" || it.phase === "queued";
        return (
          <li key={it.id} className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 px-4 py-2.5">
            <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.name}</span>
            <span className="text-[13px] text-ink3">{formatSize(it.sizeBytes)}</span>
            <span className={cn("text-[13px]", it.phase === "failed" ? "text-danger" : "text-ink2")}>
              {uploadStatusText(it)}
            </span>
            {it.phase === "failed" && it.retryable !== false && (
              <Button size="sm" variant="ghost" onClick={() => q.retry(it.id)} icon={<RotateCw size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.retry", "Retry")}</Button>
            )}
            {busy ? (
              <Button size="sm" variant="ghost" onClick={() => q.cancel(it.id)} icon={<X size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.cancel", "Cancel")}</Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label={t("analysis.business.upload.removeName", "Remove {name}", { name: it.name })} onClick={() => q.remove(it.id)} icon={<X size={14} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.upload.remove", "Remove")}</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function UploadPanel({ projectId, folderId, canEdit, editReason }: { projectId: string; folderId: string; canEdit: boolean; editReason: string | null }) {
  const t = useT();
  const q = useUploadQueue(projectId);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!canEdit) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) q.add(files, folderId);
  };
  const stop = (e: DragEvent) => { e.preventDefault(); if (canEdit) setOver(true); };

  return (
    <div className="flex flex-col gap-3">
      <div ref={zone} role="group" aria-label={t("analysis.business.upload.dropAria", "Drop files to upload")} tabIndex={canEdit ? 0 : -1}
        onKeyDown={(e) => { if (canEdit && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
        onDragEnter={stop} onDragOver={stop} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn("flex flex-wrap items-center justify-between gap-3 rounded-block border border-dashed border-line px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          over && "border-accent bg-accent-soft")}>
        <p className="text-[13px] text-ink2">{canEdit ? t("analysis.business.upload.dropHere", "Drop files here, or choose them.") : (editReason ?? t("analysis.business.upload.cannot", "You can't upload files."))}</p>
        <input ref={input} type="file" multiple accept={accept} className="hidden" tabIndex={-1} aria-hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) q.add(files, folderId);
          }} />
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!canEdit} onClick={() => input.current?.click()}
            icon={<UploadCloud size={16} strokeWidth={1.75} aria-hidden />}>{t("analysis.business.upload.files", "Upload files")}</Button>
        </span>
      </div>
      <UploadQueue projectId={projectId} />
    </div>
  );
}
