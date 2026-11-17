/** What moves on the stage. The canvas draws on demand: anything that animates on screen (a walking agent, an easing
 *  camera) pushes `until` forward and the stage draws every display frame until then (see Office3D's Heartbeat);
 *  otherwise an idle floor draws at its lower ambient rate. One object per stage, mutated in place (no re-renders). */

import { createContext } from "react";

export interface StageActivity {
  /** performance.now() until which the stage draws every frame */
  until: number;
}

export const ActivityContext = createContext<StageActivity>({ until: 0 });

/** keep drawing every frame for at least `ms` more */
export function wake(a: StageActivity, ms = 300, now = performance.now()): void {
  const t = now + ms;
  if (t > a.until) a.until = t;
}
