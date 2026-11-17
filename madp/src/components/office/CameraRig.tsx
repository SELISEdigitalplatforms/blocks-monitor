/** Camera rig for the stage: eased zoom / reset / focus moves on top of drei's OrbitControls (which
 *  keeps its own damping), and a target clamp so panning can't lose the office. Ported from MADP Studio.
 *  Factory additions: the home view follows the stage size while the person has not moved the camera,
 *  and `follow` eases the camera to the view that frames every busy agent whenever it changes (home again
 *  when nobody is busy). */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import { Spherical, Vector3 } from "three";
import { sameHome, type Home } from "./fit";
import { closeView, easeInOutCubic, FOCUS_MS } from "./focus";

export interface RigApi { zoom(factor: number): void; reset(): void; focus(x: number, z: number): void; cancel(): void;
  /** glide close to an agent for a conversation */
  focusClose(x: number, z: number, sideFrac?: number): void;
  /** end the conversation view: glide back */
  release(): void;
  /** ease to a preset view (see views.ts) */
  view(h: Home): void;
  /** turn around the target (radians; left/right and up/down arrow keys) */
  orbit(dAzimuth: number, dPolar: number): void;
}

const MIN_D = 9;
const MAX_D = 42;
const BOUND_MIN = new Vector3(-13, 0, -9);
const BOUND_MAX = new Vector3(15, 3, 9);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** the orbit controls' polar limits (Office3D) */
const MIN_POLAR = 0.35;
const MAX_POLAR = Math.PI / 2.25;

type Orbit = { target: Vector3; update: () => boolean; minDistance: number } | null;

interface Tween { fp: Vector3; ft: Vector3; tp: Vector3; tt: Vector3; t: number; restoreMin: boolean }

export function CameraRig({ apiRef, home, reducedMotion, follow, focusDistance = 14, closeDistance = 9 }: {
  apiRef: MutableRefObject<RigApi | null>; home: Home; reducedMotion: boolean;
  /** the view that frames the busy agents (undefined: following is off; null: on, nobody busy) */
  follow?: Home | null;
  /** how close a focus move on a picked agent comes (the Studio's 14; further on short stages) */
  focusDistance?: number;
  /** how close a conversation focus comes */
  closeDistance?: number;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as unknown as Orbit;
  const goal = useRef<{ pos: Vector3; target: Vector3 } | null>(null);
  /** the person (or a focus) moved the camera: a resize no longer re-homes it */
  const touched = useRef(false);
  const homed = useRef<Home>(home);
  /** conversation focus: the timed glide, the view to return to, and the minDistance to restore */
  const tween = useRef<Tween>({ fp: new Vector3(), ft: new Vector3(), tp: new Vector3(), tt: new Vector3(), t: 0, restoreMin: false });
  const tweening = useRef(false);
  const focused = useRef(false);
  const saved = useRef({ pos: new Vector3(), target: new Vector3(), minD: MIN_D });
  const followRef = useRef(follow);
  followRef.current = follow;

  const go = (pos: Vector3, target: Vector3) => {
    if (!controls) return;
    if (reducedMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      goal.current = null;
    } else goal.current = { pos, target };
    invalidate();
  };
  const focusOn = (x: number, z: number) => {
    if (!controls) return;
    const t = new Vector3(x, 0.8, z).clamp(BOUND_MIN, BOUND_MAX);
    const off = camera.position.clone().sub(controls.target);
    const d = clamp(Math.min(off.length(), focusDistance), MIN_D, MAX_D);
    go(t.clone().add(off.setLength(d)), t);
  };
  const glide = (pos: Vector3, target: Vector3, restoreMin: boolean) => {
    if (!controls) return;
    goal.current = null;
    if (reducedMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      tweening.current = false;
      if (restoreMin) controls.minDistance = saved.current.minD;
      return;
    }
    const w = tween.current;
    w.fp.copy(camera.position); w.ft.copy(controls.target);
    w.tp.copy(pos); w.tt.copy(target);
    w.t = 0; w.restoreMin = restoreMin;
    tweening.current = true;
    invalidate();
  };
  const goHome = () => go(new Vector3(...home.position), new Vector3(...home.target));

  useEffect(() => {
    if (!controls) return;
    apiRef.current = {
      zoom(f) {
        touched.current = true;
        const off = camera.position.clone().sub(controls.target);
        const d = clamp(off.length() * f, MIN_D, MAX_D);
        go(controls.target.clone().add(off.setLength(d)), controls.target.clone());
      },
      reset() { touched.current = false; goHome(); },
      focus(x, z) { touched.current = true; focusOn(x, z); },
      cancel() { touched.current = true; goal.current = null; if (tweening.current && tween.current.restoreMin) controls.minDistance = saved.current.minD;
        tweening.current = false;
      },
      focusClose(x, z, sideFrac = 0) {
        if (!focused.current) {
          saved.current.pos.copy(camera.position);
          saved.current.target.copy(controls.target);
          saved.current.minD = controls.minDistance;
          focused.current = true;
        }
        const persp = camera as unknown as { fov?: number; aspect?: number };
        const v = closeView({
          at: { x, z },
          from: { position: [camera.position.x, camera.position.y, camera.position.z], target: [controls.target.x, controls.target.y, controls.target.z] },
          distance: closeDistance, sideFrac, fov: persp.fov, aspect: persp.aspect,
        });
        controls.minDistance = Math.min(saved.current.minD, closeDistance - 0.5);
        touched.current = true;
        glide(new Vector3(...v.position), new Vector3(...v.target).clamp(BOUND_MIN, BOUND_MAX), false);
      },
      view(h) {
        touched.current = true;
        go(new Vector3(...h.position), new Vector3(...h.target).clamp(BOUND_MIN, BOUND_MAX));
      },
      orbit(dAz, dPolar) {
        touched.current = true;
        const base = goal.current ?? { pos: camera.position, target: controls.target };
        const off = base.pos.clone().sub(base.target);
        const sph = new Spherical().setFromVector3(off);
        sph.theta += dAz;
        sph.phi = clamp(sph.phi + dPolar, MIN_POLAR, MAX_POLAR);
        go(base.target.clone().add(new Vector3().setFromSpherical(sph)), base.target.clone());
      },
      release() {
        if (!focused.current) return;
        focused.current = false;
        const f = followRef.current;
        if (f) glide(new Vector3(...f.position), new Vector3(...f.target).clamp(BOUND_MIN, BOUND_MAX), true);
        else glide(saved.current.pos.clone(), saved.current.target.clone(), true);
      },
    };
    return () => { apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef, camera, controls, home, reducedMotion, focusDistance, closeDistance]);

  // the stage was resized: move to the new home unless the person has moved the camera
  useEffect(() => {
    if (!controls) return;
    const prev = homed.current;
    homed.current = home;
    if (touched.current || sameHome(prev, home)) return;
    goHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, home]);

  // follow the active station
  const followKey = follow === undefined ? "off" : follow === null ? "none" : [...follow.position, ...follow.target].map((n) => n.toFixed(2)).join(",");
  const followed = useRef(false);
  useEffect(() => {
    if (!controls || follow === undefined || focused.current) return;
    if (follow) {
      followed.current = true;
      touched.current = true;
      go(new Vector3(...follow.position), new Vector3(...follow.target).clamp(BOUND_MIN, BOUND_MAX));
    } else if (followed.current) {
      followed.current = false;
      touched.current = false;
      goHome();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, followKey]);

  useFrame((_, dt) => {
    if (!controls) return;
    const w = tween.current;
    if (tweening.current) {
      w.t += Math.min(dt, 0.1) * 1000;
      const k = easeInOutCubic(Math.min(1, w.t / FOCUS_MS));
      camera.position.lerpVectors(w.fp, w.tp, k);
      controls.target.lerpVectors(w.ft, w.tt, k);
      if (w.t >= FOCUS_MS) {
        tweening.current = false;
        if (w.restoreMin) controls.minDistance = saved.current.minD;
      }
    }
    const g = goal.current;
    if (g && !tweening.current) {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 6);
      camera.position.lerp(g.pos, k);
      controls.target.lerp(g.target, k);
      if (camera.position.distanceTo(g.pos) < 0.02 && controls.target.distanceTo(g.target) < 0.02) {
        camera.position.copy(g.pos);
        controls.target.copy(g.target);
        goal.current = null;
      }
    }
    controls.target.clamp(BOUND_MIN, BOUND_MAX);
  });

  return null;
}
