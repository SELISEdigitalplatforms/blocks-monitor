/** Low-poly building blocks for the cinematic world: boxes, cylinders, walls with openings and canvas-drawn signs.
 *  Everything is built in code (no downloads); signs are drawn on a 2D canvas, so no font file is fetched. */

import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { wallPieces, type Opening, type V3 } from "./journeyScenes";

export interface BoxProps {
  p: V3;
  s: V3;
  c: string;
  r?: number;
  e?: string;
  ei?: number;
  rough?: number;
  metal?: number;
  opacity?: number;
  shadow?: boolean;
}

export function Box({ p, s, c, r = 0, e, ei = 1, rough = 0.85, metal = 0, opacity, shadow = true }: BoxProps) {
  return (
    <mesh position={p as [number, number, number]} rotation={[0, r, 0]} castShadow={shadow} receiveShadow>
      <boxGeometry args={s as [number, number, number]} />
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e ?? "#000000"} emissiveIntensity={e ? ei : 0}
        transparent={opacity !== undefined} opacity={opacity ?? 1} depthWrite={opacity === undefined} />
    </mesh>
  );
}

export function Cyl({ p, rt, rb, h, c, seg = 14, e, ei = 1, rough = 0.8, metal = 0 }: {
  p: V3; rt: number; rb: number; h: number; c: string; seg?: number; e?: string; ei?: number; rough?: number; metal?: number;
}) {
  return (
    <mesh position={p as [number, number, number]} castShadow receiveShadow>
      <cylinderGeometry args={[rt, rb, h, seg]} />
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e ?? "#000000"} emissiveIntensity={e ? ei : 0} />
    </mesh>
  );
}

/** A wall along x (at z) or along z (at x), with openings; `glass` fills window openings (y0 > 0) with glass. */
export function Wall({ axis, at, from, to, h = 3.2, t = 0.16, c, openings = [], glass }: {
  axis: "x" | "z"; at: number; from: number; to: number; h?: number; t?: number; c: string; openings?: Opening[]; glass?: string;
}) {
  const pieces = wallPieces(from, to, h, openings);
  return (
    <group>
      {pieces.map(([m, len, y0, y1], i) => (
        <Box key={i} c={c} p={axis === "x" ? [m, (y0 + y1) / 2, at] : [at, (y0 + y1) / 2, m]}
          s={axis === "x" ? [len, y1 - y0, t] : [t, y1 - y0, len]} />
      ))}
      {glass && openings.filter((o) => o.y0 > 0).map((o, i) => (
        <Box key={`g${i}`} c={glass} opacity={0.28} rough={0.05} shadow={false}
          p={axis === "x" ? [o.at, (o.y0 + o.y1) / 2, at] : [at, (o.y0 + o.y1) / 2, o.at]}
          s={axis === "x" ? [o.w, o.y1 - o.y0, 0.03] : [0.03, o.y1 - o.y0, o.w]} />
      ))}
    </group>
  );
}

/** A floor or ceiling rectangle (x0..x1, z0..z1) at height y; ceilings face down. */
export function Slab({ x0, x1, z0, z1, y = 0, c, ceiling = false, rough = 0.9 }: { x0: number; x1: number; z0: number; z1: number; y?: number; c: string; ceiling?: boolean; rough?: number }) {
  return (
    <mesh position={[(x0 + x1) / 2, y, (z0 + z1) / 2]} rotation={[ceiling ? Math.PI / 2 : -Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
      <meshStandardMaterial color={c} roughness={rough} />
    </mesh>
  );
}

/** A sign drawn on a canvas: a title and an optional second line, in the page's own font. */
export function useSignTexture(title: string, sub: string | undefined, bg: string, fg: string, w = 512, h = 160) {
  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const font = getComputedStyle(document.body).fontFamily || "sans-serif";
      g.font = `600 ${Math.round(h * (sub ? 0.3 : 0.4))}px ${font}`;
      g.fillText(title, w / 2, sub ? h * 0.38 : h / 2, w * 0.92);
      if (sub) {
        g.globalAlpha = 0.78;
        g.font = `400 ${Math.round(h * 0.18)}px ${font}`;
        g.fillText(sub, w / 2, h * 0.72, w * 0.92);
      }
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [title, sub, bg, fg, w, h]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function Sign({ p, r = 0, size, title, sub, bg, fg, glow = 0.55 }: {
  p: V3; r?: number; size: [number, number]; title: string; sub?: string; bg: string; fg: string; glow?: number;
}) {
  const tex = useSignTexture(title, sub, bg, fg, 512, Math.round(512 * (size[1] / size[0])));
  return (
    <mesh position={p as [number, number, number]} rotation={[0, r, 0]}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={glow} roughness={0.6} toneMapped={false} />
    </mesh>
  );
}
