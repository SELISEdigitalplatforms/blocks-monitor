/** Camera framing for the office stage. The Studio's banner camera (STUDIO_HOME) is kept as is; the
 *  Factory's stages come in other sizes (small cards, a build canvas next to other panels), so the home
 *  view keeps the Studio's viewing direction and only moves the camera back far enough that the whole
 *  room stays in frame (and clear of a docked panel on the right); small cards show the complete room,
 *  slab and walls included, centred (roomHome). Pure maths, no React. */

import { PerspectiveCamera, Vector3 } from "three";

export type Vec3 = readonly [number, number, number];
export interface Home { position: Vec3; target: Vec3 }

/** MADP Studio's banner camera (Office3D BANNER_HOME), fov 40 */
export const STUDIO_HOME: Home = { position: [16.5, 12.5, 18.5], target: [4.2, 0.5, -0.5] };
export const STAGE_FOV = 40;
/** the same view with the room centred (no panel docked on the right) */
export const CENTRED_TARGET: Vec3 = [1.9, 0.5, 0.2];

const DIR = new Vector3(...STUDIO_HOME.position).sub(new Vector3(...STUDIO_HOME.target));
export const STUDIO_DISTANCE = DIR.length();
DIR.normalize();

/** what must stay in frame: every station, its sign, the plants and the entrance. The Studio's own view
 *  crops the floor slab's front corner, so the slab itself is not part of the fit. */
const CORNERS: Vector3[] = ([
  [-8, 2.65, -7.45], [-11, 1.4, -7], [-10.4, 2.3, -1.6], [-10.3, 2.25, 4.2], [-11, 1.4, 7.2], [-7.1, 0, 7.6],
  [0, 0, 7.7], [8.6, 0, 6.9], [7.6, 4.3, 6.4], [10.2, 0, 3.7], [11, 1.4, 7], [11.7, 2.65, 0.2], [9.6, 3.7, -3.85], [10.2, 1.9, -7],
  [6.6, 2.25, -7.4], [1.5, 1.7, -7.45],
] as const).map(([x, y, z]) => new Vector3(x, y, z));

const cam = new PerspectiveCamera(STAGE_FOV, 1, 0.5, 400);
const tgt = new Vector3();
const aim = new Vector3();
const v = new Vector3();

function fits(d: number, xMin: number, xMax: number, yMin: number, yMax: number): boolean {
  cam.position.copy(tgt).addScaledVector(DIR, d);
  cam.lookAt(tgt);
  cam.updateMatrixWorld(true);
  for (const c of CORNERS) {
    v.copy(c).project(cam);
    if (v.x < xMin || v.x > xMax || v.y < yMin || v.y > yMax) return false;
  }
  return true;
}

/**
 * The home view for a stage of `width` x `height` pixels.
 * @param right  pixels covered by a panel docked on the right edge (kept clear of the room)
 * @param minD   never closer than this (the Studio's own distance keeps the Studio look on big stages)
 */
export function homeFor({ width, height, target, right = 0, minD, maxD, margin = 0.05 }: {
  width: number; height: number; target: Vec3; right?: number; minD: number; maxD: number; margin?: number;
}): Home {
  const w = Math.max(1, width), h = Math.max(1, height);
  cam.aspect = w / h;
  cam.fov = STAGE_FOV;
  cam.updateProjectionMatrix();
  tgt.set(...target);
  const xMin = -1 + margin, yMin = -1 + margin, yMax = 1 - margin;
  const xMax = Math.max(xMin + 0.4, 1 - (2 * right) / w - margin);
  let d = minD;
  if (!fits(minD, xMin, xMax, yMin, yMax)) {
    let lo = minD, hi = maxD;
    if (!fits(hi, xMin, xMax, yMin, yMax)) d = hi;
    else {
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid, xMin, xMax, yMin, yMax)) hi = mid;
        else lo = mid;
      }
      d = hi;
    }
  }
  const p = tgt.clone().addScaledVector(DIR, d);
  return { position: [p.x, p.y, p.z], target: [target[0], target[1], target[2]] };
}

/** The whole room as built in Furniture.tsx (Room, ShipGate): the floor slab with its edge, the tops of the walls,
 *  the vestibule and the release gate's beam. */
const ROOM: Vector3[] = ([
  [-12.2, -0.3, 8.2], [12.2, -0.3, 8.2], [12.2, -0.3, -8.2], [-12.2, -0.3, -8.2],
  [-12.3, 2.6, -8.3], [12.2, 2.6, -8.3], [-12.3, 2.6, 8.2], [12.2, 1.8, 8.2], [12.2, 1.8, -8.2],
  [15.5, -0.24, 2.1], [15.5, -0.24, -1.7], [7.35, 2.45, 6.6], [9.85, 2.45, 6.6],
] as const).map(([x, y, z]) => new Vector3(x, y, z));

/** the camera's right and up axes for the Studio's viewing direction (as Object3D.lookAt builds them) */
const RIGHT = new Vector3(0, 1, 0).cross(DIR).normalize();
const UP = DIR.clone().cross(RIGHT);
/** each room corner in camera axes, relative to CENTRED_TARGET: across, up, and its depth before the camera moves back */
const ROOM_CAM = ROOM.map((c) => {
  const rel = c.clone().sub(new Vector3(...CENTRED_TARGET));
  return { x: rel.dot(RIGHT), y: rel.dot(UP), z: -rel.dot(DIR) };
});

/** The pan (along one camera axis) that puts the corners' screen extent in the middle of [lo, hi], for the corners
 *  at depth `z + d`; `k` turns a depth into the half-height (or half-width) of the view there. Pans between `a0` and
 *  `a1` keep every corner inside, and the extent shrinks as the pan grows, so the middle is found by bisection. */
function centredPan(axis: "x" | "y", d: number, k: number, lo: number, hi: number, a0: number, a1: number): number {
  const slack = (a: number) => {
    let max = -Infinity, min = Infinity;
    for (const c of ROOM_CAM) {
      const n = (c[axis] - a) / ((c.z + d) * k);
      if (n > max) max = n;
      if (n < min) min = n;
    }
    return (max - hi) + (min - lo);
  };
  let l = a0, h = a1;
  for (let i = 0; i < 40; i++) {
    const m = (l + h) / 2;
    if (slack(m) > 0) l = m;
    else h = m;
  }
  return (l + h) / 2;
}

/**
 * The home view that shows the whole room, as large as the stage allows and centred in it, from the Studio's viewing
 * direction: small cards show the office as one complete piece. The camera backs off until a pan along its own axes
 * fits every corner, then pans to the middle.
 * @param top  pixels at the top that the host's header covers (the room stays below them)
 */
export function roomHome({ width, height, top = 0, margin = 0.06, maxD = 140 }: {
  width: number; height: number; top?: number; margin?: number; maxD?: number;
}): Home {
  const w = Math.max(1, width), h = Math.max(1, height);
  const ky = Math.tan((STAGE_FOV * Math.PI) / 360), kx = ky * (w / h);
  const xLo = -1 + margin, xHi = 1 - margin;
  const yLo = -1 + margin, yHi = Math.max(yLo + 0.2, 1 - margin - (2 * top) / h);
  // the pans that keep every corner inside: for each axis the range [lo, hi], empty while the camera is too close
  const range = (axis: "x" | "y", d: number, k: number, lo: number, hi: number) => {
    let a0 = -Infinity, a1 = Infinity;
    for (const c of ROOM_CAM) {
      const z = (c.z + d) * k;
      a0 = Math.max(a0, c[axis] - hi * z);
      a1 = Math.min(a1, c[axis] - lo * z);
    }
    return [a0, a1] as const;
  };
  const fits = (d: number) => {
    const [x0, x1] = range("x", d, kx, xLo, xHi), [y0, y1] = range("y", d, ky, yLo, yHi);
    return x0 <= x1 && y0 <= y1;
  };
  // never inside the room: every corner at least a metre in front of the camera
  let lo = Math.max(...ROOM_CAM.map((c) => 1 - c.z)), hi = maxD;
  if (fits(lo)) hi = lo;
  else if (fits(hi)) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
  }
  const d = hi;
  const [x0, x1] = range("x", d, kx, xLo, xHi), [y0, y1] = range("y", d, ky, yLo, yHi);
  const a = x0 <= x1 ? centredPan("x", d, kx, xLo, xHi, x0, x1) : 0;
  const b = y0 <= y1 ? centredPan("y", d, ky, yLo, yHi, y0, y1) : 0;
  const t = new Vector3(...CENTRED_TARGET).addScaledVector(RIGHT, a).addScaledVector(UP, b);
  const p = t.clone().addScaledVector(DIR, d);
  return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
}

/** A floor spot the framing keeps in view, with its agent's name chip and bubble above it. */
export interface FrameSpot { x: number; z: number }

/** where an agent's labels hang (Character's name chip, with the bubble above it), in metres above the floor */
export const LABEL_ANCHOR_Y = 2.05;

/**
 * The view that keeps every given agent in frame, from the Studio's viewing direction: aimed at their centroid, as
 * close as `minD` allows, and backed off until each agent, its name chip and its bubble (drawn at a fixed screen size,
 * `labelUp` pixels above the head and `labelHalf` pixels to each side) fit inside the stage, clear of `top` pixels of
 * controls, `bottom` pixels of caption and `right` pixels of a panel docked on the right (aimed at the middle of the
 * part left of it).
 */
export function frameSpots({ width, height, spots, minD, maxD, margin = 0.08, labelUp = 84, labelHalf = 110, top = 0, bottom = 0, right = 0 }: {
  width: number; height: number; spots: readonly FrameSpot[]; minD: number; maxD: number; margin?: number;
  labelUp?: number; labelHalf?: number; top?: number; bottom?: number; right?: number;
}): Home {
  const w = Math.max(1, width), h = Math.max(1, height);
  cam.aspect = w / h;
  cam.fov = STAGE_FOV;
  cam.updateProjectionMatrix();
  const cx = spots.reduce((n, s) => n + s.x, 0) / Math.max(1, spots.length);
  const cz = spots.reduce((n, s) => n + s.z, 0) / Math.max(1, spots.length);
  tgt.set(cx, 0.8, cz);
  const xMin = -1 + margin, xMax = Math.max(xMin + 0.4, 1 - margin - (2 * right) / w);
  const yMin = -1 + margin + (2 * bottom) / h, yMax = 1 - margin - (2 * top) / h;
  const up = (2 * labelUp) / h, side = (2 * labelHalf) / w;
  // a docked panel: the camera pans right by half the panel, so the spots sit in the middle of the part left of it
  const aimAt = (d: number) => aim.copy(tgt).addScaledVector(RIGHT, (right / w) * d * Math.tan((STAGE_FOV * Math.PI) / 360) * (w / h));
  const ok = (d: number) => {
    aimAt(d);
    cam.position.copy(aim).addScaledVector(DIR, d);
    cam.lookAt(aim);
    cam.updateMatrixWorld(true);
    for (const s of spots) {
      v.set(s.x, 0, s.z).project(cam);
      if (v.x < xMin || v.x > xMax || v.y < yMin) return false;
      v.set(s.x, LABEL_ANCHOR_Y, s.z).project(cam);
      if (v.y + up > yMax || v.x - side < xMin || v.x + side > xMax) return false;
    }
    return true;
  };
  let d = minD;
  if (!ok(minD)) {
    let lo = minD, hi = maxD;
    if (!ok(hi)) d = hi;
    else {
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) hi = mid;
        else lo = mid;
      }
      d = hi;
    }
  }
  aimAt(d);
  const p = aim.clone().addScaledVector(DIR, d);
  return { position: [p.x, p.y, p.z], target: [aim.x, aim.y, aim.z] };
}

export const sameHome = (a: Home, b: Home) =>
  a.position.every((n, i) => Math.abs(n - b.position[i]) < 1e-3) && a.target.every((n, i) => Math.abs(n - b.target[i]) < 1e-3);
