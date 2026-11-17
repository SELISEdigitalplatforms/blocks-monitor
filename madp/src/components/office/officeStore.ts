/** Replaces the MADP Studio stores the office used: the stage selection (Studio store/stage.ts, keyed by
 *  office instance instead of run) and the theme (Studio store/ui.ts; here the office follows the Factory's
 *  <html data-theme> directly, so it needs no app store). The bridge's live store is replaced by props. */

import { useEffect, useState } from "react";
import { create } from "zustand";

/** the agent picked on an office stage; that office's inspector highlights it */
export interface StageSelection { office: string; agent: string }

interface StageState {
  selected: StageSelection | null;
  select: (s: StageSelection | null) => void;
  /** the selected agent's chat anchor (the DOM element of a drei Html at its head) */
  anchor: { office: string; el: HTMLElement } | null;
  /** null clears only when the anchor belongs to that office */
  setAnchor: (office: string, el: HTMLElement | null) => void;
  /** the office whose chat bubble is docked over the stage's right side (the Team strip steps aside) */
  docked: string | null;
  setDocked: (office: string, on: boolean) => void;
  /** a task was just handed to the business analyst (role planner) of that office */
  cue: { office: string; at: number } | null;
  cueNewTask: (office: string) => void;
}

export const useOfficeStage = create<StageState>((set) => ({
  selected: null,
  select: (s) => set({ selected: s }),
  anchor: null,
  setAnchor: (office, el) => set((st) => {
    if (el) return { anchor: { office, el } };
    return st.anchor?.office === office ? { anchor: null } : st;
  }),
  docked: null,
  setDocked: (office, on) => set((st) => {
    if (on) return st.docked === office ? st : { docked: office };
    return st.docked === office ? { docked: null } : st;
  }),
  cue: null,
  cueNewTask: (office) => set({ cue: { office, at: performance.now() } }),
}));

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

/** true while the app shows its dark theme; re-renders when the theme flips */
export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const on = () => setDark(isDark());
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    on();
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** true when the person prefers reduced motion; follows changes */
export function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setRm(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return rm;
}
