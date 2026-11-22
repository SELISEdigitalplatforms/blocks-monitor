/** The escort from reception to the meeting table, pure (no React, no three.js; unit-tested), as people do it: the MADP
 *  Assistant shows the way ("this way") while the visitor steps aside onto the walkway; he walks past on the inner lane
 *  and the visitor follows on the outer lane, behind him and never closer than a person's distance; at the meeting
 *  room he goes through the glass door first (the inner lane is the side he turns to, so the two ways never cross);
 *  he stops beside the analyst, and the visitor slows to a stop where the analyst is in view.
 *  The visitor's walk is driven by where the assistant really is (his gait: speeding up, corners, braking), so the camera
 *  never runs into him or away from him. Floor plan: journey/places.ts (the door spans x 7.55-9.05 at z 0.5). */
import type { XZ } from "../journey/places";

/** the assistant's way: from his spot at reception, round the visitor's left, along the inner lane of the walkway,
 *  through the door, to his place beside the analyst at the table */
export const ESCORT_ASSISTANT: readonly XZ[] = [
  [-0.25, -1.05], [0.55, 1.25], [3.6, 1.35], [6.3, 1.35], [7.7, 0.95], [7.95, 0.0], [8.6, -1.4], [9.3, -2.6],
];

/** the visitor's way between their view at reception and their view at the table (both from the layout's framing): a
 *  step aside onto the walkway, its outer lane, the door, the table */
export const ESCORT_CAMERA_VIA: readonly XZ[] = [[2.2, 2.45], [3.6, 2.6], [5.0, 2.65], [7.2, 2.7], [8.55, 2.25], [8.65, 0.6], [9.35, -0.2]];

export function escortCameraPath(from: XZ, to: XZ): XZ[] {
  return [from, ...ESCORT_CAMERA_VIA, to];
}

/** never closer to the assistant than this (m) */
export const FOLLOW = 1.2;
/** along the corridor, at least this far behind him (m) */
export const BEHIND = 1.0;
/** "this way": the gesture before his first step (ms); the visitor steps aside meanwhile */
export const GESTURE_MS = 1300;
/** at the table he faces the analyst while he introduces them (ms), then turns back to the visitor */
export const INTRO_MS = 2800;

export function pathLength(p: readonly XZ[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}

/** the point `u` (0..1) of the way along a polyline, by distance */
export function pointAt(p: readonly XZ[], u: number): XZ {
  const total = pathLength(p);
  let want = Math.min(1, Math.max(0, u)) * total;
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (want <= seg || i === p.length - 1) {
      const k = seg > 0 ? Math.min(1, want / seg) : 1;
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k];
    }
    want -= seg;
  }
  return p[p.length - 1];
}

/** how far along the corridor a point is: along the walkway (x), then, past the meeting room's door, on into the room
 *  (towards its back wall) */
export function corridor([x, z]: XZ): number {
  return x > 7.3 && z < 0.9 ? x + (0.9 - z) : x;
}

/** The visitor's way, sampled once: `n + 1` points and the share where the step aside ends. */
export interface CameraWay { points: XZ[]; length: number; aside: number }

export function cameraWay(from: XZ, to: XZ, n = 400): CameraWay {
  const path = escortCameraPath(from, to);
  const length = pathLength(path);
  const points = Array.from({ length: n + 1 }, (_, i) => pointAt(path, i / n));
  const aside = Math.hypot(ESCORT_CAMERA_VIA[0][0] - from[0], ESCORT_CAMERA_VIA[0][1] - from[1]) / Math.max(1e-6, length);
  return { points, length, aside };
}

/** How far along their way (0..1) the visitor may be now, given where the assistant is and where they are (`prev`): as
 *  far as possible while behind him along the corridor and a person's distance away, never back (the step aside is
 *  always allowed). `done`: he has arrived, so the visitor may walk up to their place at the table. */
export function followShare(way: CameraWay, at: XZ, prev: number, done = false): number {
  const n = way.points.length - 1;
  let i = Math.max(0, Math.min(n, Math.floor(prev * n)));
  const ok = (p: XZ, share: number) =>
    (share <= way.aside || done || corridor(p) <= corridor(at) - BEHIND) && Math.hypot(p[0] - at[0], p[1] - at[1]) >= FOLLOW;
  let best = prev;
  for (; i <= n; i++) {
    const share = i / n;
    if (share < prev) continue;
    if (!ok(way.points[i], share)) break;
    best = share;
  }
  return best;
}

/** how far along his way someone is (0..1) at (x, z) with `left` the waypoints still ahead (the gait's path) */
export function progressOf(x: number, z: number, left: readonly { x: number; z: number }[], total: number): number {
  if (!left.length || total <= 0) return left.length ? 0 : 1;
  let rest = Math.hypot(left[0].x - x, left[0].z - z);
  for (let i = 1; i < left.length; i++) rest += Math.hypot(left[i].x - left[i - 1].x, left[i].z - left[i - 1].z);
  return Math.min(1, Math.max(0, 1 - rest / total));
}
