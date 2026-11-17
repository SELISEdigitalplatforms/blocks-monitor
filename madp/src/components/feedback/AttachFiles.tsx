/** Attach files wherever people talk to the team (an answer to the business analyst, a change request and its answers,
 *  a chat message, feedback on a preview): one control for all of them. `useAttachDraft` keeps the files of the message
 *  being written (each goes up as soon as it is picked, dropped or pasted), `AttachButton` is the paperclip,
 *  `AttachChipList` shows each file with its progress, a retry and a remove, and `zoneProps` make the writing area take
 *  dropped files and pasted pictures. The send op of the place gets `ids` + `draftKey` and keeps the files with what
 *  it saves; `SentFiles` shows them there afterwards. The comment boxes' look (FeedbackComposer) and rules (types,
 *  5 files, 10 MB each). */
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { Check, LoaderCircle, Paperclip, RotateCw, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FeedbackFileState } from "@/blocks/collab/feedbackUpload";
import type { FeedbackAttachmentRecord } from "@/blocks/collab/records";
import { MAX_TALK_FILES, checkTalkFile, discardTalkFile, openTalkFile, uploadTalkFiles, type TalkOwner } from "@/blocks/collab/talkUpload";
import { ACCEPTED_EXTENSIONS } from "../../domain/docs";
import { AttachmentChips, CHIP, phaseLabel, sizeLabel } from "./AttachmentChips";
import { t, useT } from "@/i18n";

interface Entry { key: number; file: File; state: FeedbackFileState }

const ACCEPT = ACCEPTED_EXTENSIONS.replace(/\s+/g, "");
const newDraftKey = () => crypto.randomUUID();

export interface AttachDraft {
  entries: readonly Entry[];
  /** The ids of the files that are ready to send. */
  ids: string[];
  draftKey: string;
  /** A file is still going up. */
  busy: boolean;
  /** A file could not be added (send waits until it is removed or retried). */
  failed: boolean;
  full: boolean;
  error: string;
  dragging: boolean;
  disabled: boolean;
  add(files: FileList | readonly File[] | null): void;
  remove(e: Entry): void;
  retry(e: Entry): void;
  /** After a send: the files belong to what was sent; the next message starts empty. */
  reset(): void;
  /** Spread onto the writing area: dropped files and pasted pictures are attached. */
  zoneProps: {
    onDragEnter(e: DragEvent): void;
    onDragOver(e: DragEvent): void;
    onDragLeave(e: DragEvent): void;
    onDrop(e: DragEvent): void;
    onPaste(e: ClipboardEvent): void;
  };
}

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** The files of the message being written. `owner` says where they go; a new owner (another question) starts empty. */
export function useAttachDraft(o: { projectId: string; owner: TalkOwner; disabled?: boolean }): AttachDraft {
  const ownerKey = `${o.projectId}:${o.owner.ownerType}:${o.owner.forId ?? ""}`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [draftKey, setDraftKey] = useState(newDraftKey);
  const counter = useRef(0);
  const depth = useRef(0);
  const disabled = o.disabled === true;

  useEffect(() => { setEntries([]); setError(""); setDraftKey(newDraftKey()); }, [ownerKey]);

  const patch = (k: number, state: FeedbackFileState) => setEntries((list) => list.map((e) => (e.key === k ? { ...e, state } : e)));
  const run = (list: Entry[], key: string) => {
    void uploadTalkFiles({
      projectId: o.projectId, ownerType: o.owner.ownerType, forId: o.owner.forId ?? null, draftKey: key,
      files: list.map((e) => e.file), onState: (i, state) => patch(list[i]!.key, state),
    });
  };

  const add = (picked: FileList | readonly File[] | null) => {
    if (!picked || disabled) return;
    const next: Entry[] = [];
    let message = "";
    for (const file of Array.from(picked)) {
      if (entries.length + next.length >= MAX_TALK_FILES) { message = t("settings.feedback.file.tooMany", "Attach up to {n} files at a time.", { n: MAX_TALK_FILES }); break; }
      const refused = checkTalkFile(file);
      if (refused) { message = `${file.name}: ${refused}`; continue; }
      next.push({ key: ++counter.current, file, state: { phase: "checking" } });
    }
    setError(message);
    if (next.length) { setEntries((l) => [...l, ...next]); run(next, draftKey); }
  };

  const remove = (e: Entry) => {
    setEntries((l) => l.filter((x) => x.key !== e.key));
    setError("");
    if (e.state.attachmentId) void discardTalkFile(o.projectId, e.state.attachmentId);
  };
  const retry = (e: Entry) => { patch(e.key, { phase: "checking" }); run([e], draftKey); };
  const reset = () => { setEntries([]); setError(""); setDraftKey(newDraftKey()); };

  const zoneProps: AttachDraft["zoneProps"] = {
    onDragEnter: (e) => { if (!hasFiles(e) || disabled) return; e.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (e) => { if (!hasFiles(e) || disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!disabled) add(e.dataTransfer.files);
    },
    onPaste: (e) => {
      // a pasted picture (a screenshot) is attached; pasted text stays text
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || disabled) return;
      e.preventDefault();
      add(files);
    },
  };

  const busy = entries.some((e) => e.state.phase !== "done" && e.state.phase !== "failed");
  const failed = entries.some((e) => e.state.phase === "failed");
  const ids = entries.filter((e) => e.state.phase === "done" && e.state.attachmentId).map((e) => e.state.attachmentId as string);
  return { entries, ids, draftKey, busy, failed, full: entries.length >= MAX_TALK_FILES, error, dragging, disabled, add, remove, retry, reset, zoneProps };
}

/** The paperclip: picks files (pictures, PDF, Word, text, spreadsheets). */
export function AttachButton({ draft, disabled, label: given, className }: { draft: AttachDraft; disabled?: boolean; label?: string; className?: string }) {
  const t = useT();
  const label = given ?? t("settings.feedback.file.attach", "Attach files");
  const picker = useRef<HTMLInputElement>(null);
  const off = disabled === true || draft.disabled || draft.full;
  return (
    <>
      <button type="button" aria-label={label} title={t("settings.feedback.file.attachTitle", "{label}: pictures, PDF, Word or text, or drop them here", { label })} disabled={off}
        onClick={() => picker.current?.click()}
        className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-45", className)}>
        <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input ref={picker} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { draft.add(e.target.files); e.target.value = ""; }} />
    </>
  );
}

/** The files of the message being written: name, size, progress, retry, remove; and why a file could not be added. */
export function AttachChipList({ draft, disabled }: { draft: AttachDraft; disabled?: boolean }) {
  const t = useT();
  if (draft.entries.length === 0 && !draft.error) return null;
  return (
    <div>
      {draft.entries.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("settings.feedback.file.toSendList", "Files to send")}>
          {draft.entries.map((e) => (
            <li key={e.key} className={cn(CHIP, e.state.phase === "failed" && "text-danger")}>
              {e.state.phase === "done" ? <Check size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                : e.state.phase === "failed" ? <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                : <LoaderCircle size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
              <span className="max-w-[140px] truncate">{e.file.name}</span>
              <span className="num text-ink3">{sizeLabel(e.file.size)}</span>
              <span>{phaseLabel(e.state.phase)}</span>
              {e.state.phase === "failed" && e.state.retryable !== false && (
                <button type="button" aria-label={t("settings.feedback.file.retry", "Retry {name}", { name: e.file.name })} onClick={() => draft.retry(e)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                  <RotateCw size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
              <button type="button" aria-label={t("settings.feedback.file.remove", "Remove {name}", { name: e.file.name })} disabled={disabled} onClick={() => draft.remove(e)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {e.state.phase === "failed" && e.state.message && <span className="sr-only">{e.state.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {draft.entries.filter((e) => e.state.phase === "failed" && e.state.message).map((e) => (
        <p key={e.key} role="alert" className="mt-2 text-[12px] text-danger">{e.file.name}: {e.state.message}</p>
      ))}
      {draft.error && <p role="alert" className="mt-2 text-[12px] text-danger">{draft.error}</p>}
    </div>
  );
}

/** A writing area that takes dropped files (a soft ring while files are dragged over it) and pasted pictures. */
export function AttachZone({ draft, className, children }: { draft: AttachDraft; className?: string; children: ReactNode }) {
  const t = useT();
  return (
    <div {...draft.zoneProps} data-dragging={draft.dragging ? "" : undefined}
      className={cn("rounded-[14px] transition", draft.dragging && "bg-accent-soft/40 ring-2 ring-accent/40", className)}>
      {children}
      {draft.dragging && <p className="mt-1 px-1 text-[12px] text-ink2" aria-live="polite">{t("settings.feedback.file.dropHint", "Drop the files to attach them.")}</p>}
    </div>
  );
}

/** Why Send waits: a file is still going up, or one could not be added. "" when nothing holds it. */
export function attachHold(draft: AttachDraft): string {
  if (draft.busy) return t("settings.feedback.file.holdUploading", "Wait for the files to finish uploading.");
  if (draft.failed) return t("settings.feedback.file.holdFailed", "Remove or retry the file that could not be added.");
  return "";
}

/** The files sent with an answer, a request, a message or feedback: click to open (a short-lived link). */
export function SentFiles({ projectId, files, className }: { projectId: string; files: readonly FeedbackAttachmentRecord[] | undefined; className?: string }) {
  const [error, setError] = useState("");
  if (!files || files.length === 0) return null;
  return (
    <div className={className}>
      <AttachmentChips attachments={files} open={(a) => openTalkFile(projectId, a)} onError={setError} />
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
