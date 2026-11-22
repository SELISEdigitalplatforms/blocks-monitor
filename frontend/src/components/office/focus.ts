/** Close conversation view: the camera glides in on one agent and slides the agent off-centre so a
 *  chat bubble fits beside it. Pure maths, no React. */

import type { Home } from "./fit";
import type { Vec2 } from "./layout";

export const FOCUS_MS = 800;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface CloseViewInput {
  at: Vec2; from: Home; distance: number;
  /** angle from vertical, radians (default 1.08: a little lower than the default views) */
  polar?: number;
  /** height of the look-at point (default 1.55: the head) */
  lift?: number;
  /** shift to the camera's right, as a fraction of the visible width at the target */
  sideFrac?: number;
  /** vertical fov in degrees (default 40) */
  fov?: number;
  aspect?: number;
}

export function closeView(i: CloseViewInput): Home {
  const { at, from, distance } = i;
  const polar = i.polar ?? 1.08;
  const lift = i.lift ?? 1.55;
  const side = i.sideFrac ?? 0;
  const az = Math.atan2(from.position[0] - from.target[0], from.position[2] - from.target[2]);
  const sp = Math.sin(polar);
  const ox = distance * sp * Math.sin(az), oy = distance * Math.cos(polar), oz = distance * sp * Math.cos(az);
  let tx = at.x, tz = at.z;
  if (side > 0) {
    const fov = ((i.fov ?? 40) * Math.PI) / 180;
    const shift = side * 2 * distance * Math.tan(fov / 2) * (i.aspect ?? 16 / 9);
    // right = forward x up, forward = -offset; horizontal and unit length
    const len = Math.hypot(oz, ox) || 1;
    tx += (oz / len) * shift;
    tz += (-ox / len) * shift;
  }
  return { position: [tx + ox, lift + oy, tz + oz], target: [tx, lift, tz] };
}

/** how far the close view sits: further on short stages so the agent still fits */
export const closeDistanceFor = (stageH: number) => Math.min(12, Math.max(7.5, (9 * 560) / Math.max(stageH, 1)));
