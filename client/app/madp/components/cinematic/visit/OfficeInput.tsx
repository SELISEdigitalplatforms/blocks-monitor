/** Your side of the conversation, without a chat window: a slim bar near the bottom centre (like a subtitle line) where
 *  you type (it grows to three lines, Enter sends, Shift + Enter makes a new line, attach when the step takes files),
 *  a few small choices just above it when the step offers them, and what you just said shown there for a moment before
 *  it fades. While the other side thinks you can type ahead; Send waits. Typing makes the person turn to listen. Files
 *  can be dropped anywhere on the office while the step takes them. `children`: the step's small context (the files
 *  being filed, why a question is asked), shown just above the choices. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { useT } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import { ACCEPTED_EXTENSIONS } from "@/madp/domain/docs";
import { GUIDE_NAME } from "../ui/Avatar";
import { useChat, type Who } from "./chat";
import { canSend, composerState, sendsOnEnter, type StageLayout } from "./layout";

const ACCEPT = ACCEPTED_EXTENSIONS.split(",").map((e) => e.trim()).join(",");
const LINE_PX = 22;
const MAX_LINES = 3;
/** how long after the last key the person counts as still typing */
const TYPING_MS = 1600;
/** how long your own line stays before it fades */
const YOU_MS = 2800;

function fit(el: HTMLTextAreaElement) {
  el.style.height = "";
  el.style.height = `${Math.min(el.scrollHeight, LINE_PX * MAX_LINES + 2)}px`;
  el.style.overflowY = el.scrollHeight > LINE_PX * MAX_LINES + 2 ? "auto" : "hidden";
}

/** Your last line for a moment, then it fades. */
function YourLine() {
  const youLine = useChat((s) => s.youLine);
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (!youLine) return;
    setShown(youLine);
    const id = window.setTimeout(() => setShown((s) => (s?.id === youLine.id ? null : s)), YOU_MS);
    return () => window.clearTimeout(id);
  }, [youLine]);
  return (
    <div aria-hidden className={cn("visit-you", shown ? "is-on" : "is-off")}>
      {shown && <span key={shown.id} className="line-clamp-2 break-words">{shown.text}</span>}
    </div>
  );
}

export function OfficeInput({ layout, paused, speaker, children }: { layout: StageLayout; paused: boolean; speaker: Who; children?: ReactNode }) {
  const t = useT();
  const spec = useChat((s) => s.composer);
  const busy = useChat((s) => s.busy !== null || s.typing !== null);
  // the choices come once the question has been asked (never before the person has heard it)
  const speaking = useChat((s) => s.typing !== null || s.streaming !== null || s.busy !== null);
  // a choice was sent: the choices go away at once (the next question brings its own)
  const [chosen, setChosen] = useState(false);
  const setYouTyping = useChat((s) => s.setYouTyping);
  const state = composerState(spec, busy);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const typingTimer = useRef(0);

  // a new question: a clean field, and the keyboard there (never while a window is open over the office)
  const specKey = spec ? `${spec.label}|${spec.mode}|${(spec.replies ?? []).map((r) => r.id).join(",")}` : "";
  useEffect(() => {
    setText("");
    setPicked([]);
    setChosen(false);
    if (field.current) { field.current.value = ""; fit(field.current); }
    if (paused) return;
    const id = window.setTimeout(() => field.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [specKey, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // files dropped anywhere on the office while this step takes them
  useEffect(() => {
    const onFiles = spec?.onFiles;
    const over = (e: DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = onFiles ? "copy" : "none"; } };
    const drop = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (onFiles && files.length && !busy) onFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [spec, busy]);

  useEffect(() => () => { window.clearTimeout(typingTimer.current); setYouTyping(false); }, [setYouTyping]);

  const typed = (value: string) => {
    setText(value);
    setYouTyping(value.trim().length > 0);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setYouTyping(false), TYPING_MS);
  };

  const send = () => {
    if (!spec?.onSend || !canSend(state, text)) return;
    spec.onSend(text.trim());
    setText("");
    setPicked([]);
    setYouTyping(false);
    if (field.current) { field.current.value = ""; fit(field.current); }
  };

  /** a choice that adds to the typed answer (several can be picked); picked again, it comes out */
  const addReply = (label: string) => {
    const parts = text.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    const has = parts.some((p) => p.toLowerCase() === label.toLowerCase());
    const next = has ? parts.filter((p) => p.toLowerCase() !== label.toLowerCase()) : [...parts, parts.length ? label.charAt(0).toLowerCase() + label.slice(1) : label];
    const value = next.join(", ");
    typed(value);
    setPicked(next.map((p) => p.toLowerCase()));
    if (field.current) { field.current.value = value; fit(field.current); field.current.focus(); }
  };

  const replies = spec?.replies ?? [];
  const closed = state === "closed";
  const placeholder = state === "wait" ? t("studio.office.visit.input.wait", "{name} is thinking. You can type ahead", { name: GUIDE_NAME[speaker] })
    : closed ? t("studio.office.visit.input.closed", "{name} is talking", { name: GUIDE_NAME[speaker] })
    : spec?.placeholder ?? t("studio.office.visit.input.placeholder", "Answer {name}", { name: GUIDE_NAME[speaker] });

  return (
    <div ref={root} className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ bottom: layout.input.bottom, width: layout.input.width }}>
      {children}
      <YourLine />
      {replies.length > 0 && !speaking && !chosen && (
        <div role="group" aria-label={spec?.label} className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1.5">
          {replies.map((r) => {
            const on = spec?.repliesAdd && picked.includes(r.label.toLowerCase());
            return (
              <button key={r.id} type="button" disabled={r.disabled || state === "wait"} aria-pressed={spec?.repliesAdd ? on : undefined}
                title={r.hint} onClick={() => { if (spec?.repliesAdd) { addReply(r.label); return; } setChosen(true); spec?.onReply?.(r.id, text); }}
                className={cn("visit-pill", r.primary && "is-primary", r.quiet && "is-quiet", on && "is-on")}>
                {r.label}
              </button>
            );
          })}
        </div>
      )}
      <form noValidate onSubmit={(e) => { e.preventDefault(); send(); }} className={cn("visit-bar pointer-events-auto", !closed && "is-live")}>
        <textarea
          ref={field}
          rows={1}
          value={text}
          maxLength={spec?.maxLength}
          disabled={closed}
          aria-label={spec?.label ?? t("studio.office.visit.composer.label", "Your answer")}
          placeholder={placeholder}
          onChange={(e) => { typed(e.target.value); fit(e.currentTarget); }}
          onKeyDown={(e) => { if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) { e.preventDefault(); send(); } }}
          className="min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[15px] leading-[22px] text-white outline-none placeholder:text-white/55 disabled:cursor-default"
        />
        {spec?.onFiles && (
          <button type="button" aria-label={t("studio.office.visit.composer.attach", "Attach files")} onClick={() => file.current?.click()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white">
            <Paperclip size={17} />
          </button>
        )}
        <button type="submit" aria-label={t("studio.office.visit.composer.send", "Send")} disabled={!canSend(state, text)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink transition enabled:hover:bg-accent enabled:hover:text-white disabled:bg-white/15 disabled:text-white/40">
          <ArrowUp size={17} />
        </button>
      </form>
      <input ref={file} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) spec?.onFiles?.(files);
      }} />
      <span data-visit-pick hidden onClick={() => file.current?.click()} />
    </div>
  );
}

/** Opens the file chooser of the input (a choice such as "Attach files", or a typed "yes" to "Do you have files?"). */
export function pickFiles(): void {
  document.querySelector<HTMLElement>("[data-visit-pick]")?.click();
}
