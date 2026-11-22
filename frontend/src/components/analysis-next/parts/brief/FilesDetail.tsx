/** "What we read from your files", opened in its row: today's FilesReadPart (every file with what was found in it,
 *  "Read it" / "Try again" for a file that was not read: the same extraction call, one file after the other), drawn
 *  without the card (the row already shows the title). Read only once the understanding is confirmed. */
import { useT } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { File, FileSpreadsheet, FileText, Image, RotateCw } from "lucide-react";
import { useCan } from "@/blocks/projects/context";
import { callProjectOp } from "@/blocks/projects/mutations";
import { stepPath } from "@/domain/phases";
import { fileState, fileWords } from "@/components/understanding/model";
import { retryAttachmentExtraction } from "@/components/understanding/retryExtraction";
import { briefKey, useAnalysisBrief } from "@/components/analysis/doc/briefQuery";
import { PartLoading, PartPlaceholder } from "@/components/analysis/doc/PartCard";
import { Button, Chip } from "@/ui/kit";
import { partOpen } from "@/components/analysis/model";
import type { AnalysisCtx } from "../../model";
import { understandingSigned, useSharedNotes } from "./summaryHooks";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf" || ext === "docx" || ext === "doc" || ext === "md" || ext === "txt") return FileText;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return Image;
  if (["xlsx", "xls", "csv"].includes(ext)) return FileSpreadsheet;
  return File;
}

export function FilesDetail({ projectId, step }: AnalysisCtx) {
  const t = useT();
  const open = partOpen("files", step);
  const briefQ = useAnalysisBrief(projectId, open);
  const brief = briefQ.data ?? null;
  const canEdit = useCan("business.edit");
  const notes = useSharedNotes(projectId) ?? 0;
  const qc = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(0);
  const reading = useRef<AbortController | null>(null);
  useEffect(() => () => reading.current?.abort(), []);

  const readFiles = useCallback(async (fileIds: string[]) => {
    if (!brief || reading.current || fileIds.length === 0) return;
    const controller = new AbortController();
    reading.current = controller;
    let errors = 0;
    try {
      // one file after the other: a failed file never stops the rest
      for (const fileId of fileIds) {
        const file = brief.attachmentStatus.find((f) => f.fileId === fileId);
        if (!file) continue;
        setBusyIds(new Set([fileId]));
        try {
          await retryAttachmentExtraction(projectId, { fileId, name: file.name }, { callOp: callProjectOp }, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          errors += 1;
        }
        await qc.invalidateQueries({ queryKey: briefKey(projectId) });
      }
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        setBusyIds(new Set());
        setFailed(errors);
      }
    }
  }, [brief, projectId, qc]);

  if (!open) {
    return <PartPlaceholder what={t("analysis.brief.filesPlaceholder", "Your business analyst lists every file you shared here, with what was found in each.")} when={t("analysis.brief.whenAnalysisStarts", "Written once the project analysis starts in Project setup.")} />;
  }
  if (!brief) {
    return briefQ.isError
      ? <p role="alert" className="text-[14px] text-ink2">{t("analysis.brief.filesLoadError", "We couldn't load what we read from your files. Reload the page to try again.")}</p>
      : <PartLoading />;
  }

  const files = brief.attachmentStatus;
  const actions = canEdit && !understandingSigned(brief, step);
  const toRead = files.filter((f) => ["not_read", "failed"].includes(fileState(f.status))).map((f) => f.fileId);
  const busy = busyIds.size > 0;
  const setupHref = stepPath(projectId, "business");

  if (files.length === 0) {
    return (
      <p className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
        {notes === 0 ? t("analysis.brief.filesEmptyNone", "No files shared yet. Documents you share in Project setup are read here, so nothing gets lost.")
          : notes === 1 ? t("analysis.brief.filesEmptyNoteOne", "1 note shared, no files yet. Documents you share in Project setup are read here, so nothing gets lost.")
          : t("analysis.brief.filesEmptyNoteMany", "{count} notes shared, no files yet. Documents you share in Project setup are read here, so nothing gets lost.", { count: notes })}
        {canEdit && <> <Link to={setupHref} className="font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("analysis.brief.shareFiles", "Share files")}</Link></>}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {actions && toRead.length > 1 && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={<RotateCw size={14} aria-hidden />} disabled={busy} onClick={() => void readFiles(toRead)}>{t("analysis.brief.readAll", "Read all {count}", { count: toRead.length })}</Button>
        </div>
      )}
      <ul className="flex flex-col gap-2" aria-live="polite">
        {files.map((f) => {
          const w = fileWords(f, busyIds.has(f.fileId));
          // the shared wording names the old role for a file it can't read
          const detail = !busy && fileState(f.status) === "unsupported" ? t("analysis.brief.analystCanOpen", "Your business analyst can still open it.") : w.detail;
          const Icon = fileIcon(f.name);
          return (
            <li key={f.fileId} data-file-state={w.label} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-block bg-surface2 px-4 py-3">
              <Icon size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-[14px] font-medium text-ink" title={f.name}>{f.name}</p>
                {detail && <p className="mt-0.5 break-words text-[13px] leading-snug text-ink2">{detail}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Chip tone={w.tone}>{w.label}</Chip>
                {actions && w.action && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void readFiles([f.fileId])} aria-label={w.action === "read" ? t("analysis.brief.readFile", "Read {name}", { name: f.name }) : t("analysis.brief.retryFile", "Try again to read {name}", { name: f.name })}>
                    {w.action === "read" ? t("analysis.brief.readIt", "Read it") : t("analysis.brief.tryAgain", "Try again")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {failed > 0 && !busy && (
        <p role="status" className="px-1 text-[13px] text-[rgb(var(--c-warning-text))]">
          {failed === 1 ? t("analysis.brief.readFailedOne", "One file couldn't be read. See the reason next to it.")
            : t("analysis.brief.readFailedMany", "{count} files couldn't be read. See the reason next to it.", { count: failed })}
        </p>
      )}
    </div>
  );
}
