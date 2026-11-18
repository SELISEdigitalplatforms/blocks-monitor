import { useState } from "react";
import { LoaderCircle, Paperclip } from "lucide-react";
import type { FeedbackAttachmentRecord } from "@/madp/blocks/collab/records";
import type { FeedbackFileState } from "@/madp/blocks/collab/feedbackUpload";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { t, useT } from "@/madp/i18n";

export const CHIP = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-surface2 px-2.5 text-[12px] text-ink2 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-wait";

/** The upload state of a file being attached, in a word. */
export function phaseLabel(phase: FeedbackFileState["phase"]): string {
  switch (phase) {
    case "checking": return t("settings.feedback.file.checking", "Checking…");
    case "uploading": return t("settings.feedback.file.uploading", "Uploading…");
    case "verifying": return t("settings.feedback.file.verifying", "Verifying…");
    case "done": return t("settings.feedback.file.done", "Done");
    case "failed": return t("settings.feedback.file.failed", "Failed");
  }
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The files of one comment. A chip asks for a short-lived link when clicked (`open`, the step's own op); the link is
 *  never kept. */
export function AttachmentChips({ attachments, open: openFile, onError }: {
  attachments: readonly FeedbackAttachmentRecord[]; open: (a: FeedbackAttachmentRecord) => Promise<void>; onError: (message: string) => void;
}) {
  const t = useT();
  const [opening, setOpening] = useState<string | null>(null);
  if (attachments.length === 0) return null;
  const open = async (a: FeedbackAttachmentRecord) => {
    if (opening) return;
    setOpening(a.id);
    try {
      await openFile(a);
    } catch (e) {
      onError(collabErrorMessage(e));
    } finally {
      setOpening(null);
    }
  };
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("settings.feedback.file.attachedList", "Attached files")}>
      {attachments.map((a) => (
        <li key={a.id} className="min-w-0 max-w-full">
          <button type="button" aria-label={t("settings.feedback.file.open", "Open {name}", { name: a.fileName })} disabled={opening === a.id} onClick={() => void open(a)} className={CHIP}>
            {opening === a.id
              ? <LoaderCircle size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
              : <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />}
            <span className="max-w-[180px] truncate">{a.fileName}</span>
            <span className="num text-ink3">{sizeLabel(a.sizeBytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
