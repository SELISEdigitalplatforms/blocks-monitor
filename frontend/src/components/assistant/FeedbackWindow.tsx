/** The floating feedback window of the bottom-right bubble: a title, a description and up to five files (a screenshot of
 *  the page among them, one click away), sent to the MADP team through the workspace function. Platform-wide, for
 *  every signed-in person; project conversations with the analyst and the tech lead stay inside the projects. */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Camera, CheckCircle2, FileText, MessageSquarePlus, Minus, Paperclip, SendHorizontal, X } from "lucide-react";
import { Button, IconButton, Input, Textarea } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import { ACCEPTED_EXTENSIONS } from "@/domain/docs";
import { MAX_ATTACHMENT_BYTES } from "@/domain/feedback";
import { newRequestId } from "@/blocks/fn";
import {
  FEEDBACK_DESCRIPTION_MAX, FEEDBACK_MAX_FILES, FEEDBACK_TITLE_MAX, checkFeedbackAttachment, feedbackContext,
  platformFeedbackErrorMessage, submitPlatformFeedback, uploadFeedbackAttachment, type UploadedFeedbackFile,
} from "@/blocks/platformFeedback";
import { ASSISTANT_LAUNCHER_ID, ASSISTANT_WINDOW_ID, escapeClosesWindow, useAssistantWindow } from "./assistantWindowState";
import { capturePageScreenshot } from "./pageScreenshot";

export const FEEDBACK_TITLE_ID = "madp-feedback-title";
const FEEDBACK_MORE_ID = "madp-feedback-more";

const focusLauncher = () => requestAnimationFrame(() => document.getElementById(ASSISTANT_LAUNCHER_ID)?.focus());
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function FeedbackWindow() {
  const t = useT();
  const view = useAssistantWindow((s) => s.view);
  const session = useAssistantWindow((s) => s.session);
  const open = view === "open";
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const headingId = useId();
  const subtitleId = useId();

  // follow `open` one frame later, so the first paint is the closed look and the transition runs
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const f = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(f);
  }, [open]);

  useEffect(() => { root.current?.toggleAttribute("inert", !open); }, [open]);

  useEffect(() => {
    if (!shown || root.current?.contains(document.activeElement)) return;
    const el = document.getElementById(FEEDBACK_TITLE_ID) ?? root.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus({ preventScroll: true });
  }, [shown]);

  // Escape minimises the window while focus is inside it or on its launcher
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!escapeClosesWindow({
        key: e.key, defaultPrevented: e.defaultPrevented,
        focusInWindow: !!el && !!root.current?.contains(el), focusOnLauncher: el?.id === ASSISTANT_LAUNCHER_ID,
        overlayOpen: !!document.querySelector("[role='listbox'], [role='menu']"),
      })) return;
      e.preventDefault();
      useAssistantWindow.getState().minimise();
      focusLauncher();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return createPortal(
    <div ref={root} id={ASSISTANT_WINDOW_ID} role="dialog" aria-modal="false" aria-labelledby={headingId} aria-describedby={subtitleId}
      className={cn(
        "fixed z-[49] flex flex-col overflow-hidden bg-surface ring-1 ring-line shadow-float origin-bottom-right motion-safe:transition-[opacity,transform,visibility] motion-safe:duration-200 motion-safe:ease-out",
        "max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-full max-sm:rounded-none",
        "sm:bottom-[92px] sm:right-6 sm:w-[min(420px,calc(100vw-48px))] sm:max-h-[min(720px,calc(100dvh-120px))] sm:rounded-card",
        shown ? "visible opacity-100 scale-100 translate-y-0" : "invisible pointer-events-none opacity-0 scale-95 translate-y-2")}>
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]">
          <MessageSquarePlus size={18} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[15px] font-medium leading-tight">{t("assistant.feedback.title", "Feedback")}</h2>
          <p id={subtitleId} className="text-[12px] text-ink3">{t("assistant.feedback.subtitle", "Tell the MADP team what to improve")}</p>
        </div>
        <IconButton className="h-9 w-9" label={t("assistant.feedback.minimise", "Minimise feedback")} icon={<Minus size={16} strokeWidth={1.75} />}
          onClick={() => { useAssistantWindow.getState().minimise(); focusLauncher(); }} />
        <IconButton className="h-9 w-9" label={t("assistant.feedback.close", "Close feedback")} icon={<X size={16} strokeWidth={1.75} />}
          onClick={() => { useAssistantWindow.getState().close(); focusLauncher(); }} />
      </header>
      <FeedbackForm key={session} />
    </div>,
    document.body,
  );
}

type Item = { key: string; file: File; preview: string | null; uploaded: UploadedFeedbackFile | null };
type Progress = { stage: "files"; done: number; total: number } | { stage: "send" };

const newItem = (file: File): Item => ({
  key: newRequestId(), file, uploaded: null,
  preview: file.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
});
const revoke = (items: readonly Item[]) => { for (const i of items) if (i.preview) URL.revokeObjectURL(i.preview); };

function FeedbackForm() {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string }>({});
  const [fileError, setFileError] = useState("");
  const [sendError, setSendError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sent, setSent] = useState(false);
  const requestId = useRef(newRequestId());
  const picker = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const descriptionId = useId();
  const attachHintId = useId();
  const titleErrorId = useId();
  const descriptionErrorId = useId();

  useEffect(() => () => revoke(itemsRef.current), []);
  useEffect(() => { if (sent) document.getElementById(FEEDBACK_MORE_ID)?.focus({ preventScroll: true }); }, [sent]);

  const busy = progress !== null;
  const full = items.length >= FEEDBACK_MAX_FILES;

  const add = (files: File[]) => {
    const room = FEEDBACK_MAX_FILES - itemsRef.current.length;
    const problems: string[] = [];
    const accepted: Item[] = [];
    for (const f of files) {
      const refused = checkFeedbackAttachment(f);
      if (refused) { problems.push(refused); continue; }
      if (accepted.length >= room) {
        problems.push(t("assistant.feedback.tooManyFiles", "You can attach up to {max} files.", { max: FEEDBACK_MAX_FILES }));
        break;
      }
      accepted.push(newItem(f));
    }
    if (accepted.length > 0) setItems((prev) => [...prev, ...accepted]);
    setFileError(problems.join(" "));
  };

  const remove = (key: string) => {
    setItems((prev) => {
      revoke(prev.filter((i) => i.key === key));
      return prev.filter((i) => i.key !== key);
    });
    setFileError("");
  };

  const screenshot = async () => {
    if (capturing || busy || full) return;
    setCapturing(true);
    setFileError("");
    try {
      add([await capturePageScreenshot([ASSISTANT_WINDOW_ID, ASSISTANT_LAUNCHER_ID])]);
    } catch {
      setFileError(t("assistant.feedback.screenshotFailed", "The screenshot didn't work this time. You can attach an image of the page instead."));
    } finally {
      setCapturing(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errors: { title?: string; description?: string } = {};
    if (!title.trim()) errors.title = t("assistant.feedback.titleRequired", "Add a short title.");
    if (!description.trim()) errors.description = t("assistant.feedback.descriptionRequired", "Describe what you noticed or what would help.");
    setFieldErrors(errors);
    if (errors.title || errors.description) {
      document.getElementById(errors.title ? FEEDBACK_TITLE_ID : descriptionId)?.focus();
      return;
    }
    setSendError("");
    const list = itemsRef.current;
    const total = list.length;
    try {
      const files: UploadedFeedbackFile[] = [];
      for (let i = 0; i < list.length; i++) {
        setProgress({ stage: "files", done: i, total });
        const item = list[i];
        const uploaded = item.uploaded ?? await uploadFeedbackAttachment(item.file);
        if (!item.uploaded) setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, uploaded } : x)));
        files.push(uploaded);
      }
      setProgress({ stage: "send" });
      await submitPlatformFeedback({ requestId: requestId.current, title: title.trim(), description: description.trim(), ...feedbackContext(), files });
      setSent(true);
    } catch (err) {
      setSendError(platformFeedbackErrorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    revoke(itemsRef.current);
    setItems([]);
    setTitle("");
    setDescription("");
    setFieldErrors({});
    setFileError("");
    setSendError("");
    requestId.current = newRequestId();
    setSent(false);
    requestAnimationFrame(() => document.getElementById(FEEDBACK_TITLE_ID)?.focus());
  };

  if (sent) {
    return (
      <div className="grid flex-1 place-items-center px-6 py-10 text-center">
        <div className="grid justify-items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-success-soft text-[rgb(var(--c-success-text))]">
            <CheckCircle2 size={24} strokeWidth={1.75} aria-hidden />
          </span>
          <p role="status" className="max-w-[280px] text-[15px] text-ink">{t("assistant.feedback.thanks", "Thanks. Your feedback is with the MADP team.")}</p>
          <Button id={FEEDBACK_MORE_ID} variant="ghost" size="sm" onClick={reset}>{t("assistant.feedback.sendMore", "Send more feedback")}</Button>
        </div>
      </div>
    );
  }

  const status = capturing
    ? t("assistant.feedback.capturing", "Taking a screenshot of the page…")
    : progress?.stage === "files"
      ? t("assistant.feedback.uploading", "Uploading file {current} of {total}…", { current: progress.done + 1, total: progress.total })
      : progress?.stage === "send" ? t("assistant.feedback.sending", "Sending…") : "";

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor={FEEDBACK_TITLE_ID} className="text-[13px] font-medium text-ink">{t("assistant.feedback.titleLabel", "Title")}</label>
            <span className="num text-[11px] text-ink3" aria-hidden>{title.length}/{FEEDBACK_TITLE_MAX}</span>
          </div>
          <Input id={FEEDBACK_TITLE_ID} value={title} maxLength={FEEDBACK_TITLE_MAX} required aria-required="true" disabled={busy}
            aria-invalid={fieldErrors.title ? true : undefined} aria-describedby={fieldErrors.title ? titleErrorId : undefined}
            placeholder={t("assistant.feedback.titlePlaceholder", "What is it about?")}
            onChange={(e) => { setTitle(e.target.value); if (fieldErrors.title) setFieldErrors((x) => ({ ...x, title: undefined })); }} />
          {fieldErrors.title && <p id={titleErrorId} className="mt-1.5 text-[12px] text-danger">{fieldErrors.title}</p>}
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor={descriptionId} className="text-[13px] font-medium text-ink">{t("assistant.feedback.descriptionLabel", "Description")}</label>
            <span className="num text-[11px] text-ink3" aria-hidden>{description.length}/{FEEDBACK_DESCRIPTION_MAX}</span>
          </div>
          <Textarea id={descriptionId} value={description} maxLength={FEEDBACK_DESCRIPTION_MAX} rows={6} required aria-required="true" disabled={busy}
            aria-invalid={fieldErrors.description ? true : undefined} aria-describedby={fieldErrors.description ? descriptionErrorId : undefined}
            placeholder={t("assistant.feedback.descriptionPlaceholder", "What happened, what you expected, or what would make your work easier.")}
            onChange={(e) => { setDescription(e.target.value); if (fieldErrors.description) setFieldErrors((x) => ({ ...x, description: undefined })); }}
            className="min-h-[132px] resize-y" />
          {fieldErrors.description && <p id={descriptionErrorId} className="mt-1.5 text-[12px] text-danger">{fieldErrors.description}</p>}
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">{t("assistant.feedback.attachments", "Attachments")} <span className="font-normal text-ink3">{t("assistant.feedback.optional", "(optional)")}</span></div>
          <p id={attachHintId} className="mb-2 text-[12px] text-ink3">
            {t("assistant.feedback.attachHint", "Up to {max} files, {size} MB each.", { max: FEEDBACK_MAX_FILES, size: Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024)) })}
          </p>
          {items.length > 0 && (
            <ul className="mb-2 grid gap-1.5" aria-label={t("assistant.feedback.attachedFiles", "Attached files")}>
              {items.map((it) => (
                <li key={it.key} className="flex items-center gap-2.5 rounded-block bg-surface2 p-1.5 pr-2">
                  {it.preview ? (
                    <img src={it.preview} alt="" className="h-11 w-11 shrink-0 rounded-[8px] object-cover object-top ring-1 ring-line" />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] bg-surface text-ink3 ring-1 ring-line"><FileText size={18} strokeWidth={1.75} aria-hidden /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{it.file.name}</span>
                    <span className="num block text-[11px] text-ink3">{sizeLabel(it.file.size)}</span>
                  </span>
                  <button type="button" disabled={busy} onClick={() => remove(it.key)}
                    aria-label={t("assistant.feedback.removeFile", "Remove {name}", { name: it.file.name })} title={t("assistant.feedback.removeFile", "Remove {name}", { name: it.file.name })}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink3 transition hover:bg-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">
                    <X size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy || capturing || full} aria-describedby={attachHintId}
              icon={<Paperclip size={15} strokeWidth={1.75} aria-hidden />} onClick={() => picker.current?.click()}>
              {t("assistant.feedback.addFiles", "Add files")}
            </Button>
            <IconButton className="h-8 w-8 bg-surface2" disabled={busy || capturing || full} aria-busy={capturing}
              label={t("assistant.feedback.screenshot", "Add a screenshot of this page")} icon={<Camera size={16} strokeWidth={1.75} />}
              onClick={() => void screenshot()} />
            <input ref={picker} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </div>
          {fileError && <p role="alert" className="mt-2 text-[12px] text-danger [overflow-wrap:anywhere]">{fileError}</p>}
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-4 py-3">
        {sendError && <p role="alert" className="mb-2 text-[13px] text-danger [overflow-wrap:anywhere]">{sendError}</p>}
        <div className="flex items-center gap-3">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-[12px] text-ink3">{status}</p>
          <Button type="submit" variant="primary" size="sm" disabled={busy || capturing} aria-busy={busy}
            icon={<SendHorizontal size={15} strokeWidth={1.75} aria-hidden />}>
            {busy ? t("assistant.feedback.sending", "Sending…") : t("assistant.feedback.send", "Send")}
          </Button>
        </div>
      </div>
    </form>
  );
}
