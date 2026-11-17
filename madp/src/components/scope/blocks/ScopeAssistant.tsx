/** The assistant bar at the top of the scope, in the original look: describe a change in plain words. It is the real
 *  MADP assistant: the text is sent through the collab assistant op (a message row and a chat.reply engine job) and the
 *  assistant window opens on the conversation, where the reply appears when the MADP engine writes it (until then the
 *  window shows the job's honest waiting state). Nothing here edits the scope or pretends to: changes to the scope are
 *  made in the sections below. Shown only while the scope can still be edited. */
import { useState, type FormEvent } from "react";
import { CornerDownLeft, MessageSquareText, SendHorizontal } from "lucide-react";
import { useSendAssistant } from "@/blocks/collab/assistant";
import { collabErrorMessage } from "@/blocks/collab/messages";
import { TEXT_MAX } from "@/domain/assistant";
import { useAssistantWindow } from "@/components/assistant/assistantWindowState";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/kit";
import { useT } from "@/i18n";

export function ScopeAssistant({ projectId }: { projectId: string }) {
  const t = useT();
  const sender = useSendAssistant(projectId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    if (message.length > TEXT_MAX) { setError(t("analysis.scope.assistant.tooLong", "Keep the message under {max} characters.", { max: TEXT_MAX })); return; }
    const win = useAssistantWindow.getState();
    const sending = { text: message, attachments: [], environment: win.environment };
    setBusy(true); setError(""); setSent(false);
    win.openWindow();
    win.setPending(sending);
    let failed = false;
    try {
      const res = await sender.run({ environment: win.environment, text: message, files: [] });
      if (res !== null) { setText(""); setSent(true); }
    } catch (err) {
      failed = true;
      const reason = collabErrorMessage(err) || t("analysis.scope.assistant.notSent", "The message could not be sent.");
      setError(reason);
      useAssistantWindow.getState().setPending({ ...sending, failed: reason });
    } finally {
      if (!failed) useAssistantWindow.getState().setPending(null);
      setBusy(false);
    }
  };

  const failure = error || sender.error;
  return (
    <section aria-label={t("analysis.scope.assistant.aria", "MADP assistant")} className="animate-rise rounded-card bg-ai-soft p-4 sm:px-6 sm:py-5">
      <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => void ask(e)}>
        <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-full bg-ai text-white sm:grid" aria-hidden>
          <MessageSquareText size={18} strokeWidth={1.75} />
        </span>
        <label htmlFor="scope-assistant" className="sr-only">{t("analysis.scope.assistant.label", "Ask the MADP assistant about this scope")}</label>
        {/* on a phone the input takes the whole row and Ask goes under it, so the words stay readable */}
        <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
          <input id="scope-assistant" value={text} disabled={busy} autoComplete="off" maxLength={TEXT_MAX}
            onChange={(e) => { setText(e.target.value); setSent(false); setError(""); }}
            placeholder={t("analysis.scope.assistant.placeholder", "Describe a change in plain words")}
            className="h-11 w-full rounded-full bg-surface px-5 text-[14px] text-ink outline-none ring-ai/40 transition placeholder:text-ink3 focus:ring-2 disabled:opacity-70 sm:pr-11" />
          <CornerDownLeft size={15} aria-hidden className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 text-ink3 sm:block" />
        </div>
        <Button type="submit" variant="ai" className="w-full sm:w-auto" icon={<SendHorizontal size={16} aria-hidden />} disabled={!text.trim() || busy}>
          {busy ? t("analysis.scope.assistant.sending", "Sending…") : t("analysis.scope.assistant.ask", "Ask")}
        </Button>
      </form>
      <p role="status" className={cn(sent ? "mt-3 text-[13px] font-medium text-ai sm:pl-14" : "sr-only")}>
        {sent ? t("analysis.scope.assistant.sent", "Sent to the MADP assistant. Its answer appears in the assistant window; the scope changes only where you edit it below.") : ""}
      </p>
      {failure && <p role="alert" className="mt-3 text-[13px] text-danger sm:pl-14">{t("analysis.scope.assistant.notSentReason", "Not sent. {reason}", { reason: String(failure) })}</p>}
    </section>
  );
}
