/** The SELISE sign on the lobby wall: the official SELISE logo (the selise.ch header SVG, white, in public/brand) on a
 *  solid dark backing panel mounted on the slat wall, so no slat shows through or around the letters. The SVG's paths
 *  are extruded without a bevel (the exact official outlines): flat white faces, light grey returns. One mesh for the
 *  faces, one for the returns, one for the panel; no transparent layers. */
import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BufferAttribute, BufferGeometry, ExtrudeGeometry, MeshBasicMaterial, MeshStandardMaterial } from "three";

export const SELISE_LOGO_URL = "/madp/brand/selise-logo-official-white.svg";
/** the SVG's viewBox */
const SVG_W = 113;
const SVG_H = 48;

const face = new MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
const returns = new MeshStandardMaterial({ color: "#d3d8e0", roughness: 0.5, metalness: 0.1 });
const panel = new MeshStandardMaterial({ color: "#15181f", roughness: 0.82, metalness: 0.12 });

/** one group (a vertex range) of a non-indexed geometry as its own geometry */
function slice(g: BufferGeometry, start: number, count: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const a = g.getAttribute(name) as BufferAttribute | undefined;
    if (a) out.setAttribute(name, new BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

/** `width` is the panel's; the logo sits inside it with `pad` (x, y) metres around. `position` is the panel's centre
 *  on the face of the wall it is mounted on. */
export function Logo3D({ width, position, pad = [0.23, 0.165], depth = 0.012 }: { width: number; position: [number, number, number]; pad?: [number, number]; depth?: number }) {
  const svg = useLoader(SVGLoader, SELISE_LOGO_URL);
  const logoW = width - pad[0] * 2;
  const k = logoW / SVG_W;
  const logoH = SVG_H * k;
  const height = logoH + pad[1] * 2;
  const thick = 0.05;
  const geos = useMemo(() => {
    const faces: BufferGeometry[] = [];
    const sides: BufferGeometry[] = [];
    for (const path of svg.paths) {
      for (const shape of SVGLoader.createShapes(path)) {
        const g = new ExtrudeGeometry(shape, { depth: depth / k, curveSegments: 10, bevelEnabled: false });
        // ExtrudeGeometry's group 0 holds the caps, group 1 the side walls
        for (const gr of g.groups) (gr.materialIndex === 0 ? faces : sides).push(slice(g, gr.start, gr.count));
        g.dispose();
      }
    }
    const merge = (list: BufferGeometry[]) => {
      if (!list.length) return null;
      const m = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      return m;
    };
    return { faces: merge(faces), sides: merge(sides) };
  }, [svg, k, depth]);
  return (
    <group position={position}>
      <RoundedBox args={[width, height, thick]} radius={0.022} smoothness={4} position={[0, 0, thick / 2]} material={panel} />
      {/* SVG space is y-down: flip y about the logo's centre; the extrusion faces +z (off the panel) */}
      <group position={[-logoW / 2, logoH / 2, thick]} scale={[k, -k, k]}>
        {geos.sides && <mesh geometry={geos.sides} material={returns} />}
        {geos.faces && <mesh geometry={geos.faces} material={face} />}
      </group>
    </group>
  );
}
