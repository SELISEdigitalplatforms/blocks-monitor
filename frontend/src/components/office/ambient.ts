/** Idle life in the office: agents that finished their stage drift to the coffee corner or the queue
 *  bench (planned agents wait at their own stations). Pure placement logic plus a slow clock; the
 *  characters do the walking. Ported from MADP Studio. */

import { useEffect, useState } from "react";
import type { OfficeView } from "./model";
import { ambientSpot, type Spot } from "./layout";
import { hashOf } from "./palette";

export const AMBIENT_HOLD_MS = 4000;
export const AMBIENT_SWAP_MS = 45000;

/** a Date.now() value in state, refreshed every `everyMs` while active */
export function useAmbientClock(active: boolean, everyMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

export function ambientSpots(view: OfficeView, now: number, reducedMotion: boolean): Map<string, Spot> {
  const out = new Map<string, Spot>();
  if (reducedMotion || (view.status !== "running" && view.status !== "waiting")) return out;
  // bench seats taken by queued devs (the dev at index i uses seat i % 4)
  const taken = new Set<number>();
  let d = 0;
  for (const a of view.agents) {
    if (a.role !== "dev") continue;
    if (a.status === "queued") taken.add(d % 4);
    d++;
  }
  const swap = Math.floor(now / AMBIENT_SWAP_MS);
  let coffee = 0;
  let extra = 4;
  for (const a of view.agents) {
    if (a.role === "autopilot") continue;
    if (a.status !== "pass" && a.status !== "done") continue;
    if (a.since && now - Date.parse(a.since) < AMBIENT_HOLD_MS) continue;
    if (((hashOf(a.id) >>> 3) + swap) % 2 === 0) {
      out.set(a.id, ambientSpot("coffee", coffee++));
    } else {
      let slot = -1;
      for (const s of [3, 2, 1, 0]) if (!taken.has(s)) { slot = s; break; }
      if (slot < 0) slot = extra++;
      else taken.add(slot);
      out.set(a.id, ambientSpot("bench", slot));
    }
  }
  return out;
}
