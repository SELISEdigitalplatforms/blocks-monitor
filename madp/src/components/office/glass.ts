/** The panels drawn over the 3D stage (stage controls, hint, inspector, the docked chat), as rectangles in canvas
 *  pixels: the label layout keeps every label clear of them. Measured at most every 400 ms per canvas and kept relative
 *  to the canvas (so scrolling does not stale them); per-frame calls do not allocate. */

const MAX = 32;
const TTL_MS = 400;

type Entry = { at: number; n: number; rects: Float32Array };
const cache = new WeakMap<HTMLCanvasElement, Entry>();

function refresh(canvas: HTMLCanvasElement, e: Entry, now: number): void {
  e.at = now;
  e.n = 0;
  const c = canvas.getBoundingClientRect();
  const host = canvas.closest("section") ?? document.body;
  const cards = host.querySelectorAll<HTMLElement>(".glass-card, [data-stage-obstacle]");
  for (let i = 0; i < cards.length && e.n < MAX; i++) {
    const el = cards[i];
    if (el.contains(canvas)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const o = e.n * 4;
    e.rects[o] = r.left - c.left;
    e.rects[o + 1] = r.top - c.top;
    e.rects[o + 2] = r.right - c.left;
    e.rects[o + 3] = r.bottom - c.top;
    e.n++;
  }
}

/** Writes the panels' rectangles (x0, y0, x1, y1 in canvas pixels) into `out` and returns how many (at most `max`). */
export function glassRects(canvas: HTMLCanvasElement, out: Float32Array, max: number): number {
  let e = cache.get(canvas);
  const now = performance.now();
  if (!e) {
    e = { at: 0, n: 0, rects: new Float32Array(MAX * 4) };
    cache.set(canvas, e);
    refresh(canvas, e, now);
  } else if (now - e.at > TTL_MS) {
    refresh(canvas, e, now);
  }
  const n = Math.min(e.n, max);
  for (let i = 0; i < n * 4; i++) out[i] = e.rects[i];
  return n;
}
