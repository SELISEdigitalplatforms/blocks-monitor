/** Small helpers shared by the release page and the code chips (clipboard copy, reduced motion). */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

/** Honour the operating system's reduced-motion setting. */
export function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Copy text to the clipboard; falls back to a hidden textarea where the async clipboard is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea */
  }
  const prev = document.activeElement as HTMLElement | null;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      return document.execCommand("copy");
    } finally {
      ta.remove();
      prev?.focus?.();
    }
  } catch {
    return false;
  }
}

export type CopyState = "idle" | "copied" | "manual";

/** Copy with a short "copied" state. When the browser blocks the clipboard, the visible text (the element on `target`)
 *  is selected instead and the state is "manual", so the caller can say how to copy it (manualCopy). */
export function useCopy(text: string) {
  const [state, setState] = useState<CopyState>("idle");
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (state === "idle") return;
    // after the render, so a target that only shows in the "manual" state is there to select
    const el = target.current;
    const sel = window.getSelection();
    if (state === "manual" && el && sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const t = window.setTimeout(() => setState("idle"), state === "copied" ? 2000 : 6000);
    return () => window.clearTimeout(t);
  }, [state]);
  const copy = useCallback(async () => setState((await copyText(text)) ? "copied" : "manual"), [text]);
  return { state, copy, target };
}

/** "Ctrl+C", or "⌘C" on a Mac */
const COPY_KEYS = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘C" : "Ctrl+C";
/** a touch screen: no keys to press */
const TOUCH = typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);

/** The hint for the "manual" copy state: the keys to press, or on a touch screen that the text is selected, e.g.
 *  manualCopy("Link") -> "Press Ctrl+C to copy" or "Link selected: copy it". */
export const manualCopy = (what: string) => (TOUCH ? t("build.release.copy.selected", "{what} selected: copy it", { what })
  : t("build.release.copy.press", "Press {keys} to copy", { keys: COPY_KEYS }));
