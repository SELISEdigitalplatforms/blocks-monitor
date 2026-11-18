/** Blueprint: the project's scope draws itself as a CAD hologram (a fan of app screens, a data model, API connectors,
 *  dimension lines), then MADP's agents pass over it one laser sweep each: glass (01 Business analyst), lit UI (02 Tech lead),
 *  review brackets (03), test checks (04), an amber SecOps flag that loops back to the Tech lead and turns green under a
 *  hexagonal shield (05), docs pages fan out (06), the release gate compresses everything into one module (07), which
 *  beams up into the SELISE Blocks ring (deploy) and the app hangs there, LIVE.
 *  Drawn in code: screen-space 1 px neon lines with soft sleeves, canvas-painted labels and UI, fog into the page colour.
 *  One composition for both themes: geometry, sizes, camera, framing, timing and motion are shared, so the hero has the
 *  same size in light and dark. Daylight (light theme) is the same neon photographed in daylight: thin saturated-blue
 *  cores in soft blue sleeves, halos and sprites laid over the light canvas (normal blending). Only colours, blending,
 *  opacity and draw order differ between the themes, so the dark scene is unchanged. */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending, type BufferGeometry, Color, type Group, type Mesh, NormalBlending, type PerspectiveCamera, PlaneGeometry,
  SphereGeometry, type Sprite, SpriteMaterial, type Texture, Vector2, Vector3,
} from "three";
import { t } from "@/madp/i18n";
import type { ConceptSceneProps } from "../types";
import {
  type LabelDef, LabelBuilder, LineBuilder, type SegOpts, type UiBox, type V3, SCREENS, TONE,
  beamMaterial, floorMaterial, labelMaterial, lineMaterial, makeGlowTexture, makeTextAtlas, makeUiAtlas, panelGeometry,
  panelMaterial, shieldMaterial, sweepMaterial,
} from "./gfx";
import { FLAG_U, FLAG_X, MODULE_P, PERIOD, RING_Y, TS, T_LIVE, composeStill, evaluate, newState } from "./timeline";

/* ── the composition (world units; floor at y = 0, the camera looks from the front right) ───────── */

const AZ0 = (14 * Math.PI) / 180; // camera azimuth: billboards face this way
const EL0 = (13.5 * Math.PI) / 180;
const FACE_R: V3 = [Math.cos(AZ0), 0, -Math.sin(AZ0)];
const UP: V3 = [0, 1, 0];

const PANEL_W = 0.8;
const PANEL_H = 1.1;
const PANEL_Y0 = 0.42;
const FAN_C: V3 = [0, 0, 2.3];
const FAN_R = 3.05;
const FAN_DEG = [-27, -9, 9, 27];

const DOC_W = 0.3;
const DOC_H = 0.4;
const LIVE_W = 1.5;
const LIVE_H = 0.94;
const LIVE_P: V3 = [0.05, 1.52, 0.35];
const DOC_PIVOT: V3 = [1.02, 1.42, 0.2];

const NB = { w: 0.5, h: 0.13, d: 0.28 };
const NODES: { key: string; p: V3 }[] = [
  { key: "n0", p: [-1.05, 0, 1.02] },
  { key: "n1", p: [0.0, 0, 0.74] },
  { key: "n2", p: [1.08, 0, 1.04] },
  { key: "n3", p: [FLAG_X, 0, 1.74] },
];
/** API connector: node -> panel (CUSTOMER -> sign in, ORDER -> orders, INVOICE -> detail, PRODUCT -> invoices) */
const CONNECT: [number, number, string][] = [[0, 0, "api0"], [1, 1, "api1"], [3, 2, "api2"], [2, 3, "api3"]];
/** when each data-model node starts to draw */
const nodeT0 = (k: number) => 1.1 + k * 0.13;
/** the release module's half size */
const MOD_S = 0.17;

/** daylight draw order (normal blending: what comes later covers what came before, so every glow goes under the cores
 *  it belongs to and the labels stay on top); the dark scene adds light, so its order never mattered and stays as it was */
const RO = {
  floor: -30, haze: -29, panels: -28, docs: -27, shield: -26, sweep: -25, underGlow: -24, sweepGlow: -23, lineA: -22,
  labelA: -21, dots: -20, beam: -19, ringGlow: -18, moduleHalo: -17, moduleCore: -16, lineC: -15, labelC: -14,
  liveHalo: -13, live: -12, lineB: -11, labelB: -10, hud: -9,
} as const;

/** the working agent's tag, one per station (read in the chosen language when the scene is built) */
const hudTexts = () => [
  t("landing.scene.hudAnalyst", "BUSINESS ANALYST · REQ"), t("landing.scene.hudTechLead", "TECH LEAD · CODE"),
  t("landing.scene.hudReviewer", "REVIEWER · REVIEW"), t("landing.scene.hudTester", "TESTER · TEST"),
  t("landing.scene.hudSecOps", "SECOPS · SEC + PT"), t("landing.scene.hudDocs", "DOCS"),
  t("landing.scene.hudGate", "RELEASE GATE"), t("landing.scene.hudDeploy", "DEPLOY · SELISE BLOCKS · SMOKE TEST"),
];
const HUD_COUNT = 8;

/** the hologram's labels (API paths, sizes and product names stay as they are) */
const labels = (): LabelDef[] => [
  { key: "title", text: t("landing.scene.scopeTitle", "SCOPE v1.0 · ORDER PORTAL"), bold: true },
  { key: "sub", text: t("landing.scene.scopeSub", "4 SCREENS · 4 ENTITIES · 9 STORIES") },
  { key: "fr0", text: t("landing.scene.frSignIn", "FR-01 SIGN IN") }, { key: "fr1", text: t("landing.scene.frOrders", "FR-04 ORDERS") },
  { key: "fr2", text: t("landing.scene.frOrderDetail", "FR-07 ORDER DETAIL") }, { key: "fr3", text: t("landing.scene.frInvoices", "FR-09 INVOICES") },
  { key: "n0", text: t("landing.scene.entityCustomer", "CUSTOMER"), bold: true }, { key: "n1", text: t("landing.scene.entityOrder", "ORDER"), bold: true },
  { key: "n2", text: t("landing.scene.entityProduct", "PRODUCT"), bold: true }, { key: "n3", text: t("landing.scene.entityInvoice", "INVOICE"), bold: true },
  { key: "api0", text: "GET /customers/:id" }, { key: "api1", text: "GET /orders" },
  { key: "api2", text: "POST /invoices" }, { key: "api3", text: "GET /products" },
  { key: "dimH", text: "H 1100" }, { key: "dimW", text: "W 800" }, { key: "dimF", text: t("landing.scene.dataModel", "4 ENTITIES · 3 RELATIONS") },
  { key: "flag", text: t("landing.scene.secFlag", "SEC-02 · INPUT VALIDATION"), icon: "warn", bold: true },
  { key: "loop", text: t("landing.scene.backToTechLead", "BACK TO THE TECH LEAD · AUTO-FIX"), icon: "loop" },
  { key: "pass", text: t("landing.scene.fixedPassed", "FIXED · PASSED"), icon: "check", bold: true },
  { key: "gate", text: t("landing.scene.gateOpen", "RELEASE GATE · OPEN"), bold: true },
  { key: "ring", text: "SELISE BLOCKS", bold: true },
  { key: "live", text: t("landing.scene.live", "LIVE"), icon: "dot", bold: true },
  { key: "liveCap", text: t("landing.scene.liveCaption", "order-portal · v1.0 · smoke test passed") },
  ...hudTexts().map((text, i) => ({ key: `hud${i}`, text, bold: true })),
];

/* small vector helpers (build time only) */
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const circle = (c: V3, r: number, ax: V3, ay: V3, n: number, a0 = 0, a1 = Math.PI * 2): V3[] => {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(add(c, add(mul(ax, Math.cos(a) * r), mul(ay, Math.sin(a) * r))));
  }
  return pts;
};

function panelFrame(i: number) {
  const phi = (FAN_DEG[i] * Math.PI) / 180;
  const ry = -phi;
  const center: V3 = [FAN_C[0] + FAN_R * Math.sin(phi), PANEL_Y0 + PANEL_H / 2, FAN_C[2] - FAN_R * Math.cos(phi)];
  const right: V3 = [Math.cos(ry), 0, -Math.sin(ry)];
  const normal: V3 = [Math.sin(ry), 0, Math.cos(ry)];
  /** normalised layout coordinates (x right, y down) -> world */
  const at = (lx: number, ly: number): V3 => add(center, add(mul(right, (lx - 0.5) * PANEL_W), [0, (0.5 - ly) * PANEL_H, 0]));
  /** metres from the centre -> world */
  const atM = (px: number, py: number, off = 0): V3 => add(center, add(add(mul(right, px), [0, py, 0]), mul(normal, off)));
  return { center, ry, right, normal, at, atM };
}
const PANELS = FAN_DEG.map((_, i) => panelFrame(i));

/** a dimension line: extension lines, the line itself and arrow heads */
function dimension(L: LineBuilder, a: V3, b: V3, out: V3, off: number, o: SegOpts) {
  const a2 = add(a, mul(out, off)), b2 = add(b, mul(out, off));
  L.seg(add(a, mul(out, 0.025)), add(a, mul(out, off + 0.035)), o);
  L.seg(add(b, mul(out, 0.025)), add(b, mul(out, off + 0.035)), o);
  L.seg(a2, b2, o);
  const dir = norm(sub(b2, a2));
  const s = 0.04;
  for (const [p, k] of [[a2, 1], [b2, -1]] as [V3, number][]) {
    L.seg(p, add(p, add(mul(dir, s * k), mul(out, s * 0.4))), o);
    L.seg(p, add(p, add(mul(dir, s * k), mul(out, -s * 0.4))), o);
  }
}

/** a check mark in a ring, in the plane (ax, ay) */
function checkBadge(L: LineBuilder, c: V3, r: number, ax: V3, ay: V3, o: SegOpts) {
  L.poly(circle(c, r, ax, ay, 28), false, o);
  const p = (x: number, y: number) => add(c, add(mul(ax, x * r), mul(ay, y * r)));
  L.poly([p(-0.45, 0.02), p(-0.12, -0.32), p(0.48, 0.36)], false, { ...o, tone: TONE.HOT });
}

/** the outline wireframe of one screen's layout box */
function boxLines(L: LineBuilder, at: (x: number, y: number) => V3, b: UiBox, o: SegOpts) {
  const [x0, y0, x1, y1] = b.r;
  const rect = (a: number, bb: number, c: number, d: number, oo: SegOpts) => L.poly([at(a, bb), at(c, bb), at(c, d), at(a, d)], true, oo);
  const line = (a: number, bb: number, c: number, d: number, oo: SegOpts) => L.seg(at(a, bb), at(c, d), oo);
  const dim = { ...o, tone: TONE.DIM, gain: 0.85 };
  const h = y1 - y0, w = x1 - x0;
  switch (b.k) {
    case "txt": line(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, dim); break;
    case "circ": {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const r = Math.min(w * PANEL_W, h * PANEL_H) / 2;
      const c = at(cx, cy);
      const pts = circle(c, r, norm(sub(at(cx + 0.1, cy), at(cx, cy))), UP, 32);
      L.poly(pts, false, o);
      break;
    }
    case "row":
      rect(x0, y0, x1, y1, { ...o, gain: 0.55 });
      rect(x0 + 0.02, y0 + h * 0.2, x0 + 0.02 + (h * 0.6 * PANEL_H) / PANEL_W, y1 - h * 0.2, o);
      line(x0 + w * 0.2, y0 + h * 0.36, x0 + w * 0.62, y0 + h * 0.36, dim);
      line(x0 + w * 0.2, y0 + h * 0.64, x0 + w * 0.45, y0 + h * 0.64, dim);
      break;
    case "chart": {
      L.poly([at(x0, y0), at(x0, y1), at(x1, y1)], false, o);
      for (let i = 0; i < 7; i++) {
        const bx0 = x0 + 0.04 + (i * (w - 0.06)) / 7, bx1 = bx0 + (w - 0.06) / 7 - 0.025;
        const top = y1 - (0.25 + 0.6 * Math.abs(Math.sin(i * 1.7 + 3))) * h;
        L.poly([at(bx0, y1), at(bx0, top), at(bx1, top), at(bx1, y1)], false, { ...o, gain: 0.7 });
      }
      break;
    }
    case "img":
      rect(x0, y0, x1, y1, o);
      line(x0, y0, x1, y1, dim);
      line(x1, y0, x0, y1, dim);
      break;
    case "kpi":
      rect(x0, y0, x1, y1, o);
      line(x0 + w * 0.12, y0 + h * 0.3, x0 + w * 0.5, y0 + h * 0.3, dim);
      line(x0 + w * 0.12, y0 + h * 0.62, x0 + w * 0.78, y0 + h * 0.62, dim);
      break;
    case "btn":
      rect(x0, y0, x1, y1, { ...o, tone: TONE.HOT, gain: 0.75 });
      line(x0 + w * 0.35, (y0 + y1) / 2, x1 - w * 0.35, (y0 + y1) / 2, dim);
      break;
    case "field":
      rect(x0, y0, x1, y1, o);
      line(x0 + w * 0.05, (y0 + y1) / 2, x0 + w * 0.42, (y0 + y1) / 2, dim);
      break;
    case "hdr":
      rect(x0, y0, x1, y1, o);
      line(x0 + 0.06, (y0 + y1) / 2, x0 + 0.34, (y0 + y1) / 2, dim);
      break;
    default:
      rect(x0, y0, x1, y1, o);
  }
}

interface Built {
  textTex: Texture; uiTex: Texture;
  lineA: BufferGeometry; labelA: BufferGeometry; lineB: BufferGeometry; labelB: BufferGeometry;
  lineC: BufferGeometry; labelC: BufferGeometry; hud: BufferGeometry[];
  panelGeos: BufferGeometry[]; docGeo: BufferGeometry; liveGeo: BufferGeometry;
  shieldGeo: BufferGeometry; sweepGeo: BufferGeometry; beamGeo: BufferGeometry; floorGeo: BufferGeometry;
  ports: { from: V3; to: V3 }[];
}

/** the scene's geometry and atlases: one build for both themes (the themes differ only in their materials) */
function build(): Built {
  const text = makeTextAtlas(labels());
  const ui = makeUiAtlas(PANEL_W / PANEL_H, DOC_W / DOC_H, LIVE_W / LIVE_H);
  const A = new LineBuilder();
  const LA = new LabelBuilder(text.rects);
  const scope = (start: number, dur: number, extra: SegOpts & { anchor?: number } = {}): SegOpts & { anchor?: number } => ({ start, dur, layer: 0, tone: TONE.MAIN, ...extra });

  /* the floor arc the screens stand on, with ticks */
  const arc: V3[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = ((-35 + (70 * i) / 48) * Math.PI) / 180;
    arc.push([FAN_C[0] + FAN_R * Math.sin(a), 0.004, FAN_C[2] - FAN_R * Math.cos(a)]);
  }
  A.poly(arc, false, scope(0.0, 0.6, { tone: TONE.DIM, gain: 0.7 }));
  for (let i = -7; i <= 7; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const p: V3 = [FAN_C[0] + FAN_R * Math.sin(a), 0.004, FAN_C[2] - FAN_R * Math.cos(a)];
    const q: V3 = [FAN_C[0] + (FAN_R - (i % 3 === 0 ? 0.09 : 0.05)) * Math.sin(a), 0.004, FAN_C[2] - (FAN_R - (i % 3 === 0 ? 0.09 : 0.05)) * Math.cos(a)];
    A.seg(p, q, scope(0.15 + (i + 7) * 0.025, 0.12, { tone: TONE.DIM, gain: 0.6 }));
  }

  /* the screens: frame, stands, layout boxes, requirement labels */
  PANELS.forEach((P, i) => {
    const t0 = 0.2 + i * 0.16;
    A.poly([P.at(0, 1), P.at(0, 0), P.at(1, 0), P.at(1, 1)], true, scope(t0, 0.72, { tone: TONE.MAIN, gain: 1.15 }));
    for (const lx of [0, 1]) A.seg(P.at(lx, 1), [P.at(lx, 1)[0], 0.004, P.at(lx, 1)[2]], scope(t0 + 0.2, 0.3, { tone: TONE.DIM, gain: 0.5 }));
    SCREENS[i].forEach((b, j) => boxLines(A, P.at, b, scope(0.62 + i * 0.16 + j * 0.055, 0.34, { gain: 0.8 })));
    LA.add(`fr${i}`, P.atM(-PANEL_W / 2 + 0.01, -PANEL_H / 2 - 0.055, 0.004), P.right, UP, 0.07, scope(0.95 + i * 0.15, 0.5, { gain: 0.9 }));
  });

  /* dimension lines: height of the right screen, width of the second, the data model span */
  {
    const P = PANELS[3];
    dimension(A, P.atM(PANEL_W / 2, -PANEL_H / 2), P.atM(PANEL_W / 2, PANEL_H / 2), P.right, 0.1, scope(2.0, 0.45, { tone: TONE.DIM, gain: 0.9 }));
    LA.add("dimH", P.atM(PANEL_W / 2 + 0.15, 0, 0), P.right, UP, 0.07, scope(2.2, 0.4, { tone: TONE.DIM, gain: 1.1 }));
    const Q = PANELS[1];
    dimension(A, Q.atM(-PANEL_W / 2, PANEL_H / 2), Q.atM(PANEL_W / 2, PANEL_H / 2), UP, 0.08, scope(1.9, 0.45, { tone: TONE.DIM, gain: 0.9 }));
    LA.add("dimW", Q.atM(0, PANEL_H / 2 + 0.15, 0), Q.right, UP, 0.07, scope(2.1, 0.35, { tone: TONE.DIM, gain: 1.1, anchor: 0.5 }));
  }

  /* title block */
  {
    const tl = PANELS[0].at(0, 0);
    LA.add("title", [tl[0], 1.73, tl[2]], FACE_R, UP, 0.085, scope(0.25, 0.8, { tone: TONE.HOT, gain: 0.95 }));
    LA.add("sub", [tl[0], 1.635, tl[2]], FACE_R, UP, 0.064, scope(0.7, 0.7, { tone: TONE.MAIN, gain: 0.9 }));
  }

  /* the data model: boxes, labels, relations (crow's feet) */
  NODES.forEach((n, k) => {
    const [x, , z] = n.p;
    const t0 = nodeT0(k);
    const y0 = 0.004, y1 = NB.h;
    const c = (sx: number, y: number, sz: number): V3 => [x + (sx * NB.w) / 2, y, z + (sz * NB.d) / 2];
    A.poly([c(-1, y0, -1), c(1, y0, -1), c(1, y0, 1), c(-1, y0, 1)], true, scope(t0, 0.3, { gain: 0.9 }));
    A.poly([c(-1, y1, -1), c(1, y1, -1), c(1, y1, 1), c(-1, y1, 1)], true, scope(t0 + 0.18, 0.3, { tone: TONE.MAIN, gain: 1.1 }));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) A.seg(c(sx, y0, sz), c(sx, y1, sz), scope(t0 + 0.12, 0.12, { gain: 0.8 }));
    // field rows on the top face
    for (let r = 0; r < 2; r++) A.seg(c(-0.75, y1, -0.35 + r * 0.45), c(0.2 - r * 0.25, y1, -0.35 + r * 0.45), scope(t0 + 0.4, 0.15, { tone: TONE.DIM, gain: 0.8 }));
    LA.add(n.key, [x, 0.3, z], FACE_R, UP, 0.085, scope(t0 + 0.25, 0.4, { tone: TONE.HOT, gain: 0.95, anchor: 0.5 }));
  });
  const crow = (tip: V3, dir: V3, side: V3, o: SegOpts) => {
    const base = add(tip, mul(dir, -0.07));
    A.seg(base, add(tip, mul(side, 0.045)), o);
    A.seg(base, add(tip, mul(side, -0.045)), o);
    A.seg(base, tip, o);
  };
  const bar = (p: V3, dir: V3, side: V3, o: SegOpts) => A.seg(add(add(p, mul(dir, -0.05)), mul(side, 0.04)), add(add(p, mul(dir, -0.05)), mul(side, -0.04)), o);
  {
    const y = 0.004;
    const o1 = scope(1.65, 0.45, { gain: 0.85 });
    A.poly([[-0.8, y, 1.02], [-0.42, y, 1.02], [-0.42, y, 0.74], [-0.25, y, 0.74]], false, o1);
    crow([-0.25, y, 0.74], [1, 0, 0], [0, 0, 1], scope(2.05, 0.15));
    bar([-0.8, y, 1.02], [-1, 0, 0], [0, 0, 1], scope(1.65, 0.1));
    const o2 = scope(1.75, 0.45, { gain: 0.85 });
    A.poly([[0.25, y, 0.74], [0.6, y, 0.74], [0.6, y, 1.04], [0.83, y, 1.04]], false, o2);
    crow([0.83, y, 1.04], [1, 0, 0], [0, 0, 1], scope(2.15, 0.15));
    crow([0.25, y, 0.74], [-1, 0, 0], [0, 0, 1], scope(1.75, 0.15));
    const o3 = scope(1.85, 0.45, { gain: 0.85 });
    A.poly([[0.1, y, 0.88], [0.1, y, 1.3], [FLAG_X, y, 1.3], [FLAG_X, y, 1.6]], false, o3);
    bar([0.1, y, 0.88], [0, 0, -1], [1, 0, 0], scope(1.85, 0.1));
    bar([FLAG_X, y, 1.6], [0, 0, 1], [1, 0, 0], scope(2.25, 0.1));
  }

  /* API connectors: dashed, node -> screen port */
  const ports: { from: V3; to: V3 }[] = [];
  CONNECT.forEach(([n, p, key], i) => {
    const from: V3 = [NODES[n].p[0], NB.h + 0.01, NODES[n].p[2]];
    const to = PANELS[p].at(0.74, 1);
    ports.push({ from, to });
    const t0 = 1.95 + i * 0.12;
    A.dashed(from, to, 11, scope(t0, 0.5, { gain: 0.75 }));
    A.poly(circle(to, 0.026, [1, 0, 0], [0, 0, 1], 18), false, scope(t0 + 0.45, 0.15, { tone: TONE.HOT }));
    A.poly(circle(from, 0.02, [1, 0, 0], [0, 0, 1], 14), false, scope(t0, 0.12));
    const mid = lerp3(from, to, 0.45);
    LA.add(key, add(mid, [0.05, 0, 0]), FACE_R, UP, 0.064, scope(t0 + 0.3, 0.45, { tone: TONE.MAIN, gain: 1.0 }));
  });

  /* 03 Reviewer: corner brackets (white), revealed behind the sweep */
  const rev: SegOpts = { layer: 1, tone: TONE.HOT, gain: 0.9 };
  PANELS.forEach((P) => {
    const hw = PANEL_W / 2 + 0.03, hh = PANEL_H / 2 + 0.03, l = 0.085;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = P.atM(sx * hw, sy * hh);
      A.poly([P.atM(sx * hw, sy * (hh - l)), c, P.atM(sx * (hw - l), sy * hh)], false, rev);
    }
  });
  NODES.forEach((n) => {
    const [x, , z] = n.p;
    const hw = NB.w / 2 + 0.04, hd = NB.d / 2 + 0.04, l = 0.07, y = NB.h;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      A.poly([[x + sx * hw, y, z + sz * (hd - l)], [x + sx * hw, y, z + sz * hd], [x + sx * (hw - l), y, z + sz * hd]], false, rev);
    }
  });

  /* 04 Tester: check badges */
  const tst: SegOpts = { layer: 2, tone: TONE.MAIN, gain: 1.1 };
  PANELS.forEach((P) => checkBadge(A, P.atM(PANEL_W / 2 - 0.05, PANEL_H / 2 + 0.085, 0.004), 0.038, P.right, UP, tst));
  NODES.forEach((n) => checkBadge(A, [n.p[0] + NB.w / 2 + 0.07, 0.17, n.p[2] + NB.d / 2], 0.034, FACE_R, UP, tst));

  /* 05 SecOps: amber flag on INVOICE, the loop back to the Tech lead, the green pass */
  {
    const c: V3 = [FLAG_X, 0.006, NODES[3].p[2]];
    const t0 = TS[4];
    A.poly(circle(c, 0.4, [1, 0, 0], [0, 0, 1], 56), false, { layer: 3, tone: TONE.AMBER, start: t0 + FLAG_U, dur: 0.22, gain: 1.1 });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const d: V3 = [Math.cos(a), 0, Math.sin(a)];
      A.seg(add(c, mul(d, 0.44)), add(c, mul(d, 0.52)), { layer: 3, tone: TONE.AMBER, start: t0 + FLAG_U + 0.1, dur: 0.1 });
    }
    A.poly([[FLAG_X + NB.w / 2, NB.h, c[2]], [FLAG_X + 0.45, 0.2, c[2] + 0.07], [FLAG_X + 0.58, 0.2, c[2] + 0.09]], false, { layer: 3, tone: TONE.AMBER, start: t0 + FLAG_U + 0.05, dur: 0.15, gain: 0.9 });
    A.poly([[FLAG_X + NB.w / 2, NB.h, c[2]], [FLAG_X + 0.45, 0.2, c[2] + 0.07], [FLAG_X + 0.58, 0.2, c[2] + 0.09]], false, { layer: 5, tone: TONE.GREEN, start: t0 + 1.55, dur: 0.15, gain: 0.9 });
    LA.add("flag", [FLAG_X + 0.62, 0.2, c[2] + 0.1], FACE_R, UP, 0.078, { layer: 3, tone: TONE.AMBER, start: t0 + FLAG_U + 0.12, dur: 0.3 });
    // the loop: an arrowed arc around the node, drawn once, back to the Tech lead and home again
    const a0 = Math.PI * 0.6, a1 = a0 + Math.PI * 1.75;
    const loop = circle([FLAG_X, 0.03, c[2]], 0.56, [1, 0, 0], [0, 0, 1], 60, a0, a1);
    A.poly(loop, false, { layer: 4, tone: TONE.VIOLET, start: t0 + 1.0, dur: 0.5, gain: 1.2 });
    const end = loop[loop.length - 1];
    const tan: V3 = [-Math.sin(a1), 0, Math.cos(a1)];
    const out: V3 = [Math.cos(a1), 0, Math.sin(a1)];
    A.seg(end, add(end, add(mul(tan, -0.07), mul(out, 0.05))), { layer: 4, tone: TONE.VIOLET, start: t0 + 1.48, dur: 0.06 });
    A.seg(end, add(end, add(mul(tan, -0.07), mul(out, -0.05))), { layer: 4, tone: TONE.VIOLET, start: t0 + 1.48, dur: 0.06 });
    LA.add("loop", [FLAG_X + 0.62, 0.1, c[2] + 0.1], FACE_R, UP, 0.066, { layer: 4, tone: TONE.VIOLET, start: t0 + 1.0, dur: 0.35 });
    A.poly(circle(c, 0.4, [1, 0, 0], [0, 0, 1], 56), false, { layer: 5, tone: TONE.GREEN, start: t0 + 1.52, dur: 0.25, gain: 1.0 });
    LA.add("pass", [FLAG_X + 0.62, 0.2, c[2] + 0.1], FACE_R, UP, 0.078, { layer: 5, tone: TONE.GREEN, start: t0 + 1.58, dur: 0.25 });
  }

  /* the SELISE Blocks ring, and the live app hanging from it (world, outside the compressing structure) */
  const B = new LineBuilder();
  const LB = new LabelBuilder(text.rects);
  const rc: V3 = [MODULE_P[0], RING_Y, MODULE_P[2]];
  const ringT = TS[6] + 0.9;
  B.poly(circle(rc, 0.62, [1, 0, 0], [0, 0, 1], 72), false, { layer: 0, tone: TONE.HOT, start: ringT, dur: 0.55, gain: 1.0 });
  B.poly(circle(rc, 0.7, [1, 0, 0], [0, 0, 1], 72), false, { layer: 0, tone: TONE.MAIN, start: ringT + 0.1, dur: 0.55, gain: 0.9 });
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const long = k % 4 === 0;
    B.seg(add(rc, mul(d, 0.74)), add(rc, mul(d, long ? 0.8 : 0.77)), { layer: 0, tone: TONE.DIM, start: ringT + 0.2 + k * 0.006, dur: 0.06, gain: long ? 1.1 : 0.8 });
  }
  for (let k = 0; k < 4; k++) {
    // four blocks seated on the ring
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const t: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const p = add(rc, mul(d, 0.66));
    const s = 0.045;
    const q = (u: number, v: number, y: number): V3 => add(add(add(p, mul(d, u * s)), mul(t, v * s)), [0, y, 0]);
    B.poly([q(-1, -1, s), q(1, -1, s), q(1, 1, s), q(-1, 1, s)], true, { layer: 0, tone: TONE.HOT, start: ringT + 0.4, dur: 0.2 });
    B.poly([q(-1, -1, -s), q(1, -1, -s), q(1, 1, -s), q(-1, 1, -s)], true, { layer: 0, tone: TONE.MAIN, start: ringT + 0.4, dur: 0.2, gain: 0.7 });
  }
  LB.add("ring", [rc[0] + 0.86, RING_Y + 0.0, rc[2]], FACE_R, UP, 0.09, { layer: 0, tone: TONE.HOT, start: ringT + 0.3, dur: 0.4 });
  LB.add("live", [rc[0] + 0.88, RING_Y - 0.13, rc[2]], FACE_R, UP, 0.1, { layer: 1, tone: TONE.HOT });
  {
    // live panel outline and its suspension lines to the ring
    const r = FACE_R;
    const corner = (sx: number, sy: number): V3 => add(LIVE_P, add(mul(r, (sx * LIVE_W) / 2), [0, (sy * LIVE_H) / 2, 0]));
    B.poly([corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)], true, { layer: 1, tone: TONE.HOT, start: T_LIVE, dur: 0.55, gain: 0.9 });
    for (const sx of [-1, 1]) {
      const top = corner(sx, 1);
      const onRing = add(rc, mul(r, sx * 0.62));
      B.dashed(onRing, top, 9, { layer: 1, tone: TONE.MAIN, start: T_LIVE + 0.1, dur: 0.4, gain: 0.7 });
    }
    LB.add("liveCap", add(corner(-1, -1), [0, -0.075, 0]), r, UP, 0.064, { layer: 2, tone: TONE.MAIN, start: T_LIVE + 0.35, dur: 0.5 });
  }

  /* the release module (its own group: it rises up the beam) */
  const C = new LineBuilder();
  const LC = new LabelBuilder(text.rects);
  {
    const cube = (s: number, o: SegOpts) => {
      const v = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
      C.poly([v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], true, o);
      C.poly([v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1)], true, o);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C.seg(v(x, -1, z), v(x, 1, z), o);
    };
    cube(MOD_S, { tone: TONE.HOT, gain: 1.1 });
    cube(0.09, { tone: TONE.MAIN, gain: 1.0 });
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const d: V3 = [Math.cos(a), 0, Math.sin(a)];
      const t: V3 = [-Math.sin(a), 0, Math.cos(a)];
      for (const off of [-0.08, 0, 0.08]) C.seg(add(mul(d, MOD_S), mul(t, off)), add(mul(d, 0.25), mul(t, off)), { tone: TONE.MAIN, gain: 0.8 });
    }
    LC.add("gate", [0, 0.3, 0], FACE_R, UP, 0.08, { layer: 3, tone: TONE.HOT, anchor: 0.5 });
  }

  /* HUD tags, one geometry each (only the working agent's is shown) */
  const hud = Array.from({ length: HUD_COUNT }, (_, i) => {
    const H = new LabelBuilder(text.rects);
    const tl = PANELS[0].at(0, 0);
    H.add(`hud${i}`, [tl[0], 1.89, tl[2]], FACE_R, UP, 0.1, { layer: 4, tone: i < 7 ? TONE.VIOLET : TONE.HOT });
    return H.build();
  });

  /* the docs page, the live app, the screens */
  const panelGeos = PANELS.map((_, i) => panelGeometry(PANEL_W, PANEL_H, ui.cells.screens[i], ui.size, 0));
  const docGeo = panelGeometry(DOC_W, DOC_H, ui.cells.doc, ui.size, 2);
  const liveGeo = panelGeometry(LIVE_W, LIVE_H, ui.cells.live, ui.size, 1);

  const sweepGeo = new PlaneGeometry(3.9, 2.05);
  const beamGeo = new PlaneGeometry(0.55, RING_Y - MODULE_P[1] + 0.3);
  const floorGeo = new PlaneGeometry(60, 60);
  const shieldGeo = new SphereGeometry(1, 72, 28, 0, Math.PI * 2, 0, Math.PI / 2);

  return {
    textTex: text.tex, uiTex: ui.tex,
    lineA: A.build(), labelA: LA.build(), lineB: B.build(), labelB: LB.build(), lineC: C.build(), labelC: LC.build(), hud,
    panelGeos, docGeo, liveGeo, shieldGeo, sweepGeo, beamGeo, floorGeo, ports,
  };
}

/* ── materials per theme (the only place the themes differ, with the glow opacities in the frame loop) ── */

interface Tex { glow: Texture }

function makeMats(light: boolean, b: Built, tx: Tex) {
  const sprite = (color: string, opacity: number) =>
    new SpriteMaterial({
      map: tx.glow, color: new Color(color), opacity, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false,
      blending: light ? NormalBlending : AdditiveBlending,
    });
  /** a glow sprite: additive light in the dark theme; in daylight the same glow in its colour laid over the canvas */
  const glow = (dark: string, day: string) => sprite(light ? day : dark, 0);
  return {
    lineA: lineMaterial(light), lineB: lineMaterial(light), lineC: lineMaterial(light),
    labelA: labelMaterial(light, b.textTex), labelB: labelMaterial(light, b.textTex),
    panel: panelMaterial(light, b.uiTex), shield: shieldMaterial(light),
    sweep: sweepMaterial(light), beam: beamMaterial(light),
    floor: floorMaterial(light),
    // daylight: no backdrop, only a very faint blue tint near the focal area
    haze: glow("#1E3A9E", "#2E68FF"),
    sweepGlow: glow("#2E68FF", "#2E68FF"),
    glint: glow("#9F86FF", "#7C5CFF"),
    moduleHalo: glow("#2E68FF", "#2E68FF"),
    // the module's white-hot core: saturated blue in daylight
    moduleCore: glow("#FFFFFF", "#1F5BFF"),
    ringGlow: glow("#2E68FF", "#2E68FF"),
    liveHalo: glow("#1F4FD8", "#2E68FF"),
    flagGlow: glow("#FF9A1F", "#FF9A1F"),
    passGlow: glow("#21B67F", "#21B67F"),
    // the data packets' pale cores: saturated blue in daylight
    dot: glow("#CFE0FF", "#1F5BFF"),
  };
}
type Mats = ReturnType<typeof makeMats>;

/* ── the scene ──────────────────────────────────────────────────────────────── */

function Scene({ still, canvas, light, onProgress, onReady, textEdge = 0.56 }: Omit<ConceptSceneProps, "active">) {
  const { camera, size, gl } = useThree();
  const tx: Tex = useMemo(() => ({ glow: makeGlowTexture() }), []);
  const b = useMemo(() => build(), []);
  const m: Mats = useMemo(() => makeMats(light, b, tx), [light, b, tx]);
  useEffect(() => () => {
    tx.glow.dispose();
  }, [tx]);
  useEffect(() => () => {
    b.textTex.dispose();
    b.uiTex.dispose();
    for (const g of [b.lineA, b.labelA, b.lineB, b.labelB, b.lineC, b.labelC, ...b.hud, ...b.panelGeos, b.docGeo, b.liveGeo, b.shieldGeo,
      b.sweepGeo, b.beamGeo, b.floorGeo]) g.dispose();
  }, [b]);
  useEffect(() => () => { for (const v of Object.values(m)) v.dispose(); }, [m]);
  useEffect(() => {
    const [r, g, bb] = canvas.trim().split(/\s+/).map(Number);
    const css = `rgb(${r || 14}, ${g || 15}, ${bb || 19})`;
    (m.floor.uniforms.uBg.value as Color).set(css);
  }, [canvas, m]);

  const S = useMemo(() => newState(), []);
  const structure = useRef<Group>(null);
  const moduleG = useRef<Group>(null);
  const sweep = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const docs = useRef<Group>(null);
  const hud = useRef<Group>(null);
  const dots = useRef<Group>(null);
  const live = useRef<Mesh>(null);
  const sweepGlow = useRef<Sprite>(null);
  const glintA = useRef<Sprite>(null);
  const glintB = useRef<Sprite>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const frames = useRef(0);
  const tmp = useMemo(() => ({ v: new Vector3(), target: new Vector3(), res: new Vector2() }), []);

  useEffect(() => {
    if (still) return;
    const h = (e: PointerEvent) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", h, { passive: true });
    return () => window.removeEventListener("pointermove", h);
  }, [still]);

  useFrame((state, dt) => {
    const t = still ? 0 : state.clock.elapsedTime;
    const c = still ? 0 : t % PERIOD;
    const s = still ? composeStill(S) : evaluate(c, S);

    /* camera: framed to the right of the headline, a slow drift and a breath of parallax (one framing for both themes) */
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const narrow = aspect < 1.15;
    const fov = narrow ? 42 : 30;
    const te = Math.min(0.68, Math.max(0.4, textEdge));
    const fc = narrow ? 0.5 : te + (1 - te) * 0.5;
    const hw = narrow ? 0.43 : (1 - te) * 0.5 - 0.03;
    const tanH = Math.tan((fov * Math.PI) / 360);
    let dist = 2.08 / (hw * 2 * tanH * aspect);
    dist = Math.max(dist, 3.6 / (2 * tanH * 0.84));
    const e8 = -(2 * fc - 1);
    const e9 = narrow ? 0.05 : -0.06;
    const p = pointer.current;
    const k = Math.min(1, dt * 1.5);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    const az = AZ0 + Math.sin(t * 0.07) * 0.03 + p.x * 0.045;
    const el = EL0 + Math.sin(t * 0.053) * 0.012 - p.y * 0.02;
    const d = dist * (1 + Math.sin(t * 0.045) * 0.012);
    tmp.target.set(0.22, 1.28, 0.35);
    cam.position.set(tmp.target.x + Math.sin(az) * Math.cos(el) * d, tmp.target.y + Math.sin(el) * d, tmp.target.z + Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(tmp.target);
    if (cam.fov !== fov) cam.fov = fov;
    cam.near = 0.1;
    cam.far = 80;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = e8;
    cam.projectionMatrix.elements[9] = e9;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    /* lines and labels */
    gl.getDrawingBufferSize(tmp.res);
    const px = gl.getPixelRatio();
    for (const lm of [m.lineA, m.lineB, m.lineC]) {
      lm.uniforms.uRes.value.copy(tmp.res);
      lm.uniforms.uPx.value = px;
    }
    const la = m.lineA.uniforms;
    la.uDraw.value = s.draw;
    la.uFade.value = s.structA;
    la.uSweepX.value = s.sweepX;
    la.uSweepA.value = s.sweepA;
    const LA = la.uLayerA.value as number[];
    LA[3] = s.secFlag; LA[4] = s.secLoop; LA[5] = s.secPass;
    const FA = la.uFront.value as number[];
    FA[1] = s.reviewFront; FA[2] = s.testFront;
    const ta = m.labelA.uniforms;
    ta.uDraw.value = s.draw;
    ta.uFade.value = s.structA;
    const TLA = ta.uLayerA.value as number[];
    TLA[3] = s.secFlag; TLA[4] = s.secLoop; TLA[5] = s.secPass;

    const lb = m.lineB.uniforms;
    lb.uDraw.value = s.draw;
    const LB = lb.uLayerA.value as number[];
    LB[0] = s.ring; LB[1] = s.live;
    const tb = m.labelB.uniforms;
    tb.uDraw.value = s.draw;
    const TLB = tb.uLayerA.value as number[];
    TLB[0] = s.ring; TLB[1] = s.livePill * (0.55 + 0.45 * s.pulse); TLB[2] = s.live; TLB[3] = s.gateOpen; TLB[4] = s.agentA;
    m.lineC.uniforms.uFade.value = s.module;

    /* screens, docs, live app */
    const pu = m.panel.uniforms;
    pu.uGlassFront.value = s.glassFront;
    pu.uUiFront.value = s.uiFront;
    pu.uSweepX.value = s.sweepX;
    pu.uSweepA.value = s.sweepA;
    const GA = pu.uGroupA.value as number[];
    GA[0] = s.structA; GA[1] = s.live; GA[2] = s.docs * s.structA;
    pu.uScan.value = s.liveScan;
    pu.uTime.value = t;

    m.shield.uniforms.uRise.value = s.shieldRise;
    m.shield.uniforms.uAlpha.value = s.shieldA * s.structA;
    m.shield.uniforms.uTime.value = t;
    m.sweep.uniforms.uA.value = s.sweepA * s.structA;
    m.sweep.uniforms.uTime.value = t;
    m.beam.uniforms.uA.value = s.beam;
    m.beam.uniforms.uTime.value = t;
    const fu = m.floor.uniforms;
    fu.uSweepX.value = s.sweepX;
    fu.uSweepA.value = s.sweepA * s.structA;

    /* the structure compresses into the module at the release gate */
    if (structure.current) {
      const sc = 1 - 0.94 * s.compress;
      structure.current.scale.setScalar(sc);
      structure.current.position.set(MODULE_P[0] * (1 - sc), MODULE_P[1] * (1 - sc), MODULE_P[2] * (1 - sc));
      structure.current.visible = s.structA > 0.002;
    }
    if (moduleG.current) {
      moduleG.current.visible = s.module > 0.002;
      moduleG.current.position.set(MODULE_P[0], s.moduleY, MODULE_P[2]);
      moduleG.current.scale.setScalar(s.moduleScale * (0.55 + 0.45 * s.module));
      moduleG.current.rotation.y = t * 0.7;
    }
    if (sweep.current) {
      sweep.current.position.x = s.sweepX;
      sweep.current.visible = s.sweepA > 0.002;
    }
    const faceY = Math.atan2(cam.position.x - MODULE_P[0], cam.position.z - MODULE_P[2]);
    if (beam.current) beam.current.rotation.y = faceY;

    /* docs pages fan out like a hand of cards */
    if (docs.current) {
      const n = docs.current.children.length;
      const e = s.docs;
      docs.current.children.forEach((ch, i) => {
        const f = n > 1 ? i / (n - 1) : 0.5;
        const th = (0.62 - 1.24 * f) * e;
        const L = 0.18 + 0.4 * e;
        tmp.v.set(-Math.sin(th) * L, Math.cos(th) * L, 0.012 * i);
        tmp.v.applyAxisAngle(UP_V, AZ0);
        ch.position.set(DOC_PIVOT[0] + tmp.v.x, DOC_PIVOT[1] + tmp.v.y, DOC_PIVOT[2] + tmp.v.z);
        ch.rotation.set(0, AZ0, th);
        ch.visible = e > 0.002;
      });
    }
    if (hud.current) hud.current.children.forEach((ch, i) => { ch.visible = i === s.agent && s.agentA > 0.005; });
    if (live.current) live.current.visible = s.live > 0.002;

    /* data flowing through the API connectors once the Tech lead has built the screens */
    if (dots.current) {
      const on = (s.stage >= 1 && s.stage <= 6 ? 1 : still ? 1 : 0) * s.structA;
      dots.current.children.forEach((ch, i) => {
        const port = b.ports[i % b.ports.length];
        const f = still ? 0.55 : (t * 0.5 + i * 0.37) % 1;
        ch.position.set(port.from[0] + (port.to[0] - port.from[0]) * f, port.from[1] + (port.to[1] - port.from[1]) * f, port.from[2] + (port.to[2] - port.from[2]) * f);
        ch.visible = on > 0.01;
      });
      m.dot.opacity = on * (light ? 0.7 : 0.6);
    }

    /* glows (the fake bloom; daylight: the same glows laid over the canvas, about 0.35-0.6 at their centres) */
    m.haze.opacity = light ? 0.035 + 0.01 * s.structA : 0.2 + 0.06 * s.structA;
    m.sweepGlow.opacity = s.sweepA * s.structA * (light ? 0.36 : 0.24);
    if (sweepGlow.current) sweepGlow.current.position.x = s.sweepX;
    const tw = 0.6 + 0.4 * Math.sin(t * 17.0);
    m.glint.opacity = s.sweepA * s.structA * tw * (light ? 0.55 : 0.9);
    if (glintA.current) glintA.current.position.x = s.sweepX;
    if (glintB.current) glintB.current.position.x = s.sweepX;
    m.moduleHalo.opacity = s.module * (light ? 0.5 : 0.75);
    m.moduleCore.opacity = s.module * (light ? 0.6 : 0.9);
    m.ringGlow.opacity = light ? Math.min(0.6, s.ring * 0.3 + s.ringFlash * 0.45 + s.live * 0.1) : s.ring * 0.22 + s.ringFlash * 0.9 + s.live * 0.12;
    m.liveHalo.opacity = s.live * (light ? 0.32 : 0.3);
    m.flagGlow.opacity = s.secFlag * s.structA * (0.55 + 0.25 * Math.sin(t * 12)) * (light ? 0.5 : 1);
    m.passGlow.opacity = (s.stage === 4 ? s.secPass * 0.5 : still ? 0.2 : 0) * (light ? 0.7 : 1);

    onProgress?.(s.index, s.head);
    frames.current += 1;
    if (frames.current === (still ? 1 : 3)) onReady?.();
  });

  const flagP: V3 = [FLAG_X, 0.18, NODES[3].p[2]];
  /** daylight draw order, or the dark theme's own (0) */
  const ro = (key: keyof typeof RO) => (light ? RO[key] : 0);
  return (
    <>
      <mesh geometry={b.floorGeo} material={m.floor} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -4]} renderOrder={light ? RO.floor : -2} />
      <sprite material={m.haze} position={[0.2, 1.1, -2.4]} scale={[9.5, 4.6, 1]} renderOrder={light ? RO.haze : -1} />

      <group ref={structure}>
        {b.panelGeos.map((g, i) => (
          <mesh key={i} geometry={g} material={m.panel} position={PANELS[i].center} rotation={[0, PANELS[i].ry, 0]} renderOrder={ro("panels")} />
        ))}
        <mesh geometry={b.shieldGeo} material={m.shield} position={[0.02, 0, 1.25]} scale={[1.52, 0.8, 0.98]} renderOrder={ro("shield")} />
        <group ref={docs}>
          {[0, 1, 2, 3, 4, 5].map((i) => <mesh key={i} geometry={b.docGeo} material={m.panel} visible={false} renderOrder={ro("docs")} />)}
        </group>
        <mesh geometry={b.lineA} material={m.lineA} frustumCulled={false} renderOrder={ro("lineA")} />
        <mesh geometry={b.labelA} material={m.labelA} frustumCulled={false} renderOrder={ro("labelA")} />
        <group ref={dots}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <sprite key={i} material={m.dot} scale={[0.045, 0.045, 1]} renderOrder={ro("dots")} />)}
        </group>
        <sprite material={m.flagGlow} position={flagP} scale={[1.3, 1.3, 1]} renderOrder={ro("underGlow")} />
        <sprite material={m.passGlow} position={flagP} scale={[1.2, 1.2, 1]} renderOrder={ro("underGlow")} />
      </group>

      <mesh ref={sweep} geometry={b.sweepGeo} material={m.sweep} position={[0, 1.025, 0.45]} rotation={[0, Math.PI / 2, 0]} visible={false} renderOrder={ro("sweep")} />
      <sprite ref={sweepGlow} material={m.sweepGlow} position={[0, 0.95, 0.45]} scale={[0.9, 2.7, 1]} renderOrder={ro("sweepGlow")} />
      <sprite ref={glintA} material={m.glint} position={[0, 2.05, -1.5]} scale={[0.22, 0.22, 1]} renderOrder={ro("sweepGlow")} />
      <sprite ref={glintB} material={m.glint} position={[0, 2.05, 2.4]} scale={[0.26, 0.26, 1]} renderOrder={ro("sweepGlow")} />

      <group ref={moduleG} visible={false}>
        <sprite material={m.moduleHalo} scale={[1.5, 1.5, 1]} renderOrder={ro("moduleHalo")} />
        <sprite material={m.moduleCore} scale={[0.42, 0.42, 1]} renderOrder={ro("moduleCore")} />
        <mesh geometry={b.lineC} material={m.lineC} frustumCulled={false} renderOrder={ro("lineC")} />
        <mesh geometry={b.labelC} material={m.labelB} frustumCulled={false} renderOrder={ro("labelC")} />
      </group>
      <mesh ref={beam} geometry={b.beamGeo} material={m.beam} position={[MODULE_P[0], (RING_Y + MODULE_P[1]) / 2, MODULE_P[2]]} renderOrder={ro("beam")} />

      <sprite material={m.ringGlow} position={[MODULE_P[0], RING_Y, MODULE_P[2]]} scale={[2.3, 0.9, 1]} renderOrder={ro("ringGlow")} />
      <sprite material={m.liveHalo} position={LIVE_P} scale={[2.8, 1.9, 1]} renderOrder={ro("liveHalo")} />
      <mesh ref={live} geometry={b.liveGeo} material={m.panel} position={LIVE_P} rotation={[0, AZ0, 0]} visible={false} renderOrder={ro("live")} />
      <mesh geometry={b.lineB} material={m.lineB} frustumCulled={false} renderOrder={ro("lineB")} />
      <mesh geometry={b.labelB} material={m.labelB} frustumCulled={false} renderOrder={ro("labelB")} />
      <group ref={hud}>
        {b.hud.map((g, i) => <mesh key={i} geometry={g} material={m.labelB} frustumCulled={false} visible={false} renderOrder={ro("hud")} />)}
      </group>
    </>
  );
}

const UP_V = new Vector3(0, 1, 0);

/** wait (briefly) for the mono font so the labels are painted in it */
function useFontReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const finish = () => { if (live) setReady(true); };
    const timer = window.setTimeout(finish, 1200);
    const fonts = document.fonts;
    if (fonts?.load) Promise.all([fonts.load(`500 44px "JetBrains Mono Variable"`), fonts.load(`600 44px "JetBrains Mono Variable"`), fonts.load(`700 44px "JetBrains Mono Variable"`)]).then(finish, finish);
    else finish();
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  return ready;
}

function Background({ canvas }: { canvas: string }) {
  const bg = useMemo(() => {
    const [r, g, b] = canvas.trim().split(/\s+/).map(Number);
    return new Color(`rgb(${r || 14}, ${g || 15}, ${b || 19})`);
  }, [canvas]);
  return <color attach="background" args={[bg]} />;
}

export default function BlueprintScene({ active, still, canvas, light, onReady, onProgress, textEdge }: ConceptSceneProps) {
  const fontReady = useFontReady();
  return (
    <Canvas
      aria-hidden
      dpr={[1, Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)]}
      frameloop={still ? "demand" : active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [3, 3, 11], fov: 30, near: 0.1, far: 80 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Background canvas={canvas} />
      {fontReady && (
        <Scene key={light ? "light" : "dark"} still={still} canvas={canvas} light={light} onReady={onReady} onProgress={onProgress} textEdge={textEdge} />
      )}
    </Canvas>
  );
}
