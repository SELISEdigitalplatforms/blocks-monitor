/** The office's screen layout, pure (no React, no three.js; unit-tested in test/cinematic/visitLayout.test.ts): a room,
 *  the person you talk to standing in it, what they say in a speech bubble beside their head, and your words in a slim
 *  bar at the bottom centre. No panel.
 *   - "wide" (a laptop or wider): the person a little left of the middle, the bubble beside their head on the side with
 *     room (it never covers their face, the step list or the top bar);
 *   - "phone": the person in the middle, the bubble above their head, the input docked at the bottom. */
import type { ComposerSpec } from "./chat";

export interface Viewport { w: number; h: number }

export type StageMode = "wide" | "phone";

export interface StageLayout {
  mode: StageMode;
  /** the step list beside the room (wide screens with room for it), else folded into one line under the top bar */
  steps: { shown: boolean; left: number; top: number; width: number };
  /** where the speaking person's head should be: x as a fraction of the width, y in normalized device units (-1 bottom,
   *  1 top), and how much of the height the person may take (the camera's distance follows) */
  speaker: { x: number; headNdcY: number; heightShare: number };
  /** the speech bubble's width (px) */
  bubbleWidth: number;
  /** the input bar: its width and its distance from the bottom (px) */
  input: { width: number; bottom: number };
}

export const EDGE = 24;
export const TOP_BAR = 76;
const STEPS_W = 280;
/** the gap between a head and its bubble (px) */
export const BUBBLE_GAP = 26;

export function stageLayout(vp: Viewport): StageLayout {
  const w = Math.max(320, vp.w);
  const h = Math.max(480, vp.h);
  if (w >= 900 && h >= 540) {
    const showSteps = w >= 1180;
    return {
      mode: "wide",
      steps: { shown: showSteps, left: EDGE, top: TOP_BAR + 8, width: STEPS_W },
      speaker: { x: showSteps ? 0.44 : 0.4, headNdcY: 0.42, heightShare: 0.78 },
      bubbleWidth: Math.round(Math.min(400, Math.max(300, w * 0.24))),
      input: { width: Math.round(Math.min(680, w - 2 * EDGE)), bottom: 28 },
    };
  }
  return {
    mode: "phone",
    steps: { shown: false, left: 12, top: TOP_BAR, width: 0 },
    // the person stands lower, their bubble above their head
    speaker: { x: 0.5, headNdcY: 0.18, heightShare: 0.5 },
    bubbleWidth: w - 2 * 16,
    input: { width: w - 2 * 12, bottom: 12 },
  };
}

/** The camera may stand no further than this from the person (m), so it stays inside the room they are in. */
export const MAX_DISTANCE: Record<"reception" | "meeting", number> = { reception: 2.6, meeting: 3.2 };

/* ── the speech bubble ───────────────────────────────────────────────────── */

export interface BubbleBox { left: number; top: number; width: number; side: "right" | "left" | "above" }

/** The head on screen: the mouth (x, y), half-width r (ears, hair and sway included), top and bottom (px). */
export interface HeadBox { x: number; y: number; r: number; top: number; bottom: number }

/** the narrowest a bubble may get to stay clear of the head (px) */
export const BUBBLE_MIN = 220;

/** Where the bubble goes for a head on screen: beside it, clear of the head's whole box (face, ears, hair) by a gap, on
 *  the side with room (wide), or above the top of the head (phone); always inside the screen, below the top bar and
 *  clear of the step list. When neither side has its full width, it narrows rather than touch the head.
 *  `height` is the bubble's measured height. */
export function bubbleBox(head: HeadBox, height: number, vp: Viewport, l: StageLayout): BubbleBox {
  const w = l.bubbleWidth;
  const minLeft = EDGE + (l.steps.shown ? l.steps.width + EDGE : 0);
  const maxTop = vp.h - l.input.bottom - 120 - height;
  if (l.mode === "phone") {
    const top = Math.max(TOP_BAR + 32, Math.min(head.top - BUBBLE_GAP - height, maxTop));
    return { left: Math.round((vp.w - w) / 2), top: Math.round(top), width: w, side: "above" };
  }
  const startRight = head.x + head.r + BUBBLE_GAP;
  const endLeft = head.x - head.r - BUBBLE_GAP;
  const roomRight = vp.w - EDGE - startRight;
  const roomLeft = endLeft - minLeft;
  // the right side when it fits, else the left when it fits, else the side with more room (narrowed to it)
  const side: BubbleBox["side"] = roomRight >= w ? "right" : roomLeft >= w ? "left" : roomRight >= roomLeft ? "right" : "left";
  const width = Math.round(Math.max(BUBBLE_MIN, Math.min(w, side === "right" ? roomRight : roomLeft)));
  const x = side === "right" ? startRight : endLeft - width;
  // the bubble's top sits a little above the mouth, so its tail points at it
  const top = Math.max(TOP_BAR + 8, Math.min(head.y - height * 0.5, maxTop));
  return { left: Math.round(x), top: Math.round(top), width, side };
}

/* ── the input ───────────────────────────────────────────────────────────── */

/** What the input shows: "write" (the field takes the answer), "choose" (the answers are the choices above it), "wait"
 *  (the other side is thinking: you can type ahead, but Send waits), "closed" (nothing to answer now). */
export type ComposerState = "write" | "choose" | "wait" | "closed";

export function composerState(spec: ComposerSpec | null, busy: boolean): ComposerState {
  if (!spec) return "closed";
  if (busy) return "wait";
  if (spec.mode === "text") return "write";
  return spec.replies?.length ? "choose" : "closed";
}

/** Send is possible: the field takes answers, nothing is in flight and there is something to send. */
export function canSend(state: ComposerState, text: string): boolean {
  return (state === "write" || state === "choose") && text.trim().length > 0;
}

/** Enter sends, Shift + Enter makes a new line, never while an input method is composing. */
export function sendsOnEnter(e: { key: string; shiftKey?: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/* ── the camera ──────────────────────────────────────────────────────────── */

export type V3 = [number, number, number];

export interface Framing {
  /** the person's feet and the way they face (0 faces +z) */
  at: V3;
  yaw: number;
  aspect: number;
  /** vertical field of view, degrees */
  fov: number;
  /** where the head should land: x as a fraction of the width, y in normalized device units */
  x: number;
  headNdcY: number;
  /** how much of the frame's height the person may take (0..1): the distance follows */
  heightShare: number;
  /** the camera stands no further away than this (m): it stays in the room */
  maxDistance?: number;
  /** the visitor's eye height (m) and the person's head height (m) */
  eye?: number;
  head?: number;
  /** the camera stands a little to this side of straight ahead (radians): a three-quarter view */
  side?: number;
}

/** The visitor's view of a person: in front of them (slightly to the side), at eye height, turned so the person's head
 *  lands at (x, headNdcY) on the screen and they take about `heightShare` of the height. */
export function frameSpeaker(f: Framing): { pos: V3; target: V3; distance: number } {
  const eye = f.eye ?? 1.6;
  const head = f.head ?? 1.74;
  const tanV = Math.tan(((f.fov * Math.PI) / 180) / 2);
  // the frame's height at distance d is 2·d·tanV: the person (head height) takes heightShare of it
  const distance = Math.min(f.maxDistance ?? 6.5, Math.max(1.6, head / (f.heightShare * 2 * tanV)));
  const dir = f.yaw + (f.side ?? 0.18);
  const px = f.at[0] + Math.sin(dir) * distance;
  const pz = f.at[2] + Math.cos(dir) * distance;
  // horizontally: the angle from the view axis that puts the person at x (screen right is the camera's -x side when
  // looking down +z, so a person on the left of the screen sits at a larger heading than the view)
  const toPerson = Math.atan2(f.at[0] - px, f.at[2] - pz);
  const ndcX = 2 * f.x - 1;
  const theta = Math.atan(ndcX * tanV * f.aspect);
  const view = toPerson + theta;
  // vertically: the pitch that puts the head at headNdcY
  const D = Math.hypot(f.at[0] - px, f.at[2] - pz) * Math.cos(theta);
  const pitch = Math.atan((head - eye) / D) - Math.atan(f.headNdcY * tanV);
  const reach = 4;
  return {
    pos: [px, eye, pz],
    target: [px + Math.sin(view) * reach, eye + Math.tan(pitch) * reach, pz + Math.cos(view) * reach],
    distance,
  };
}
