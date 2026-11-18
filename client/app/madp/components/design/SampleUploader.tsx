/** A keyboard-accessible drop zone plus a file button. Files only go to onFiles; the upload pipeline (presign, PUT, commit) lives in src/blocks/requirements/uploads. */
import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { SAMPLE_ACCEPT } from "@/madp/domain/designBrief";
import { limitText } from "./designUi";
import { useT } from "@/madp/i18n";

export function SampleUploader({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = Array.isArray(SAMPLE_ACCEPT) ? SAMPLE_ACCEPT.join(",") : String(SAMPLE_ACCEPT);
  const take = (list: FileList | null) => { if (list && list.length) onFiles(Array.from(list)); };
  return (
    <div
      role="group" aria-label={t("analysis.design.upload.aria", "Upload samples")} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
      onKeyDown={(e) => { if (!disabled && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
      className={cn("flex flex-col items-center gap-3 rounded-block px-4 py-8 text-center ring-1 ring-dashed ring-line outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60",
        over ? "bg-accent-soft ring-accent" : "bg-surface2", disabled && "opacity-70")}>
      <ImageUp size={22} strokeWidth={1.75} className="text-ink2" aria-hidden />
      <p className="text-[14px] text-ink">{t("analysis.design.upload.drop", "Drop screens here, or choose files")}</p>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => input.current?.click()}>{t("analysis.design.upload.choose", "Choose files")}</Button>
      <input ref={input} type="file" multiple accept={accept} hidden tabIndex={-1} disabled={disabled}
        onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <p className="text-[12px] text-ink3">{limitText()}</p>
    </div>
  );
}
