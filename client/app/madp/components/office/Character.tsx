/** One agent as a stylised, human-proportioned 3D person built in code (no third-party assets): about
 *  6.5 heads tall with a neck, shoulders, a shaped torso, two-part arms and legs, hands and shoes, a face
 *  that blinks and shows the agent's state (focused at work, smiling when done, concerned when blocked),
 *  a hair style, skin tone and outfit per role (see humanKit.ts). It walks its A* path to the station its
 *  status asks for, then acts there: sits and types, writes on the whiteboard, waits tapping a foot,
 *  slumps on a failure, cheers on a pass, and glances towards the action while it is free.
 *  Ported from MADP Studio; the Factory adds the SecOps and Docs looks and the "returning" state
 *  (work sent back: the agent walks back to its station). */

import { Html, useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Color, type Group, type Mesh } from "three";
import { mover, STOPPED, stepMover } from "@/madp/components/characters/gait";
import { ActivityContext, wake } from "./activity";
import { PERSON_HEIGHT } from "./people/loader";
import "./people/quaternius";
import { type PersonReady, peopleSource } from "./people/source";
import type { PersonMotion } from "./people/source";
import type { AgentStatus, Role } from "./model";
import type { Pose, Spot, Vec2 } from "./layout";
import { SPAWN } from "./layout";
import type { NavGrid } from "./nav";
import { LABEL_ANCHOR_Y } from "./fit";
import { GEAR, gearMaterial } from "./gear";
import { BODY, blobMaterial, catchlightMaterial, chestZ, kit, lookFor, surface, type Lod } from "./humanKit";
import { LABEL_CLASS, RANK, useLabel } from "./labels";
import { hashOf, roleColor, tokenColor } from "./palette";

/** cruising pace (world units = metres per second): a natural office walk; people speed up to it and slow down from it
 *  (src/components/characters/gait.ts), and the realistic people's walk clip plays at the matching rate */
const SPEED = 1.5;
const WHITE = new Color(1, 1, 1);
/** walk cycle of the code-built figure: radians of stride phase per metre walked (so the feet do not slide) */
const STRIDE_PER_METRE = 9 / 2.1;

export interface CharacterProps {
  /** load the GLB person (the stage turns this on after its first frame, so the room shows first) */
  people?: boolean;
  id: string;
  role: Role;
  label: string;
  status: AgentStatus;
  spot: Spot;
  nav: NavGrid;
  bubble?: string;
  bubbleTone?: "info" | "danger" | "warning";
  ghost?: boolean;
  reducedMotion: boolean;
  /** start position (ghosts appear in place) */
  from?: Vec2;
  /** show the name chip (default true); false hides it */
  showLabel?: boolean;
  /** draw the selection highlight (default false) */
  selected?: boolean;
  /** current action text for the hover label */
  action?: string;
  /** makes the character interactive; called with its current floor position on click */
  onSelect?: (at: Vec2) => void;
  /** the name chip and bubble, drawn at a fixed screen size: "full" on the build stage, "compact" on small cards */
  labelSize?: "full" | "compact";
  /** the agent is free (idle or done): its name chip steps back and gives way to the busy agents' labels */
  dim?: boolean;
  /** the app theme; role colours are re-read when it flips */
  dark?: boolean;
  /** level of detail: "full" for the build-screen stage, "lite" for small cards */
  lod?: Lod;
  /** where the action is (the station at work); a free agent glances towards it */
  lookAt?: Vec2 | null;
  /** index among agents of the same role (casting) */
  castIndex?: number;
  /** chat mode and selected: when not walking, turn to face the camera; play the greet clip once when this turns true */
  facing?: boolean;
  /** rendered inside the root group at the head anchor (just above the person's head), e.g. the chat bubble's anchor */
  headSlot?: ReactNode;
  /** written every frame: track.set(id, currentFloorPos) (no allocation; the same Vec2 object) */
  track?: Map<string, Vec2>;
}

const INK = "#1f2133";
const STEEL = "#dfe3ee";
const PAGES = "#f4efe2";
const BOOK = "#8a3442";
const WHITE_EYE = "#f7f5f2";
const PUPIL = "#0d0b10";
const SHIRT_WHITE = "#f4f4f7";
const DARK_TEE = "#3a3e50";

const hexOf = (c: Color) => `#${c.getHexString()}`;

/** the old Studio head gear for the roles the Factory does not field (fix-up, integrator, autopilot),
 *  drawn at the old head's scale and offsets (the caller scales it onto the new head) */
function LegacyGear({ role, color, accent, lampHex, ghost }: { role: Role; color: string; accent: string; lampHex: string; ghost?: boolean }) {
  const g = { ghost };
  switch (role) {
    case "fixup":
      return (
        <group position={[0, 1.44, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} geometry={GEAR.headlampBand} material={gearMaterial(color, g)} dispose={null} />
          <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} geometry={GEAR.lamp} material={gearMaterial(lampHex, { ghost, emissive: true })} dispose={null} />
        </group>
      );
    case "integrator":
      return (
        <group position={[0, 1.5, 0]}>
          <mesh geometry={GEAR.hardHat} material={gearMaterial(color, g)} dispose={null} castShadow />
          <mesh position={[0, 0, 0.05]} geometry={GEAR.hatBrim} material={gearMaterial(color, g)} dispose={null} />
        </group>
      );
    case "autopilot":
      return (
        <group position={[0, 1.62, 0]}>
          <mesh geometry={GEAR.marker} material={gearMaterial("#9aa0b4", g)} dispose={null} />
          <mesh position={[0, 0.1, 0]} geometry={GEAR.pompom} material={gearMaterial(accent, { ghost, emissive: true })} dispose={null} />
        </group>
      );
    default:
      return null;
  }
}

const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-[rgb(var(--brand-500))]", waiting: "bg-[rgb(var(--warning))]", returning: "bg-[rgb(var(--warning))]",
  fail: "bg-[rgb(var(--danger))]", pass: "bg-[rgb(var(--success))]", done: "bg-[rgb(var(--ink-3))]",
  queued: "bg-[rgb(var(--ink-3))]", idle: "bg-[rgb(var(--ink-3))]",
};

/** joint targets for one frame (one object per character, reused every frame) */
interface Targets {
  hy: number; hz: number; hrx: number; hry: number; hrz: number;
  srx: number; sry: number; srz: number;
  nrx: number; nry: number; nrz: number;
  lsx: number; lsz: number; rsx: number; rsz: number; lel: number; rel: number;
  ltx: number; rtx: number; lkn: number; rkn: number; lft: number; rft: number;
  breath: number;
  eye: number; brow: number; browUp: number; curve: number; width: number; open: number;
}
const targets = (): Targets => ({
  hy: BODY.hipY, hz: 0, hrx: 0, hry: 0, hrz: 0, srx: 0, sry: 0, srz: 0, nrx: 0, nry: 0, nrz: 0,
  lsx: 0, lsz: 0, rsx: 0, rsz: 0, lel: 0, rel: 0, ltx: 0, rtx: 0, lkn: 0, rkn: 0, lft: 0, rft: 0, breath: 1,
  eye: 1, brow: 0, browUp: 0, curve: -0.4, width: 1, open: 0,
});

export function Character({ people = true, id, role, label, status, spot, nav, bubble, bubbleTone = "info", ghost, reducedMotion, from, showLabel = true, selected = false, action, onSelect, labelSize = "full", dim = false, dark = false, lod = "full", lookAt, castIndex, facing = false, headSlot, track }: CharacterProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && Boolean(onSelect));
  const activity = useContext(ActivityContext);
  useEffect(() => {
    if (!onSelect) setHovered(false);
  }, [onSelect]);
  // the GLB person for this role; the code-built body stays until it has loaded (and for roles without a cast)
  const source = peopleSource();
  const model = useMemo(() => source.castFor(role, castIndex ?? 0), [source, role, castIndex]);
  const [person, setPerson] = useState<PersonReady | null>(null);
  const personRef = useRef<PersonReady | null>(null);
  personRef.current = person;
  useEffect(() => {
    setPerson(null);
  }, [model]);
  const motion = useRef<PersonMotion>({ moving: false, speed: 0, seated: false, turning: false });
  const selRing = useRef<Mesh>(null);
  const root = useRef<Group>(null);
  const hips = useRef<Group>(null);
  const spine = useRef<Group>(null);
  const chest = useRef<Group>(null);
  const head = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const browL = useRef<Group>(null);
  const browR = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const mouthOpen = useRef<Mesh>(null);
  const shL = useRef<Group>(null);
  const shR = useRef<Group>(null);
  const elL = useRef<Group>(null);
  const elR = useRef<Group>(null);
  const thL = useRef<Group>(null);
  const thR = useRef<Group>(null);
  const knL = useRef<Group>(null);
  const knR = useRef<Group>(null);
  const ftL = useRef<Group>(null);
  const ftR = useRef<Group>(null);
  const blob = useRef<Mesh>(null);
  const carry = useRef<Group>(null);
  const st = useRef({
    pos: { ...(from ?? SPAWN) } as Vec2,
    heading: Math.PI,
    /** where the person is, which way they face and how fast they go (gait.ts) */
    walker: mover(from ?? SPAWN, Math.PI),
    t: Math.random() * 10,
    cheerUntil: 0,
    blinkAt: 1 + Math.random() * 3,
    stride: 0,
    walkMix: 0,
    eye: 1,
    tg: targets(),
  });
  // the name chip (or the hover card in its place) and the speech bubble standing on it, placed by the stage's label
  // layout: alerts first, then bubbles, busy agents' chips and last the free agents' chips (see labels.ts)
  const chipLabel = useLabel();
  const bubbleLabel = useLabel();
  bubbleLabel.base = chipLabel;
  chipLabel.topped = bubbleLabel;
  chipLabel.rank = (hovered && onSelect) || selected ? RANK.pinned : dim ? RANK.free : RANK.busy;
  chipLabel.alpha = dim && !selected ? 0.7 : 1;
  bubbleLabel.rank = bubbleTone === "info" ? RANK.bubble : RANK.alert;
  const glanceAt = useMemo(() => (hashOf(id) % 628) / 100, [id]);

  const K = kit(lod);
  const full = lod === "full";
  const look = useMemo(() => lookFor(role, id), [role, id]);
  const failed = status === "fail";
  // the theme flag is a dependency on purpose: the role colours differ between light and dark
  const tones = useMemo(() => {
    const base = ghost ? new Color("#8a8fa6") : roleColor(role);
    const main = failed ? base.clone().multiplyScalar(0.5) : base;
    return {
      main: hexOf(main),
      deep: hexOf(main.clone().multiplyScalar(0.62)),
      light: hexOf(main.clone().lerp(WHITE, 0.45)),
      soft: hexOf(main.clone().lerp(WHITE, 0.22)),
      lamp: hexOf(tokenColor("warning")),
      marker: hexOf(tokenColor("coral")),
    };
  }, [role, ghost, failed, dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = Boolean(ghost);
  const m = useMemo(() => {
    const s = (c: string, f: Parameters<typeof surface>[1]) => surface(c, f, g);
    const knit = role === "reviewer" || role === "docs";
    const top = role === "qa" || role === "reviewer" ? SHIRT_WHITE : role === "shipper" ? DARK_TEE : tones.main;
    const shortSleeves = role === "qa" || role === "shipper" || role === "planner";
    return {
      skin: s(look.skin, "skin"), hair: s(look.hair, look.style === "curls" ? "knit" : "hair"), trousers: s(look.trousers, "cloth"), shoe: s(look.shoes, "shoe"), sole: s(look.sole, "sole"),
      top: s(top, role === "docs" ? "knit" : "cloth"), sleeve: s(role === "reviewer" ? tones.main : top, knit ? "knit" : "cloth"),
      forearm: shortSleeves ? s(look.skin, "skin") : s(role === "reviewer" ? tones.main : top, knit ? "knit" : "cloth"),
      main: s(tones.main, "cloth"), deep: s(tones.deep, "cloth"), light: s(tones.light, "cloth"), knitMain: s(tones.main, "knit"), knitDeep: s(tones.deep, "knit"),
      white: s(SHIRT_WHITE, "cloth"), eyeWhite: s(WHITE_EYE, "eye"), iris: s(look.iris, "gloss"), pupil: s(PUPIL, "gloss"), lips: s("#5a2a2e", "skin"),
      ink: s(INK, "plastic"), frame: s(role === "reviewer" ? "#2b2422" : INK, "plastic"), steel: s(STEEL, "metal"), metal: s("#c9ccd6", "metal"),
      wood: s("#b98b5e", "plastic"), paper: s(PAGES, "paper"), glow: s(tones.light, "glow"), reflective: s("#eef0f5", "reflective"),
      laptop: s("#9aa0b0", "metal"), parcel: s("#c8925a", "paper"), book: s(BOOK, "cloth"), card: s("#f6f7fb", "plastic"),
    };
  }, [look, tones, role, g]);
  const catchlight = catchlightMaterial();
  const build = look.build;
  const shoulderX = BODY.shoulderX[build];

  // new target → new path from wherever the character is now
  useEffect(() => {
    const s = st.current;
    if (reducedMotion) {
      s.pos = { x: spot.x, z: spot.z };
      s.walker.x = spot.x;
      s.walker.z = spot.z;
      s.walker.path = [];
      s.walker.speed = 0;
      return;
    }
    s.walker.path = nav.path(s.pos, { x: spot.x, z: spot.z }).slice(1);
    if (spot.pose === "cheer") s.cheerUntil = performance.now() + 2600;
  }, [spot.x, spot.z, spot.pose, nav, reducedMotion]);

  useFrame((state, dtRaw) => {
    // walking uses the real elapsed time (slow GPUs and background tabs still arrive); limb
    // easing below stays smooth by using a frame-rate independent factor
    const dt = Math.min(dtRaw, 0.5);
    const s = st.current;
    s.t += dt;
    const t = s.t;
    let pose: Pose = spot.pose;
    // walking like a person (gait.ts, no allocation per frame): a big turn from standing is stepped on the spot first,
    // then speeding up, turning at a natural rate, slowing for corners and to stop; once there, turning to face the
    // camera (chat) or the spot's direction
    const w = s.walker;
    const cam = state.camera.position;
    const face = facing ? Math.atan2(cam.x - w.x, cam.z - w.z) : spot.face;
    stepMover(w, reducedMotion ? 0 : Math.min(dt, 0.1), { cruise: SPEED, face });
    if (reducedMotion) w.heading = face;
    s.pos.x = w.x;
    s.pos.z = w.z;
    s.heading = w.heading;
    const walking = w.path.length > 0 || w.speed > STOPPED;
    if (walking) pose = "walk";
    motion.current.moving = walking;
    motion.current.speed = w.speed;
    motion.current.turning = !walking && w.turning !== 0;
    motion.current.seated = spot.pose === "sit";
    if (pose === "walk") wake(activity);
    if (pose === "cheer" && performance.now() > s.cheerUntil) pose = "stand";

    const r = root.current;
    if (!r) return;
    r.position.set(s.pos.x, 0, s.pos.z);
    r.rotation.y = s.heading;
    if (selRing.current) selRing.current.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(t * 4) * 0.06);
    track?.set(id, s.pos);
    // the GLB person animates itself: skip the code-built joint and face easing
    if (personRef.current) {
      if (blob.current) blob.current.scale.setScalar(1);
      return;
    }

    // ── pose targets ──
    const mo = reducedMotion ? 0 : 1; // motion amplitude: reduced motion keeps the poses, drops the loops
    const T = s.tg;
    T.hy = BODY.hipY; T.hz = 0; T.hrx = 0; T.hry = 0; T.hrz = Math.sin(t * 0.55 + glanceAt) * 0.018 * mo;
    T.srx = 0.02; T.sry = 0; T.srz = -T.hrz * 0.6;
    T.nrx = 0; T.nry = Math.sin(t * 0.6 + glanceAt) * 0.16 * mo; T.nrz = 0;
    T.lsx = 0.04; T.lsz = 0.1; T.rsx = 0.04; T.rsz = -0.1; T.lel = -0.16; T.rel = -0.16;
    T.ltx = 0; T.rtx = 0; T.lkn = 0.03; T.rkn = 0.03; T.lft = 0; T.rft = 0;
    T.breath = 1 + Math.sin(t * 1.7 + glanceAt) * 0.014 * mo;
    const working = status === "working";
    let free = false; // free to glance towards the action
    switch (pose) {
      case "walk": {
        s.stride += dt * Math.max(0.6, s.walker.speed) * STRIDE_PER_METRE;
        const p = s.stride, sw = Math.sin(p), cw = Math.cos(p);
        T.ltx = -sw * 0.52; T.rtx = sw * 0.52;
        T.lkn = Math.max(0, cw) * 0.95 + 0.06; T.rkn = Math.max(0, -cw) * 0.95 + 0.06;
        T.lft = -Math.max(0, -sw) * 0.25; T.rft = -Math.max(0, sw) * 0.25;
        T.lsx = sw * 0.48; T.rsx = -sw * 0.48; T.lsz = 0.08; T.rsz = -0.08;
        T.lel = -0.3 - Math.max(0, -sw) * 0.35; T.rel = -0.3 - Math.max(0, sw) * 0.35;
        T.hy = BODY.hipY - 0.025 + Math.abs(cw) * 0.035; T.hry = sw * 0.09; T.sry = -sw * 0.13; T.srx = 0.07; T.hrz = 0;
        T.nry = 0; T.nrx = -0.04;
        break;
      }
      case "sit": {
        T.hy = BODY.sitHipY; T.hz = 0.03; T.ltx = -1.45; T.rtx = -1.45; T.lkn = 1.3; T.rkn = 1.3; T.hrz = 0;
        if (working) {
          const ty = Math.sin(t * 19) * 0.11 * mo, ty2 = Math.sin(t * 19 + 1.9) * 0.11 * mo;
          T.srx = 0.24; T.lsx = -0.58; T.rsx = -0.58; T.lsz = 0.1; T.rsz = -0.1; T.lel = -1.2 + ty; T.rel = -1.2 + ty2;
          T.nrx = 0.1 + Math.sin(t * 1.3) * 0.04 * mo; T.nry = Math.sin(t * 0.7) * 0.14 * mo;
        } else {
          T.srx = 0.06; T.lsx = -0.32; T.rsx = -0.32; T.lsz = 0.06; T.rsz = -0.06; T.lel = -0.95; T.rel = -0.95;
          free = true;
        }
        break;
      }
      case "write": {
        T.rsx = -2.25 + Math.sin(t * 4.2) * 0.2 * mo; T.rsz = -0.28 + Math.cos(t * 4.2) * 0.1 * mo; T.rel = -0.35;
        T.nrx = -0.14; T.nry = -0.12 + Math.sin(t * 2.1) * 0.12 * mo; T.sry = -0.08;
        break;
      }
      case "wait": {
        T.rft = -Math.max(0, Math.sin(t * 7)) * 0.4 * mo; T.rtx = -0.12; T.rkn = 0.12;
        const watch = mo > 0 && t % 6 < 1.6;
        T.lsx = watch ? -1.0 : 0.1; T.lsz = watch ? 0.32 : 0.14; T.lel = watch ? -1.35 : -0.25;
        T.rsx = 0.12; T.rsz = -0.16; T.rel = -0.3;
        T.nrx = watch ? 0.38 : 0.02; T.nry = watch ? 0.32 : Math.sin(t * 0.8) * 0.22 * mo;
        T.hrz = 0.03; free = !watch;
        break;
      }
      case "slump": {
        T.srx = 0.36; T.nrx = 0.5; T.lsx = 0.22; T.rsx = 0.22; T.lsz = 0.04; T.rsz = -0.04; T.lel = -0.1; T.rel = -0.1; T.hy = BODY.hipY - 0.04; T.nry = 0;
        break;
      }
      case "cheer": {
        const j = mo ? Math.abs(Math.sin(t * 6)) : 0.5;
        T.hy = BODY.hipY - 0.06 + j * 0.24; T.lkn = (1 - j) * 0.55; T.rkn = (1 - j) * 0.55; T.ltx = -(1 - j) * 0.3; T.rtx = -(1 - j) * 0.3;
        T.lft = (1 - j) * 0.25; T.rft = (1 - j) * 0.25;
        T.lsx = -2.85 + Math.sin(t * 12) * 0.18 * mo; T.rsx = -2.85 - Math.sin(t * 12) * 0.18 * mo; T.lsz = 0.38; T.rsz = -0.38; T.lel = -0.3; T.rel = -0.3;
        T.nrx = -0.18; T.nry = 0; T.srx = -0.06;
        break;
      }
      default: {
        if (working) {
          if (role === "qa") { T.rsx = -0.6; T.rsz = -0.05; T.rel = -1.3 + Math.sin(t * 5) * 0.14 * mo; T.nrx = 0.36; T.nry = 0.08; }
          else if (role === "shipper") { T.lsx = -0.75; T.rsx = -0.75; T.lsz = 0.02; T.rsz = -0.02; T.lel = -0.55; T.rel = -0.55; T.nrx = 0.06; }
          else { T.rsx = -0.95 + Math.sin(t * 3) * 0.1 * mo; T.rel = -0.45; T.nrx = 0.16; T.nry = Math.sin(t * 0.9) * 0.1 * mo; }
        } else free = true;
      }
    }
    // props held to the chest (clipboard, tablet) and the laptop under the arm
    const sitting = pose === "sit";
    if ((role === "planner" || role === "qa") && pose !== "cheer") {
      T.lsx = -0.3 + (pose === "walk" ? Math.sin(s.stride) * 0.06 : 0); T.lsz = 0.14; T.lel = -1.35;
    }
    const laptopOut = role === "dev" && !sitting && pose !== "cheer";
    if (laptopOut) { T.lsx = -0.05 + (pose === "walk" ? Math.sin(s.stride) * 0.05 : 0); T.lsz = 0.24; T.lel = -0.62; }
    if (carry.current) {
      carry.current.visible = role === "dev" ? laptopOut : role === "docs" ? !(sitting && working) : role === "shipper" ? working && pose !== "walk" : true;
    }
    // glance towards the action while free
    if (free && lookAt && !working) {
      let want = Math.atan2(lookAt.x - s.pos.x, lookAt.z - s.pos.z) - s.heading;
      want = Math.atan2(Math.sin(want), Math.cos(want));
      const dist = Math.hypot(lookAt.x - s.pos.x, lookAt.z - s.pos.z);
      if (dist > 0.8 && Math.abs(want) < 2.2 && (mo === 0 || Math.sin(t * 0.31 + glanceAt) > -0.4)) {
        const c = Math.max(-1.25, Math.min(1.25, want));
        T.nry = c * 0.72; T.sry += c * 0.22; T.nrx = Math.min(T.nrx, 0.02);
      }
    }
    // ── face ──
    if (pose === "cheer") { T.eye = 0.55; T.brow = -0.04; T.browUp = 0.01; T.curve = -1; T.width = 1.08; T.open = 1; }
    else {
      T.open = 0;
      switch (status) {
        case "working": T.eye = 0.78; T.brow = -0.17; T.browUp = -0.004; T.curve = -0.1; T.width = 0.7; break;
        case "pass": case "done": T.eye = 0.86; T.brow = 0.02; T.browUp = 0.006; T.curve = -0.95; T.width = 1.06; break;
        case "waiting": T.eye = 1.06; T.brow = 0.34; T.browUp = 0.004; T.curve = 0.45; T.width = 0.8; break;
        case "returning": T.eye = 0.95; T.brow = 0.24; T.browUp = 0.002; T.curve = 0.22; T.width = 0.78; break;
        case "fail": T.eye = 0.68; T.brow = 0.42; T.browUp = 0.002; T.curve = 0.75; T.width = 0.85; break;
        default: T.eye = 1; T.brow = 0; T.browUp = 0; T.curve = -0.45; T.width = 0.95;
      }
    }

    // ── apply (smooth, frame-rate independent blends) ──
    const k = 1 - Math.exp(-dt * 14);
    const kf = 1 - Math.exp(-dt * 9);
    const hp = hips.current, sp = spine.current;
    if (hp) {
      hp.position.y += (T.hy - hp.position.y) * k;
      hp.position.z += (T.hz - hp.position.z) * k;
      hp.rotation.x += (T.hrx - hp.rotation.x) * k;
      hp.rotation.y += (T.hry - hp.rotation.y) * k;
      hp.rotation.z += (T.hrz - hp.rotation.z) * k;
    }
    if (sp) {
      sp.rotation.x += (T.srx - sp.rotation.x) * k;
      sp.rotation.y += (T.sry - sp.rotation.y) * k;
      sp.rotation.z += (T.srz - sp.rotation.z) * k;
    }
    if (chest.current) chest.current.scale.y = T.breath;
    const hd = head.current;
    if (hd) {
      hd.rotation.x += (T.nrx - hd.rotation.x) * kf;
      hd.rotation.y += (T.nry - hd.rotation.y) * kf;
      hd.rotation.z += (T.nrz - hd.rotation.z) * kf;
    }
    ease(shL.current, T.lsx, T.lsz, k);
    ease(shR.current, T.rsx, T.rsz, k);
    ease(elL.current, T.lel, 0, k);
    ease(elR.current, T.rel, 0, k);
    ease(thL.current, T.ltx, 0, k);
    ease(thR.current, T.rtx, 0, k);
    ease(knL.current, T.lkn, 0, k);
    ease(knR.current, T.rkn, 0, k);
    ease(ftL.current, T.lft, 0, k);
    ease(ftR.current, T.rft, 0, k);
    // blink every few seconds; the lids also follow the expression
    s.eye += (T.eye - s.eye) * kf;
    let lid = 1;
    if (t >= s.blinkAt) {
      const b = (t - s.blinkAt) / 0.16;
      if (b >= 1) s.blinkAt = t + 2.2 + Math.random() * 3.6;
      else lid = 1 - Math.sin(b * Math.PI) * 0.9;
    }
    if (eyes.current) eyes.current.scale.y = s.eye * lid;
    if (browL.current && browR.current) {
      browL.current.rotation.z += (-T.brow - browL.current.rotation.z) * kf;
      browR.current.rotation.z += (T.brow - browR.current.rotation.z) * kf;
      const by = 0.153 + T.browUp;
      browL.current.position.y += (by - browL.current.position.y) * kf;
      browR.current.position.y = browL.current.position.y;
    }
    const mt = mouth.current;
    if (mt) {
      let c = mt.scale.y + (T.curve - mt.scale.y) * kf;
      if (Math.abs(c) < 0.08) c = T.curve >= 0 ? 0.08 : -0.08; // never a degenerate (zero) scale
      mt.scale.y = c;
      mt.scale.x += (T.width - mt.scale.x) * kf;
    }
    const mo2 = mouthOpen.current;
    if (mo2) {
      const o = mo2.scale.y + (T.open - mo2.scale.y) * kf;
      mo2.scale.y = Math.max(0.001, o);
      mo2.visible = o > 0.05;
    }
    if (blob.current) {
      const lift = hp ? Math.max(0, hp.position.y - BODY.hipY) : 0;
      blob.current.scale.setScalar(1 - Math.min(0.4, lift * 1.6));
    }
  });

  const tone = bubbleTone === "danger" ? "bg-[rgb(var(--danger))] text-white"
    : bubbleTone === "warning" ? "bg-[rgb(var(--warning))] text-[rgb(40_30_0)]"
    : "bg-[rgb(var(--ink))] text-[rgb(var(--surface))]";
  const statusDot = STATUS_DOT[status];
  const busy = status === "working" || status === "waiting" || status === "returning";
  // the stage's shadow map is drawn once per change (furniture only); people stand on their soft contact shadow
  const cast = false;
  const robot = role === "autopilot";
  const legacy = role === "fixup" || role === "integrator" || robot;
  const z = (y: number) => chestZ(build, y);
  // the labels hang from the model's head height
  const labelY = person ? person.headY + (LABEL_ANCHOR_Y - PERSON_HEIGHT) : LABEL_ANCHOR_Y;
  // a click on the head label picks the agent like a click on it. Its presses and hovers stay out of the 3D scene (it
  // would read them at the label's own offsets); a drag that passes over it still reaches the orbit controls.
  const pick = onSelect ? {
    "data-pick": "",
    onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
    onPointerMove: (e: ReactPointerEvent) => { if (e.buttons === 0) e.stopPropagation(); },
    onClick: (e: ReactMouseEvent) => { e.stopPropagation(); onSelect({ x: st.current.pos.x, z: st.current.pos.z }); },
  } : undefined;

  return (
    <group ref={root}>
      {model && people && <source.Person key={model.id} model={model} id={id} status={status} ghost={ghost} reducedMotion={reducedMotion} facing={facing} motion={motion} onReady={setPerson} />}
      <group ref={hips} position={[0, BODY.hipY, 0]} visible={!person}>
        {/* pelvis (trousers) and legs: hip, knee and ankle joints */}
        <mesh geometry={K.sphere} material={m.trousers} position={[0, -0.012, 0]} scale={[0.146, 0.118, 0.094]} castShadow={cast} dispose={null} />
        {[1, -1].map((side) => (
          <group key={side} ref={side > 0 ? thL : thR} position={[side * BODY.hipX, -0.03, 0]}>
            <mesh geometry={K.thigh} material={m.trousers} castShadow={cast} dispose={null} />
            <group ref={side > 0 ? knL : knR} position={[0, -BODY.thigh, 0]}>
              <mesh geometry={K.shin} material={m.trousers} castShadow={cast} dispose={null} />
              <group ref={side > 0 ? ftL : ftR} position={[0, -BODY.shin, 0]}>
                <mesh geometry={K.shoe} material={m.shoe} position={[0, -0.022, 0.045]} rotation={[Math.PI / 2, 0, 0]} scale={[1.02, 1, 0.92]} castShadow={cast} dispose={null} />
                {full && <mesh geometry={K.sole} material={m.sole} position={[0, -0.06, 0.046]} dispose={null} />}
              </group>
            </group>
          </group>
        ))}

        <group ref={spine} position={[0, BODY.spineY, 0]}>
          {/* torso garment (round in the kit, squashed front to back here) */}
          <group ref={chest} scale={[1, 1, BODY.torsoDepth]}>
            <mesh geometry={K.torso[build]} material={m.top} castShadow={cast} dispose={null} />
            {(role === "qa" || role === "shipper") && <mesh geometry={K.vest[build]} material={m.main} castShadow={cast} dispose={null} />}
            {role === "reviewer" && <mesh geometry={K.cardigan[build]} material={m.knitMain} castShadow={cast} dispose={null} />}
            {role === "shipper" && full && [0.29, 0.06].map((y) => {
              const rr = z(y) / BODY.torsoDepth * 1.07 + 0.008;
              return <mesh key={y} geometry={K.stripe} material={m.reflective} position={[0, y, 0]} scale={[rr, 1, rr]} dispose={null} />;
            })}
          </group>
          <mesh geometry={K.neck} material={m.skin} position={[0, 0.47, 0]} dispose={null} />

          {/* role outfit details */}
          {role === "dev" && (
            <>
              <mesh geometry={K.sphere} material={m.main} position={[0, 0.425, -0.075]} rotation={[0.35, 0, 0]} scale={[0.115, 0.06, 0.06]} castShadow={cast} dispose={null} />
              <mesh geometry={K.rib} material={m.deep} position={[0, 0.438, 0]} rotation={[Math.PI / 2, 0, 0]} dispose={null} />
              <mesh geometry={K.sphere} material={m.deep} position={[0, 0.03, z(0.03) - 0.012]} scale={[0.1, 0.055, 0.026]} dispose={null} />
              {full && [1, -1].map((side) => <mesh key={side} geometry={K.string} material={m.white} position={[side * 0.026, 0.33, z(0.34) + 0.008]} dispose={null} />)}
            </>
          )}
          {role === "planner" && full && (
            <>
              {[1, -1].map((side) => <mesh key={side} geometry={K.collarPoint} material={m.light} position={[side * 0.03, 0.428, z(0.41) - 0.004]} rotation={[0.55, 0, side * 0.62]} dispose={null} />)}
              <mesh geometry={K.pocket} material={m.deep} position={[0.075, 0.27, z(0.27) + 0.002]} dispose={null} />
            </>
          )}
          {role === "reviewer" && (
            <>
              {full && [0.235, 0.165, 0.095].map((y) => <mesh key={y} geometry={K.ball} material={m.deep} position={[0.052, y, z(y) * 1.05 + 0.006]} scale={0.0085} dispose={null} />)}
              {full && [1, -1].map((side) => <mesh key={side} geometry={K.collarPoint} material={m.white} position={[side * 0.03, 0.43, z(0.41) - 0.002]} rotation={[0.55, 0, side * 0.62]} dispose={null} />)}
            </>
          )}
          {role === "qa" && full && [1, -1].map((side) => (
            <mesh key={side} geometry={K.pocket} material={m.deep} position={[side * 0.078, 0.16, z(0.16) * 1.07 + 0.012]} dispose={null} />
          ))}
          {role === "secops" && (
            <>
              <mesh geometry={K.collar} material={m.deep} position={[0, 0.445, 0]} dispose={null} />
              {full && <mesh geometry={K.zip} material={m.metal} position={[0, 0.22, z(0.22) + 0.003]} dispose={null} />}
            </>
          )}
          {role === "docs" && (
            <>
              <mesh geometry={K.rib} material={m.knitDeep} position={[0, 0.432, 0]} rotation={[Math.PI / 2, 0, 0]} dispose={null} />
              {full && [1, -1].map((side) => <mesh key={side} geometry={K.collarPoint} material={m.white} position={[side * 0.03, 0.44, z(0.41) + 0.004]} rotation={[0.5, 0, side * 0.62]} dispose={null} />)}
            </>
          )}
          {role === "shipper" && (
            <>
              {full && [1, -1].map((side) => <mesh key={side} geometry={K.strap} material={m.deep} position={[side * 0.034, 0.335, z(0.335) + 0.006]} rotation={[-0.25, 0, side * 0.3]} dispose={null} />)}
              <mesh geometry={K.card} material={m.card} position={[0, 0.235, z(0.235) + 0.01]} rotation={[-0.12, 0, 0]} dispose={null} />
              {full && <mesh geometry={K.pocket} material={m.main} position={[0, 0.258, z(0.258) + 0.014]} scale={[0.85, 0.28, 0.6]} dispose={null} />}
            </>
          )}

          {/* carried things: the developer's laptop, the release gate's parcel */}
          {role === "dev" && (
            <group ref={carry} position={[0.205, 0.1, 0.035]} rotation={[Math.PI / 2, 0, Math.PI / 2]}>
              <mesh geometry={K.laptop} material={m.laptop} castShadow={cast} dispose={null} />
            </group>
          )}
          {role === "shipper" && (
            <group ref={carry} position={[0, 0.03, 0.34]} visible={false}>
              <mesh geometry={K.parcel} material={m.parcel} castShadow={cast} dispose={null} />
            </group>
          )}

          {/* arms: shoulder and elbow joints, hands, held props */}
          {[1, -1].map((side) => (
            <group key={side} ref={side > 0 ? shL : shR} position={[side * shoulderX, BODY.shoulderY, 0]}>
              <mesh geometry={K.upperArm} material={m.sleeve} castShadow={cast} dispose={null} />
              <group ref={side > 0 ? elL : elR} position={[0, -BODY.upperArm, 0]}>
                <mesh geometry={K.forearm} material={m.forearm} castShadow={cast} dispose={null} />
                {role === "planner" && <mesh geometry={K.cuff} material={m.main} position={[0, -0.012, 0]} rotation={[Math.PI / 2, 0, 0]} dispose={null} />}
                <group position={[0, -BODY.forearm, 0]}>
                  <mesh geometry={K.ball} material={m.skin} position={[0, -0.045, 0.004]} scale={[0.024, 0.05, 0.036]} dispose={null} />
                  {full && <mesh geometry={K.thumb} material={m.skin} position={[-side * 0.008, -0.028, 0.03]} rotation={[0.6, 0, 0]} dispose={null} />}
                  {side > 0 && role === "planner" && (
                    <group position={[0, -0.085, 0.035]} rotation={[1.32, 0, 0]}>
                      <mesh geometry={K.clipboard} material={m.wood} castShadow={cast} dispose={null} />
                      <mesh geometry={K.paper} material={m.paper} position={[0, -0.012, -0.0075]} dispose={null} />
                      <mesh geometry={K.clip} material={m.metal} position={[0, 0.1, -0.008]} dispose={null} />
                    </group>
                  )}
                  {side < 0 && role === "planner" && <mesh geometry={GEAR.marker} material={gearMaterial(tones.marker, { ghost })} position={[0, -0.06, 0.03]} rotation={[0.4, 0, 0]} dispose={null} />}
                  {side > 0 && role === "qa" && (
                    <group position={[0, -0.09, 0.04]} rotation={[0.95, 0, 0]}>
                      <mesh geometry={K.tablet} material={m.ink} castShadow={cast} dispose={null} />
                      <mesh geometry={K.screen} material={m.glow} position={[0, 0, -0.0068]} dispose={null} />
                    </group>
                  )}
                  {side > 0 && role === "docs" && (
                    <group ref={carry} position={[0.012, -0.075, 0.03]} rotation={[0.08, Math.PI / 2, 0]}>
                      <mesh geometry={GEAR.bookCover} material={m.book} castShadow={cast} dispose={null} />
                      <mesh geometry={GEAR.bookPages} material={m.paper} position={[0.012, 0, 0]} dispose={null} />
                    </group>
                  )}
                  {side < 0 && role === "secops" && (
                    <group position={[-0.035, -0.07, 0.03]} rotation={[0.05, -1.15, 0]} scale={0.92}>
                      <mesh geometry={K.shield} material={m.steel} castShadow={cast} dispose={null} />
                      <mesh geometry={GEAR.shield} material={m.main} position={[0, 0.006, 0.03]} scale={0.62} dispose={null} />
                    </group>
                  )}
                  {side < 0 && role === "fixup" && (
                    <group position={[0, -0.08, 0.04]}>
                      <mesh geometry={GEAR.wrenchHandle} material={gearMaterial(INK, { ghost })} dispose={null} />
                      <mesh position={[0, 0.12, 0]} geometry={GEAR.wrenchHead} material={gearMaterial(INK, { ghost })} dispose={null} />
                    </group>
                  )}
                </group>
              </group>
            </group>
          ))}

          {/* head: skull and jaw, ears, nose, eyes (blink), brows and mouth (expression), hair, head gear */}
          <group ref={head} position={[0, BODY.headY, 0]}>
            {robot ? (
              <mesh geometry={K.sphere} material={m.steel} position={[0, 0.115, 0]} scale={[0.13, 0.12, 0.12]} castShadow={cast} dispose={null} />
            ) : (
              <>
                <mesh geometry={K.head} material={m.skin} scale={[1, 1, 1.06]} castShadow={cast} dispose={null} />
                {full && [1, -1].map((side) => <mesh key={side} geometry={K.ball} material={m.skin} position={[side * 0.106, 0.1, -0.004]} scale={[0.017, 0.03, 0.022]} dispose={null} />)}
                {full && <mesh geometry={K.ball} material={m.skin} position={[0, 0.082, 0.11]} scale={[0.015, 0.02, 0.017]} dispose={null} />}
              </>
            )}
            <group ref={eyes} position={[0, 0.112, 0]}>
              {[1, -1].map((side) => full ? (
                <group key={side}>
                  <mesh geometry={K.ball} material={m.eyeWhite} position={[side * 0.042, 0, 0.103]} scale={[0.02, 0.023, 0.012]} dispose={null} />
                  <mesh geometry={K.ball} material={m.iris} position={[side * 0.041, -0.001, 0.1115]} scale={[0.0125, 0.0145, 0.006]} dispose={null} />
                  <mesh geometry={K.ball} material={m.pupil} position={[side * 0.041, -0.001, 0.1155]} scale={[0.0062, 0.0072, 0.003]} dispose={null} />
                  <mesh geometry={K.ball} material={catchlight} position={[side * 0.041 + 0.004, 0.0055, 0.1188]} scale={0.0027} dispose={null} />
                </group>
              ) : (
                <mesh key={side} geometry={K.ball} material={m.pupil} position={[side * 0.042, 0, 0.106]} scale={[0.014, 0.017, 0.01]} dispose={null} />
              ))}
            </group>
            {full && !robot && (
              <>
                {[1, -1].map((side) => (
                  <group key={side} ref={side > 0 ? browL : browR} position={[side * 0.045, 0.153, 0.108]} rotation={[0, side * 0.35, 0]}>
                    <mesh geometry={K.brow} material={m.hair} rotation={[0, 0, Math.PI / 2]} dispose={null} />
                  </group>
                ))}
                <group position={[0, 0.044, 0.092]} rotation={[0.35, 0, 0]}>
                  <mesh ref={mouth} geometry={K.mouth} material={m.lips} scale={[0.95, -0.45, 1]} dispose={null} />
                  <mesh ref={mouthOpen} geometry={K.mouthOpen} material={m.lips} position={[0, 0, 0.002]} scale={[1, 0.001, 1]} visible={false} dispose={null} />
                </group>
              </>
            )}
            {!robot && <Hair style={look.style} hair={m.hair} tie={m.main} K={K} cast={cast} hatted={role === "secops" || role === "docs"} />}
            {role === "reviewer" && (
              <group position={[0, 0.114, 0.124]}>
                {[1, -1].map((side) => <mesh key={side} geometry={K.rim} material={m.frame} position={[side * 0.043, 0, 0]} dispose={null} />)}
                <mesh geometry={K.bar} material={m.frame} position={[0, 0.004, 0.001]} rotation={[0, 0, Math.PI / 2]} scale={[1, 0.034, 1]} dispose={null} />
                {full && [1, -1].map((side) => <mesh key={side} geometry={K.bar} material={m.frame} position={[side * 0.071, 0.004, -0.055]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.11, 1]} dispose={null} />)}
              </group>
            )}
            {role === "secops" && (
              <group position={[0, 0.124, -0.006]} rotation={[-0.2, 0, 0]}>
                <mesh geometry={K.beanie} material={m.knitMain} scale={[0.133, 0.152, 0.14]} castShadow={cast} dispose={null} />
                <mesh geometry={K.band} material={m.knitDeep} position={[0, -0.01, 0]} scale={[0.137, 0.052, 0.144]} dispose={null} />
                <mesh geometry={K.ball} material={surface(tones.light, "knit", g)} position={[0, 0.162, 0]} scale={0.046} castShadow={cast} dispose={null} />
              </group>
            )}
            {role === "docs" && (
              <group position={[0, 0.0, -0.004]}>
                <mesh geometry={K.band} material={m.ink} position={[0, 0.205, 0]} scale={[0.122, 0.07, 0.13]} dispose={null} />
                <mesh geometry={K.board} material={m.ink} position={[0, 0.244, 0]} scale={[0.9, 1, 0.9]} rotation={[0, Math.PI / 4, 0]} castShadow={cast} dispose={null} />
                <mesh geometry={K.ball} material={m.main} position={[0, 0.256, 0]} scale={0.012} dispose={null} />
                <mesh geometry={K.bar} material={m.main} position={[0.085, 0.256, 0.0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 0.17, 1]} dispose={null} />
                <mesh geometry={K.bar} material={m.main} position={[0.17, 0.2, 0.0]} scale={[1, 0.11, 1]} dispose={null} />
                <mesh geometry={K.cone} material={m.main} position={[0.17, 0.135, 0.0]} dispose={null} />
              </group>
            )}
            {legacy && (
              <group position={[0, 0.115, 0.005]} scale={0.62}>
                <group position={[0, -1.36, 0]}><LegacyGear role={role} color={tones.deep} accent={tones.main} lampHex={tones.lamp} ghost={ghost} /></group>
              </group>
            )}
          </group>
        </group>
      </group>

      {/* soft contact shadow and the status ring on the floor */}
      <mesh ref={blob} geometry={K.blob} material={blobMaterial(dark)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} scale={1} dispose={null} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.38, 0.46, 32]} />
        <meshBasicMaterial color={status === "fail" ? "#f06266" : status === "waiting" || status === "returning" ? "#f5b428" : status === "working" ? tones.main : status === "pass" ? "#26be80" : "#555a72"}
          transparent opacity={ghost ? 0.25 : status === "working" ? 0.9 : 0.55} />
      </mesh>
      {selected && (
        <mesh ref={selRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
          <ringGeometry args={[0.52, 0.62, 40]} />
          <meshBasicMaterial color={tones.main} transparent opacity={0.95} />
        </mesh>
      )}
      {hovered && onSelect && !selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
          <ringGeometry args={[0.5, 0.56, 40]} />
          <meshBasicMaterial color={tones.main} transparent opacity={0.35} />
        </mesh>
      )}
      {onSelect && (
        <mesh
          position={[0, 0.95, 0]} visible={false}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
          onClick={(e) => {
            if (e.delta > 4) return;
            e.stopPropagation();
            onSelect({ x: st.current.pos.x, z: st.current.pos.z });
          }}
        >
          <cylinderGeometry args={[0.5, 0.5, 1.9, 12]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      {/* the labels hang from the head: the chip centred on the anchor, the bubble above it (labels.ts places them) */}
      <group position={[0, labelY, 0]} ref={chipLabel.anchorRef}>
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={labelSize === "full" ? "text-[12px]" : "text-[11px]"} style={{ opacity: ghost ? 0.6 : 1 }}>
            {hovered && onSelect ? (
              <div ref={chipLabel.ref} {...pick} className={`${LABEL_CLASS} fo-shadow-pop w-max rounded-block bg-[rgb(var(--surface)/0.9)] px-3 py-2 text-[rgb(var(--ink))] backdrop-blur`}>
                <div className="flex items-center gap-1.5 whitespace-nowrap font-semibold">
                  <span className={`size-1.5 rounded-full ${statusDot}`} />{label}
                </div>
                {(action ?? bubble) && <div className="line-clamp-2 max-w-[13rem] text-[rgb(var(--ink-3))]">{action ?? bubble}</div>}
              </div>
            ) : (
              <>
                {bubble && (showLabel || selected) && (busy || bubbleTone === "danger") && (
                  <div ref={bubbleLabel.ref} {...pick} className={`${LABEL_CLASS} fo-shadow-pop w-max max-w-[13rem] whitespace-normal rounded-block px-3 py-1.5 text-center font-semibold leading-snug ${tone}`}>
                    {bubble}
                    <span className={`absolute left-1/2 top-full -mt-1 size-1.5 -translate-x-1/2 rotate-45 ${tone}`} />
                  </div>
                )}
                {(showLabel || selected) && (
                  <div ref={chipLabel.ref} {...pick} className={`${LABEL_CLASS} flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[rgb(var(--surface)/0.85)] px-2.5 py-0.5 font-semibold text-[rgb(var(--ink))] shadow-sm backdrop-blur${selected ? " ring-2 ring-[rgb(var(--brand-500))]" : ""}`}>
                    <span className={`size-1.5 rounded-full ${statusDot}`} />{label}
                  </div>
                )}
              </>
            )}
          </div>
        </Html>
      </group>
      {headSlot && <group position={[0, labelY, 0]}>{headSlot}</group>}
    </group>
  );
}

/** Hair styles (head-local; the skull is centred at y 0.115). Hats sit over "crop", "long" and the others. */
function Hair({ style, hair, tie, K, cast, hatted }: { style: string; hair: ReturnType<typeof surface>; tie: ReturnType<typeof surface>; K: ReturnType<typeof kit>; cast: boolean; hatted: boolean }) {
  const cap = <mesh geometry={K.cap} material={hair} position={[0, 0.118, -0.004]} rotation={[-0.55, 0, 0]} scale={[0.123, 0.14, 0.13]} castShadow={cast} dispose={null} />;
  let body: ReactNode;
  switch (style) {
    case "quiff":
      body = (
        <>
          {cap}
          <mesh geometry={K.sphere} material={hair} position={[0.012, 0.228, 0.048]} rotation={[0.3, 0, -0.15]} scale={[0.086, 0.048, 0.074]} castShadow={cast} dispose={null} />
        </>
      );
      break;
    case "bob":
      body = (
        <>
          {cap}
          <mesh geometry={K.bobShell} material={hair} position={[0, 0.112, -0.006]} scale={[0.129, 0.142, 0.134]} castShadow={cast} dispose={null} />
          <mesh geometry={K.sphere} material={hair} position={[0, 0.198, 0.068]} rotation={[0.35, 0, 0]} scale={[0.098, 0.04, 0.06]} dispose={null} />
        </>
      );
      break;
    case "ponytail":
      body = (
        <>
          {cap}
          <mesh geometry={K.tail} material={hair} position={[0, 0.045, -0.178]} rotation={[0.45, 0, 0]} castShadow={cast} dispose={null} />
          <mesh geometry={K.tie} material={tie} position={[0, 0.138, -0.138]} rotation={[0.45 + Math.PI / 2, 0, 0]} dispose={null} />
        </>
      );
      break;
    case "bun":
      body = (
        <>
          {cap}
          <mesh geometry={K.sphere} material={hair} position={[0, 0.222, -0.082]} scale={0.056} castShadow={cast} dispose={null} />
        </>
      );
      break;
    case "curls":
      body = <mesh geometry={K.curls} material={hair} position={[0, 0.118, -0.004]} rotation={[-0.5, 0, 0]} scale={[0.124, 0.136, 0.13]} castShadow={cast} dispose={null} />;
      break;
    case "long":
      body = (
        <>
          {!hatted && cap}
          <mesh geometry={K.longShell} material={hair} position={[0, 0.112, -0.006]} scale={[0.129, 0.142, 0.134]} castShadow={cast} dispose={null} />
          <mesh geometry={K.sphere} material={hair} position={[0, -0.005, -0.078]} scale={[0.112, 0.15, 0.05]} castShadow={cast} dispose={null} />
        </>
      );
      break;
    default:
      body = <mesh geometry={K.capShort} material={hair} position={[0, 0.118, -0.004]} rotation={[-0.5, 0, 0]} scale={[0.118, 0.134, 0.124]} castShadow={cast} dispose={null} />;
  }
  return body;
}

function ease(o: Group | null, x: number, zr: number, k: number) {
  if (!o) return;
  o.rotation.x += (x - o.rotation.x) * k;
  o.rotation.z += (zr - o.rotation.z) * k;
}


