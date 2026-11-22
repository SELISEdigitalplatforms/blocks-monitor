/** Text revealed at the speaking clock without React: a rAF loop writes the visible words straight into a span (only
 *  when a new word is due), so neither the overlay nor the 3D scene re-renders per character. */
import { useEffect, useRef } from "react";
import { CPS, type Line } from "../journey/store";

/** word end offsets in ms on a steady CPS clock */
function schedule(text: string): { words: string[]; at: number[] } {
  const words = text.split(/\s+/);
  const at: number[] = [];
  let chars = 0;
  for (const w of words) {
    chars += w.length + 1;
    at.push(((chars - 1) / CPS) * 1000 - (w.length / CPS) * 500); // a word shows as it starts being said
  }
  return { words, at };
}

export function useReveal(line: Line | null) {
  const text = useRef<HTMLSpanElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!line) return;
    const { words, at } = schedule(line.text);
    let shown = -1;
    let raf = 0;
    let started = false;
    const tick = () => {
      // the span may mount a frame later (the bubble lives in a portal); wait for it
      const el = text.current;
      if (!el) { raf = requestAnimationFrame(tick); return; }
      if (!started) { started = true; el.textContent = ""; if (caret.current) caret.current.style.display = ""; }
      const t = performance.now() - line.startedAt;
      let n = shown;
      while (n + 1 < words.length && at[n + 1] <= t) n++;
      if (n !== shown) {
        shown = n;
        el.textContent = words.slice(0, n + 1).join(" ");
      }
      if (shown < words.length - 1) raf = requestAnimationFrame(tick);
      else if (caret.current) caret.current.style.display = "none";
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line]);
  return { text, caret };
}
