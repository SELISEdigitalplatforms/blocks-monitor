/**
 * Clip blending without pops or T-poses, as pure functions (unit-tested in test/characters-motion.test.ts).
 *
 * three's AnimationMixer fills whatever weight is missing below 1 with the bind pose, and `reset()` on an action that is
 * still fading out jumps it back to its first frame. So instead of fadeIn/fadeOut, RealPerson keeps an activation per
 * clip that moves linearly towards 1 (the clip it wants) or 0 (all others), and plays the activations NORMALISED: the
 * weights always add up to exactly 1, a clip re-entered mid-fade continues from where it is, and only a clip whose
 * activation is 0 is (re)started.
 */
import type { ClipName } from "./registry";

/**
 * Moves the activations one frame towards `target` (index; -1 = none) at 1/`fade` per second and writes the normalised
 * weights into `weights`. Returns the sum of the activations (0 only when nothing plays).
 */
export function stepBlend(act: number[], target: number, dt: number, fade: number, weights: number[]): number {
  const rate = fade <= 0 ? Infinity : Math.max(0, dt) / fade;
  let sum = 0;
  for (let i = 0; i < act.length; i++) {
    const goal = i === target ? 1 : 0;
    const a = act[i];
    act[i] = goal > a ? Math.min(goal, a + rate) : Math.max(goal, a - rate);
    sum += act[i];
  }
  for (let i = 0; i < act.length; i++) weights[i] = sum > 0 ? act[i] / sum : 0;
  return sum;
}

/** seconds to blend from one clip into the next (by what kind of change it is) */
export function fadeFor(from: ClipName | null, to: ClipName): number {
  if (!from) return 0;
  if (to === "wave" || from === "wave" || to === "nod" || from === "nod") return 0.35;
  if (to === "walk" || from === "walk") return 0.3;
  if (to === "sit" || from === "sit") return 0.6;
  if ((from === "talk" || from === "talk2") && (to === "talk" || to === "talk2")) return 0.6;
  if ((from === "idle" || from === "idle2") && (to === "idle" || to === "idle2")) return 1.2;
  return 0.45;
}

/* ── variety: which variant, where to start ─────────────────────────────── */

/** a deterministic number in [0, 1) from two integers */
export function hash01(a: number, b: number): number {
  let h = Math.imul((a * 1000) | 0, 0x9e3779b1) ^ Math.imul((b + 17) | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** A spoken line's gestures: one of the talk clips, chosen per person and line, never the same twice in a row when
 *  there is a choice (`prev`). */
export function talkVariant(seed: number, line: number, prev: ClipName | null, variants: readonly ClipName[]): ClipName {
  if (variants.length <= 1) return variants[0] ?? "talk";
  let i = Math.floor(hash01(seed, line) * variants.length) % variants.length;
  if (variants[i] === prev) i = (i + 1) % variants.length;
  return variants[i];
}

/** Where in a long gesture clip a line starts (seconds), so every line shows different gestures: anywhere but the
 *  last 3 s. */
export function talkStart(seed: number, line: number, duration: number): number {
  const usable = Math.max(0, duration - 3);
  return hash01(seed + 7.7, line) * usable;
}

/** The idle the person shifts to when the current idle loop ends: mostly the main idle, now and then the other. */
export function nextIdle(r: number, has2: boolean): ClipName {
  return has2 && r < 0.4 ? "idle2" : "idle";
}

/** Per person: a playback rate around 1 for the standing loops, so a room of people never breathes in step. */
export function loopRate(seed: number): number {
  return 0.9 + hash01(seed, 99) * 0.2;
}

/* ── listening ─────────────────────────────────────────────────────────── */

/** seconds until the next nod while listening: 4 to 9 s */
export function nextNodIn(r: number): number {
  return 4 + r * 5;
}

/* ── loops without a seam ──────────────────────────────────────────────── */

/** Seconds of overlap when a standing clip runs into its end and continues (into its own start, or another variant):
 *  motion-capture loops do not close, so the wrap is crossfaded instead of jumped. */
export const LOOP_FADE = 0.9;

/** whether a clip at `time` of `duration` should hand over to its continuation now */
export function loopEnding(time: number, duration: number, fade = LOOP_FADE): boolean {
  return duration > fade * 2 && time >= duration - fade;
}

/** what a standing clip continues with at its end: the other talk (fresh gestures), an idle chosen by `r`, else itself
 *  (replayed from the start through its twin action) */
export function continuation(clip: ClipName, r: number, has: (c: ClipName) => boolean): ClipName {
  if (clip === "talk" && has("talk2")) return "talk2";
  if (clip === "talk2" && has("talk")) return "talk";
  if (clip === "idle" || clip === "idle2") return nextIdle(r, has("idle2"));
  return clip;
}
