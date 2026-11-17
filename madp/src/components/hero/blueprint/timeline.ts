/** The Blueprint choreography as pure numbers: one loop of ~15.7 s, evaluated every frame into a reused state object.
 *  Input (the scope draws itself) -> eight agent passes (01 Planner ... deploy) -> live -> a soft fade back to the grid. */
import { stationHead } from "../types";
import { clamp01, easeInOut, easeOut, smooth } from "./gfx";

export const INPUT = 3.0;
/** seconds per stage: 01 Planner, 02 Developer, 03 Reviewer, 04 Tester, 05 SecOps, 06 Docs, 07 Release gate, deploy */
export const DUR = [1.05, 1.05, 1.0, 1.0, 2.3, 1.1, 1.4, 1.5];
export const TS: number[] = [];
let acc = INPUT;
for (const d of DUR) { TS.push(acc); acc += d; }
export const T_LIVE = acc;
export const LIVE_HOLD = 1.75;
export const RESET = 0.65;
export const PERIOD = T_LIVE + LIVE_HOLD + RESET;

/** the laser travels across the structure (world x) */
export const SWEEP_X0 = -2.75;
export const SWEEP_X1 = 2.75;
/** the flagged node (INVOICE) sits here: the amber flag lights when the SecOps laser reaches it */
export const FLAG_X = 0.32;

export interface BState {
  c: number; index: number; head: number; stage: number;
  draw: number;
  sweepX: number; sweepA: number;
  glassFront: number; uiFront: number; reviewFront: number; testFront: number;
  secFlag: number; secLoop: number; secPass: number; shieldRise: number; shieldA: number;
  docs: number; compress: number; structA: number;
  module: number; moduleY: number; moduleScale: number; gateOpen: number; beam: number;
  ring: number; ringFlash: number; live: number; liveScan: number; pulse: number; livePill: number;
  agent: number; agentA: number; scopeTitle: number;
}

export const newState = (): BState => ({
  c: 0, index: 0, head: 0, stage: -1, draw: 0, sweepX: -99, sweepA: 0,
  glassFront: -1e3, uiFront: -1e3, reviewFront: -1e3, testFront: -1e3,
  secFlag: 0, secLoop: 0, secPass: 0, shieldRise: 0, shieldA: 0,
  docs: 0, compress: 0, structA: 1, module: 0, moduleY: 0, moduleScale: 1, gateOpen: 0, beam: 0,
  ring: 0, ringFlash: 0, live: 0, liveScan: 0, pulse: 0, livePill: 0, agent: -1, agentA: 0, scopeTitle: 0,
});

const sweepDur = (k: number) => (k === 4 ? 1.0 : k === 6 ? 0.72 : Math.min(0.86, DUR[k] * 0.82));
const sweepPos = (f: number) => {
  const t = clamp01(f);
  return SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * (0.45 * t + 0.55 * easeInOut(t));
};
/** the moment (s into the stage) the laser reaches world x */
function sweepTimeAt(k: number, x: number) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (sweepPos(m) < x) lo = m; else hi = m; }
  return ((lo + hi) / 2) * sweepDur(k);
}
export const FLAG_U = sweepTimeAt(4, FLAG_X);

const front = (stage: number, k: number, sx: number) => (stage < k ? -1e3 : stage === k ? sx : 1e3);

/** module rest point (centre of the structure) and the SELISE Blocks ring above it */
export const MODULE_P: [number, number, number] = [0, 0.95, 0.35];
export const RING_Y = 2.72;

export function evaluate(c: number, s: BState): BState {
  s.c = c;
  let stage = -1, u = c;
  if (c >= T_LIVE) { stage = 8; u = c - T_LIVE; }
  else if (c >= INPUT) { for (let k = 0; k < DUR.length; k++) if (c >= TS[k]) { stage = k; u = c - TS[k]; } }
  s.stage = stage;
  s.index = stage < 0 ? 0 : stage + 1;
  s.head = stage < 0 ? 0.11 * clamp01(c / INPUT) : stage < 8 ? stationHead(stage) : 1;
  s.draw = c;

  // the laser of the current agent
  s.sweepX = -99; s.sweepA = 0;
  if (stage >= 0 && stage <= 6) {
    const sw = sweepDur(stage);
    s.sweepX = sweepPos(u / sw);
    s.sweepA = smooth(0, 0.1, u) * (1 - smooth(sw - 0.1, sw + 0.06, u));
  }
  const sx = s.sweepX;
  s.glassFront = front(stage, 0, sx);
  s.uiFront = front(stage, 1, sx);
  s.reviewFront = front(stage, 2, sx);
  s.testFront = front(stage, 3, sx);

  // 05 SecOps: amber flag on INVOICE -> automatic loop back to 02 Developer -> green pass -> the shield rises
  const sec = stage === 4 ? u : stage > 4 ? 99 : -1;
  s.secFlag = sec < 0 ? 0 : smooth(FLAG_U, FLAG_U + 0.12, sec) * (1 - smooth(1.5, 1.62, sec));
  s.secLoop = sec < 0 ? 0 : smooth(1.0, 1.08, sec) * (1 - smooth(1.62, 1.8, sec));
  s.secPass = sec < 0 ? 0 : smooth(1.55, 1.68, sec);
  s.shieldRise = sec < 0 ? 0 : easeOut((sec - 1.62) / 0.62);
  s.shieldA = s.shieldRise > 0 ? 1 : 0;

  // 06 Docs: pages fan out
  s.docs = stage < 5 ? 0 : stage === 5 ? easeOut((u - 0.08) / 0.8) : 1;

  // 07 Release gate: gate opens, the structure compresses into one glowing module
  const rel = stage === 6 ? u : stage > 6 ? 99 : -1;
  s.gateOpen = rel < 0 ? 0 : smooth(0.5, 0.65, rel) * (1 - smooth(TS[7] - TS[6] + 0.9, TS[7] - TS[6] + 1.15, rel));
  s.compress = rel < 0 ? 0 : easeInOut((rel - 0.62) / 0.55);
  s.structA = rel < 0 ? 1 : 1 - smooth(0.8, 1.17, rel);
  const modIn = rel < 0 ? 0 : smooth(0.86, 1.15, rel);

  // deploy: the module beams up into the SELISE Blocks ring
  const dep = stage === 7 ? u : stage > 7 ? 99 : -1;
  const rise = dep < 0 ? 0 : easeInOut((dep - 0.18) / 0.8);
  s.moduleY = MODULE_P[1] + (RING_Y - MODULE_P[1]) * rise;
  const absorbed = dep < 0 ? 0 : smooth(0.95, 1.22, dep);
  s.module = modIn * (1 - absorbed);
  s.moduleScale = 1 - absorbed * 0.7;
  s.beam = dep < 0 ? 0 : smooth(0, 0.22, dep) * (1 - smooth(1.15, 1.5, dep));
  s.ringFlash = dep < 0 ? 0 : dep < 0.98 ? 0 : Math.exp(-(dep - 0.98) / 0.45);

  // live: the app hangs under the ring, the LIVE tag pulses
  const live = stage === 8 ? u : -1;
  s.live = live < 0 ? 0 : smooth(0, 0.35, live);
  s.liveScan = live < 0 ? 0 : clamp01(live / 0.6);
  s.pulse = live < 0 ? 0 : 0.5 + 0.5 * Math.cos(live * 6.0);

  // the ring arrives during the release, stays through live, fades with the reset
  const end = 1 - smooth(PERIOD - RESET, PERIOD - 0.04, c);
  s.ring = smooth(TS[6] + 0.85, TS[7] + 0.15, c) * end;
  s.live *= end;
  s.livePill = s.live;

  // HUD: which agent is working
  s.agent = stage >= 0 && stage <= 7 ? stage : -1;
  s.agentA = stage >= 0 && stage <= 7 ? smooth(0, 0.12, u) * (1 - smooth(DUR[stage] - 0.14, DUR[stage], u)) : 0;
  s.scopeTitle = stage < 0 ? 1 : 0;
  return s;
}

/** the reduced-motion still: the whole story in one frame (blueprint lit, checked, shielded, documented; the module
 *  beamed up into the ring and the LIVE tag on) */
export function composeStill(s: BState): BState {
  evaluate(TS[5] + DUR[5] - 0.05, s);
  s.index = 9; s.head = 1; s.stage = 8;
  s.sweepA = 0; s.agentA = 0; s.scopeTitle = 0; s.draw = 99;
  s.secFlag = 0; s.secLoop = 0; s.secPass = 1; s.shieldRise = 1; s.shieldA = 1; s.docs = 1;
  s.module = 1; s.moduleY = RING_Y - 0.62; s.moduleScale = 0.8; s.beam = 0.75;
  s.ring = 1; s.ringFlash = 0.25; s.live = 0; s.livePill = 1; s.pulse = 1; s.gateOpen = 0;
  return s;
}
