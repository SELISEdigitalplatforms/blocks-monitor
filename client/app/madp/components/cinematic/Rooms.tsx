/** The rooms of the cinematic journey, built from low-poly geometry (see the world map in journeyScenes.ts). */

import { useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, SRGBColorSpace, type Group, type MeshStandardMaterial } from "three";
import { BACK_DOOR_X, journeyStops, ROOM_X, type CinematicType, type V3 } from "./journeyScenes";
import { Box, Cyl, Sign, Slab, Wall } from "./parts";
import { useT } from "@/madp/i18n";

/** The app's action colour (the same fill in both themes: --c-accent). */
export const ACCENT = "#1f5bff";
const H = 3.2;

function Chair({ p, r = 0, c }: { p: V3; r?: number; c: string }) {
  const [x, , z] = p;
  const back: V3 = [x - Math.sin(r) * 0.2, 0.72, z - Math.cos(r) * 0.2];
  return (
    <group>
      <Box p={[x, 0.45, z]} s={[0.44, 0.06, 0.44]} c={c} r={r} />
      <Box p={back} s={[0.44, 0.5, 0.05]} c={c} r={r} />
      <Cyl p={[x, 0.22, z]} rt={0.03} rb={0.05} h={0.44} c="#2a2a2e" metal={0.6} rough={0.4} />
    </group>
  );
}

function Plant({ p, s = 1 }: { p: V3; s?: number }) {
  const [x, , z] = p;
  return (
    <group>
      <Cyl p={[x, 0.22 * s, z]} rt={0.22 * s} rb={0.17 * s} h={0.44 * s} c="#c4b5a0" />
      <mesh position={[x, 0.85 * s, z]} castShadow>
        <icosahedronGeometry args={[0.42 * s, 0]} />
        <meshStandardMaterial color="#3f7d52" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function Tree({ p }: { p: V3 }) {
  const [x, , z] = p;
  return (
    <group>
      <Cyl p={[x, 0.9, z]} rt={0.09} rb={0.13} h={1.8} c="#5b4636" />
      <mesh position={[x, 2.5, z]} castShadow>
        <coneGeometry args={[0.9, 2.2, 7]} />
        <meshStandardMaterial color="#2f5d43" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function Pendant({ p, c = "#ffcf8a" }: { p: V3; c?: string }) {
  const [x, y, z] = p;
  return (
    <group>
      <Cyl p={[x, (y + H) / 2, z]} rt={0.008} rb={0.008} h={H - y} c="#222" seg={4} />
      <Cyl p={[x, y, z]} rt={0.08} rb={0.22} h={0.2} c="#1d1d1f" metal={0.4} rough={0.5} />
      <mesh position={[x, y - 0.1, z]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={3} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A glowing doorway the visitor can click (the lobby entrances, the product team's door). */
export function Hotspot({ p, s, active, onClick, onHover, highlight = false, pulse = false }: {
  p: V3; s: V3; active: boolean; onClick: () => void; onHover?: (on: boolean) => void; highlight?: boolean; pulse?: boolean;
}) {
  const [hover, setHover] = useState(false);
  useCursor(active && hover);
  const mat = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    const lit = active && (hover || highlight);
    const base = !active ? 0 : lit ? 0.38 : pulse ? 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3)) : 0.1;
    mat.current.opacity = base;
  });
  return (
    <mesh position={p as [number, number, number]}
      onPointerOver={(e) => { if (!active) return; e.stopPropagation(); setHover(true); onHover?.(true); }}
      onPointerOut={() => { setHover(false); onHover?.(false); }}
      onClick={(e) => { if (!active) return; e.stopPropagation(); onClick(); }}>
      <boxGeometry args={s as [number, number, number]} />
      <meshStandardMaterial ref={mat} color={ACCENT} emissive={ACCENT} emissiveIntensity={1.4} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/* ── outside ─────────────────────────────────────────────────────────────── */

/** Three floors of office windows above the street, drawn once on a canvas: some lit warm, some cool, some dark. */
function UpperWindows() {
  const tex = useMemo(() => {
    const [w, h] = [1024, 352];
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#2b2f3a";
      g.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 16; col++) {
          const r = rnd();
          g.fillStyle = "#1c2029";
          g.fillRect(12 + col * 63, 20 + row * 112, 50, 78);
          g.fillStyle = r < 0.4 ? "#c9a46e" : r < 0.62 ? "#8f9cc0" : "#121621";
          g.fillRect(16 + col * 63, 24 + row * 112, 42, 70);
        }
      }
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[0, 6.6, 6.22]}>
      <planeGeometry args={[20.4, 6.8]} />
      <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.3} roughness={0.8} />
    </mesh>
  );
}

export function Lobby() {
  const t = useT();
  return (
    <group>
      <Slab x0={-30} x1={30} z0={6} z1={34} c="#5d5953" />
      {/* pavement strip along the facade */}
      <Box p={[0, 0.02, 7.2]} s={[22, 0.04, 2.4]} c="#8a847a" />
      {/* the floors above the rooms, lit windows on the street side */}
      <mesh position={[0, 6.6, -5]}>
        <boxGeometry args={[20.4, 6.8, 22.4]} />
        <meshStandardMaterial color="#2b2f3a" roughness={0.9} />
      </mesh>
      <UpperWindows />
      {/* core between the rooms */}
      <Box p={[0, H / 2, 1]} s={[3.84, H, 9.84]} c="#3a3e48" />
      <Sign p={[0, 2.1, 6.0]} size={[3, 0.75]} title="MADP Factory" sub={t("studio.cinematic.rooms.tagline", "Software, built with you")} bg="#111421" fg="#eef1ff" glow={0.9} />
      <Sign p={[-ROOM_X, 2.85, 6.1]} size={[2.6, 0.6]} title={t("studio.cinematic.places.coffeeShop", "Coffee shop")} sub={t("studio.cinematic.rooms.coffeeShopSub", "New product · start something new")} bg="#2b1810" fg="#ffe3c2" glow={0.9} />
      <Sign p={[ROOM_X, 2.85, 6.1]} size={[2.6, 0.6]} title={t("studio.cinematic.places.meetingRoom", "Meeting room")} sub={t("studio.cinematic.rooms.meetingRoomSub", "Existing product · change what exists")} bg="#101a2b" fg="#d8e6ff" glow={0.9} />
      {/* café awning */}
      <Box p={[-ROOM_X, 2.5, 6.55]} s={[2.0, 0.07, 0.9]} c="#2f6d5a" />
      {/* street lamps, planters, a bench */}
      {[-2.2, 2.2].map((x) => (
        <group key={x}>
          <Cyl p={[x, 1.6, 8.2]} rt={0.05} rb={0.07} h={3.2} c="#1d1f26" metal={0.5} rough={0.5} />
          <Cyl p={[x, 3.32, 8.2]} rt={0.2} rb={0.08} h={0.12} c="#1d1f26" metal={0.5} rough={0.5} />
          <mesh position={[x, 3.2, 8.2]}>
            <sphereGeometry args={[0.09, 12, 10]} />
            <meshStandardMaterial color="#ffe2b0" emissive="#ffc77a" emissiveIntensity={1.6} />
          </mesh>
        </group>
      ))}
      <Tree p={[-9.6, 0, 9.4]} />
      <Tree p={[9.6, 0, 9.4]} />
      <Tree p={[-11.5, 0, 14]} />
      <Tree p={[11.5, 0, 14]} />
      <Box p={[0, 0.42, 9.2]} s={[1.8, 0.08, 0.5]} c="#7a5a3e" />
      <Box p={[0, 0.2, 9.2]} s={[1.6, 0.4, 0.06]} c="#2a2a2e" />
    </group>
  );
}

/* ── the coffee shop (greenfield) ───────────────────────────────────────── */

export function CoffeeShop() {
  const t = useT();
  const x = -ROOM_X;
  return (
    <group>
      <Slab x0={-10} x1={-2} z0={-4} z1={6} c="#8a5a3b" rough={0.7} />
      <Slab x0={-10} x1={-2} z0={-4} z1={6} y={H - 0.02} c="#cdb595" ceiling />
      <Wall axis="x" at={6} from={-10} to={-2} c="#7a3f2c" glass="#cfe6ff"
        openings={[{ at: x, w: 1.4, y0: 0, y1: 2.4 }, { at: -8.6, w: 2, y0: 0.9, y1: 2.5 }, { at: -3.4, w: 1.6, y0: 0.9, y1: 2.5 }]} />
      <Wall axis="x" at={-4} from={-10} to={-2} c="#e8d6bf" openings={[{ at: -BACK_DOOR_X, w: 1.2, y0: 0, y1: 2.3 }]} />
      <Wall axis="z" at={-10} from={-4} to={6} c="#e2cdb1" />
      {/* counter, espresso machine, pastry case, menu */}
      <Box p={[-8.2, 0.52, -3.25]} s={[2.8, 1.04, 0.7]} c="#4a2f22" />
      <Box p={[-8.2, 1.06, -3.25]} s={[2.9, 0.05, 0.78]} c="#d8cfc4" rough={0.3} />
      <Box p={[-9.0, 1.3, -3.35]} s={[0.6, 0.45, 0.4]} c="#b9bec6" metal={0.8} rough={0.25} />
      <Box p={[-7.6, 1.25, -3.2]} s={[0.9, 0.35, 0.5]} c="#cfe6ff" opacity={0.35} rough={0.05} />
      <Sign p={[-8.2, 2.3, -3.91]} size={[2.2, 0.9]} title={t("studio.cinematic.rooms.cafeBoard", "Coffee · Tea · Ideas")} sub={t("studio.cinematic.rooms.cafeBoardSub", "Tell us what you would build")} bg="#262321" fg="#f4e7d0" glow={0.6} />
      <Box p={[-8.2, 1.75, -3.85]} s={[2.6, 0.04, 0.22]} c="#5a3a28" />
      {/* the agent's table */}
      <Cyl p={[x, 1.05, 0.65]} rt={0.48} rb={0.48} h={0.04} c="#3a2a20" rough={0.4} />
      <Cyl p={[x, 0.52, 0.65]} rt={0.04} rb={0.04} h={1.02} c="#1f1f22" metal={0.6} />
      <Cyl p={[x, 0.02, 0.65]} rt={0.25} rb={0.28} h={0.04} c="#1f1f22" metal={0.6} />
      <Cyl p={[x - 0.15, 1.12, 0.55]} rt={0.045} rb={0.035} h={0.1} c="#f3f0ea" />
      <Cyl p={[x + 0.2, 1.12, 0.8]} rt={0.045} rb={0.035} h={0.1} c="#f3f0ea" />
      <Pendant p={[x, 2.45, 0.65]} />
      {/* other tables */}
      {([[-8.6, 2.2], [-8.6, 4.4], [-3.6, 4.4]] as const).map(([tx, tz]) => (
        <group key={`${tx}${tz}`}>
          <Cyl p={[tx, 0.74, tz]} rt={0.42} rb={0.42} h={0.04} c="#6b4a33" />
          <Cyl p={[tx, 0.37, tz]} rt={0.04} rb={0.04} h={0.74} c="#1f1f22" />
          <Chair p={[tx - 0.62, 0, tz]} r={Math.PI / 2} c="#2f6d5a" />
          <Chair p={[tx + 0.62, 0, tz]} r={-Math.PI / 2} c="#2f6d5a" />
          <Pendant p={[tx, 2.2, tz]} />
        </group>
      ))}
      <Plant p={[-9.4, 0, 5.4]} />
      <Plant p={[-2.5, 0, -3.4]} s={0.9} />
      <Plant p={[-9.4, 0, -1.6]} s={0.8} />
      <Sign p={[-BACK_DOOR_X, 2.62, -3.9]} size={[1.4, 0.34]} title={t("studio.cinematic.rooms.toProductTeam", "Product team →")} bg="#1b1c22" fg="#ffffff" glow={0.8} />
    </group>
  );
}

/* ── the meeting room (brownfield) ──────────────────────────────────────── */

export function MeetingRoom() {
  const t = useT();
  const x = ROOM_X;
  return (
    <group>
      <Slab x0={2} x1={10} z0={-4} z1={6} c="#59606b" />
      <Slab x0={2} x1={10} z0={-4} z1={6} y={H - 0.02} c="#e9ecef" ceiling />
      <Wall axis="x" at={6} from={2} to={10} c="#3c4655" glass="#cfe6ff"
        openings={[{ at: x, w: 1.4, y0: 0, y1: 2.4 }, { at: 3.6, w: 2.0, y0: 0.4, y1: 2.7 }, { at: 8.4, w: 2.2, y0: 0.4, y1: 2.7 }]} />
      <Wall axis="x" at={-4} from={2} to={10} c="#dfe3e8" openings={[{ at: BACK_DOOR_X, w: 1.2, y0: 0, y1: 2.3 }]} />
      <Wall axis="z" at={10} from={-4} to={6} c="#d5dae1" />
      {/* the table and its chairs */}
      <Box p={[x, 0.74, 0.65]} s={[2.6, 0.06, 1.2]} c="#c8b49a" rough={0.45} />
      <Box p={[x - 1.0, 0.36, 0.65]} s={[0.08, 0.72, 0.9]} c="#2c3340" />
      <Box p={[x + 1.0, 0.36, 0.65]} s={[0.08, 0.72, 0.9]} c="#2c3340" />
      {[-0.7, 0, 0.7].map((dx) => (
        <group key={dx}>
          <Chair p={[x + dx, 0, -0.15]} r={0} c="#2c3340" />
          <Chair p={[x + dx * 0.9 + 1.55 * Math.sign(dx || 1), 0, 0.65]} r={Math.sign(dx || 1) * -Math.PI / 2} c="#2c3340" />
        </group>
      ))}
      <Box p={[x - 0.4, 0.79, 0.55]} s={[0.34, 0.02, 0.24]} c="#22252b" />
      <Box p={[x + 0.5, 0.78, 0.8]} s={[0.21, 0.01, 0.3]} c="#f4f4f4" r={0.3} />
      {/* the screen with today's product, the whiteboard */}
      <Sign p={[7.6, 1.75, -3.9]} size={[2.6, 1.3]} title={t("studio.cinematic.rooms.productToday", "Your product today")} sub={t("studio.cinematic.rooms.productTodaySub", "What works · what hurts · what should change")} bg="#12233f" fg="#cfe3ff" glow={1} />
      <Box p={[7.6, 1.75, -3.95]} s={[2.75, 1.42, 0.04]} c="#111" />
      <Box p={[9.9, 1.6, 1.4]} s={[0.04, 1.1, 2.2]} c="#f7f7f5" rough={0.3} />
      {[[0.9, 0.5, "#f5c84c"], [1.6, 1.1, "#7ad0a6"], [1.9, 1.7, "#f59fb0"]].map(([y, z, c]) => (
        <Box key={String(z)} p={[9.86, 1.2 + Number(y) * 0.4, Number(z) + 0.1]} s={[0.01, 0.16, 0.16]} c={String(c)} />
      ))}
      <Plant p={[9.4, 0, 5.4]} />
      <Cyl p={[x, 2.9, 0.65]} rt={0.9} rb={0.9} h={0.05} c="#f2f4f7" e="#f2f6ff" ei={1.4} seg={24} />
      <Sign p={[BACK_DOOR_X, 2.62, -3.9]} size={[1.4, 0.34]} title={t("studio.cinematic.rooms.toProductTeam", "Product team →")} bg="#1b1c22" fg="#ffffff" glow={0.8} />
    </group>
  );
}

/* ── behind the rooms: the corridor and the product team ────────────────── */

function ProductDoor({ open, reduced }: { open: boolean; reduced: boolean }) {
  const leaf = useRef<Group>(null);
  useFrame((_, dt) => {
    if (!leaf.current) return;
    const target = open ? 1.75 : 0;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 2.4);
    leaf.current.rotation.y += (target - leaf.current.rotation.y) * k;
  });
  return (
    <group position={[-0.6, 0, -8]}>
      <group ref={leaf}>
        <Box p={[0.6, 1.15, 0]} s={[1.18, 2.3, 0.06]} c="#2e3a52" rough={0.5} />
        <Cyl p={[1.05, 1.05, 0.06]} rt={0.03} rb={0.03} h={0.18} c="#d4d8e0" metal={0.9} rough={0.2} />
      </group>
    </group>
  );
}

export function Corridor({ type, doorOpen, reduced }: { type: CinematicType | null; doorOpen: boolean; reduced: boolean }) {
  const t = useT();
  const stops = journeyStops(type ?? "greenfield");
  const product = stops[1];
  return (
    <group>
      <Slab x0={-10} x1={10} z0={-8} z1={-4} c="#9a948c" />
      <Slab x0={-10} x1={10} z0={-8} z1={-4} y={H - 0.02} c="#e6e2db" ceiling />
      <Wall axis="x" at={-8} from={-10} to={10} c="#d8d4cd" openings={[{ at: 0, w: 1.2, y0: 0, y1: 2.3 }]} />
      <Wall axis="z" at={-10} from={-8} to={-4} c="#d0ccc5" />
      <Wall axis="z" at={10} from={-8} to={-4} c="#d0ccc5" />
      <Box p={[0, H / 2, -4]} s={[3.84, H, 0.16]} c="#d8d4cd" />
      <ProductDoor open={doorOpen} reduced={reduced} />
      <Box p={[0, 2.36, -7.95]} s={[1.36, 0.1, 0.1]} c="#1d2333" />
      <Sign p={[0, 2.72, -7.9]} size={[1.9, 0.5]} title={t("studio.cinematic.rooms.productTeam", "Product team")} sub={product.label} bg="#121a2e" fg="#ffffff" glow={0.9} />
      {/* the doors further along the journey, closed for now */}
      {([[-6.5, stops[2]], [6.5, stops[3]]] as const).map(([dx, st]) => (
        <group key={dx}>
          <Box p={[dx, 1.15, -7.9]} s={[1.18, 2.3, 0.04]} c="#5b6272" />
          <Sign p={[dx, 2.62, -7.9]} size={[1.6, 0.42]} title={st.label} sub={t("studio.cinematic.rooms.later", "Later on the journey")} bg="#2a2f3c" fg="#e6e9f2" glow={0.4} />
        </group>
      ))}
      {[-6, 0, 6].map((lx) => <Cyl key={lx} p={[lx, H - 0.05, -6]} rt={0.35} rb={0.35} h={0.04} c="#fff" e="#fff6e8" ei={1.2} seg={20} />)}
    </group>
  );
}

export function ProductRoom() {
  return (
    <group>
      <Slab x0={-4} x1={4} z0={-16} z1={-8} c="#7d6a58" rough={0.7} />
      <Slab x0={-4} x1={4} z0={-16} z1={-8} y={H - 0.02} c="#ecebf2" ceiling />
      <Wall axis="x" at={-16} from={-4} to={4} c="#e4e0f0" glass="#a9c6ff" openings={[{ at: 0, w: 4, y0: 0.8, y1: 2.6 }]} />
      {/* the city at night behind the window */}
      <mesh position={[0, 1.7, -16.6]}>
        <planeGeometry args={[6, 3]} />
        <meshStandardMaterial color="#141b33" emissive="#1c2a55" emissiveIntensity={0.8} />
      </mesh>
      {[-1.6, -0.7, 0.4, 1.3, 2.0].map((bx, i) => (
        <Box key={bx} p={[bx, 0.8 + (i % 3) * 0.25, -16.5]} s={[0.6, 1.6 + (i % 3) * 0.5, 0.05]} c="#0d1226" e="#ffd27a" ei={0.08} shadow={false} />
      ))}
      <Wall axis="z" at={-4} from={-16} to={-8} c="#dcd8ea" />
      <Wall axis="z" at={4} from={-16} to={-8} c="#dcd8ea" />
      {/* desk, monitor, chair */}
      <Box p={[0, 0.75, -13.6]} s={[1.8, 0.05, 0.8]} c="#e9e4dc" rough={0.4} />
      <Box p={[-0.85, 0.37, -13.6]} s={[0.05, 0.74, 0.7]} c="#3a3a40" />
      <Box p={[0.85, 0.37, -13.6]} s={[0.05, 0.74, 0.7]} c="#3a3a40" />
      <Box p={[0, 1.1, -13.85]} s={[0.9, 0.52, 0.04]} c="#15171d" e="#3a6cff" ei={0.35} />
      <Chair p={[0, 0, -14.3]} r={0} c="#3b3f4c" />
      {/* the product board: sticky notes */}
      <Box p={[-3.9, 1.6, -12]} s={[0.04, 1.3, 2.6]} c="#fafafa" rough={0.3} />
      {Array.from({ length: 12 }, (_, i) => (
        <Box key={i} p={[-3.86, 1.15 + Math.floor(i / 4) * 0.36, -13 + (i % 4) * 0.62]} s={[0.01, 0.22, 0.22]}
          c={["#f5c84c", "#7ad0a6", "#f59fb0", "#9cc0ff"][(i * 7) % 4]} />
      ))}
      <Box p={[3.8, 1.0, -11.5]} s={[0.35, 2.0, 1.6]} c="#6d5643" />
      <Plant p={[3.3, 0, -15.3]} />
      <Cyl p={[0, H - 0.05, -12]} rt={0.5} rb={0.5} h={0.04} c="#fff" e="#fff6e8" ei={1.3} seg={20} />
    </group>
  );
}
