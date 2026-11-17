/** Your side of the conversation: a floating glass pill at the bottom centre (the guide's portrait with a listening /
 *  thinking ring, the field, attach, send), smart suggestion chips above it, and the conversation's rich card above
 *  those. Keyboard focus follows the question; Enter sends. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import { ACCEPTED_EXTENSIONS } from "@/domain/docs";
import { useJourney } from "../journey/store";
import { GuideAvatar } from "./Avatar";
import { CardTray } from "./Cards";

const ACCEPT = ACCEPTED_EXTENSIONS.split(",").map((e) => e.trim()).join(",");

/** the multiline answer's line height (whole px, so the field only ever holds whole lines) and its tallest size */
const LINE_PX = 21;
const MAX_LINES = 6;

/** The multiline answer grows with its text from two rows to MAX_LINES, then scrolls. Its vertical padding is a margin
 *  outside the scrolling box, so the box holds whole lines and, kept at the end while typing, never cuts one. */
function fitField(el: HTMLTextAreaElement) {
  el.style.overflowY = "hidden";
  el.style.height = "";
  const full = el.scrollHeight;
  const h = Math.min(full, LINE_PX * MAX_LINES);
  el.style.height = `${h}px`;
  if (full > h) {
    el.style.overflowY = "auto";
    if (el.selectionEnd === el.value.length) el.scrollTop = el.scrollHeight;
  } else el.scrollTop = 0;
}

function Status() {
  const thinking = useJourney((s) => s.thinking);
  const speaking = useJourney((s) => s.speaking);
  const ask = useJourney((s) => s.ask);
  const who = thinking ?? speaking ?? (useJourney.getState().pm.present && useJourney.getState().line?.who === "pm" ? "pm" : "assistant");
  const ring = thinking ? "thinking" : speaking ? "speaking" : ask ? "listening" : null;
  return (
    <span className="relative">
      <GuideAvatar who={who} size={40} ring={ring} />
      {ring === "listening" && (
        <span aria-hidden className="cine-wave absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-end gap-[2px] rounded-full bg-white/90 px-1 py-[3px] shadow-sm">
          {[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
        </span>
      )}
    </span>
  );
}

export function Composer() {
  const t = useT();
  const ask = useJourney((s) => s.ask);
  const askId = useJourney((s) => s.askId);
  const answer = useJourney((s) => s.answer);
  const thinking = useJourney((s) => s.thinking);
  const phase = useJourney((s) => s.phase);
  const walk = useJourney((s) => s.walk);
  const mode = useJourney((s) => s.mode);
  // the field is uncontrolled: typing (yours or the story's) never re-renders anything per character
  const [hasText, setHasText] = useState(false);
  /** the chips already in the typed answer (questions that take several) */
  const [picked, setPicked] = useState<string[]>([]);
  const autotype = useJourney((s) => s.autotype);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // the meeting room's table (a place in the 3D room) opens the same file chooser as "Add files"
  useEffect(() => {
    const pick = () => file.current?.click();
    window.addEventListener("cine:pick-files", pick);
    return () => window.removeEventListener("cine:pick-files", pick);
  }, []);

  // a new question: clear the field and put the keyboard where the answer goes
  useEffect(() => {
    if (input.current) {
      input.current.value = "";
      if (input.current instanceof HTMLTextAreaElement) fitField(input.current);
    }
    setHasText(false);
    setPicked([]);
    const timer = window.setTimeout(() => {
      if (ask && (ask.kind === "text" || ask.freeText)) input.current?.focus();
      else root.current?.querySelector<HTMLElement>("[data-primary]:not(:disabled)")?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [ask, askId]);

  const send = () => {
    const text = (input.current?.value ?? "").trim();
    if (text && ask && (ask.kind === "text" || ask.freeText)) answer(text);
  };

  /** A chip of a question that takes several: added to (or, picked again, taken out of) the typed answer; Send answers. */
  const addChip = (c: string) => {
    const el = input.current;
    if (!el) return;
    const parts = el.value.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    const has = parts.some((p) => p.toLowerCase() === c.toLowerCase());
    const next = has ? parts.filter((p) => p.toLowerCase() !== c.toLowerCase()) : [...parts, parts.length ? c.charAt(0).toLowerCase() + c.slice(1) : c];
    el.value = next.join(", ");
    if (el instanceof HTMLTextAreaElement) fitField(el);
    setHasText(el.value.trim().length > 0);
    setPicked(next.map((p) => p.toLowerCase()));
    el.focus();
  };


  // the story's answer types like a fast human: a steady time-based rate (faster for long answers, at most ~2.4 s), a little
  // natural variance per key, written straight into the field from requestAnimationFrame
  useEffect(() => {
    const el = input.current;
    if (!autotype || !el) return;
    const full = autotype.text;
    const cps = Math.max(32, full.length / 2.4);
    const at: number[] = [];
    let elapsed = 0;
    let seed = autotype.n * 9301 + full.length;
    for (let i = 0; i < full.length; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const jitter = 0.65 + (seed / 233280) * 0.7; // 0.65 … 1.35
      elapsed += (1000 / cps) * jitter * (full[i] === " " ? 1.25 : 1);
      at.push(elapsed);
    }
    el.focus();
    el.value = "";
    const t0 = performance.now();
    let n = 0;
    let raf = 0;
    let done = 0;
    const tick = () => {
      const dt = performance.now() - t0;
      let k = n;
      while (k < full.length && at[k] <= dt) k++;
      if (k !== n) {
        n = k;
        el.value = full.slice(0, n);
        if (el instanceof HTMLTextAreaElement) fitField(el);
      }
      if (n < full.length) raf = requestAnimationFrame(tick);
      else {
        setHasText(true);
        done = window.setTimeout(() => useJourney.getState().answer(full), 260);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(done); };
  }, [autotype]);
  const typing = Boolean(ask && (ask.kind === "text" || ask.freeText));
  const files = ask?.kind === "files";
  const confirm = ask?.kind === "confirm";
  const placeholder = typing ? ask?.placeholder ?? t("studio.cinematic.composer.typeAnswer", "Type your answer")
    : thinking ? t("studio.cinematic.composer.thinking", "Thinking…")
    : ask ? t("studio.cinematic.composer.chooseAbove", "Choose an answer above")
    : walk ? t("studio.cinematic.composer.walking", "Walking with you…")
    : t("studio.cinematic.composer.listening", "Listening…");
  const shown = phase === "journey";

  return (
    <div ref={root} className={cn("pointer-events-none absolute inset-x-0 bottom-7 flex flex-col items-center gap-3 px-6 transition-[opacity,transform] duration-700", shown ? "opacity-100" : "translate-y-6 opacity-0")}>
      <CardTray />
      {(ask?.chips || files) && !confirm && (
        <div key={askId ?? ""} className="pointer-events-auto flex max-w-[860px] flex-wrap justify-center gap-2">
          {ask?.chips?.map((c, i) => {
            const adds = ask.chipMode === "add";
            const on = adds && picked.includes(c.toLowerCase());
            return (
              <button key={c} type="button" data-primary={i === 0 && !typing ? "" : undefined} aria-pressed={adds ? on : undefined} style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => (adds ? addChip(c) : answer(c))} className={cn("cine-chip cine-rise", on && "is-on")}>
                {c}
              </button>
            );
          })}
          {files && (
            <>
              <button type="button" data-primary="" onClick={() => file.current?.click()} className="cine-chip cine-rise"><Paperclip size={14} aria-hidden /> {t("studio.cinematic.composer.addFiles", "Add files")}</button>
              {mode === "story" && <button type="button" onClick={() => answer(useJourney.getState().story.files)} className="cine-chip cine-rise" style={{ animationDelay: "50ms" }}>{t("studio.cinematic.composer.usualDocuments", "Use our usual documents")}</button>}
              <button type="button" onClick={() => answer([])} className="cine-chip cine-chip-quiet cine-rise" style={{ animationDelay: "100ms" }}>{t("studio.cinematic.composer.noFiles", "No files for now")}</button>
            </>
          )}
        </div>
      )}
      {confirm ? (
        <button type="button" data-primary="" onClick={() => answer(ask!.chips?.[0] ?? t("studio.cinematic.script.startBuilding", "Start building"))} className="cine-launch cine-rise pointer-events-auto">
          <Rocket size={18} aria-hidden /> {ask!.chips?.[0] ?? t("studio.cinematic.script.startBuilding", "Start building")}
        </button>
      ) : (
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className={cn("cine-composer pointer-events-auto", typing && "is-live")}
        >
          <Status />
          {ask?.multiline ? (
            <textarea
              ref={input}
              rows={2}
              maxLength={ask?.maxLength}
              defaultValue=""
              disabled={!typing}
              aria-label={t("studio.cinematic.composer.yourAnswer", "Your answer")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onInput={(e) => { setHasText(e.currentTarget.value.trim().length > 0); fitField(e.currentTarget); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={placeholder}
              className="my-1 min-w-0 flex-1 resize-none bg-transparent py-0 text-[15.5px] leading-[21px] text-ink outline-none placeholder:text-ink3"
            />
          ) : (
            <input
              ref={input}
              maxLength={ask?.maxLength}
              defaultValue=""
              disabled={!typing}
              aria-label={t("studio.cinematic.composer.yourAnswer", "Your answer")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onInput={(e) => setHasText(e.currentTarget.value.trim().length > 0)}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-[15.5px] text-ink outline-none placeholder:text-ink3"
            />
          )}
          <button type="button" aria-label={t("studio.cinematic.composer.attachFiles", "Attach files")} disabled={!files} onClick={() => file.current?.click()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink2 transition enabled:hover:bg-ink/5 disabled:opacity-35">
            <Paperclip size={18} />
          </button>
          <button type="submit" aria-label={t("studio.cinematic.composer.send", "Send")} disabled={!typing || !hasText} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white transition enabled:hover:bg-accent disabled:opacity-25">
            <ArrowUp size={18} />
          </button>
          <input
            ref={file}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) useJourney.getState().answerFiles(files);
            }}
          />
        </form>
      )}
    </div>
  );
}
