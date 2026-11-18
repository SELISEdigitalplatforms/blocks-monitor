/**
 * A guide of the journey (MADP Assistant or business analyst): a Rocketbox avatar in the white SELISE polo, feet at the
 * given position, facing +z at rotation 0.
 *
 * Motion is calm by design (adapted from the Factory office's RealPerson):
 *  - standing: the mocap idles, crossfaded into each other at their ends (no seam, no T-pose), a per-person rate; the
 *    chest breathes on top; arms are low-passed and eased towards a relaxed rest pose, so hands stay by the sides;
 *  - speaking: the same calm body, a moving mouth (facial blend shapes) and gentle, irregular head nods; no gesture clips;
 *  - walking: a slow walk whose playback matches the ground speed; a big turn is made on the spot first (small steps);
 *  - the head turns towards `lookAt` with damping and limits; the eyes lead it, with micro-saccades every 1–3 s, the upper
 *    lids following the gaze down; blinks every 3–6 s (fast close, slower open, now and then a double), and with big
 *    gaze shifts; a glossy cornea gives a catchlight, the pupils widen a touch in dim light;
 *  - the face never freezes: brows, cheeks and mouth corners drift by a millimetre or two; a soft smile while listening;
 *  - speech: mouth shapes from the spoken text (`speech`), with real closures on m/b/p and rests between words.
 * Every procedural rotation is clamped and damped; bones the clips do not drive (eyes, face) are reset to rest each frame.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationClip, AdditiveBlending, AnimationMixer, CanvasTexture, CircleGeometry, Color, Matrix4, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, SphereGeometry, DoubleSide, LoopOnce, LoopRepeat, Mesh, PlaneGeometry, Quaternion, Vector3,
  Object3D, type AnimationAction, type Bone, type Texture,
} from "three";
import { continuation, LOOP_FADE, loopEnding, loopRate, stepBlend } from "../blend";
import { breath, damp, eyeAngles, GAZE_BLINK, lookAngles, mouthAt, saccade } from "../controller";
import { blinkCurve, BLINK_TOTAL, drift, nextBlink, nextMicroSaccade, visemeAt, type Viseme } from "./face";
import { angleTo, mover, stepMover, STOPPED, walkRate, type Mover } from "../gait";
import { characterEnvironment, clipMeta, treatMaterials } from "../loader";
import type { ClipName } from "../registry";
import { agentClipsUrl, instantiateAgent, loadAgent, loadClips, loadLogo, type DressedAgent } from "./loader";
import { AGENTS, type AgentRole } from "./registry";

export type V3 = [number, number, number];

export interface AgentProps {
  role: AgentRole;
  position: V3;
  /** yaw in radians, 0 faces +z; the heading the agent settles to when standing */
  rotation?: number;
  speaking?: boolean;
  /** walk (slowly) from where the agent is to here; then onArrive() and turn to `rotation` */
  walkingTo?: V3 | null;
  onArrive?: () => void;
  /** world point the head and eyes turn to (usually the camera); null: ahead */
  lookAt?: V3 | null;
  /** the line being said (drives the mouth shapes and its length); without it the mouth moves generically */
  speech?: string | null;
  /** hearing the visitor out: a soft smile (default: when not speaking and looking at someone) */
  listening?: boolean;
}

/** a slow, natural office pace (m/s) */
const CRUISE = 1.0;
const USED: readonly ClipName[] = ["idle", "idle2", "walk"];
const STANDING: ReadonlySet<ClipName> = new Set(["idle", "idle2"]);
const ARM = /Clavicle|UpperArm|Forearm|Hand|Finger/;
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const FWD = new Vector3(0, 0, 1);
/**
 * A relaxed stance on top of the idle (radians, about the person's own up / right / forward axes, + = left side):
 * shoulders let down, upper arms a touch forward and away from the hips, elbows softly bent, wrists and fingers loosely
 * curled. Faded out while walking (the walk swings the arms itself).
 */
const STANCE: [RegExp, number, number, number][] = [
  [/^Bip01_L_Clavicle$/, 0, 0, -0.03], [/^Bip01_R_Clavicle$/, 0, 0, 0.03],
  [/^Bip01_L_UpperArm$/, 0, -0.07, -0.02], [/^Bip01_R_UpperArm$/, 0, -0.07, 0.02],
  [/^Bip01_L_Forearm$/, 0, -0.3, -0.04], [/^Bip01_R_Forearm$/, 0, -0.3, 0.04],
  [/^Bip01_L_Hand$/, 0, -0.08, -0.04], [/^Bip01_R_Hand$/, 0, -0.08, 0.04],
  [/^Bip01_L_Finger[1-4]\d?$/, 0, 0, -0.14], [/^Bip01_R_Finger[1-4]\d?$/, 0, 0, 0.14],
];
const AHEAD = { yaw: 0, pitch: 0 };

const logoGeo = new PlaneGeometry(1, 1);
let logoMat: MeshLambertMaterial | null = null;
/** the embroidered logo: lit like the cloth, with a little self-light so the SELISE blue stays true in a bright room */
function logoMaterial(tex: Texture) {
  if (!logoMat) {
    logoMat = new MeshLambertMaterial({
      map: tex, emissiveMap: tex, emissive: new Color("#ffffff"), emissiveIntensity: 0.32, transparent: true, alphaTest: 0.02,
      side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12, depthWrite: false,
    });
  }
  return logoMat;
}

/** the cornea: a clear cap over the eyeball that only adds its reflection (additive, black base) = a catchlight */
const corneaGeo = new SphereGeometry(1.012, 20, 10, 0, Math.PI * 2, 0, 0.62).rotateX(Math.PI / 2);
const corneaProto = new MeshPhysicalMaterial({
  color: new Color(0, 0, 0), roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1,
  transparent: true, blending: AdditiveBlending, depthWrite: false,
});
/** the pupil: a soft dark disc that widens in dim light (over the painted one) */
const pupilGeo = new CircleGeometry(1, 20);
let pupilMat: MeshBasicMaterial | null = null;
function pupilMaterial(): MeshBasicMaterial {
  if (pupilMat) return pupilMat;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(0.62, "rgba(0,0,0,0.95)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  pupilMat = new MeshBasicMaterial({ color: "#060504", alphaMap: new CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return pupilMat;
}
const FACE_BONES: Record<string, { up: number; smile?: number; ch: number }> = {
  Bip01_LInnerEyebrow: { up: 1, ch: 1 }, Bip01_RInnerEyebrow: { up: 1, ch: 1 }, Bip01_MMiddleEyebrow: { up: 0.6, ch: 1 },
  Bip01_LOuterEyebrow: { up: 0.7, ch: 2 }, Bip01_ROuterEyebrow: { up: 0.7, ch: 3 },
  Bip01_LCheek: { up: 0.5, smile: 1, ch: 4 }, Bip01_RCheek: { up: 0.5, smile: 1, ch: 5 },
  Bip01_LMouthCorner: { up: 0.6, smile: 1.4, ch: 6 }, Bip01_RMouthCorner: { up: 0.6, smile: 1.4, ch: 7 },
};

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
  index: Map<ClipName, number>;
  twin: number[];
  act: number[];
  weights: number[];
  walkSpeed: number;
  faces: Mesh[];
  head: Bone | null;
  neck: Bone | null;
  chest: Bone | null;
  eyes: Bone[];
  eyeY: number;
  arms: Bone[];
  armF: Quaternion[];
  armRest: Quaternion[];
  stance: { bone: Bone; yaw: number; pitch: number; roll: number }[];
  eyeRest: Quaternion[];
  /** this agent's cornea material: its catchlight fades with distance (in a wide shot it would only whiten the eye) */
  cornea: MeshPhysicalMaterial;
  pupils: Mesh[];
  /** face bones: rest position and the local offset of 1 mm "up" in the head's frame */
  faceBones: { bone: Bone; rest: Vector3; up: Vector3; w: { up: number; smile?: number; ch: number } }[];
}

function buildRig(agent: DressedAgent, clips: AnimationClip[], logo: Texture): Rig {
  const model = agent.model;
  const root = instantiateAgent(agent);
  const mixer = new AnimationMixer(root);
  const names: ClipName[] = [], actions: AnimationAction[] = [], twin: number[] = [];
  const index = new Map<ClipName, number>();
  let walkSpeed = 1.25;
  const add = (c: AnimationClip, name: ClipName) => {
    const a = mixer.clipAction(c);
    if (name === "walk") a.setLoop(LoopRepeat, Infinity);
    else { a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; }
    names.push(name); actions.push(a); twin.push(-1);
    return actions.length - 1;
  };
  for (const c of clips) {
    const name = c.name as ClipName;
    if (!USED.includes(name)) continue;
    const i = add(c, name);
    index.set(name, i);
    if (STANDING.has(name)) { const j = add(twinOf(c), name); twin[i] = j; twin[j] = i; }
    const g = clipMeta(c).groundSpeed;
    if (name === "walk" && typeof g === "number" && g > 0.2) walkSpeed = g;
  }
  const act = actions.map(() => 0), weights = actions.map(() => 0);
  const idle = index.get("idle");
  if (idle !== undefined) { act[idle] = 1; weights[idle] = 1; actions[idle].setEffectiveWeight(1).play(); mixer.update(0); }

  const faces: Mesh[] = [];
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.morphTargetDictionary && "blinkL" in m.morphTargetDictionary) faces.push(m); });
  const bone = (n: string) => (root.getObjectByName(n) as Bone | undefined) ?? null;
  const head = bone("Bip01_Head");
  const chest = bone("Bip01_Spine2");
  const eyes = [bone("Bip01_LEye"), bone("Bip01_REye")].filter((b): b is Bone => b !== null);
  root.updateMatrixWorld(true);
  const eyeY = head ? root.worldToLocal(head.getWorldPosition(new Vector3())).y + 0.07 : model.height * 0.93;

  // the arms: the idle's first pose is the relaxed rest the motion is eased towards
  const arms: Bone[] = [];
  root.traverse((o) => { if ((o as Bone).isBone && ARM.test(o.name)) arms.push(o as Bone); });
  const armRest = arms.map((b) => b.quaternion.clone());
  const armF = arms.map((b) => b.quaternion.clone());

  // the SELISE logo, riding the chest bone like an embroidered patch
  if (chest && agent.logoMatrix) {
    const img = logo.image as { width: number; height: number };
    const patch = new Mesh(logoGeo, logoMaterial(logo));
    patch.matrixAutoUpdate = false;
    patch.matrix.copy(agent.logoMatrix).multiply(new Matrix4().makeScale(1, img.height / img.width, 1));
    patch.renderOrder = 2;
    chest.add(patch);
  }
  // the relaxed stance, parents before children (the list order follows the arm chain)
  const stance: Rig["stance"] = [];
  for (const [re, yaw, pitch, roll] of STANCE) root.traverse((o) => { if ((o as Bone).isBone && re.test(o.name)) stance.push({ bone: o as Bone, yaw, pitch, roll }); });
  // the eyes: rest orientation (no clip drives them), cornea and pupil on each eyeball
  const eyeRest = eyes.map((b) => b.quaternion.clone());
  const pupils: Mesh[] = [];
  const cornea_ = corneaProto.clone();
  for (const e of agent.eyes) {
    const b = bone(e.bone);
    if (!b) continue;
    const ball = new Object3D();
    ball.matrixAutoUpdate = false;
    ball.matrix.copy(e.matrix);
    const cornea = new Mesh(corneaGeo, cornea_);
    cornea.renderOrder = 3;
    const pupil = new Mesh(pupilGeo, pupilMaterial());
    pupil.position.z = 1.003;
    pupil.scale.setScalar(0.16);
    pupil.renderOrder = 2;
    ball.add(cornea, pupil);
    b.add(ball);
    pupils.push(pupil);
  }
  // face bones for micro-expressions, measured in the rest pose (head upright)
  const faceBones: Rig["faceBones"] = [];
  const wp = new Vector3(), inv = new Matrix4();
  for (const [n, w] of Object.entries(FACE_BONES)) {
    const b = bone(n);
    if (!b?.parent) continue;
    b.getWorldPosition(wp);
    inv.copy(b.parent.matrixWorld).invert();
    const up = wp.clone().add(new Vector3(0, 0.001, 0)).applyMatrix4(inv).sub(b.position);
    faceBones.push({ bone: b, rest: b.position.clone(), up, w });
  }
  return {
    root, mixer, names, actions, index, twin, act, weights, walkSpeed, faces, head, neck: bone("Bip01_Neck"), chest, eyes, eyeY, arms, armF, armRest,
    eyeRest, pupils, faceBones, stance, cornea: cornea_,
  };
}

/** a rough measure of how bright it is where the agent stands (ambient + hemisphere + directional + nearby points) */
const lightPos = new Vector3(), agentPos = new Vector3();
function sceneBrightness(scene: Object3D, at: Object3D): number {
  let b = 0;
  at.getWorldPosition(agentPos);
  scene.traverse((o) => {
    const l = o as import("three").Light & { isAmbientLight?: boolean; isHemisphereLight?: boolean; isDirectionalLight?: boolean; isPointLight?: boolean; isSpotLight?: boolean };
    if (!l.isLight || !l.visible) return;
    if (l.isAmbientLight || l.isHemisphereLight) b += l.intensity;
    else if (l.isDirectionalLight) b += l.intensity * 0.6;
    else if (l.isPointLight || l.isSpotLight) b += l.intensity / Math.max(1, l.getWorldPosition(lightPos).distanceToSquared(agentPos));
  });
  return b;
}

const key = (v: V3 | null | undefined) => (v ? `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}` : "");

export function Agent(props: AgentProps) {
  const { role } = props;
  const gl = useThree((s) => s.gl);
  const [rig, setRig] = useState<Rig | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const def = AGENTS[role];

  useEffect(() => {
    let live = true;
    Promise.all([loadAgent(role), loadClips(agentClipsUrl(role)), loadLogo()]).then(
      ([agent, clips, logo]) => { if (live) setRig(buildRig(agent, clips, logo)); },
      (e: unknown) => console.warn(`[Agent] ${role} could not load`, e),
    );
    return () => { live = false; };
  }, [role]);

  useEffect(() => {
    if (!rig) return;
    treatMaterials(rig.root, characterEnvironment(gl));
    rig.cornea.envMapIntensity = 0; // set per frame by distance
    return () => { rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.root); };
  }, [rig, gl]);

  // where the agent is (not React state)
  const group = useRef<import("three").Group>(null);
  const M = useRef<Mover>(mover({ x: props.position[0], z: props.position[2] }, props.rotation ?? 0));
  const posKey = key(props.position);
  const walkKey = key(props.walkingTo);
  const W = useRef({ posKey: "", walkKey: "", walking: false });
  useMemo(() => {
    const w = W.current, m = M.current;
    if (posKey !== w.posKey) {
      w.posKey = posKey;
      m.x = props.position[0]; m.z = props.position[2]; m.path.length = 0; m.speed = 0;
      if (!w.walking) m.heading = props.rotation ?? m.heading;
      w.walking = false;
    }
    if (walkKey !== w.walkKey) {
      w.walkKey = walkKey;
      if (props.walkingTo) { m.path = [{ x: props.walkingTo[0], z: props.walkingTo[2] }]; w.walking = true; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, walkKey]);

  const S = useRef({
    now: 0, target: -1, current: "idle" as ClipName, fade: 0.45, idleClip: "idle" as ClipName, loops: 0, slot: new Map<ClipName, number>(), rig: null as Rig | null,
    blinkIn: 1.5 + Math.random() * 2, blinkT: -1, yaw: 0, pitch: 0, wantYaw: 0, eyeYaw: 0, eyePitch: 0, sacIn: 1, sx: 0, sy: 0,
    speak: 0, talkT: 0, wasSpeaking: false, nodAt: -10, nodIn: 1.2, nodAmp: 0.05, calm: 0.4, pose: 1,
    lightIn: 0, bright: 1.5, pupil: 0.16, smileF: 0.1, vis: { aa: 0, oh: 0, ee: 0, pp: 0, jawOpen: 0 } as Viseme,
    q: new Quaternion(), qa: new Quaternion(), qp: new Quaternion(), pw: new Quaternion(), pwi: new Quaternion(), v: new Vector3(), axis: new Vector3(),
  });

  useFrame(({ scene, camera }, raw) => {
    const g = group.current;
    if (!g) return;
    const p = latest.current;
    const dt = Math.min(raw, 0.1);
    const m = M.current, w = W.current;
    const seed = def.seed;

    // ── where: walk, turn, settle ──
    const face = p.rotation ?? 0;
    const hadPath = m.path.length > 0;
    stepMover(m, dt, { cruise: CRUISE, face: m.path.length ? null : face });
    if (hadPath && !m.path.length && w.walking) { w.walking = false; p.onArrive?.(); }
    g.position.set(m.x, p.position[1], m.z);
    g.rotation.y = m.heading;

    if (!rig) return;
    const s = S.current;
    s.now += dt;
    if (s.rig !== rig) { s.rig = rig; s.slot.clear(); s.current = "idle"; s.idleClip = "idle"; s.target = rig.index.get("idle") ?? -1; }
    const moving = m.speed > STOPPED || m.path.length > 0 && Math.abs(angleTo(m.heading, Math.atan2(m.path[0].x - m.x, m.path[0].z - m.z))) < 0.9;
    const turning = !moving && m.turning !== 0;
    const walking = moving || turning;

    // ── which clip ──
    let want: ClipName = walking ? "walk" : s.idleClip;
    const slotOf = (n: ClipName) => s.slot.get(n) ?? rig.index.get(n) ?? rig.index.get("idle") ?? -1;
    let target = slotOf(want);
    let continued = false;
    if (target >= 0 && target === s.target && STANDING.has(want)) {
      const running = rig.actions[target];
      if (loopEnding(running.time, running.getClip().duration)) {
        const next = continuation(want, Math.random(), (c) => rig.index.has(c));
        continued = true;
        s.loops += 1;
        if (next !== want) { s.idleClip = next; want = next; target = slotOf(next); }
        else if (rig.twin[target] >= 0) { target = rig.twin[target]; s.slot.set(want, target); }
      }
    }
    if (target !== s.target) {
      s.fade = continued ? LOOP_FADE : want === "walk" || s.current === "walk" ? 0.4 : 1.0;
      s.current = want;
      s.target = target;
      if (target >= 0 && rig.act[target] === 0) {
        const action = rig.actions[target];
        const d = action.getClip().duration;
        action.reset();
        if (want !== "walk" && !continued) action.time = ((seed * 7.31 + (want === "idle2" ? 0.37 : 0)) % 1) * Math.max(0, d - LOOP_FADE * 2);
        action.play();
      }
    }
    stepBlend(rig.act, target, dt, s.fade, rig.weights);
    const rate = loopRate(seed) * 0.92;
    for (let i = 0; i < rig.actions.length; i++) {
      const action = rig.actions[i];
      if (rig.act[i] <= 0) {
        if (action.isScheduled() || action.getEffectiveWeight() > 0) { action.stop(); action.setEffectiveWeight(0); }
        continue;
      }
      if (!action.isScheduled()) action.play();
      action.setEffectiveWeight(rig.weights[i]);
      action.timeScale = rig.names[i] === "walk" ? walkRate(Math.max(m.speed, 0.0), rig.walkSpeed, 1, turning) : rate;
    }
    rig.mixer.update(dt);

    // ── calm arms: low-pass (no jitter) and ease towards the relaxed rest while standing ──
    s.calm = damp(s.calm, walking ? 0 : 0.45, 2.5, dt);
    const k = 1 - Math.exp(-(walking ? 22 : 7) * dt);
    for (let i = 0; i < rig.arms.length; i++) {
      const b = rig.arms[i], f = rig.armF[i];
      s.q.copy(b.quaternion).slerp(rig.armRest[i], s.calm);
      f.slerp(s.q, k);
      b.quaternion.copy(f);
    }

    rig.root.updateWorldMatrix(true, false);
    rig.root.getWorldQuaternion(s.q);
    const premultiply = (bone: Bone | null, yaw: number, pitch: number, roll = 0) => {
      if (!bone?.parent) return;
      s.qa.setFromAxisAngle(s.axis.copy(UP).applyQuaternion(s.q), yaw);
      s.qp.setFromAxisAngle(s.axis.copy(RIGHT).applyQuaternion(s.q), pitch);
      s.qa.multiply(s.qp);
      if (roll) { s.qp.setFromAxisAngle(s.axis.copy(FWD).applyQuaternion(s.q), roll); s.qa.multiply(s.qp); }
      bone.parent.getWorldQuaternion(s.pw);
      s.pwi.copy(s.pw).invert().multiply(s.qa).multiply(s.pw);
      bone.quaternion.premultiply(s.pwi);
    };

    // ── the relaxed stance (faded out for the walk) ──
    s.pose = damp(s.pose, walking ? 0 : 1, 3, dt);
    if (s.pose > 0.01) for (const st of rig.stance) premultiply(st.bone, st.yaw * s.pose, st.pitch * s.pose, st.roll * s.pose);

    // ── speaking: envelope, irregular gentle nods ──
    const speaking = Boolean(p.speaking) && !walking;
    if (speaking && !s.wasSpeaking) { s.talkT = 0; s.nodIn = 0.6 + Math.random() * 0.8; }
    s.wasSpeaking = speaking;
    s.speak = damp(s.speak, speaking ? 1 : 0, 3, dt);
    s.talkT += dt;
    if (speaking) {
      s.nodIn -= dt;
      if (s.nodIn <= 0) { s.nodAt = s.now; s.nodAmp = 0.03 + Math.random() * 0.025; s.nodIn = 2.2 + Math.random() * 3.2; }
    }
    const nu = (s.now - s.nodAt) / 0.8;
    const nod = nu >= 0 && nu < 1 ? Math.sin(Math.PI * nu) ** 2 * s.nodAmp : 0;
    const sway = s.speak * (0.01 * Math.sin(s.now * 1.3 + seed) + 0.007 * Math.sin(s.now * 2.3 + seed * 2));
    const listening = p.listening ?? (!speaking && !walking && Boolean(p.lookAt));

    // breathing on the chest (the walk breathes itself)
    if (!walking && rig.chest) premultiply(rig.chest, 0, -breath(s.now, seed, speaking));

    // ── the head and eyes ──
    for (let i = 0; i < rig.eyes.length; i++) rig.eyes[i].quaternion.copy(rig.eyeRest[i]);
    let gazeJump = false;
    if (rig.head) {
      let look = AHEAD;
      if (p.lookAt && !walking) {
        rig.root.worldToLocal(s.v.set(p.lookAt[0], p.lookAt[1], p.lookAt[2]));
        look = lookAngles(s.v.x, s.v.y, s.v.z, rig.eyeY);
      }
      gazeJump = Math.abs(look.yaw - s.wantYaw) > GAZE_BLINK;
      s.wantYaw = look.yaw;
      s.yaw = damp(s.yaw, look.yaw, 2.2, dt);
      s.pitch = damp(s.pitch, look.pitch, 2.2, dt);
      const idleYaw = (1 - s.speak) * 0.012 * drift(s.now, seed, 9);
      const yaw = s.yaw + sway * 0.6 + idleYaw, pitch = s.pitch + nod * s.speak + sway * 0.4;
      premultiply(rig.neck, yaw * 0.4, pitch * 0.4);
      premultiply(rig.head, yaw * 0.6, pitch * 0.6);
      if (rig.eyes.length) {
        s.sacIn -= dt;
        if (s.sacIn <= 0) { const sc = saccade(Math.random(), Math.random()); s.sx = sc.x * 0.45; s.sy = sc.y * 0.45; s.sacIn = nextMicroSaccade(Math.random()); }
        const e = eyeAngles(look.yaw, s.yaw, look.pitch, s.pitch, walking ? 0 : s.sx, walking ? 0 : s.sy);
        // eyes move fast but not instantly (a saccade takes ~40 ms)
        s.eyeYaw = damp(s.eyeYaw, e.yaw, 24, dt);
        s.eyePitch = damp(s.eyePitch, e.pitch, 24, dt);
        for (const eye of rig.eyes) premultiply(eye, s.eyeYaw, s.eyePitch);
      }
    }

    // ── pupils: a touch wider in dim light, narrower in bright (slow, like the real reflex) ──
    s.lightIn -= dt;
    if (s.lightIn <= 0) { s.lightIn = 1; s.bright = sceneBrightness(scene, g); }
    s.pupil = damp(s.pupil, Math.min(0.2, Math.max(0.12, 0.215 - 0.025 * s.bright)), 1.2, dt);
    for (const pu of rig.pupils) pu.scale.setScalar(s.pupil);
    // the catchlight belongs to close-ups: full within 1.5 m of the camera, gone beyond 3.5 m
    const camD = camera.position.distanceTo(g.position);
    rig.cornea.envMapIntensity = 0.7 * Math.min(1, Math.max(0, (3.5 - camD) / 2));

    // ── the face: blinks, lids following the gaze, speech, micro-expressions, a soft listening smile ──
    if (rig.faces.length) {
      s.blinkIn -= dt;
      if (s.blinkIn <= 0 || (gazeJump && s.blinkT < 0)) { s.blinkT = 0; s.blinkIn = nextBlink(Math.random()); }
      let blink = def.face?.blink ?? 0;
      if (s.blinkT >= 0) {
        s.blinkT += dt;
        if (s.blinkT >= BLINK_TOTAL) s.blinkT = -1;
        else blink = Math.max(blink, blinkCurve(s.blinkT));
      }
      // the upper lids ride down with a lowered gaze (pitch > 0 = looking down)
      const lid = Math.min(0.3, Math.max(0, (s.eyePitch + s.pitch * 0.3) * 1.2));
      const lidL = Math.min(1, Math.max(blink, 0.04 + lid + 0.015 * drift(s.now, seed, 11)));
      const lidR = Math.min(1, Math.max(blink, 0.04 + lid + 0.015 * drift(s.now, seed, 12)));
      const m: Viseme = speaking && p.speech ? visemeAt(p.speech, s.talkT, s.vis) : Object.assign(s.vis, mouthAt(s.talkT, speaking, seed));
      const smileBase = speaking ? 0.14 : listening ? 0.26 : 0.1;
      const smileL = smileBase + 0.03 * drift(s.now, seed, 13), smileR = smileBase + 0.03 * drift(s.now, seed, 14);
      for (const f of rig.faces) {
        const d = f.morphTargetDictionary!, wt = f.morphTargetInfluences!;
        const set = (k2: string, val: number, rate: number) => { const i = d[k2]; if (i !== undefined) wt[i] = damp(wt[i], val, rate, dt); };
        // blinks are fast; mouth shapes follow speech at a natural rate; expressions drift slowly
        const bl = d.blinkL, br = d.blinkR;
        if (bl !== undefined) wt[bl] = s.blinkT >= 0 ? lidL : damp(wt[bl], lidL, 18, dt);
        if (br !== undefined) wt[br] = s.blinkT >= 0 ? lidR : damp(wt[br], lidR, 18, dt);
        set("aa", m.aa * 0.8, 20); set("oh", m.oh * 0.8, 20); set("ee", m.ee * 0.8, 20); set("pp", m.pp, 26); set("jawOpen", m.jawOpen * 0.8, 18);
        set("smileL", smileL, 3); set("smileR", smileR, 3);
      }
      // brows, cheeks, mouth corners: a millimetre or two of life; brows lift a little with each nod
      s.smileF = damp(s.smileF, smileBase, 3, dt);
      for (const fb of rig.faceBones) {
        const mm = fb.w.up * (0.45 * drift(s.now, seed, fb.w.ch) + (nod / 0.05) * 0.8 * s.speak) + (fb.w.smile ?? 0) * s.smileF * 2.2;
        fb.bone.position.copy(fb.rest).addScaledVector(fb.up, Math.max(-1.2, Math.min(2.2, mm)));
      }
    }
  });

  return (
    <group ref={group} position={props.position} rotation-y={props.rotation ?? 0}>
      {rig && <primitive object={rig.root} />}
    </group>
  );
}
