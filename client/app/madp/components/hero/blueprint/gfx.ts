/** Blueprint scene graphics: screen-space neon lines (1 px core + soft sleeve, drawn on like a pen), text and UI atlases
 *  painted once into canvas textures, and the shaders for panels, the shield, the laser sheet, the beam and the floor.
 *  Daylight (the light theme) draws the very same neon scene on the light canvas, as if photographed in daylight: the
 *  same thin cores, soft sleeves, halos and sprites, the white-hot cores in saturated blue, every glow laid over the
 *  canvas with normal blending in its own colour, and glass as a light white tint with blue neon edges. Daylight has its
 *  own shader programs (X_DAY); the dark programs are the original ones, so the dark theme draws exactly as before.
 *  Raw colours live here only (the canvas cannot read the Tailwind tokens). */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, LinearMipmapLinearFilter,
  NormalBlending, ShaderMaterial, type Texture, Vector2,
} from "three";

export type V3 = [number, number, number];

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

/* ── palette ────────────────────────────────────────────────────────────────── */

/** line/label tones: 0 main, 1 hot white, 2 violet (AI), 3 amber (failed check), 4 dim detail, 5 green (fix passed) */
export const TONE = { MAIN: 0, HOT: 1, VIOLET: 2, AMBER: 3, DIM: 4, GREEN: 5 } as const;
const DARK_CORE = ["#A9C2FF", "#F4F7FF", "#CBBDFF", "#FFC46B", "#6F8FEA", "#9BE8C4"];
const DARK_GLOW = ["#2E68FF", "#4C7BFF", "#7C5CFF", "#FF9A1F", "#1F5BFF", "#21B67F"];
/** daylight cores, tone by tone: the pale main stroke in mid blue, the white-hot one in saturated blue, violet, amber and
 *  green solid in their dark hues, the dim detail in a soft blue (lighter than the main stroke, as it is dimmer in dark) */
const DAY_CORE = ["#4D7BFF", "#1F5BFF", "#6A4BFF", "#F08A0C", "#6F8FEA", "#13A06F"];
/** daylight glows (normal blending over the canvas): the dark glow colours, every blue one #2E68FF */
const DAY_GLOW = ["#2E68FF", "#2E68FF", "#7C5CFF", "#FF9A1F", "#2E68FF", "#21B67F"];
/** daylight label inks: the same tones, deep enough to stay legible on the light canvas */
const DAY_LABEL = ["#2A55D9", "#1747C8", "#5B3FE0", "#B85A06", "#4D6BC6", "#0E8A5E"];
/** what the dark theme draws white-hot (#E4ECFF / #FFFFFF), in daylight */
const DAY_HOT = "#1F5BFF";

export const tones = (light: boolean) => ({
  core: (light ? DAY_CORE : DARK_CORE).map((c) => new Color(c)),
  glow: (light ? DAY_GLOW : DARK_GLOW).map((c) => new Color(c)),
});
const labelTones = (light: boolean) => (light ? { core: DAY_LABEL.map((c) => new Color(c)), glow: DAY_GLOW.map((c) => new Color(c)) } : tones(false));

export const NL = 8;
export const FOG = { near: 9, far: 30 };

/* Every shader below comes in two programs: the dark theme's own (X, unchanged byte for byte, so the dark scene renders
 * exactly as before; its uLight branch is never taken there) and the daylight one (X_DAY). */

/* ── neon lines ─────────────────────────────────────────────────────────────── */

export interface SegOpts { start?: number; dur?: number; layer?: number; tone?: number; gain?: number }

/** collects line segments; every segment becomes a screen-space quad (4 vertices) so it can glow and be drawn on */
export class LineBuilder {
  private pos: number[] = [];
  private oth: number[] = [];
  private corner: number[] = [];
  private reveal: number[] = [];
  private style: number[] = [];
  private idx: number[] = [];
  private n = 0;

  seg(a: V3, b: V3, o: SegOpts = {}) {
    const s = o.start ?? -1, d = o.dur ?? 0, L = o.layer ?? 0, T = o.tone ?? 0, G = o.gain ?? 1;
    for (let e = 0; e < 2; e++) {
      const p = e === 0 ? a : b, q = e === 0 ? b : a;
      for (const side of [-1, 1]) {
        this.pos.push(p[0], p[1], p[2]);
        this.oth.push(q[0], q[1], q[2]);
        this.corner.push(side, e);
        this.reveal.push(s, d);
        this.style.push(L, T, G);
      }
    }
    const i = this.n;
    this.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    this.n += 4;
  }

  /** a polyline drawn on continuously: the pen moves at constant speed from start to start + dur */
  poly(pts: V3[], closed: boolean, o: SegOpts = {}) {
    const list = closed ? [...pts, pts[0]] : pts;
    let total = 0;
    const lens: number[] = [];
    for (let i = 0; i < list.length - 1; i++) {
      const l = Math.hypot(list[i + 1][0] - list[i][0], list[i + 1][1] - list[i][1], list[i + 1][2] - list[i][2]);
      lens.push(l);
      total += l;
    }
    let acc = 0;
    for (let i = 0; i < list.length - 1; i++) {
      const has = o.dur !== undefined && o.dur > 0;
      this.seg(list[i], list[i + 1], {
        ...o,
        start: has ? (o.start ?? 0) + (o.dur! * acc) / total : o.start,
        dur: has ? (o.dur! * lens[i]) / total : o.dur,
      });
      acc += lens[i];
    }
  }

  /** dashed straight line (each dash drawn on in sequence) */
  dashed(a: V3, b: V3, dashes: number, o: SegOpts = {}) {
    const has = o.dur !== undefined && o.dur > 0;
    for (let i = 0; i < dashes; i++) {
      const f0 = i / dashes, f1 = (i + 0.55) / dashes;
      const p: V3 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0, a[2] + (b[2] - a[2]) * f0];
      const q: V3 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1, a[2] + (b[2] - a[2]) * f1];
      this.seg(p, q, { ...o, start: has ? (o.start ?? 0) + o.dur! * f0 : o.start, dur: has ? (o.dur! * 0.55) / dashes : o.dur });
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("aOther", new BufferAttribute(new Float32Array(this.oth), 3));
    g.setAttribute("aCorner", new BufferAttribute(new Float32Array(this.corner), 2));
    g.setAttribute("aReveal", new BufferAttribute(new Float32Array(this.reveal), 2));
    g.setAttribute("aStyle", new BufferAttribute(new Float32Array(this.style), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const LAYER_UNIFORMS = /* glsl */ `
  uniform float uDraw; uniform float uLayerA[${NL}]; uniform float uFront[${NL}];
  uniform float uFogNear; uniform float uFogFar;`;

const LINE_VERT = /* glsl */ `
  uniform vec2 uRes; uniform float uPx; uniform float uW;
  ${LAYER_UNIFORMS}
  attribute vec3 aOther; attribute vec2 aCorner; attribute vec2 aReveal; attribute vec3 aStyle;
  varying vec2 vNP; varying float vSide; varying float vLen; varying float vP; varying float vWX;
  varying float vA; varying float vFront; varying float vFog; varying float vTone; varying float vGain;
  void main() {
    float side = aCorner.x; float along = aCorner.y;
    vec4 mvT = modelViewMatrix * vec4(position, 1.0);
    vec4 cT = projectionMatrix * mvT;
    vec4 cO = projectionMatrix * (modelViewMatrix * vec4(aOther, 1.0));
    vec2 hr = uRes * 0.5;
    vec2 sT = cT.xy / cT.w * hr;
    vec2 sO = cO.xy / cO.w * hr;
    vec2 ab = along < 0.5 ? sO - sT : sT - sO;
    float len = length(ab);
    vec2 dir = len > 1e-4 ? ab / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float w = uW * uPx;
    vec2 off = nrm * side * w + dir * w * (along * 2.0 - 1.0);
    cT.xy += off / hr * cT.w;
    gl_Position = cT;
    float ap = along * len + (along * 2.0 - 1.0) * w;
    vNP = vec2(ap * cT.w, cT.w);
    vSide = side * w;
    vLen = len;
    vP = aReveal.y > 0.0 ? clamp((uDraw - aReveal.x) / aReveal.y, 0.0, 1.0) : step(aReveal.x, uDraw);
    int L = int(aStyle.x + 0.5);
    vA = uLayerA[L];
    vFront = uFront[L];
    vTone = aStyle.y; vGain = aStyle.z;
    vWX = (modelMatrix * vec4(position, 1.0)).x;
    vFog = smoothstep(uFogNear, uFogFar, -mvT.z);
  }`;
const LINE_FRAG = /* glsl */ `
  uniform float uPx; uniform float uSig; uniform float uGlowGain;
  uniform float uSweepX; uniform float uSweepA; uniform float uFade; uniform float uLight;
  uniform vec3 uCore[6]; uniform vec3 uGlow[6];
  varying vec2 vNP; varying float vSide; varying float vLen; varying float vP; varying float vWX;
  varying float vA; varying float vFront; varying float vFog; varying float vTone; varying float vGain;
  void main() {
    if (vP <= 0.002) discard;
    float ap = vNP.x / vNP.y;
    float p = vP > 0.998 ? 1.0 : vP;
    float shown = p * vLen;
    float dx = max(max(-ap, ap - shown), 0.0);
    float dist = length(vec2(dx, vSide));
    float core = 1.0 - smoothstep(0.45 * uPx, 1.25 * uPx, dist);
    float sg = uSig * uPx;
    float glow = exp(-dist * dist / (sg * sg));
    float tip = 0.0;
    if (p < 1.0) { vec2 dt = vec2(ap - shown, vSide); tip = exp(-dot(dt, dt) / (sg * sg * 1.6)); }
    float front = smoothstep(vFront, vFront - 0.1, vWX);
    float sx = (vWX - uSweepX) / 0.075;
    float hl = uSweepA * exp(-sx * sx);
    float vis = vA * uFade * (1.0 - vFog) * front;
    if (vis <= 0.001) discard;
    int T = int(vTone + 0.5);
    vec3 cc = uCore[T]; vec3 gc = uGlow[T];
    if (uLight < 0.5) {
      vec3 col = cc * core * vGain + gc * glow * uGlowGain * vGain
        + vec3(1.0) * (tip * 0.75 + core * hl * 0.9) + gc * glow * hl * 0.9;
      gl_FragColor = vec4(col * vis, 1.0);
    } else {
      float a = (core * 0.92 + glow * uGlowGain) * vGain + tip * 0.55 + core * hl * 0.35;
      gl_FragColor = vec4(mix(cc, gc, hl * 0.5), clamp(a * vis, 0.0, 1.0));
    }
    #include <colorspace_fragment>
  }`;
/** "over" compositing of straight-alpha layers, for the daylight shaders that lay cores over their glows */
const OVER = /* glsl */ `
  vec4 over(vec4 d, vec4 s) {
    float a = s.a + d.a * (1.0 - s.a);
    return vec4((s.rgb * s.a + d.rgb * d.a * (1.0 - s.a)) / max(a, 1e-4), a);
  }`;
const LINE_FRAG_DAY = /* glsl */ `
  uniform float uPx; uniform float uSig; uniform float uGlowA; uniform float uAuraA; uniform float uSweepX; uniform float uSweepA;
  uniform float uFade; uniform vec3 uCore[6]; uniform vec3 uGlow[6]; uniform vec3 uHot;
  varying vec2 vNP; varying float vSide; varying float vLen; varying float vP; varying float vWX;
  varying float vA; varying float vFront; varying float vFog; varying float vTone; varying float vGain;
  ${OVER}
  void main() {
    if (vP <= 0.002) discard;
    float ap = vNP.x / vNP.y;
    float p = vP > 0.998 ? 1.0 : vP;
    float shown = p * vLen;
    float dx = max(max(-ap, ap - shown), 0.0);
    float dist = length(vec2(dx, vSide));
    float core = 1.0 - smoothstep(0.45 * uPx, 1.25 * uPx, dist);
    float sg = uSig * uPx;
    float glow = exp(-dist * dist / (sg * sg));
    float tip = 0.0;
    if (p < 1.0) { vec2 dt = vec2(ap - shown, vSide); tip = exp(-dot(dt, dt) / (sg * sg * 1.6)); }
    float front = smoothstep(vFront, vFront - 0.1, vWX);
    float sx = (vWX - uSweepX) / 0.075;
    float hl = uSweepA * exp(-sx * sx);
    float vis = vA * uFade * (1.0 - vFog) * front;
    if (vis <= 0.001) discard;
    int T = int(vTone + 0.5);
    // the dark core and sleeve (same width, radius and falloff) photographed in daylight: the sleeve is the tone's glow
    // colour laid over the canvas (with a faint wider aura), the core its saturated ink; where the laser passes the core
    // turns hot (saturated blue) and the sleeve flares; the pen tip is a blue spark with a tiny white centre
    float ra = sg * 1.6;
    float aura = exp(-dist * dist / (ra * ra));
    float aGlow = clamp(glow * (uGlowA * vGain + hl * 0.4) + aura * uAuraA * vGain + tip * 0.6, 0.0, 1.0);
    float aCore = clamp(core * (vGain + hl), 0.0, 1.0);
    vec4 c = vec4(uGlow[T], aGlow);
    c = over(c, vec4(mix(uCore[T], uHot, clamp(hl, 0.0, 1.0)), aCore));
    c = over(c, vec4(1.0, 1.0, 1.0, smoothstep(0.72, 0.98, tip) * 0.9));
    gl_FragColor = vec4(c.rgb, clamp(c.a * vis, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

const blendFor = (light: boolean) =>
  ({ transparent: true, depthWrite: false, depthTest: false, blending: light ? NormalBlending : AdditiveBlending, toneMapped: false }) as const;

const layerUniforms = () => ({
  uDraw: { value: 99 }, uLayerA: { value: new Array(NL).fill(1) }, uFront: { value: new Array(NL).fill(1e3) },
  uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far },
});

export function lineMaterial(light: boolean) {
  const t = tones(light);
  return new ShaderMaterial({
    uniforms: light
      ? {
          ...layerUniforms(),
          uRes: { value: new Vector2(1, 1) }, uPx: { value: 1 }, uW: { value: 7.5 }, uSig: { value: 2.7 }, uGlowA: { value: 0.45 }, uAuraA: { value: 0.12 },
          uSweepX: { value: -99 }, uSweepA: { value: 0 }, uFade: { value: 1 }, uCore: { value: t.core }, uGlow: { value: t.glow },
          uHot: { value: new Color(DAY_HOT) },
        }
      : {
          ...layerUniforms(),
          uRes: { value: new Vector2(1, 1) }, uPx: { value: 1 }, uW: { value: 7.5 }, uSig: { value: 2.7 },
          uGlowGain: { value: 0.5 }, uSweepX: { value: -99 }, uSweepA: { value: 0 }, uFade: { value: 1 },
          uLight: { value: 0 }, uCore: { value: t.core }, uGlow: { value: t.glow },
        },
    vertexShader: LINE_VERT, fragmentShader: light ? LINE_FRAG_DAY : LINE_FRAG, side: DoubleSide, ...blendFor(light),
  });
}

/* ── text atlas ─────────────────────────────────────────────────────────────── */

export type Icon = "dot" | "check" | "warn" | "loop" | undefined;
export interface LabelDef { key: string; text: string; icon?: Icon; bold?: boolean }
export interface AtlasRect { u0: number; v0: number; u1: number; v1: number; aspect: number }

const FONT_PX = 44;
const SLOT_H = 68;
const ATLAS_W = 2048;
export const MONO = `"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`;

/** paints every label once (white glyphs with a baked soft halo; one atlas for both themes, so a label has one size);
 *  the shaders tint them */
export function makeTextAtlas(defs: LabelDef[]): { tex: Texture; rects: Record<string, AtlasRect> } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = (bold?: boolean) => `${bold ? 600 : 500} ${FONT_PX}px ${MONO}`;
  const pad = 14;
  const iconW = 50;
  type Placed = { d: LabelDef; x: number; y: number; w: number };
  const placed: Placed[] = [];
  let x = 0, y = 0;
  for (const d of defs) {
    g.font = font(d.bold);
    const w = Math.ceil(g.measureText(d.text).width + pad * 2 + (d.icon ? iconW : 0) + (d.icon === "dot" ? 34 : 0));
    if (x + w > ATLAS_W) { x = 0; y += SLOT_H; }
    placed.push({ d, x, y, w });
    x += w + 4;
  }
  const H = Math.pow(2, Math.ceil(Math.log2(y + SLOT_H)));
  c.width = ATLAS_W;
  c.height = H;
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.shadowColor = "rgba(255,255,255,0.55)";
  g.shadowBlur = 9;
  const rects: Record<string, AtlasRect> = {};
  for (const p of placed) {
    const { d } = p;
    g.font = font(d.bold);
    const cy = p.y + SLOT_H / 2;
    let tx = p.x + pad;
    if (d.icon === "dot") {
      // the LIVE pill: outline, dot, label
      g.lineWidth = 3;
      const r = SLOT_H / 2 - 7;
      g.beginPath();
      g.roundRect(p.x + 5, p.y + 7, p.w - 10, SLOT_H - 14, r);
      g.stroke();
      g.beginPath();
      g.arc(tx + 22, cy, 9, 0, Math.PI * 2);
      g.fill();
      tx += iconW + 14;
    } else if (d.icon === "check") {
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(tx + 6, cy + 1);
      g.lineTo(tx + 17, cy + 12);
      g.lineTo(tx + 38, cy - 12);
      g.stroke();
      tx += iconW;
    } else if (d.icon === "warn") {
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(tx + 22, cy - 17);
      g.lineTo(tx + 42, cy + 16);
      g.lineTo(tx + 2, cy + 16);
      g.closePath();
      g.stroke();
      g.fillRect(tx + 20, cy - 6, 4, 12);
      g.fillRect(tx + 20, cy + 9, 4, 4);
      tx += iconW;
    } else if (d.icon === "loop") {
      g.lineWidth = 4;
      g.beginPath();
      g.arc(tx + 20, cy, 14, -Math.PI * 0.35, Math.PI * 1.35);
      g.stroke();
      g.beginPath();
      g.moveTo(tx + 26, cy - 22);
      g.lineTo(tx + 34, cy - 12);
      g.lineTo(tx + 22, cy - 8);
      g.stroke();
      tx += iconW;
    }
    g.fillText(d.text, tx, cy + 2);
    rects[d.key] = { u0: p.x / ATLAS_W, u1: (p.x + p.w) / ATLAS_W, v0: 1 - (p.y + SLOT_H) / H, v1: 1 - p.y / H, aspect: p.w / SLOT_H };
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return { tex, rects };
}

/** collects label quads (one draw call): each knows its atlas rect, reveal (typewriter), layer and tone */
export class LabelBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private loc: number[] = [];
  private reveal: number[] = [];
  private style: number[] = [];
  private idx: number[] = [];
  private n = 0;
  constructor(private rects: Record<string, AtlasRect>) {}

  /** a label of world height h; anchor 0 = left edge at `at`, 0.5 = centred, 1 = right edge */
  add(key: string, at: V3, right: V3, up: V3, h: number, o: SegOpts & { anchor?: number } = {}) {
    const r = this.rects[key];
    if (!r) return;
    const w = h * r.aspect;
    const a = o.anchor ?? 0;
    const corners: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [cx, cy] of corners) {
      const ox = (cx - a) * w, oy = (cy - 0.5) * h;
      this.pos.push(at[0] + right[0] * ox + up[0] * oy, at[1] + right[1] * ox + up[1] * oy, at[2] + right[2] * ox + up[2] * oy);
      this.uv.push(cx ? r.u1 : r.u0, cy ? r.v1 : r.v0);
      this.loc.push(cx, cy);
      this.reveal.push(o.start ?? -1, o.dur ?? 0);
      this.style.push(o.layer ?? 0, o.tone ?? 0, o.gain ?? 1);
    }
    const i = this.n;
    this.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    this.n += 4;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("aLocal", new BufferAttribute(new Float32Array(this.loc), 2));
    g.setAttribute("aReveal", new BufferAttribute(new Float32Array(this.reveal), 2));
    g.setAttribute("aStyle", new BufferAttribute(new Float32Array(this.style), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const LABEL_VERT = /* glsl */ `
  ${LAYER_UNIFORMS}
  attribute vec2 aLocal; attribute vec2 aReveal; attribute vec3 aStyle;
  varying vec2 vUv; varying float vLx; varying float vP; varying float vA; varying float vFront; varying float vTone;
  varying float vGain; varying float vFog; varying float vWX;
  void main() {
    vUv = uv; vLx = aLocal.x;
    vP = aReveal.y > 0.0 ? clamp((uDraw - aReveal.x) / aReveal.y, 0.0, 1.0) : step(aReveal.x, uDraw);
    int L = int(aStyle.x + 0.5);
    vA = uLayerA[L]; vFront = uFront[L]; vTone = aStyle.y; vGain = aStyle.z;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWX = w.x;
    vec4 mv = viewMatrix * w;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const LABEL_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uFade; uniform float uLight; uniform vec3 uCore[6]; uniform vec3 uGlow[6];
  varying vec2 vUv; varying float vLx; varying float vP; varying float vA; varying float vFront; varying float vTone;
  varying float vGain; varying float vFog; varying float vWX;
  void main() {
    if (vP <= 0.002) discard;
    float a = texture2D(uMap, vUv).a;
    float p = vP > 0.998 ? 1.02 : vP;
    float typed = 1.0 - smoothstep(p - 0.015, p + 0.015, vLx);
    float cursor = p < 1.0 ? exp(-abs(vLx - p) * 90.0) * 0.5 : 0.0;
    float front = smoothstep(vFront, vFront - 0.1, vWX);
    float vis = vA * uFade * (1.0 - vFog) * front;
    if (vis <= 0.001) discard;
    float crisp = smoothstep(0.42, 0.9, a);
    int T = int(vTone + 0.5);
    if (uLight < 0.5) {
      vec3 col = (uCore[T] * crisp + uGlow[T] * a * 0.55) * vGain * typed + uGlow[T] * cursor;
      gl_FragColor = vec4(col * vis, 1.0);
    } else {
      float al = (crisp * 0.95 + a * 0.06) * vGain * typed + cursor * 0.4;
      gl_FragColor = vec4(uCore[T], clamp(al * vis, 0.0, 1.0));
    }
    #include <colorspace_fragment>
  }`;
const LABEL_FRAG_DAY = /* glsl */ `
  uniform sampler2D uMap; uniform float uFade; uniform vec3 uCore[6]; uniform vec3 uGlow[6]; uniform float uGlowA;
  varying vec2 vUv; varying float vLx; varying float vP; varying float vA; varying float vFront; varying float vTone;
  varying float vGain; varying float vFog; varying float vWX;
  ${OVER}
  void main() {
    if (vP <= 0.002) discard;
    float a = texture2D(uMap, vUv).a;
    float p = vP > 0.998 ? 1.02 : vP;
    float typed = 1.0 - smoothstep(p - 0.015, p + 0.015, vLx);
    float cursor = p < 1.0 ? exp(-abs(vLx - p) * 90.0) * 0.5 : 0.0;
    float front = smoothstep(vFront, vFront - 0.1, vWX);
    float vis = vA * uFade * (1.0 - vFog) * front;
    if (vis <= 0.001) discard;
    float crisp = smoothstep(0.42, 0.9, a);
    int T = int(vTone + 0.5);
    // the glyphs in a legible ink over the label's baked halo, which glows in the tone's colour as it does in the dark
    float g = min(vGain, 1.0) * typed;
    vec4 c = vec4(uGlow[T], clamp(a * uGlowA * g + cursor * 0.8, 0.0, 1.0));
    c = over(c, vec4(uCore[T], clamp(crisp * g, 0.0, 1.0)));
    gl_FragColor = vec4(c.rgb, clamp(c.a * vis, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

export function labelMaterial(light: boolean, map: Texture) {
  const t = labelTones(light);
  return new ShaderMaterial({
    uniforms: {
      ...layerUniforms(), uMap: { value: map }, uFade: { value: 1 }, uLight: { value: light ? 1 : 0 }, uCore: { value: t.core }, uGlow: { value: t.glow },
      uGlowA: { value: 0.3 },
    },
    vertexShader: LABEL_VERT, fragmentShader: light ? LABEL_FRAG_DAY : LABEL_FRAG, ...blendFor(light),
  });
}

/* ── UI atlas: four app screens, a docs page and the live app (white with alpha; tinted in the shader) ─── */

/** screen layout boxes in normalised panel coordinates (x right, y down) */
export type Kind = "hdr" | "box" | "txt" | "btn" | "img" | "row" | "chart" | "circ" | "kpi" | "field";
export interface UiBox { r: [number, number, number, number]; k: Kind }

export const SCREENS: UiBox[][] = [
  // FR-01 sign in
  [
    { r: [0, 0, 1, 0.09], k: "hdr" },
    { r: [0.38, 0.16, 0.62, 0.33], k: "circ" },
    { r: [0.24, 0.38, 0.76, 0.42], k: "txt" },
    { r: [0.1, 0.48, 0.9, 0.56], k: "field" },
    { r: [0.1, 0.6, 0.9, 0.68], k: "field" },
    { r: [0.1, 0.75, 0.9, 0.83], k: "btn" },
    { r: [0.3, 0.89, 0.7, 0.92], k: "txt" },
  ],
  // FR-04 order list
  [
    { r: [0, 0, 1, 0.09], k: "hdr" },
    { r: [0.07, 0.13, 0.93, 0.19], k: "field" },
    { r: [0.07, 0.24, 0.93, 0.35], k: "row" },
    { r: [0.07, 0.38, 0.93, 0.49], k: "row" },
    { r: [0.07, 0.52, 0.93, 0.63], k: "row" },
    { r: [0.07, 0.66, 0.93, 0.77], k: "row" },
    { r: [0.07, 0.84, 0.93, 0.92], k: "btn" },
  ],
  // FR-07 order detail
  [
    { r: [0, 0, 1, 0.09], k: "hdr" },
    { r: [0.07, 0.13, 0.93, 0.4], k: "img" },
    { r: [0.07, 0.45, 0.6, 0.49], k: "txt" },
    { r: [0.07, 0.53, 0.93, 0.57], k: "txt" },
    { r: [0.07, 0.61, 0.8, 0.65], k: "txt" },
    { r: [0.07, 0.69, 0.88, 0.73], k: "txt" },
    { r: [0.07, 0.83, 0.47, 0.91], k: "box" },
    { r: [0.53, 0.83, 0.93, 0.91], k: "btn" },
  ],
  // FR-09 invoices dashboard
  [
    { r: [0, 0, 1, 0.09], k: "hdr" },
    { r: [0.07, 0.13, 0.48, 0.29], k: "kpi" },
    { r: [0.52, 0.13, 0.93, 0.29], k: "kpi" },
    { r: [0.07, 0.34, 0.93, 0.64], k: "chart" },
    { r: [0.07, 0.69, 0.93, 0.79], k: "row" },
    { r: [0.07, 0.82, 0.93, 0.92], k: "row" },
  ],
];

export const DOC_PAGE: UiBox[] = [
  { r: [0.1, 0.08, 0.62, 0.13], k: "txt" },
  { r: [0.1, 0.18, 0.9, 0.2], k: "txt" },
  { r: [0.1, 0.23, 0.85, 0.25], k: "txt" },
  { r: [0.1, 0.28, 0.9, 0.3], k: "txt" },
  { r: [0.1, 0.36, 0.9, 0.6], k: "img" },
  { r: [0.1, 0.66, 0.5, 0.7], k: "txt" },
  { r: [0.1, 0.74, 0.9, 0.76], k: "txt" },
  { r: [0.1, 0.79, 0.82, 0.81], k: "txt" },
  { r: [0.1, 0.84, 0.88, 0.86], k: "txt" },
];

export const LIVE_APP: UiBox[] = [
  { r: [0, 0, 1, 0.11], k: "hdr" },
  { r: [0.03, 0.16, 0.22, 0.95], k: "box" },
  { r: [0.26, 0.16, 0.48, 0.36], k: "kpi" },
  { r: [0.51, 0.16, 0.73, 0.36], k: "kpi" },
  { r: [0.76, 0.16, 0.97, 0.36], k: "kpi" },
  { r: [0.26, 0.41, 0.97, 0.7], k: "chart" },
  { r: [0.26, 0.74, 0.97, 0.84], k: "row" },
  { r: [0.26, 0.86, 0.97, 0.96], k: "row" },
];

/** atlas cells (4 x 2 of 512 px): the content rectangle of each, in canvas pixels */
export interface Cell { x: number; y: number; w: number; h: number }
const CELL = 512;
const cellRect = (col: number, row: number, aspect: number): Cell => {
  const w = aspect >= 1 ? CELL - 16 : Math.round((CELL - 16) * aspect);
  const h = aspect >= 1 ? Math.round((CELL - 16) / aspect) : CELL - 16;
  return { x: col * CELL + (CELL - w) / 2, y: row * CELL + (CELL - h) / 2, w, h };
};

export function makeUiAtlas(screenAspect: number, docAspect: number, liveAspect: number) {
  const c = document.createElement("canvas");
  c.width = CELL * 4;
  c.height = CELL * 2;
  const g = c.getContext("2d")!;
  const cells = {
    screens: [0, 1, 2, 3].map((i) => cellRect(i, 0, screenAspect)),
    doc: cellRect(0, 1, docAspect),
    live: cellRect(1, 1, liveAspect),
  };
  const paint = (cell: Cell, boxes: UiBox[], seed: number) => {
    const X = (v: number) => cell.x + v * cell.w;
    const Y = (v: number) => cell.y + v * cell.h;
    const a = (al: number) => `rgba(255,255,255,${al})`;
    const bar = (x0: number, y0: number, x1: number, y1: number, al: number) => {
      g.fillStyle = a(al);
      g.beginPath();
      g.roundRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), Math.min(6, (y1 - y0) / 2));
      g.fill();
    };
    let k = seed;
    const rnd = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    for (const b of boxes) {
      const [x0, y0, x1, y1] = [X(b.r[0]), Y(b.r[1]), X(b.r[2]), Y(b.r[3])];
      const h = y1 - y0, w = x1 - x0;
      switch (b.k) {
        case "hdr":
          bar(x0, y0, x1, y1, 0.16);
          bar(x0 + w * 0.07, y0 + h * 0.38, x0 + w * 0.36, y0 + h * 0.62, 0.85);
          for (let i = 0; i < 3; i++) { g.fillStyle = a(0.6); g.beginPath(); g.arc(x1 - w * (0.08 + i * 0.07), y0 + h / 2, h * 0.12, 0, 7); g.fill(); }
          break;
        case "txt":
          bar(x0, y0, x1, y1, 0.5);
          break;
        case "field":
          g.strokeStyle = a(0.55); g.lineWidth = 2;
          g.beginPath(); g.roundRect(x0, y0, w, h, 6); g.stroke();
          bar(x0 + w * 0.05, y0 + h * 0.4, x0 + w * 0.45, y0 + h * 0.6, 0.35);
          break;
        case "btn":
          bar(x0, y0, x1, y1, 0.95);
          g.globalCompositeOperation = "destination-out";
          bar(x0 + w * 0.32, y0 + h * 0.4, x1 - w * 0.32, y1 - h * 0.4, 1);
          g.globalCompositeOperation = "source-over";
          break;
        case "box":
          g.fillStyle = a(0.08); g.fillRect(x0, y0, w, h);
          g.strokeStyle = a(0.5); g.lineWidth = 2; g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
          for (let i = 0; i < 6 && y0 + h * (0.12 + i * 0.13) < y1 - 8; i++) bar(x0 + w * 0.12, y0 + h * (0.1 + i * 0.13), x0 + w * (0.6 + rnd() * 0.28), y0 + h * (0.1 + i * 0.13) + 7, 0.4);
          break;
        case "img": {
          const grd = g.createLinearGradient(x0, y0, x1, y1);
          grd.addColorStop(0, a(0.34)); grd.addColorStop(1, a(0.08));
          g.fillStyle = grd; g.fillRect(x0, y0, w, h);
          g.strokeStyle = a(0.6); g.lineWidth = 2;
          g.beginPath(); g.moveTo(x0 + w * 0.08, y1 - h * 0.12); g.lineTo(x0 + w * 0.38, y0 + h * 0.42); g.lineTo(x0 + w * 0.58, y0 + h * 0.66);
          g.lineTo(x0 + w * 0.72, y0 + h * 0.5); g.lineTo(x1 - w * 0.08, y1 - h * 0.12); g.stroke();
          g.fillStyle = a(0.7); g.beginPath(); g.arc(x0 + w * 0.76, y0 + h * 0.26, h * 0.09, 0, 7); g.fill();
          break;
        }
        case "row":
          g.fillStyle = a(0.07); g.fillRect(x0, y0, w, h);
          g.fillStyle = a(0.65); g.beginPath(); g.arc(x0 + h * 0.5, y0 + h / 2, h * 0.28, 0, 7); g.fill();
          bar(x0 + h * 1.0, y0 + h * 0.28, x0 + w * (0.5 + rnd() * 0.2), y0 + h * 0.44, 0.7);
          bar(x0 + h * 1.0, y0 + h * 0.58, x0 + w * (0.35 + rnd() * 0.2), y0 + h * 0.7, 0.32);
          bar(x1 - w * 0.17, y0 + h * 0.36, x1 - w * 0.04, y0 + h * 0.64, 0.55);
          break;
        case "chart": {
          g.fillStyle = a(0.05); g.fillRect(x0, y0, w, h);
          g.strokeStyle = a(0.35); g.lineWidth = 2;
          g.beginPath(); g.moveTo(x0 + 4, y0 + 4); g.lineTo(x0 + 4, y1 - 4); g.lineTo(x1 - 4, y1 - 4); g.stroke();
          const n = 9;
          for (let i = 0; i < n; i++) {
            const bh = (0.25 + 0.65 * Math.abs(Math.sin(i * 1.7 + seed))) * (h - 16);
            const bx = x0 + 12 + (i * (w - 20)) / n;
            bar(bx, y1 - 6 - bh, bx + (w - 20) / n - 7, y1 - 6, 0.35 + 0.5 * (i / n));
          }
          break;
        }
        case "kpi":
          g.fillStyle = a(0.09); g.fillRect(x0, y0, w, h);
          bar(x0 + w * 0.1, y0 + h * 0.2, x0 + w * 0.5, y0 + h * 0.32, 0.4);
          bar(x0 + w * 0.1, y0 + h * 0.45, x0 + w * 0.78, y0 + h * 0.75, 0.9);
          break;
        case "circ":
          g.fillStyle = a(0.5); g.beginPath(); g.arc((x0 + x1) / 2, (y0 + y1) / 2, Math.min(w, h) / 2, 0, 7); g.fill();
          g.globalCompositeOperation = "destination-out";
          g.beginPath(); g.arc((x0 + x1) / 2, (y0 + y1) / 2, Math.min(w, h) / 4, 0, 7); g.fill();
          g.globalCompositeOperation = "source-over";
          break;
      }
    }
  };
  cells.screens.forEach((cell, i) => paint(cell, SCREENS[i], i + 3));
  paint(cells.doc, DOC_PAGE, 11);
  paint(cells.live, LIVE_APP, 5);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return { tex, cells, size: { w: c.width, h: c.height } };
}

/** a panel plane whose uv points into an atlas cell; aLocal (0..1) and aSize (metres) drive the glass rim */
export function panelGeometry(w: number, h: number, cell: Cell, atlas: { w: number; h: number }, group: number): BufferGeometry {
  const pos = new Float32Array([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, -w / 2, h / 2, 0, w / 2, h / 2, 0]);
  const loc = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const uv = new Float32Array(8);
  for (let i = 0; i < 4; i++) {
    const lx = loc[i * 2], ly = loc[i * 2 + 1];
    uv[i * 2] = (cell.x + lx * cell.w) / atlas.w;
    uv[i * 2 + 1] = 1 - (cell.y + (1 - ly) * cell.h) / atlas.h;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setAttribute("aLocal", new BufferAttribute(loc, 2));
  g.setAttribute("aSize", new BufferAttribute(new Float32Array([w, h, w, h, w, h, w, h]), 2));
  g.setAttribute("aGroup", new BufferAttribute(new Float32Array([group, group, group, group]), 1));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

const PANEL_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  attribute vec2 aLocal; attribute vec2 aSize; attribute float aGroup;
  varying vec2 vUv; varying vec2 vLocal; varying vec2 vSize; varying float vGroup; varying float vWX; varying float vFog;
  void main() {
    vUv = uv; vLocal = aLocal; vSize = aSize; vGroup = aGroup;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWX = w.x;
    vec4 mv = viewMatrix * w;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/** glass (01 Planner) and lit UI content (02 Developer), each revealed behind its laser sweep */
const PANEL_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uGlassFront; uniform float uUiFront; uniform float uSweepX; uniform float uSweepA;
  uniform float uGroupA[3]; uniform float uScan; uniform float uTime; uniform float uLight;
  uniform vec3 uTint; uniform vec3 uInk; uniform vec3 uHot; uniform vec3 uDeep;
  varying vec2 vUv; varying vec2 vLocal; varying vec2 vSize; varying float vGroup; varying float vWX; varying float vFog;
  void main() {
    int G = int(vGroup + 0.5);
    float ga = uGroupA[G];
    if (ga <= 0.001) discard;
    float gv, uv;
    if (G == 0) {
      gv = smoothstep(uGlassFront, uGlassFront - 0.14, vWX);
      uv = smoothstep(uUiFront, uUiFront - 0.14, vWX);
    } else if (G == 1) {
      gv = 1.0;
      uv = smoothstep(1.0 - uScan - 0.04, 1.0 - uScan, vLocal.y);
    } else { gv = 1.0; uv = 1.0; }
    vec2 m = min(vLocal, 1.0 - vLocal) * vSize;
    float edge = min(m.x, m.y);
    float rim = exp(-edge / 0.03);
    float diag = (vLocal.x * vSize.x + vLocal.y * vSize.y) * 2.2 - mod(uTime * 0.35, 6.0) + 1.0;
    float sheen = exp(-diag * diag * 9.0) * 0.5;
    float tex = texture2D(uMap, vUv).a;
    float scanline = 0.9 + 0.1 * sin(vLocal.y * vSize.y * 280.0);
    float sx = (vWX - uSweepX) / 0.08;
    float hl = uSweepA * exp(-sx * sx) * (G == 0 ? 1.0 : 0.0);
    float scanEdge = G == 1 ? exp(-abs(vLocal.y - (1.0 - uScan)) * 70.0) * step(uScan, 0.999) : 0.0;
    float fog = 1.0 - vFog;
    if (uLight < 0.5) {
      vec3 glass = uTint * (0.045 + rim * 0.22 + sheen * 0.07) * gv;
      vec3 ui = mix(uDeep, uHot, tex * tex) * tex * 1.15 * scanline * uv;
      vec3 col = glass + ui + uHot * (hl * 0.3 * gv + scanEdge * 0.8);
      gl_FragColor = vec4(col * ga * fog, 1.0);
    } else {
      float aGlass = (0.34 + rim * 0.3 + sheen * 0.15) * gv;
      float aUi = tex * 0.92 * uv;
      float a = 1.0 - (1.0 - aGlass) * (1.0 - aUi);
      vec3 col = mix(vec3(1.0), uInk, aUi / max(a, 0.001));
      col = mix(col, uInk, rim * 0.25 * gv + hl * 0.2 + scanEdge * 0.6);
      gl_FragColor = vec4(col, clamp((a + scanEdge * 0.5) * ga * fog, 0.0, 1.0));
    }
    #include <colorspace_fragment>
  }`;
const PANEL_FRAG_DAY = /* glsl */ `
  uniform sampler2D uMap; uniform float uGlassFront; uniform float uUiFront; uniform float uSweepX; uniform float uSweepA;
  uniform float uGroupA[3]; uniform float uScan; uniform float uTime; uniform float uWhite[3];
  uniform vec3 uTint; uniform vec3 uHot; uniform vec3 uDeep;
  varying vec2 vUv; varying vec2 vLocal; varying vec2 vSize; varying float vGroup; varying float vWX; varying float vFog;
  ${OVER}
  void main() {
    int G = int(vGroup + 0.5);
    float ga = uGroupA[G];
    if (ga <= 0.001) discard;
    float gv, uv;
    if (G == 0) {
      gv = smoothstep(uGlassFront, uGlassFront - 0.14, vWX);
      uv = smoothstep(uUiFront, uUiFront - 0.14, vWX);
    } else if (G == 1) {
      gv = 1.0;
      uv = smoothstep(1.0 - uScan - 0.04, 1.0 - uScan, vLocal.y);
    } else { gv = 1.0; uv = 1.0; }
    vec2 m = min(vLocal, 1.0 - vLocal) * vSize;
    float edge = min(m.x, m.y);
    float rim = exp(-edge / 0.03);
    float diag = (vLocal.x * vSize.x + vLocal.y * vSize.y) * 2.2 - mod(uTime * 0.35, 6.0) + 1.0;
    float sheen = exp(-diag * diag * 9.0) * 0.5;
    float tex = texture2D(uMap, vUv).a;
    float scanline = 0.9 + 0.1 * sin(vLocal.y * vSize.y * 280.0);
    float sx = (vWX - uSweepX) / 0.08;
    float hl = uSweepA * exp(-sx * sx) * (G == 0 ? 1.0 : 0.0);
    float scanEdge = G == 1 ? exp(-abs(vLocal.y - (1.0 - uScan)) * 70.0) * step(uScan, 0.999) : 0.0;
    // the dark glass photographed in daylight: a light white tint with the dark glass's blue (its rim, the neon edge,
    // and its sheen) laid over it as glow; the UI glows from deep blue (its faint parts) to saturated blue (what is
    // white-hot in the dark theme); the laser's pass and the live app's scan edge are saturated blue. The docs pages
    // stack six deep, so their white is lighter: their blue builds up where they overlap, as their light does in dark
    vec4 c = vec4(1.0, 1.0, 1.0, uWhite[G] * gv);
    c = over(c, vec4(uTint, clamp((0.045 + rim * 0.22 + sheen * 0.07) * 1.7 * gv, 0.0, 1.0)));
    c = over(c, vec4(mix(uDeep, uHot, tex * tex), clamp(tex * 1.15 * scanline * uv, 0.0, 1.0)));
    c = over(c, vec4(uHot, clamp(hl * 0.3 * gv + scanEdge * 0.8, 0.0, 1.0)));
    gl_FragColor = vec4(c.rgb, clamp(c.a * ga * (1.0 - vFog), 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

export function panelMaterial(light: boolean, map: Texture) {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map }, uGlassFront: { value: -1e3 }, uUiFront: { value: -1e3 }, uSweepX: { value: -99 }, uSweepA: { value: 0 },
      uGroupA: { value: [1, 0, 0] }, uScan: { value: 0 }, uTime: { value: 0 }, uLight: { value: light ? 1 : 0 },
      uTint: { value: new Color(light ? "#2E68FF" : "#5C86FF") }, uInk: { value: new Color("#2E68FF") },
      uHot: { value: new Color(light ? DAY_HOT : "#E4ECFF") }, uDeep: { value: new Color(light ? "#1747C8" : "#2E68FF") },
      uWhite: { value: [0.5, 0.5, 0.15] }, uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far },
    },
    vertexShader: PANEL_VERT, fragmentShader: light ? PANEL_FRAG_DAY : PANEL_FRAG, side: DoubleSide, ...blendFor(light),
  });
}

/* ── the shield: a hexagonal lattice that rises over the data model after the SecOps fix ─────────── */

const SHIELD_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV; varying float vFog;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SHIELD_FRAG = /* glsl */ `
  uniform float uRise; uniform float uAlpha; uniform float uTime; uniform float uLight; uniform vec3 uCol; uniform vec3 uHot;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV; varying float vFog;
  vec2 hexCell(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    return dot(a, a) < dot(b, b) ? a : b;
  }
  void main() {
    if (uAlpha <= 0.001) discard;
    vec3 p = normalize(vLocal);
    float elev = asin(clamp(p.y, -1.0, 1.0));
    float az = atan(p.x, p.z);
    vec2 q = vec2(az * 34.0 / 6.2831853, elev * 34.0 / 6.2831853) * vec2(1.0, 1.15);
    vec2 g = abs(hexCell(q));
    float d = 0.5 - max(dot(g, vec2(0.5, 0.8660254)), g.x);
    float fw = fwidth(d) * 1.2;
    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.6, d);
    float h01 = elev / 1.5707963;
    float shown = smoothstep(uRise + 0.02, uRise - 0.06, h01);
    float front = exp(-abs(h01 - uRise) * 28.0) * step(uRise, 0.999) * step(0.001, uRise);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float top = 1.0 - smoothstep(0.62, 0.98, h01);
    float shimmer = 0.75 + 0.25 * sin(uTime * 2.0 - elev * 9.0 + az * 3.0);
    float k = (line * (0.07 + fres * 0.55) * shimmer * top + fres * 0.045) * shown + front * (0.18 + line * 0.7);
    k *= uAlpha * (1.0 - vFog);
    if (uLight < 0.5) gl_FragColor = vec4((uCol * k + uHot * front * line * 0.6 * uAlpha), 1.0);
    else gl_FragColor = vec4(uCol, clamp(k * 0.5, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;
const SHIELD_FRAG_DAY = /* glsl */ `
  uniform float uRise; uniform float uAlpha; uniform float uTime; uniform vec3 uCol; uniform vec3 uHot;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV; varying float vFog;
  vec2 hexCell(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    return dot(a, a) < dot(b, b) ? a : b;
  }
  ${OVER}
  void main() {
    if (uAlpha <= 0.001) discard;
    vec3 p = normalize(vLocal);
    float elev = asin(clamp(p.y, -1.0, 1.0));
    float az = atan(p.x, p.z);
    vec2 q = vec2(az * 34.0 / 6.2831853, elev * 34.0 / 6.2831853) * vec2(1.0, 1.15);
    vec2 g = abs(hexCell(q));
    float d = 0.5 - max(dot(g, vec2(0.5, 0.8660254)), g.x);
    float fw = fwidth(d) * 1.2;
    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.6, d);
    float h01 = elev / 1.5707963;
    float shown = smoothstep(uRise + 0.02, uRise - 0.06, h01);
    float front = exp(-abs(h01 - uRise) * 28.0) * step(uRise, 0.999) * step(0.001, uRise);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float top = 1.0 - smoothstep(0.62, 0.98, h01);
    float shimmer = 0.75 + 0.25 * sin(uTime * 2.0 - elev * 9.0 + az * 3.0);
    // the dark hologram's lattice photographed in daylight: its glow (the fresnel fill and the rising band) in blue over
    // the canvas, its lattice lines in the same blue, firmer, and the rising front's hot edge in saturated blue
    float vis = uAlpha * (1.0 - vFog);
    float aLine = line * (0.07 + fres * 0.55) * shimmer * top * shown + front * line * 0.7;
    float aGlow = fres * 0.045 * shown + front * 0.18;
    vec4 c = vec4(uCol, clamp(aGlow * 1.6 * vis, 0.0, 1.0));
    c = over(c, vec4(uCol, clamp(aLine * 1.3 * vis, 0.0, 1.0)));
    c = over(c, vec4(uHot, clamp(front * line * 0.6 * uAlpha, 0.0, 1.0)));
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

export function shieldMaterial(light: boolean) {
  return new ShaderMaterial({
    uniforms: {
      uRise: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 }, uLight: { value: light ? 1 : 0 },
      uCol: { value: new Color(light ? "#2E68FF" : "#3A72FF") }, uHot: { value: new Color(light ? DAY_HOT : "#E4ECFF") },
      uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far },
    },
    vertexShader: SHIELD_VERT, fragmentShader: light ? SHIELD_FRAG_DAY : SHIELD_FRAG, side: DoubleSide, ...blendFor(light),
  });
}

/* ── the laser sheet: one vertical plane per agent pass ─────────────────────── */

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SWEEP_FRAG = /* glsl */ `
  uniform float uA; uniform float uTime; uniform float uLight; uniform vec3 uCol; uniform vec3 uHot; uniform vec3 uViolet;
  varying vec2 vUv;
  void main() {
    if (uA <= 0.001) discard;
    vec2 e = min(vUv, 1.0 - vUv);
    float frameV = exp(-e.x * 140.0);
    float bottom = exp(-vUv.y * 70.0);
    float top = exp(-(1.0 - vUv.y) * 160.0);
    float fill = 0.05 * (1.0 - vUv.y * 0.6);
    float lines = 0.5 + 0.5 * sin(vUv.y * 220.0 - uTime * 12.0);
    float k = fill * (0.6 + 0.4 * lines) + bottom * 0.9 + top * 0.55 + frameV * 0.4;
    float vi = top * smoothstep(0.35, 0.5, abs(vUv.x - 0.5));
    if (uLight < 0.5) gl_FragColor = vec4((uCol * k + uHot * (bottom * 0.6 + top * 0.3) + uViolet * vi * 0.8) * uA, 1.0);
    else gl_FragColor = vec4(mix(uCol, uViolet, vi), clamp(k * 0.55 * uA, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;
const SWEEP_FRAG_DAY = /* glsl */ `
  uniform float uA; uniform float uTime; uniform vec3 uCol; uniform vec3 uHot; uniform vec3 uViolet;
  varying vec2 vUv;
  ${OVER}
  void main() {
    if (uA <= 0.001) discard;
    vec2 e = min(vUv, 1.0 - vUv);
    float frameV = exp(-e.x * 140.0);
    float bottom = exp(-vUv.y * 70.0);
    float top = exp(-(1.0 - vUv.y) * 160.0);
    float fill = 0.05 * (1.0 - vUv.y * 0.6);
    float lines = 0.5 + 0.5 * sin(vUv.y * 220.0 - uTime * 12.0);
    float k = fill * (0.6 + 0.4 * lines) + bottom * 0.9 + top * 0.55 + frameV * 0.4;
    float vi = top * smoothstep(0.35, 0.5, abs(vUv.x - 0.5));
    // the dark sheet photographed in daylight: its glow in blue over the canvas, its white-hot floor and top edges in
    // saturated blue, its violet corners violet
    vec4 c = vec4(uCol, clamp(k * 0.85, 0.0, 1.0));
    c = over(c, vec4(uHot, clamp(bottom * 0.6 + top * 0.3, 0.0, 1.0)));
    c = over(c, vec4(uViolet, clamp(vi * 0.8, 0.0, 1.0)));
    gl_FragColor = vec4(c.rgb, clamp(c.a * uA, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

export function sweepMaterial(light: boolean) {
  return new ShaderMaterial({
    uniforms: {
      uA: { value: 0 }, uTime: { value: 0 }, uLight: { value: light ? 1 : 0 },
      uCol: { value: new Color("#2E68FF") }, uHot: { value: new Color(light ? DAY_HOT : "#E4ECFF") }, uViolet: { value: new Color("#7C5CFF") },
    },
    vertexShader: UV_VERT, fragmentShader: light ? SWEEP_FRAG_DAY : SWEEP_FRAG, side: DoubleSide, ...blendFor(light),
  });
}

/* ── the deploy beam: a vertical shaft with streaks rising into the ring ────── */

const BEAM_FRAG = /* glsl */ `
  uniform float uA; uniform float uTime; uniform float uLight; uniform vec3 uCol; uniform vec3 uHot;
  varying vec2 vUv;
  void main() {
    if (uA <= 0.001) discard;
    float x = (vUv.x - 0.5);
    float core = exp(-x * x * 900.0);
    float sleeve = exp(-x * x * 60.0);
    float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    float streak = pow(0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 14.0), 6.0);
    float k = (core * (0.9 + streak * 0.6) + sleeve * (0.22 + streak * 0.18)) * ends;
    if (uLight < 0.5) gl_FragColor = vec4((uCol * sleeve * 0.8 + uHot * core) * k * uA, 1.0);
    else gl_FragColor = vec4(uCol, clamp(k * 0.7 * uA, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;
const BEAM_FRAG_DAY = /* glsl */ `
  uniform float uA; uniform float uTime; uniform vec3 uCol; uniform vec3 uHot;
  varying vec2 vUv;
  ${OVER}
  void main() {
    if (uA <= 0.001) discard;
    float x = (vUv.x - 0.5);
    float core = exp(-x * x * 900.0);
    float sleeve = exp(-x * x * 60.0);
    float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    float streak = pow(0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 14.0), 6.0);
    float k = (core * (0.9 + streak * 0.6) + sleeve * (0.22 + streak * 0.18)) * ends;
    // the dark beam photographed in daylight: its sleeve in blue over the canvas, its white-hot core in saturated blue,
    // with a tiny white centre where the streaks (the rising pulses) peak
    vec4 c = vec4(uCol, clamp(sleeve * 0.8 * k * 1.1, 0.0, 1.0));
    c = over(c, vec4(uHot, clamp(core * k, 0.0, 1.0)));
    c = over(c, vec4(1.0, 1.0, 1.0, smoothstep(0.6, 0.95, core) * smoothstep(1.05, 1.45, k) * 0.9));
    gl_FragColor = vec4(c.rgb, clamp(c.a * uA, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

export function beamMaterial(light: boolean) {
  return new ShaderMaterial({
    uniforms: {
      uA: { value: 0 }, uTime: { value: 0 }, uLight: { value: light ? 1 : 0 },
      uCol: { value: new Color("#2E68FF") }, uHot: { value: new Color(light ? DAY_HOT : "#E4ECFF") },
    },
    vertexShader: UV_VERT, fragmentShader: light ? BEAM_FRAG_DAY : BEAM_FRAG, side: DoubleSide, ...blendFor(light),
  });
}

/* ── the drafting floor ─────────────────────────────────────────────────────── */

const FLOOR_VERT = /* glsl */ `
  varying vec3 vW; varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uGrid; uniform vec3 uGlow; uniform vec3 uHot; uniform float uLight;
  uniform float uSweepX; uniform float uSweepA; uniform float uFogNear; uniform float uFogFar; uniform vec2 uCenter; uniform float uPool;
  varying vec3 vW; varying float vDepth;
  float grid(vec2 p, float s) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float fog = smoothstep(uFogNear, uFogFar + 6.0, vDepth);
    vec2 d = (vW.xz - uCenter) / vec2(3.6, 2.7);
    float spot = exp(-dot(d, d) * 0.9);
    float minor = grid(vW.xz, 0.25);
    float major = grid(vW.xz, 1.0);
    float g = (minor * 0.4 + major * 0.75) * spot * (1.0 - fog);
    float inZ = smoothstep(-1.9, -1.3, vW.z) * smoothstep(2.9, 2.3, vW.z);
    float dx = vW.x - uSweepX;
    float sweep = (exp(-dx * dx / 0.0005) + (dx < 0.0 ? exp(dx / 0.45) * 0.16 : 0.0) + exp(-dx * dx / 0.03) * 0.12) * uSweepA * inZ * (1.0 - fog);
    float pool = spot * spot * uPool * (1.0 - fog);
    vec3 col;
    if (uLight < 0.5) col = uBg + uGrid * g * 0.085 + uGlow * pool * 0.05 + (uGlow * 0.6 + uHot * 0.4) * sweep;
    else col = mix(uBg, uGrid, clamp(g * 0.13 + sweep * 0.55 + pool * 0.025, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
const FLOOR_FRAG_DAY = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uGrid; uniform vec3 uGlow; uniform vec3 uHot; uniform float uGridA;
  uniform float uSweepX; uniform float uSweepA; uniform float uFogNear; uniform float uFogFar; uniform vec2 uCenter; uniform float uPool;
  varying vec3 vW; varying float vDepth;
  float grid(vec2 p, float s) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float fog = smoothstep(uFogNear, uFogFar + 6.0, vDepth);
    vec2 d = (vW.xz - uCenter) / vec2(3.6, 2.7);
    float spot = exp(-dot(d, d) * 0.9);
    float minor = grid(vW.xz, 0.25);
    float major = grid(vW.xz, 1.0);
    float inZ = smoothstep(-1.9, -1.3, vW.z) * smoothstep(2.9, 2.3, vW.z);
    float dx = vW.x - uSweepX;
    float trace = exp(-dx * dx / 0.0005) * uSweepA * inZ * (1.0 - fog);
    float trail = ((dx < 0.0 ? exp(dx / 0.45) * 0.16 : 0.0) + exp(-dx * dx / 0.03) * 0.12) * uSweepA * inZ * (1.0 - fog);
    float pool = spot * spot * uPool * (1.0 - fog);
    // the dark floor on the light canvas: the same grid in blue (about 0.15 at the focal point, fading with distance as
    // the dark one appears to), a very faint blue pool, the laser's trace in saturated blue in its blue glow, and a
    // half-level dither against banding; far away it is exactly the canvas, so the edges stay seamless
    float aGrid = uGridA * max(minor * 0.55, major) * pow(spot * (1.0 - fog), 0.6);
    vec3 col = mix(uBg, uGlow, clamp(pool * 0.04 + trail * 0.6, 0.0, 1.0));
    col = mix(col, uGrid, clamp(aGrid, 0.0, 1.0));
    col = mix(col, uHot, clamp(trace * 0.7, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }`;

export function floorMaterial(light: boolean) {
  return new ShaderMaterial({
    uniforms: {
      uBg: { value: new Color() }, uGrid: { value: new Color(light ? "#1F5BFF" : "#8EA6E8") }, uGlow: { value: new Color(light ? "#2E68FF" : "#1F5BFF") },
      uHot: { value: new Color(light ? DAY_HOT : "#E4ECFF") }, uLight: { value: light ? 1 : 0 }, uSweepX: { value: -99 }, uSweepA: { value: 0 },
      uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far }, uCenter: { value: new Vector2(0, 0.4) }, uPool: { value: 0.6 },
      uGridA: { value: 0.15 },
    },
    vertexShader: FLOOR_VERT, fragmentShader: light ? FLOOR_FRAG_DAY : FLOOR_FRAG, toneMapped: false,
  });
}

/* ── soft glow sprite textures ──────────────────────────────────────────────── */

export function makeGlowTexture(): Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.12, "rgba(255,255,255,0.7)");
  grd.addColorStop(0.32, "rgba(255,255,255,0.22)");
  grd.addColorStop(0.62, "rgba(255,255,255,0.05)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new CanvasTexture(c);
}
