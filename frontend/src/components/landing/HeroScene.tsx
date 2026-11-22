/** The hero's factory line as a light composition (three.js through React Three Fiber, loaded lazily so the page
 *  paints first). A brief becomes a pulse that runs through the stations, MADP's AI agents, stage by stage, and
 *  then the deploy to SELISE Blocks, and lands as a live-app beacon. Two floor marks: where the build starts from the
 *  confirmed scope, and the automatic release check before the deploy.
 *  Dark theme: neon light on the dark canvas. Additive light, soft sprites, mirrored copies on a glossy floor and fog
 *  stand in for bloom and depth of field.
 *  Light theme: the same neon scene photographed in daylight. One composition for both themes (the same geometry,
 *  camera, framing, sizes, timing and motion); only colour, blending and opacity change. Every piece keeps its thin
 *  core and its soft glow: white-hot cores turn saturated blue, blue cores deep blue, the pale secondary mid blue,
 *  and every glow (sleeves, halos, sprites, the beam, pools of light, reflections) is the glow blue laid over the
 *  canvas, the intensity the dark theme adds becoming its opacity. The floor grid is drawn in blue, the dust as faint
 *  blue specks, the far haze as a very faint tint near the focal area. Switching the theme rebuilds the scene.
 *  Raw colours live here only (the canvas cannot read the Tailwind tokens). */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DoubleSide, type Group,
  type Mesh, MeshBasicMaterial, NormalBlending, type PerspectiveCamera, PlaneGeometry, RingGeometry, SRGBColorSpace,
  ShaderMaterial, type Sprite, SpriteMaterial, type Texture, TorusGeometry, TubeGeometry, Vector3,
} from "three";
import { STATION_U, STATION_U0, STATION_U7 } from "./heroLine";

export interface HeroSceneProps {
  /** draw frames; false while the hero is off screen or the tab is hidden */
  active: boolean;
  /** one composed still frame, no motion (prefers-reduced-motion) */
  still: boolean;
  /** the page canvas colour as "r g b" (follows the theme), so the scene melts into the page */
  canvas: string;
  /** light theme: the same neon scene photographed in daylight (blue cores and blue glow laid over the light canvas) */
  light: boolean;
  /** called once the first frames are on screen */
  onReady?: () => void;
  /** every frame: legend index (0 the brief, then one per stage in STAGES order ending with the deploy, then the live app) and the pulse position 0..1 */
  onProgress?: (index: number, head: number) => void;
  /** where the headline ends, as a fraction of the stage width; the live-app beacon stays clear of it */
  textEdge?: number;
}

/* ── the choreography ───────────────────────────────────────────────────────── */

const PERIOD = 12.5; // one run of the line, seconds
const CHARGE = 1.1; // the idea gathers light
const TRAVEL = 8.4; // idea → live app
const ARRIVE = CHARGE + TRAVEL;
const U0 = STATION_U0;
const U7 = STATION_U7;
/** floor marks: the build starts from the confirmed scope (before 01), the automatic release check (before deploy) */
const GATE_U = [0.07, (STATION_U[6] + STATION_U[7]) / 2];
const FOG_NEAR = 7;
const FOG_FAR = 38;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** where the pulse is (arc fraction): slows a little inside every station, as if work is being done there */
function headAt(t: number): number {
  const c = ((t % PERIOD) + PERIOD) % PERIOD;
  if (c < CHARGE) return -0.03;
  const lin = (c - CHARGE) / TRAVEL;
  if (lin >= 1) return 1 + (lin - 1) * 0.9;
  const s = 0.5 - 0.5 * Math.cos(Math.PI * lin);
  const n = 7 / (U7 - U0);
  return s - (0.55 / (2 * Math.PI * n)) * Math.sin(2 * Math.PI * n * (s - U0));
}

/** how lit the travelled part stays: rises with the run, fades during the rest */
function doneAt(t: number): number {
  const c = ((t % PERIOD) + PERIOD) % PERIOD;
  return c < CHARGE ? 0 : 1 - smooth(ARRIVE + 1.0, PERIOD - 0.2, c);
}

function legendIndex(head: number): number {
  if (head >= 0.995) return 9;
  let i = 0;
  for (let k = 0; k < STATION_U.length; k++) if (head >= STATION_U[k] - 0.012) i = k + 1;
  return i;
}

/** the still frame: the pulse just through 07 Release gate, on its way to deploy */
const STILL_T = CHARGE + TRAVEL * 0.86;

/* ── the look: neon light on dark, the same light photographed in daylight on light ── */

/** the light's colour roles, as neon on the dark canvas */
const NEON = {
  blue: "#2E68FF", deep: "#1F5BFF", hot: "#E4ECFF", pale: "#9DB8FF", white: "#FFFFFF",
  spark: "#BFD0FF", orb: "#D6E2FF", haze: "#2346B8", horizon: "#2A4FCB",
} as const;
type Role = keyof typeof NEON;
const ROLES = Object.keys(NEON) as Role[];

/** the same roles in daylight (light theme): the light becomes blue cores and blue glow on the light canvas */
const INK = {
  hot: "#1F5BFF", // white-hot and pale-hot cores (#FFFFFF, #E4ECFF): the head of the light, the gates, the idea, the beacon's core; the floor grid
  core: "#1747C8", // blue cores (#2E68FF): the rail, the sills
  mid: "#4D7BFF", // the pale secondary (#9DB8FF): the arches at rest, the brief's notes, the beacon's pad and ripple
  glow: "#2E68FF", // every glow: sleeves, halos, sprites, the beam, pools of light, reflections, the faint tint near the focal area
  white: "#FFFFFF", // the tiny white centre of the pulse head, the hottest point
} as const;
type InkRole = keyof typeof INK;
const INK_ROLES = Object.keys(INK) as InkRole[];

/** light adds itself to the dark canvas */
const ADD = { transparent: true, depthWrite: false, toneMapped: false, blending: AdditiveBlending } as const;
/** daylight: colour laid over the light canvas (the shaders write colour and alpha) */
const NORMAL = { transparent: true, depthWrite: false, toneMapped: false, blending: NormalBlending } as const;
/** daylight is drawn in layers, back to front, because laid-over colour depends on the order: the far tint, the floor
 *  and what lies on it, then the glows, then the cores over their glows so they stay crisp (the dark theme's light
 *  adds up in any order, so it keeps three.js's own sorting) */
const LAYER = { tint: -10, floor: -9, mirror: -8, pool: -6, mark: -5, halo: 1, glow: 2, solid: 3, core: 4 } as const;
type Layer = keyof typeof LAYER;

/** daylight: the intensity the dark theme adds to its canvas, as the opacity of colour laid over the light one. It
 *  saturates softly (overlapping light builds up as it does on dark) and lifts the dim end, since a faint glow that
 *  reads on black has to read on white too; `max` is the peak opacity, `k` how quickly it gets there */
const inkA = (i: number, max = 1, k = 2.2) => max * (1 - Math.exp(-Math.max(0, i) * k));

interface Look {
  light: boolean;
  /** the page canvas */
  bg: Color;
  /** dark: what each role adds to the canvas */
  c: Record<Role, Color>;
  /** light: the same roles as cores and glow laid over the canvas */
  ink: Record<InkRole, Color>;
  blend: typeof ADD | typeof NORMAL;
  /** dark: the floor's grid and pools of light, as offsets from the canvas (linear) */
  grid: Vector3;
  pool: Vector3;
}

type RGB = [number, number, number];
const rgbOf = (s: string): RGB => {
  const [r, g, b] = s.trim().split(/\s+/).map(Number);
  return [r || 14, g || 15, b || 19];
};
/** a display colour (0-255) as a three.js colour (linear working space) */
const srgb = ([r, g, b]: RGB) => new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
const vec = (c: Color) => new Vector3(c.r, c.g, c.b);
/** a three.js colour as display values (0-1), for shaders that work without the colour-space step */
const disp = (c: Color) => vec(c.clone().convertLinearToSRGB());

function makeLook(canvas: string, light: boolean): Look {
  const bg = srgb(rgbOf(canvas));
  const c = Object.fromEntries(ROLES.map((k) => [k, new Color(NEON[k])])) as Record<Role, Color>;
  const ink = Object.fromEntries(INK_ROLES.map((k) => [k, new Color(INK[k])])) as Record<InkRole, Color>;
  if (!light) {
    return {
      light, bg, c, ink, blend: ADD,
      grid: vec(new Color("#8EA6E8")).multiplyScalar(0.075),
      pool: vec(new Color(NEON.deep)).multiplyScalar(0.05),
    };
  }
  return { light, bg, c, ink, blend: NORMAL, grid: new Vector3(), pool: new Vector3() };
}

/* ── the path ───────────────────────────────────────────────────────────────── */

const PATH = new CatmullRomCurve3(
  [
    [-0.58, 0.05, 1.99], [-0.29, 0.05, 0.31], [0.68, 0.05, -2.4], [0.1, 0.05, -5.32], [0.67, 0.05, -8.43],
    [2.21, 0.05, -11.53], [2.92, 0.05, -14.32], [2.1, 0.05, -16.98], [2.62, 0.05, -19.01],
  ].map(([x, y, z]) => new Vector3(x, y, z)),
  false, "centripetal", 0.5,
);

/** small seeded random, so the composition is identical on every visit */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── shaders ────────────────────────────────────────────────────────────────── */
/* Each fragment shader has a LIGHT variant (daylight: the same light as colour plus alpha, laid over the canvas)
   next to the dark one (light: colour times strength, added to the canvas). */

const SOFT_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vY;
  #ifdef LIGHT
    varying vec3 vN; varying vec3 vV;
  #endif
  void main() {
    vUv = uv;
    vY = (modelMatrix * vec4(position, 1.0)).y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vEdge = abs(dot(n, normalize(-mv.xyz)));
    #ifdef LIGHT
      vN = n; vV = -mv.xyz;
    #endif
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/** daylight helpers: how squarely a surface faces the camera, worked out per pixel (the same falloff as the dark
 *  theme's, smooth across a tube's facets where an opaque-looking glow would show them), and the dark theme's
 *  intensity as opacity (inkA above, without the peak) */
const INK_GLSL = /* glsl */ `
  #ifdef LIGHT
    varying vec3 vN; varying vec3 vV;
    float facing() { return abs(dot(normalize(vN), normalize(vV))); }
    float inkA(float i, float k) { return 1.0 - exp(-max(i, 0.0) * k); }
  #endif`;

/** mirrored copies are reflections in the glossy floor: dimmer, fading with depth below it (in daylight the same
 *  reflection, as opacity). Applied after the colour-space conversion, so the dimming is perceptual (the blending
 *  happens in display space). */
const MIRROR = /* glsl */ `
  #ifdef MIRROR
    #ifdef LIGHT
      gl_FragColor.a *= 0.13 * exp(vY * 2.8);
    #else
      gl_FragColor.rgb *= 0.13 * exp(vY * 2.8);
    #endif
  #endif`;

/** the light path: a dim rail, a bright head with a fading tail, and the travelled part kept lit.
 *  Daylight: the same light; a core in its colour (the rail deep blue) turning to the hot blue at the head, or a glow
 *  (the sleeve, the strip on the floor) in the glow blue, both with the dark intensity as opacity (a glow up to uMax) */
const PATH_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot;
  uniform float uHead; uniform float uTail; uniform float uBase; uniform float uDone; uniform float uGain; uniform float uSoft;
  #ifdef LIGHT
    uniform float uMax; uniform float uK;
  #endif
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vY;
  ${INK_GLSL}
  void main() {
    float d = uHead - vUv.x;
    float head = d >= 0.0 ? exp(-d / uTail) : exp(d / 0.004);
    float done = (d >= 0.0 ? 1.0 : 0.0) * uDone;
    #ifdef LIGHT
      #ifdef RIBBON
        float edge = exp(-pow((vUv.y - 0.5) * 4.6, 2.0));
      #else
        float edge = mix(1.0, pow(facing(), 2.2), uSoft);
      #endif
      float i = (uBase + done * 0.55 + head * 1.8) * edge * uGain * (1.0 - vFog);
      gl_FragColor = vec4(mix(uColor, uHot, head), uMax * inkA(i, uK));
    #else
      #ifdef RIBBON
        float edge = exp(-pow((vUv.y - 0.5) * 4.6, 2.0));
      #else
        float edge = mix(1.0, pow(vEdge, 2.2), uSoft);
      #endif
      vec3 col = (uColor * (uBase + done * 0.55) + mix(uColor, uHot, head) * head * 1.8) * edge * uGain * (1.0 - vFog);
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
    ${MIRROR}
  }`;

/** a glowing object: one colour, one intensity, soft silhouette. Daylight: the same, the intensity as opacity (a core
 *  up to full, a halo up to uMax) */
const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uIntensity; uniform float uSoft;
  #ifdef LIGHT
    uniform float uMax; uniform float uK;
  #endif
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vY;
  ${INK_GLSL}
  void main() {
    #ifdef LIGHT
      float edge = mix(1.0, pow(facing(), 1.6), uSoft);
      gl_FragColor = vec4(uColor, uMax * inkA(uIntensity * edge * (1.0 - vFog), uK));
    #else
      float edge = mix(1.0, pow(vEdge, 1.6), uSoft);
      vec3 col = uColor * uIntensity * edge * (1.0 - vFog);
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
    ${MIRROR}
  }`;

/** the live-app beacon: a vertical shaft of light, brightest at the floor. Daylight: the same shaft, its core line in
 *  the hot blue laid over its glow in the glow blue (at most half opacity), the intensity as opacity */
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uIntensity;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vY;
  ${INK_GLSL}
  void main() {
    #ifdef LIGHT
      float up = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.02, vUv.y);
      float across = exp(-pow((vUv.x - 0.5) * 7.0, 2.0));
      float core = exp(-pow((vUv.x - 0.5) * 26.0, 2.0));
      float aCore = inkA(core * up * uIntensity, 2.2);
      float aGlow = 0.5 * inkA(across * 0.7 * up * uIntensity, 5.0);
      float a = aCore + aGlow * (1.0 - aCore);
      gl_FragColor = vec4((uHot * aCore + uColor * aGlow * (1.0 - aCore)) / max(a, 1e-4), a);
    #else
      float up = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.02, vUv.y);
      float across = exp(-pow((vUv.x - 0.5) * 7.0, 2.0));
      float core = exp(-pow((vUv.x - 0.5) * 26.0, 2.0));
      vec3 col = (uColor * across * 0.7 + uHot * core) * up * uIntensity;
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
    ${MIRROR}
  }`;

/** the floor: the canvas colour, a fine studio grid that fades with distance and soft pools of light, the last two
 *  as offsets (lighter on the dark canvas). Daylight: the same grid in the hot blue and the same pool as a faint tint
 *  of the glow blue, worked in display values (no colour-space step) so the far floor is the canvas byte for byte */
const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld; varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uGrid; uniform vec3 uGlow; uniform float uFogNear; uniform float uFogFar;
  #ifdef LIGHT
    uniform float uGridA; uniform float uGlowA;
  #endif
  varying vec3 vWorld; varying float vDepth;
  float grid(vec2 p, float s, float w) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    float fade = 1.0 - smoothstep(6.0, 30.0, vDepth);
    float g = grid(vWorld.xz, 1.0, 1.0) * 0.55 + grid(vWorld.xz, 5.0, 1.4) * 0.45;
    #ifdef LIGHT
      float pool = exp(-pow(length(vWorld.xz - vec2(0.6, -9.0)) / 11.0, 2.0));
      vec3 col = mix(uBg, uGlow, uGlowA * pool * (1.0 - fog));
      gl_FragColor = vec4(mix(col, uGrid, g * fade * uGridA), 1.0);
    #else
      float pool = exp(-pow(length(vWorld.xz - vec2(0.6, -9.0)) / 11.0, 2.0));
      vec3 col = max(uBg + uGrid * g * fade + uGlow * pool * (1.0 - fog), 0.0);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    #endif
  }`;

/** drifting dust and the out-of-focus discs near the lens (daylight: the dust only, as faint blue specks) */
const DUST_VERT = /* glsl */ `
  uniform float uTime; uniform float uSize; uniform float uPixelRatio; uniform float uFogNear; uniform float uFogFar;
  attribute float aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.35;
    p.y += sin(uTime * 0.07 + aSeed * 90.0) * 0.28 + uTime * 0.012 * (0.5 + aSeed);
    p.y = mod(p.y, 5.2);
    p.z += cos(uTime * 0.05 + aSeed * 60.0) * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = uSize * uPixelRatio * (0.35 + aSeed) / max(depth, 0.5);
    float twinkle = 0.45 + 0.55 * pow(sin(uTime * (0.4 + aSeed * 0.8) + aSeed * 30.0) * 0.5 + 0.5, 2.0);
    vAlpha = twinkle * (1.0 - smoothstep(uFogNear, uFogFar, depth)) * smoothstep(0.6, 2.0, depth);
    gl_Position = projectionMatrix * mv;
  }`;
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity; uniform float uRim;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.5 - mix(0.5, 0.06, uRim), d);
    float rim = mix(1.0, 0.55 + 0.45 * smoothstep(0.2, 0.47, d), uRim);
    #ifdef LIGHT
      gl_FragColor = vec4(uColor, disc * rim * vAlpha * uOpacity);
    #else
      gl_FragColor = vec4(uColor * disc * rim * vAlpha * uOpacity, 1.0);
    #endif
    #include <colorspace_fragment>
  }`;

const fogUniforms = () => ({ uFogNear: { value: FOG_NEAR }, uFogFar: { value: FOG_FAR } });

/** the path's materials. Daylight: a core (deep blue, the hot blue at the head; it writes depth, so the arches cover
 *  what passes behind them) or a glow (the glow blue up to `max` opacity) */
function pathMaterial(L: Look, o: { base: number; tail: number; gain: number; soft: number; ribbon?: boolean; glow?: boolean; max?: number; k?: number }) {
  if (!L.light) {
    return new ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        uColor: { value: L.c.blue.clone() }, uHot: { value: L.c.hot.clone() }, uHead: { value: -1 }, uTail: { value: o.tail },
        uBase: { value: o.base }, uDone: { value: 0 }, uGain: { value: o.gain }, uSoft: { value: o.soft },
      },
      defines: o.ribbon ? { RIBBON: "" } : {},
      vertexShader: SOFT_VERT, fragmentShader: PATH_FRAG, ...L.blend,
    });
  }
  return new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uColor: { value: (o.glow ? L.ink.glow : L.ink.core).clone() }, uHot: { value: (o.glow ? L.ink.glow : L.ink.hot).clone() },
      uHead: { value: -1 }, uTail: { value: o.tail }, uBase: { value: o.base }, uDone: { value: 0 }, uGain: { value: o.gain },
      uSoft: { value: o.soft }, uMax: { value: o.max ?? 1 }, uK: { value: o.k ?? 2.2 },
    },
    defines: { LIGHT: "", ...(o.ribbon ? { RIBBON: "" } : {}) },
    vertexShader: SOFT_VERT, fragmentShader: PATH_FRAG, ...L.blend, depthWrite: !o.glow,
  });
}

/** a glowing object. Daylight: `ink` holds its colour there, its peak opacity (`max`: a core full, a halo about half)
 *  and whether it is a solid core that writes depth (the arches, so they cover what passes behind them) */
function glowMaterial(L: Look, color: Color, intensity: number, soft: number, ink: { color: Color; max?: number; k?: number; solid?: boolean }) {
  if (!L.light) {
    return new ShaderMaterial({
      uniforms: { ...fogUniforms(), uColor: { value: color.clone() }, uIntensity: { value: intensity }, uSoft: { value: soft } },
      vertexShader: SOFT_VERT, fragmentShader: GLOW_FRAG, ...L.blend,
    });
  }
  return new ShaderMaterial({
    uniforms: {
      ...fogUniforms(), uColor: { value: ink.color.clone() }, uIntensity: { value: intensity }, uSoft: { value: soft },
      uMax: { value: ink.max ?? 1 }, uK: { value: ink.k ?? 2.2 },
    },
    defines: { LIGHT: "" },
    vertexShader: SOFT_VERT, fragmentShader: GLOW_FRAG, ...L.blend, depthWrite: Boolean(ink.solid),
  });
}

/** the reflection twin of a material: same uniforms (so it animates with it), drawn under the floor */
function mirrorOf(L: Look, m: ShaderMaterial) {
  return new ShaderMaterial({
    uniforms: m.uniforms, vertexShader: m.vertexShader, fragmentShader: m.fragmentShader,
    defines: { ...m.defines, MIRROR: "" }, side: DoubleSide, depthTest: false, ...L.blend,
  });
}

/** a white radial falloff drawn once in code: [stop, css colour] from the centre out */
function radialTexture(stops: [number, string][]): Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new CanvasTexture(c);
}

/** the glow falloff every sprite uses: [stop, opacity] from the centre out */
const GLOW_STOPS: [number, number][] = [[0, 1], [0.12, 0.7], [0.32, 0.22], [0.62, 0.05], [1, 0]];

function makeGlowTexture(): Texture {
  return radialTexture(GLOW_STOPS.map(([at, a]) => [at, `rgba(255,255,255,${a})`]));
}

/** daylight: the same falloff with its dim end lifted (as inkA does), so a glow keeps the reach on the light canvas
 *  that its faint outer light has on the dark one; the sprite's size and its centre stay the same */
function makeDayGlowTexture(): Texture {
  const lift = (a: number) => (1 - Math.exp(-2.5 * a)) / (1 - Math.exp(-2.5));
  return radialTexture(GLOW_STOPS.map(([at, a]) => [at, `rgba(255,255,255,${lift(a).toFixed(3)})`]));
}

/** daylight: the pulse head's core, the same falloff in the hot blue with a tiny white centre (the hottest point) */
function makeHotTexture(): Texture {
  const s = 128;
  const m = s / 2;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const blue = g.createRadialGradient(m, m, 0, m, m, m);
  for (const [at, a] of GLOW_STOPS) blue.addColorStop(at, `rgba(31,91,255,${a})`);
  g.fillStyle = blue;
  g.fillRect(0, 0, s, s);
  const white = g.createRadialGradient(m, m, 0, m, m, m * 0.13);
  white.addColorStop(0, "rgba(255,255,255,1)");
  white.addColorStop(0.45, "rgba(255,255,255,0.85)");
  white.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = white;
  g.fillRect(0, 0, s, s);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** glows are light, so the floor never cuts them */
function spriteMaterial(L: Look, map: Texture, color: Color, opacity: number) {
  return new SpriteMaterial({ map, color: color.clone(), opacity, depthTest: false, fog: false, ...L.blend });
}

/** a flat strip on the floor that follows the path (the light's reflection) */
function ribbonGeometry(segments: number, width: number): BufferGeometry {
  const n = (segments + 1) * 2;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx: number[] = [];
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const tan = new Vector3();
  const side = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    PATH.getPointAt(u, p);
    PATH.getTangentAt(u, tan);
    side.crossVectors(tan, up).normalize().multiplyScalar(width / 2);
    pos.set([p.x - side.x, 0.004, p.z - side.z, p.x + side.x, 0.004, p.z + side.z], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    uv.set([u, 0, u, 1], i * 4);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ── scene pieces ───────────────────────────────────────────────────────────── */

/** the path's three materials as one list, so the frame loop updates them without allocating */
const withMats = <T extends { coreMat: ShaderMaterial; sleeveMat: ShaderMaterial; ribbonMat: ShaderMaterial }>(l: T) =>
  ({ ...l, mats: [l.coreMat, l.sleeveMat, l.ribbonMat] });

type Keep = <T extends { dispose: () => void }>(o: T) => T;

/** everything one Scene puts on the GPU, released when the Scene goes (a theme switch builds a new one). Disposing
 *  twice is harmless, and three.js uploads a disposed object again if it is still drawn. */
function useBin(): Keep {
  const bin = useMemo(() => new Set<{ dispose: () => void }>(), []);
  useEffect(() => () => bin.forEach((o) => o.dispose()), [bin]);
  return useCallback(<T extends { dispose: () => void }>(o: T): T => { bin.add(o); return o; }, [bin]);
}

const ARCH_R = 0.55;

/** one station: an arch of light across the path and a sill on the floor (plus their reflection twins). Daylight: the
 *  same arch, a mid-blue core (the hot blue as the pulse runs through) inside its glow-blue sleeve */
function useStations(L: Look, keep: Keep) {
  return useMemo(() => {
    const coreGeo = keep(new TorusGeometry(ARCH_R, 0.011, 6, 80, Math.PI));
    const glowGeo = keep(new TorusGeometry(ARCH_R, 0.05, 10, 80, Math.PI));
    const sillGeo = keep(new PlaneGeometry(ARCH_R * 2.15, 0.022));
    const items = STATION_U.map((u) => {
      const p = PATH.getPointAt(u);
      const t = PATH.getTangentAt(u);
      const core = keep(glowMaterial(L, L.c.pale, 0.4, 0, { color: L.ink.mid, k: 3, solid: true }));
      const glow = keep(glowMaterial(L, L.c.deep, 0.12, 1, { color: L.ink.glow, max: 0.5, k: 5 }));
      const sill = keep(glowMaterial(L, L.c.blue, 0.35, 0, { color: L.ink.core, k: 3 }));
      return {
        u, x: p.x, z: p.z, rot: Math.atan2(t.x, t.z),
        core, glow, sill, coreM: keep(mirrorOf(L, core)), glowM: keep(mirrorOf(L, glow)),
      };
    });
    return { coreGeo, glowGeo, sillGeo, items };
  }, [L, keep]);
}

function Scene({ still, canvas, light, onProgress, onReady, textEdge = 0.64 }: Omit<HeroSceneProps, "active">) {
  const { camera, size, gl } = useThree();
  const keep = useBin();
  const L = useMemo(() => makeLook(canvas, light), [canvas, light]);
  const glowTex = useMemo(() => keep(makeGlowTexture()), [keep]);
  const st = useStations(L, keep);
  /* daylight: the glows' falloff with its dim end lifted, and the pulse head's core with its tiny white centre */
  const dayTex = useMemo(() => (L.light ? { glow: keep(makeDayGlowTexture()), hot: keep(makeHotTexture()) } : null), [L, keep]);
  /** the draw layer of a piece in daylight (the dark theme keeps three.js's own order) */
  const ro = (k: Layer) => (L.light ? LAYER[k] : 0);
  /** a sprite's or a plane's opacity: the light it adds on dark, as it is; on light, that light as opacity (inkA) */
  const op: (i: number, max?: number, k?: number) => number = L.light ? inkA : (i) => i;

  /* the light path: core rail, soft sleeve, reflection strip on the floor */
  const line = useMemo(() => withMats({
    core: keep(new TubeGeometry(PATH, 700, 0.011, 6, false)),
    sleeve: keep(new TubeGeometry(PATH, 700, 0.075, 10, false)),
    ribbon: keep(ribbonGeometry(500, 1.1)),
    coreMat: keep(pathMaterial(L, { base: 0.32, tail: 0.085, gain: 1.0, soft: 0 })),
    sleeveMat: keep(pathMaterial(L, { base: 0.07, tail: 0.11, gain: 0.55, soft: 1, glow: true, max: 0.5, k: 8 })),
    ribbonMat: keep(pathMaterial(L, { base: 0.05, tail: 0.1, gain: 0.5, soft: 0, ribbon: true, glow: true, max: 0.3, k: 5 })),
  }), [L, keep]);

  const floor = useMemo(() => {
    const geo = keep(new PlaneGeometry(140, 140));
    if (!L.light) {
      return {
        geo,
        mat: keep(new ShaderMaterial({
          uniforms: { uBg: { value: L.bg.clone() }, uGrid: { value: L.grid.clone() }, uGlow: { value: L.pool.clone() }, ...fogUniforms() },
          vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, toneMapped: false,
        })),
      };
    }
    const [r, g, b] = rgbOf(canvas);
    return {
      geo,
      mat: keep(new ShaderMaterial({
        uniforms: {
          uBg: { value: new Vector3(r / 255, g / 255, b / 255) }, uGrid: { value: disp(L.ink.hot) }, uGlow: { value: disp(L.ink.glow) },
          uGridA: { value: 0.13 }, uGlowA: { value: 0.05 }, ...fogUniforms(),
        },
        defines: { LIGHT: "" },
        vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, toneMapped: false,
      })),
    };
  }, [L, keep, canvas]);

  /* pools of light under the stations and the floor marks */
  const pools = useMemo(() => {
    const geo = keep(new PlaneGeometry(2.7, 2.7));
    const mats = STATION_U.map(() => keep(new MeshBasicMaterial({
      map: dayTex?.glow ?? glowTex, color: (L.light ? L.ink.glow : L.c.deep).clone(), opacity: 0.12, fog: false, ...L.blend,
    })));
    const gateGeo = keep(new PlaneGeometry(0.95, 0.022));
    const gates = GATE_U.map((u) => {
      const p = PATH.getPointAt(u);
      const t = PATH.getTangentAt(u);
      const mat = keep(glowMaterial(L, L.c.white, 0.35, 0, { color: L.ink.hot, k: 3 }));
      return { x: p.x, z: p.z, rot: Math.atan2(t.x, t.z), u, mat };
    });
    return { geo, mats, gateGeo, gates };
  }, [L, keep, glowTex, dayTex]);

  /* the brief (an orb with its notes circling it), the pulse and the live-app beacon */
  const ends = useMemo(() => {
    const sprite = (color: Color, opacity: number, map: Texture = glowTex) => keep(spriteMaterial(L, map, color, opacity));
    if (dayTex) {
      /* daylight: the same sprites, beam and rings; cores in the hot or mid blue (the pulse head with its tiny white
         centre), glows in the glow blue at about half opacity at their centres (the lifted falloff), the far haze a
         very faint tint */
      const glow = (opacity: number) => sprite(L.ink.glow, opacity, dayTex.glow);
      const beamMat = keep(new ShaderMaterial({
        uniforms: { ...fogUniforms(), uColor: { value: L.ink.glow.clone() }, uHot: { value: L.ink.hot.clone() }, uIntensity: { value: 0.5 } },
        defines: { LIGHT: "" },
        vertexShader: SOFT_VERT, fragmentShader: BEAM_FRAG, side: DoubleSide, ...L.blend,
      }));
      return {
        start: PATH.getPointAt(0),
        end: PATH.getPointAt(1),
        orbCore: sprite(L.ink.hot, 1),
        spark: sprite(L.ink.mid, 0.9),
        orbGlow: glow(0.5),
        headGlow: glow(0.6),
        headCore: sprite(L.ink.white, 1, dayTex.hot),
        streak: glow(0.5),
        beamGeo: keep(new PlaneGeometry(1.2, 10, 1, 1)),
        beamMat,
        beamMatM: keep(mirrorOf(L, beamMat)),
        baseGlow: glow(0.35),
        padGeo: keep(new RingGeometry(1.05, 1.1, 96)),
        padMat: keep(new MeshBasicMaterial({ color: L.ink.mid.clone(), opacity: 0.35, fog: false, ...L.blend })),
        rippleMat: keep(new MeshBasicMaterial({ color: L.ink.mid.clone(), opacity: 0, fog: false, ...L.blend })),
        haze: sprite(L.ink.glow, 0.05),
        horizon: sprite(L.ink.glow, 0.035),
      };
    }
    const beamMat = keep(new ShaderMaterial({
      uniforms: { ...fogUniforms(), uColor: { value: L.c.deep.clone() }, uHot: { value: L.c.hot.clone() }, uIntensity: { value: 0.5 } },
      vertexShader: SOFT_VERT, fragmentShader: BEAM_FRAG, side: DoubleSide, ...L.blend,
    }));
    return {
      start: PATH.getPointAt(0),
      end: PATH.getPointAt(1),
      orbCore: sprite(L.c.white, 1),
      spark: sprite(L.c.spark, 0.8),
      orbGlow: sprite(L.c.orb, 0.95),
      headGlow: sprite(L.c.pale, 0.9),
      headCore: sprite(L.c.white, 1),
      streak: sprite(L.c.blue, 0.55),
      beamGeo: keep(new PlaneGeometry(1.2, 10, 1, 1)),
      beamMat,
      beamMatM: keep(mirrorOf(L, beamMat)),
      baseGlow: sprite(L.c.blue, 0.7),
      padGeo: keep(new RingGeometry(1.05, 1.1, 96)),
      padMat: keep(new MeshBasicMaterial({ color: L.c.pale.clone(), opacity: 0.35, fog: false, ...L.blend })),
      rippleMat: keep(new MeshBasicMaterial({ color: L.c.pale.clone(), opacity: 0, fog: false, ...L.blend })),
      haze: sprite(L.c.haze, 0.2),
      horizon: sprite(L.c.horizon, 0.12),
    };
  }, [L, keep, glowTex, dayTex]);

  /* dust in the air and out-of-focus discs close to the lens; in daylight the dust as faint blue specks and no discs
     (out of focus they would read as smudges on the page) */
  const air = useMemo(() => {
    const r = rng(7);
    const make = (n: number, place: () => [number, number, number]) => {
      const g = new BufferGeometry();
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos.set(place(), i * 3);
        seed[i] = r();
      }
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new BufferAttribute(seed, 1));
      return keep(g);
    };
    const mat = (o: { size: number; color: string; opacity: number; rim: number }) => keep(new ShaderMaterial({
      uniforms: {
        ...fogUniforms(), uTime: { value: 0 }, uSize: { value: o.size }, uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        uColor: { value: new Color(o.color) }, uOpacity: { value: o.opacity }, uRim: { value: o.rim },
      },
      ...(L.light ? { defines: { LIGHT: "" } } : {}),
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, ...L.blend,
    }));
    if (L.light) {
      return {
        dust: make(760, () => [-7 + r() * 17, Math.pow(r(), 1.5) * 5.2, -34 + r() * 39]),
        bokeh: null,
        dustMat: mat({ size: 30, color: INK.hot, opacity: 0.2, rim: 0 }),
        bokehMat: null,
      };
    }
    return {
      dust: make(760, () => [-7 + r() * 17, Math.pow(r(), 1.5) * 5.2, -34 + r() * 39]),
      bokeh: make(14, () => [0.2 + r() * 3.4, 0.05 + r() * 0.9, 3.6 + r() * 1.8]),
      dustMat: mat({ size: 30, color: "#A9C0FF", opacity: 0.85, rim: 0 }),
      bokehMat: mat({ size: 340, color: "#6D8FFF", opacity: 0.022, rim: 0.3 }),
    };
  }, [L, keep, gl]);

  /* refs animated every frame */
  const head = useRef<Group>(null);
  const streakRef = useRef<Sprite>(null);
  const orb = useRef<Group>(null);
  const orbGlowRef = useRef<Sprite>(null);
  const notes = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const beamMirror = useRef<Mesh>(null);
  const baseGlowRef = useRef<Sprite>(null);
  const ripple = useRef<Mesh>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const frames = useRef(0);
  const tmp = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (still) return;
    const h = (e: PointerEvent) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", h, { passive: true });
    return () => window.removeEventListener("pointermove", h);
  }, [still]);

  const aspect = size.width / Math.max(1, size.height);
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.fov = aspect < 1.3 ? 37 : aspect < 1.6 ? 33 : 30;
    cam.updateProjectionMatrix();
  }, [aspect, camera]);

  useFrame((state, dt) => {
    const t = still ? STILL_T : state.clock.elapsedTime + 2.2;
    const c = ((t % PERIOD) + PERIOD) % PERIOD;
    const h = headAt(t);
    const done = doneAt(t);

    /* camera: slow drift, a breath of parallax with the pointer, vanishing point right of the headline (the same
       framing in both themes) */
    const cam = camera as PerspectiveCamera;
    const p = pointer.current;
    const k = Math.min(1, dt * 1.6);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    cam.position.set(Math.sin(t * 0.055) * 0.4 + p.x * 0.26, 1.25 + Math.sin(t * 0.081) * 0.06 - p.y * 0.09, 7.5 + Math.sin(t * 0.043) * 0.3);
    cam.lookAt(0.4 + Math.sin(t * 0.037) * 0.2, 0.62, -12);
    /* lens shift: put the beacon a little right of where the headline ends (k: its offset from the vanishing point) */
    const offset = (0.136 * Math.tan(Math.PI / 12)) / Math.tan((cam.fov * Math.PI) / 360);
    const beamX = Math.min(0.86, Math.max(0.74, textEdge + 0.125));
    const shift = Math.min(0.6, Math.max(0.1, 2 * (beamX - 0.5 - offset / aspect)));
    cam.projectionMatrix.elements[8] = -shift;
    cam.projectionMatrix.elements[9] = 0;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    /* the line */
    for (let i = 0; i < line.mats.length; i++) {
      line.mats[i].uniforms.uHead.value = h;
      line.mats[i].uniforms.uDone.value = done;
    }

    /* the pulse head */
    if (head.current) {
      const visible = h >= 0 && h <= 1;
      head.current.visible = visible;
      if (visible) {
        PATH.getPointAt(h, tmp);
        head.current.position.set(tmp.x, tmp.y + 0.02, tmp.z);
        head.current.scale.setScalar(1 + Math.sin(t * 23) * 0.04);
      }
    }
    if (streakRef.current) streakRef.current.scale.set(2.6 + Math.sin(t * 3) * 0.2, 0.045, 1);

    /* stations: anticipation as the pulse nears, a flash as it passes, a quiet glow once done. Daylight: the same
       light (the shaders turn it into opacity); the arch turns from mid blue to the hot blue as the pulse runs through */
    for (let i = 0; i < st.items.length; i++) {
      const s = st.items[i];
      const d = h - s.u;
      const flash = d >= 0 ? Math.exp(-d / 0.05) : Math.exp(d / 0.016) * 0.5;
      const lit = d >= 0 ? done : 0;
      s.core.uniforms.uIntensity.value = 0.22 + lit * 0.3 + flash * 1.3;
      s.glow.uniforms.uIntensity.value = 0.06 + lit * 0.1 + flash * 0.6;
      s.sill.uniforms.uIntensity.value = 0.25 + lit * 0.35 + flash * 1.2;
      if (L.light) {
        (s.core.uniforms.uColor.value as Color).copy(L.ink.mid).lerp(L.ink.hot, Math.min(1, flash));
        pools.mats[i].opacity = inkA(0.07 + lit * 0.12 + flash * 0.55, 0.45, 2);
        continue;
      }
      (s.core.uniforms.uColor.value as Color).copy(L.c.pale).lerp(L.c.white, Math.min(1, flash));
      pools.mats[i].opacity = 0.07 + lit * 0.12 + flash * 0.55;
    }
    for (const g of pools.gates) {
      const d = h - g.u;
      const flash = d >= 0 ? Math.exp(-d / 0.04) : 0;
      g.mat.uniforms.uIntensity.value = 0.3 + (d >= 0 ? done * 0.35 : 0) + flash * 1.6;
    }

    /* the brief: gathers light, then lets the pulse go; its notes circle it */
    const charge = c < CHARGE ? smooth(0, CHARGE, c) : Math.exp(-(c - CHARGE) / 0.6);
    if (orbGlowRef.current) orbGlowRef.current.scale.setScalar(0.9 + charge * 1.1 + Math.sin(t * 1.3) * 0.05);
    if (orb.current) orb.current.position.y = ends.start.y + 0.12 + Math.sin(t * 0.9) * 0.02;
    if (notes.current) notes.current.rotation.y = t * 0.35;

    /* the live app: the beacon flares on arrival, a ripple spreads over the floor */
    const since = c - ARRIVE;
    const flare = since >= 0 ? Math.exp(-since / 1.1) : 0;
    ends.beamMat.uniforms.uIntensity.value = (0.3 + flare * 1.25 + done * 0.1);
    ends.baseGlow.opacity = op(0.45 + flare * 0.9, 0.6, 1.6);
    const face = Math.atan2(cam.position.x - ends.end.x, cam.position.z - ends.end.z);
    if (beam.current) beam.current.rotation.y = face;
    if (beamMirror.current) beamMirror.current.rotation.y = face;
    if (baseGlowRef.current) baseGlowRef.current.scale.setScalar(2.4 + flare * 2.2);
    if (ripple.current) {
      const r = since >= 0 && since < 2.4 ? since / 2.4 : 1;
      ripple.current.scale.setScalar(0.4 + r * 3.4);
      ends.rippleMat.opacity = since >= 0 && since < 2.4 ? op((1 - r) * 0.8) : 0;
    }
    ends.padMat.opacity = op(0.22 + flare * 0.5);

    /* air */
    if (air) {
      air.dustMat.uniforms.uTime.value = t;
      if (air.bokehMat) air.bokehMat.uniforms.uTime.value = t;
    }

    onProgress?.(legendIndex(h), Math.min(1, Math.max(0, h)));
    frames.current += 1;
    if (frames.current === (still ? 1 : 3)) onReady?.();
  });

  return (
    <>
      <color attach="background" args={[L.bg]} />

      {/* far atmosphere: haze (in daylight a very faint tint) */}
      <sprite material={ends.horizon} position={[0, 0.6, -40]} scale={[90, 7, 1]} renderOrder={ro("tint")} />
      <sprite material={ends.haze} position={[ends.end.x + 0.5, 1.6, ends.end.z - 6]} scale={[30, 12, 1]} renderOrder={ro("tint")} />

      {/* the floor, the light on it, and the reflections of the arches and the beacon */}
      <mesh geometry={floor.geo} material={floor.mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -30]} renderOrder={ro("floor")} />
      <mesh geometry={line.ribbon} material={line.ribbonMat} renderOrder={ro("pool")} />
      {st.items.map((s, i) => (
        <group key={i}>
          <mesh geometry={pools.geo} material={pools.mats[i]} rotation={[-Math.PI / 2, 0, 0]} position={[s.x, 0.006, s.z]} renderOrder={ro("pool")} />
          <group position={[s.x, 0, s.z]} rotation={[0, s.rot, 0]}>
            <mesh geometry={st.sillGeo} material={s.sill} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} renderOrder={ro("mark")} />
            <group>
              <mesh geometry={st.coreGeo} material={s.core} renderOrder={ro("solid")} />
              <mesh geometry={st.glowGeo} material={s.glow} renderOrder={ro("halo")} />
              <group scale={[1, -1, 1]}>
                <mesh geometry={st.coreGeo} material={s.coreM} renderOrder={ro("mirror")} />
                <mesh geometry={st.glowGeo} material={s.glowM} renderOrder={ro("mirror")} />
              </group>
            </group>
          </group>
        </group>
      ))}
      {pools.gates.map((g, i) => (
        <group key={i} position={[g.x, 0.008, g.z]} rotation={[0, g.rot, 0]}>
          <mesh geometry={pools.gateGeo} material={g.mat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={ro("mark")} />
        </group>
      ))}

      {/* the line */}
      <mesh geometry={line.core} material={line.coreMat} renderOrder={ro("solid")} />
      <mesh geometry={line.sleeve} material={line.sleeveMat} renderOrder={ro("halo")} />

      {/* the brief */}
      <group ref={orb} position={[ends.start.x, ends.start.y + 0.12, ends.start.z]}>
        <sprite material={ends.orbCore} scale={[0.2, 0.2, 1]} renderOrder={ro("core")} />
        <sprite ref={orbGlowRef} material={ends.orbGlow} renderOrder={ro("glow")} />
        <group ref={notes}>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            const r = 0.24 + (i % 2) * 0.1;
            return <sprite key={i} material={ends.spark} position={[Math.cos(a) * r, 0.03 + Math.sin(a * 3) * 0.06, Math.sin(a) * r]}
              scale={[0.07, 0.07, 1]} renderOrder={ro("core")} />;
          })}
        </group>
      </group>

      {/* the pulse */}
      <group ref={head}>
        <sprite material={ends.headGlow} scale={[1.15, 1.15, 1]} renderOrder={ro("glow")} />
        <sprite material={ends.headCore} scale={[0.26, 0.26, 1]} renderOrder={ro("core")} />
        <sprite ref={streakRef} material={ends.streak} scale={[2.6, 0.045, 1]} renderOrder={ro("glow")} />
      </group>

      {/* the live app */}
      <mesh ref={beam} geometry={ends.beamGeo} material={ends.beamMat} position={[ends.end.x, 5, ends.end.z]} renderOrder={ro("halo")} />
      <group scale={[1, -1, 1]}>
        <mesh ref={beamMirror} geometry={ends.beamGeo} material={ends.beamMatM} position={[ends.end.x, 5, ends.end.z]} renderOrder={ro("mirror")} />
      </group>
      <sprite ref={baseGlowRef} material={ends.baseGlow} position={[ends.end.x, 0.25, ends.end.z]} scale={[2.4, 2.4, 1]} renderOrder={ro("glow")} />
      <mesh geometry={ends.padGeo} material={ends.padMat} rotation={[-Math.PI / 2, 0, 0]} position={[ends.end.x, 0.01, ends.end.z]} renderOrder={ro("mark")} />
      <mesh ref={ripple} geometry={ends.padGeo} material={ends.rippleMat} rotation={[-Math.PI / 2, 0, 0]} position={[ends.end.x, 0.012, ends.end.z]} renderOrder={ro("mark")} />

      {/* air (in daylight the dust only) */}
      {air && (
        <>
          <points geometry={air.dust} material={air.dustMat} />
          {air.bokeh && air.bokehMat && <points geometry={air.bokeh} material={air.bokehMat} />}
        </>
      )}
    </>
  );
}

/** pixel budget: crisp on laptops, lighter on very large screens (the hero fills the whole viewport) */
const maxDpr = () => (typeof window !== "undefined" && window.innerWidth >= 1920 ? 1.25 : 1.6);

export default function HeroScene({ active, still, canvas, light, onReady, onProgress, textEdge }: HeroSceneProps) {
  return (
    <Canvas
      aria-hidden
      dpr={[1, maxDpr()]}
      frameloop={still ? "demand" : active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [0, 1.25, 7.5], fov: 30, near: 0.1, far: 120 }}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* every material is made for one way of drawing (light added to the dark canvas, or colour laid over the light
          one): a theme switch builds the scene again, and the old one releases what it put on the GPU */}
      <Scene key={`${light ? "day" : "neon"} ${canvas}`} still={still} canvas={canvas} light={light}
        onReady={onReady} onProgress={onProgress} textEdge={textEdge} />
    </Canvas>
  );
}
