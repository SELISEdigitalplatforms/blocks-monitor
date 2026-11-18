/** What the people in the room say, where they say it: a speech bubble beside the speaker's head (above it on a phone),
 *  following the head as they move (its screen position is read every frame from the floor, visit/scene.ts `heads`,
 *  and written straight into the bubble's transform: no re-render per frame). The words stream in; a speaker's lines of
 *  one turn share the bubble (a few sentences); a new turn replaces it and the old one fades. While they think (an op in
 *  flight, an engine job running) the bubble is a small "…", with what they are doing when it takes a while.
 *  Screen readers hear each finished line once (a polite live region). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import { GUIDE_NAME } from "../ui/Avatar";
import { shownWords, typingOf, useChat, type ChatMessage, type Who } from "./chat";
import { bubbleBox, type StageLayout, type Viewport } from "./layout";
import { heads } from "./scene";

/** A line streaming in: the words are written straight into the span on animation frames. */
function Streaming({ m }: { m: ChatMessage }) {
  const span = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = span.current;
    if (!el) return;
    if (m.ms <= 0) { el.textContent = m.text; return; }
    let raf = 0;
    let last = "";
    const tick = () => {
      const words = shownWords(m, performance.now() - m.startedAt);
      if (words !== last) { last = words; el.textContent = words; }
      if (words.length < m.text.length) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [m]);
  return <span ref={span} />;
}

function Dots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((i) => <i key={i} className="visit-dot" style={{ animationDelay: `${i * 0.16}s` }} />)}
    </span>
  );
}

export function SpeechLayer({ layout, vp, fallback }: { layout: StageLayout; vp: Viewport; fallback: Who }) {
  const t = useT();
  const bubble = useChat((s) => s.bubble);
  const messages = useChat((s) => s.messages);
  const thinkWho = useChat((s) => typingOf(s)?.who ?? null);
  const thinkLabel = useChat((s) => typingOf(s)?.label ?? null);
  const box = useRef<HTMLDivElement>(null);

  // the bubble now: this turn's lines, or the thinking "…"; the last one stays on screen while it fades out
  const lines = bubble ? messages.filter((m) => bubble.ids.includes(m.id)) : [];
  const who: Who | null = bubble?.who ?? thinkWho;
  const live = Boolean(bubble || thinkWho);
  const [kept, setKept] = useState<{ who: Who; lines: ChatMessage[] } | null>(null);
  useEffect(() => { if (bubble && lines.length) setKept({ who: bubble.who, lines }); }, [bubble, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const showWho = who ?? kept?.who ?? fallback;
  const showLines = bubble ? lines : thinkWho ? [] : kept?.lines ?? [];
  const thinking = Boolean(thinkWho) && thinkWho === showWho;

  // follow the head: every frame, from the floor's projection (no React state)
  const layoutRef = useRef({ layout, vp, who: showWho });
  layoutRef.current = { layout, vp, who: showWho };
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current;
      if (!el) return;
      const { layout: l, vp: v, who: w } = layoutRef.current;
      const h = heads[w];
      if (!h.on) { if (lastKey !== "off") { el.style.visibility = "hidden"; lastKey = "off"; } return; }
      const b = bubbleBox(h, el.offsetHeight, v, l);
      // the width may narrow to keep clear of the head (a re-render resets it, so it is checked every frame)
      const width = `${b.width}px`;
      if (el.style.width !== width) { el.style.width = width; lastKey = ""; }
      const key = `${Math.round(b.left)}:${Math.round(b.top)}:${b.side}`;
      if (key === lastKey) return;
      lastKey = key;
      el.style.visibility = "";
      el.style.transform = `translate3d(${b.left}px, ${b.top}px, 0)`;
      el.dataset.side = b.side;
      // the tail points at the mouth
      const tail = b.side === "above" ? Math.max(18, Math.min(b.width - 18, h.x - b.left)) : Math.max(16, Math.min(el.offsetHeight - 16, h.y - b.top));
      el.style.setProperty("--tail", `${Math.round(tail)}px`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const last = lines[lines.length - 1];
  return (
    <>
      <div ref={box} aria-hidden className={cn("visit-speech pointer-events-none absolute left-0 top-0", live ? "is-on" : "is-off")}
        style={{ width: layout.bubbleWidth }}>
        <div key={bubble ? bubble.ids[0] : thinking ? "thinking" : "kept"} className="visit-speech-body">
          <p className="mb-1 text-[12px] font-medium text-ink3">{GUIDE_NAME[showWho]}</p>
          {showLines.length > 0 && (
            <p className="whitespace-pre-wrap break-words text-[16px] leading-[1.45] text-ink">
              {showLines.map((m, i) => (
                <span key={m.id} className={cn(m.tone === "error" && "text-[rgb(var(--c-danger-text))]")}>
                  {i > 0 ? " " : ""}{m === last ? <Streaming m={m} /> : m.text}
                </span>
              ))}
              {thinking && <>{" "}<Dots /></>}
            </p>
          )}
          {showLines.length === 0 && thinking && (
            <p className="flex items-center gap-2 text-[14px] text-ink2"><Dots />{thinkLabel && <span>{thinkLabel}</span>}</p>
          )}
        </div>
      </div>
      {/* the finished line, once, for screen readers */}
      <p className="sr-only" aria-live="polite">{last ? `${GUIDE_NAME[last.from as Who]}: ${last.text}` : thinking ? t("studio.office.visit.speech.thinking", "{name} is thinking…", { name: GUIDE_NAME[showWho] }) : ""}</p>
    </>
  );
}
