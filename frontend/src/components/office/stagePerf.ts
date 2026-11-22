/** Pure render-budget helpers for the 3D stage (no React, DOM or three imports). */

export const LARGE_SCREEN_MIN_WIDTH = 1280;

/** device pixel ratio range for the canvas: capped at 1.5 on large screens */
export function dprRange(viewportWidth: number): [number, number] {
  return [1, viewportWidth >= LARGE_SCREEN_MIN_WIDTH ? 1.5 : 2];
}

export type Frameloop = "always" | "never";

/** draw only while the stage is on screen and the tab is visible */
export function frameloopFor(s: { inView: boolean; hidden: boolean }): Frameloop {
  return s.inView && !s.hidden ? "always" : "never";
}

// ── frame pacing ──

/** Frames per second the stage draws at. 60 (every display frame) while a live build runs; an idle floor only
 *  breathes (ambient idle animation), so it draws at a lower rate, and anything that moves on screen (the camera, a
 *  walking agent, a hover) wakes it to every display frame. Reduced motion draws on demand only (0). */
export function tickRate(s: { live: boolean; reducedMotion: boolean; compact: boolean }): number {
  if (s.reducedMotion) return 0;
  if (s.compact) return s.live ? 30 : 20;
  return s.live ? 60 : 30;
}

// ── adaptive quality ──

/** 0 low (no shadows, 1x pixels), 1 medium, 2 high */
export type Tier = 0 | 1 | 2;

export interface TierSpec {
  /** upper bound for the device pixel ratio */
  dprCap: number;
  shadows: boolean;
  shadowMapSize: number;
}

export const TIERS: Readonly<Record<Tier, TierSpec>> = {
  0: { dprCap: 1, shadows: false, shadowMapSize: 512 },
  1: { dprCap: 1.25, shadows: true, shadowMapSize: 1024 },
  2: { dprCap: 2, shadows: true, shadowMapSize: 2048 },
};

/** the canvas's dpr range for a tier: the screen's range, capped by the tier */
export function dprFor(tier: Tier, range: [number, number]): [number, number] {
  const cap = TIERS[tier].dprCap;
  return [Math.min(range[0], cap), Math.min(range[1], cap)];
}

/** The starting tier from what the browser says about the device: weak devices start low, phones and tablets medium. */
export function initialTier(d: { cores?: number; memoryGb?: number; coarse?: boolean; saveData?: boolean }): Tier {
  if (d.saveData) return 0;
  if ((d.cores !== undefined && d.cores <= 2) || (d.memoryGb !== undefined && d.memoryGb <= 2)) return 0;
  if (d.coarse || (d.cores !== undefined && d.cores <= 4) || (d.memoryGb !== undefined && d.memoryGb <= 4)) return 1;
  return 2;
}

/** frames per window before the governor judges the frame rate */
export const GOVERNOR_WINDOW = 45;
/** below this average frame rate (while drawing back to back) the stage steps one tier down */
export const SLOW_FPS = 45;
/** this many windows in a row at FAST_FPS or above before the stage tries one tier up */
export const FAST_FPS = 57;
export const FAST_WINDOWS = 4;
/** tier changes per stage before the governor stops changing (no flip-flopping) */
export const MAX_FLIPS = 4;
/** quiet time after a change, so the new tier's first (shader-compiling) frames are not judged */
export const SETTLE_MS = 2000;

export interface Governor {
  tier: Tier;
  /** frame times (ms) summed over the current window */
  sum: number;
  n: number;
  /** windows in a row at FAST_FPS or above */
  fast: number;
  flips: number;
  /** when the tier last changed (ms, any clock) */
  changedAt: number;
}

export function governorStart(tier: Tier, now = 0): Governor {
  return { tier, sum: 0, n: 0, fast: 0, flips: 0, changedAt: now };
}

/** Feeds one frame time, measured only between frames drawn back to back (an idle stage's paced frames say nothing
 *  about the device). Returns the same object while the tier holds and nothing is counted, a new one otherwise. */
export function governorSample(g: Governor, frameMs: number, now: number): Governor {
  if (!(frameMs > 0) || frameMs > 250 || g.flips >= MAX_FLIPS || now - g.changedAt < SETTLE_MS) return g;
  const sum = g.sum + frameMs;
  const n = g.n + 1;
  if (n < GOVERNOR_WINDOW) return { ...g, sum, n };
  const fps = 1000 / (sum / n);
  if (fps < SLOW_FPS && g.tier > 0) return { tier: (g.tier - 1) as Tier, sum: 0, n: 0, fast: 0, flips: g.flips + 1, changedAt: now };
  const fast = fps >= FAST_FPS ? g.fast + 1 : 0;
  if (fast >= FAST_WINDOWS && g.tier < 2) return { tier: (g.tier + 1) as Tier, sum: 0, n: 0, fast: 0, flips: g.flips + 1, changedAt: now };
  return { ...g, sum: 0, n: 0, fast };
}
