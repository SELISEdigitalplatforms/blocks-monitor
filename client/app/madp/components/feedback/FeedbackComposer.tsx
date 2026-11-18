import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, LoaderCircle, Paperclip, RotateCw, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { Button, Textarea } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { targetKey } from "@/madp/data/feedback";
import type { FeedbackFileState } from "@/madp/blocks/collab/feedbackUpload";
import { COMMENT_MAX, MAX_ATTACHMENTS } from "../../domain/feedback";
import { CHIP, phaseLabel, sizeLabel } from "./AttachmentChips";
import { useT } from "@/madp/i18n";
import type { ComposerLane } from "./feedbackLanes";
import { setDraft, setNotice, useFeedbackUi, type FeedbackTarget } from "./feedbackUi";

interface Entry { key: number; file: File; state: FeedbackFileState }

const newDraftKey = () => crypto.randomUUID();

/** The comment box: text (1-5 000), up to 5 files uploaded as they are picked, Ctrl/⌘+Enter sends. The lane is the
 *  step's write path (Goals & requirements or Scope & success). */
export function FeedbackComposer({ target, lane, disabled, disabledReason, onSent }: {
  target: FeedbackTarget; lane: ComposerLane; disabled: boolean; disabledReason: string | null; onSent: () => void;
}) {
  const t = useT();
  const key = targetKey(target.type, target.id);
  const draft = useFeedbackUi((s) => s.drafts[key]) ?? "";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const [draftKey, setDraftKey] = useState(newDraftKey);
  const picker = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;

  useEffect(() => { setEntries([]); setFileError(""); setDraftKey(newDraftKey()); }, [key]);

  const patch = (k: number, state: FeedbackFileState) =>
    setEntries((list) => list.map((e) => (e.key === k ? { ...e, state } : e)));

  const run = (list: Entry[]) => {
    const keyAtStart = draftKeyRef.current;
    void lane.upload({ draftKey: keyAtStart, files: list.map((e) => e.file), onState: (i, state) => patch(list[i].key, state) });
  };

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next: Entry[] = [];
    let error = "";
    for (const file of Array.from(picked)) {
      if (entries.length + next.length >= MAX_ATTACHMENTS) { error = t("settings.feedback.composer.tooManyFiles", "Attach up to {n} files to one comment.", { n: MAX_ATTACHMENTS }); break; }
      const refused = lane.check(file);
      if (refused) { error = `${file.name}: ${refused}`; continue; }
      next.push({ key: ++counter.current, file, state: { phase: "checking" } });
    }
    setFileError(error);
    if (next.length) { setEntries((l) => [...l, ...next]); run(next); }
    if (picker.current) picker.current.value = "";
  };

  const remove = (e: Entry) => {
    setEntries((l) => l.filter((x) => x.key !== e.key));
    if (e.state.attachmentId) void lane.discard(e.state.attachmentId);
  };

  const retry = (e: Entry) => { patch(e.key, { phase: "checking" }); run([e]); };

  const busy = entries.some((e) => e.state.phase !== "done" && e.state.phase !== "failed");
  const failed = entries.some((e) => e.state.phase === "failed");
  const text = draft.trim();
  const tooLong = draft.length > COMMENT_MAX;
  const ids = entries.filter((e) => e.state.phase === "done" && e.state.attachmentId).map((e) => e.state.attachmentId as string);
  const needNote = !text && entries.length > 0;
  const canSend = !disabled && !sending && !busy && !failed && !tooLong && text.length > 0;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await lane.send({ text, draftKey, attachmentIds: ids });
      setDraft(key, "");
      setEntries([]);
      setFileError("");
      setDraftKey(newDraftKey());
      setNotice(key, { tone: "ok", text: t("settings.feedback.composer.sent", "Sent.") });
      onSent();
    } catch (e) {
      setNotice(key, { tone: "error", text: lane.errorMessage(e) });
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  };
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const off = disabled || sending;

  return (
    <div>
      <Textarea data-feedback-composer="" aria-label={t("settings.feedback.composer.label", "Add feedback")} placeholder={t("settings.feedback.composer.placeholder", "Add feedback…")} className="min-h-[72px]"
        value={draft} disabled={off} maxLength={COMMENT_MAX + 1} onChange={(e) => setDraft(key, e.target.value)} onKeyDown={onKey} />
      {disabled && disabledReason && <p className="mt-2 text-[12px] leading-snug text-ink3">{disabledReason}</p>}
      {entries.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("settings.feedback.file.toSendList", "Files to send")}>
          {entries.map((e) => (
            <li key={e.key} className={cn(CHIP, e.state.phase === "failed" && "text-danger")}>
              {e.state.phase === "done" ? <Check size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                : e.state.phase === "failed" ? <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                : <LoaderCircle size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
              <span className="max-w-[140px] truncate">{e.file.name}</span>
              <span className="num text-ink3">{sizeLabel(e.file.size)}</span>
              <span>{phaseLabel(e.state.phase)}</span>
              {e.state.phase === "failed" && e.state.retryable !== false && (
                <button type="button" aria-label={t("settings.feedback.file.retry", "Retry {name}", { name: e.file.name })} onClick={() => retry(e)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                  <RotateCw size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
              <button type="button" aria-label={t("settings.feedback.file.remove", "Remove {name}", { name: e.file.name })} disabled={sending} onClick={() => remove(e)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {e.state.phase === "failed" && e.state.message && <span className="sr-only">{e.state.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {entries.filter((e) => e.state.phase === "failed" && e.state.message).map((e) => (
        <p key={e.key} role="alert" className="mt-2 text-[12px] text-danger">{e.file.name}: {e.state.message}</p>
      ))}
      {fileError && <p role="alert" className="mt-2 text-[12px] text-danger">{fileError}</p>}
      {needNote && !disabled && <p className="mt-2 text-[12px] text-ink3">{t("settings.feedback.composer.needNote", "Add a short note with the files.")}</p>}
      {tooLong && <p role="alert" className="mt-2 text-[12px] text-danger">{t("settings.feedback.composer.tooLong", "A comment can have up to {n} characters.", { n: COMMENT_MAX })}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-label={t("settings.feedback.file.attach", "Attach files")} disabled={off || entries.length >= MAX_ATTACHMENTS} onClick={() => picker.current?.click()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-45">
          <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <input ref={picker} type="file" multiple accept={lane.accept} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => addFiles(e.target.files)} />
        <span className="flex-1" />
        <span className="hidden text-[12px] text-ink3 sm:inline">{isMac ? "⌘+Enter" : "Ctrl+Enter"}</span>
        <Button variant="secondary" size="sm" aria-keyshortcuts="Control+Enter Meta+Enter" icon={<SendHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />}
          disabled={!canSend} onClick={() => void send()}>{t("settings.feedback.composer.send", "Send")}</Button>
      </div>
    </div>
  );
}
