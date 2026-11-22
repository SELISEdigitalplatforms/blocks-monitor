/** The world around the office: a sky with a soft gradient from the horizon to the zenith, and an endless ground the
 *  office stands on, with a fine grid that fades with distance and the far ground dissolving into the haze at the
 *  horizon. It moves with the view: orbiting turns the grid, lowering the camera brings the horizon and the sky into
 *  frame. Colours come only from the theme's tokens (surroundingsPalette.ts) and ease on a theme switch like the lights.
 *
 *  It is one mesh and one draw call, without textures: a small box around the camera, drawn at the far plane after
 *  everything opaque (so only the pixels the office leaves free are shaded). For each pixel the shader takes the view
 *  ray; above the horizon it is sky, below it meets the ground plane analytically, so the ground is truly endless with no
 *  large mesh, no far-plane edge and no depth fighting. Nothing in the scene is below that plane, so the ground never
 *  has to hide anything. Unlit, no shadow map, nothing per frame once settled. The haze is the shader's own, not scene
 *  fog: the office is always well inside it, and scene fog would recompile every material on the stage (furniture and
 *  people) to fade only this ground. */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BackSide, BoxGeometry, ShaderMaterial, Vector2 } from "three";
import { type SurroundingsKey, type SurroundingsPalette, SUN_AT } from "./surroundingsPalette";

/** the ground plane: the underside of the floor slab (Furniture.tsx Room), so the office stands on it as a plinth */
const GROUND_Y = -0.3;
/** the office's footprint on the ground (the slab, and the vestibule in front of the doorway), centre and half size */
const SLAB: readonly [number, number, number, number] = [0, 0, 12.2, 8.2];
const VESTIBULE: readonly [number, number, number, number] = [13.75, 0.2, 1.75, 1.9];
/** how far (m) the plinth's soft shade reaches out, and how far it leans away from the light */
const SHADE_REACH = 3.2;
const SHADE_LEAN = 0.9;
/** grid cell (m); the grid fades out between these distances from the office */
const GRID_CELL = 2;
const GRID_NEAR = 16;
const GRID_FAR = 64;
/** the haze: the ground at this distance (m) from the camera starts to dissolve, and is gone into it at the far one */
const FOG_NEAR = 34;
const FOG_FAR = 120;

const f = (n: number) => n.toFixed(4);

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // only the camera's rotation: the box stays centred on the camera, and z = w puts it on the far plane
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.9999, clip.w);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uGround;
uniform vec3 uLine;
uniform vec3 uShade;
uniform vec2 uSun;
uniform vec2 uLean;
varying vec3 vDir;

float boxDist(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec3 dir = normalize(vDir);
  // the sky: the haze at the horizon, brighter on the side the light comes from, the zenith colour above
  vec2 az = dir.xz / max(length(dir.xz), 1e-4);
  float toLight = max(dot(az, uSun), 0.0);
  float rise = max(dir.y, 0.0);
  vec3 horizon = mix(uHorizon, uGlow, toLight * toLight * (1.0 - smoothstep(0.0, 0.3, rise)));
  vec3 sky = mix(horizon, uZenith, pow(smoothstep(0.0, 0.6, rise), 0.7));

  // the ground: where this view ray meets the plane the office stands on (computed for every pixel, so the grid's
  // derivatives stay defined at the horizon)
  float dist = (${f(GROUND_Y)} - cameraPosition.y) / min(dir.y, -1e-4);
  vec2 p = cameraPosition.xz + dir.xz * dist;
  vec2 s = p - uLean;
  float d = min(boxDist(s, vec2(${f(SLAB[0])}, ${f(SLAB[1])}), vec2(${f(SLAB[2])}, ${f(SLAB[3])})),
                boxDist(s, vec2(${f(VESTIBULE[0])}, ${f(VESTIBULE[1])}), vec2(${f(VESTIBULE[2])}, ${f(VESTIBULE[3])})));
  vec3 ground = mix(uGround, uShade, 1.0 - smoothstep(0.0, ${f(SHADE_REACH)}, d));
#ifdef GRID
  vec2 q = p / ${f(GRID_CELL)};
  vec2 w = fwidth(q);
  vec2 l = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-4));
  float line = 1.0 - min(min(l.x, l.y), 1.0);
  // fades with distance from the office, and before the cells get too small to draw cleanly
  float fade = (1.0 - smoothstep(${f(GRID_NEAR)}, ${f(GRID_FAR)}, length(p))) * (1.0 - smoothstep(0.1, 0.32, max(w.x, w.y)));
  ground = mix(ground, uLine, line * fade);
#endif
  ground = mix(ground, horizon, smoothstep(${f(FOG_NEAR)}, ${f(FOG_FAR)}, dist));
  // the colours are the theme's sRGB tokens: written as they are (no tone mapping, no colour-space conversion)
  gl_FragColor = vec4(dir.y < 0.0 ? ground : sky, 1.0);
}
`;

const UNIFORM: Record<SurroundingsKey, string> = {
  zenith: "uZenith", horizon: "uHorizon", glow: "uGlow", ground: "uGround", line: "uLine", shade: "uShade",
};
const KEYS = Object.keys(UNIFORM) as SurroundingsKey[];

/** The surroundings. `palette` is the theme's (surroundingsPalette.ts); a new one eases in, at once with reduced motion.
 *  `grid` off draws the plain ground (compact cards and the lowest quality tier). */
export function Surroundings({ palette, reducedMotion, grid }: { palette: SurroundingsPalette; reducedMotion: boolean; grid: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => new BoxGeometry(2, 2, 2), []);
  const material = useMemo(() => {
    const sun = new Vector2(SUN_AT[0], SUN_AT[2]).normalize();
    const uniforms: Record<string, { value: unknown }> = {
      uSun: { value: sun },
      uLean: { value: sun.clone().multiplyScalar(-SHADE_LEAN) },
    };
    for (const k of KEYS) uniforms[UNIFORM[k]] = { value: palette[k].clone() };
    return new ShaderMaterial({
      name: "stage-surroundings", vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, defines: grid ? { GRID: "" } : {},
      side: BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
    });
    // the colours are set by the easing below; a new grid setting compiles the other shader variant once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const settled = useRef(false);
  const shown = useRef<ShaderMaterial | null>(null);
  const colour = (k: SurroundingsKey) => material.uniforms[UNIFORM[k]].value as SurroundingsPalette[SurroundingsKey];
  useLayoutEffect(() => {
    // the first draw, a rebuilt shader and reduced motion apply the theme at once; a theme switch eases in useFrame
    const atOnce = shown.current !== material || reducedMotion;
    shown.current = material;
    if (atOnce) for (const k of KEYS) colour(k).copy(palette[k]);
    settled.current = atOnce;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, reducedMotion, material]);
  useFrame((_, dt) => {
    if (settled.current) return;
    invalidate();
    const k = Math.min(1, dt * 2.5);
    let left = 0;
    for (const key of KEYS) {
      const c = colour(key), t = palette[key];
      c.lerp(t, k);
      left += Math.abs(t.r - c.r) + Math.abs(t.g - c.g) + Math.abs(t.b - c.b);
    }
    if (left < 0.004) {
      for (const key of KEYS) colour(key).copy(palette[key]);
      settled.current = true;
    }
  });

  return <mesh name="stage-environment" geometry={geometry} material={material} frustumCulled={false} renderOrder={1000} dispose={null} />;
}
