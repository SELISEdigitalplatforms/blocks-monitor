/** Office props built from primitives (no external models). Stations react to the pipeline: monitors
 *  glow while their agent types, the whiteboard fills with the plan's notes, the test bench shows a
 *  traffic light, the release gate glows and carries a build through while deploying. Ported from MADP
 *  Studio; the Factory adds the Security lab (a bench with a shield screen) and the Docs desk (stacked
 *  pages, a laptop, a lamp and a page being turned). */

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { BufferGeometry, Group, InstancedMesh, Material, Mesh } from "three";
import {
  BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, MathUtils, Matrix4, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { t } from "@/i18n";
import type { GateState } from "./model";
import { shieldShape } from "./gear";
import { LABEL_CLASS, RANK, useLabel } from "./labels";
import { STATION, deskAt } from "./layout";

export interface Theme {
  floor: string; wall: string; wood: string; metal: string; desk: string; screenOff: string; brand: string; coral: string;
  success: string; danger: string; warning: string; ink: string; rug: string; dark: boolean;
}

/** station signs on (the full stage) or off (compact cards) */
export const SignsVisible = createContext(true);

/* A station's sign shows its verdict once its work is done and verified (green): "Tests passed", "Security passed".
 * A done agent's name chip gives way to it, so a sign never doubles a name chip. They are drawn at a
 * fixed screen size and placed by the stage's label layout (labels.ts) after the agents' bubbles and busy chips. */

function Sign({ position, text, hidden }: { position: [number, number, number]; text: string; hidden: boolean }) {
  const visible = useContext(SignsVisible);
  const label = useLabel();
  label.rank = RANK.sign;
  if (!visible || hidden) return null;
  return (
    <group position={position} ref={label.anchorRef}>
      <Html zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div ref={label.ref} className={`${LABEL_CLASS} whitespace-nowrap rounded-full bg-success px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-stage shadow-sm`}>{text}</div>
      </Html>
    </group>
  );
}

export function Room({ theme }: { theme: Theme }) {
  return (
    <group>
      {/* floor slab + vestibule */}
      <RoundedBox args={[24.4, 0.3, 16.4]} radius={0.12} position={[0, -0.15, 0]} receiveShadow>
        <meshStandardMaterial color={theme.floor} roughness={0.92} />
      </RoundedBox>
      <mesh position={[13.75, -0.12, 0.2]} receiveShadow><boxGeometry args={[3.5, 0.24, 3.8]} /><meshStandardMaterial color={theme.floor} roughness={0.92} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.4]} receiveShadow>
        <planeGeometry args={[14, 10.6]} /><meshStandardMaterial color={theme.rug} roughness={1} />
      </mesh>
      {/* back + left walls (low, cut-away look) */}
      <mesh position={[0, 1.3, -8.15]} receiveShadow castShadow><boxGeometry args={[24.4, 2.6, 0.3]} /><meshStandardMaterial color={theme.wall} roughness={0.9} /></mesh>
      <mesh position={[-12.15, 1.3, 0]} receiveShadow castShadow><boxGeometry args={[0.3, 2.6, 16.4]} /><meshStandardMaterial color={theme.wall} roughness={0.9} /></mesh>
      {/* right wall with the doorway */}
      <mesh position={[12.05, 0.9, -4.4]} castShadow><boxGeometry args={[0.3, 1.8, 7.6]} /><meshStandardMaterial color={theme.wall} roughness={0.9} /></mesh>
      <mesh position={[12.05, 0.9, 4.6]} castShadow><boxGeometry args={[0.3, 1.8, 7.2]} /><meshStandardMaterial color={theme.wall} roughness={0.9} /></mesh>
      {/* plants */}
      {[[-11, -7], [11, 7], [-11, 7.2]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.32, 0.26, 0.5, 16]} /><meshStandardMaterial color={theme.metal} /></mesh>
          <mesh position={[0, 0.85, 0]} castShadow><icosahedronGeometry args={[0.55, 1]} /><meshStandardMaterial color="#3fae6a" roughness={0.8} flatShading /></mesh>
        </group>
      ))}
    </group>
  );
}

/** desk parts shared by every desk (theme-independent, kept for the session) */
let deskKit: { top: BufferGeometry; metal: BufferGeometry; monitor: BufferGeometry; keyboard: BufferGeometry; chair: BufferGeometry; screen: BufferGeometry } | null = null;
function deskGeometries() {
  if (deskKit) return deskKit;
  const legs = [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]].map(([x, z]) => new CylinderGeometry(0.03, 0.03, 0.74, 8).translate(x, 0.37, z));
  deskKit = {
    top: new RoundedBoxGeometry(1.8, 0.07, 0.9, 2, 0.03).translate(0, 0.76, 0),
    // the legs, the monitor stand and the chair's post: one metal mesh
    metal: mergeGeometries([...legs, new BoxGeometry(0.06, 0.18, 0.06).translate(0, 0.87, -0.24), new CylinderGeometry(0.04, 0.04, 0.44, 8).translate(0, 0.22, 0.95)]),
    // the monitor faces +z (towards the seat)
    monitor: new BoxGeometry(0.95, 0.56, 0.05).translate(0, 1.13, -0.22),
    keyboard: new BoxGeometry(0.6, 0.02, 0.2).translate(0, 0.8, 0.12),
    chair: mergeGeometries([new BoxGeometry(0.55, 0.08, 0.5).translate(0, 0.46, 0.95), new BoxGeometry(0.55, 0.6, 0.07).translate(0, 0.8, 1.19)]),
    screen: new PlaneGeometry(0.86, 0.47).translate(0, 1.13, -0.193),
  };
  return deskKit;
}

const SCREEN_OFF = 0.04;
const screenGlow = (active: boolean, t: number, i: number) => (active ? 1.1 + Math.sin(t * 6 + i) * 0.25 : SCREEN_OFF);

/** Every developer desk, instanced: six draw calls for the whole row of desks, however many there are. A desk's
 *  monitor glows while its developer types (the screen colour is the off colour plus the brand glow, per desk). */
export function Desks({ count, active, theme }: { count: number; active: readonly boolean[]; theme: Theme }) {
  const kit = deskGeometries();
  const mats = useMemo(() => ({
    top: new MeshStandardMaterial({ color: theme.desk, roughness: 0.5 }),
    metal: new MeshStandardMaterial({ color: theme.metal }),
    monitor: new MeshStandardMaterial({ color: "#14152a", roughness: 0.4 }),
    keyboard: new MeshStandardMaterial({ color: "#2a2c44" }),
    chair: new MeshStandardMaterial({ color: "#2c2f4a" }),
    screen: new MeshBasicMaterial({ color: "#ffffff" }),
  }), [theme.desk, theme.metal]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const meshes = useRef<Array<InstancedMesh | null>>([]);
  const screens = useRef<InstancedMesh | null>(null);
  const glow = useRef<number[]>([]);
  const off = useMemo(() => new Color(theme.screenOff), [theme.screenOff]);
  const brand = useMemo(() => new Color(theme.brand), [theme.brand]);
  const tmp = useMemo(() => new Color(), []);
  useLayoutEffect(() => {
    const m = new Matrix4();
    for (const mesh of [...meshes.current, screens.current]) {
      if (!mesh) continue;
      for (let i = 0; i < count; i++) {
        const p = deskAt(i);
        mesh.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    glow.current = Array.from({ length: count }, (_, i) => glow.current[i] ?? SCREEN_OFF);
    const s = screens.current;
    if (s) {
      for (let i = 0; i < count; i++) s.setColorAt(i, tmp.copy(brand).multiplyScalar(glow.current[i]).add(off));
      if (s.instanceColor) s.instanceColor.needsUpdate = true;
    }
  }, [count, off, brand, tmp]);
  useFrame(({ clock }) => {
    const s = screens.current;
    if (!s) return;
    const t = clock.elapsedTime;
    let changed = false;
    for (let i = 0; i < count; i++) {
      const cur = glow.current[i] ?? SCREEN_OFF;
      const target = screenGlow(Boolean(active[i]), t, i);
      if (Math.abs(target - cur) < 0.002) continue;
      glow.current[i] = MathUtils.lerp(cur, target, 0.1);
      s.setColorAt(i, tmp.copy(brand).multiplyScalar(glow.current[i]).add(off));
      changed = true;
    }
    if (changed && s.instanceColor) s.instanceColor.needsUpdate = true;
  });
  const parts: Array<[BufferGeometry, Material, boolean, boolean]> = [
    [kit.top, mats.top, true, true], [kit.metal, mats.metal, true, false], [kit.monitor, mats.monitor, true, false],
    [kit.keyboard, mats.keyboard, false, false], [kit.chair, mats.chair, true, false],
  ];
  return (
    <group key={count}>
      {parts.map(([geo, mat, cast, receive], k) => (
        <instancedMesh key={k} ref={(el) => { meshes.current[k] = el; }} args={[geo, mat, count]} castShadow={cast} receiveShadow={receive} dispose={null} />
      ))}
      <instancedMesh ref={screens} args={[kit.screen, mats.screen, count]} dispose={null} />
    </group>
  );
}

export function Whiteboard({ steps, active, done, theme }: { steps: number; active: boolean; done: boolean; theme: Theme }) {
  const notes = Math.min(12, steps);
  const palette = ["#ffd166", "#7bdff2", "#b2f7ef", "#f7aef8", "#cdb4db", "#ffafcc"];
  return (
    <group position={[STATION.whiteboard.x, 0, STATION.whiteboard.z]}>
      <mesh position={[0, 1.55, 0.05]} castShadow><boxGeometry args={[3.2, 1.6, 0.06]} /><meshStandardMaterial color="#f5f5fb" roughness={0.3} emissive="#ffffff" emissiveIntensity={active ? 0.12 : 0.03} /></mesh>
      <mesh position={[0, 1.55, 0.02]}><boxGeometry args={[3.32, 1.72, 0.04]} /><meshStandardMaterial color={theme.metal} /></mesh>
      {Array.from({ length: notes }, (_, k) => (
        <mesh key={k} position={[-1.3 + (k % 6) * 0.52, 1.95 - Math.floor(k / 6) * 0.5, 0.09]} rotation={[0, 0, (k % 3 - 1) * 0.06]}>
          <boxGeometry args={[0.38, 0.32, 0.01]} /><meshStandardMaterial color={palette[k % palette.length]} />
        </mesh>
      ))}
      {active && notes === 0 && <mesh position={[-0.2, 1.7, 0.09]}><boxGeometry args={[1.6, 0.03, 0.01]} /><meshStandardMaterial color={theme.brand} /></mesh>}
      <Sign position={[0, 2.65, 0.1]} text={t("studio.office.signs.planVerified", "Plan verified")} hidden={!done} />
    </group>
  );
}

export function ReviewDesk({ active, done, theme }: { active: boolean; done: boolean; theme: Theme }) {
  return (
    <group position={[STATION.review.x, 0, STATION.review.z]}>
      <RoundedBox args={[1.6, 0.07, 0.85]} radius={0.03} position={[0, 0.76, 0]} castShadow><meshStandardMaterial color={theme.wood} /></RoundedBox>
      <mesh position={[0, 0.38, 0]}><boxGeometry args={[1.4, 0.74, 0.6]} /><meshStandardMaterial color={theme.desk} /></mesh>
      <mesh position={[0.2, 0.82, -0.05]} rotation={[-Math.PI / 2, 0, 0.2]}><planeGeometry args={[0.5, 0.36]} /><meshStandardMaterial color="#f7f7fb" emissive="#ffffff" emissiveIntensity={active ? 0.25 : 0} /></mesh>
      <Sign position={[0, 2.75, -0.45]} text={t("studio.office.signs.reviewPassed", "Review passed")} hidden={!done} />
    </group>
  );
}

export function TestBench({ state, theme }: { state: "idle" | "running" | "pass" | "fail"; theme: Theme }) {
  const lamp = (on: boolean, c: string, y: number) => (
    <mesh position={[2.2, y, 0.32]}><sphereGeometry args={[0.1, 16, 10]} /><meshStandardMaterial color={on ? c : "#2b2d40"} emissive={c} emissiveIntensity={on ? 1.6 : 0} /></mesh>
  );
  return (
    <group position={[STATION.bench.x, 0, STATION.bench.z]}>
      <RoundedBox args={[4.2, 0.09, 1.0]} radius={0.03} position={[0, 0.9, 0]} castShadow receiveShadow><meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.4} /></RoundedBox>
      <mesh position={[0, 0.45, 0]}><boxGeometry args={[4.0, 0.88, 0.8]} /><meshStandardMaterial color={theme.desk} /></mesh>
      {[-1.4, 0, 1.4].map((x, k) => (
        <mesh key={x} position={[x, 1.2, -0.25]} castShadow>
          <boxGeometry args={[0.9, 0.5, 0.06]} />
          <meshStandardMaterial color="#14152a" emissive={state === "fail" ? theme.danger : state === "pass" ? theme.success : theme.brand} emissiveIntensity={state === "idle" ? 0.03 : 0.5 + k * 0.1} />
        </mesh>
      ))}
      <mesh position={[2.2, 1.35, 0.32]}><boxGeometry args={[0.32, 0.9, 0.2]} /><meshStandardMaterial color="#1c1d30" /></mesh>
      {lamp(state === "fail", theme.danger, 1.62)}
      {lamp(state === "running", theme.warning, 1.36)}
      {lamp(state === "pass", theme.success, 1.1)}
      <Sign position={[0, 2.75, -0.45]} text={t("studio.office.signs.testsPassed", "Tests passed")} hidden={state !== "pass"} />
    </group>
  );
}

export type LabState = "idle" | "scanning" | "pass" | "fail" | "hold";

const SHIELD_GEOMETRY = new ExtrudeGeometry(shieldShape(), { depth: 0.03, bevelEnabled: false, curveSegments: 10 });
const KEYHOLE_TOP = new CircleGeometry(0.034, 16);
const KEYHOLE_SLOT = new PlaneGeometry(0.03, 0.07);

/** SecOps' station: a lab bench with a big shield screen (a scan line sweeps it while scanning; it turns
 *  green on a pass, red when the work is sent back, amber on hold) and a scanner box with LEDs. */
export function SecurityLab({ state, theme }: { state: LabState; theme: Theme }) {
  const scan = useRef<Mesh>(null);
  const screen = useRef<MeshStandardMaterial>(null);
  const leds = useRef<MeshStandardMaterial>(null);
  const glow = state === "fail" ? theme.danger : state === "pass" ? theme.success : state === "hold" ? theme.warning : theme.brand;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const scanning = state === "scanning";
    if (scan.current) {
      scan.current.visible = scanning;
      if (scanning) scan.current.position.y = 1.45 + Math.sin(t * 2.2) * 0.29;
    }
    if (screen.current) {
      const target = state === "idle" ? 0.04 : scanning ? 0.42 + Math.sin(t * 3) * 0.1 : 0.55;
      screen.current.emissiveIntensity = MathUtils.lerp(screen.current.emissiveIntensity, target, 0.1);
    }
    if (leds.current) leds.current.emissiveIntensity = scanning ? (Math.sin(t * 9) > 0 ? 1.6 : 0.25) : state === "idle" ? 0.05 : 1.1;
  });
  return (
    <group position={[STATION.security.x, 0, STATION.security.z]}>
      {/* lab bench */}
      <RoundedBox args={[2.4, 0.08, 0.9]} radius={0.03} position={[0, 0.9, 0]} castShadow receiveShadow><meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.4} /></RoundedBox>
      <mesh position={[0, 0.45, 0]}><boxGeometry args={[2.2, 0.86, 0.7]} /><meshStandardMaterial color={theme.desk} /></mesh>
      {/* the shield screen faces +z (towards the agent) */}
      <mesh position={[0, 1.02, -0.27]}><boxGeometry args={[0.08, 0.16, 0.06]} /><meshStandardMaterial color={theme.metal} /></mesh>
      <mesh position={[0, 1.45, -0.25]} castShadow><boxGeometry args={[1.15, 0.78, 0.06]} /><meshStandardMaterial color="#14152a" roughness={0.4} /></mesh>
      <mesh position={[0, 1.45, -0.218]}>
        <planeGeometry args={[1.04, 0.67]} />
        <meshStandardMaterial ref={screen} color={theme.screenOff} emissive={glow} emissiveIntensity={0.04} />
      </mesh>
      <mesh position={[0, 1.465, -0.216]} scale={2.1} geometry={SHIELD_GEOMETRY} dispose={null}>
        <meshStandardMaterial color={state === "idle" ? "#3a3d5c" : "#ffffff"} emissive={glow} emissiveIntensity={state === "idle" ? 0.06 : 0.85} />
      </mesh>
      <mesh position={[0, 1.495, -0.15]} geometry={KEYHOLE_TOP} dispose={null}><meshBasicMaterial color="#14152a" /></mesh>
      <mesh position={[0, 1.45, -0.15]} geometry={KEYHOLE_SLOT} dispose={null}><meshBasicMaterial color="#14152a" /></mesh>
      <mesh ref={scan} position={[0, 1.45, -0.21]} visible={false}><planeGeometry args={[1.0, 0.025]} /><meshBasicMaterial color={theme.brand} transparent opacity={0.85} /></mesh>
      {/* keyboard and a scanner box with a LED strip */}
      <mesh position={[-0.35, 0.955, 0.15]}><boxGeometry args={[0.6, 0.02, 0.2]} /><meshStandardMaterial color="#2a2c44" /></mesh>
      <mesh position={[0.9, 1.12, -0.05]} castShadow><boxGeometry args={[0.42, 0.36, 0.45]} /><meshStandardMaterial color="#1c1d30" /></mesh>
      <mesh position={[0.9, 1.2, 0.177]}><boxGeometry args={[0.3, 0.04, 0.01]} /><meshStandardMaterial ref={leds} color="#1c1d30" emissive={glow} emissiveIntensity={0.05} /></mesh>
      <Sign position={[0.4, 2.55, -0.45]} text={t("studio.office.signs.securityPassed", "Security passed")} hidden={state !== "pass"} />
    </group>
  );
}

export type DocsState = "idle" | "writing" | "done" | "hold" | "back";

const PAPER = "#f6f3ea";
const PILES: Array<{ x: number; z: number; h: number; rot: number; tabs: string[] }> = [
  { x: -0.6, z: -0.15, h: 0.16, rot: 0.08, tabs: ["#7bdff2", "#ffd166"] },
  { x: -0.58, z: 0.22, h: 0.07, rot: -0.12, tabs: ["#f7aef8"] },
  { x: 0.62, z: -0.08, h: 0.24, rot: -0.05, tabs: ["#b2f7ef", "#ffafcc", "#cdb4db"] },
];

/** Docs' station: a writing desk with stacked pages (coloured tabs), a laptop, a lamp and a page that
 *  is turned over while the docs are being written. */
export function DocsDesk({ state, theme }: { state: DocsState; theme: Theme }) {
  const page = useRef<Group>(null);
  const lamp = useRef<MeshStandardMaterial>(null);
  const laptop = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const writing = state === "writing";
    const t = clock.elapsedTime;
    if (page.current) {
      page.current.visible = writing;
      if (writing) {
        const p = Math.min(1, (t % 2.4) / 1.3);
        page.current.rotation.z = Math.PI * (0.5 - 0.5 * Math.cos(p * Math.PI));
      }
    }
    if (lamp.current) lamp.current.emissiveIntensity = MathUtils.lerp(lamp.current.emissiveIntensity, writing ? 1.5 : state === "done" ? 0.5 : 0.04, 0.1);
    if (laptop.current) laptop.current.emissiveIntensity = MathUtils.lerp(laptop.current.emissiveIntensity, writing ? 0.9 + Math.sin(t * 5) * 0.12 : 0.04, 0.1);
  });
  const top = 0.795;
  const tall = PILES[2];
  return (
    <group position={[STATION.docs.x, 0, STATION.docs.z]}>
      <RoundedBox args={[1.7, 0.07, 0.9]} radius={0.03} position={[0, 0.76, 0]} castShadow receiveShadow><meshStandardMaterial color={theme.wood} roughness={0.55} /></RoundedBox>
      {[[-0.75, -0.38], [0.75, -0.38], [-0.75, 0.38], [0.75, 0.38]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.37, z]} castShadow><cylinderGeometry args={[0.03, 0.03, 0.74, 8]} /><meshStandardMaterial color={theme.metal} /></mesh>
      ))}
      {/* stacked pages with coloured tabs */}
      {PILES.map((p) => (
        <group key={`${p.x}${p.z}`} position={[p.x, top, p.z]} rotation={[0, p.rot, 0]}>
          <mesh position={[0, p.h / 2, 0]} castShadow receiveShadow><boxGeometry args={[0.32, p.h, 0.42]} /><meshStandardMaterial color={PAPER} roughness={0.95} /></mesh>
          {p.tabs.map((c, k) => (
            <mesh key={c} position={[0.17, ((k + 1) / (p.tabs.length + 1)) * p.h, 0.08 - k * 0.1]}><boxGeometry args={[0.04, 0.012, 0.07]} /><meshStandardMaterial color={c} /></mesh>
          ))}
        </group>
      ))}
      {/* the page being turned over (hinged on the tall pile's left edge) */}
      <group ref={page} position={[tall.x - 0.16, top + tall.h + 0.006, tall.z]} visible={false}>
        <mesh position={[0.16, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.32, 0.42]} /><meshStandardMaterial color="#ffffff" side={DoubleSide} /></mesh>
      </group>
      {/* laptop: the screen faces +z (towards the seat) */}
      <mesh position={[0.02, top + 0.012, 0.12]}><boxGeometry args={[0.5, 0.024, 0.34]} /><meshStandardMaterial color="#2a2c44" /></mesh>
      <group position={[0.02, top + 0.02, -0.05]} rotation={[-0.22, 0, 0]}>
        <mesh position={[0, 0.17, 0]} castShadow><boxGeometry args={[0.5, 0.33, 0.016]} /><meshStandardMaterial color="#2a2c44" /></mesh>
        <mesh position={[0, 0.17, 0.009]}><planeGeometry args={[0.45, 0.28]} /><meshStandardMaterial ref={laptop} color={theme.screenOff} emissive="#fff4d6" emissiveIntensity={0.04} /></mesh>
      </group>
      {/* desk lamp */}
      <group position={[0.68, top, -0.34]}>
        <mesh position={[0, 0.015, 0]}><cylinderGeometry args={[0.08, 0.09, 0.03, 16]} /><meshStandardMaterial color={theme.metal} /></mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.012, 0.012, 0.42, 8]} /><meshStandardMaterial color={theme.metal} /></mesh>
        <mesh position={[-0.05, 0.43, 0.04]} rotation={[0.5, 0, 0.35]}><coneGeometry args={[0.09, 0.12, 16, 1, true]} /><meshStandardMaterial color={theme.coral} side={DoubleSide} /></mesh>
        <mesh position={[-0.07, 0.39, 0.07]}><sphereGeometry args={[0.035, 10, 8]} /><meshStandardMaterial ref={lamp} color="#fff4d6" emissive="#ffd98a" emissiveIntensity={0.04} /></mesh>
      </group>
      {/* chair */}
      <group position={[0, 0, 0.95]}>
        <mesh position={[0, 0.46, 0]} castShadow><boxGeometry args={[0.55, 0.08, 0.5]} /><meshStandardMaterial color="#2c2f4a" /></mesh>
        <mesh position={[0, 0.8, 0.24]} castShadow><boxGeometry args={[0.55, 0.6, 0.07]} /><meshStandardMaterial color="#2c2f4a" /></mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.04, 0.04, 0.44, 8]} /><meshStandardMaterial color={theme.metal} /></mesh>
      </group>
      <Sign position={[0, 2.4, -0.5]} text={t("studio.office.signs.docsWritten", "Docs written")} hidden={state !== "done"} />
    </group>
  );
}

/** MADP's repo-lock door, kept as the room's entrance (the Factory's pipeline has no integrator, so it has no sign). */
export function LockDoor({ open, held, theme }: { open: boolean; held: boolean; theme: Theme }) {
  const panel = useRef<Group>(null);
  useFrame(() => {
    if (panel.current) panel.current.rotation.y = MathUtils.lerp(panel.current.rotation.y, open ? -1.45 : 0, 0.06);
  });
  return (
    <group position={[STATION.door.x, 0, STATION.door.z]}>
      <mesh position={[0, 1.95, 0]} castShadow><boxGeometry args={[0.36, 0.3, 1.9]} /><meshStandardMaterial color={theme.wall} /></mesh>
      <mesh position={[0, 0.9, -0.85]}><boxGeometry args={[0.36, 1.8, 0.12]} /><meshStandardMaterial color={theme.metal} /></mesh>
      <mesh position={[0, 0.9, 0.85]}><boxGeometry args={[0.36, 1.8, 0.12]} /><meshStandardMaterial color={theme.metal} /></mesh>
      <group ref={panel} position={[0, 0, -0.78]}>
        <mesh position={[0, 0.9, 0.78]} castShadow><boxGeometry args={[0.08, 1.78, 1.56]} /><meshStandardMaterial color={theme.coral} roughness={0.45} /></mesh>
      </group>
      <mesh position={[-0.2, 2.25, 0]}><sphereGeometry args={[0.1, 16, 10]} /><meshStandardMaterial color={held ? theme.danger : theme.success} emissive={held ? theme.danger : theme.success} emissiveIntensity={1.5} /></mesh>
      {/* queue lane on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.2, 0.01, 1.4]}><planeGeometry args={[4.2, 0.7]} /><meshBasicMaterial color={theme.warning} transparent opacity={0.13} /></mesh>
    </group>
  );
}


/** The Factory's release gate (07) and deploy step: Studio's ship gate. */
export function ShipGate({ state, theme }: { state: GateState; theme: Theme }) {
  const box = useRef<Mesh>(null);
  const deploying = state === "deploying";
  useFrame(({ clock }) => {
    if (!box.current) return;
    box.current.visible = deploying;
    box.current.position.x = -1.6 + ((clock.elapsedTime * 0.8) % 3.2);
  });
  const glow = state === "hold" ? theme.danger : state === "live" || state === "open" ? theme.success : theme.brand;
  return (
    <group position={[STATION.ship.x, 0, STATION.ship.z]}>
      <mesh position={[-1.1, 1.1, 0]} castShadow><boxGeometry args={[0.25, 2.2, 0.4]} /><meshStandardMaterial color={theme.metal} /></mesh>
      <mesh position={[1.1, 1.1, 0]} castShadow><boxGeometry args={[0.25, 2.2, 0.4]} /><meshStandardMaterial color={theme.metal} /></mesh>
      <mesh position={[0, 2.3, 0]} castShadow><boxGeometry args={[2.5, 0.3, 0.45]} /><meshStandardMaterial color="#14152a" emissive={glow} emissiveIntensity={state === "idle" ? 0.08 : state === "checking" || state === "open" ? 0.7 : 1.0} /></mesh>
      <mesh position={[0, 0.18, 0.05]} receiveShadow><boxGeometry args={[3.4, 0.16, 0.7]} /><meshStandardMaterial color="#26283e" /></mesh>
      <mesh ref={box} position={[0, 0.45, 0.05]} visible={false}><boxGeometry args={[0.38, 0.32, 0.38]} /><meshStandardMaterial color="#c8925a" roughness={0.85} /></mesh>
      {/* over the gate's top beam, clear of the Docs desk beside it */}
      <Sign position={[0, 2.95, 0]} text={t("studio.office.signs.live", "Live on SELISE Blocks")} hidden={state !== "live"} />
    </group>
  );
}

export function LobbyBench({ theme }: { theme: Theme }) {
  return (
    <group position={[STATION.lobbyBench.x, 0, STATION.lobbyBench.z + 0.25]}>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow><boxGeometry args={[3.2, 0.1, 0.55]} /><meshStandardMaterial color={theme.wood} /></mesh>
      <mesh position={[0, 0.7, 0.25]} castShadow><boxGeometry args={[3.2, 0.5, 0.08]} /><meshStandardMaterial color={theme.wood} /></mesh>
      {[-1.4, 1.4].map((x) => <mesh key={x} position={[x, 0.2, 0]}><boxGeometry args={[0.1, 0.4, 0.5]} /><meshStandardMaterial color={theme.metal} /></mesh>)}
    </group>
  );
}

export function CoffeeCorner({ theme }: { theme: Theme }) {
  return (
    <group position={[STATION.coffee.x, 0, STATION.coffee.z]}>
      <mesh position={[0, 0.32, 0]} castShadow><boxGeometry args={[1.9, 0.65, 0.8]} /><meshStandardMaterial color={theme.desk} /></mesh>
      <RoundedBox args={[1.9, 0.07, 0.9]} radius={0.03} position={[0, 0.68, 0]} castShadow receiveShadow><meshStandardMaterial color={theme.wood} /></RoundedBox>
      <mesh position={[-0.55, 0.96, -0.1]} castShadow><boxGeometry args={[0.4, 0.5, 0.35]} /><meshStandardMaterial color="#1c1d30" /></mesh>
      <mesh position={[0.2, 0.77, 0.1]}><cylinderGeometry args={[0.06, 0.05, 0.12, 12]} /><meshStandardMaterial color={theme.coral} /></mesh>
      <mesh position={[0.5, 0.77, 0.05]}><cylinderGeometry args={[0.06, 0.05, 0.12, 12]} /><meshStandardMaterial color={theme.brand} /></mesh>
    </group>
  );
}
