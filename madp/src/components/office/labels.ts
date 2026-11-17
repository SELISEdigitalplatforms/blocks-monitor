/** Screen-space layout for the stage's HTML labels: the agents' speech bubbles and name chips, and the station signs.
 *  drei's Html pins each label to its anchor; this pass decides where around the anchor it sits and whether it shows.
 *  Every frame the anchors are projected to canvas pixels and the labels are placed greedily by rank, with box sizes
 *  cached by a ResizeObserver: a label that would overlap one already placed, a panel over the stage (controls, hint,
 *  the docked chat) or the stage's edge moves up by up to its own height; a station sign may instead step just beside
 *  or below what covers it (within about its own size); if it still collides it fades out and leaves the accessibility
 *  tree. A label keeps its place until another one is clearly free (no flicker), the DOM is written only when a place
 *  changes, and nothing is allocated per frame. */

import { useFrame, useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo } from "react";
import { Vector3, type Camera, type Object3D } from "three";
import { glassRects } from "./glass";

/** Placement order: lower ranks are placed first and never give way to higher ones. A pinned label (the hover card, a
 *  picked agent's chip) always shows; an alert is a bubble about a send-back or a failure. */
export const RANK = { pinned: 0, alert: 1, bubble: 2, busy: 3, sign: 4, free: 5 } as const;

/** Classes every placed label carries: pinned to the anchor's corner (the pass sets its offset) and hidden until placed. */
export const LABEL_CLASS = "absolute left-0 top-0 opacity-0 transition-opacity duration-150";

/** px between a bubble and the chip under it (the bubble's tail sits in this gap) */
const GAP = 6;
/** px kept clear around every label */
const PAD = 4;
/** extra px a label needs before it moves or shows again */
const HYST = 6;
/** px kept clear of the stage's edges */
const EDGE = 8;
/** a chip's height until it is measured */
const CHIP_H = 22;
/** how far a covered sign may step aside (its widths) or down (its heights) */
const SIGN_REACH_X = 2;
const SIGN_REACH_Y = 6;
const MAX = 64;

export class Label {
  el: HTMLElement | null = null;
  anchor: Object3D | null = null;
  rank: number = RANK.free;
  /** opacity while shown (a free agent's chip steps back a little) */
  alpha = 1;
  /** a bubble: the chip it stands on (it shares the chip's anchor and sits above it) */
  base: Label | null = null;
  /** a chip: the bubble standing on it (a chip under a bubble keeps its place) */
  topped: Label | null = null;
  board: LabelBoard | null = null;
  /** measured border box */
  w = 0;
  h = 0;
  // the pass's state: shown last frame, its upward shift, the offsets and opacity last written
  shown = false;
  dy = 0;
  x = 0;
  y = 0;
  op = 0;
  // this frame's projected anchor (px) and depth
  ax = 0;
  ay = 0;
  z = 0;
  /** callback ref for the label's element */
  readonly ref = (el: HTMLElement | null) => { if (this.board) this.board.attach(this, el); else this.el = el; };
  /** callback ref for the group the label's Html hangs from */
  readonly anchorRef = (o: Object3D | null) => { this.anchor = o; };
}

const P = new Vector3();
const byPlace = (a: Label, b: Label) => a.rank - b.rank || Number(b.shown) - Number(a.shown) || a.z - b.z;

export class LabelBoard {
  private readonly labels: Label[] = [];
  private readonly byEl = new Map<Element, Label>();
  private readonly order: Label[] = [];
  private readonly occ = new Float32Array(MAX * 4);
  private readonly owner: (Label | null)[] = new Array(MAX).fill(null);
  /** the step a covered sign takes (nudge) */
  private nx = 0;
  private ny = 0;
  private readonly ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
    for (const e of entries) {
      const l = this.byEl.get(e.target);
      if (!l) continue;
      const box = e.borderBoxSize?.[0];
      l.w = box ? box.inlineSize : (e.target as HTMLElement).offsetWidth;
      l.h = box ? box.blockSize : (e.target as HTMLElement).offsetHeight;
    }
  });

  add(l: Label) {
    if (l.board === this) return;
    l.board = this;
    this.labels.push(l);
    const el = l.el;
    l.el = null;
    this.attach(l, el);
  }

  remove(l: Label) {
    if (l.board !== this) return;
    this.attach(l, null);
    l.board = null;
    this.labels.splice(this.labels.indexOf(l), 1);
  }

  /** a label's element appeared, changed or went: measure the new one; it starts hidden (LABEL_CLASS) */
  attach(l: Label, el: HTMLElement | null) {
    if (l.el === el) return;
    if (l.el) {
      this.ro?.unobserve(l.el);
      this.byEl.delete(l.el);
    }
    l.el = el;
    l.w = l.h = l.op = 0;
    l.shown = false;
    if (!el) return;
    this.byEl.set(el, l);
    if (this.ro) this.ro.observe(el);
    else { l.w = el.offsetWidth; l.h = el.offsetHeight; }
  }

  dispose() {
    this.ro?.disconnect();
    this.byEl.clear();
    for (const l of this.labels) l.board = null;
    this.labels.length = 0;
  }

  /** one pass over every label; `snap` (reduced motion) moves labels without easing */
  layout(camera: Camera, canvas: HTMLCanvasElement, W: number, H: number, dt: number, snap: boolean) {
    const list = this.order;
    list.length = 0;
    for (const l of this.labels) {
      if (!l.el) continue;
      const anchor = l.anchor ?? l.base?.anchor;
      if (!anchor || !l.w || !l.h) { this.fade(l, 0); continue; }
      anchor.updateWorldMatrix(true, false);
      P.setFromMatrixPosition(anchor.matrixWorld).project(camera);
      l.ax = (P.x + 1) * 0.5 * W;
      l.ay = (1 - P.y) * 0.5 * H;
      l.z = P.z;
      list.push(l);
    }
    list.sort(byPlace);
    let n = glassRects(canvas, this.occ, MAX);
    for (let i = 0; i < n; i++) this.owner[i] = null;
    const k = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 16);
    for (const l of list) {
      const ox = -Math.round(l.w / 2);
      const oy = Math.round(l.base ? -(l.base.h || CHIP_H) / 2 - GAP - l.h : -l.h / 2);
      let shift: number | null = null;
      let side = 0;
      // an anchor off the stage (or behind the camera) hides its label: its agent or station is out of view
      if (l.z < 1 && l.ax >= 0 && l.ax <= W && l.ay >= 0 && l.ay <= H) {
        const pinned = l.rank === RANK.pinned;
        const steps = pinned || l.topped?.el ? 1 : 3;
        for (let s = 0; s < steps; s++) {
          const dy = -Math.round((l.h * s) / 2);
          const pad = l.shown && dy === l.dy && l.x === ox ? PAD : PAD + HYST;
          if (pinned || this.free(l, l.ax + ox, l.ay + oy + dy, n, W, H, pad)) { shift = dy; break; }
        }
        if (shift === null && l.rank === RANK.sign) {
          // the way it stepped last frame (left, right, down) is kept unless another is clearly nearer
          const was = !l.shown ? -1 : l.x < ox ? 0 : l.x > ox ? 1 : l.dy > 0 ? 2 : -1;
          if (this.nudge(l, l.ax + ox, l.ay + oy, n, W, H, was)) { side = this.nx; shift = this.ny; }
        }
      }
      if (shift === null) {
        this.fade(l, 0);
        l.shown = false;
        continue;
      }
      const tx = ox + side;
      if (n < MAX) {
        const o = n * 4;
        this.occ[o] = l.ax + tx;
        this.occ[o + 1] = l.ay + oy + shift;
        this.occ[o + 2] = l.ax + tx + l.w;
        this.occ[o + 3] = l.ay + oy + shift + l.h;
        this.owner[n++] = l;
      }
      // a label that (re)appears does so in place; a shown one eases to its new shift
      const ty = oy + shift;
      const y = !l.shown ? ty : Math.abs(ty - l.y) < 0.5 ? ty : l.y + (ty - l.y) * k;
      const el = l.el as HTMLElement;
      if (tx !== l.x || Math.round(y) !== Math.round(l.y) || !l.shown) el.style.translate = `${tx}px ${Math.round(y)}px`;
      l.x = tx;
      l.y = y;
      l.dy = shift;
      l.shown = true;
      this.fade(l, l.alpha);
    }
  }

  /** A covered sign's nearest free place just left, right or below one of the boxes covering it (within its reach):
   *  true with the step in nx/ny, false when there is none. */
  private nudge(l: Label, x0: number, y0: number, n: number, W: number, H: number, was: number): boolean {
    const pad = PAD + HYST, x1 = x0 + l.w, y1 = y0 + l.h;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const left = this.occ[o], top = this.occ[o + 1], right = this.occ[o + 2], bottom = this.occ[o + 3];
      if (!(x1 + pad > left && x0 - pad < right && y1 + pad > top && y0 - pad < bottom)) continue;
      for (let c = 0; c < 3; c++) {
        const dx = c === 0 ? Math.floor(left - pad - x1) : c === 1 ? Math.ceil(right + pad - x0) : 0;
        const dy = c === 2 ? Math.ceil(bottom + pad - y0) : 0;
        const d = Math.abs(dx) + dy - (c === was ? 2 * HYST : 0);
        if (d >= best || Math.abs(dx) > l.w * SIGN_REACH_X || dy > l.h * SIGN_REACH_Y) continue;
        if (this.free(l, x0 + dx, y0 + dy, n, W, H, pad)) { best = d; this.nx = dx; this.ny = dy; }
      }
    }
    return best < Infinity;
  }

  /** the box is inside the stage (minus its edge) and clear of every glass panel and label placed so far */
  private free(l: Label, x0: number, y0: number, n: number, W: number, H: number, pad: number): boolean {
    const x1 = x0 + l.w, y1 = y0 + l.h, edge = EDGE + pad - PAD;
    if (x0 < edge || y0 < edge || x1 > W - edge || y1 > H - edge) return false;
    for (let i = 0; i < n; i++) {
      const who = this.owner[i];
      // a bubble and its own chip are stacked by design
      if (who && (who === l.base || who.base === l)) continue;
      const o = i * 4;
      if (x1 + pad > this.occ[o] && x0 - pad < this.occ[o + 2] && y1 + pad > this.occ[o + 1] && y0 - pad < this.occ[o + 3]) return false;
    }
    return true;
  }

  /** shows or hides a label; only a shown one takes clicks (data-shown, see office.css) */
  private fade(l: Label, op: number) {
    if (l.op === op || !l.el) return;
    l.op = op;
    l.el.style.opacity = String(op);
    if (op) {
      l.el.removeAttribute("aria-hidden");
      l.el.setAttribute("data-shown", "");
    } else {
      l.el.setAttribute("aria-hidden", "true");
      l.el.removeAttribute("data-shown");
    }
  }
}

export const LabelContext = createContext<LabelBoard | null>(null);

/** A label on the stage's board while the component is mounted; its owner sets rank, alpha and the pairing. */
export function useLabel(): Label {
  const board = useContext(LabelContext);
  const label = useMemo(() => new Label(), []);
  useEffect(() => {
    if (!board) return;
    board.add(label);
    return () => board.remove(label);
  }, [board, label]);
  return label;
}

/** Runs the layout pass every frame, after the agents and the camera have moved (render it after them). */
export function LabelLayout({ board, reducedMotion }: { board: LabelBoard; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const size = useThree((s) => s.size);
  useFrame((_, dt) => board.layout(camera, canvas, size.width, size.height, dt, reducedMotion));
  return null;
}
