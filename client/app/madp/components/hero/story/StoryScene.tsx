/** Story, the default landing-hero concept: "Brief -> Light -> Live app" as one 16-second film in four acts.
 *   1 INPUT  (0-3 s)   the brief's source material floats in as glass cards (an email, a PDF, meeting notes, a
 *                      whiteboard photo, a screenshot); the factory reads them and they burn away into streams of
 *                      light that braid into one bright point.
 *   2 LINE   (3-10 s)  the light becomes one beam that runs MADP's agent gates, stage by stage, and the deploy gate; each gate
 *                      flares and the beam comes out cleaner and brighter. SecOps flags an issue (amber/red), the
 *                      work loops back to the Developer on its own, is fixed, re-checked and passes green.
 *   3 OUTPUT (10-13 s) the beam prints the app: a dashboard and a phone draw their edges in neon and fill with UI,
 *                      an uplink rises to SELISE Blocks and a LIVE tag pulses.
 *   4 SCALE  (13-16 s) the camera eases back: this line is one of many running in parallel. Then it eases home.
 *  Both themes play the same film in one composition: the same framing, geometry, sizes, positions, timing and motion;
 *  only colour, blending and opacity differ. Dark theme: all light is drawn in code (thin bright cores, wide soft
 *  additive sleeves, sprites, fog into the page canvas). Light theme: the same neon photographed in daylight:
 *  saturated blue cores where dark's are white-hot, the same glow sleeves, halos and sprites as normal-blended
 *  #2E68FF, translucent white glass with blue neon edges, a blue floor grid and a faint blue pool under the live app. */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Euler, FrontSide, type Group, InstancedBufferAttribute,
  InstancedMesh, LineCurve3, Matrix4, NormalBlending, type PerspectiveCamera, PlaneGeometry, Points,
  QuadraticBezierCurve3, Quaternion, ShaderMaterial, SpriteMaterial, type Texture, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from "three";
import { t } from "@/madp/i18n";
import { legendIndexAt, stationHead, type ConceptSceneProps } from "../types";
import * as S from "./shaders";
import {
  type CardKind, cardTexture, DARK_INK, dashboardTexture, GLYPH_ASPECT, glowTexture, glyphTextures, type Ink,
  LABEL_PX, LIGHT_INK, labelTexture, liveTexture, phoneTexture,
} from "./textures";

/* ── palette ────────────────────────────────────────────────────────────────── */

interface Palette {
  light: boolean;
  beam: Color; hot: Color; deep: Color; pale: Color; violet: Color; amber: Color; red: Color; green: Color; white: Color;
  halo: Color; // light: the glow colour (dark's additive sleeves, halos and sprites)
  sleeve: number; // how much wide glow to draw
  sprite: number; // sprite strength
}
const col = (h: string) => new Color(h);
const DARK: Palette = {
  light: false, beam: col("#2E68FF"), hot: col("#E4ECFF"), deep: col("#1F5BFF"), pale: col("#9DB8FF"), violet: col("#7C5CFF"),
  amber: col("#FFB547"), red: col("#FF4F64"), green: col("#46D39A"), white: col("#FFFFFF"), halo: col("#2E68FF"),
  sleeve: 1, sprite: 1,
};
/** light: dark's colours for the light canvas: white-hot cores saturated blue, blue cores deep blue, the pale secondary
 *  mid blue, the glows #2E68FF; failure and pass in dark's hues, deep enough to read on the canvas */
const LIGHT: Palette = {
  light: true, beam: col("#1747C8"), hot: col("#1F5BFF"), deep: col("#1F5BFF"), pale: col("#4D7BFF"), violet: col("#6A4BE8"),
  amber: col("#FF9800"), red: col("#FF4F64"), green: col("#29AD78"), white: col("#FFFFFF"), halo: col("#2E68FF"),
  sleeve: 1, sprite: 1,
};
/** light theme: how much of dark's glow becomes coverage: the glow sleeves' gain on their coverage curve (about 0.45
 *  at their peak), the sprites' opacity against dark's (centres about 0.5), the streams' sparks, and the other lines
 *  (deep blue on light stands out more than dark's dim blue, so they are held back to stay behind this one) */
const L_SLEEVE = 0.6;
const L_RING = 0.75;
const L_SPRITE = 0.6;
const L_SPARK = 0.9;
const L_PAR = 0.62;

/* ── the choreography ───────────────────────────────────────────────────────── */

const PERIOD = 16;
const CARD_IN0 = 0.05;
const CARD_IN_STAG = 0.1;
const CARD_IN_DUR = 0.95;
const CUT0 = 1.72;
const CUT_STAG = 0.08;
const CUT_DUR = 0.45;
const cutStart = (k: number) => CUT0 + k * CUT_STAG;
const T_GO = 3.0; // the pulse leaves the bright point
const T_FAIL = 6.05; // reaches SecOps: an issue
const T_BACK = 6.45; // sent back along the loop
const T_FIX = 6.95; // the Developer fixes it
const T_RERUN = 7.2; // review, test, security again
const T_PASS = 7.75; // SecOps passes green
const T_ARRIVE = 9.95; // the beam reaches the app
const T_SCALE = 13.0; // the camera eases back
const T_HOME = 15.0; // and returns

/** gates (one per stage, then deploy) along the line, as line fractions */
const G = Array.from({ length: 8 }, (_, k) => 0.12 + k * 0.108);
const SU = Array.from({ length: 8 }, (_, k) => stationHead(k));

/** where the pulse runs on the line: [from s, to s, from u, to u] */
const RUN: [number, number, number, number][] = [
  [T_GO, 3.45, 0, G[0]],
  [3.45, 4.1, G[0], G[1]],
  [4.1, 4.75, G[1], G[2]],
  [4.75, 5.4, G[2], G[3]],
  [5.4, T_FAIL, G[3], G[4]],
  [T_RERUN, T_PASS, G[1], G[4]],
  [T_PASS, 8.3, G[4], G[5]],
  [8.3, 8.85, G[5], G[6]],
  [8.85, 9.4, G[6], G[7]],
  [9.4, T_ARRIVE, G[7], 1],
];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** slows into each gate without stopping */
const ease = (t: number) => 0.62 * t * t * (3 - 2 * t) + 0.38 * t;

/** the legend's story position for a point on the line (stationHead(k) exactly at gate k) */
function legendHead(u: number): number {
  if (u <= G[0]) return 0.1 + (SU[0] - 0.1) * (u / G[0]);
  for (let k = 0; k < 7; k++) if (u <= G[k + 1]) return SU[k] + (SU[k + 1] - SU[k]) * ((u - G[k]) / (G[k + 1] - G[k]));
  return SU[7] + (0.99 - SU[7]) * clamp01((u - G[7]) / (1 - G[7]));
}

/* ── the layout (story space; the whole story is scaled to fit right of the headline) ── */

const P0 = new Vector3(-2.75, -0.42, -2.7); // the bright point: material in, beam out
const E0 = new Vector3(1.95, -0.82, 1.05); // the end of the line, under the app
const UP = new Vector3(0, 1, 0);
const DIR = new Vector3().subVectors(E0, P0).normalize();
const N1 = new Vector3().crossVectors(DIR, UP).normalize();
const N2 = new Vector3().crossVectors(N1, DIR).normalize();
const RING_Q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), DIR);
const RING_R = 0.3;
/** framing: half the story's width on screen (story units at the target distance), and the story sits a little left
 *  of the lens centre, clear of the right edge */
const DESIGN_HALF = 3.0;
const STORY_SHIFT = -0.42;
const FLOOR_Y = -1.6;
const BRAID_C = new Vector3(0.35, 0.72, 0.35);

type V3 = [number, number, number];
interface CardDef { kind: CardKind; w: number; h: number; pos: V3; rot: V3 }
/** the brief's source material */
const CARDS: CardDef[] = [
  { kind: "email", w: 1.08, h: 0.8, pos: [-1.08, 1.12, 0.5], rot: [0.05, 0.3, -0.05] },
  { kind: "pdf", w: 0.84, h: 1.1, pos: [0.12, 1.34, -0.1], rot: [-0.04, 0.16, 0.035] },
  { kind: "notes", w: 0.8, h: 1.0, pos: [1.22, 1.04, 0.3], rot: [0.05, -0.14, 0.06] },
  { kind: "board", w: 1.14, h: 0.8, pos: [0.36, 0.3, 0.9], rot: [-0.06, 0.1, -0.03] },
  { kind: "shot", w: 1.0, h: 0.74, pos: [1.9, 0.36, 0.7], rot: [0.03, -0.24, 0.025] },
];
/** the still frame: the cards gather small above the bright point, half read */
const STILL_CARDS: V3[] = [[-3.35, 0.62, -2.2], [-2.75, 0.95, -2.5], [-2.15, 0.6, -2.0], [-3.0, 0.15, -1.6], [-2.35, 0.22, -1.7]];
/** the agent glyphs' width and the uplink's label sprite (story units, the canvas aspect) */
const GLYPH_W = 0.36;
const LABEL_SIZE = [1.12, (1.12 * LABEL_PX[1]) / LABEL_PX[0]] as const;

const DASH = { pos: new Vector3(0.5, 0.78, 1.0), w: 2.05, h: 1.28 };
const PHONE = { pos: new Vector3(2.03, 0.64, 1.18), w: 0.58, h: 1.12 };
const BAR_Y = -0.04;
const BAR_L = -0.55;
const BAR_R = 2.42;
const CLOUD = new Vector3(0.5, 1.98, 0.95);
const LABEL_CENTER = new Vector2(0, 0.5);

const PAR_N = 24;
const parOffset = (k: number, out: Vector3) => out.set(-0.8 * k, 0, -2.1 * k);

const CAM0 = new Vector3(0, 1.35, 12.5);
const TGT0 = new Vector3(0, 0.32, 0);
const CAM1 = new Vector3(-0.4, 8.6, 21.5);
const TGT1 = new Vector3(-0.6, -1.1, -10);

/** The framing: the story scaled to the room right of the headline, a little left of the lens centre. */
function frame(halfW: number, edge: number): number {
  return Math.min(1.12, Math.max(0.5, (halfW * (1 - edge) * 0.94) / DESIGN_HALF));
}

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

/** a rounded-rectangle outline as a ribbon: two mirrored halves from the bottom centre to the top centre (uv.x 0..1) */
function outlineGeometry(w: number, h: number, r: number, width: number): BufferGeometry {
  const pts: [number, number][] = [];
  const hw = w / 2;
  const hh = h / 2;
  const seg = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  const arc = (cx: number, cy: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  };
  seg(0, -hh, hw - r, -hh, 10);
  arc(hw - r, -hh + r, -Math.PI / 2, 0, 8);
  seg(hw, -hh + r, hw, hh - r, 12);
  arc(hw - r, hh - r, 0, Math.PI / 2, 8);
  seg(hw - r, hh, 0, hh, 10);
  pts.push([0, hh]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const sx of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      const nx = (-ty * width) / 2;
      const ny = (tx * width) / 2;
      const [x, y] = pts[i];
      pos.push(sx * (x - nx), y - ny, 0, sx * (x + nx), y + ny, 0);
      uv.push(len[i] / total, 0, len[i] / total, 1);
      if (i < pts.length - 1) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

/** a shaft of light whose base sits at the origin and grows along +y */
function shaftGeometry(width: number, length: number) {
  const g = new PlaneGeometry(width, length);
  g.translate(0, length / 2, 0);
  return g;
}

/* ── everything the scene draws, built once per theme ───────────────────────── */

function build(pal: Palette, ink: Ink, pixel: number) {
  const bag: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { bag.push(x); return x; };
  const L = pal.light;
  const blending = L ? NormalBlending : AdditiveBlending;
  /** la: the light theme's coverage gain (a glow sleeve below 1) */
  const mat = (vert: string, frag: string, uniforms: Record<string, { value: unknown }>, doubleSide = false, la = 1) => keep(new ShaderMaterial({
    uniforms: { uFogNear: { value: S.FOG_NEAR }, uFogFar: { value: S.FOG_FAR }, ...(L ? { uLA: { value: la } } : {}), ...uniforms },
    vertexShader: vert, fragmentShader: frag, defines: L ? { LIGHT: "" } : {},
    transparent: true, depthWrite: false, toneMapped: false, blending, side: doubleSide ? DoubleSide : FrontSide,
  }));
  const spr = (map: Texture, color: Color, opacity: number) => keep(new SpriteMaterial({
    map, color: color.clone(), opacity, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false, blending,
  }));

  const glow = keep(glowTexture());
  const glyphs = glyphTextures(ink).map(keep);

  /* the gates */
  const ringCore = keep(new TorusGeometry(RING_R, 0.011, 6, 110));
  const ringGlow = keep(new TorusGeometry(RING_R, 0.055, 10, 110));
  const gates = G.map((u, k) => ({
    pos: P0.clone().lerp(E0, u),
    core: mat(S.SOFT_VERT, S.GLOW_FRAG, { uColor: { value: pal.pale.clone() }, uIntensity: { value: 0.3 }, uSoft: { value: 0 } }),
    glow: mat(S.SOFT_VERT, S.GLOW_FRAG, { uColor: { value: (L ? pal.halo : pal.beam).clone() }, uIntensity: { value: 0.1 }, uSoft: { value: 1 } }, false, L_RING),
    glyph: spr(glyphs[k], pal.white, 0.4),
    flare: spr(glow, L ? pal.halo : pal.pale, 0),
  }));

  /* the beam */
  const lineCurve = new LineCurve3(P0, E0);
  const beamU = (o: { tail: number; base: number; gain: number; soft: number }) => ({
    uTime: { value: 0 }, uWob: { value: 0.045 }, uGates: { value: G.slice() }, uN1: { value: N1.clone() }, uN2: { value: N2.clone() },
    uBeam: { value: pal.beam.clone() }, uHot: { value: pal.hot.clone() }, uHeadColor: { value: pal.hot.clone() },
    uHead: { value: -1 }, uLit: { value: 0 }, uDone: { value: 0 }, uTail: { value: o.tail }, uBase: { value: o.base },
    uGain: { value: o.gain }, uSoft: { value: o.soft },
  });
  const beam = {
    core: keep(new TubeGeometry(lineCurve, 420, 0.012, 6, false)),
    sleeve: keep(new TubeGeometry(lineCurve, 420, 0.08, 10, false)),
    coreMat: mat(S.BEAM_VERT, S.BEAM_FRAG, beamU({ tail: 0.07, base: 0.14, gain: 1, soft: 0 })),
    // light: the sleeve glows in the glow colour all along
    sleeveMat: mat(S.BEAM_VERT, S.BEAM_FRAG, L
      ? { ...beamU({ tail: 0.1, base: 0.035, gain: 0.55, soft: 1 }), uBeam: { value: pal.halo.clone() }, uHot: { value: pal.halo.clone() } }
      : beamU({ tail: 0.1, base: 0.035, gain: 0.55 * pal.sleeve, soft: 1 }), false, L_SLEEVE),
  };

  /* the automatic send-back loop, under the line from 05 SecOps to 02 Developer */
  const g1 = gates[1].pos;
  const g4 = gates[4].pos;
  const arcCurve = new QuadraticBezierCurve3(
    g4.clone().addScaledVector(UP, -RING_R - 0.03),
    g1.clone().lerp(g4, 0.5).addScaledVector(UP, -1.15),
    g1.clone().addScaledVector(UP, -RING_R - 0.03),
  );
  const arcU = (soft: number, gain: number) => ({
    uColor: { value: pal.amber.clone() }, uHead: { value: 0 }, uTrail: { value: 0 }, uGain: { value: 0 }, uSoft: { value: soft }, uBaseGain: { value: gain },
  });
  const arc = {
    core: keep(new TubeGeometry(arcCurve, 140, 0.01, 6, false)),
    sleeve: keep(new TubeGeometry(arcCurve, 140, 0.06, 8, false)),
    coreMat: mat(S.SOFT_VERT, S.ARC_FRAG, arcU(0, 1)),
    sleeveMat: mat(S.SOFT_VERT, S.ARC_FRAG, arcU(1, 0.55 * pal.sleeve), false, L_SLEEVE),
    curve: arcCurve,
  };

  /* the bright point and the pulse (light: the hottest points, the pulse head and the point's flash as the pulse leaves,
     keep a tiny white spark in their blue cores) */
  const point = {
    core: spr(glow, L ? pal.hot : pal.white, 1), halo: spr(glow, L ? pal.halo : pal.pale, 0.6), spark: L ? spr(glow, pal.white, 0) : null,
  };
  const head = {
    halo: spr(glow, pal.pale, L ? 0.6 : 0.9), core: spr(glow, pal.white, 1), streak: spr(glow, pal.beam, L ? 0.4 : 0.5),
    spark: L ? spr(glow, pal.white, 1) : null,
  };

  /* the brief's source material */
  const cards = CARDS.map((c) => ({
    geo: keep(new PlaneGeometry(c.w, c.h)),
    mat: mat(S.QUAD_VERT, S.CARD_FRAG, {
      uMap: { value: keep(cardTexture(c.kind, c.w, c.h, ink)) }, uOpacity: { value: 0 }, uCut: { value: -0.1 }, uHot: { value: pal.hot.clone() },
    }, true),
  }));

  /* its streams of light */
  const per = 300;
  const n = per * CARDS.length;
  const start = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const r = rng(11);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const v = new Vector3();
  const one = new Vector3(1, 1, 1);
  CARDS.forEach((cd, k) => {
    m4.compose(new Vector3(...cd.pos), q.setFromEuler(e.set(...cd.rot)), one);
    for (let i = 0; i < per; i++) {
      const j = k * per + i;
      const sx = r();
      const sy = r();
      v.set((sx - 0.5) * cd.w * 0.94, (sy - 0.5) * cd.h * 0.94, 0).applyMatrix4(m4);
      start.set([v.x, v.y, v.z], j * 3);
      seed.set([cutStart(k) + ((sx + 0.08) / 1.18) * CUT_DUR, 0.62 + r() * 0.32, Math.floor(r() * 3), r()], j * 4);
    }
  });
  const streamGeo = keep(new BufferGeometry());
  streamGeo.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  streamGeo.setAttribute("aStart", new BufferAttribute(start, 3));
  streamGeo.setAttribute("aSeed", new BufferAttribute(seed, 4));
  const streamMat = mat(S.STREAM_VERT, S.STREAM_FRAG, {
    uT: { value: 0 }, uTime: { value: 0 }, uC: { value: BRAID_C.clone() }, uP: { value: P0.clone() }, uPixel: { value: pixel },
    uSize: { value: 44 }, uBeam: { value: pal.beam.clone() }, uHot: { value: pal.hot.clone() }, uOpacity: { value: 1 },
  }, false, L_SPARK);

  /* the printed app */
  const screenU = (map: Texture) => ({ uMap: { value: map }, uReveal: { value: 0 }, uOpacity: { value: 0 }, uHot: { value: pal.hot.clone() }, uTime: { value: 0 } });
  const outlineU = () => ({ uColor: { value: pal.pale.clone() }, uHot: { value: pal.hot.clone() }, uDraw: { value: 0 }, uOpacity: { value: 0 } });
  // light: a shaft's soft light in the glow colour around its saturated core
  const shaftU = (intensity: number) => ({
    uColor: { value: (L ? pal.halo : pal.beam).clone() }, uHot: { value: pal.hot.clone() }, uGrow: { value: 0 }, uIntensity: { value: intensity },
  });
  const riserW = 0.22;
  const barW = 0.16;
  const upW = 0.3;
  const app = {
    dashGeo: keep(new PlaneGeometry(DASH.w, DASH.h)),
    dashMat: mat(S.QUAD_VERT, S.SCREEN_FRAG, screenU(keep(dashboardTexture(ink))), true),
    dashLine: keep(outlineGeometry(DASH.w + 0.02, DASH.h + 0.02, 0.07, 0.075)),
    dashLineMat: mat(S.QUAD_VERT, S.OUTLINE_FRAG, outlineU(), true),
    phoneGeo: keep(new PlaneGeometry(PHONE.w, PHONE.h)),
    phoneMat: mat(S.QUAD_VERT, S.SCREEN_FRAG, screenU(keep(phoneTexture(ink))), true),
    phoneLine: keep(outlineGeometry(PHONE.w + 0.02, PHONE.h + 0.02, 0.08, 0.07)),
    phoneLineMat: mat(S.QUAD_VERT, S.OUTLINE_FRAG, outlineU(), true),
    riserGeo: keep(shaftGeometry(riserW, BAR_Y - E0.y)),
    riserMat: mat(S.QUAD_VERT, S.SHAFT_FRAG, shaftU(1), true),
    barLGeo: keep(shaftGeometry(barW, E0.x - BAR_L)),
    barLMat: mat(S.QUAD_VERT, S.SHAFT_FRAG, shaftU(0.9), true),
    barRGeo: keep(shaftGeometry(barW, BAR_R - E0.x)),
    barRMat: mat(S.QUAD_VERT, S.SHAFT_FRAG, shaftU(0.9), true),
    upGeo: keep(shaftGeometry(upW, CLOUD.y - 0.16 - (DASH.pos.y + DASH.h / 2 + 0.02))),
    upMat: mat(S.QUAD_VERT, S.SHAFT_FRAG, shaftU(1), true),
    ringCore: keep(new TorusGeometry(0.46, 0.012, 6, 120)),
    ringGlow: keep(new TorusGeometry(0.46, 0.06, 10, 120)),
    ringCoreMat: mat(S.SOFT_VERT, S.GLOW_FRAG, { uColor: { value: pal.pale.clone() }, uIntensity: { value: 0 }, uSoft: { value: 0 } }),
    ringGlowMat: mat(S.SOFT_VERT, S.GLOW_FRAG, { uColor: { value: (L ? pal.halo : pal.beam).clone() }, uIntensity: { value: 0 }, uSoft: { value: 1 } }, false, L_RING),
    cloud: spr(glyphs[7], pal.white, 0),
    label: spr(keep(labelTexture(ink, "SELISE Blocks", t("landing.scene.deployedSmoke", "deployed · smoke test passed"))), new Color("#FFFFFF"), 0),
    live: spr(keep(liveTexture(ink)), new Color("#FFFFFF"), 0),
    haze: spr(glow, L ? pal.halo : pal.deep, 0),
  };

  /* the other lines (scale act) */
  const parRailGeo = keep(new TubeGeometry(lineCurve, 1, 0.011, 5, false));
  const parSleeveGeo = keep(new TubeGeometry(lineCurve, 1, 0.06, 8, false));
  const parGateGeo = keep(new TorusGeometry(RING_R, 0.012, 4, 48));
  const phase = Array.from({ length: PAR_N }, () => r());
  const off = new Vector3();
  const railAttrs = (geo: BufferGeometry) => {
    const ph = new Float32Array(PAR_N);
    const kk = new Float32Array(PAR_N);
    for (let k = 0; k < PAR_N; k++) { ph[k] = phase[k]; kk[k] = k / PAR_N; }
    geo.setAttribute("aPhase", new InstancedBufferAttribute(ph, 1));
    geo.setAttribute("aK", new InstancedBufferAttribute(kk, 1));
    geo.setAttribute("aGate", new InstancedBufferAttribute(new Float32Array(PAR_N), 1));
  };
  railAttrs(parRailGeo);
  railAttrs(parSleeveGeo);
  {
    const ph = new Float32Array(PAR_N * 8);
    const kk = new Float32Array(PAR_N * 8);
    const gg = new Float32Array(PAR_N * 8);
    for (let k = 0; k < PAR_N; k++) for (let i = 0; i < 8; i++) { ph[k * 8 + i] = phase[k]; kk[k * 8 + i] = k / PAR_N; gg[k * 8 + i] = G[i]; }
    parGateGeo.setAttribute("aPhase", new InstancedBufferAttribute(ph, 1));
    parGateGeo.setAttribute("aK", new InstancedBufferAttribute(kk, 1));
    parGateGeo.setAttribute("aGate", new InstancedBufferAttribute(gg, 1));
  }
  /** `glowColor` (light theme): a glow sleeve's colour all along */
  const parU = (gain: number, soft: number, glowColor?: Color) => ({
    uBeam: { value: (glowColor ?? pal.beam).clone() }, uHot: { value: (glowColor ?? pal.hot).clone() }, uTime: { value: 0 }, uVis: { value: 0 },
    uGain: { value: gain }, uSoft: { value: soft },
  });
  const parRail = new InstancedMesh(parRailGeo, mat(S.PAR_VERT, S.PAR_RAIL_FRAG, parU(1, 0), false, L_PAR), PAR_N);
  const parSleeve = new InstancedMesh(parSleeveGeo, mat(S.PAR_VERT, S.PAR_RAIL_FRAG, parU(0.45 * pal.sleeve, 1, L ? pal.halo : undefined), false, L_SLEEVE * L_PAR), PAR_N);
  const parGates = new InstancedMesh(parGateGeo, mat(S.PAR_VERT, S.PAR_GATE_FRAG, parU(1, 0), false, L_PAR), PAR_N * 8);
  const gp = new Vector3();
  for (let k = 0; k < PAR_N; k++) {
    parOffset(k + 1, off);
    m4.makeTranslation(off.x, off.y, off.z);
    parRail.setMatrixAt(k, m4);
    parSleeve.setMatrixAt(k, m4);
    for (let i = 0; i < 8; i++) {
      gp.copy(P0).lerp(E0, G[i]).add(off);
      m4.compose(gp, RING_Q, one);
      parGates.setMatrixAt(k * 8 + i, m4);
    }
  }
  for (const im of [parRail, parSleeve, parGates]) { im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; }
  const ptsGeo = keep(new BufferGeometry());
  {
    const o = new Float32Array(PAR_N * 3);
    const ph = new Float32Array(PAR_N);
    const kk = new Float32Array(PAR_N);
    for (let k = 0; k < PAR_N; k++) { parOffset(k + 1, off); o.set([off.x, off.y, off.z], k * 3); ph[k] = phase[k]; kk[k] = k / PAR_N; }
    ptsGeo.setAttribute("position", new BufferAttribute(new Float32Array(PAR_N * 3), 3));
    ptsGeo.setAttribute("aOff", new BufferAttribute(o, 3));
    ptsGeo.setAttribute("aPhase", new BufferAttribute(ph, 1));
    ptsGeo.setAttribute("aK", new BufferAttribute(kk, 1));
  }
  const ptU = (mode: number, size: number, color: Color, opacity: number) => ({
    uP0: { value: P0.clone() }, uE0: { value: E0.clone() }, uTime: { value: 0 }, uVis: { value: 0 }, uPixel: { value: pixel },
    uSize: { value: size }, uMode: { value: mode }, uColor: { value: color.clone() }, uOpacity: { value: opacity },
  });
  const parHeads = new Points(ptsGeo, mat(S.PAR_POINT_VERT, S.PAR_POINT_FRAG, ptU(0, 230, pal.pale, 1), false, L_SPRITE));
  const parApps = new Points(ptsGeo, mat(S.PAR_POINT_VERT, S.PAR_POINT_FRAG, ptU(1, 760, L ? pal.halo : pal.beam, 0.6), false, L_SPRITE * L_PAR));
  parHeads.frustumCulled = false;
  parApps.frustumCulled = false;
  // light theme: the other lines all sit behind this one, so they draw first (dark's light adds up in any order)
  if (L) for (const o of [parSleeve, parRail, parGates, parApps, parHeads]) o.renderOrder = -2;

  /* the floor and the air */
  const floor = {
    geo: keep(new PlaneGeometry(220, 220)),
    mat: keep(new ShaderMaterial({
      uniforms: {
        uBg: { value: new Color() }, uGrid: { value: L ? pal.hot.clone() : new Color("#8EA6E8") },
        uAmt: { value: L ? 0.16 : 0.075 }, uPool: { value: (L ? pal.halo : pal.beam).clone() }, uPoolAmt: { value: 0 },
        uPoolAt: { value: new Vector2(DASH.pos.x + 0.6, DASH.pos.z) },
      },
      vertexShader: S.FLOOR_VERT, fragmentShader: S.FLOOR_FRAG, toneMapped: false,
      // light: the grid lines and the pool alone, over the canvas
      defines: L ? { LIGHT: "" } : {}, transparent: L, depthWrite: !L,
    })),
  };
  let dust: { geo: BufferGeometry; mat: ShaderMaterial } | null = null;
  if (!L) {
    const dn = 260;
    const dp = new Float32Array(dn * 3);
    const ds = new Float32Array(dn);
    for (let i = 0; i < dn; i++) { dp.set([-9 + r() * 15, FLOOR_Y + 0.1 + Math.pow(r(), 1.4) * 5, -30 + r() * 33], i * 3); ds[i] = r(); }
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new BufferAttribute(dp, 3));
    geo.setAttribute("aSeed", new BufferAttribute(ds, 1));
    dust = {
      geo,
      mat: mat(S.DUST_VERT, S.DUST_FRAG, { uTime: { value: 0 }, uSize: { value: 26 }, uPixel: { value: pixel }, uColor: { value: new Color("#A9C0FF") }, uOpacity: { value: 0.7 } }),
    };
  }
  // light: a very faint blue tint along the horizon
  const horizon = spr(glow, L ? pal.halo : new Color("#2346B8"), L ? 0.05 : 0.16);

  return {
    gates, ringCore, ringGlow, beam, arc, point, head, cards, streamGeo, streamMat, app, parRail, parSleeve, parGates, parHeads, parApps,
    floor, dust, horizon,
    dispose() { bag.forEach((d) => d.dispose()); [parRail, parSleeve, parGates].forEach((im) => im.dispose()); },
  };
}

/* ── the scene ──────────────────────────────────────────────────────────────── */

function Scene({ still, canvas, light, onProgress, onReady, textEdge = 0.56 }: Omit<ConceptSceneProps, "active">) {
  const { camera, size, gl } = useThree();
  const pal = light ? LIGHT : DARK;
  const pixel = Math.min(gl.getPixelRatio(), 2);
  const W = useMemo(() => build(pal, light ? LIGHT_INK : DARK_INK, pixel), [pal, light, pixel]);
  useEffect(() => () => W.dispose(), [W]);
  const bg = useMemo(() => {
    const [r, g, b] = canvas.trim().split(/\s+/).map(Number);
    return new Color(`rgb(${r || 14}, ${g || 15}, ${b || 19})`);
  }, [canvas]);
  W.floor.mat.uniforms.uBg.value.copy(bg);

  const story = useRef<Group>(null);
  const cardRefs = useRef<(Group | null)[]>([]);
  const headRef = useRef<Group>(null);
  const flareRefs = useRef<(Group | null)[]>([]);
  const pointHalo = useRef<Group>(null);
  const liveRef = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const frames = useRef(0);
  const ready = useRef(false);
  const tmp = useMemo(() => ({ v: new Vector3(), cam: new Vector3(), tgt: new Vector3(), c: new Color() }), []);
  /* development only: ?storyT=<seconds> holds the film at one moment, for comparing screenshots */
  const frozenAt = useMemo(() => (import.meta.env.DEV ? parseFloat(new URLSearchParams(window.location.search).get("storyT") ?? "") : NaN), []);

  useEffect(() => {
    if (still) return;
    const h = (e: PointerEvent) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", h, { passive: true });
    return () => window.removeEventListener("pointermove", h);
  }, [still]);

  /* fit: lens, and how large the story can be right of the headline */
  const aspect = size.width / Math.max(1, size.height);
  const fov = aspect < 1.1 ? 44 : aspect < 1.4 ? 36 : aspect < 1.62 ? 32 : 30;
  const edge = Math.min(0.72, Math.max(0, textEdge));
  const fit = useMemo(() => frame(CAM0.distanceTo(TGT0) * Math.tan((fov * Math.PI) / 360) * aspect, edge), [fov, aspect, edge]);
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }, [fov, camera]);

  useFrame((state, dt) => {
    const t = Number.isFinite(frozenAt) ? frozenAt : state.clock.elapsedTime;
    const c = still ? 12.6 : t % PERIOD;
    const cam = camera as PerspectiveCamera;
    const L = pal.light;

    /* ── act 2 head state ── */
    let mode = 0; // 0 gathering at the point, 1 on the line, 2 on the loop, 3 arrived
    let u = 0;
    let s = 0;
    if (c >= T_ARRIVE) { mode = 3; u = 1; } else if (c >= T_GO) {
      mode = 1;
      for (const [t0, t1, u0, u1] of RUN) if (c >= t0 && c < t1) { u = u0 + (u1 - u0) * ease((c - t0) / (t1 - t0)); break; }
      if (c >= T_FAIL && c < T_BACK) u = G[4];
      else if (c >= T_BACK && c < T_FIX) { mode = 2; s = ease((c - T_BACK) / (T_FIX - T_BACK)); }
      else if (c >= T_FIX && c < T_RERUN) u = G[1];
    }
    const lit = mode === 3 ? 1 : mode === 0 ? 0 : c >= T_FAIL ? Math.max(G[4], u) : u;
    const reset = 1 - smooth(T_HOME, PERIOD - 0.1, c);
    const done = (c >= T_GO ? 1 : 0) * reset;
    const fail = c >= T_FAIL && c < T_BACK + 0.15 ? 0.55 + 0.45 * Math.sin(c * 60) * Math.sin(c * 23) : 0;
    const failOn = c >= T_FAIL && c < T_FIX ? 1 : 0;
    const passGlow = c >= T_PASS ? Math.exp(-(c - T_PASS) / 0.45) : 0;
    const rerun = c >= T_FIX && c < T_PASS + 0.3 ? 1 : 0;

    /* ── camera: gentle dolly, the scale reveal, a breath of parallax ── */
    const pull = still ? 0.16 : smooth(T_SCALE, T_SCALE + 1.6, c) * (1 - smooth(T_HOME, PERIOD, c));
    const push = still ? 0.5 : smooth(0, 12.5, c) * (1 - smooth(T_SCALE, PERIOD, c));
    const p = pointer.current;
    const k = Math.min(1, dt * 1.5);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    tmp.tgt.copy(TGT0).lerp(TGT1, pull);
    tmp.cam.copy(CAM0).lerp(CAM1, pull).sub(tmp.tgt).multiplyScalar(1 - 0.07 * push).add(tmp.tgt);
    tmp.cam.x += Math.sin(t * 0.13) * 0.18 + p.x * 0.22;
    tmp.cam.y += Math.sin(t * 0.09) * 0.06 - p.y * 0.1;
    cam.position.copy(tmp.cam);
    cam.lookAt(tmp.tgt);
    cam.updateMatrixWorld();
    cam.projectionMatrix.elements[8] = -edge; // lens shift: the story sits right of the headline
    cam.projectionMatrix.elements[9] = 0.07;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    if (story.current) { story.current.scale.setScalar(fit); story.current.position.set(STORY_SHIFT * fit, 0, 0); }

    /* the printed app's clock (act 3): it all fades with the reset and dims during the pull. Light theme: the gate glyphs
       its dashboard prints over (04 to 07) make way as its screen fills in over them, and come back as it fades (behind
       its glass they would muddle its UI) */
    const a = still ? 3 : c - T_ARRIVE;
    const on = still ? 1 : a >= 0 ? 1 : 0;
    const fadeApp = still ? 1 : on * (reset * (1 - 0.4 * pull));
    const glyphHide = L ? smooth(0.95, 1.3, a) * fadeApp : 0;

    /* ── act 1: cards float in, burn away into streams that braid into the point ── */
    W.cards.forEach((cd, i) => {
      const g = cardRefs.current[i];
      const def = CARDS[i];
      const inT = still ? 1 : smooth(CARD_IN0 + i * CARD_IN_STAG, CARD_IN0 + i * CARD_IN_STAG + CARD_IN_DUR, c);
      const cut = still ? 0.42 + i * 0.05 : -0.08 + (1.18 * (c - cutStart(i))) / CUT_DUR;
      cd.mat.uniforms.uOpacity.value = inT * (still ? 0.8 : 1);
      cd.mat.uniforms.uCut.value = Math.min(1.2, cut);
      if (g) {
        g.visible = cut < 1.15 && inT > 0.001;
        if (still) {
          g.position.set(...STILL_CARDS[i]);
          g.scale.setScalar(0.55);
          g.rotation.set(def.rot[0], def.rot[1] + 0.25, def.rot[2]);
        } else {
          const away = 1 - inT;
          g.position.set(def.pos[0] + away * 0.7, def.pos[1] - away * 0.12 + Math.sin(t * 0.8 + i * 1.7) * 0.025, def.pos[2] - away * 1.4);
          g.rotation.set(def.rot[0] + Math.sin(t * 0.6 + i) * 0.02, def.rot[1] - away * 0.4, def.rot[2]);
          g.scale.setScalar(1);
        }
      }
    });
    W.streamMat.uniforms.uT.value = still ? -10 : c;
    W.streamMat.uniforms.uTime.value = t;
    const charge = still ? 0.7 : smooth(1.9, T_GO, c) * (1 - smooth(T_GO, T_GO + 0.7, c));
    W.point.core.opacity = 0.55 + charge * 0.45;
    W.point.halo.opacity = (0.25 + charge * 0.75) * (L ? L_SPRITE : pal.sprite);
    if (W.point.spark) W.point.spark.opacity = smooth(0.5, 1, charge);
    if (pointHalo.current) pointHalo.current.scale.setScalar(0.7 + charge * 1.6 + Math.sin(t * 2.1) * 0.04);

    /* ── act 2: the line ── */
    const bu = W.beam.coreMat.uniforms;
    const su = W.beam.sleeveMat.uniforms;
    const headColor = tmp.c;
    if (L) {
      // the same states in light ink: blue, amber turning red, amber on the loop, green on the re-run
      if (fail > 0 && mode === 1) headColor.copy(pal.amber).lerp(pal.red, fail);
      else if (mode === 2) headColor.copy(pal.amber);
      else if (rerun) headColor.copy(pal.green);
      else headColor.copy(pal.hot);
    } else if (fail > 0 && mode === 1) headColor.copy(pal.amber).lerp(pal.red, fail);
    else if (mode === 2) headColor.copy(pal.amber);
    else if (rerun) headColor.copy(pal.green).lerp(pal.hot, 0.35);
    else headColor.copy(pal.hot);
    for (const m of [bu, su]) {
      m.uHead.value = still ? -1 : mode === 1 ? u : -1;
      m.uLit.value = still ? 1 : lit;
      m.uDone.value = still ? 1 : done;
      m.uTime.value = t;
      (m.uHeadColor.value as Color).copy(headColor);
    }

    W.gates.forEach((g, i) => {
      const d = mode === 1 ? u - G[i] : -1;
      let flash = mode === 1 ? (d >= 0 ? Math.exp(-d / 0.03) : Math.exp(d / 0.012) * 0.5) : 0;
      if (i === 1 && c >= T_FIX - 0.05 && c < T_RERUN + 0.4) flash = Math.max(flash, Math.exp(-Math.abs(c - T_FIX - 0.08) / 0.18));
      const passed = (still ? 1 : lit >= G[i] - 0.001 ? 1 : 0) * (still ? 1 : done);
      const cc = g.core.uniforms.uColor.value as Color;
      const gc = g.glow.uniforms.uColor.value as Color;
      const fr = flareRefs.current[i];
      if (L) {
        // dark's gate states in light ink: the glow in the glow colour, SecOps red while it fails and green as it passes
        cc.copy(pal.pale).lerp(pal.hot, Math.min(1, flash));
        gc.copy(pal.halo);
        if (i === 4) {
          if (failOn) { cc.copy(pal.amber).lerp(pal.red, fail); gc.copy(pal.red); flash = Math.max(flash, 0.35 + fail * 0.5); }
          if (passGlow > 0.01) { cc.lerp(pal.green, passGlow); gc.lerp(pal.green, passGlow); flash = Math.max(flash, passGlow); }
          if (still) { cc.copy(pal.green); gc.copy(pal.green); }
        }
        g.core.uniforms.uIntensity.value = 0.26 + passed * 0.34 + flash * 1.3;
        g.glow.uniforms.uIntensity.value = 0.07 + passed * 0.1 + flash * 0.55;
        g.glyph.opacity = Math.min(1, 0.62 + passed * 0.38 + Math.min(1, flash) * 0.25) * (i >= 3 && i <= 6 ? 1 - glyphHide : 1);
        g.flare.opacity = Math.min(1, flash) * 0.85 * L_SPRITE;
        g.flare.color.copy(i === 4 && failOn ? pal.red : i === 4 && passGlow > 0.05 ? pal.green : pal.halo);
        if (fr) fr.scale.setScalar(0.6 + Math.min(1, flash) * 0.9);
        return;
      }
      cc.copy(pal.pale).lerp(pal.hot, Math.min(1, flash));
      gc.copy(pal.beam);
      if (i === 4) {
        if (failOn) { cc.copy(pal.amber).lerp(pal.red, fail); gc.copy(pal.red); flash = Math.max(flash, 0.35 + fail * 0.5); }
        if (passGlow > 0.01) { cc.lerp(pal.green, passGlow); gc.lerp(pal.green, passGlow); flash = Math.max(flash, passGlow); }
        if (still) { cc.copy(pal.green).lerp(pal.pale, 0.4); gc.copy(pal.green).lerp(pal.beam, 0.5); }
      }
      g.core.uniforms.uIntensity.value = 0.26 + passed * 0.34 + flash * 1.3;
      g.glow.uniforms.uIntensity.value = (0.07 + passed * 0.1 + flash * 0.55) * pal.sleeve;
      g.glyph.opacity = 0.5 + passed * 0.3 + Math.min(1, flash) * 0.25;
      g.flare.opacity = Math.min(1, flash) * 0.85 * pal.sprite;
      g.flare.color.copy(i === 4 && failOn ? pal.red : i === 4 && passGlow > 0.05 ? pal.green : pal.pale);
      if (fr) fr.scale.setScalar(0.6 + Math.min(1, flash) * 0.9);
    });

    /* the send-back loop */
    const au = W.arc.coreMat.uniforms;
    const asu = W.arc.sleeveMat.uniforms;
    const arcGain = still ? 0.45 : smooth(T_BACK - 0.12, T_BACK, c) * (1 - smooth(T_FIX + 0.3, T_FIX + 1.4, c));
    for (const m of [au, asu]) {
      m.uHead.value = still ? 1.2 : mode === 2 ? s : c >= T_FIX ? 1.2 : 0;
      m.uTrail.value = 1;
      m.uGain.value = arcGain * (m.uBaseGain.value as number);
      (m.uColor.value as Color).copy(still ? pal.green : pal.amber);
    }

    /* the pulse */
    const hd = headRef.current;
    if (hd) {
      const visible = !still && (mode === 1 || mode === 2 || (mode === 3 && c < T_ARRIVE + 0.35));
      hd.visible = visible;
      if (visible) {
        if (mode === 2) W.arc.curve.getPoint(s, tmp.v);
        else tmp.v.copy(P0).lerp(E0, mode === 3 ? 1 : u);
        hd.position.copy(tmp.v);
        const fade = mode === 3 ? 1 - (c - T_ARRIVE) / 0.35 : 1;
        hd.scale.setScalar((1 + Math.sin(t * 23) * 0.04) * (mode === 1 && fail > 0 ? 1.15 : 1) * fade);
        if (L) {
          // a blue core with its white spark; the halo and streak glow in the glow colour, or in the state's colour
          const state = fail > 0 || mode === 2 || rerun > 0;
          W.head.halo.color.copy(state ? headColor : pal.halo);
          W.head.core.color.copy(headColor);
          W.head.streak.color.copy(fail > 0 || mode === 2 ? pal.amber : rerun ? pal.green : pal.halo);
        } else {
          W.head.halo.color.copy(headColor).lerp(pal.pale, 0.3);
          W.head.core.color.copy(pal.white).lerp(headColor, mode === 1 && fail === 0 && !rerun ? 0 : 0.6);
          W.head.streak.color.copy(fail > 0 || mode === 2 ? pal.amber : rerun ? pal.green : pal.beam);
        }
      }
    }

    /* ── act 3: the app prints, uplinks, goes live (its clock and fade are set above) ── */
    const A = W.app;
    A.riserMat.uniforms.uGrow.value = smooth(0, 0.3, a);
    A.riserMat.uniforms.uIntensity.value = fadeApp * (0.5 + 0.7 * Math.exp(-Math.max(0, a - 0.3) / 0.8));
    A.barLMat.uniforms.uGrow.value = smooth(0.2, 0.6, a);
    A.barRMat.uniforms.uGrow.value = smooth(0.2, 0.45, a);
    A.barLMat.uniforms.uIntensity.value = fadeApp * 0.8;
    A.barRMat.uniforms.uIntensity.value = fadeApp * 0.8;
    A.dashLineMat.uniforms.uDraw.value = smooth(0.35, 1.15, a);
    A.phoneLineMat.uniforms.uDraw.value = smooth(0.5, 1.25, a);
    A.dashLineMat.uniforms.uOpacity.value = fadeApp;
    A.phoneLineMat.uniforms.uOpacity.value = fadeApp;
    A.dashMat.uniforms.uReveal.value = smooth(0.9, 1.85, a) * 1.02;
    A.phoneMat.uniforms.uReveal.value = smooth(1.0, 1.85, a) * 1.02;
    A.dashMat.uniforms.uOpacity.value = fadeApp;
    A.phoneMat.uniforms.uOpacity.value = fadeApp;
    A.dashMat.uniforms.uTime.value = t;
    A.phoneMat.uniforms.uTime.value = t;
    A.upMat.uniforms.uGrow.value = smooth(1.8, 2.25, a);
    A.upMat.uniforms.uIntensity.value = fadeApp * (0.55 + 0.6 * Math.exp(-Math.max(0, a - 2.25) / 0.7));
    const ringOn = smooth(1.95, 2.3, a) * fadeApp;
    const ringFlash = a >= 2.25 ? Math.exp(-(a - 2.25) / 0.5) : 0;
    const live = smooth(2.25, 2.5, a) * fadeApp;
    if (L) {
      A.ringCoreMat.uniforms.uIntensity.value = ringOn * (0.55 + ringFlash * 1.2);
      A.ringGlowMat.uniforms.uIntensity.value = ringOn * (0.14 + ringFlash * 0.5);
      A.cloud.opacity = ringOn;
      A.label.opacity = smooth(2.2, 2.6, a) * fadeApp;
      A.live.opacity = live * (0.86 + 0.14 * Math.sin(t * 4.2));
      // a very faint blue tint around the app, and its faint pool on the floor
      A.haze.opacity = (live * 0.22 + smooth(0.9, 1.9, a) * fadeApp * 0.08) * 0.4;
      W.floor.mat.uniforms.uPoolAmt.value = live * 0.05;
    } else {
      A.ringCoreMat.uniforms.uIntensity.value = ringOn * (0.55 + ringFlash * 1.2);
      A.ringGlowMat.uniforms.uIntensity.value = ringOn * (0.14 + ringFlash * 0.5) * pal.sleeve;
      A.cloud.opacity = ringOn * 0.8;
      A.label.opacity = smooth(2.2, 2.6, a) * fadeApp * 0.9;
      A.live.opacity = live * (0.72 + 0.28 * Math.sin(t * 4.2));
      A.haze.opacity = live * 0.22 * pal.sprite + smooth(0.9, 1.9, a) * fadeApp * 0.08 * pal.sprite;
      W.floor.mat.uniforms.uPoolAmt.value = live * 0.07;
    }
    if (liveRef.current) liveRef.current.scale.setScalar(1 + (live > 0 ? 0.03 * Math.sin(t * 4.2) : 0));

    /* ── act 4: many lines ── */
    const vis = still ? 0.16 : smooth(T_SCALE + 0.1, T_SCALE + 1.3, c) * (1 - smooth(T_HOME, T_HOME + 0.8, c));
    for (const mm of [W.parRail.material, W.parSleeve.material, W.parGates.material, W.parHeads.material, W.parApps.material] as ShaderMaterial[]) {
      mm.uniforms.uVis.value = vis;
      mm.uniforms.uTime.value = t;
    }
    W.parRail.visible = W.parSleeve.visible = W.parGates.visible = W.parHeads.visible = W.parApps.visible = vis > 0.001;

    if (W.dust) W.dust.mat.uniforms.uTime.value = t;

    /* ── the legend ── */
    let li: number;
    let lh: number;
    if (still || mode === 3) { li = 9; lh = 1; } else if (mode === 0) { lh = 0.1 * clamp01(c / T_GO); li = legendIndexAt(lh); } else if (mode === 2) {
      lh = s < 0.5 ? SU[4] : SU[1];
      li = legendIndexAt(lh);
    } else if (c >= T_FAIL && c < T_BACK) { lh = SU[4]; li = legendIndexAt(lh); } else if (c >= T_FIX && c < T_RERUN) { lh = SU[1]; li = legendIndexAt(lh); } else {
      lh = legendHead(u);
      li = legendIndexAt(lh);
    }
    onProgress?.(li, lh);
    frames.current += 1;
    if (!ready.current && frames.current >= (still ? 1 : 3)) { ready.current = true; onReady?.(); }
  });

  const A = W.app;
  return (
    <>
      <color attach="background" args={[bg]} />
      <group ref={story}>
        <sprite material={W.horizon} position={[-1, 0.4, -34]} scale={[70, 9, 1]} />
        <mesh geometry={W.floor.geo} material={W.floor.mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, -40]} renderOrder={light ? -9 : 0} />

        {/* the other lines */}
        <primitive object={W.parSleeve} />
        <primitive object={W.parRail} />
        <primitive object={W.parGates} />
        <primitive object={W.parApps} />
        <primitive object={W.parHeads} />

        {/* the line, its gates and the send-back loop */}
        <mesh geometry={W.beam.sleeve} material={W.beam.sleeveMat} frustumCulled={false} />
        <mesh geometry={W.beam.core} material={W.beam.coreMat} frustumCulled={false} />
        <mesh geometry={W.arc.sleeve} material={W.arc.sleeveMat} />
        <mesh geometry={W.arc.core} material={W.arc.coreMat} />
        {W.gates.map((g, i) => (
          <group key={i} position={g.pos}>
            <group quaternion={RING_Q}>
              <mesh geometry={W.ringGlow} material={g.glow} />
              <mesh geometry={W.ringCore} material={g.core} />
            </group>
            <group ref={(el) => { flareRefs.current[i] = el; }}>
              <sprite material={g.flare} />
            </group>
            <sprite material={g.glyph} position={[0, RING_R + 0.32, 0]} scale={[GLYPH_W, GLYPH_W / GLYPH_ASPECT, 1]} />
          </group>
        ))}

        {/* the bright point and the pulse */}
        <group position={P0}>
          <group ref={pointHalo}><sprite material={W.point.halo} /></group>
          <sprite material={W.point.core} scale={[0.22, 0.22, 1]} />
          {W.point.spark && <sprite material={W.point.spark} scale={[0.08, 0.08, 1]} renderOrder={3} />}
        </group>
        <group ref={headRef} visible={false}>
          <sprite material={W.head.halo} scale={[1.0, 1.0, 1]} />
          <sprite material={W.head.core} scale={[0.24, 0.24, 1]} renderOrder={2} />
          <sprite material={W.head.streak} scale={[1.7, 0.035, 1]} />
          {W.head.spark && <sprite material={W.head.spark} scale={[0.07, 0.07, 1]} renderOrder={3} />}
        </group>

        {/* the brief's source material and its light */}
        {W.cards.map((cd, i) => (
          <group key={i} ref={(el) => { cardRefs.current[i] = el; }} visible={false}>
            <mesh geometry={cd.geo} material={cd.mat} />
          </group>
        ))}
        <points geometry={W.streamGeo} material={W.streamMat} frustumCulled={false} />

        {/* the printed app */}
        <sprite material={A.haze} position={[DASH.pos.x + 0.5, DASH.pos.y, DASH.pos.z - 0.6]} scale={[4.6, 3.0, 1]} />
        <mesh geometry={A.riserGeo} material={A.riserMat} position={[E0.x, E0.y, E0.z]} />
        <mesh geometry={A.barLGeo} material={A.barLMat} position={[E0.x, BAR_Y, E0.z]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={A.barRGeo} material={A.barRMat} position={[E0.x, BAR_Y, E0.z]} rotation={[0, 0, -Math.PI / 2]} />
        <group position={DASH.pos} rotation={[0, 0.05, 0]}>
          <mesh geometry={A.dashGeo} material={A.dashMat} />
          <mesh geometry={A.dashLine} material={A.dashLineMat} position={[0, 0, 0.004]} />
          <group ref={liveRef} position={[DASH.w / 2 - 0.26, DASH.h / 2 + 0.13, 0.02]}>
            <sprite material={A.live} scale={[0.44, 0.16, 1]} />
          </group>
        </group>
        <group position={PHONE.pos} rotation={[0, -0.12, 0]}>
          <mesh geometry={A.phoneGeo} material={A.phoneMat} />
          <mesh geometry={A.phoneLine} material={A.phoneLineMat} position={[0, 0, 0.004]} />
        </group>
        <mesh geometry={A.upGeo} material={A.upMat} position={[CLOUD.x, DASH.pos.y + DASH.h / 2 + 0.02, CLOUD.z]} />
        <group position={CLOUD}>
          <group rotation={[1.22, 0, 0]}>
            <mesh geometry={A.ringGlow} material={A.ringGlowMat} />
            <mesh geometry={A.ringCore} material={A.ringCoreMat} />
          </group>
          <sprite material={A.cloud} position={[0, 0.2, 0]} scale={[0.34, 0.34 / GLYPH_ASPECT, 1]} />
          <sprite material={A.label} position={[0.62, 0.02, 0]} scale={[LABEL_SIZE[0], LABEL_SIZE[1], 1]} center={LABEL_CENTER} />
        </group>

        {W.dust && <points geometry={W.dust.geo} material={W.dust.mat} frustumCulled={false} />}
      </group>
    </>
  );
}

export default function StoryScene({ active, still, canvas, light, onReady, onProgress, textEdge }: ConceptSceneProps) {
  const dprMax = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  return (
    <Canvas
      aria-hidden
      dpr={[1, dprMax]}
      frameloop={still ? "demand" : active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [CAM0.x, CAM0.y, CAM0.z], fov: 30, near: 0.1, far: 160 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Scene key={light ? "light" : "dark"} still={still} canvas={canvas} light={light} onReady={onReady} onProgress={onProgress} textEdge={textEdge} />
    </Canvas>
  );
}
