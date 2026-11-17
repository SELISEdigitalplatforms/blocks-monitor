/** "What we read from your files": every file of the project with its reading status in plain words, what was found
 *  in it, and "Read it" / "Try again" for a file that was not read. */
import { useT } from "@/i18n";
import { Link } from "react-router-dom";
import { File, FileSpreadsheet, FileText, FolderOpen, Image, RotateCw } from "lucide-react";
import { Button, Card, Chip } from "@/ui/kit";
import type { BriefFile } from "./briefApi";
import { fileCounts, fileWords } from "./model";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf" || ext === "docx" || ext === "doc" || ext === "md" || ext === "txt") return FileText;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return Image;
  if (["xlsx", "xls", "csv"].includes(ext)) return FileSpreadsheet;
  return File;
}

export function FilesCard({ files, busyIds, canEdit, readOnly, onRead, onReadAll, setupHref }: {
  files: readonly BriefFile[];
  /** Files being read on request in this browser. */
  busyIds: ReadonlySet<string>;
  canEdit: boolean;
  readOnly: boolean;
  onRead: (fileId: string) => void;
  onReadAll: () => void;
  setupHref: string;
}) {
  const t = useT();
  const c = fileCounts(files);
  const toRead = c.notRead + c.failed;
  const busy = busyIds.size > 0;
  const actions = canEdit && !readOnly;
  return (
    <div id="understanding-files" className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
    <Card title={t("analysis.understanding.filesTitle", "What we read from your files")} icon={<FolderOpen size={18} strokeWidth={1.75} />}
      action={actions && toRead > 1 ? (
        <Button size="sm" variant="ghost" icon={<RotateCw size={14} aria-hidden />} disabled={busy} onClick={onReadAll}>{t("analysis.understanding.readAll", "Read all {count}", { count: toRead })}</Button>
      ) : undefined}>
      {files.length === 0 ? (
        <p className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
          {t("analysis.understanding.noFilesYet", "No files shared yet. Documents you share in Project setup are read here, so nothing gets lost.")}
          {canEdit && <> <Link to={setupHref} className="font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("analysis.understanding.shareFiles", "Share files")}</Link></>}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {files.map((f) => {
            const w = fileWords(f, busyIds.has(f.fileId));
            const Icon = fileIcon(f.name);
            return (
              <li key={f.fileId} data-file-state={w.label} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-block bg-surface2 px-4 py-3">
                <Icon size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[14px] font-medium text-ink" title={f.name}>{f.name}</p>
                  {w.detail && <p className="mt-0.5 break-words text-[13px] leading-snug text-ink2">{w.detail}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Chip tone={w.tone}>{w.label}</Chip>
                  {actions && w.action && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRead(f.fileId)} aria-label={w.action === "read" ? t("analysis.understanding.readFile", "Read {name}", { name: f.name }) : t("analysis.understanding.retryFile", "Try again to read {name}", { name: f.name })}>
                      {w.action === "read" ? t("analysis.understanding.readIt", "Read it") : t("analysis.understanding.tryAgain", "Try again")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
    </div>
  );
}
