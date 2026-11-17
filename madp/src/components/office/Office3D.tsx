/** The 3D office (MADP Studio's office, ported to the Factory): a project's pipeline is a team in a
 *  room. React Three Fiber on the WebGL renderer (works in every browser). The brain is the Factory's
 *  pipeline state: fromPipeline.ts turns it into each character's station and pose; there is no LLM in
 *  this loop. "full" is the build screen's stage (camera controls, station signs, selectable agents);
 *  "compact" is the same office for small cards: no controls, no shadows, no signs, ~30 frames a second.
 *  With `follow`, the camera keeps every busy agent (with its name chip and bubble) in frame. The labels (bubbles,
 *  chips, signs) are placed by one screen-space pass so they never overlap (labels.ts). If the browser drops the
 *  WebGL context, the 2D floor plan stands in until the context is back, and the canvas is then rebuilt. */

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Color, Quaternion, Vector3, type AmbientLight, type DirectionalLight, type HemisphereLight } from "three";
import { ActivityContext, type StageActivity, wake } from "./activity";
import "./office.css";
import { CameraRig, type RigApi } from "./CameraRig";
import { Character } from "./Character";
import {
  CoffeeCorner, Desks, DocsDesk, LobbyBench, LockDoor, ReviewDesk, Room, SecurityLab, ShipGate, SignsVisible,
  TestBench, Whiteboard, type DocsState, type LabState, type Theme,
} from "./Furniture";
import { AgentFloor } from "./AgentFloor";
import { ambientSpots, useAmbientClock } from "./ambient";
import { closeDistanceFor, closeView, easeInOutCubic, FOCUS_MS } from "./focus";
import { peopleSource, setPeopleSource } from "./people/source";
import { PERSON_HEIGHT } from "./people/loader";
import { createRealisticPeopleSource } from "@/components/characters";
import { CENTRED_TARGET, STAGE_FOV, STUDIO_DISTANCE, STUDIO_HOME, frameSpots, homeFor, roomHome, type Home } from "./fit";
import { StationHotspots } from "./Hotspots";
import { LabelBoard, LabelContext, LabelLayout } from "./labels";
import { obstacles, spotFor, type Vec2 } from "./layout";
import type { AgentView, OfficeView } from "./model";
import { NavGrid } from "./nav";
import { useDarkTheme, useOfficeStage, useReducedMotion } from "./officeStore";
import { tokenColor } from "./palette";
import { agentStatusText } from "./roles";
import { useT } from "@/i18n";
import { StageControls, useStageHint } from "./StageControls";
import { Surroundings } from "./Surroundings";
import { SUN_AT, cssTriplet, surroundingsPalette } from "./surroundingsPalette";
import { mayRebuild } from "./retry";
import { type Governor, type Tier, TIERS, dprFor, dprRange, frameloopFor, governorSample, governorStart, initialTier, tickRate } from "./stagePerf";
import { hotspotsFor } from "./stations";
import { type ViewId, viewForKey, viewSpots } from "./views";
import { isCanvasClick } from "./missGuard";
import { dockReserve, useSheet } from "./dock";

// The office wears the same realistic Rocketbox cast as the cinematic journey (src/components/characters);
// the code-built figure stays the fallback while a person loads or if it fails.
setPeopleSource(createRealisticPeopleSource({ personHeight: PERSON_HEIGHT }));

export interface OfficeProps {
  view: OfficeView;
  /** full: the build-screen stage; compact: a small card */
  variant?: "compact" | "full";
  /** keep every busy agent in frame, easing the camera whenever the busy set changes */
  follow?: boolean;
  /** the build is paused: agents hold still at their stations, without bubbles */
  paused?: boolean;
  /** pixels a docked panel covers on the right edge; the home view keeps the stations clear of it */
  reserveRight?: number;
  /** pixels a header the host draws over the stage covers at the top; compact cards frame the room below it */
  reserveTop?: number;
  /** speech bubbles over working agents (compact cards whose host shows a caption turn them off) */
  bubbles?: boolean;
  height?: number | string;
  /** upper bound for the device pixel ratio (the dashboard keeps it light) */
  maxDpr?: number;
  /** agents are selectable and open the chat (full and compact) */
  chat?: boolean;
  /** compact cards without chat: a click on an agent opens the host's target (e.g. Build Studio) */
  onAgentOpen?: (agentId: string) => void;
}

/** how long the business analyst (role planner) shows "New task" at the whiteboard after a task is handed to it */
const CUE_MS = 4000;

/** compact cards: a pipeline of 8 stages shows 8 notes on the whiteboard once the plan is done */
const PLAN_NOTES = 8;
const COMPACT_DPR: [number, number] = [1, 1.25];

function useTheme(): Theme {
  const dark = useDarkTheme();
  return useMemo(() => {
    const hex = (n: string) => `#${tokenColor(n).getHexString()}`;
    return {
      dark,
      floor: dark ? "#2a2838" : "#ecebf5",
      rug: dark ? "#34314a" : "#dedbf0",
      wall: dark ? "#3a3752" : "#f7f6fc",
      wood: dark ? "#8a6f58" : "#c9a782",
      metal: dark ? "#5d5a78" : "#bdbbd0",
      desk: dark ? "#45426a" : "#ffffff",
      screenOff: "#101122",
      brand: hex("brand-500"),
      coral: hex("coral"),
      success: hex("success"),
      danger: hex("danger"),
      warning: hex("warning"),
      ink: hex("ink"),
    };
  }, [dark]);
}

function useInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setInView(last.isIntersecting);
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function usePageHidden() {
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

/** the stage's pixel size (null until measured); measured before the first paint */
function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s && Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** swallows the paused gap so the first resumed frame has no huge delta */
function ResumeClock({ active }: { active: boolean }) {
  const clock = useThree((s) => s.clock);
  useLayoutEffect(() => { if (active) clock.getDelta(); }, [active, clock]);
  return null;
}

/** The stage draws on demand and this paces it: every display frame while something moves (the camera, a walking
 *  agent: see activity.ts) or at 60 fps for a live build; `fps` frames a second otherwise (an idle floor's breathing);
 *  none with reduced motion. It feeds the quality governor the times between frames drawn back to back, and stamps
 *  `beat` with each frame so the stage notices a render loop that stopped. */
function Heartbeat({ active, fps, activity, beat, onFrameTime }: {
  active: boolean; fps: number; activity: StageActivity; beat: { current: number }; onFrameTime: (ms: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const last = useRef({ pos: new Vector3(Number.NaN, 0, 0), quat: new Quaternion(), at: 0, chained: false });
  useEffect(() => {
    if (!active) return;
    invalidate();
    if (fps <= 0 || fps >= 60) return;
    const id = setInterval(() => invalidate(), 1000 / fps);
    return () => clearInterval(id);
  }, [active, fps, invalidate]);
  useFrame(() => {
    const L = last.current;
    const now = performance.now();
    beat.current = now;
    if (!camera.position.equals(L.pos) || !camera.quaternion.equals(L.quat)) {
      L.pos.copy(camera.position);
      L.quat.copy(camera.quaternion);
      wake(activity, 250, now);
    }
    if (L.chained) onFrameTime(now - L.at);
    L.at = now;
    L.chained = active && (fps >= 60 || now < activity.until);
    if (L.chained) invalidate();
  });
  return null;
}

/** calls `onDone` once the browser is idle after the first frame drawn: the room shows before the people load */
function AfterFirstFrame({ onDone }: { onDone: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(onDone, { timeout: 800 });
    else setTimeout(onDone, 200);
  });
  return null;
}

/** The shadow map holds the furniture only (people stand on soft contact shadows), so it is drawn when something
 *  changes rather than every frame: on mount, a theme, size, quality or station change, and a moment later (late meshes). */
function ShadowBaker({ token }: { token: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    const bake = () => { gl.shadowMap.needsUpdate = true; invalidate(); };
    bake();
    const ids = [150, 600, 1500].map((ms) => setTimeout(bake, ms));
    return () => ids.forEach(clearTimeout);
  }, [gl, token, invalidate]);
  return null;
}

/** keeps one part of the scene from taking the whole floor down: a part that throws is left out */
class Contain extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn(`[office] ${this.props.name} left out of the 3D floor:`, e); }
  render() { return this.state.failed ? null : this.props.children; }
}

function deviceTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return initialTier({
    cores: nav.hardwareConcurrency || undefined, memoryGb: nav.deviceMemory, saveData: nav.connection?.saveData,
    coarse: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  });
}


/** with on-demand rendering (reduced motion) the label layout needs a few frames to place the chips:
 *  render a few times after mount, a resize or a view change */
function Settle({ active, token }: { active: boolean; token: string }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    invalidate();
    const ids = [250, 500, 750, 1000].map((ms) => setTimeout(() => invalidate(), ms));
    return () => ids.forEach(clearTimeout);
  }, [active, token, invalidate]);
  return null;
}

/** The compact cards' camera (no orbit controls): the home view, or eased towards the view that frames the
 *  busy agents; `focus` (a picked agent) wins and glides with a FOCUS_MS ease. Nothing is allocated per frame. */
function StaticCamera({ home, follow, focus, reducedMotion }: { home: Home; follow?: Home | null; focus?: Home | null; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const look = useRef(new Vector3(...home.target));
  const goal = useRef({
    pos: new Vector3(...home.position), target: new Vector3(...home.target), mode: 0 as 0 | 1 | 2, t: 0,
    fromPos: new Vector3(), fromTarget: new Vector3(),
  });
  const placed = useRef(false);
  const hadFocus = useRef(false);
  const view = focus ?? follow ?? home;
  useLayoutEffect(() => {
    const g = goal.current;
    g.pos.set(...view.position);
    g.target.set(...view.target);
    const focusChanged = Boolean(focus) !== hadFocus.current;
    hadFocus.current = Boolean(focus);
    if (!placed.current || reducedMotion) {
      camera.position.copy(g.pos);
      look.current.copy(g.target);
      camera.lookAt(look.current);
      camera.updateMatrixWorld();
      g.mode = 0;
      placed.current = true;
    } else if (focus || focusChanged) {
      g.fromPos.copy(camera.position);
      g.fromTarget.copy(look.current);
      g.t = 0;
      g.mode = 2;
    } else g.mode = 1;
    invalidate();
  }, [camera, view, focus, reducedMotion, invalidate]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (g.mode === 0) return;
    if (g.mode === 2) {
      g.t += Math.min(dt, 0.1) * 1000;
      const u = Math.min(1, g.t / FOCUS_MS);
      const e = easeInOutCubic(u);
      camera.position.lerpVectors(g.fromPos, g.pos, e);
      look.current.lerpVectors(g.fromTarget, g.target, e);
      if (u >= 1) g.mode = 0;
      camera.lookAt(look.current);
      return;
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    camera.position.lerp(g.pos, k);
    look.current.lerp(g.target, k);
    if (camera.position.distanceTo(g.pos) < 0.02 && look.current.distanceTo(g.target) < 0.02) {
      camera.position.copy(g.pos);
      look.current.copy(g.target);
      g.mode = 0;
    }
    camera.lookAt(look.current);
  });
  return null;
}

/** Day (light theme) or night (dark theme) lighting. Targets are built once per theme; the lights
 *  ease towards them in place, so nothing is allocated per frame. */
function DayNight({ theme, reducedMotion, shadows, mapSize = 2048 }: { theme: Theme; reducedMotion: boolean; shadows: boolean; mapSize?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const amb = useRef<AmbientLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const settled = useRef(false);
  const mounted = useRef(false);
  const t = useMemo(() => {
    const white = new Color("#ffffff");
    if (theme.dark) {
      return { amb: new Color("#ddd6ff"), ambI: 0.6, sky: new Color("#d8d0ff"), ground: new Color("#2a2440"), hemiI: 1.15, sun: white.clone().lerp(new Color(theme.brand), 0.3), sunI: 2.0 };
    }
    const warm = new Color(theme.warning);
    return { amb: white, ambI: 0.4, sky: white.clone().lerp(warm, 0.08), ground: new Color("#cfcbe6"), hemiI: 0.95, sun: white.clone().lerp(warm, 0.14), sunI: 1.7 };
  }, [theme.dark, theme.brand, theme.warning]);
  useLayoutEffect(() => {
    const a = amb.current, h = hemi.current, s = sun.current;
    if (!a || !h || !s) return;
    // the first mount and reduced motion apply the targets at once; later theme flips ease in useFrame
    if (!mounted.current || reducedMotion) {
      a.color.copy(t.amb); a.intensity = t.ambI;
      h.color.copy(t.sky); h.groundColor.copy(t.ground); h.intensity = t.hemiI;
      s.color.copy(t.sun); s.intensity = t.sunI;
      settled.current = true;
    } else settled.current = false;
    mounted.current = true;
  }, [t, reducedMotion]);
  // a new shadow-map size (quality tier): drop the old map so three allocates one at the new size
  useLayoutEffect(() => {
    const s = sun.current;
    if (s?.shadow.map) { s.shadow.map.dispose(); (s.shadow as { map: unknown }).map = null; }
  }, [mapSize]);
  useFrame((_, dt) => {
    const a = amb.current, h = hemi.current, s = sun.current;
    if (settled.current || !a || !h || !s) return;
    invalidate();
    const k = Math.min(1, dt * 2.5);
    a.color.lerp(t.amb, k); a.intensity += (t.ambI - a.intensity) * k;
    h.color.lerp(t.sky, k); h.groundColor.lerp(t.ground, k); h.intensity += (t.hemiI - h.intensity) * k;
    s.color.lerp(t.sun, k); s.intensity += (t.sunI - s.intensity) * k;
    const d = Math.abs(t.sunI - s.intensity) + Math.abs(t.hemiI - h.intensity) + Math.abs(t.ambI - a.intensity)
      + Math.abs(t.sun.r - s.color.r) + Math.abs(t.sun.g - s.color.g) + Math.abs(t.sun.b - s.color.b);
    if (d < 0.005) {
      a.color.copy(t.amb); a.intensity = t.ambI;
      h.color.copy(t.sky); h.groundColor.copy(t.ground); h.intensity = t.hemiI;
      s.color.copy(t.sun); s.intensity = t.sunI;
      settled.current = true;
    }
  });
  return (
    <>
      <ambientLight ref={amb} />
      <hemisphereLight ref={hemi} />
      <directionalLight ref={sun} position={[...SUN_AT]} castShadow={shadows} shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-left={-16} shadow-camera-right={18} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.0004} />
    </>
  );
}

const done = (a?: AgentView) => a?.status === "pass" || a?.status === "done";
const isBusy = (a: AgentView) => a.status === "working" || a.status === "waiting" || a.status === "returning";

export default function Office3D({ view, variant = "full", follow = false, paused = false, reserveRight = 0, reserveTop = 0, bubbles = true, height = "100%", maxDpr, chat = false, onAgentOpen }: OfficeProps) {
  const t = useT();
  const full = variant === "full";
  const pickable = full || chat || Boolean(onAgentOpen);
  const theme = useTheme();
  // the world around the office (Surroundings.tsx); its horizon and ground also colour the stage behind the canvas, so
  // the moment before the first frame and the floor plan of a lost WebGL context match it
  const surroundings = useMemo(() => surroundingsPalette(tokenColor, theme.dark), [theme.dark]);
  const envStyle = { "--env-horizon": cssTriplet(surroundings.horizon), "--env-ground": cssTriplet(surroundings.ground) } as CSSProperties;
  const reducedMotion = useReducedMotion();
  const [labels, setLabels] = useState(true);
  const board = useMemo(() => new LabelBoard(), []);
  useEffect(() => () => board.dispose(), [board]);
  // the WebGL context was lost: the floor plan stands in; a restored context rebuilds the canvas (a new key). Events
  // from a replaced canvas are ignored (its renderer is disposed with a forced context loss).
  const [lost, setLost] = useState(false);
  const [glKey, setGlKey] = useState(0);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  // a lost context the browser does not give back within a moment, or a render loop that stopped, rebuilds the canvas
  // (at most 3 times a minute; then the floor plan stays with a Retry)
  const rebuilds = useRef<number[]>([]);
  const [stuck, setStuck] = useState(false);
  const rebuild = useCallback((manual = false) => {
    const now = Date.now();
    if (manual) rebuilds.current = [];
    if (!mayRebuild(rebuilds.current, now)) { setLost(true); setStuck(true); return; }
    rebuilds.current.push(now);
    glCanvas.current = null;
    setStuck(false);
    setLost(false);
    setGlKey((k) => k + 1);
  }, []);
  useEffect(() => {
    if (!lost || stuck) return;
    const id = setTimeout(() => rebuild(), 2500);
    return () => clearTimeout(id);
  }, [lost, stuck, rebuild]);
  // what moves this frame (walking agents, the camera), the last frame's time, and the quality tier
  const activity = useMemo<StageActivity>(() => ({ until: 0 }), []);
  const beat = useRef(0);
  const [tier, setTier] = useState<Tier>(() => (full ? deviceTier() : Math.min(1, deviceTier()) as Tier));
  const governor = useRef<Governor | null>(null);
  const onFrameTime = useCallback((ms: number) => {
    const now = performance.now();
    const g0 = governor.current ?? (governor.current = governorStart(tier, now));
    const g = governorSample(g0, ms, now);
    if (g === g0) return;
    governor.current = g;
    if (g.tier !== g0.tier) setTier(g.tier);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const rig = useRef<RigApi | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hint = useStageHint();
  const selectedAgent = useOfficeStage((s) => (s.selected?.office === view.run ? s.selected.agent : null));
  // a picked agent's chat docks on the stage's right (a bottom sheet on phones): the camera, the controls and the
  // labels keep to the part left of it
  const sheet = useSheet();
  const right = Math.max(reserveRight, chat && selectedAgent && !sheet ? dockReserve(full ? "full" : "compact") : 0);
  const clearSelection = () => { const st = useOfficeStage.getState(); if (st.selected?.office === view.run) st.select(null); };
  useEffect(() => () => {
    const st = useOfficeStage.getState();
    if (st.selected?.office === view.run) st.select(null);
  }, [view.run]);
  useEffect(() => {
    if (!selectedAgent) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, view.run]);
  // the chat anchor: a stable callback ref for the drei Html at the selected agent's head
  const anchorRef = useCallback((el: HTMLDivElement | null) => useOfficeStage.getState().setAnchor(view.run, el), [view.run]);
  useEffect(() => { if (!selectedAgent) useOfficeStage.getState().setAnchor(view.run, null); }, [selectedAgent, view.run]);
  useEffect(() => () => useOfficeStage.getState().setAnchor(view.run, null), [view.run]);
  // the business analyst's "New task" cue at the whiteboard
  const cue = useOfficeStage((s) => (s.cue?.office === view.run ? s.cue : null));
  const [cueOn, setCueOn] = useState(false);
  useEffect(() => {
    if (!cue) return;
    const left = CUE_MS - (performance.now() - cue.at);
    if (left <= 0) { setCueOn(false); return; }
    setCueOn(true);
    const id = setTimeout(() => setCueOn(false), left);
    return () => clearTimeout(id);
  }, [cue]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!full || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") rig.current?.zoom(0.8);
    else if (e.key === "-" || e.key === "_") rig.current?.zoom(1.25);
    else if (e.key === "0") { rig.current?.reset(); setActiveView(null); }
    else if (viewForKey(e.key)) pickView(viewForKey(e.key) as ViewId);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { rig.current?.orbit(e.key === "ArrowLeft" ? -0.26 : 0.26, 0); setActiveView(null); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { rig.current?.orbit(0, e.key === "ArrowUp" ? -0.12 : 0.12); setActiveView(null); }
    else if (e.key === "Escape") { clearSelection(); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    hint.dismiss();
  };

  const agents = view.agents;
  const devs = agents.filter((a) => a.role === "dev");
  const deskCount = Math.min(12, Math.max(6, devs.length));

  // render budget: draw only while on screen and the tab is visible; compact cards at ~30 fps
  const inView = useInView(root);
  const hidden = usePageHidden();
  const loop = frameloopFor({ inView, hidden });
  const running = loop === "always";
  const range = (): [number, number] => { const r = dprRange(window.innerWidth); return maxDpr ? [Math.min(r[0], maxDpr), Math.min(r[1], maxDpr)] : r; };
  const demand = full && reducedMotion && running;
  const [screenRange, setScreenRange] = useState(range);
  useEffect(() => {
    if (!full) return;
    const on = () => setScreenRange((d) => { const n = range(); return n[0] === d[0] && n[1] === d[1] ? d : n; });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [full, maxDpr]); // eslint-disable-line react-hooks/exhaustive-deps
  const dpr = useMemo<[number, number]>(() => (full ? dprFor(tier, screenRange) : tier >= 1 ? COMPACT_DPR : [1, 1]), [full, tier, screenRange]);
  const tierSpec = TIERS[tier];
  const shadows = full && tierSpec.shadows;

  const live = (view.status === "running" || view.status === "waiting") && !paused;
  // every display frame while agents work; the idle floor's ambient rate otherwise (stagePerf.ts)
  const fps = tickRate({ live: !paused && agents.some(isBusy), reducedMotion, compact: !full });
  // a canvas that stopped drawing while it should (a hung driver, a wedged loop) is noticed and rebuilt; stale on two
  // checks in a row, so one long main-thread task does not count
  useEffect(() => {
    if (!running || lost || fps <= 0) return;
    let stale = 0;
    const id = setInterval(() => {
      const quiet = beat.current > 0 && performance.now() - beat.current > 4000;
      stale = quiet ? stale + 1 : 0;
      if (stale >= 2) { stale = 0; console.warn("[office] the 3D render loop stopped; rebuilding the canvas"); rebuild(); }
    }, 1500);
    return () => clearInterval(id);
  }, [running, lost, fps, rebuild]);
  const now = useAmbientClock(live && !reducedMotion && running);
  const ambient = useMemo(() => ambientSpots(view, now, reducedMotion), [view, now, reducedMotion]);
  const nav = useMemo(() => new NavGrid(obstacles(deskCount)), [deskCount]);
  // characters present when the office opens start at their stations; ones that join later walk in
  const [openedAt] = useState(() => performance.now());
  const initial = useMemo(() => new Set<string>(), []);
  if (performance.now() - openedAt < 1500) for (const a of agents) initial.add(a.id);

  // framing: the Studio's camera on stages its size, backed off on smaller ones; compact cards show the whole room,
  // centred below the host's header (see fit.ts)
  const size = useBoxSize(root);
  const home = useMemo<Home>(() => {
    const w = size?.w ?? 0, h = size?.h ?? 0;
    if (w < 16 || h < 16) return full ? STUDIO_HOME : roomHome({ width: 400, height: 240 });
    if (!full) return roomHome({ width: w, height: h, top: reserveTop });
    return homeFor({ width: w, height: h, target: right > 0 ? STUDIO_HOME.target : CENTRED_TARGET, right, minD: STUDIO_DISTANCE, maxD: 42 });
  }, [full, size?.w, size?.h, right, reserveTop]);
  // an agent's bubble while it is busy and the build runs (not on a phone-sized or very short stage, where the label
  // layout would have to hide most of them; the build page's progress says what is happening there)
  const narrow = full && ((size?.w ?? 0) < 640 || (size?.h ?? 0) < 400);
  const showBubbles = (full || bubbles) && !paused && !narrow;
  const hasBubble = (a?: AgentView) => Boolean(a && showBubbles && a.detail && (isBusy(a) || a.status === "fail"));
  // the canvas camera is created once, from the first measured home (later homes ease in via the rig)
  const [initialHome, setInitialHome] = useState<Home | null>(null);
  useLayoutEffect(() => { if (size && !initialHome) setInitialHome(home); }, [size, home, initialHome]);

  const planner = agents.find((a) => a.role === "planner");
  const reviewer = agents.find((a) => a.role === "reviewer");
  const qa = agents.filter((a) => a.role === "qa");
  const benchState: "idle" | "running" | "pass" | "fail" =
    qa.some((a) => a.status === "fail" || a.stageStatus === "sent-back") ? "fail" : qa.some((a) => a.status === "working") ? "running" : qa.length && qa.every((a) => done(a)) ? "pass" : "idle";
  const secops = agents.find((a) => a.role === "secops");
  const labState: LabState = !secops ? "idle" : secops.status === "fail" || secops.stageStatus === "sent-back" ? "fail"
    : secops.stageStatus === "blocked" ? "hold" : secops.status === "working" ? "scanning" : done(secops) ? "pass" : "idle";
  const docs = agents.find((a) => a.role === "docs");
  const docsState: DocsState = !docs ? "idle" : docs.stageStatus === "sent-back" ? "back" : docs.stageStatus === "blocked" ? "hold"
    : docs.status === "working" ? "writing" : done(docs) ? "done" : "idle";

  // following: frame every busy agent (the send-back's sender and the Developer fixing it included) with its
  // name chip and bubble, clear of the controls, the bottom edge and a host's header; home again when nobody is busy
  const busySpots = agents.filter(isBusy).map((a) => spotFor(a, agents));
  const busyKey = busySpots.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`).join("|");
  const followView = useMemo<Home | null | undefined>(() => {
    if (!follow) return undefined;
    if (!busySpots.length || !size || size.w < 16 || size.h < 16) return null;
    return full
      ? frameSpots({ width: size.w, height: size.h, spots: busySpots, minD: STUDIO_DISTANCE * 0.8, maxD: 42, labelUp: narrow ? 28 : 84, labelHalf: narrow ? 56 : 110, top: 64, bottom: narrow ? 120 : 84 })
      : frameSpots({ width: size.w, height: size.h, spots: busySpots, minD: 15, maxD: 60, labelUp: bubbles ? 70 : 28, labelHalf: bubbles ? 100 : 56, bottom: 44, top: reserveTop });
    // the key captures the busy spots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, full, bubbles, narrow, busyKey, size?.w, size?.h, reserveTop]);
  // a picked agent: the camera comes this close (further on short stages, so the name chips do not crowd it)
  const stageH = size?.h ?? 0;
  const focusDistance = Math.min(24, Math.max(14, stageH ? (14 * 560) / stageH : 14));
  // where the action is: free agents glance towards the furthest station at work
  const actionAgent = [...agents].reverse().find((a) => a.status === "working");
  const actionAt = actionAgent ? spotFor(actionAgent, agents) : undefined;
  const lookAt: Vec2 | null = actionAt ? { x: actionAt.x, z: actionAt.z } : null;

  // talking to an agent: the camera glides close (full: the rig; compact: a focus view); closing glides back
  const track = useMemo(() => new Map<string, Vec2>(), []);
  const [focusHome, setFocusHome] = useState<Home | null>(null);
  const latest = useRef({ agents, size, home, followView, right });
  latest.current = { agents, size, home, followView, right };
  const hadSelection = useRef(false);
  useEffect(() => {
    if (!chat) return;
    if (!selectedAgent) {
      if (!hadSelection.current) return;
      hadSelection.current = false;
      if (full) rig.current?.release(); else setFocusHome(null);
      return;
    }
    hadSelection.current = true;
    const { agents: list, size: sz, home: h0, followView: fv, right: dock } = latest.current;
    const agent = list.find((a) => a.id === selectedAgent);
    if (!agent) return;
    const at = track.get(`factory:${selectedAgent}`) ?? spotFor(agent, list);
    // the chat docks on the right: the agent sits in the middle of the part left of it
    const sideFrac = sz && sz.w >= 16 && dock > 0 ? Math.min(0.4, dock / 2 / sz.w) : 0;
    if (full) rig.current?.focusClose(at.x, at.z, sideFrac);
    else if (sz && sz.w >= 16 && sz.h >= 16) {
      setFocusHome(closeView({ at, from: fv ?? h0, distance: closeDistanceFor(sz.h), sideFrac, fov: STAGE_FOV, aspect: sz.w / sz.h }));
    }
  }, [selectedAgent, chat, full, track]);

  // only the cast in use is fetched, once, after the room's first frame; a failed load keeps the code-built body
  const [peopleOn, setPeopleOn] = useState(false);
  const roleKey = agents.map((a) => a.role).join(",");
  useEffect(() => {
    if (!peopleOn) return;
    peopleSource().prefetch(latest.current.agents);
  }, [roleKey, peopleOn]);
  const settleToken = `${size?.w}x${size?.h}|${home.position.join()}|${agents.map((a) => a.status).join()}|${view.run}`;
  const shadowToken = `${theme.dark}|${deskCount}|${tier}|${glKey}|${benchState}|${labState}|${docsState}|${view.gate}`;

  // a camera preset (keys 1-5 and the view chips): the overview is the home view, the others frame their stations
  const pickView = (id: ViewId) => {
    hint.dismiss();
    setActiveView(id);
    if (id === "overview" || !size || size.w < 16 || size.h < 16) { rig.current?.reset(); return; }
    rig.current?.view(frameSpots({ width: size.w, height: size.h, spots: viewSpots(id, deskCount), minD: 9, maxD: 42, labelUp: narrow ? 28 : 70, labelHalf: narrow ? 56 : 90, top: 64, bottom: narrow ? 120 : 84, right }));
  };
  // picking an agent (its body, or its station on the full stage)
  const pickAgent = (agentId: string, at: Vec2) => {
    if (onAgentOpen && !chat) onAgentOpen(agentId);
    else {
      useOfficeStage.getState().select({ office: view.run, agent: agentId });
      if (full && !chat) rig.current?.focus(at.x, at.z);
    }
    hint.dismiss();
  };
  const hotspots = useMemo(() => (full && pickable ? hotspotsFor(agents, deskCount) : []), [full, pickable, agents, deskCount]);

  return (
    <div ref={root} className={`fo-env-bg relative w-full overflow-hidden ${full ? "group isolate outline-none" : ""}`}
      {...(full ? {
        tabIndex: 0, role: "region", "aria-keyshortcuts": "+ - 0 1 2 3 4 5 ArrowLeft ArrowRight ArrowUp ArrowDown Escape", onKeyDown,
        "aria-label": t("studio.office.stage.label3d", "The factory in 3D. Drag to orbit, scroll to zoom, right-drag or shift-drag to pan. Plus and minus zoom, 0 resets the view, 1 to 5 pick a camera view, the arrow keys turn the view, Escape clears the selection."),
        onPointerDown: () => root.current?.focus({ preventScroll: true }),
      } : chat ? {
        role: "region", "aria-label": t("studio.office.stage.label3dChat", "The factory in 3D. Pick an agent in the Team list to talk to it."),
      } : { "aria-hidden": true })} style={{ height, ...envStyle }}>
      {initialHome && (
        <Canvas key={glKey} shadows={shadows} dpr={dpr} frameloop={running ? "demand" : "never"} onPointerMissed={full || chat ? (e) => { if (isCanvasClick(e)) clearSelection(); } : undefined}
          camera={{ position: [...initialHome.position], fov: STAGE_FOV, near: 0.5, far: 160 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: full }}
          onCreated={({ gl }) => {
            const el = gl.domElement;
            glCanvas.current = el;
            el.addEventListener("webglcontextlost", () => { if (glCanvas.current === el) setLost(true); });
            el.addEventListener("webglcontextrestored", () => {
              if (glCanvas.current !== el) return;
              glCanvas.current = null;
              setLost(false);
              setGlKey((k) => k + 1);
            });
          }}>
          <ResumeClock active={running} />
          {!peopleOn && <AfterFirstFrame onDone={() => setPeopleOn(true)} />}
          <Heartbeat active={running} fps={fps} activity={activity} beat={beat} onFrameTime={onFrameTime} />
          {shadows && <ShadowBaker token={shadowToken} />}
          {demand && <Settle active token={settleToken} />}
          {!full && <StaticCamera home={home} follow={followView} focus={focusHome} reducedMotion={reducedMotion} />}
          {full && <CameraRig apiRef={rig} home={home} reducedMotion={reducedMotion} follow={followView} focusDistance={focusDistance} closeDistance={closeDistanceFor(size?.h ?? 560)} />}
          {/* phone-sized stages leave the station signs out: the name chips already say who works where */}
          <ActivityContext.Provider value={activity}>
          <LabelContext.Provider value={board}>
            <SignsVisible.Provider value={full && labels && (size?.w ?? 0) >= 640}>
              <DayNight theme={theme} reducedMotion={reducedMotion} shadows={shadows} mapSize={tierSpec.shadowMapSize} />
              {/* the sky and the endless ground; the grid on the full stage above the lowest quality tier */}
              <Contain name="surroundings">
                <Surroundings palette={surroundings} reducedMotion={reducedMotion} grid={full && tier >= 1} />
              </Contain>
              <pointLight position={[-8, 3, -5]} intensity={(planner?.status === "working" || cueOn) && !paused ? 9 : 0} color={theme.brand} distance={8} />
              <Contain name="furniture">
              <Room theme={theme} />
              <Desks count={deskCount} theme={theme} active={Array.from({ length: deskCount }, (_, i) => devs[i]?.status === "working" && !paused)} />
              <Whiteboard theme={theme} active={(planner?.status === "working" || cueOn) && !paused} steps={done(planner) ? PLAN_NOTES : 0} done={done(planner)} />
              <ReviewDesk theme={theme} active={reviewer?.status === "working" && !paused} done={done(reviewer)} />
              <TestBench theme={theme} state={benchState} />
              <SecurityLab theme={theme} state={labState} />
              <DocsDesk theme={theme} state={docsState} />
              <LockDoor theme={theme} open={false} held={false} />
              <ShipGate theme={theme} state={view.gate} />
              <LobbyBench theme={theme} />
              <CoffeeCorner theme={theme} />
              </Contain>
              {hotspots.length > 0 && (
                <Contain name="stations">
                  <StationHotspots spots={hotspots} theme={theme} reducedMotion={reducedMotion} onPick={pickable ? pickAgent : undefined} />
                </Contain>
              )}

              {agents.map((a0, idx) => {
                // a task just handed over: the business analyst walks to the whiteboard and shows "New task"
                const cued = cueOn && !paused && a0.role === "planner";
                const a = cued ? { ...a0, status: "working" as const } : a0;
                const spot = cued ? spotFor(a, agents) : ambient.get(a.id) ?? spotFor(a, agents, 0);
                const busy = isBusy(a);
                // paused: the agent holds still at its station (an idle pose there), without a bubble
                const status = paused && (a.status === "working" || a.status === "returning") ? "idle" : a.status;
                const isSel = chat && selectedAgent === a.id;
                const castIndex = agents.slice(0, idx).filter((o) => o.role === a.role).length;
                return (
                  <Contain key={a.id} name={`${a.label} (${a.role})`}>
                  <Character people={peopleOn} id={`factory:${a.id}`} role={a.role} label={a.label} status={status}
                    spot={spot} nav={nav} reducedMotion={reducedMotion} from={initial.has(a.id) ? spot : undefined} dark={theme.dark}
                    lod={full ? "full" : "lite"} lookAt={status === "working" ? null : lookAt}
                    showLabel={full ? labels && (busy || !done(a)) : busy} selected={(full || chat) && selectedAgent === a.id} dim={!busy && a.status !== "fail"}
                    action={a.detail ?? agentStatusText(a)}
                    onSelect={pickable ? (at) => pickAgent(a.id, at) : undefined}
                    track={track} castIndex={castIndex} facing={isSel}
                    headSlot={isSel ? (
                      <Html zIndexRange={[45, 35]} style={{ pointerEvents: "none" }}><div ref={anchorRef} /></Html>
                    ) : undefined}
                    bubble={cued ? t("studio.office.stage.newTask", "New task") : hasBubble(a) ? a.detail : undefined} labelSize={full && !narrow ? "full" : "compact"}
                    bubbleTone={cued ? "info" : a.status === "fail" ? "danger" : a.status === "waiting" || a.status === "returning" ? "warning" : "info"} />
                  </Contain>
                );
              })}
            </SignsVisible.Provider>
          </LabelContext.Provider>
          </ActivityContext.Provider>
          <LabelLayout board={board} reducedMotion={reducedMotion} />
          {full && (
            <OrbitControls makeDefault target={[...initialHome.target]} enablePan enableZoom enableDamping
              onStart={() => { rig.current?.cancel(); hint.dismiss(); setActiveView(null); }}
              maxPolarAngle={Math.PI / 2.25} minPolarAngle={0.35} minDistance={9} maxDistance={42} />
          )}
        </Canvas>
      )}
      {lost && (
        <div className={`fo-env-bg absolute inset-0 z-[25] flex flex-col ${full ? "gap-2 p-4" : "p-2"}`}>
          {(full || stuck) && (
            <div role="status" className={`flex flex-wrap items-center gap-3 self-start rounded-block bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning-ink))] ${full ? "px-3 py-2 text-[12px]" : "mb-1 px-2 py-1 text-[11px]"}`}>
              {stuck ? t("studio.office.stage.driverResetting", "The graphics driver keeps resetting the 3D view; showing the floor plan.")
                : t("studio.office.stage.restarting", "The 3D view is restarting; showing the floor plan.")}
              {stuck && <button type="button" onClick={() => rebuild(true)} className="font-medium underline underline-offset-2">{t("studio.office.stage.retry3d", "Retry 3D")}</button>}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto"><AgentFloor view={view} dense={!full} fill={full} /></div>
        </div>
      )}
      {full && <div aria-hidden className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] opacity-0 ring-2 ring-inset ring-accent group-focus-visible:opacity-100" />}
      {/* beside a docked chat the controls sit left of it and the first-visit hint steps aside */}
      {full && !lost && <StageControls onZoomIn={() => { rig.current?.zoom(0.8); hint.dismiss(); }} onZoomOut={() => { rig.current?.zoom(1.25); hint.dismiss(); }}
        onReset={() => { rig.current?.reset(); setActiveView(null); hint.dismiss(); }} labels={labels} onToggleLabels={() => { setLabels((v) => !v); hint.dismiss(); }}
        hint={right > 0 ? "hidden" : hint.state} right={right} view={activeView} onView={pickView} />}
    </div>
  );
}
