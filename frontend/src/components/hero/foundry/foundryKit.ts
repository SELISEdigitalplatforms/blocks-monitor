/** Foundry's parts that are not React: the floor plan, the choreography, the shaders and the glyph atlas (drawn once
 *  into a canvas, so no font or image is fetched). Raw colours live here only: the canvas cannot read the Tailwind tokens. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, type IUniform, NormalBlending,
  ShaderMaterial, type ShaderMaterialParameters, SRGBColorSpace, type Texture, Vector2, Vector3, Vector4,
} from "three";
import { t } from "@/i18n";
import { stationHead } from "../types";

/* ── the floor plan (world units; the floor is y = 0 and the line runs along +x) ───────────────── */

export const INTAKE_X = -8.3;
export const STATION_X = [-5.7, -3.95, -2.2, -0.45, 1.3, 3.05, 4.8];
export const PAD_X = 7.75;
export const LANE_Z = 0.8;
export const GATE_HALF = 1.2;
export const GATE_H = 1.1;
export const RET_Y = 2.0;
export const RING_Y = 4.9;
export const RING_R = 0.95;
export const TILE_Y = 0.07;
/** where the hero packet leaves the line after SecOps and where it re-enters before the Developer */
const OUT_X = STATION_X[4] + 0.55;
const BACK_X = STATION_X[1] - 0.55;

/* the camera: high, a long lens, looking down the line from its right (near-isometric) */
export const AZ = (57 * Math.PI) / 180;
export const EL = (33 * Math.PI) / 180;
export const DIST = 48;
export const TARGET = new Vector3(0, 1.4, 0);
export const FOG_NEAR = DIST - 2;
export const FOG_FAR = DIST + 50;
/** the camera's screen axes in the world (fixed pose; the drift is small) */
export const CAM_R = new Vector3(Math.cos(AZ), 0, -Math.sin(AZ));
export const CAM_F = new Vector3(-Math.sin(AZ) * Math.cos(EL), -Math.sin(EL), -Math.cos(AZ) * Math.cos(EL));
export const CAM_U = new Vector3().crossVectors(CAM_R, CAM_F).normalize();

/* ── small maths ──────────────────────────────────────────────────────────────────────────────── */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** smootherstep: conveyor moves that start and stop softly */
export const ease = (p: number) => {
  const t = clamp01(p);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (x: number) => x - Math.floor(x);

/* ── the choreography (one run of the line, seconds) ──────────────────────────────────────────── */

export const PERIOD = 15.5;
export type Kind = "form" | "move" | "scan" | "ret" | "deploy" | "rise" | "live";
export type Verdict = "ok" | "quick" | "fail" | "fix" | "pass";
export interface Seg { kind: Kind; t0: number; t1: number; x0: number; x1: number; k: number; v: Verdict }

const SX = STATION_X;
export const SEGS: Seg[] = (() => {
  const out: Seg[] = [];
  let T = 0;
  const add = (kind: Kind, dur: number, x0: number, x1: number, k = -1, v: Verdict = "ok") => {
    out.push({ kind, t0: T, t1: T + dur, x0, x1, k, v });
    T += dur;
  };
  add("form", 1.5, INTAKE_X, INTAKE_X); // the brief's material lands and becomes the scoped feature packet
  add("move", 0.45, INTAKE_X, SX[0]);
  add("scan", 0.44, SX[0], SX[0], 0);
  for (let k = 1; k <= 3; k++) {
    add("move", 0.36, SX[k - 1], SX[k]);
    add("scan", 0.42, SX[k], SX[k], k);
  }
  add("move", 0.36, SX[3], SX[4]);
  add("scan", 0.64, SX[4], SX[4], 4, "fail"); // SecOps finds an issue
  add("move", 0.24, SX[4], OUT_X);
  add("ret", 1.35, OUT_X, BACK_X); // the overhead return lane, back to the Developer
  add("move", 0.24, BACK_X, SX[1]);
  add("scan", 0.5, SX[1], SX[1], 1, "fix"); // the Developer agent fixes it
  add("move", 0.26, SX[1], SX[2]);
  add("scan", 0.2, SX[2], SX[2], 2, "quick");
  add("move", 0.26, SX[2], SX[3]);
  add("scan", 0.2, SX[3], SX[3], 3, "quick");
  add("move", 0.26, SX[3], SX[4]);
  add("scan", 0.5, SX[4], SX[4], 4, "pass"); // and passes
  add("move", 0.36, SX[4], SX[5]);
  add("scan", 0.4, SX[5], SX[5], 5);
  add("move", 0.36, SX[5], SX[6]);
  add("scan", 0.46, SX[6], SX[6], 6);
  add("move", 0.5, SX[6], PAD_X);
  add("deploy", 0.72, PAD_X, PAD_X, 7); // the packets merge into one app; smoke test on the pad
  add("rise", 0.9, PAD_X, PAD_X, 7); // up the beam into SELISE Blocks
  add("live", Math.max(0.5, PERIOD - T), PAD_X, PAD_X, 7);
  return out;
})();

const segOf = (pred: (s: Seg) => boolean) => SEGS.find(pred) as Seg;
export const SEG_FAIL = segOf((s) => s.v === "fail");
export const SEG_FIX = segOf((s) => s.v === "fix");
export const SEG_PASS = segOf((s) => s.v === "pass");
export const SEG_RET = segOf((s) => s.kind === "ret");
export const SEG_DEPLOY = segOf((s) => s.kind === "deploy");
export const SEG_RISE = segOf((s) => s.kind === "rise");
export const SEG_LIVE = segOf((s) => s.kind === "live");

/** the reduced-motion still: the hero packet on its way back to the Developer, the previous app already live */
export const STILL_C = SEG_RET.t0 + 0.42 * (SEG_RET.t1 - SEG_RET.t0);
export const STILL_LIVE = SEG_LIVE.t0 + 0.8;
export const STILL_INPUT = 0.5;

/* story position: the legend's stops at the stations, interpolated along the line */
const KX = [INTAKE_X, ...STATION_X, PAD_X];
const KH = [0.1, ...STATION_X.map((_, k) => stationHead(k)), stationHead(7)];
export function headOfX(x: number): number {
  if (x <= KX[0]) return KH[0];
  for (let i = 0; i < KX.length - 1; i++) if (x <= KX[i + 1]) return KH[i] + ((KH[i + 1] - KH[i]) * (x - KX[i])) / (KX[i + 1] - KX[i]);
  return KH[KH.length - 1];
}

/* ── curves ───────────────────────────────────────────────────────────────────────────────────── */

/** a polyline with rounded corners, sampled densely so a Catmull-Rom spline keeps its shape */
function rounded(pts: [number, number, number][], r: number): CatmullRomCurve3 {
  const out: Vector3[] = [];
  const v = (p: [number, number, number]) => new Vector3(p[0], p[1], p[2]);
  for (let i = 0; i < pts.length; i++) {
    const p = v(pts[i]);
    if (i === 0 || i === pts.length - 1) {
      out.push(p);
      continue;
    }
    const a = v(pts[i - 1]).sub(p).normalize();
    const b = v(pts[i + 1]).sub(p).normalize();
    const p0 = p.clone().addScaledVector(a, r);
    const p1 = p.clone().addScaledVector(b, r);
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      // quadratic Bezier through the corner: close to a circular arc, smooth enough for a thin rail
      const q = new Vector3().addScaledVector(p0, (1 - t) * (1 - t)).addScaledVector(p, 2 * t * (1 - t)).addScaledVector(p1, t * t);
      out.push(q);
    }
  }
  // fill the straight runs so the spline does not overshoot
  const dense: Vector3[] = [];
  for (let i = 0; i < out.length - 1; i++) {
    const n = Math.max(1, Math.ceil(out[i].distanceTo(out[i + 1]) / 0.25));
    for (let s = 0; s < n; s++) dense.push(out[i].clone().lerp(out[i + 1], s / n));
  }
  dense.push(out[out.length - 1]);
  return new CatmullRomCurve3(dense, false, "centripetal", 0.5);
}

/** the gate frame in its own plane (x = 0): posts at z = ±GATE_HALF, the beam on top */
export const gateCurve = () => rounded([[0, 0, -GATE_HALF], [0, GATE_H, -GATE_HALF], [0, GATE_H, GATE_HALF], [0, 0, GATE_HALF]], 0.16);

/** the overhead return lane: up after SecOps, back over the line, down before the Developer */
export const RET_CURVE = rounded([[OUT_X, TILE_Y + 0.02, 0], [OUT_X, RET_Y, 0], [BACK_X, RET_Y, 0], [BACK_X, TILE_Y + 0.02, 0]], 0.42);

/** the three lanes: the hero's lane in the middle (side 0) and two lanes that fan out around it */
export function laneCurve(side: -1 | 0 | 1): CatmullRomCurve3 {
  if (side === 0) return new CatmullRomCurve3([new Vector3(INTAKE_X + 0.62, 0, 0), new Vector3(0, 0, 0), new Vector3(PAD_X - 0.9, 0, 0)]);
  const s = side;
  return new CatmullRomCurve3(
    [
      [INTAKE_X + 0.5, 0, s * 0.3], [INTAKE_X + 1.25, 0, s * 0.72], [INTAKE_X + 1.95, 0, s * LANE_Z], [0, 0, s * LANE_Z],
      [SX[6] + 0.95, 0, s * LANE_Z], [PAD_X - 1.2, 0, s * 0.7], [PAD_X - 0.62, 0, s * 0.38],
    ].map(([x, y, z]) => new Vector3(x, y, z)),
    false, "centripetal", 0.5,
  );
}

/** a flat strip on the floor along a curve (uv.x: arc fraction, uv.y: across) */
export function ribbonGeometry(curve: CatmullRomCurve3, width: number, segments: number, y = 0.004): BufferGeometry {
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
    const t = i / segments;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    side.crossVectors(tan, up).normalize().multiplyScalar(width / 2);
    pos.set([p.x - side.x, y, p.z - side.z, p.x + side.x, y, p.z + side.z], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    uv.set([t, 0, t, 1], i * 4);
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

/* ── the hero packet's state at a moment of the run ───────────────────────────────────────────── */

export interface HeroState { x: number; y: number; scale: number; vis: number; head: number; seg: Seg; p: number }
const tmp = new Vector3();
export function heroAt(c: number, h: HeroState) {
  let seg = SEGS[SEGS.length - 1];
  for (const s of SEGS) {
    if (c < s.t1) {
      seg = s;
      break;
    }
  }
  const p = clamp01((c - seg.t0) / (seg.t1 - seg.t0));
  h.seg = seg;
  h.p = p;
  h.y = TILE_Y;
  h.scale = 1;
  h.vis = 1;
  switch (seg.kind) {
    case "form":
      h.x = INTAKE_X;
      h.scale = Math.max(0.001, smooth(0.6, 0.97, p));
      h.head = 0.1 * smooth(0, 1, p);
      break;
    case "move":
      h.x = lerp(seg.x0, seg.x1, ease(p));
      h.head = headOfX(h.x);
      if (seg.x0 === BACK_X) h.head = Math.max(h.head, stationHead(1));
      break;
    case "scan":
      h.x = seg.x0;
      h.head = headOfX(h.x);
      break;
    case "ret":
      RET_CURVE.getPointAt(ease(p), tmp);
      h.x = tmp.x;
      h.y = tmp.y;
      h.head = Math.max(headOfX(h.x), stationHead(1));
      break;
    case "deploy":
      h.x = PAD_X;
      h.head = stationHead(7);
      h.vis = 1 - smooth(0.32, 0.58, p);
      h.scale = 1 + 0.35 * smooth(0.1, 0.5, p);
      break;
    case "rise":
      h.x = PAD_X;
      h.vis = 0;
      h.head = lerp(stationHead(7), 1, smooth(0, 1, p));
      break;
    default:
      h.x = PAD_X;
      h.vis = 0;
      h.head = 1;
  }
}

/* ── colour ───────────────────────────────────────────────────────────────────────────────────── */

export interface Palette {
  deep: Color; blue: Color; pale: Color; hot: Color; white: Color; label: Color;
  violet: Color; red: Color; amber: Color; green: Color; grid: Color; glowK: number;
}
const C = (h: string) => new Color(h);
/** dark: electric light on the dark canvas. Light: the same neon photographed in daylight, every colour in the same role:
 *  the white-hot and pale cores turn saturated blue, the pale secondary lines mid blue, every glow (sleeves, halos,
 *  sprites, the beam's shaft) the glow blue, and the verdict colours keep their hue, a little deeper so they hold on the
 *  light canvas. The glyph tint is white there: the atlas itself is drawn in blue */
export function palette(ink: boolean): Palette {
  return ink
    ? {
      deep: C("#2E68FF"), blue: C("#2E68FF"), pale: C("#4D7BFF"), hot: C("#1F5BFF"), white: C("#1F5BFF"), label: C("#FFFFFF"),
      violet: C("#7C5CFF"), red: C("#F0681A"), amber: C("#F59814"), green: C("#14BE74"), grid: C("#1F5BFF"), glowK: 1,
    }
    : {
      deep: C("#1F5BFF"), blue: C("#2E68FF"), pale: C("#9DB8FF"), hot: C("#E4ECFF"), white: C("#FFFFFF"), label: C("#DCE6FF"),
      violet: C("#7C5CFF"), red: C("#FF7A2E"), amber: C("#FFB347"), green: C("#3DDC97"), grid: C("#8EA6E8"), glowK: 1,
    };
}
/** light only: the lane rails are blue cores (#2E68FF light in the dark theme), drawn deep blue */
export const RAIL_L = C("#1747C8");

export function parseCanvas(s: string, light: boolean): Color {
  const [r, g, b] = s.trim().split(/\s+/).map(Number);
  const f = light ? [241, 242, 244] : [14, 15, 19];
  const ok = (v: number, i: number) => (Number.isFinite(v) ? v : f[i]);
  return new Color(`rgb(${ok(r, 0)}, ${ok(g, 1)}, ${ok(b, 2)})`);
}

/* ── shaders ──────────────────────────────────────────────────────────────────────────────────── */

/** light is added on the dark canvas; in the light theme each part's light becomes coverage (normal blending) */
const OUT = /* glsl */ `
  #ifdef INK
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #else
    gl_FragColor = vec4(col * a, 1.0);
  #endif
  #include <colorspace_fragment>`;

const VARY = /* glsl */ `varying vec2 vUv; varying float vFog; varying float vEdge; varying float vI;`;

/** light only: how the dark theme's light becomes coverage on the light canvas (the same shapes, sizes and falloffs).
 *  A thin core turns solid quickly. A glow rises fast, so faint light stays visible, and levels off below solid, so a
 *  hot glow never turns into a fill: a sleeve or halo (a band round a line) at alpha 0.5, a sprite at 0.6 at its
 *  centre. uL scales a part's light first (1 unless a part sets it); uWhite (0..1) gives the very hottest points (a
 *  flash, a spark) a tiny white centre inside their blue core. Straight-alpha "over" stacks a part's own layers (its
 *  glow first, its core on top) before the part is blended */
const INK = /* glsl */ `
  #ifdef INK
    uniform float uL; uniform float uWhite;
    float coreA(float x) { return 1.0 - exp(-3.5 * max(x * uL, 0.0)); }
    float sleeveA(float x) { return 0.5 * (1.0 - exp(-22.0 * max(x * uL, 0.0))); }
    float spriteA(float x) { return 0.6 * (1.0 - exp(-8.0 * max(x * uL, 0.0))); }
    void over(inout vec3 c, inout float a, vec3 c2, float a2) {
      float o = a2 + a * (1.0 - a2);
      c = (c2 * a2 + c * a * (1.0 - a2)) / max(o, 1e-5);
      a = o;
    }
  #endif`;

export const MESH_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  ${VARY}
  #ifdef USE_INSTANCING
    attribute float aI;
  #endif
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix; vI = aI;
    #else
      mat4 m = modelMatrix; vI = 1.0;
    #endif
    vec4 mv = viewMatrix * m * vec4(position, 1.0);
    vec3 n = normalize(mat3(viewMatrix) * mat3(m) * normal);
    vEdge = abs(dot(n, normalize(-mv.xyz)));
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/** a camera-facing quad; its size is the object's scale */
export const BB_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  ${VARY}
  #ifdef USE_INSTANCING
    attribute float aI;
  #endif
  void main() {
    vUv = uv; vEdge = 1.0;
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix; vI = aI;
    #else
      mat4 m = modelMatrix; vI = 1.0;
    #endif
    vec4 mv = viewMatrix * vec4(m[3].xyz, 1.0);
    mv.xy += position.xy * vec2(length(m[0].xyz), length(m[1].xyz));
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/** one colour, one intensity, an optional soft silhouette (the wide sleeves around thin cores) */
export const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uI; uniform float uSoft;
  ${VARY}
  ${INK}
  void main() {
    float a = uI * vI * mix(1.0, pow(vEdge, 1.6), uSoft) * (1.0 - vFog);
    vec3 col = uColor;
    #ifdef INK
      // light: a thin core turns solid colour; a soft sleeve is its glow, with the same falloff
      float k = uI * vI * (1.0 - vFog);
      a = mix(coreA(k), sleeveA(k) * pow(vEdge, 1.6), uSoft);
    #endif
    ${OUT}
  }`;

/** a soft round glow with an optional hot centre */
export const RADIAL_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uI; uniform float uCore;
  ${VARY}
  ${INK}
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    #ifdef INK
      // light: the same soft light (alpha, same falloff), its hot centre (uCore) a denser dot of the colour, at the very
      // hottest a tiny white point in it
      float k = uI * vI * (1.0 - vFog);
      float rim = 1.0 - smoothstep(0.72, 1.0, r);
      vec3 col = uColor;
      float a = spriteA(k) * exp(-r * r * 4.5) * (1.0 - uCore) * rim;
      over(col, a, uColor, coreA(k) * exp(-r * r * 38.0) * uCore * rim);
      over(col, a, vec3(1.0), coreA(k) * exp(-r * r * 160.0) * uWhite);
    #else
      float a = (exp(-r * r * 4.5) * (1.0 - uCore) + exp(-r * r * 38.0) * uCore) * (1.0 - smoothstep(0.72, 1.0, r));
      a *= uI * vI * (1.0 - vFog);
      vec3 col = uColor;
    #endif
    ${OUT}
  }`;

/** a feature packet: a thin bright rim, an inner chip line, a faint body */
export const TILE_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uI; uniform float uFill;
  ${VARY}
  ${INK}
  void main() {
    vec2 q = abs(vUv - 0.5) * 2.0;
    float e = max(q.x, q.y);
    float w = max(fwidth(e), 1e-4);
    float rim = smoothstep(0.84 - w, 0.84 + w, e);
    float inner = 1.0 - smoothstep(w * 0.5, w * 1.6, abs(e - 0.42));
    float a = (rim + inner * 0.45 + uFill) * uI * vI * (1.0 - vFog);
    vec3 col = mix(uColor, uHot, rim * 0.7);
    #ifdef INK
      // light: the same rim and chip line as solid lines, the faint body a glow of the packet's colour; at the very
      // hottest (a flash) the chip line turns white inside the blue tile
      float k = uI * vI * (1.0 - vFog);
      col = uColor;
      a = 0.5 * (1.0 - exp(-4.0 * uFill * k * uL));
      over(col, a, uColor, coreA(inner * 0.45 * k));
      over(col, a, mix(uColor, uHot, 0.7), coreA(rim * k));
      over(col, a, vec3(1.0), coreA(inner * k) * uWhite);
    #endif
    ${OUT}
  }`;

/** the scanner's laser plane: an idle line drifting up and down, and the working sweep with its trail */
export const SCAN_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uIdle; uniform float uScanY; uniform float uScanI; uniform float uIdleY; uniform float uIdleI;
  ${VARY}
  ${INK}
  void main() {
    float side = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
    float d = vUv.y - uScanY;
    float line = exp(-d * d / 0.00016);
    float trail = d > 0.0 ? exp(-d / 0.16) * 0.2 : 0.0;
    float di = vUv.y - uIdleY;
    float idle = exp(-di * di / 0.00011);
    #ifdef INK
      // light: the pane's faint glass tint and the sweep's trail a glow of the sweep's colour, the sweep and the
      // drifting idle line solid lines
      vec3 col = uColor;
      float a = spriteA((trail + 0.03) * uScanI);
      over(col, a, uIdle, coreA((idle * 0.85 + 0.018) * uIdleI));
      over(col, a, uColor, coreA(line * uScanI));
      a *= side * (1.0 - vFog);
    #else
      float as = (line + trail + 0.03) * uScanI;
      float ai = (idle * 0.85 + 0.018) * uIdleI;
      float a = (as + ai) * side * (1.0 - vFog);
      vec3 col = (uColor * as + uIdle * ai) / max(as + ai, 1e-4);
    #endif
    ${OUT}
  }`;

/** a conveyor lane on the floor: two thin rails, moving slats between them, the hero's light running along it */
export const LANE_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uI; uniform float uLen; uniform float uTime; uniform float uSpeed;
  uniform float uHead; uniform float uHeadI; uniform float uDone;
  #ifdef INK
    uniform vec3 uRail;
  #endif
  ${VARY}
  ${INK}
  void main() {
    float y = abs(vUv.y - 0.5) * 2.0;
    float fy = max(fwidth(y), 1e-4);
    float rail = 1.0 - smoothstep(fy * 0.4, fy * 1.5, abs(y - 0.52));
    float halo = exp(-pow((y - 0.52) / 0.22, 2.0));
    float s = vUv.x * uLen;
    float f = fract((s - uTime * uSpeed) / 0.3);
    float ds = min(f, 1.0 - f) * 0.3;
    float fs = max(fwidth(s), 1e-4);
    float slat = (1.0 - smoothstep(fs * 0.5, fs * 1.5, ds)) * (1.0 - smoothstep(0.36, 0.42, y));
    float d = uHead - s;
    float head = (d >= 0.0 ? exp(-d / 1.5) : exp(d / 0.1)) * uHeadI;
    float done = (d >= 0.0 ? 1.0 : 0.0) * uDone;
    float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
    #ifdef INK
      // light: the same rails, slats and halo: the rails solid deep blue, the slats fine lines, the halo a glow as strong
      // as a sleeve (the lanes carry most of the dark theme's light); the hero's light runs along all three in its colour
      float hh = clamp(head * 1.2, 0.0, 1.0);
      vec3 col = mix(uColor, uHot, hh);
      float a = sleeveA(halo * (0.06 + done * 0.03 + head * 0.3) * uI * 1.6);
      over(col, a, mix(uColor, uHot, hh), coreA(slat * (0.07 + head * 0.3) * uI));
      over(col, a, mix(uRail, uHot, hh), coreA(rail * (0.5 + done * 0.3 + head * 1.3) * uI));
      a *= ends * (1.0 - vFog);
    #else
      float a = (rail * (0.5 + done * 0.3 + head * 1.3) + halo * (0.06 + done * 0.03 + head * 0.3) + slat * (0.07 + head * 0.3)) * uI * ends * (1.0 - vFog);
      vec3 col = mix(uColor, uHot, clamp(head * 1.2, 0.0, 1.0));
    #endif
    ${OUT}
  }`;

/** the overhead return lane: a dashed rail that carries a light when a packet is sent back */
export const RAIL_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uI; uniform float uHead; uniform float uHeadI; uniform float uSoft; uniform float uDash;
  ${VARY}
  ${INK}
  void main() {
    float d = uHead - vUv.x;
    float head = (d >= 0.0 ? exp(-d / 0.2) : exp(d / 0.015)) * uHeadI;
    float dash = mix(1.0, step(0.45, fract(vUv.x * 60.0)), uDash);
    float edge = mix(1.0, pow(vEdge, 2.0), uSoft);
    float a = (dash * 0.4 + head * 1.6) * uI * edge * (1.0 - vFog);
    vec3 col = mix(uColor, uHot, clamp(head, 0.0, 1.0));
    #ifdef INK
      // light: the dashed rail a solid line, its sleeve the glow (same falloff)
      float k = (dash * 0.4 + head * 1.6) * uI * (1.0 - vFog);
      a = mix(coreA(k), sleeveA(k), uSoft) * edge;
    #endif
    ${OUT}
  }`;

/** a round pad seen from above: fine rings, a ring of ticks, a soft centre and a ripple (the smoke test) */
export const PAD_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uI; uniform float uR; uniform float uSpin; uniform float uRip; uniform float uRipA; uniform float uFill;
  ${VARY}
  ${INK}
  float ring(float r, float c, float w) { float fw = max(fwidth(r), 1e-4); return 1.0 - smoothstep(w, w + fw * 1.5, abs(r - c)); }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uR;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float tick = step(0.55, fract(ang / 6.2831853 * 44.0 + uSpin));
    float rings = ring(r, uR * 0.56, 0.004) * 0.7 + ring(r, uR * 0.78, 0.007) + ring(r, uR * 0.93, 0.012) * tick * 0.6;
    float fill = exp(-pow(r / (uR * 0.5), 2.0)) * uFill;
    float rip = ring(r, uRip, 0.016) * uRipA;
    float a = ((rings + fill) * uI + rip) * (1.0 - smoothstep(uR * 0.97, uR, r)) * (1.0 - vFog);
    vec3 col = mix(uColor, uHot, clamp(rip * 2.0 + rings * 0.25, 0.0, 1.0));
    #ifdef INK
      // light: the same rings and ticks as solid lines, the soft centre a glow, the smoke-test ripple in the hot colour
      col = uColor;
      a = spriteA(fill * uI);
      over(col, a, mix(uColor, uHot, 0.25), coreA(rings * uI));
      over(col, a, uHot, coreA(rip * 2.0));
      a *= (1.0 - smoothstep(uR * 0.97, uR, r)) * (1.0 - vFog);
    #endif
    ${OUT}
  }`;

/** the beam up to SELISE Blocks: a hot core in a soft shaft, energy flowing up */
export const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uI; uniform float uTime;
  ${VARY}
  ${INK}
  void main() {
    float x = vUv.x - 0.5;
    float across = exp(-x * x * 36.0);
    float core = exp(-x * x * 1500.0);
    float ends = smoothstep(0.0, 0.015, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
    float flow = 0.78 + 0.22 * sin(vUv.y * 44.0 - uTime * 7.0);
    float a = (across * 0.3 + core) * ends * flow * uI * (1.0 - vFog);
    vec3 col = mix(uColor, uHot, core);
    #ifdef INK
      // light: the same shaft and core: the shaft a glow, the core a solid line in the hot colour
      float k = ends * flow * uI * (1.0 - vFog);
      col = uColor;
      a = sleeveA(0.3 * k) * across;
      over(col, a, uHot, coreA(k) * core);
    #endif
    ${OUT}
  }`;

/** a glyph or label from the atlas */
export const TEX_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform vec4 uRect; uniform vec3 uColor; uniform float uI;
  ${VARY}
  ${INK}
  void main() {
    vec4 t = texture2D(uMap, uRect.xy + vUv * uRect.zw);
    float a = t.a * uI * (1.0 - vFog);
    vec3 col = t.rgb * uColor;
    #ifdef INK
      // light: the atlas is drawn in blue and ink; the glyph's light becomes its opacity
      a = t.a * coreA(uI) * (1.0 - vFog);
    #endif
    ${OUT}
  }`;

/** the production floor: the page canvas colour, a fine grid and the floor marking around the line, dissolving into
 *  the page (and calmer under the headline) */
export const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
export const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uGrid; uniform vec3 uGlow; uniform vec2 uRes; uniform float uEdge; uniform vec2 uPlatC; uniform vec2 uPlatH;
  varying vec3 vWorld;
  float grid(vec2 p, float s, float w) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    vec2 p = vWorld.xz;
    float r = length((p - vec2(-0.2, 0.0)) / vec2(12.5, 6.8));
    float fade = 1.0 - smoothstep(0.3, 1.0, r);
    float sx = gl_FragCoord.x / uRes.x;
    float calm = mix(0.2, 1.0, smoothstep(uEdge - 0.2, uEdge + 0.08, sx));
    float g = grid(p, 0.5, 1.0) * 0.42 + grid(p, 2.5, 1.25) * 0.58;
    vec2 q = p - uPlatC;
    vec2 d = abs(q) - uPlatH;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    float fw = max(fwidth(sd), 1e-4);
    float outline = 1.0 - smoothstep(fw * 0.5, fw * 1.6, abs(sd));
    vec2 cq = abs(q) - (uPlatH - vec2(0.75));
    float corner = step(0.0, cq.x) * step(0.0, cq.y);
    float pool = exp(-pow(length(p / vec2(9.5, 2.8)), 2.0));
    #ifdef INK
      // light: the page canvas, the same grid and floor marking as fine blue lines fading the same way, as visible as the
      // dark ones (mixed in linear light: a grid line reads at about 0.12-0.15 alpha, the corner marks at about 0.55),
      // and a very faint blue tint where the dark floor holds its pool of light
      vec3 col = mix(uBg, uGlow, pool * 0.1 * calm);
      col = mix(col, uGrid, clamp((g * 0.5 * fade + outline * (0.35 + corner * 0.43)) * calm, 0.0, 1.0));
    #else
      vec3 col = uBg + uGrid * (g * 0.055 * fade + outline * (0.05 + corner * 0.24)) * calm + uGlow * pool * 0.04 * calm;
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export type UVal = number | Color | Vector2 | Vector3 | Vector4 | Texture;
export function U(o: Record<string, UVal>): Record<string, IUniform> {
  const out: Record<string, IUniform> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = { value: v instanceof Color || v instanceof Vector2 || v instanceof Vector3 || v instanceof Vector4 ? v.clone() : v };
  }
  return out;
}

/** every glowing part: additive light on dark, normal-blended coverage on light; nothing writes or tests depth (it is
 *  all light) */
export function shader(ink: boolean, vert: string, frag: string, uniforms: Record<string, UVal>, extra: ShaderMaterialParameters = {}) {
  return new ShaderMaterial({
    uniforms: U({ uFogNear: FOG_NEAR, uFogFar: FOG_FAR, ...(ink ? { uL: 1, uWhite: 0 } : {}), ...uniforms }),
    vertexShader: vert,
    fragmentShader: frag,
    defines: ink ? { INK: "" } : {},
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    blending: ink ? NormalBlending : AdditiveBlending,
    ...extra,
  });
}

/* ── the glyph atlas ──────────────────────────────────────────────────────────────────────────── */

export const ATLAS_W = 1024;
export const ATLAS_H = 512;
const CELL = 128;
const rect = (px: number, py: number, w: number, h: number) => new Vector4(px / ATLAS_W, 1 - (py + h) / ATLAS_H, w / ATLAS_W, h / ATLAS_H);
/** row 0: the station glyphs, one per stage; row 1: the brief's source material (mail, chat, PDF, screenshot, whiteboard) */
export const glyphRect = (col: number, row: number) => rect(col * CELL, row * CELL, CELL, CELL);
export const LIVE_RECT = rect(0, 256, 512, 128);
export const LIVE_ASPECT = 4;
export const LABEL_RECT = rect(0, 384, 1024, 128);
export const LABEL_ASPECT = 8;
const FONT = `"Outfit Variable", Outfit, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** the same drawing in both themes: white light on dark; on light the strokes in saturated blue, the label and the LIVE
 *  tag's outline in deep blue */
function drawAtlas(g: CanvasRenderingContext2D, ink: boolean) {
  const stroke = ink ? "#1F5BFF" : "#FFFFFF";
  const soft = ink ? "#1747C8" : "#C9D7FF";
  const green = ink ? "#14BE74" : "#3DDC97";
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = stroke;
  g.fillStyle = stroke;
  const at = (col: number, row: number, w: number, draw: () => void) => {
    g.save();
    g.translate(col * CELL + CELL / 2, row * CELL + CELL / 2);
    g.lineWidth = w;
    draw();
    g.restore();
  };
  const path = (pts: number[][], close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (close) g.closePath();
    g.stroke();
  };
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.stroke();
  };
  const dot = (x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  /* stations */
  at(0, 0, 7, () => { // plan: the scope as a list
    for (let i = 0; i < 3; i++) {
      dot(-28, -24 + i * 24, 5.5);
      path([[-12, -24 + i * 24], [32, -24 + i * 24]]);
    }
  });
  at(1, 0, 7, () => { // code
    path([[-16, -24], [-38, 0], [-16, 24]]);
    path([[16, -24], [38, 0], [16, 24]]);
    path([[7, -30], [-7, 30]]);
  });
  at(2, 0, 7, () => { // review
    g.beginPath();
    g.arc(-6, -6, 22, 0, Math.PI * 2);
    g.stroke();
    path([[10, 10], [32, 32]]);
  });
  at(3, 0, 7, () => { // test
    rr(-31, -31, 62, 62, 13);
    path([[-15, 1], [-4, 13], [17, -12]]);
  });
  at(4, 0, 7, () => { // security
    path([[0, -36], [30, -25], [30, 0], [24, 18], [0, 36], [-24, 18], [-30, 0], [-30, -25]], true);
    g.lineWidth = 6;
    path([[-11, 1], [-2, 10], [13, -8]]);
  });
  at(5, 0, 7, () => { // docs
    path([[-24, -34], [10, -34], [26, -18], [26, 34], [-24, 34]], true);
    g.lineWidth = 5.5;
    path([[-12, -2], [14, -2]]);
    path([[-12, 14], [14, 14]]);
  });
  at(6, 0, 7, () => { // release
    path([[-24, 38], [-24, -36]]);
    path([[-24, -32], [26, -32], [14, -17], [26, -2], [-24, -2]], true);
  });
  /* the brief's source material */
  at(0, 1, 6, () => { // email
    rr(-34, -24, 68, 48, 7);
    path([[-30, -18], [0, 6], [30, -18]]);
  });
  at(1, 1, 6, () => { // meeting notes / chat
    g.beginPath();
    g.roundRect(-34, -30, 68, 46, 12);
    g.stroke();
    path([[-14, 16], [-20, 32], [2, 16]]);
    path([[-20, -12], [20, -12]]);
    path([[-20, 2], [8, 2]]);
  });
  at(2, 1, 6, () => { // pdf
    path([[-26, -36], [8, -36], [26, -18], [26, 36], [-26, 36]], true);
    g.font = `700 22px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("PDF", 0, 10);
  });
  at(3, 1, 6, () => { // screenshot
    rr(-36, -28, 72, 56, 7);
    path([[-26, 18], [-8, -2], [6, 10], [14, 2], [28, 18]]);
    dot(16, -12, 5.5);
  });
  at(4, 1, 6, () => { // whiteboard photo
    rr(-36, -28, 72, 50, 5);
    path([[-24, -8], [-12, -16], [0, -6], [12, -14], [22, -6]]);
    path([[-22, 8], [6, 8]]);
    path([[-14, 22], [-20, 34]]);
    path([[14, 22], [20, 34]]);
  });
  /* the LIVE tag */
  g.save();
  g.translate(0, 256);
  g.lineWidth = 5;
  g.strokeStyle = soft;
  g.beginPath();
  g.roundRect(6, 10, 500, 108, 54);
  g.stroke();
  g.fillStyle = green;
  g.beginPath();
  g.arc(70, 64, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = stroke;
  g.font = `600 70px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  let x = 118;
  for (const ch of t("landing.scene.live", "LIVE")) {
    g.fillText(ch, x, 68);
    x += g.measureText(ch).width + 12;
  }
  g.restore();
  /* the platform label */
  g.save();
  g.translate(0, 384);
  g.fillStyle = soft;
  g.font = `500 74px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  x = 6;
  for (const ch of "SELISE BLOCKS") {
    g.fillText(ch, x, 66);
    x += g.measureText(ch).width + 11;
  }
  g.restore();
}

export function makeAtlas(ink: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  drawAtlas(g, ink);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  // redraw once the page font is in (the first draw may have used the fallback)
  document.fonts?.ready.then(() => {
    drawAtlas(g, ink);
    tex.needsUpdate = true;
  }).catch(() => undefined);
  return tex;
}
