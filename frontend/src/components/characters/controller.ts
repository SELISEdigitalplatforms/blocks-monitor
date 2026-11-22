/**
 * How a person moves, as pure functions of what they are doing and the time (no React, no three.js; unit-tested).
 * RealPerson.tsx feeds this every frame and applies the result to the Rocketbox clips (crossfades), the facial blend
 * shapes or the jaw bone, and the head (look-at).
 */
import type { ClipName } from "./registry";

export interface Activity {
  moving?: boolean;
  /** turning on the spot (small steps) */
  turning?: boolean;
  seated?: boolean;
  /** saying a line: gestures and a moving mouth */
  talking?: boolean;
  /** hearing the visitor out: the listening idle */
  listening?: boolean;
}

/** the clip a person loops for what they are doing (a wave plays over it once) */
export function baseClip(a: Activity): ClipName {
  if (a.moving || a.turning) return "walk";
  if (a.seated) return "sit";
  if (a.talking) return "talk";
  if (a.listening) return "listen";
  return "idle";
}

/** seconds to blend from one clip into the next */
export function crossfade(from: ClipName | null, to: ClipName): number {
  if (!from) return 0;
  if (to === "wave" || from === "wave") return 0.3;
  if (to === "walk" || from === "walk") return 0.25;
  if (to === "sit" || from === "sit") return 0.6;
  return 0.45;
}

/** A wave plays once, then the person blends back. Seconds before the end of the wave to start blending back. */
export const WAVE_BLEND_OUT = 0.35;

export interface WaveState { startedAt: number | null }

/** whether the wave (started at `startedAt`, lasting `duration`) is still showing at `now` */
export function waving(w: WaveState, now: number, duration: number): boolean {
  return w.startedAt !== null && now - w.startedAt < Math.max(0.2, duration - WAVE_BLEND_OUT);
}

/** the clip to show: a wave in progress wins unless the person is walking or seated; a listening nod plays over the
 *  listening idle (`nod`: when it started and how long it lasts) */
export function currentClip(a: Activity, w: WaveState, now: number, waveDuration: number, nod?: { startedAt: number | null; duration: number }): ClipName {
  const base = baseClip(a);
  if (base !== "walk" && base !== "sit" && waving(w, now, waveDuration)) return "wave";
  if (base === "listen" && nod && waving(nod, now, nod.duration)) return "nod";
  return base;
}

/* ── the face ─────────────────────────────────────────────────────────── */

/** seconds until the next blink, from a random number in [0, 1): 2.2 to 5.8 s, now and then a quick double */
export function nextBlinkIn(r: number): number {
  return r < 0.12 ? 0.35 : 2.2 + r * 3.6;
}

export const BLINK_SECONDS = 0.16;

/** a blink comes with a large shift of gaze (radians of head turn wanted at once), as people do */
export const GAZE_BLINK = 0.35;

/** eyelids closed (0..1) `t` seconds into a blink: fast close, slower open */
export function blinkWeight(t: number): number {
  if (t < 0 || t >= BLINK_SECONDS) return 0;
  const close = BLINK_SECONDS * 0.4;
  return t < close ? t / close : 1 - (t - close) / (BLINK_SECONDS - close);
}

export interface Mouth { aa: number; oh: number; ee: number; pp: number; jawOpen: number }

const SILENT: Mouth = { aa: 0, oh: 0, ee: 0, pp: 0, jawOpen: 0 };

/** A speaking mouth without audio: syllable-rate opening with shifting vowel shapes and the odd closed consonant.
 *  Deterministic in `t` (seconds speaking) and `seed`; every weight in [0, 1], silent when not talking. */
export function mouthAt(t: number, talking: boolean, seed = 0): Mouth {
  if (!talking || t < 0) return SILENT;
  const syl = 0.5 + 0.5 * Math.sin(t * 11.3 + seed);
  const phrase = 0.65 + 0.35 * Math.sin(t * 1.7 + seed * 0.37);
  const open = Math.min(1, Math.max(0, syl * phrase));
  const v = (Math.sin(t * 3.1 + seed * 1.3) + 1) / 2;
  const closed = Math.max(0, Math.sin(t * 7.7 + seed * 2.1) - 0.82) / 0.18;
  const k = 1 - closed;
  return {
    aa: clamp01(open * (1 - v) * 0.7 * k),
    oh: clamp01(open * v * 0.55 * k),
    ee: clamp01((1 - open) * 0.35 * k),
    pp: clamp01(closed * 0.8),
    jawOpen: clamp01(open * 0.28 * k),
  };
}

/** a small friendly smile (0..1) that rises while greeting and talking */
export function smileFor(talking: boolean, greeting: boolean): number {
  return greeting ? 0.45 : talking ? 0.22 : 0.12;
}

/* ── the head ─────────────────────────────────────────────────────────── */

export const LOOK_YAW = 0.7;
export const LOOK_PITCH = 0.3;

/** Head turn towards a point given in the person's own frame (x right, y up, z forwards; eye height `eyeY`):
 *  clamped to a natural range; behind the person they look ahead again rather than twisting. */
export function lookAngles(x: number, y: number, z: number, eyeY: number): { yaw: number; pitch: number } {
  if (z <= 0.05) return { yaw: 0, pitch: 0 };
  const yaw = Math.atan2(x, z);
  const flat = Math.hypot(x, z);
  const pitch = Math.atan2(y - eyeY, flat);
  return { yaw: clamp(yaw, -LOOK_YAW, LOOK_YAW) + 0, pitch: clamp(-pitch, -LOOK_PITCH, LOOK_PITCH) + 0 };
}

/* ── thinking ─────────────────────────────────────────────────────────── */

/** How far a thinking glance is turned away (0..1) `t` seconds after the thought began: it eases down and aside in a
 *  quarter of a second, holds briefly and is back on the visitor after about a second; never a held profile. */
export function thinkingGlance(t: number): number {
  if (t <= 0 || t >= 1.1) return 0;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (t < 0.25) return ease(t / 0.25);
  if (t < 0.55) return 1;
  return 1 - ease((t - 0.55) / 0.55);
}

/* ── the eyes ─────────────────────────────────────────────────────────── */

export const EYE_YAW = 0.38;
export const EYE_PITCH = 0.22;

/** The eyes take what the head has not turned yet (they lead, the head follows), within their own range, plus a small
 *  saccade offset. */
export function eyeAngles(wantYaw: number, headYaw: number, wantPitch: number, headPitch: number, sx = 0, sy = 0): { yaw: number; pitch: number } {
  return { yaw: clamp(wantYaw - headYaw + sx, -EYE_YAW, EYE_YAW), pitch: clamp(wantPitch - headPitch + sy, -EYE_PITCH, EYE_PITCH) };
}

/** seconds until the next small eye movement while looking at someone: 0.6 to 2.6 s */
export function nextSaccadeIn(r: number): number {
  return 0.6 + r * 2;
}

/** a small fixation shift (radians) from two numbers in [0, 1): within ±0.05 sideways, ±0.03 up and down */
export function saccade(r1: number, r2: number): { x: number; y: number } {
  return { x: (r1 - 0.5) * 0.1, y: (r2 - 0.5) * 0.06 };
}

/* ── breathing ────────────────────────────────────────────────────────── */

/** The chest's breathing (radians of pitch) at time t: a calm 3.6-4.8 s breath, different per person (seed); stronger
 *  while talking. Layered after the clips, so even a still pose breathes. */
export function breath(t: number, seed: number, talking = false): number {
  const period = 3.6 + ((seed * 3.17) % 1.2);
  const phase = (seed * 1.93) % (Math.PI * 2);
  return (talking ? 0.016 : 0.011) * Math.sin((t / period) * Math.PI * 2 + phase);
}

/** frame-rate independent approach of `current` to `target` (rate per second) */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

/** scale that makes a model `modelHeight` tall stand `targetHeight` tall */
export function fitScale(modelHeight: number, targetHeight: number): number {
  return modelHeight > 0.01 ? targetHeight / modelHeight : 1;
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
function clamp01(v: number) {
  return clamp(v, 0, 1);
}

/* ── the office ───────────────────────────────────────────────────────── */

export interface OfficeMotion { moving: boolean; speed: number; seated: boolean; turning?: boolean }

/** what an office agent's status and motion mean for the person */
export function officeActivity(status: string, m: OfficeMotion): Activity & { speed: number } {
  return {
    moving: m.moving,
    turning: !m.moving && Boolean(m.turning),
    seated: m.seated && !m.moving,
    speed: m.speed,
    talking: !m.moving && !m.seated && status === "working",
    listening: !m.moving && (status === "waiting" || status === "queued"),
  };
}

/** a stable per-agent number for timing variation */
export function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 100;
}

