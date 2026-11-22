import { clipsFor, type PersonFamily, type PersonModel } from "./manifest";
import type { AgentStatus } from "../model";

export type ClipKey = "idle" | "idleAlt" | "walk" | "work" | "sit" | "greet";

export interface ClipState {
  status: AgentStatus;
  moving: boolean;
  /** the station has a seat (the spot's pose is "sit") */
  seated: boolean;
  /** a one-shot greet is playing */
  greeting: boolean;
}

/** Which clip to play. idleAlt is never returned here; the component alternates it. */
export function clipKeyFor(s: ClipState, family: PersonFamily): ClipKey {
  if (s.moving) return "walk";
  if (s.greeting) return "greet";
  if (s.status === "working") return family === "B" && s.seated ? "sit" : "work";
  return "idle";
}

/** The glTF clip name for a key. */
export function clipName(model: PersonModel, key: ClipKey): string {
  const c = clipsFor(model);
  switch (key) {
    case "idleAlt":
      return model.family === "A" ? "Idle_Neutral" : c.idle;
    case "sit":
      return c.sit ?? c.work;
    case "work":
      return c.work;
    case "walk":
      return c.walk;
    case "greet":
      return c.greet;
    default:
      return c.idle;
  }
}

export const CROSSFADE_S = 0.25;
export const IDLE_SWAP_S = [8, 14] as const;

/** Seconds until the next Idle / Idle_Neutral swap; r in 0..1. */
export function nextIdleSwap(r: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(r) ? r : 0));
  return IDLE_SWAP_S[0] + t * (IDLE_SWAP_S[1] - IDLE_SWAP_S[0]);
}

/** Ground covered per walk-clip second, in body heights per family. Tunable. */
const STRIDE: Record<PersonFamily, number> = { A: 0.78, B: 0.72 };

/** Walk clip playback rate so the feet don't slide. */
export function walkTimeScale(speed: number, height: number, family: PersonFamily): number {
  const v = speed / (STRIDE[family] * height);
  return Math.min(2.2, Math.max(0.6, Number.isFinite(v) ? v : 1));
}

/** Greet once on a change into pass/done; never on first mount. */
export function greetsOn(prev: AgentStatus | null, next: AgentStatus): boolean {
  if (prev === null) return false;
  if (next !== "pass" && next !== "done") return false;
  return prev !== "pass" && prev !== "done";
}
