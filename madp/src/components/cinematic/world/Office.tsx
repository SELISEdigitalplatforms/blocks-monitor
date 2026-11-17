/** A SELISE-style office floor, kept light: instanced boxes for the architecture and furniture, a handful of shared
 *  materials, canvas-drawn screens. Reception (wood-slat logo wall, desk) → glass Meeting room → open Engineering floor
 *  → Build floor behind glass doors. Places mount lazily (the current one and the next), the doors slide open when the
 *  visitor comes near. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { DOORS, STAGE_ORDER, stageIndex, type StageId } from "../journey/places";
import { useJourney } from "../journey/store";
import { Hotspot } from "./Hotspot";
import { Logo3D } from "./Logo3D";
import { M, box, cyl, cylLo, cylTaper, leafBlade, plane, sphere } from "./materials";
import { canvasTexture, FONT, radialTexture, roundRect, track } from "./textures";
import { useBuildBoard, useEngineerMonitor, useWallScreen } from "./screens";
import { t, useCulture } from "@/i18n";

type B = [number, number, number, number, number, number];
const H = 3.4;

/** Instanced boxes from [x, y, z, sx, sy, sz] — one draw call per material. */
export function Boxes({ items, material }: { items: B[]; material: MeshStandardMaterial | MeshBasicMaterial }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    items.forEach(([x, y, z, sx, sy, sz], i) => {
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[box, material, items.length]} />;
}

/* ── plants: every planter in the office drawn as a handful of instanced parts (a few draw calls in all) ── */

type PlantAt = { p: [number, number, number]; s?: number; kind?: 0 | 1 };
const PLANTS: PlantAt[] = [
  { p: [-5.9, 0, -3.3], s: 1.2 }, { p: [5.1, 0, -3.3], kind: 1, s: 1.1 }, { p: [-5.8, 0, 4.2], kind: 1 },
  { p: [13.45, 0, -1.0] }, { p: [7.5, 0, -5.4], s: 0.9, kind: 1 },
  { p: [17.2, 0, -7.6], s: 1.2 }, { p: [23.6, 0, -7.6], kind: 1 },
  { p: [39.2, 0, -7.6], s: 1.2 }, { p: [25.4, 0, -7.6], kind: 1 },
];
const BLADES: [number, number, number, number, number][] = [
  [0, 0, 0.95, 0, 0], [0.09, 0.05, 0.78, -0.12, 0.05], [-0.1, 0.03, 0.82, 0.13, -0.04], [0.04, -0.1, 0.7, 0.05, -0.15],
  [-0.05, 0.11, 0.66, -0.06, 0.16], [0.13, -0.06, 0.58, -0.22, -0.08], [-0.13, -0.07, 0.6, 0.2, -0.1],
];
type Part = { geo: BufferGeometry; mat: Material; t: [number, number, number]; sc: [number, number, number]; r?: [number, number, number] };
const roundedPlanter = new RoundedBoxGeometry(0.5, 0.42, 0.5, 2, 0.05);
const TREE: Part[] = [
  { geo: cylTaper, mat: M.planter, t: [0, 0.34, 0], sc: [0.3, 0.68, 0.3] },
  { geo: cylLo, mat: M.soil, t: [0, 0.685, 0], sc: [0.27, 0.01, 0.27] },
  { geo: cylLo, mat: M.trunk, t: [0, 1.0, 0], sc: [0.025, 0.65, 0.025] },
  { geo: sphere, mat: M.leaf, t: [0, 1.42, 0], sc: [0.42, 0.36, 0.42] },
  { geo: sphere, mat: M.leafLight, t: [0.16, 1.62, 0.06], sc: [0.28, 0.25, 0.28] },
  { geo: sphere, mat: M.leaf, t: [-0.14, 1.68, -0.05], sc: [0.24, 0.22, 0.24] },
];
const SNAKE: Part[] = [
  { geo: roundedPlanter, mat: M.planter, t: [0, 0.21, 0], sc: [1, 1, 1] },
  { geo: box, mat: M.soil, t: [0, 0.425, 0], sc: [0.44, 0.01, 0.44] },
  ...BLADES.map(([x, z, h, rz, rx], i): Part => ({ geo: leafBlade, mat: i % 2 ? M.leaf : M.leafLight, t: [x, 0.42 + h / 2, z], sc: [1, h, 1], r: [rx, i * 0.7, rz] })),
];

function Plants() {
  const groups = useMemo(() => {
    // one instanced mesh per (geometry, material) pair across all planters
    const map = new Map<string, { geo: BufferGeometry; mat: Material; mats: Matrix4[] }>();
    const o = new Object3D();
    const parent = new Object3D();
    for (const pl of PLANTS) {
      parent.position.set(...pl.p);
      parent.scale.setScalar(pl.s ?? 1);
      parent.updateMatrix();
      for (const part of pl.kind === 1 ? SNAKE : TREE) {
        o.position.set(...part.t);
        o.scale.set(...part.sc);
        o.rotation.set(...(part.r ?? [0, 0, 0]));
        o.updateMatrix();
        const key = `${part.geo.uuid}:${part.mat.uuid}`;
        if (!map.has(key)) map.set(key, { geo: part.geo, mat: part.mat, mats: [] });
        map.get(key)!.mats.push(new Matrix4().multiplyMatrices(parent.matrix, o.matrix));
      }
    }
    return [...map.values()];
  }, []);
  return <>{groups.map((g, i) => <InstancedMatrices key={i} geometry={g.geo} material={g.mat} matrices={g.mats} />)}</>;
}

function InstancedMatrices({ geometry, material, matrices }: { geometry: BufferGeometry; material: Material; matrices: Matrix4[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current!;
    matrices.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} />;
}

/** Office chairs: seat, back and a dark base, instanced (one set per call site). */
function Chairs({ at }: { at: [number, number, number][] }) {
  const items = useMemo(() => {
    const seat: B[] = [];
    const back: B[] = [];
    const base: B[] = [];
    for (const [x, z, yaw] of at) {
      const bx = Math.sin(yaw) * -0.24;
      const bz = Math.cos(yaw) * -0.24;
      seat.push([x, 0.47, z, 0.48, 0.07, 0.46]);
      back.push([x + bx, 0.8, z + bz, Math.abs(Math.cos(yaw)) * 0.46 + 0.05, 0.56, Math.abs(Math.sin(yaw)) * 0.46 + 0.05]);
      base.push([x, 0.23, z, 0.07, 0.46, 0.07]);
    }
    return { seat, back, base };
  }, [at]);
  return (
    <>
      <Boxes items={items.seat} material={M.chair} />
      <Boxes items={items.back} material={M.chair} />
      <Boxes items={items.base} material={M.steel} />
    </>
  );
}

/* ── the shell: floor, ceiling with glowing light panels, walls with detail, windows ── */

function Shell() {
  const lights = useMemo(() => {
    const panels: B[] = [];
    const halos: B[] = [];
    for (let x = -4; x <= 38; x += 3.6) for (const z of [-5.6, -1.6, 2.6]) {
      panels.push([x, H - 0.015, z, 1.2, 0.02, 1.2]);
      halos.push([x, H - 0.03, z, 2.3, 0.001, 2.3]);
    }
    return { panels, halos };
  }, []);
  const halo = useMemo(() => {
    const m = new MeshBasicMaterial({ map: radialTexture("ceiling-halo", "rgba(255,255,255,0.75)", "rgba(255,255,255,0)"), transparent: true, depthWrite: false, toneMapped: false });
    return m;
  }, []);
  const windows = useMemo(() => {
    const panes: B[] = [];
    const mull: B[] = [];
    for (let x = 15; x <= 39; x += 2.4) {
      if (x > 27 && x < 37) continue; // the build board's wall
      panes.push([x, 1.75, -8.44, 2.2, 2.5, 0.02]);
      mull.push([x + 1.2, 1.75, -8.42, 0.08, 2.6, 0.06]);
    }
    mull.push([27, 0.45, -8.42, 24.4, 0.08, 0.06], [27, 3.02, -8.42, 24.4, 0.08, 0.06]);
    return { panes, mull };
  }, []);
  // wall detail: skirting all round, a ceiling shadow-gap line, fluted acoustic panels on the lobby's side wall
  const detail = useMemo(() => {
    const skirting: B[] = [[17, 0.05, -8.48, 48, 0.1, 0.03], [-6.88, 0.05, -1, 0.03, 0.1, 22], [40.88, 0.05, -1, 0.03, 0.1, 22], [24, 0.05, 6.08, 34, 0.1, 0.03]];
    const gap: B[] = [[17, H - 0.06, -8.48, 48, 0.025, 0.02], [24, H - 0.06, 6.08, 34, 0.025, 0.02]];
    const flutes: B[] = [];
    for (let z = -6.8; z <= 4.8; z += 0.12) flutes.push([-6.86, 1.55, z, 0.05, 2.7, 0.07]);
    return { skirting, gap, flutes };
  }, []);
  return (
    <group>
      <mesh geometry={plane} material={M.floor} rotation-x={-Math.PI / 2} position={[16, 0, -1]} scale={[60, 22, 1]} />
      <mesh geometry={plane} material={M.ceiling} rotation-x={Math.PI / 2} position={[16, H, -1]} scale={[60, 22, 1]} />
      <mesh geometry={box} material={M.wall} position={[16, H / 2, -8.6]} scale={[60, H, 0.2]} />
      <mesh geometry={box} material={M.wall} position={[-7, H / 2, -1]} scale={[0.2, H, 22]} />
      <mesh geometry={box} material={M.wall} position={[41, H / 2, -1]} scale={[0.2, H, 22]} />
      {/* the front: a wall behind the walkway from the meeting room on (the lobby stays open to the entrance) */}
      <mesh geometry={box} material={M.wall} position={[24, H / 2, 6.2]} scale={[34, H, 0.2]} />
      <Boxes items={lights.panels} material={M.light} />
      <Boxes items={lights.halos} material={halo} />
      <Boxes items={windows.panes} material={M.sky} />
      <Boxes items={windows.mull} material={M.frame} />
      <Boxes items={detail.skirting} material={M.graphite} />
      <Boxes items={detail.gap} material={M.frame} />
      <Boxes items={detail.flutes} material={M.white} />
      {/* the walkway: a soft carpet runner (no light lines on the floor) */}
      <mesh geometry={plane} material={M.carpet} rotation-x={-Math.PI / 2} position={[19, 0.003, 2.7]} scale={[40, 2.2, 1]} />
    </group>
  );
}

/* ── the factory lobby: an open entrance hall with the logo wall and a welcome point ── */

function Reception() {
  const slats = useMemo(() => {
    const out: B[] = [];
    for (let x = -3.3; x <= 4.5; x += 0.15) out.push([x, H / 2, -3.86, 0.07, H, 0.06]);
    return out;
  }, []);
  const wordmark = useMemo(
    () =>
      canvasTexture("lobby-wordmark", 1024, 160, (g, w, h) => {
        g.fillStyle = "#ffffff";
        g.font = `600 92px ${FONT}`;
        track(g, -2);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("MADP Factory", w / 2, h / 2 + 4);
      }),
    [],
  );
  // the welcome screen is drawn in the language shown (one texture per language)
  const culture = useCulture();
  const welcome = useMemo(
    () =>
      canvasTexture(`lobby-welcome-${culture}`, 384, 640, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "#151a26");
        gr.addColorStop(1, "#0d1018");
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#5d86ff";
        g.fillRect(36, 70, 56, 6);
        g.fillStyle = "#ffffff";
        g.font = `600 46px ${FONT}`;
        track(g, -1);
        t("studio.cinematic.office.welcome", "Welcome\nto MADP\nFactory").split("\n").slice(0, 3).forEach((l, i) => g.fillText(l, 36, 140 + i * 52));
        track(g, 0);
        g.fillStyle = "rgba(255,255,255,0.6)";
        g.font = `500 22px ${FONT}`;
        g.fillText(t("studio.cinematic.office.visitStarts", "Your visit starts here."), 36, 300);
        g.fillStyle = "rgba(255,255,255,0.1)";
        roundRect(g, 36, h - 150, w - 72, 86, 18);
        g.fill();
        g.fillStyle = "#2fd59a";
        g.beginPath();
        g.arc(66, h - 107, 8, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#ffffff";
        g.font = `500 22px ${FONT}`;
        g.fillText(t("studio.cinematic.office.guideHere", "Your guide is here"), 86, h - 99);
      }),
    [culture],
  );
  return (
    <group>
      {/* the logo wall: graphite with fine warm-wood fins, the SELISE sign on its panel and the wordmark in light */}
      <mesh geometry={box} material={M.graphite} position={[0.6, H / 2, -3.97]} scale={[8.2, H, 0.1]} />
      <Boxes items={slats} material={M.wood} />
      <mesh geometry={box} material={M.glowBlue} position={[0.6, 0.06, -3.82]} scale={[8.0, 0.02, 0.02]} />
      <mesh geometry={box} material={M.glowBlue} position={[0.6, H - 0.08, -3.82]} scale={[8.0, 0.02, 0.02]} />
      <Logo3D position={[0.6, 2.42, -3.83]} width={2.56} />
      <mesh geometry={plane} position={[0.6, 1.42, -3.79]} scale={[2.9, 0.45, 1]}>
        <meshBasicMaterial map={wordmark} transparent toneMapped={false} />
      </mesh>
      {/* the welcome point: a slim totem with a screen, to the right of the wordmark so it never hides a letter of it
          (from the establishing view and the reception view alike) */}
      <group position={[2.35, 0, -2.0]} rotation-y={-0.25}>
        <RoundedBox args={[0.62, 1.62, 0.16]} radius={0.04} smoothness={2} position={[0, 0.81, 0]} material={M.graphite} />
        <Hotspot answers={["visitor", "name"]} geometry={plane} material={useMemo(() => new MeshBasicMaterial({ map: welcome, toneMapped: false }), [welcome])} position={[0, 0.98, 0.082]} scale={[0.5, 0.84, 1]} beacon={[0, 0.62, 0.1]} />
        <mesh geometry={box} material={M.glowBlue} position={[0, 0.02, 0.085]} scale={[0.5, 0.012, 0.012]} />
      </group>
      {/* an open lounge to the side: sofa, low table, planters */}
      <RoundedBox args={[2.2, 0.42, 0.85]} radius={0.14} smoothness={3} position={[-4.9, 0.21, 1.1]} rotation-y={Math.PI / 2} material={M.fabric} />
      <RoundedBox args={[2.2, 0.5, 0.2]} radius={0.08} smoothness={3} position={[-5.3, 0.62, 1.1]} rotation-y={Math.PI / 2} material={M.fabric} />
      <mesh geometry={cyl} material={M.white} position={[-3.8, 0.2, 1.1]} scale={[0.42, 0.4, 0.42]} />
    </group>
  );
}

/* ── doors ─────────────────────────────────────────────────────────────── */

const doorGlass = new MeshStandardMaterial({ color: "#dbe7ff", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });

function Door({ at, axis, width, double }: (typeof DOORS)[number]) {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const k = useRef(0);
  useFrame((st, dt) => {
    const c = st.camera.position;
    const near = Math.hypot(c.x - at[0], c.z - at[2]) < 4.2 || useJourney.getState().walk !== null && Math.hypot(c.x - at[0], c.z - at[2]) < 7;
    k.current += ((near ? 1 : 0) - k.current) * Math.min(1, dt * 2.2);
    const off = k.current * (double ? width / 2 : width) * 0.98;
    const s = double ? width / 2 : width;
    if (a.current) a.current.position.set(axis === "x" ? -off : 0, 0, axis === "z" ? -off : 0);
    if (b.current) b.current.position.set(axis === "x" ? off : 0, 0, axis === "z" ? off : 0);
    void s;
  });
  const pw = double ? width / 2 : width;
  const panel = (sign: number) => (
    <group position={axis === "x" ? [sign * (double ? pw / 2 : 0), 0, 0] : [0, 0, sign * (double ? pw / 2 : 0)]}>
      <mesh geometry={box} material={doorGlass} position={[0, 1.15, 0]} scale={axis === "x" ? [pw, 2.3, 0.03] : [0.03, 2.3, pw]} />
      <mesh geometry={box} material={M.frame} position={[0, 2.31, 0]} scale={axis === "x" ? [pw, 0.03, 0.05] : [0.05, 0.03, pw]} />
      <mesh geometry={box} material={M.frosted} position={[0, 1.15, 0]} scale={axis === "x" ? [pw, 0.12, 0.035] : [0.035, 0.12, pw]} />
    </group>
  );
  return (
    <group position={at}>
      <group ref={a}>{panel(double ? -1 : 0)}</group>
      {double && <group ref={b}>{panel(1)}</group>}
    </group>
  );
}

/* ── the meeting room ──────────────────────────────────────────────────── */

/** glass walls of a room: segments [x0, z0, x1, z1] with door gaps left out by the caller */
function GlassWalls({ segs }: { segs: [number, number, number, number][] }) {
  const items = useMemo(() => {
    const glass: B[] = [];
    const frost: B[] = [];
    const frame: B[] = [];
    for (const [x0, z0, x1, z1] of segs) {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const lx = Math.abs(x1 - x0) || 0.03;
      const lz = Math.abs(z1 - z0) || 0.03;
      glass.push([cx, 1.25, cz, lx, 2.5, lz]);
      frost.push([cx, 1.15, cz, lx + (lx > 0.05 ? 0 : 0.01), 0.14, lz + (lz > 0.05 ? 0 : 0.01)]);
      frame.push([cx, 2.52, cz, lx > 0.05 ? lx : 0.06, 0.05, lz > 0.05 ? lz : 0.06]);
      frame.push([cx, 0.02, cz, lx > 0.05 ? lx : 0.06, 0.04, lz > 0.05 ? lz : 0.06]);
      frame.push([x0, 1.25, z0, 0.06, 2.5, 0.06], [x1, 1.25, z1, 0.06, 2.5, 0.06]);
    }
    return { glass, frost, frame };
  }, [segs]);
  return (
    <>
      <Boxes items={items.glass} material={M.glass} />
      <Boxes items={items.frost} material={M.frosted} />
      <Boxes items={items.frame} material={M.frame} />
    </>
  );
}

const MEETING_GLASS: [number, number, number, number][] = [
  [7, 0.5, 7.55, 0.5], [9.05, 0.5, 14, 0.5], // front, door gap 7.55 … 9.05
  [7, -6, 7, 0.5], // west
  [14, -6, 14, -1.25], [14, 0.25, 14, 0.5], // east, door gap -1.25 … 0.25
];

function Meeting() {
  const wall = useWallScreen();
  const pendant = useRef<Mesh>(null);
  return (
    <group>
      <GlassWalls segs={MEETING_GLASS} />
      {/* the room's back wall: a solid wall carrying the screen; a soft rug */}
      <mesh geometry={box} material={M.wall} position={[10.5, H / 2, -6.05]} scale={[7, H, 0.1]} />
      <mesh geometry={plane} material={M.carpet} rotation-x={-Math.PI / 2} position={[10.5, 0.004, -2.8]} scale={[6.2, 5.6, 1]} />
      {/* the screen sits between the guides in the visitor's view: 3.6 m wide, its lower edge above head height */}
      <group position={[10.5, 2.2, -5.97]}>
        <mesh geometry={box} material={M.graphite} position={[0, 0, -0.02]} scale={[3.7, 1.9, 0.04]} />
        <Hotspot answers={["about", "website", "audience", "goal", "f0", "f1", "f2"]} geometry={plane} material={wall} position={[0, 0, 0.003]} scale={[3.6, 1.8, 1]} beacon={[1.65, 1.1, 0.25]} />
      </group>
      {/* the table and its chairs */}
      {/* the table runs towards the screen; chairs along its sides */}
      <Hotspot answers={["files"]} geometry={box} material={M.wood} position={[10.5, 0.74, -3.75]} scale={[1.45, 0.05, 3.3]} beacon={[0, 0.45, 1.2]}>
        <mesh geometry={box} material={M.graphite} position={[0, -0.37, 0]} scale={[0.14, 0.7, 2.5]} />
      </Hotspot>
      <Chairs at={[[9.45, -3.4, Math.PI / 2], [9.45, -4.2, Math.PI / 2], [9.45, -5.0, Math.PI / 2], [11.55, -3.4, -Math.PI / 2], [11.55, -4.2, -Math.PI / 2], [11.55, -5.0, -Math.PI / 2]]} />
      <mesh ref={pendant} geometry={box} material={M.light} position={[10.5, H - 0.55, -3.75]} scale={[0.18, 0.03, 2.6]} />
      <mesh geometry={box} material={M.frame} position={[10.5, H - 0.27, -3.75]} scale={[0.01, 0.55, 0.01]} />
    </group>
  );
}

/* ── the engineering floor ─────────────────────────────────────────────── */

function Engineering() {
  const monitor = useEngineerMonitor();
  const desks = useMemo(() => {
    const top: B[] = [];
    const legs: B[] = [];
    const screens: B[] = [];
    const chairs: [number, number, number][] = [];
    for (const z of [-3.6, -6.2]) for (const x of [15.8, 18.0, 20.2, 22.4]) {
      top.push([x, 0.74, z, 1.7, 0.04, 0.8]);
      legs.push([x - 0.8, 0.37, z, 0.04, 0.74, 0.7], [x + 0.8, 0.37, z, 0.04, 0.74, 0.7]);
      screens.push([x - 0.3, 1.08, z - 0.28, 0.56, 0.34, 0.025], [x + 0.32, 1.08, z - 0.28, 0.56, 0.34, 0.025]);
      chairs.push([x, z + 0.75, Math.PI]);
    }
    return { top, legs, screens, chairs };
  }, []);
  const screenGlow = useMemo(
    () =>
      canvasTexture("eng-code", 256, 160, (g, w, h) => {
        g.fillStyle = "#0f131c";
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) {
          g.fillStyle = i % 3 ? "rgba(201,210,230,0.7)" : "rgba(143,176,255,0.9)";
          g.fillRect(14 + (i % 4) * 10, 14 + i * 15, 60 + ((i * 53) % 140), 6);
        }
        void h;
      }),
    [],
  );
  const screenMat = useMemo(() => new MeshBasicMaterial({ map: screenGlow, toneMapped: false }), [screenGlow]);
  return (
    <group>
      <Boxes items={desks.top} material={M.white} />
      <Boxes items={desks.legs} material={M.steel} />
      <Boxes items={desks.screens} material={screenMat} />
      <Chairs at={desks.chairs} />
      {/* the engineer's desk at the front, with the big monitor */}
      <group position={[19.1, 0, -1.6]}>
        <mesh geometry={box} material={M.white} position={[0, 0.74, 0]} scale={[1.9, 0.04, 0.85]} />
        <mesh geometry={box} material={M.steel} position={[-0.9, 0.37, 0]} scale={[0.04, 0.74, 0.75]} />
        <mesh geometry={box} material={M.steel} position={[0.9, 0.37, 0]} scale={[0.04, 0.74, 0.75]} />
        <mesh geometry={box} material={M.graphite} position={[0, 0.9, -0.25]} scale={[0.08, 0.3, 0.08]} />
        <mesh geometry={box} material={M.graphite} position={[0, 1.24, -0.28]} scale={[1.24, 0.72, 0.04]} />
        {/* no beacon here: above the monitor it floated in the room as a stray dot; the hover outline and pointer still
            show the screen can be clicked */}
        <Hotspot answers={["github", "env"]} geometry={plane} material={monitor} position={[0, 1.24, -0.257]} scale={[1.18, 0.665, 1]} beacon={null} />
        <mesh geometry={box} material={M.graphite} position={[0, 0.77, 0.12]} scale={[0.5, 0.015, 0.16]} />
      </group>
      <Chairs at={[[19.1, -0.75, Math.PI]]} />
    </group>
  );
}

/* ── the build floor ───────────────────────────────────────────────────── */

const AGENTS = [
  ["analyst", "#7050F5"], ["techLead", "#1F5BFF"], ["reviewer", "#0EA5A4"], ["tester", "#D97706"],
  ["security", "#DC3237"], ["docs", "#04875F"], ["release", "#2CC7C0"],
] as const;
/** the agents' names on their desk screens, in the language shown */
const agentName = (id: (typeof AGENTS)[number][0]): string => ({
  analyst: () => t("studio.cinematic.hosts.businessAnalyst", "Business analyst"),
  techLead: () => t("studio.cinematic.office.techLead", "Tech lead"),
  reviewer: () => t("studio.cinematic.office.reviewer", "Reviewer"),
  tester: () => t("studio.cinematic.office.tester", "Tester"),
  security: () => t("studio.cinematic.office.security", "Security"),
  docs: () => t("studio.cinematic.office.docs", "Docs"),
  release: () => t("studio.cinematic.office.release", "Release"),
})[id]();
const BUILD_DESKS: [number, number][] = [[27.6, -2.8], [30.6, -2.8], [33.6, -2.8], [36.6, -2.8], [29.1, -5.4], [32.1, -5.4], [35.1, -5.4]];

function BuildFloor() {
  const board = useBuildBoard();
  const phase = useJourney((s) => s.phase);
  const k = useRef(0);
  const lamps = useMemo(() => AGENTS.map(([, c]) => new MeshBasicMaterial({ color: new Color(c), toneMapped: false })), []);
  const culture = useCulture();
  const screens = useMemo(() => AGENTS.map(([id, c]) =>
    new MeshBasicMaterial({
      toneMapped: false,
      map: canvasTexture(`agent-${id}-${culture}`, 256, 160, (g, w, h) => {
        const name = agentName(id);
        g.fillStyle = "#0f131c";
        g.fillRect(0, 0, w, h);
        g.fillStyle = c;
        g.fillRect(0, 0, w, 6);
        g.fillStyle = "#ffffff";
        // the name at 30 px, smaller when it would run past the screen's edge ("Business analyst")
        let px = 30;
        g.font = `600 ${px}px ${FONT}`;
        while (px > 18 && g.measureText(name).width > w - 36) g.font = `600 ${(px -= 2)}px ${FONT}`;
        g.fillText(name, 18, 52);
        for (let i = 0; i < 5; i++) {
          g.fillStyle = "rgba(255,255,255,0.35)";
          g.fillRect(18, 76 + i * 15, 70 + ((i * 41) % 130), 6);
        }
        void h;
      }),
    })), [culture]);
  const base = useMemo(() => new Color("#000000"), []);
  const lit = useMemo(() => AGENTS.map(([, c]) => new Color(c).multiplyScalar(1.8)), []);
  useFrame((_, dt) => {
    const target = phase === "handoff" ? 1 : 0.06;
    const before = k.current;
    k.current += (target - k.current) * Math.min(1, dt * 1.1);
    if (Math.abs(before - k.current) < 1e-4) return;
    AGENTS.forEach(([, c], i) => {
      void c;
      lamps[i].color.copy(base).lerp(lit[i], k.current);
      screens[i].color.setScalar(0.12 + 0.88 * k.current);
    });
  });
  const desks = useMemo(() => {
    const top: B[] = [];
    const legs: B[] = [];
    for (const [x, z] of BUILD_DESKS) {
      top.push([x, 0.74, z, 2.0, 0.04, 0.85]);
      legs.push([x, 0.37, z - 0.3, 1.8, 0.7, 0.04]);
    }
    return { top, legs };
  }, []);
  return (
    <group>
      <GlassWalls segs={[[24.5, -8.5, 24.5, 1.1], [24.5, 3.5, 24.5, 6]]} />
      {[0, 1].map((i) => <mesh key={i} geometry={box} material={M.frame} position={[24.5, H - 0.4, 2.3]} scale={[0.08, 0.06, 2.4]} />)}
      <mesh geometry={box} material={M.frame} position={[24.5, (H + 2.5) / 2, 2.3]} scale={[0.06, H - 2.5, 2.5]} />
      <Boxes items={desks.top} material={M.white} />
      <Boxes items={desks.legs} material={M.graphite} />
      {BUILD_DESKS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh geometry={box} material={M.graphite} position={[0, 1.12, -0.3]} scale={[0.86, 0.5, 0.03]} />
          <mesh geometry={plane} material={screens[i]} position={[0, 1.12, -0.284]} scale={[0.82, 0.46, 1]} />
          <mesh geometry={box} material={lamps[i]} position={[0, 0.765, 0.41]} scale={[1.9, 0.012, 0.012]} />
          <mesh geometry={box} material={lamps[i]} position={[0, H - 0.6, 0]} scale={[1.6, 0.02, 0.1]} />
        </group>
      ))}
      <Chairs at={BUILD_DESKS.map(([x, z]) => [x, z + 0.75, Math.PI] as [number, number, number])} />
      <group position={[32, 2.05, -8.28]}>
        <mesh geometry={box} material={M.graphite} position={[0, 0, -0.02]} scale={[6.6, 2.7, 0.04]} />
        <Hotspot answers={["launch"]} geometry={plane} material={board} position={[0, 0, 0.003]} scale={[6.5, 2.6, 1]} beacon={[3.0, 1.5, 0.3]} />
      </group>
    </group>
  );
}

/* ── the floor, mounted place by place ─────────────────────────────────── */

const PLACES: Record<StageId, () => JSX.Element> = { reception: Reception, meeting: Meeting, engineering: Engineering, buildfloor: BuildFloor };

export function Office() {
  const stage = useJourney((s) => s.stage);
  // the whole floor mounts during the intro (World's Warmup then compiles every shader and uploads every texture once,
  // before the visitor walks in), so nothing is built, compiled or uploaded later in the visit
  const [built, setBuilt] = useState<Set<StageId>>(() => new Set<StageId>(STAGE_ORDER));
  useEffect(() => {
    const next = STAGE_ORDER[stageIndex(stage) + 1];
    setBuilt((b) => (b.has(stage) && (!next || b.has(next)) ? b : new Set([...b, stage, ...(next ? [next] : [])])));
  }, [stage]);
  return (
    <group>
      <Shell />
      <Plants />
      {STAGE_ORDER.filter((id) => built.has(id)).map((id) => {
        const P = PLACES[id];
        return <P key={id} />;
      })}
      {DOORS.map((d) => <Door key={d.id} {...d} />)}
    </group>
  );
}
