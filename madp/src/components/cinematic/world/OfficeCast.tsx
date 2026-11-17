/** The two people of the visit, played by the same realistic people as the Studio's software house
 *  (characters/RealPerson: the Rocketbox cast, its clips, gait, idle/talk/listen/nod/wave, hands and face): the MADP
 *  Assistant at reception and the business analyst at the meeting table. A guide walks a list of waypoints with the
 *  shared gait (speeds up, turns on the spot for big turns, slows at corners, brakes, faces where they should), the walk
 *  clip in step with the ground speed; standing, they breathe, blink, look at the visitor, gesture while they talk and
 *  listen with a nod now and then while the visitor types; thinking, their gaze drifts up and aside.
 *  The office visit's escort (visit/escort.ts): the assistant shows the way, walks ahead on the inner lane, stops beside
 *  the analyst and faces them while he introduces them, then turns back to the visitor; the analyst works facing the
 *  wall screen until the visitor arrives, then turns to greet them. Each head is projected to the screen every frame
 *  (visit/scene.ts `heads`), so the speech bubble follows it without re-rendering anything.
 *  Lightweight: two close-up files and one clip file, each downloaded and parsed once (characters/loader.ts cache),
 *  loaded after the room's first frame; when a person is ready their shaders are compiled and their textures uploaded
 *  at once, so nothing compiles or uploads in the middle of a walk. */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshStandardMaterial, SRGBColorSpace, Vector3, type Group, type Mesh, type Texture, type WebGLRenderer } from "three";
import { RealPerson } from "../../characters/RealPerson";
import { mover, stepMover, STOPPED, type Mover } from "../../characters/gait";
import type { Activity } from "../../characters/controller";
import { PM_JOIN, STAGES, WALKS, type StageId, type Vec3, type XZ } from "../journey/places";
import { useJourney } from "../journey/store";
import { useChat } from "../visit/chat";
import { escort, heads, useOfficeScene } from "../visit/scene";
import { ESCORT_ASSISTANT, GESTURE_MS, INTRO_MS } from "../visit/escort";
import { GUIDE_CAST } from "../visit/cast";
import { useReducedMotion } from "@/components/landing/motion";

type Role = "assistant" | "pm";

const SEED: Record<Role, number> = { assistant: 1.37, pm: 4.81 };
/** a calm office pace (m/s) */
const CRUISE = 1.15;
/** where the business analyst waits, out of sight, before walking in (the scripted film only) */
const PM_WAIT: Vec3 = [-9.5, 0, 6.5];
/** the analyst at work at the table, facing the wall screen (until the visitor arrives) */
const AT_WORK = Math.PI;
/** the mouth's height on a 1.8 m person (where the bubble points), the head's top and chin, and half its width with
 *  ears, hair and the idle sway: the box the speech bubble keeps clear of */
const MOUTH_Y = 1.64;
const HEAD_TOP = 1.9;
const HEAD_BOTTOM = 1.46;
const HEAD_HALF = 0.17;
/** facing the analyst from the assistant's place at the table */
const TOWARDS_ANALYST = Math.atan2(STAGES.meeting.pm.at[0] - STAGES.meeting.assistant.at[0], STAGES.meeting.pm.at[2] - STAGES.meeting.assistant.at[2]);

interface Route { pts: XZ[]; delay: number; n: number }

const warmed = new WeakSet<object>();
const dressed = new WeakSet<object>();

/** A real face instead of a flat, pale one, at no cost per frame: the colour maps read as sRGB, every map filtered at a
 *  steep angle (anisotropy), and the skin of the face less mirror-like with a hint of warmth from below the surface (a
 *  faint emissive taken from the skin's own colour), so it does not wash out under the room's light. Once per material
 *  (the clones share them). */
function dressSkin(gl: WebGLRenderer, root: import("three").Object3D) {
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
  root.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (!(mat instanceof MeshStandardMaterial) || dressed.has(mat)) continue;
      dressed.add(mat);
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap] as (Texture | null)[]) {
        if (t && t.anisotropy !== aniso) { t.anisotropy = aniso; t.needsUpdate = true; }
      }
      if (mat.map && mat.map.colorSpace !== SRGBColorSpace) { mat.map.colorSpace = SRGBColorSpace; mat.map.needsUpdate = true; }
      if (/_head$/.test(mat.name)) {
        mat.roughness = 0.84;
        mat.envMapIntensity = 0.3;
        mat.emissive.set("#5c2c1a");
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 0.1;
        mat.needsUpdate = true;
      }
    }
  });
}
/** Compile every shader of the scene and upload a person's textures now (the floor's own warm-up ran at the intro,
 *  before this person had loaded). */
function warm(gl: WebGLRenderer, scene: import("three").Scene, camera: import("three").Camera, root: import("three").Object3D | null) {
  const r = gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> };
  const done = r.compileAsync ? r.compileAsync(scene, camera) : Promise.resolve(gl.compile(scene, camera));
  void done.then(() => {
    (root ?? scene).traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap] as (Texture | null | undefined)[]) {
          if (t && !warmed.has(t)) { warmed.add(t); gl.initTexture(t); }
        }
      }
    });
  }).catch(() => undefined);
}

/** one guide: where they are, where they walk, what they do */
function Guide({ role, start, startYaw, face, route, snapTo, speakKey, speakSeconds, listening, thinking, wave, onStep }: {
  role: Role; start: Vec3; startYaw: number; face: number; route: Route | null; snapTo: { at: Vec3; yaw: number; n: number } | null;
  speakKey: string | null; speakSeconds: number; listening: boolean; thinking: boolean; wave: string | null;
  /** every frame, after the step: where they are and whether their walk has started */
  onStep?: (m: Mover, walking: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const { gl, scene, camera, size } = useThree();
  const group = useRef<Group>(null);
  const m = useRef<Mover>(mover({ x: start[0], z: start[2] }, startYaw));
  const walking = useRef(false);
  const activity = useRef<Activity & { speed?: number }>({ moving: false, turning: false, speed: 0, listening: false }) as MutableRefObject<Activity & { speed?: number }>;
  const faceRef = useRef(face);
  faceRef.current = face;
  const head = useMemo(() => new Vector3(), []);
  const edge = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);

  // a new walk: its waypoints, after its delay (the gesture)
  useEffect(() => {
    if (!route) return;
    const pts = route.pts.map(([x, z]) => ({ x, z }));
    const t = window.setTimeout(() => { m.current.path = pts; walking.current = true; }, reduced ? 0 : route.delay);
    return () => window.clearTimeout(t);
  }, [route, reduced]);

  // a new starting spot (the film's analyst, from out of sight to the door)
  useEffect(() => {
    const mv = m.current;
    if (mv.path.length) return;
    mv.x = start[0];
    mv.z = start[2];
  }, [start]);

  // straight to a place (a skipped walk, a visit resumed there)
  useEffect(() => {
    if (!snapTo) return;
    const mv = m.current;
    mv.x = snapTo.at[0];
    mv.z = snapTo.at[2];
    mv.heading = snapTo.yaw;
    mv.path.length = 0;
    mv.speed = 0;
    walking.current = false;
  }, [snapTo]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    const mv = stepMover(m.current, dt, { cruise: CRUISE, face: m.current.path.length ? null : faceRef.current, reduced });
    const g = group.current;
    if (g) {
      g.position.set(mv.x, 0, mv.z);
      g.rotation.y = mv.heading;
    }
    const a = activity.current;
    a.moving = mv.speed > STOPPED;
    a.turning = !a.moving && mv.turning !== 0;
    a.speed = mv.speed;
    a.listening = listening && !a.moving;
    if (walking.current && !mv.path.length && mv.speed <= STOPPED) walking.current = false;
    onStep?.(mv, walking.current);
    // where the head is on screen, as a box (the speech bubble keeps clear of it)
    const h = heads[role];
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(HEAD_HALF);
    edge.set(mv.x, MOUTH_Y, mv.z).add(right).project(camera);
    head.set(mv.x, MOUTH_Y, mv.z).project(camera);
    h.x = ((head.x + 1) / 2) * size.width;
    h.y = ((1 - head.y) / 2) * size.height;
    h.r = Math.abs(edge.x - head.x) / 2 * size.width;
    h.on = head.z < 1 && Math.abs(head.x) < 1.05 && Math.abs(head.y) < 1.05;
    h.top = ((1 - head.set(mv.x, HEAD_TOP, mv.z).project(camera).y) / 2) * size.height;
    h.bottom = ((1 - head.set(mv.x, HEAD_BOTTOM, mv.z).project(camera).y) / 2) * size.height;
  });

  return (
    <group ref={group} position={start} rotation-y={startYaw}>
      <RealPerson id={GUIDE_CAST[role]} tier="close" height={1.8} activity={activity} speakKey={speakKey} speakSeconds={speakSeconds}
        waveKey={wave} reduced={reduced} seed={SEED[role]} lookAtCamera thinking={thinking}
        onReady={() => { if (group.current) dressSkin(gl, group.current); warm(gl, scene, camera, group.current); }} />
    </group>
  );
}

let routeN = 0;

export function OfficeCast() {
  const stage = useJourney((s) => s.stage);
  const walk = useJourney((s) => s.walk);
  const pm = useJourney((s) => s.pm);
  const phase = useJourney((s) => s.phase);
  const resetN = useJourney((s) => s.resetN);
  const office = useOfficeScene((s) => s.office);
  const snapN = useOfficeScene((s) => s.snapN);
  const focus = useOfficeScene((s) => s.focus);
  const thinking = useOfficeScene((s) => s.thinking);

  // who is talking right now: the office's streaming line, or the scripted film's line
  const streaming = useChat((s) => s.streaming);
  const youTyping = useChat((s) => s.youTyping);
  const filmSpeaking = useJourney((s) => s.speaking);
  const filmLine = useJourney((s) => s.line);
  const talk = (role: Role): { key: string | null; seconds: number } => {
    if (office) return streaming?.who === role ? { key: `o${streaming.id}`, seconds: Math.max(0, (streaming.until - performance.now()) / 1000) } : { key: null, seconds: 0 };
    return filmSpeaking === role && filmLine ? { key: `f${filmLine.id}`, seconds: filmLine.ms / 1000 } : { key: null, seconds: 0 };
  };
  const speaker: Role | null = office ? streaming?.who ?? null : filmSpeaking;

  // the walks
  const [routes, setRoutes] = useState<{ assistant: Route | null; pm: Route | null }>({ assistant: null, pm: null });
  const [introUntil, setIntroUntil] = useState(0);
  const [gesture, setGesture] = useState<string | null>(null);
  useEffect(() => {
    if (!walk) return;
    if (office) {
      // the escort: "this way" first, then he walks ahead to his place beside the analyst
      if (walk.to !== "meeting") return;
      setGesture(`way:${walk.n}`);
      setRoutes((r) => ({ ...r, assistant: { pts: ESCORT_ASSISTANT.slice(1) as XZ[], delay: GESTURE_MS, n: ++routeN } }));
      return;
    }
    const w = WALKS[walk.to as Exclude<StageId, "reception">];
    const pmWalks = Boolean(w.pm) && useJourney.getState().pm.present;
    setRoutes((r) => ({ assistant: { pts: w.assistant, delay: 0, n: ++routeN }, pm: pmWalks ? { pts: w.pm!, delay: 900, n: ++routeN } : r.pm }));
  }, [walk, office]);
  // the scripted film: the analyst walks into the meeting room midway
  useEffect(() => {
    if (pm.joinN > 0 && !office) setRoutes((r) => ({ ...r, pm: { pts: PM_JOIN.path, delay: 200, n: ++routeN } }));
  }, [pm.joinN, office]);
  useEffect(() => { setRoutes({ assistant: null, pm: null }); setIntroUntil(0); }, [resetN]);

  // the escort's progress for the camera; at his place he faces the analyst while he introduces them
  const arrivedOnce = useRef(false);
  const onAssistantStep = (mv: Mover, walking: boolean) => {
    if (!office || !escort.active) return;
    escort.x = mv.x;
    escort.z = mv.z;
    if (!walking && mv.path.length === 0 && performance.now() - escort.startedAt > GESTURE_MS + 400 && !escort.done) {
      escort.done = true;
      if (!arrivedOnce.current) { arrivedOnce.current = true; setIntroUntil(performance.now() + INTRO_MS); }
    }
  };
  useEffect(() => { arrivedOnce.current = false; }, [walk?.n]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!introUntil) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, introUntil - performance.now()) + 20);
    return () => window.clearTimeout(t);
  }, [introUntil]);

  // straight to the place in use
  const [snaps, setSnaps] = useState<{ assistant: { at: Vec3; yaw: number; n: number } | null; pm: { at: Vec3; yaw: number; n: number } | null }>({ assistant: null, pm: null });
  useEffect(() => {
    if (!snapN) return;
    const st = STAGES[useJourney.getState().stage];
    setRoutes({ assistant: null, pm: null });
    setSnaps({
      assistant: { at: st.assistant.at, yaw: st.assistant.yaw, n: snapN },
      pm: office ? (useJourney.getState().stage === "meeting" ? { at: STAGES.meeting.pm.at, yaw: STAGES.meeting.pm.yaw, n: snapN } : null) : { at: st.pm.at, yaw: st.pm.yaw, n: snapN },
    });
  }, [snapN, office]);

  const st = STAGES[stage];
  // the office visit: the analyst works at the table facing the wall screen until the visitor is there
  const atTable = office && stage === "meeting" && !walk;
  const pmStart: Vec3 = office ? STAGES.meeting.pm.at : pm.present ? PM_JOIN.from : PM_WAIT;
  const pmFace = office ? (atTable ? STAGES.meeting.pm.yaw : AT_WORK) : st.pm.yaw;
  const assistantFace = office
    ? stage === "meeting" ? (performance.now() < introUntil ? TOWARDS_ANALYST : STAGES.meeting.assistant.yaw) : STAGES.reception.assistant.yaw
    : st.assistant.yaw;
  const a = talk("assistant");
  const p = talk("pm");
  // a greeting: the assistant once the visit starts (and "this way" at the escort), the analyst when the visitor arrives
  const greetA = useMemo(() => (phase !== "journey" ? null : gesture ?? (stage === "reception" ? `hello:${resetN}` : null)), [phase, stage, resetN, gesture]);
  const greetP = atTable ? `table:${resetN}` : null;

  return (
    <group key={resetN}>
      <Guide role="assistant" start={STAGES.reception.assistant.at} startYaw={STAGES.reception.assistant.yaw} face={assistantFace}
        route={routes.assistant} snapTo={snaps.assistant} speakKey={a.key} speakSeconds={a.seconds} thinking={thinking === "assistant"}
        listening={(focus === "assistant" && youTyping) || (speaker === "pm" && stage !== "reception")} wave={greetA} onStep={onAssistantStep} />
      <Guide role="pm" start={pmStart} startYaw={office ? AT_WORK : st.pm.yaw} face={pmFace} thinking={thinking === "pm"}
        route={routes.pm} snapTo={snaps.pm} speakKey={p.key} speakSeconds={p.seconds}
        listening={(focus === "pm" && youTyping) || speaker === "assistant"} wave={greetP} />
    </group>
  );
}
