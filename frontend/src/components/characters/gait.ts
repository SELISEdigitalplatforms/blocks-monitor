/**
 * How a person gets from A to B like a person: pure functions, no React, no three.js (unit-tested in
 * test/characters-motion.test.ts). The office and the cinematic step a `Mover` every frame and hand the result to
 * RealPerson (moving, speed, turning), which matches the walk clip's playback to the real ground speed.
 *
 *  - accelerates to a cruise pace and brakes to stop on the spot (no instant start, no overshoot);
 *  - turns towards where it is going at a limited rate, slowing down for sharp corners;
 *  - a large turn from standing is made on the spot first (turn-in-place, small steps), then the walk starts;
 *  - at the end it turns to face where it should (`face`).
 */

export const CRUISE = 1.25; // m/s, a relaxed office pace
export const ACCEL = 1.4; // m/s² speeding up
export const DECEL = 1.8; // m/s² slowing down
export const TURN_RATE_WALK = 3.2; // rad/s while walking
export const TURN_RATE_STAND = 2.6; // rad/s turning on the spot
/** a heading error above this, while (nearly) standing, is turned on the spot before walking off */
export const TURN_IN_PLACE = 0.9;
/** a standing turn larger than this is stepped (small steps on the spot); smaller ones just pivot, slowly */
export const TURN_STEP_MIN = 0.35;
export const TURN_RATE_PIVOT = 1.4;
/** speed at which a walk counts as stopped */
export const STOPPED = 0.04;
/** close enough to a waypoint to take the next one */
export const ARRIVE = 0.04;

export interface Vec2 { x: number; z: number }

export interface Mover {
  x: number;
  z: number;
  /** facing, radians: atan2(dx, dz) of the walking direction (0 faces +z) */
  heading: number;
  speed: number;
  /** waypoints still to walk (the first is the next one); empty when standing */
  path: Vec2[];
  /** turning on the spot this frame (rad/s, signed); 0 otherwise */
  turning: number;
  /** a stepped turn to `face` is under way (until it is done) */
  stepping: boolean;
}

export function mover(at: Vec2, heading = 0): Mover {
  return { x: at.x, z: at.z, heading, speed: 0, path: [], turning: 0, stepping: false };
}

/** shortest signed angle from a to b, in (-π, π] */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** turn `current` towards `target` by at most `rate * dt` */
export function turnTowards(current: number, target: number, rate: number, dt: number): number {
  const d = angleTo(current, target);
  const step = rate * Math.max(0, dt);
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

/** the fastest speed from which the person can still stop within `distance` */
export function brakingSpeed(distance: number, decel = DECEL): number {
  return Math.sqrt(2 * decel * Math.max(0, distance));
}

function remaining(m: Mover): number {
  let d = 0;
  let px = m.x, pz = m.z;
  for (const p of m.path) {
    d += Math.hypot(p.x - px, p.z - pz);
    px = p.x; pz = p.z;
  }
  return d;
}

export interface StepOptions {
  cruise?: number;
  /** heading to turn to once arrived (null: keep the walking direction) */
  face?: number | null;
  /** reduced motion: arrive at once */
  reduced?: boolean;
}

/**
 * One frame of walking along `m.path` (mutates and returns `m`; no allocation). Returns with `speed` > 0 while
 * walking and `turning` != 0 while turning on the spot.
 */
export function stepMover(m: Mover, dt: number, o: StepOptions = {}): Mover {
  const cruise = o.cruise ?? CRUISE;
  m.turning = 0;
  if (dt <= 0) return m;
  if (o.reduced) {
    const last = m.path[m.path.length - 1];
    if (last) { m.x = last.x; m.z = last.z; m.path.length = 0; }
    m.speed = 0;
    if (o.face !== undefined && o.face !== null) m.heading = o.face;
    return m;
  }
  // drop waypoints already reached
  while (m.path.length && Math.hypot(m.path[0].x - m.x, m.path[0].z - m.z) <= ARRIVE) {
    if (m.path.length === 1) { m.x = m.path[0].x; m.z = m.path[0].z; }
    m.path.shift();
  }
  if (!m.path.length) {
    // standing: slow to a stop, then face where asked: a large turn is stepped, a small one only pivots
    m.speed = Math.max(0, m.speed - DECEL * dt);
    if (o.face !== undefined && o.face !== null && m.speed <= STOPPED) {
      const err = Math.abs(angleTo(m.heading, o.face));
      if (err > TURN_STEP_MIN) m.stepping = true;
      else if (err < 1e-3) m.stepping = false;
      const before = m.heading;
      m.heading = turnTowards(m.heading, o.face, m.stepping ? TURN_RATE_STAND : TURN_RATE_PIVOT, dt);
      if (m.stepping) m.turning = angleTo(before, m.heading) / dt;
    } else m.stepping = false;
    return m;
  }
  m.stepping = false;
  const next = m.path[0];
  const want = Math.atan2(next.x - m.x, next.z - m.z);
  const err = angleTo(m.heading, want);
  // a big turn from (nearly) standing: on the spot first
  if (m.speed <= STOPPED * 2 && Math.abs(err) > TURN_IN_PLACE) {
    const before = m.heading;
    m.heading = turnTowards(m.heading, want, TURN_RATE_STAND, dt);
    m.turning = angleTo(before, m.heading) / dt;
    m.speed = 0;
    return m;
  }
  m.heading = turnTowards(m.heading, want, TURN_RATE_WALK, dt);
  // slow for corners (the heading still to turn, and the coming corner, anticipated) and to stop at the last waypoint
  const corner = Math.max(0.35, Math.cos(Math.min(Math.abs(angleTo(m.heading, want)), Math.PI / 2)));
  let target = Math.min(cruise * corner, brakingSpeed(remaining(m)));
  if (m.path.length > 1) {
    const after = m.path[1];
    const turn = Math.abs(angleTo(want, Math.atan2(after.x - next.x, after.z - next.z)));
    const atCorner = cruise * Math.max(0.35, Math.cos(turn / 2) ** 2);
    const toCorner = Math.hypot(next.x - m.x, next.z - m.z);
    target = Math.min(target, Math.sqrt(atCorner * atCorner + 2 * DECEL * toCorner));
  }
  m.speed = m.speed < target ? Math.min(target, m.speed + ACCEL * dt) : Math.max(target, m.speed - DECEL * dt);
  // move along the facing direction, never past the waypoint
  let step = m.speed * dt;
  const dist = Math.hypot(next.x - m.x, next.z - m.z);
  if (step >= dist) {
    m.x = next.x; m.z = next.z;
    step = 0;
    m.path.shift();
    if (!m.path.length && m.speed < 0.3) m.speed = 0;
  } else {
    // steer: mostly along the heading, pulled onto the line to the waypoint so corners never drift wide
    const hx = Math.sin(m.heading), hz = Math.cos(m.heading);
    const dx = (next.x - m.x) / dist, dz = (next.z - m.z) / dist;
    const k = 0.6;
    const vx = hx * (1 - k) + dx * k, vz = hz * (1 - k) + dz * k;
    const n = Math.hypot(vx, vz) || 1;
    m.x += (vx / n) * step;
    m.z += (vz / n) * step;
  }
  return m;
}

/* ── the walk clip ─────────────────────────────────────────────────────── */

/** Rocketbox m/f_walk_neutral_01 measured: its ground speed in model metres per second (the build stores the exact
 *  value in the clip file; this is the fallback). */
export const CLIP_WALK_SPEED = 1.25;
/** steps on the spot while turning: as if walking this fast */
export const TURN_STEP_SPEED = 0.7;

/**
 * Playback rate of the walk clip so the feet keep pace with the ground: the person's ground speed (parent units per
 * second) over the clip's own ground speed (model units per second) times the model's scale. Clamped so a stroll or a
 * hurry still looks like walking; turning on the spot steps slowly.
 */
export function walkRate(speed: number, clipSpeed: number, scale: number, turning = false): number {
  const own = Math.max(0.05, clipSpeed) * Math.max(1e-3, scale);
  const v = turning ? Math.max(speed, TURN_STEP_SPEED * scale) : speed;
  return Math.min(1.8, Math.max(0.45, v / own));
}

/** How far the feet slide (parent units per second) when the clip plays at `rate` while the body moves at `speed`. */
export function footSlide(speed: number, rate: number, clipSpeed: number, scale: number): number {
  return Math.abs(speed - rate * clipSpeed * scale);
}

/* ── the camera's walk (the visitor's own pace) ─────────────────────────── */

export interface WalkProfile {
  /** seconds for the whole walk */
  duration: number;
  /** metres walked after t seconds */
  at(t: number): number;
  /** speed (m/s) at t */
  speedAt(t: number): number;
}

/**
 * A human walk over `length` metres: speeds up to `cruise`, keeps it, slows down to stop (a trapezoid; a short walk
 * never reaches cruise and is a triangle). Speeding up is gentler than slowing down, as people do.
 */
export function walkProfile(length: number, cruise = 1.3, accel = 0.9, decel = 1.1): WalkProfile {
  const L = Math.max(0, length);
  const ta0 = cruise / accel, td0 = cruise / decel;
  const da0 = 0.5 * cruise * ta0, dd0 = 0.5 * cruise * td0;
  let peak = cruise, ta = ta0, td = td0, tc = 0;
  if (da0 + dd0 > L) {
    // triangle: v²/2a + v²/2d = L
    peak = Math.sqrt((2 * L) / (1 / accel + 1 / decel));
    ta = peak / accel;
    td = peak / decel;
  } else {
    tc = (L - da0 - dd0) / cruise;
  }
  const da = 0.5 * peak * ta;
  const duration = ta + tc + td;
  const speedAt = (t: number) => {
    if (t <= 0 || t >= duration) return 0;
    if (t < ta) return accel * t;
    if (t < ta + tc) return peak;
    return Math.max(0, peak - decel * (t - ta - tc));
  };
  const at = (t: number) => {
    if (t <= 0) return 0;
    if (t >= duration) return L;
    if (t < ta) return 0.5 * accel * t * t;
    if (t < ta + tc) return da + peak * (t - ta);
    const u = t - ta - tc;
    return Math.min(L, da + peak * tc + peak * u - 0.5 * decel * u * u);
  };
  return { duration, at, speedAt };
}

/** Step length of a walking adult (metres): the head bobs once per step. */
export const STEP_LENGTH = 0.72;

/** The visitor's head while walking: up-down once per step, a little sway once per stride, both scaled by pace. */
export function headBob(distance: number, speed: number, cruise = 1.3): { y: number; x: number } {
  const k = Math.min(1, Math.max(0, speed / cruise));
  if (k === 0) return { y: 0, x: 0 };
  const p = (distance / STEP_LENGTH) * Math.PI;
  return { y: 0.022 * k * (0.5 - 0.5 * Math.cos(2 * p)) - 0.011 * k, x: 0.01 * k * Math.sin(p) };
}
