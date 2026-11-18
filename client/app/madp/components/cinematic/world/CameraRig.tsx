/** The visitor's eyes. Standing or seated at a place, the view rests there with a breath of motion. Between places it
 *  walks: along the walk's path through the doors at eye height and a calm pace, a moment after the guide sets off,
 *  looking ahead and turning towards the next place as it arrives (then sits down in the meeting room). Every change
 *  is damped, so nothing snaps; no path crosses a wall. At hand-off it steps towards the build board.
 *  The office visit's escort (visit/escort.ts): the eyes step aside while the assistant shows the way, then follow him
 *  at a person's pace (the speed eases with the gap, a light step in the gait), behind him and never closer than a
 *  person's distance, looking at him and the way ahead, and come to rest where the analyst is in view. */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from "three";
import { STAGES, WALKS, walkMs } from "../journey/places";
import { useJourney } from "../journey/store";
import { escort, officeView, tableView, useOfficeScene } from "../visit/scene";
import { cameraWay, followShare, type CameraWay } from "../visit/escort";
import { headBob } from "../../characters/gait";

const EYE = 1.62;
const LEAD_MS = 1500;
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const walk = useJourney((s) => s.walk);
  const resetN = useJourney((s) => s.resetN);
  const pos = useRef(new Vector3());
  const look = useRef(new Vector3());
  const tPos = useMemo(() => new Vector3(), []);
  const tLook = useMemo(() => new Vector3(), []);
  const tmp = useMemo(() => new Vector3(), []);
  const path = useRef<{ curve: CatmullRomCurve3; t0: number; ms: number } | null>(null);
  /** the escort: the visitor's way, how far along it they are (0..1) and how fast they walk (m/s) */
  const follow = useRef<{ way: CameraWay; share: number; speed: number; walked: number } | null>(null);
  const placed = useRef(false);
  const probeAt = useRef(0);

  // the first frame (and every restart): stand at the reception's establishing view, no glide
  useEffect(() => {
    const r = STAGES.reception.camera;
    pos.current.set(r.pos[0] + 0.5, r.pos[1] + 0.1, r.pos[2] + 2.6);
    look.current.set(...r.target);
    path.current = null;
    placed.current = false;
  }, [resetN]);

  // the office visit: straight to the place in use (a skipped walk, a visit resumed there)
  const snapN = useOfficeScene((s) => s.snapN);
  useEffect(() => {
    if (!snapN) return;
    path.current = null;
    follow.current = null;
    placed.current = false;
  }, [snapN]);

  useEffect(() => {
    if (!walk) { path.current = null; follow.current = null; return; }
    if (useOfficeScene.getState().office && walk.to === "meeting") {
      const to = tableView(camera.aspect, camera.fov).pos;
      follow.current = { way: cameraWay([pos.current.x, pos.current.z], [to[0], to[2]]), share: 0, speed: 0, walked: 0 };
      path.current = null;
      return;
    }
    const pts = WALKS[walk.to as keyof typeof WALKS].camera.map(([x, z]) => new Vector3(x, EYE, z));
    pts[0].set(pos.current.x, EYE, pos.current.z);
    const curve = new CatmullRomCurve3(pts, false, "centripetal", 0.5);
    path.current = { curve, t0: performance.now() + LEAD_MS, ms: walkMs(walk.to) - 1400 - LEAD_MS * 0.5 };
  }, [walk]);

  useFrame((st, dt) => {
    const j = useJourney.getState();
    const now = performance.now();
    const p = path.current;
    let lambda = 2.4;
    const fw = follow.current;
    if (fw) {
      // as far as the assistant lets us (behind him, a person's distance away), at a person's pace
      const dtc = Math.min(dt, 0.05);
      const target = followShare(fw.way, [escort.x, escort.z], fw.share, escort.done);
      const gap = (target - fw.share) * fw.way.length;
      const want = Math.min(1.45, Math.max(0, gap * 1.8));
      fw.speed += (want - fw.speed) * (1 - Math.exp(-3.5 * dtc));
      const step = Math.min(gap, fw.speed * dtc);
      fw.share += step / fw.way.length;
      fw.walked += step;
      const n = fw.way.points.length - 1;
      const at = (share: number, out: Vector3) => {
        const i = Math.min(n - 1, Math.max(0, Math.floor(share * n)));
        const k = Math.min(1, Math.max(0, share * n - i));
        const a = fw.way.points[i], b = fw.way.points[i + 1];
        return out.set(a[0] + (b[0] - a[0]) * k, EYE, a[1] + (b[1] - a[1]) * k);
      };
      at(fw.share, tPos);
      const bob = headBob(fw.walked, fw.speed);
      tPos.y += bob.y;
      // look at him and the way ahead; at the end, at the analyst
      at(Math.min(1, fw.share + 2.5 / fw.way.length), tmp);
      tLook.set(escort.x, 1.5, escort.z).lerp(tmp.setY(1.45), 0.4);
      const end = tableView(camera.aspect, camera.fov).target;
      const settle = Math.min(1, Math.max(0, (fw.share - 0.78) / 0.22));
      if (settle > 0) tLook.lerp(tmp.set(end[0], end[1], end[2]), ease(settle));
      lambda = 9;
    } else if (p) {
      const u = ease(Math.min(1, Math.max(0, (now - p.t0) / p.ms)));
      p.curve.getPointAt(u, tPos);
      p.curve.getPointAt(Math.min(1, u + 0.06), tLook);
      tLook.y = 1.5;
      // look ahead while walking; towards the place as it comes near
      const dest = (officeView(j.stage, camera.aspect, camera.fov) ?? STAGES[j.stage].camera).target;
      const turn = Math.max(0, (u - 0.6) / 0.4);
      tmp.set(...dest);
      if (u > 0.999) tLook.copy(tmp);
      else {
        // keep the look point a few metres ahead
        tLook.sub(tPos).normalize().multiplyScalar(3).add(tPos);
        tLook.lerp(tmp, ease(turn));
      }
      tPos.y = EYE + Math.sin(now / 1000 * 2 * Math.PI * 0.9) * 0.012 * (u > 0 && u < 1 ? 1 : 0);
      lambda = 6;
    } else {
      const c = j.phase === "handoff" && j.stage === "buildfloor"
        ? { pos: [32, 1.8, 2.2] as const, target: [32, 1.8, -8.3] as const }
        : officeView(j.stage, camera.aspect, camera.fov) ?? STAGES[j.stage].camera;
      tPos.set(c.pos[0], c.pos[1], c.pos[2]);
      tLook.set(c.target[0], c.target[1], c.target[2]);
      if (j.phase === "intro") { tPos.x += 0.5; tPos.y += 0.1; tPos.z += 2.6; lambda = 0.9; }
      if (j.phase === "handoff") lambda = 0.55;
      // never static: a slow dolly and parallax drift while standing
      const t = st.clock.elapsedTime;
      tPos.x += Math.sin(t * 0.19) * 0.07;
      tPos.z += Math.sin(t * 0.13 + 1) * 0.05;
      tPos.y += Math.sin(t * 0.29) * 0.012;
    }
    const k = 1 - Math.exp(-lambda * Math.min(dt, 0.05));
    if (!placed.current) { pos.current.copy(tPos); look.current.copy(tLook); placed.current = true; }
    pos.current.lerp(tPos, k);
    look.current.lerp(tLook, 1 - Math.exp(-(lambda * 0.9) * Math.min(dt, 0.05)));
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    // dev-only probe for the automated checks (written 4× a second, not every frame)
    if (import.meta.env.DEV && now - probeAt.current > 250) {
      probeAt.current = now;
      const info = st.gl.info.render;
      (window as unknown as { __cine?: unknown }).__cine = { p: [+pos.current.x.toFixed(2), +pos.current.y.toFixed(2), +pos.current.z.toFixed(2)], path: Boolean(p), stage: j.stage, walk: j.walk, askId: j.askId, card: j.card, phase: j.phase, calls: info.calls, tris: info.triangles, dpr: st.viewport.dpr };
    }
  });
  return null;
}
