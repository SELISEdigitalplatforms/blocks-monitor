/** The stations on the full stage: hover one for a highlight and a card saying who works there and what they do
 *  (the real pipeline state, or "Free desk"); click it to pick its agent, like clicking the agent. A soft glow lies
 *  under each station whose agent works, waits or failed (nothing while idle: the floor never pretends). */

import { Html, useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, MeshBasicMaterial, type Texture } from "three";
import type { Vec2 } from "./layout";
import { agentStatusText } from "./roles";
import { useT } from "@/madp/i18n";
import { type GlowTone, type Hotspot, glowTone } from "./stations";
import type { Theme } from "./Furniture";

let glowMap: Texture | null = null;
/** a soft round falloff, drawn once per session */
function glowTexture(): Texture | null {
  if (glowMap) return glowMap;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.45, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowMap = new CanvasTexture(c);
  return glowMap;
}

/** hit areas are never drawn (invisible objects still take pointer events in R3F) */
const NO_HIT = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export function StationHotspots({ spots, theme, onPick, reducedMotion }: {
  spots: Hotspot[]; theme: Theme; onPick?: (agentId: string, at: Vec2) => void; reducedMotion: boolean;
}) {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);
  const h = spots.find((s) => s.key === hover);
  useCursor(Boolean(h?.agent && onPick));
  const tones = useMemo<Record<GlowTone, string>>(() => ({ brand: theme.brand, warning: theme.warning, danger: theme.danger }), [theme.brand, theme.warning, theme.danger]);
  const glows = spots.flatMap((s) => {
    const tone = glowTone(s.agent?.status);
    return tone ? [{ s, tone }] : [];
  });
  const line = h ? (h.agent
    ? `${h.agent.label} · ${agentStatusText(h.agent)}`
    : h.key.startsWith("desk-") ? t("studio.office.stations.freeDesk", "Free desk") : t("studio.office.stations.nobodyHere", "Nobody here yet")) : "";
  return (
    <group>
      {spots.map((s) => (
        <mesh key={s.key} position={[s.x, 0.6, s.z]} material={NO_HIT} visible={false}
          onPointerOver={(e) => { e.stopPropagation(); setHover(s.key); }}
          onPointerOut={() => setHover((k) => (k === s.key ? null : k))}
          onClick={(e) => {
            if (e.delta > 4 || !s.agent || !onPick) return;
            e.stopPropagation();
            onPick(s.agent.id, { x: s.x, z: s.z });
          }}>
          <boxGeometry args={[s.w, 1.2, s.d]} />
        </mesh>
      ))}
      {glows.map(({ s, tone }) => <Glow key={s.key} spot={s} color={tones[tone]} dark={theme.dark} reducedMotion={reducedMotion} />)}
      {h && (
        <group position={[h.x, 0, h.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]} renderOrder={1}>
            <planeGeometry args={[h.w + 0.5, h.d + 0.5]} />
            <meshBasicMaterial color={theme.brand} transparent opacity={theme.dark ? 0.24 : 0.16} depthWrite={false} />
          </mesh>
          <Html position={[0, 2.55, 0]} center zIndexRange={[40, 30]} style={{ pointerEvents: "none" }}>
            <div className="fo-shadow-pop w-max max-w-[15rem] rounded-block bg-[rgb(var(--surface)/0.92)] px-3 py-2 text-[12px] leading-snug text-[rgb(var(--ink))] backdrop-blur">
              <div className="font-semibold">{h.name}</div>
              <div className="text-[rgb(var(--ink-3))]">{line}</div>
              {h.agent?.detail && <div className="line-clamp-2 text-[rgb(var(--ink-2,var(--ink-3)))]">{h.agent.detail}</div>}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

/** a soft pulse of the station's state colour on the floor */
function Glow({ spot, color, dark, reducedMotion }: { spot: Hotspot; color: string; dark: boolean; reducedMotion: boolean }) {
  const map = glowTexture();
  const base = dark ? 0.5 : 0.38;
  const mat = useMemo(() => new MeshBasicMaterial({ map, color, transparent: true, opacity: base, depthWrite: false }), [map, color, base]);
  useEffect(() => () => mat.dispose(), [mat]);
  const seed = useRef(spot.x * 0.37 + spot.z);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    mat.opacity = base * (0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.2 + seed.current));
  });
  return (
    <mesh position={[spot.x, 0.009, spot.z + 0.4]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={1}>
      <planeGeometry args={[spot.w + 1.6, spot.d + 2.0]} />
    </mesh>
  );
}
