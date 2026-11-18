/**
 * One realistic person (a Rocketbox avatar of the cast), feet at y 0, facing +z. Loads lazily once the scene has
 * drawn its first frame, WebAssembly-free; until it is ready, or if it cannot load, `fallback` shows instead (e.g. the
 * code-built figure).
 *
 * Movement (see controller.ts, blend.ts, gait.ts):
 *  - clips blend by normalised activations (no bind-pose leaks, no restart of a clip that is still fading out); the
 *    first frame is posed before the person is shown, so there is never a T-pose;
 *  - the walk clip plays at the rate that matches the real ground speed (no foot sliding); turning on the spot steps;
 *  - standing loops start at a per-person point and run at a per-person rate; the chest breathes on top;
 *  - each spoken line picks one of the talk clips and a different stretch of it; listening adds a nod now and then;
 *  - the head turns towards the viewer with damping and limits, the eyes lead it with small saccades; blinks are
 *    random and come with large gaze shifts; the mouth moves while speaking (close-up files: facial blend shapes).
 * Reduced motion: poses only (no loops, nods, waves or talking gestures); the head still turns.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, Quaternion, Vector3, type AnimationAction, type Bone, type Mesh, type Object3D } from "three";
import {
  blinkWeight, breath, currentClip, damp, eyeAngles, fitScale, GAZE_BLINK, LOOK_YAW, lookAngles, mouthAt, nextBlinkIn, nextSaccadeIn, thinkingGlance,
  saccade, smileFor, type Activity,
} from "./controller";
import { continuation, fadeFor, LOOP_FADE, loopEnding, loopRate, nextNodIn, stepBlend, talkStart, talkVariant } from "./blend";
import { CLIP_WALK_SPEED, walkRate } from "./gait";
import { characterEnvironment, clipMeta, instantiate, loadCharacter, treatMaterials, type LoadedModel } from "./loader";
import { CHARACTERS, type CharacterId, type ClipName, type Tier } from "./registry";

export interface PersonReadyInfo {
  /** the top of the head, in the parent's units (after `height` scaling) */
  headY: number;
}

export interface RealPersonProps {
  id: CharacterId;
  tier?: Tier;
  /** stand this tall (parent units); default: the model's own height (about 1.8 m) */
  height?: number;
  /** a new key starts a spoken line lasting about `speakSeconds` (gestures, mouth); null: not speaking */
  speakKey?: string | null;
  speakSeconds?: number;
  /** waiting for the visitor: the listening idle */
  listening?: boolean;
  /** thinking it over: a brief glance down and aside that comes back to the visitor within about a second */
  thinking?: boolean;
  moving?: boolean;
  seated?: boolean;
  /** walking speed in parent units per second (syncs the steps) */
  speed?: number;
  /** what the person is doing, written by the parent every frame (wins over the props above) */
  activity?: MutableRefObject<Activity & { speed?: number }>;
  /** waves once each time this changes to a new non-null value */
  waveKey?: string | number | null;
  lookAtCamera?: boolean;
  reduced?: boolean;
  /** start loading only after the scene has drawn (default true) */
  deferred?: boolean;
  fallback?: ReactNode;
  onReady?: (info: PersonReadyInfo) => void;
  onError?: (error: Error) => void;
  /** varies the timing between people */
  seed?: number;
}

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const AHEAD = { yaw: 0, pitch: 0 };
const ONCE: ReadonlySet<ClipName> = new Set(["wave", "nod"]);
/** standing loops: played once and crossfaded into their continuation near the end (blend.ts LOOP_FADE) */
const STANDING: ReadonlySet<ClipName> = new Set(["idle", "idle2", "talk", "talk2", "listen", "sit"]);

/** a second clip object over the same tracks (no copy), so one clip can crossfade into its own start */
const twins = new WeakMap<AnimationClip, AnimationClip>();
const twinOf = (c: AnimationClip) => {
  let t = twins.get(c);
  if (!t) { t = new AnimationClip(c.name, c.duration, c.tracks); twins.set(c, t); }
  return t;
};

interface Rig {
  root: Object3D;
  mixer: AnimationMixer;
  names: ClipName[];
  actions: AnimationAction[];
  /** the primary action of each clip */
  index: Map<ClipName, number>;
  /** a standing loop's other action (-1: none) */
  twin: number[];
  /** activations and the normalised weights (blend.ts) */
  act: number[];
  weights: number[];
  waveSeconds: number;
  nodSeconds: number;
  /** the walk clip's ground speed, model units per second */
  walkSpeed: number;
  talks: ClipName[];
  faces: Mesh[];
  head: Bone | null;
  neck: Bone | null;
  chest: Bone | null;
  eyes: Bone[];
  /** the eyes' rest orientation: no clip drives the eye bones, so the gaze is re-applied from rest every frame */
  eyeRest: Quaternion[];
  eyeY: number;
}

function buildRig(model: LoadedModel, clips: AnimationClip[]): Rig {
  const root = instantiate(model);
  const mixer = new AnimationMixer(root);
  const names: ClipName[] = [];
  const actions: AnimationAction[] = [];
  const index = new Map<ClipName, number>();
  const twin: number[] = [];
  let walkSpeed = CLIP_WALK_SPEED;
  const add = (c: AnimationClip, name: ClipName) => {
    const a = mixer.clipAction(c);
    // only the walk loops by itself (built to close); everything else plays once and is continued by crossfade
    if (name === "walk") a.setLoop(LoopRepeat, Infinity);
    else { a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; }
    names.push(name);
    actions.push(a);
    twin.push(-1);
    return actions.length - 1;
  };
  for (const c of clips) {
    const name = c.name as ClipName;
    const i = add(c, name);
    index.set(name, i);
    if (STANDING.has(name)) { const j = add(twinOf(c), name); twin[i] = j; twin[j] = i; }
    const ground = clipMeta(c).groundSpeed;
    if (name === "walk" && typeof ground === "number" && ground > 0.2) walkSpeed = ground;
  }
  const act = actions.map(() => 0);
  const weights = actions.map(() => 0);
  // posed before it is ever drawn: the idle at full weight (never the bind pose)
  const idle = index.get("idle");
  if (idle !== undefined) {
    act[idle] = 1;
    weights[idle] = 1;
    actions[idle].setEffectiveWeight(1).play();
    mixer.update(0);
  }
  const faces: Mesh[] = [];
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.morphTargetDictionary && "blinkL" in m.morphTargetDictionary) faces.push(m); });
  const bone = (n: string) => (root.getObjectByName(n) as Bone | undefined) ?? null;
  const head = bone("Bip01_Head");
  const eyes = [bone("Bip01_LEye"), bone("Bip01_REye")].filter((b): b is Bone => b !== null);
  root.updateMatrixWorld(true);
  const eyeY = head ? root.worldToLocal(head.getWorldPosition(new Vector3())).y + 0.07 : model.height * 0.93;
  const dur = (n: ClipName, d: number) => { const i = index.get(n); return i === undefined ? d : actions[i].getClip().duration; };
  return {
    root, mixer, names, actions, index, twin, act, weights,
    waveSeconds: dur("wave", 2.5), nodSeconds: dur("nod", 2.2), walkSpeed,
    talks: (["talk", "talk2"] as const).filter((n) => index.has(n)),
    faces, head, neck: bone("Bip01_Neck"), chest: bone("Bip01_Spine2"), eyes, eyeRest: eyes.map((b) => b.quaternion.clone()), eyeY,
  };
}

export function RealPerson(props: RealPersonProps) {
  const { id, tier = "far", height, deferred = true, fallback = null } = props;
  const gl = useThree((s) => s.gl);
  const [go, setGo] = useState(!deferred);
  const [state, setState] = useState<{ model: LoadedModel; clips: AnimationClip[] } | "error" | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useFrame(() => { if (!go) setGo(true); });

  useEffect(() => {
    if (!go) return;
    let live = true;
    setState(null);
    loadCharacter(id, tier).then(
      ([model, clips]) => { if (live) setState({ model, clips }); },
      (e: unknown) => {
        if (!live) return;
        setState("error");
        latest.current.onError?.(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => { live = false; };
  }, [go, id, tier]);

  const rig = useMemo(() => (state && state !== "error" ? buildRig(state.model, state.clips) : null), [state]);
  const scale = rig && state && state !== "error" ? (height ? fitScale(state.model.height, height) : 1) : 1;

  useEffect(() => {
    if (!rig) return;
    treatMaterials(rig.root, characterEnvironment(gl));
    return () => { rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.root); };
  }, [rig, gl]);

  useEffect(() => {
    if (rig && state && state !== "error") latest.current.onReady?.({ headY: state.model.height * scale });
  }, [rig, state, scale]);

  // per-frame state (not React state)
  const S = useRef({
    now: 0, current: "idle" as ClipName, target: -1, fade: 0.45, waveAt: null as number | null, waveKey: undefined as unknown,
    nodAt: null as number | null, nodIn: 5, talkUntil: 0, talkStart: 0, speakKey: null as string | null, line: 0,
    talkClip: null as ClipName | null, idleClip: "idle" as ClipName, loops: 0, slot: new Map<ClipName, number>(), rig: null as Rig | null,
    thinkAt: -10, thinkWas: false, blinkIn: 1.5, blinkT: -1, yaw: 0, pitch: 0, wantYaw: 0, eyeYaw: 0, eyePitch: 0, sacIn: 1, sx: 0, sy: 0,
    q: new Quaternion(), qa: new Quaternion(), qp: new Quaternion(), pw: new Quaternion(), pwi: new Quaternion(), v: new Vector3(), axis: new Vector3(),
  });

  useFrame(({ camera }, raw) => {
    if (!rig) return;
    const s = S.current;
    const p = latest.current;
    const dt = Math.min(raw, 0.1);
    s.now += dt;
    const seed = p.seed ?? 0;
    const reduced = Boolean(p.reduced);
    if (s.rig !== rig) {
      // a new model (another tier): it starts posed in its idle (buildRig)
      s.rig = rig;
      s.slot.clear();
      s.current = "idle";
      s.idleClip = "idle";
      s.target = rig.index.get("idle") ?? -1;
    }

    // a new line starts the talking (with its own gestures); a new wave key starts a wave
    if (p.speakKey !== s.speakKey) {
      s.speakKey = p.speakKey ?? null;
      if (s.speakKey) {
        s.line += 1;
        s.talkStart = s.now;
        s.talkUntil = s.now + Math.max(2.5, (p.speakSeconds ?? 0) + 0.8);
        s.talkClip = talkVariant(seed, s.line, s.talkClip, rig.talks);
      } else s.talkUntil = 0;
    }
    if (p.waveKey !== s.waveKey) {
      if (p.waveKey !== null && p.waveKey !== undefined && !reduced) s.waveAt = s.now;
      s.waveKey = p.waveKey;
    }
    const a = p.activity?.current;
    const talking = s.now < s.talkUntil && !reduced;
    const act: Activity = {
      moving: a?.moving ?? p.moving,
      turning: a?.turning,
      seated: a?.seated ?? p.seated,
      talking: a?.talking ?? talking,
      listening: a?.listening ?? p.listening,
    };
    // listening: a nod now and then
    if (act.listening && !act.moving && !act.talking && !reduced && rig.index.has("nod")) {
      s.nodIn -= dt;
      if (s.nodIn <= 0) { s.nodAt = s.now; s.nodIn = nextNodIn(Math.random()) + rig.nodSeconds; }
    } else s.nodIn = Math.max(s.nodIn, 2.5);
    let want = currentClip(act, { startedAt: s.waveAt }, s.now, rig.waveSeconds, { startedAt: s.nodAt, duration: rig.nodSeconds });
    if (want !== "wave" && s.waveAt !== null && s.now - s.waveAt > rig.waveSeconds) s.waveAt = null;
    if (want !== "nod" && s.nodAt !== null && s.now - s.nodAt > rig.nodSeconds) s.nodAt = null;
    if (want === "talk") want = s.talkClip ?? rig.talks[Math.floor(seed * 13) % Math.max(1, rig.talks.length)] ?? "talk";
    if (want === "idle") want = s.idleClip;
    const slotOf = (n: ClipName) => s.slot.get(n) ?? rig.index.get(n) ?? rig.index.get("idle") ?? -1;
    let target = slotOf(want);
    // a standing clip near its end continues (crossfaded, never wrapped): the other talk, another idle, or its own start
    let continued = false;
    if (target >= 0 && target === s.target && STANDING.has(want) && !reduced) {
      const running = rig.actions[target];
      if (loopEnding(running.time, running.getClip().duration)) {
        const next = continuation(want, Math.random(), (c) => rig.index.has(c));
        continued = true;
        s.loops += 1;
        if (next !== want) {
          if (want === "talk" || want === "talk2") s.talkClip = next;
          else s.idleClip = next;
          want = next;
          target = slotOf(next);
        } else if (rig.twin[target] >= 0) {
          target = rig.twin[target];
          s.slot.set(want, target);
        }
      }
    }
    if (target !== s.target) {
      s.fade = reduced ? 0.2 : continued ? LOOP_FADE : fadeFor(s.current, want);
      s.current = want;
      s.target = target;
      if (target >= 0 && rig.act[target] === 0) {
        // (re)started only from zero weight: no pop
        const action = rig.actions[target];
        const d = action.getClip().duration;
        action.reset();
        if (want === "talk" || want === "talk2") action.time = talkStart(seed, s.line * 31 + s.loops, d);
        else if (!ONCE.has(want) && !continued) action.time = ((seed * 7.31 + (want === "idle2" ? 0.37 : 0)) % 1) * Math.max(0, d - LOOP_FADE * 2);
        action.play();
      }
    }
    stepBlend(rig.act, target, dt, s.fade, rig.weights);
    const rate = loopRate(seed);
    for (let i = 0; i < rig.actions.length; i++) {
      const action = rig.actions[i];
      if (rig.act[i] <= 0) {
        if (action.isScheduled() || action.getEffectiveWeight() > 0) { action.stop(); action.setEffectiveWeight(0); }
        continue;
      }
      const n = rig.names[i];
      if (!action.isScheduled()) action.play();
      action.setEffectiveWeight(rig.weights[i]);
      action.timeScale = reduced ? 0
        : n === "walk" ? walkRate(a?.speed ?? p.speed ?? 1.2, rig.walkSpeed, scale, Boolean(act.turning && !act.moving))
        : STANDING.has(n) ? rate : 1;
    }
    rig.mixer.update(dt);

    rig.root.updateWorldMatrix(true, false);
    rig.root.getWorldQuaternion(s.q);
    const premultiply = (bone: Bone | null, yaw: number, pitch: number) => {
      if (!bone?.parent) return;
      s.qa.setFromAxisAngle(s.axis.copy(UP).applyQuaternion(s.q), yaw);
      s.qp.setFromAxisAngle(s.axis.copy(RIGHT).applyQuaternion(s.q), pitch);
      s.qa.multiply(s.qp);
      // local' = parentWorld^-1 * turn * parentWorld * local (getWorldQuaternion refreshes the ancestors only)
      bone.parent.getWorldQuaternion(s.pw);
      s.pwi.copy(s.pw).invert().multiply(s.qa).multiply(s.pw);
      bone.quaternion.premultiply(s.pwi);
    };

    // breathing, layered on whatever the clip does (not while walking: the walk breathes itself)
    if (!reduced && !act.moving && !act.turning && rig.chest) premultiply(rig.chest, 0, -breath(s.now, seed, talking));

    // the head: towards the camera, within a natural range, shared between neck and head; the eyes lead
    let gazeJump = false;
    if ((p.lookAtCamera ?? true) && rig.head) {
      rig.root.worldToLocal(s.v.copy(camera.position));
      const seen = act.moving || act.turning ? AHEAD : lookAngles(s.v.x, s.v.y, s.v.z, rig.eyeY);
      // thinking: a short glance down and aside as the thought starts, back on the visitor within about a second
      if (p.thinking && !s.thinkWas) s.thinkAt = s.now;
      s.thinkWas = Boolean(p.thinking);
      const g = p.thinking && !act.moving && !reduced ? thinkingGlance(s.now - s.thinkAt) : 0;
      const look = g > 0 ? { yaw: Math.min(LOOK_YAW, seen.yaw + 0.12 * g), pitch: seen.pitch + 0.13 * g } : seen;
      gazeJump = Math.abs(look.yaw - s.wantYaw) > GAZE_BLINK;
      s.wantYaw = look.yaw;
      s.yaw = damp(s.yaw, look.yaw, reduced ? 30 : 3.2, dt);
      s.pitch = damp(s.pitch, look.pitch, reduced ? 30 : 3.2, dt);
      premultiply(rig.neck, s.yaw * 0.4, s.pitch * 0.4);
      premultiply(rig.head, s.yaw * 0.6, s.pitch * 0.6);
      if (rig.eyes.length) {
        s.sacIn -= dt;
        if (s.sacIn <= 0 && !reduced) {
          const sc = saccade(Math.random(), Math.random());
          s.sx = sc.x; s.sy = sc.y;
          s.sacIn = nextSaccadeIn(Math.random());
        }
        const e = eyeAngles(look.yaw, s.yaw, look.pitch, s.pitch, act.moving ? 0 : s.sx, act.moving ? 0 : s.sy);
        s.eyeYaw = damp(s.eyeYaw, e.yaw, 22, dt);
        s.eyePitch = damp(s.eyePitch, e.pitch, 22, dt);
        for (let i = 0; i < rig.eyes.length; i++) { rig.eyes[i].quaternion.copy(rig.eyeRest[i]); premultiply(rig.eyes[i], s.eyeYaw, s.eyePitch); }
      }
    }

    // the face: blinks (random, and with large gaze shifts), a speaking mouth, a small smile
    if (rig.faces.length) {
      s.blinkIn -= dt;
      if (s.blinkIn <= 0 || (gazeJump && s.blinkT < 0)) { s.blinkT = 0; s.blinkIn = nextBlinkIn(Math.random()); }
      const rest = CHARACTERS[p.id].face?.blink ?? 0;
      let blink = rest;
      if (s.blinkT >= 0) {
        s.blinkT += dt;
        const w = blinkWeight(s.blinkT);
        if (w === 0 && s.blinkT > 0.05) s.blinkT = -1;
        blink = Math.max(rest, w);
      }
      const mouth = mouthAt(s.now - s.talkStart, talking, seed);
      const smile = smileFor(talking, s.current === "wave");
      for (const f of rig.faces) {
        const d = f.morphTargetDictionary!, w = f.morphTargetInfluences!;
        const set = (k: string, v: number) => { const i = d[k]; if (i !== undefined) w[i] = damp(w[i], v, k.startsWith("blink") ? 60 : 18, dt); };
        set("blinkL", blink); set("blinkR", blink);
        set("aa", mouth.aa); set("oh", mouth.oh); set("ee", mouth.ee); set("pp", mouth.pp); set("jawOpen", mouth.jawOpen);
        set("smileL", smile); set("smileR", smile);
      }
    }
  });

  if (!rig) return <>{fallback}</>;
  return (
    <group scale={scale}>
      <primitive object={rig.root} />
    </group>
  );
}
