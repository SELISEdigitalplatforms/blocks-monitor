/** The office. The look: an environment map rendered once from light panels (nothing downloaded), a hemisphere and a key
 *  light, the guides' own lights, emissive strips for the high-tech lines, a contact shadow under the guides. Runs
 *  without a dedicated GPU: static parts are instanced, shaders and textures are warmed before use, and
 *  - resolution: the device's DPR (max 1.5), dropping to 75 % / 60 % only while frames take longer than 20 ms;
 *  - frames: frameloop="demand": every frame while anything moves (walks, speech, typing, cards, pointer); still for a
 *    few seconds, a calm IDLE_FPS so the guides keep breathing; nothing while the tab is hidden. */
import { memo, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { Office } from "./Office";
import { PortraitCapture } from "./Portrait";
import { OfficeCast } from "./OfficeCast";
import { CameraRig } from "./CameraRig";
import { Fps } from "./Fps";
import { useJourney } from "../journey/store";
import { STAGES, type StageId } from "../journey/places";
import { GuideLights } from "../../characters/agents/GuideLights";
import { useChat } from "../visit/chat";
import { useOfficeScene } from "../visit/scene";

const IDLE_PAUSE_MS = 6000;
/** frames a second while nothing happens: the people breathe, blink and glance, at a fraction of the cost */
const IDLE_FPS = 20;

/** The office visit is busy while someone walks, types or talks, or you type. */
function officeBusy(): boolean {
  const c = useChat.getState();
  const j = useJourney.getState();
  return j.phase !== "journey" || j.walk !== null || c.typing !== null || c.streaming !== null || c.busy !== null || c.youTyping;
}

/** Drives the demand loop: busy → every frame; still for IDLE_PAUSE_MS → IDLE_FPS; a hidden tab → nothing. */
function Animator() {
  const invalidate = useThree((s) => s.invalidate);
  const lastBusy = useRef(performance.now());
  const idle = useRef(0);
  useEffect(() => {
    const poke = () => { lastBusy.current = performance.now(); invalidate(); };
    window.addEventListener("pointermove", poke, { passive: true });
    window.addEventListener("keydown", poke);
    window.addEventListener("cine:busy", poke);
    document.addEventListener("visibilitychange", poke);
    const unsub = useJourney.subscribe(poke);
    const unsubChat = useChat.subscribe(poke);
    const unsubScene = useOfficeScene.subscribe(poke);
    return () => {
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("keydown", poke);
      window.removeEventListener("cine:busy", poke);
      document.removeEventListener("visibilitychange", poke);
      unsub();
      unsubChat();
      unsubScene();
      window.clearTimeout(idle.current);
    };
  }, [invalidate]);
  useFrame(() => {
    const s = useJourney.getState();
    const busy = useOfficeScene.getState().office ? officeBusy()
      : s.phase !== "journey" || s.walk !== null || s.thinking !== null || s.speaking !== null || s.ask === null || s.reading || s.autotype !== null;
    const now = performance.now();
    if (busy) lastBusy.current = now;
    if (document.hidden) return;
    if (now - lastBusy.current < IDLE_PAUSE_MS) invalidate();
    else {
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(invalidate, 1000 / IDLE_FPS);
    }
  });
  return null;
}

/** Frame times while someone walks (a visit's walk between places), kept per walk for the checks and ?debug:
 *  window.__walkPerf = [{ frames, avg, p95, max, over16, over33 }] (ms). Nothing is recorded while nobody walks. */
function WalkProbe() {
  const acc = useRef<{ start: number; last: number; times: number[]; calls: number; slow: number[] } | null>(null);
  const gl = useThree((s) => s.gl);
  // the previous frame's draw calls, read just before Warmup resets the counters
  useFrame(() => { if (acc.current) acc.current.calls = Math.max(acc.current.calls, gl.info.render.calls); }, -1001);
  useFrame(() => {
    const walking = useJourney.getState().walk !== null;
    const now = performance.now();
    if (walking) {
      if (!acc.current) acc.current = { start: now, last: now, times: [], calls: 0, slow: [] };
      else {
        const dt = now - acc.current.last;
        acc.current.times.push(dt);
        // when the slow frames happen (ms into the walk), to find their cause
        if (dt > 33.4) acc.current.slow.push(Math.round(now - acc.current.start));
        acc.current.last = now;
      }
      return;
    }
    const a = acc.current;
    if (!a) return;
    acc.current = null;
    const t = a.times.slice().sort((x, y) => x - y);
    if (!t.length) return;
    const r = (v: number) => Math.round(v * 10) / 10;
    const box = window as unknown as { __walkPerf?: unknown[] };
    (box.__walkPerf ??= []).push({
      frames: t.length, avg: r(t.reduce((x, y) => x + y, 0) / t.length), p95: r(t[Math.floor(t.length * 0.95)]), max: r(t[t.length - 1]),
      over16: t.filter((v) => v > 17.5).length, over33: t.filter((v) => v > 33.4).length, maxCalls: a.calls, slowAt: a.slow,
    });
  });
  return null;
}

/** Dynamic resolution, a safety net for weak devices only: the device's DPR (capped at 1.5, as before) drops to 75 % and
 *  60 % while the average frame takes over 20 ms, and comes back after 3 s under 13 ms. */
function DynamicResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const acc = useRef({ t: 0, n: 0, good: 0, level: 0, last: 0 });
  const base = Math.min(window.devicePixelRatio || 1, 1.5);
  const LEVELS = [base, base * 0.75, base * 0.6];
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    const dt = a.last ? now - a.last : 16.7;
    a.last = now;
    if (dt > 250) return; // a pause (demand loop), not a slow frame
    a.t += dt;
    a.n++;
    if (a.t < 1000) return;
    const avg = a.t / a.n;
    a.t = 0;
    a.n = 0;
    if (avg > 20 && a.level < LEVELS.length - 1) { a.level++; a.good = 0; setDpr(LEVELS[a.level]); }
    else if (avg < 13 && a.level > 0) { if (++a.good >= 3) { a.level--; a.good = 0; setDpr(LEVELS[a.level]); } }
    else a.good = 0;
  });
  return null;
}

/** Where the guides' light and contact shadow centre: in the office visit the person the visitor talks to (their face
 *  lit from the visitor's side), otherwise between the two guides. */
function centreOf(stage: StageId): [number, number] {
  const r = STAGES[stage];
  const o = useOfficeScene.getState();
  if (o.office) return [r[o.focus].at[0], r[o.focus].at[2]];
  return [(r.assistant.at[0] + r.pm.at[0]) / 2, (r.assistant.at[2] + r.pm.at[2]) / 2];
}

/** The contact shadow under the guides, as before; it follows the pair at the place in use. It is re-rendered only
 *  while the guides walk (and a moment after); standing, its last frame stays: the same picture without a depth pass
 *  and two blur passes every frame. */
function Shadows() {
  const ref = useRef<import("three").Group>(null);
  const stage = useJourney((s) => s.stage);
  const walk = useJourney((s) => s.walk);
  const pmN = useJourney((s) => s.pm.joinN);
  const phase = useJourney((s) => s.phase);
  const [live, setLive] = useState(true);
  useEffect(() => {
    setLive(true);
    if (walk) return;
    // the guides finish their walk (and the PM his entrance) a few seconds after the visitor's walk ends
    const t = window.setTimeout(() => setLive(false), 7000);
    return () => window.clearTimeout(t);
  }, [walk, pmN, phase, stage]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const [cx, cz] = centreOf(stage);
    const k = Math.min(1, dt * 1.2);
    g.position.x += (cx - g.position.x) * k;
    g.position.z += (cz - g.position.z) * k;
  });
  // the office visit's escort: no shadow pass at all while people walk (it is drawn again, once, on arrival)
  const office = useOfficeScene((s) => s.office);
  if (office && walk) return null;
  return (
    <group ref={ref} position={[(STAGES.reception.assistant.at[0] + STAGES.reception.pm.at[0]) / 2, 0.005, 0]}>
      <ContactShadows key={live ? "live" : "still"} frames={live ? Infinity : 1} scale={[7, 5]} resolution={256} blur={1.6} opacity={0.62} far={1.1} color="#141a28" />
    </group>
  );
}

/** T2's guide lights (warm key, cool fill, rim, no shadows, short range), centred on the guides of the place in use. */
function RoomGuideLights() {
  const ref = useRef<import("three").Group>(null);
  const stage = useJourney((s) => s.stage);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const [cx, cz] = centreOf(stage);
    const k = Math.min(1, dt * 1.2);
    g.position.x += (cx - g.position.x) * k;
    g.position.z += (cz + 0.2 - g.position.z) * k;
    // the key and the fill face the person you talk to (the guide lights are set up facing +z)
    const o = useOfficeScene.getState();
    const yaw = o.office ? STAGES[stage][o.focus].yaw : 0;
    g.rotation.y += (yaw - g.rotation.y) * k;
  });
  return (
    <group ref={ref} position={[(STAGES.reception.assistant.at[0] + STAGES.reception.pm.at[0]) / 2, 0, 0]}>
      <GuideLights />
    </group>
  );
}

const DEBUG = new URLSearchParams(window.location.search).has("debug");

/** A software renderer (no GPU at all: SwiftShader, llvmpipe…) gets no multisampling; every GPU keeps it. */
const SOFTWARE = (() => {
  try {
    const g = document.createElement("canvas").getContext("webgl2");
    const d = g?.getExtension("WEBGL_debug_renderer_info");
    const name = d ? String(g!.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "";
    g?.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(name);
  } catch {
    return false;
  }
})();

function World() {
  return (
    <Canvas
      frameloop="demand"
      dpr={Math.min(window.devicePixelRatio || 1, 1.5)}
      resize={{ offsetSize: true }}
      gl={{ antialias: !SOFTWARE, powerPreference: "default", toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, stencil: false }}
      camera={{ fov: 50, near: 0.05, far: 60, position: [0.8, 1.72, 7.6] }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#eef0f4"]} />
      <fog attach="fog" args={["#eef0f4", 18, 46]} />
      {/* ambient + ONE key light; the environment (once) gives the guides and the metal their soft studio light */}
      {/* a softer sky fill and a warmer key: form on faces and furniture instead of a flat white room */}
      <hemisphereLight args={["#ffffff", "#c3c9d6", 1.12]} />
      <directionalLight position={[6, 9, 6]} intensity={1.55} color="#fff3e2" />
      <Environment frames={1} resolution={128}>
        <color attach="background" args={["#d9dee8"]} />
        <Lightformer intensity={3.2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[16, 8, 1]} />
        <Lightformer intensity={1.6} position={[-6, 2.5, 5]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer intensity={1.4} color="#fff1e0" position={[0, 2.5, 8]} rotation-y={Math.PI} scale={[14, 3, 1]} />
        <Lightformer intensity={0.9} color="#9db4ff" position={[6, 2, -4]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
      </Environment>
      <RoomGuideLights />
      <Suspense fallback={null}>
        <Office />
      </Suspense>
      <OfficeCast />
      <Shadows />
      <CameraRig />
      <PortraitCapture />
      <Animator />
      <DynamicResolution />
      <WalkProbe />
      {DEBUG && <Fps />}
      <Warmup />
    </Canvas>
  );
}

/** Shaders and textures are made ready before they are seen: while the intro is up, compile every material of the
 *  (fully mounted) floor and the guides and upload every texture, so no moment of the visit stalls on a first use.
 *  Also keeps the renderer's counters per frame (for the ?debug / probe readouts). */
function Warmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useFrame(() => { gl.info.autoReset = false; gl.info.reset(); }, -1000);
  useEffect(() => {
    let alive = true;
    const seen = new WeakSet<object>();
    const warm = () => {
      if (!alive) return;
      const r = gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> };
      const done = r.compileAsync ? r.compileAsync(scene, camera) : Promise.resolve(gl.compile(scene, camera));
      void done.then(() => {
        scene.traverse((o) => {
          const m = (o as unknown as { material?: { map?: object | null } | { map?: object | null }[] }).material;
          for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
            const t = mat.map as unknown as Parameters<typeof gl.initTexture>[0] | null | undefined;
            if (t && !seen.has(t)) { seen.add(t); gl.initTexture(t); }
          }
        });
      }).catch(() => undefined);
    };
    // during the intro only (the visitor is reading the welcome): never in the middle of the visit
    const ids = [400, 1500].map((ms) => window.setTimeout(() => { if (useJourney.getState().phase === "intro") warm(); }, ms));
    return () => { alive = false; ids.forEach((i) => window.clearTimeout(i)); };
  }, [gl, scene, camera]);
  return null;
}

export default memo(World);
