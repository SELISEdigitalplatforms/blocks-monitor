/** The agent chat's place on the stage: a side panel docked on the right (a bottom sheet on phones). The stage lays its
 *  controls, labels and camera out in the part left of the panel. */

import { useEffect, useState } from "react";

/** the docked panel's width (px) */
export const DOCK_W = { full: 360, compact: 340 } as const;
/** px between the panel and the stage's edges (and the canvas UI beside it) */
export const DOCK_INSET = 12;

/** px of the stage's right side the docked panel takes, with its inset and the gap beside it */
export const dockReserve = (variant: "full" | "compact") => DOCK_W[variant] + 2 * DOCK_INSET;

/**
 * The width for a wrapping group of items (widths `ws`, `gap` px apart, `pad` px of padding in all) beside a docked
 * panel: null when they fit on one line of `avail` px; otherwise the narrowest width that still needs no more lines
 * than `avail` does, so the lines come out balanced and the group is no wider than its widest line.
 */
export function balancedWidth(ws: readonly number[], gap: number, pad: number, avail: number): number | null {
  if (!ws.length) return null;
  const widest = Math.max(...ws);
  if (ws.reduce((a, w) => a + w, 0) + gap * (ws.length - 1) + pad <= avail) return null;
  // lines a greedy wrap takes at content width `w`
  const lines = (w: number) => {
    let n = 1, line = -1;
    for (const x of ws) {
      if (line < 0) line = x;
      else if (line + gap + x <= w) line += gap + x;
      else { n++; line = x; }
    }
    return n;
  };
  let lo = widest, hi = Math.max(widest, avail - pad);
  const most = lines(hi);
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (lines(mid) <= most) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi + pad) + 1;
}

/** below this the chat is a bottom sheet over the page instead of a panel on the stage */
const SHEET_QUERY = "(max-width: 639px)";

const sheetNow = () => typeof matchMedia !== "undefined" && matchMedia(SHEET_QUERY).matches;

/** true while the chat shows as a bottom sheet (phones); follows the window */
export function useSheet(): boolean {
  const [sheet, setSheet] = useState(sheetNow);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const m = matchMedia(SHEET_QUERY);
    const on = () => setSheet(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return sheet;
}
