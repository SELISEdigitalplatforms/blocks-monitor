import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import { fetchSharedText, type PublicShareFile, type PublicShareItem } from "@/madp/blocks/share/public";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const OUTLINK = "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-ink px-5 text-[14px] font-medium text-canvas transition hover:opacity-90 dark:bg-ink/15 dark:text-ink dark:hover:bg-ink/20 dark:hover:opacity-100";

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DownloadLink({ file, onExpired }: { file: PublicShareFile; onExpired: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href={file.url} download={file.name} target="_blank" rel="noopener noreferrer" className={OUTLINK}
        onClick={(e) => { if (Date.parse(file.urlExpiresAt) <= Date.now()) { e.preventDefault(); onExpired(); } }}>
        <Download size={16} strokeWidth={1.75} aria-hidden />{t("settings.share.preview.download", "Download")}
      </a>
      <span className="min-w-0 break-words text-[14px] text-ink2">{file.name} · {sizeText(file.sizeBytes)}</span>
    </div>
  );
}

function PlainTextFile({ file, onExpired }: { file: PublicShareFile; onExpired: () => void }) {
  const t = useT();
  const [state, setState] = useState<{ text: string | null } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setState(null);
    void fetchSharedText(file.url, 200000, ac.signal).then((text) => { if (!ac.signal.aborted) setState({ text }); });
    return () => ac.abort();
  }, [file.url]);
  if (!state) return <p className="text-[14px] text-ink2" aria-busy="true">{t("settings.share.preview.loadingText", "Loading the text…")}</p>;
  if (state.text === null) return <DownloadLink file={file} onExpired={onExpired} />;
  return <pre className="max-w-full whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink">{state.text}</pre>;
}

function FileBody({ file, title, onExpired }: { file: PublicShareFile; title: string; onExpired: () => void }) {
  const t = useT();
  const mime = file.mime.toLowerCase();
  if (file.inline && IMAGE_MIMES.has(mime)) {
    return <img src={file.url} referrerPolicy="no-referrer" alt={title} className="mx-auto block h-auto max-h-[70vh] max-w-full object-contain" />;
  }
  if (file.inline && mime === "application/pdf") {
    const open = () => {
      if (Date.parse(file.urlExpiresAt) <= Date.now()) { onExpired(); return; }
      window.open(file.url, "_blank", "noopener,noreferrer");
    };
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={<FileText size={16} strokeWidth={1.75} aria-hidden />} onClick={open}>{t("settings.share.preview.openPdf", "Open PDF")}</Button>
        <span className="text-[14px] text-ink2">{t("settings.share.preview.pdfHint", "Opens in your browser's PDF viewer.")}</span>
      </div>
    );
  }
  if (file.inline && mime === "text/plain") return <PlainTextFile file={file} onExpired={onExpired} />;
  return <DownloadLink file={file} onExpired={onExpired} />;
}

export function PublicSharePreview({ item, onExpired }: { item: PublicShareItem; onExpired: () => void }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {item.kind === "file" && item.file && <FileBody file={item.file} title={item.title} onExpired={onExpired} />}
      {item.kind === "text" && item.text && (
        <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{item.text.body}</p>
      )}
      {item.kind === "link" && item.link && (
        <div className="flex min-w-0 flex-col gap-3">
          <p className="font-mono text-[13px] text-ink2">{item.link.host}</p>
          <p className="break-all text-[14px] text-ink">{item.link.url}</p>
          <div>
            <a href={item.link.url} target="_blank" rel="noopener noreferrer" className={OUTLINK}>
              {item.link.isFigma ? t("settings.share.preview.openInFigma", "Open in Figma") : t("settings.share.preview.openLink", "Open link")}<ExternalLink size={16} strokeWidth={1.75} aria-hidden />
            </a>
          </div>
        </div>
      )}
      {item.description && <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[14px] text-ink2">{item.description}</p>}
    </div>
  );
}
