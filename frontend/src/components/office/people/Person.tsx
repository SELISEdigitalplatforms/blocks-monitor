/** One GLB office person for Character.tsx: the cast model (loaded once, cloned per agent), one AnimationMixer with
 *  0.25 s cross-fades, and the clip chosen from what the agent does (see clips.ts). It reports ready only after its
 *  shaders are compiled and a slot in the shared reveal queue (one swap per animation frame) has come up, so swapping
 *  the whole cast never makes a long frame. Until then the caller keeps the code-built character on screen. */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type AnimationAction, type AnimationMixer, Group, LoopOnce, LoopRepeat, type Object3D, type WebGLRenderer } from "three";
import type { AgentStatus } from "../model";
import { hashOf } from "../palette";
import { CROSSFADE_S, type ClipKey, clipKeyFor, clipName, greetsOn, nextIdleSwap, walkTimeScale } from "./clips";
import { type LoadedPerson, type PersonInstance, instancePerson, loadPerson, peekPerson } from "./loader";
import type { PersonModel } from "./manifest";
import type { PersonSlotProps } from "./source";

export type { PersonMotion } from "./source";

/** the slot contract (source.ts); onReady gets the loaded person (its headY places the labels) */
export type PersonProps = PersonSlotProps<PersonModel>;

/** the one pose shown per state with reduced motion (seconds into the clip) */
const POSE_TIME = 0.4;

// ── reveal queue: one swap per animation frame ──
const queue: Array<() => void> = [];
let pumping = false;
function pump() {
  const next = queue.shift();
  if (next) next();
  if (queue.length) requestAnimationFrame(pump);
  else pumping = false;
}
/** takes a slot; resolves in a later animation frame. The returned function cancels it. */
function takeSlot(run: () => void): () => void {
  queue.push(run);
  if (!pumping) {
    pumping = true;
    requestAnimationFrame(pump);
  }
  return () => {
    const i = queue.indexOf(run);
    if (i >= 0) queue.splice(i, 1);
  };
}

/** small seeded random (mulberry32), so each person's idle swaps are their own but repeatable */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Live {
  inst: PersonInstance | null;
  loaded: LoadedPerson | null;
  ready: boolean;
  mixer: AnimationMixer | null;
  action: AnimationAction | null;
  key: string | null;
  greeting: boolean;
  alt: boolean;
  swapIn: number;
  prevStatus: AgentStatus | null;
  prevFacing: boolean;
  rand: () => number;
}

export function Person({ model, id, status, ghost, reducedMotion, facing = false, motion, onReady }: PersonProps) {
  const group = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const live = useRef<Live>({
    inst: null, loaded: null, ready: false, mixer: null, action: null, key: null, greeting: false, alt: false, swapIn: 0,
    prevStatus: null, prevFacing: false, rand: seeded(hashOf(id)),
  });
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const statusRef = useRef(status);
  statusRef.current = status;

  // greet once on pass / done, and when the chat turns to face the camera
  useEffect(() => {
    const L = live.current;
    if (!reducedMotion && greetsOn(L.prevStatus, status)) {
      L.greeting = true;
      L.key = null;
    }
    L.prevStatus = status;
  }, [status, reducedMotion]);
  useEffect(() => {
    const L = live.current;
    if (!reducedMotion && facing && !L.prevFacing) {
      L.greeting = true;
      L.key = null;
    }
    L.prevFacing = facing;
  }, [facing, reducedMotion]);

  // load → instance → compile → wait for a reveal slot → show
  useEffect(() => {
    const L = live.current;
    let alive = true;
    let cancelSlot: (() => void) | null = null;
    let onFinished: ((e: { action: AnimationAction }) => void) | null = null;
    L.ready = false;
    L.key = null;
    L.action = null;
    (async () => {
      let loaded = peekPerson(model.id);
      if (!loaded) {
        try {
          loaded = await loadPerson(model);
        } catch {
          return; // the code-built character stays
        }
      }
      if (!alive) return;
      const inst = instancePerson(loaded, { ghost: Boolean(ghost) });
      L.inst = inst;
      L.loaded = loaded;
      L.mixer = inst.mixer;
      onFinished = (e) => {
        if (e.action === L.action && L.greeting) {
          L.greeting = false;
          L.key = null;
          invalidate();
        }
      };
      inst.mixer.addEventListener("finished", onFinished as never);
      try {
        const r = gl as WebGLRenderer & { compileAsync?: (o: Object3D, c: typeof camera, s?: Object3D) => Promise<unknown> };
        // compileAsync only helps (and only stays quiet) with parallel shader compilation; otherwise compile at once
        if (r.compileAsync && r.extensions.has("KHR_parallel_shader_compile")) await r.compileAsync(inst.root, camera, scene);
        else r.compile(inst.root, camera);
      } catch {
        /* a failed pre-compile only costs a hitch on the first frame */
      }
      if (!alive) return;
      cancelSlot = takeSlot(() => {
        cancelSlot = null;
        if (!alive) return;
        group.current?.add(inst.root);
        L.ready = true;
        L.swapIn = nextIdleSwap(L.rand());
        onReadyRef.current(loaded as LoadedPerson);
        invalidate();
      });
    })();
    return () => {
      alive = false;
      cancelSlot?.();
      L.ready = false;
      if (L.inst) {
        if (onFinished) L.inst.mixer.removeEventListener("finished", onFinished as never);
        L.inst.root.parent?.remove(L.inst.root);
        L.inst.dispose();
      }
      L.inst = null;
      L.loaded = null;
      L.mixer = null;
      L.action = null;
    };
  }, [model, ghost]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dtRaw) => {
    const L = live.current;
    const inst = L.inst;
    const loaded = L.loaded;
    if (!L.ready || !inst || !loaded) return;
    const reduced = reducedRef.current;
    const dt = Math.min(dtRaw, 0.1);
    const m = motion.current;

    // idle alternation (family A): swap Idle / Idle_Neutral every 8-14 s so the floor never looks frozen
    if (!reduced && model.family === "A") {
      L.swapIn -= dt;
      if (L.swapIn <= 0) {
        L.alt = !L.alt;
        L.swapIn = nextIdleSwap(L.rand());
      }
    }

    let key: ClipKey = clipKeyFor({ status: statusRef.current, moving: m.moving, seated: m.seated, greeting: L.greeting && !m.moving && !reduced }, model.family);
    if ((key === "idle" || key === "idleAlt") && model.family === "A") key = L.alt && !reduced ? "idleAlt" : "idle";
    if (key !== L.key) {
      L.key = key;
      play(L, inst, loaded, model, key, m.speed, reduced);
    }
    if (!reduced) inst.mixer.update(dt);
  });

  return <group ref={group} />;
}

function play(L: Live, inst: PersonInstance, loaded: LoadedPerson, model: PersonModel, key: ClipKey, speed: number, reduced: boolean) {
  let name = clipName(model, key);
  if (!loaded.clipNames.has(name)) name = clipName(model, "idle");
  const act = inst.action(name);
  if (!act) return;
  const prev = L.action;
  if (act === prev && key !== "greet") return;
  if (key === "greet") {
    act.setLoop(LoopOnce, 1);
    act.clampWhenFinished = true;
  } else {
    act.setLoop(LoopRepeat, Infinity);
    act.clampWhenFinished = false;
  }
  act.setEffectiveTimeScale(key === "walk" ? walkTimeScale(speed, loaded.height, model.family) : 1);
  act.reset();
  L.action = act;
  if (reduced || !prev) {
    if (prev && prev !== act) prev.stop();
    act.setEffectiveWeight(1);
    act.play();
    if (reduced) inst.mixer.setTime(POSE_TIME);
  } else if (prev === act) {
    act.play();
  } else {
    act.play();
    prev.crossFadeTo(act, CROSSFADE_S, false);
  }
}
