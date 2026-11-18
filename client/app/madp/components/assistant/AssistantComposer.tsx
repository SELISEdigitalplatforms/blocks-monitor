import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Lightbulb, Paperclip, SendHorizontal, X } from "lucide-react";
import { Button, Textarea } from "@/madp/ui/kit";
import { MAX_FILES, MAX_FILE_BYTES, TEXT_MAX } from "@/madp/domain/assistant";
import { checkFiles, useAssistantMessages, useSendAssistant } from "@/madp/blocks/collab/assistant";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { useReleases } from "@/madp/blocks/delivery/hooks";
import { useT } from "@/madp/i18n";
import {
  ASSISTANT_COMPOSER_ID, suggestedPromptsFor, suggestedPromptsVisible, useAssistantWindow, type EnvId,
} from "./assistantWindowState";

const STAGED_CHIP = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-surface2 px-2.5 text-[12px] text-ink2 transition hover:bg-line hover:text-ink";
const PROMPT_CHIP = "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-surface2 px-3 text-[12px] text-ink2 transition hover:bg-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-45";

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AssistantComposer({ projectId, environment }: { projectId: string; environment: EnvId }) {
  const t = useT();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const messages = useAssistantMessages(projectId).data ?? [];
  const sender = useSendAssistant(projectId);
  const pending = useAssistantWindow((s) => s.pending);
  const releases = useReleases(useDeliveryContext(projectId));
  const prompts = suggestedPromptsFor({
    releasesKnown: !releases.isLoading && releases.error === null,
    anyReleased: releases.data.some((r) => r.releasedAt),
    devReleased: releases.data.some((r) => r.environment === "dev" && r.releasedAt),
  });
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = area.current?.querySelector("textarea");
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const max = 6 * line + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [text]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const { error: err } = checkFiles(files.length, incoming);
    const next = [...files];
    for (const f of incoming) {
      if (next.length >= MAX_FILES) break;
      if (f.size <= MAX_FILE_BYTES) next.push(f);
    }
    setFiles(next);
    setFileError(err);
    if (picker.current) picker.current.value = "";
  };

  const send = async (body: string, attached: File[]) => {
    const message = body.trim();
    if ((!message && attached.length === 0) || busy) return;
    if (message.length > TEXT_MAX) { setError(t("assistant.composer.tooLong", "Keep the message under {max} characters.", { max: TEXT_MAX })); return; }
    setBusy(true);
    setError("");
    const sending = { text: message, attachments: attached.map((f) => ({ name: f.name, size: f.size })), environment };
    useAssistantWindow.getState().setPending(sending);
    setText(""); setFiles([]); setFileError(""); setEdited(false);
    const restore = () => { setText(body); setFiles(attached); };
    let failed = false;
    try {
      const res = await sender.run({ environment, text: message, files: attached });
      if (res === null) restore();
    } catch (e) {
      failed = true;
      restore();
      useAssistantWindow.getState().setPending({ ...sending, failed: collabErrorMessage(e) || t("assistant.composer.sendFailed", "We couldn't send your message. Try again.") });
    } finally {
      if (!failed) useAssistantWindow.getState().setPending(null);
      setBusy(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) void send(text, files); }
  };

  const pickPrompt = (p: ReturnType<typeof suggestedPromptsFor>[number]) => {
    if (p.send) void send(p.text, []);
    else { setText(p.text); setEdited(true); area.current?.querySelector("textarea")?.focus(); }
  };

  return (
    <div className="border-t border-line px-4 pb-4 pt-3">
      {suggestedPromptsVisible({ messageCount: messages.length + (pending ? 1 : 0), text, fileCount: files.length, editedSinceSend: edited }) && (
      <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("assistant.composer.suggestedPrompts", "Suggested prompts")}>
        {prompts.map((p) => (
          <li key={p.id} className="max-w-full">
            <button type="button" disabled={busy} onClick={() => pickPrompt(p)} className={PROMPT_CHIP}>
              <Lightbulb size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
      )}
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className={STAGED_CHIP}>
              <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="num text-ink3">{sizeLabel(f.size)}</span>
              <button type="button" aria-label={t("assistant.composer.removeFile", "Remove {name}", { name: f.name })} disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink3 hover:text-ink">
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={area}>
        <Textarea id={ASSISTANT_COMPOSER_ID} aria-label={t("assistant.composer.messageLabel", "Message the MADP assistant")} aria-describedby={`${ASSISTANT_COMPOSER_ID}-hint`} rows={1} value={text}
          placeholder={t("assistant.composer.placeholder", "Ask about this project, or describe a problem a customer found…")}
          onChange={(e) => { setText(e.target.value); setEdited(true); }} onKeyDown={onKey} className="min-h-[44px] resize-none overflow-y-auto" />
        <span id={`${ASSISTANT_COMPOSER_ID}-hint`} className="sr-only">{t("assistant.composer.keyHint", "Enter sends. Shift+Enter adds a new line.")}</span>
      </div>
      {fileError && <p className="mt-2 text-[12px] text-danger [overflow-wrap:anywhere]">{fileError}</p>}
      {(error || (!pending?.failed && sender.error)) && <p role="alert" className="mt-2 text-[13px] text-danger [overflow-wrap:anywhere]">{error || sender.error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-label={t("assistant.composer.attachFiles", "Attach files")} disabled={busy} onClick={() => picker.current?.click()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 transition hover:bg-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">
          <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <input ref={picker} type="file" multiple accept="image/*,.log,.txt,.json,text/plain" className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => addFiles(e.target.files)} />
        <Button className="ml-auto" size="sm" disabled={busy || (!text.trim() && files.length === 0)} aria-busy={busy}
          icon={<SendHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => void send(text, files)}>
          {busy ? t("assistant.composer.sending", "Sending…") : t("assistant.composer.send", "Send")}
        </Button>
      </div>
    </div>
  );
}
