/** Foundry: the landing hero as a neon software foundry seen from above (near-isometric, long lens).
 *  The brief's source material lands on the intake and becomes a scoped feature packet. It rides the conveyor through
 *  MADP's scanner gates (plan, code, review, test, security, docs, release); SecOps rejects it, the overhead
 *  return lane carries it back to the Developer, it passes, and at the deploy pad the packets merge into one app tile
 *  that rides a beam up into the SELISE Blocks ring: live. Two more lanes keep packets flowing (many apps in parallel).
 *  Light is faked like the original hero: thin bright cores, wide soft additive sleeves and a floor that dissolves into
 *  the page canvas. The light theme is the same scene, frame and motion photographed in daylight: one composition for
 *  both themes, and only colour, blending and opacity differ. Its cores turn saturated blue, its sleeves, halos and
 *  sprites become a normal-blended blue glow with the same radius and falloff (see `palette` and the INK branches of
 *  the shaders in foundryKit). */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry, type BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh,
  type Material, Matrix4, Mesh, type PerspectiveCamera, PlaneGeometry, ShaderMaterial, type ShaderMaterialParameters, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from "three";
import { legendIndexAt, type ConceptSceneProps } from "../types";
import {
  AZ, BB_VERT, BEAM_FRAG, CAM_F, CAM_R, CAM_U, DIST, EL, FLOOR_FRAG, FLOOR_VERT, GATE_H, GATE_HALF, GLOW_FRAG, INTAKE_X, LABEL_ASPECT,
  LABEL_RECT, LANE_FRAG, LANE_Z, LIVE_ASPECT, LIVE_RECT, MESH_VERT, PAD_FRAG, PAD_X, PERIOD, RADIAL_FRAG, RAIL_FRAG, RAIL_L,
  RET_CURVE, RET_Y, RING_R, RING_Y, SCAN_FRAG, SEG_DEPLOY, SEG_FAIL, SEG_FIX, SEG_PASS, SEG_RET, SEG_RISE, SEGS, STATION_X, STILL_C,
  STILL_INPUT, STILL_LIVE, TARGET, TEX_FRAG, TILE_FRAG, TILE_Y, U, type HeroState, type Palette, type UVal, type Verdict, clamp01,
  ease, fract, gateCurve, glyphRect, heroAt, laneCurve, lerp, makeAtlas, palette, parseCanvas, ribbonGeometry, shader, smooth,
} from "./foundryKit";

/* ── framing: fit the whole floor plan right of the headline and above the legend (both themes) ── */

const FRAME_POINTS: Vector3[] = [
  [INTAKE_X - 1.1, 0, 0], [INTAKE_X, 0, 1.2], [INTAKE_X, 0, -1.2], [INTAKE_X - 0.8, 2.1, 0], [INTAKE_X, 2.3, -0.6],
  [STATION_X[0], GATE_H + 0.75, -GATE_HALF], [STATION_X[0], 0, GATE_HALF + 0.2], [STATION_X[6], GATE_H + 0.75, -GATE_HALF],
  [STATION_X[6], 0, GATE_HALF + 0.2], [STATION_X[1], RET_Y + 0.1, 0], [STATION_X[4], RET_Y + 0.1, 0],
  [PAD_X + 1.3, 0, 0], [PAD_X, 0, 1.3], [PAD_X, 0, -1.3], [PAD_X + 1.3, 0, 1.6], [PAD_X + 1.3, 0, -1.6],
  [PAD_X + 1.3, RING_Y, 0], [PAD_X - 1.3, RING_Y, 0], [PAD_X, RING_Y, 1.3], [PAD_X, RING_Y, -1.3],
].map(([x, y, z]) => new Vector3(x, y, z));
/** the platform label and the LIVE tag sit above the ring */
FRAME_POINTS.push(new Vector3(PAD_X, RING_Y, 0).addScaledVector(CAM_U, 1.75));

/** fov and lens shift; vh the view height (world units) at the target */
interface Framing { fov: number; sx: number; sy: number; vh: number }
function framing(aspect: number, edge: number, hPx: number): Framing {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const d = new Vector3();
  for (const p of FRAME_POINTS) {
    d.copy(p).sub(TARGET);
    // perspective: the near end of the line (the pad) is larger than the far end (the intake)
    const k = DIST / (DIST + d.dot(CAM_F));
    const x = d.dot(CAM_R) * k;
    const y = d.dot(CAM_U) * k;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // narrow: the line spans the stage, behind the headline
  const narrow = aspect < 1.15;
  const L = narrow ? -0.92 : 2 * (Math.min(0.7, Math.max(0.3, edge)) + 0.035) - 1;
  const R = 0.95;
  const top = 0.86;
  const bottom = -1 + (2 * 120) / Math.max(320, hPx);
  const vh = Math.max((2 * (maxX - minX)) / ((R - L) * aspect), (2 * (maxY - minY)) / (top - bottom));
  const fov = (2 * Math.atan(vh / (2 * DIST)) * 180) / Math.PI;
  const sx = (L + R) / 2 - (minX + maxX) / 2 / ((vh * aspect) / 2);
  const sy = (top + bottom) / 2 - (minY + maxY) / 2 / (vh / 2);
  return { fov, sx, sy, vh };
}

/** the brief's source material circles in and settles onto the intake */
function fragPos(o: [number, number, number], p: number, out: Vector3) {
  const left = 1 - p * p;
  const a = (1 - p) * 1.3;
  const ox = o[0] * Math.cos(a) - o[2] * Math.sin(a);
  const oz = o[0] * Math.sin(a) + o[2] * Math.cos(a);
  return out.set(INTAKE_X + ox * left, 0.2 + (o[1] - 0.2) * left, oz * left);
}

/* ── the scene graph, built once per theme ─────────────────────────────────────────────────────── */

const N_PER_LANE = 8;
const LANE_SPEED = 0.95;
const SPARK_FROM: [number, number][] = [[PAD_X - 0.62, 0.38], [PAD_X - 0.62, -0.38], [PAD_X - 1.9, LANE_Z], [PAD_X - 1.9, -LANE_Z]];
/** where the brief's source material drifts in from, relative to the intake */
const FRAG_FROM: [number, number, number][] = [[-1.9, 1.5, 0.3], [-1.1, 2.1, 1.2], [-0.4, 1.7, -1.3], [-2.2, 0.9, 1.1], [-0.2, 2.3, 0.5]];
/** the floor plate around the line (world xz: its centre and half size) */
const PLAT_C = new Vector2((INTAKE_X - 1.3 + PAD_X + 1.3) / 2, 0);
const PLAT_H = new Vector2((PAD_X + 1.3 - (INTAKE_X - 1.3)) / 2, 1.6);

function buildKit(ink: boolean, P: Palette) {
  const G = P.glowK;
  const bin: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    bin.push(x);
    return x;
  };
  const root = new Group();
  const put = (geo: BufferGeometry, mat: Material, order: number) => {
    const m = new Mesh(geo, mat);
    m.renderOrder = order;
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  const S = (vert: string, frag: string, u: Record<string, UVal>, extra?: ShaderMaterialParameters) => keep(shader(ink, vert, frag, u, extra));
  /** light only: how strongly a part's light reads on the light canvas (an opacity; see INK in foundryKit) */
  const L = (v: number): Record<string, UVal> => (ink ? { uL: v } : {});
  const flat = { side: DoubleSide } as const;
  const atlas = keep(makeAtlas(ink));
  const quad = keep(new PlaneGeometry(1, 1));
  /** draw order by theme: on the light canvas a glow lies under the parts it surrounds (normal blending covers what was
   *  drawn before); additive light on dark does not care */
  const lo = (dark: number, light: number) => (ink ? light : dark);

  /* the floor */
  const floorMat = keep(new ShaderMaterial({
    uniforms: U({ uBg: new Color(), uGrid: P.grid, uGlow: P.deep, uRes: new Vector2(1, 1), uEdge: 0.56, uPlatC: PLAT_C, uPlatH: PLAT_H }),
    vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, defines: ink ? { INK: "" } : {}, toneMapped: false, depthWrite: false,
  }));
  const floor = put(keep(new PlaneGeometry(260, 260)), floorMat, 0);
  floor.rotation.x = -Math.PI / 2;

  /* a breath of blue haze over the line (light: a very faint tint) */
  const haze = put(quad, S(BB_VERT, RADIAL_FRAG, { uColor: P.deep, uI: 0.07, uCore: 0, ...L(0.16) }), lo(1, 0.5));
  haze.position.set(0.5, 1.2, 0);
  haze.scale.set(26, 13, 1);

  /* the lanes */
  const lanes = ([0, 1, -1] as const).map((side) => {
    const curve = laneCurve(side);
    const len = curve.getLength();
    const mat = S(MESH_VERT, LANE_FRAG, {
      uColor: P.blue, uHot: P.hot, uI: side === 0 ? 1 : 0.6, uLen: len, uTime: 0, uSpeed: LANE_SPEED, uHead: -10, uHeadI: 0, uDone: 0,
      ...(ink ? { uRail: RAIL_L } : {}),
    }, flat);
    put(keep(ribbonGeometry(curve, 0.62, side === 0 ? 4 : 240)), mat, 1);
    return { curve, len, mat, x0: curve.getPointAt(0).x };
  });

  /* the scanner gates, one per stage */
  const gc = gateCurve();
  const gateCore = keep(new TubeGeometry(gc, 200, 0.011, 6, false));
  const gateSleeve = keep(new TubeGeometry(gc, 200, 0.07, 10, false));
  const sheetGeo = keep(new PlaneGeometry(GATE_HALF * 2 - 0.05, GATE_H - 0.04));
  const sillGeo = keep(new PlaneGeometry(0.04, GATE_HALF * 2 + 0.24));
  const poolGeo = keep(new PlaneGeometry(2.3, 3.4));
  const stations = STATION_X.map((x, k) => {
    const poolM = S(MESH_VERT, RADIAL_FRAG, { uColor: P.deep, uI: 0.05 * G, uCore: 0, ...L(0.45) }, flat);
    const pool = put(poolGeo, poolM, lo(1, 0.6));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.002, 0);
    const sillM = S(MESH_VERT, GLOW_FRAG, { uColor: P.pale, uI: 0.3, uSoft: 0 }, flat);
    const sill = put(sillGeo, sillM, 1);
    sill.rotation.x = -Math.PI / 2;
    sill.position.set(x, 0.005, 0);
    const sheetM = S(MESH_VERT, SCAN_FRAG, { uColor: P.hot, uIdle: P.pale, uScanY: 0, uScanI: 0, uIdleY: 0.5, uIdleI: 0.2 }, flat);
    const sheet = put(sheetGeo, sheetM, 2);
    sheet.rotation.y = Math.PI / 2;
    sheet.position.set(x, GATE_H / 2, 0);
    const coreM = S(MESH_VERT, GLOW_FRAG, { uColor: P.pale, uI: 0.45, uSoft: 0 });
    put(gateCore, coreM, 2).position.x = x;
    const sleeveM = S(MESH_VERT, GLOW_FRAG, { uColor: P.deep, uI: 0.08 * G, uSoft: 1 });
    put(gateSleeve, sleeveM, lo(2, 1.8)).position.x = x;
    const glyphM = S(BB_VERT, TEX_FRAG, { uMap: atlas, uRect: glyphRect(k, 0), uColor: P.label, uI: 0.6 });
    const glyph = put(quad, glyphM, 6);
    glyph.position.set(x, GATE_H + 0.44, 0);
    const scans = SEGS.filter((s) => s.kind === "scan" && s.k === k);
    return { x, k, poolM, sillM, sheetM, coreM, sleeveM, glyphM, glyph, scans, first: scans[0] };
  });

  /* the overhead return lane */
  const retCore = S(MESH_VERT, RAIL_FRAG, { uColor: P.pale, uHot: P.amber, uI: 0.25, uHead: -1, uHeadI: 0, uSoft: 0, uDash: 1 });
  const retSleeve = S(MESH_VERT, RAIL_FRAG, { uColor: P.deep, uHot: P.red, uI: 0.06 * G, uHead: -1, uHeadI: 0, uSoft: 1, uDash: 0 });
  put(keep(new TubeGeometry(RET_CURVE, 260, 0.009, 6, false)), retCore, 2);
  put(keep(new TubeGeometry(RET_CURVE, 260, 0.055, 8, false)), retSleeve, lo(2, 1.8));

  /* the intake and the brief's source material */
  const intakeM = S(MESH_VERT, PAD_FRAG, { uColor: P.pale, uHot: P.violet, uI: 0.5, uR: 1.15, uSpin: 0, uRip: 0, uRipA: 0, uFill: 0.12 }, flat);
  const intake = put(keep(new PlaneGeometry(2.3, 2.3)), intakeM, 1);
  intake.rotation.x = -Math.PI / 2;
  intake.position.set(INTAKE_X, 0.003, 0);
  const intakeGlowM = S(BB_VERT, RADIAL_FRAG, { uColor: P.violet, uI: 0, uCore: 0.15 });
  const intakeGlow = put(quad, intakeGlowM, lo(4, 0.8));
  intakeGlow.position.set(INTAKE_X, 0.35, 0);
  intakeGlow.scale.setScalar(2.4);
  const frags = FRAG_FROM.map((o, i) => {
    const iconM = S(BB_VERT, TEX_FRAG, { uMap: atlas, uRect: glyphRect(i, 1), uColor: P.label, uI: 0 });
    const glowM = S(BB_VERT, RADIAL_FRAG, { uColor: P.blue, uI: 0, uCore: 0 });
    return { o, glowM, iconM, glow: put(quad, glowM, lo(4, 5)), icon: put(quad, iconM, 6) };
  });

  /* the hero packet */
  const tileGeo = keep(new BoxGeometry(0.4, 0.1, 0.4));
  const heroM = S(MESH_VERT, TILE_FRAG, { uColor: P.hot, uHot: P.white, uI: 1, uFill: 0.16 });
  const hero = put(tileGeo, heroM, 3);
  const heroGlowM = S(BB_VERT, RADIAL_FRAG, { uColor: P.pale, uI: 0.6 * G, uCore: 0.22 });
  const heroGlow = put(quad, heroGlowM, lo(4, 2.5));
  const heroPoolM = S(MESH_VERT, RADIAL_FRAG, { uColor: P.blue, uI: 0, uCore: 0, ...L(0.45) }, flat);
  const heroPool = put(quad, heroPoolM, lo(1, 0.6));
  heroPool.rotation.x = -Math.PI / 2;

  /* the other packets, on the outer lanes */
  const N = N_PER_LANE * 2;
  const tileGeoB = keep(new BoxGeometry(0.4, 0.1, 0.4));
  const aT = new Float32Array(N);
  const aTattr = new InstancedBufferAttribute(aT, 1);
  aTattr.setUsage(DynamicDrawUsage);
  tileGeoB.setAttribute("aI", aTattr);
  const tiles = keep(new InstancedMesh(tileGeoB, S(MESH_VERT, TILE_FRAG, { uColor: P.pale, uHot: P.hot, uI: 1, uFill: 0.1 }), N));
  const glowGeoB = keep(new PlaneGeometry(1, 1));
  const aG = new Float32Array(N);
  const aGattr = new InstancedBufferAttribute(aG, 1);
  aGattr.setUsage(DynamicDrawUsage);
  glowGeoB.setAttribute("aI", aGattr);
  const glows = keep(new InstancedMesh(glowGeoB, S(BB_VERT, RADIAL_FRAG, { uColor: P.blue, uI: 0.45 * G, uCore: 0.12, ...L(0.6) }), N));
  for (const [im, order] of [[tiles, 3], [glows, lo(4, 2.5)]] as const) {
    im.instanceMatrix.setUsage(DynamicDrawUsage);
    im.frustumCulled = false;
    im.renderOrder = order;
    root.add(im);
  }

  /* the deploy pad, the merge sparks, the beam, the SELISE Blocks ring, the app */
  const padM = S(MESH_VERT, PAD_FRAG, { uColor: P.pale, uHot: P.hot, uI: 0.55, uR: 1.3, uSpin: 0, uRip: 0, uRipA: 0, uFill: 0.1 }, flat);
  const pad = put(keep(new PlaneGeometry(2.6, 2.6)), padM, 1);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(PAD_X, 0.003, 0);
  const padGlowM = S(BB_VERT, RADIAL_FRAG, { uColor: P.blue, uI: 0.25 * G, uCore: 0.08 });
  const padGlow = put(quad, padGlowM, lo(4, 0.8));
  padGlow.position.set(PAD_X, 0.25, 0);
  padGlow.scale.setScalar(2.8);
  const sparks = SPARK_FROM.map(() => {
    const m = S(BB_VERT, RADIAL_FRAG, { uColor: P.pale, uI: 0, uCore: 0.45, ...(ink ? { uWhite: 1 } : {}) });
    return { m, o: put(quad, m, 4) };
  });
  const beamM = S(MESH_VERT, BEAM_FRAG, { uColor: P.deep, uHot: P.hot, uI: 0.14, uTime: 0 }, flat);
  const beam = put(keep(new PlaneGeometry(1.0, RING_Y)), beamM, lo(2, 2.2));
  beam.position.set(PAD_X, RING_Y / 2, 0);
  const ringCoreM = S(MESH_VERT, GLOW_FRAG, { uColor: P.pale, uI: 0.5, uSoft: 0 });
  const ringSleeveM = S(MESH_VERT, GLOW_FRAG, { uColor: P.deep, uI: 0.1 * G, uSoft: 1 });
  for (const [geo, m, order] of [[keep(new TorusGeometry(RING_R, 0.012, 6, 140)), ringCoreM, 2], [keep(new TorusGeometry(RING_R, 0.075, 10, 140)), ringSleeveM, lo(2, 1.8)]] as const) {
    const o = put(geo, m, order);
    o.rotation.x = Math.PI / 2;
    o.position.set(PAD_X, RING_Y, 0);
  }
  const ringDiscM = S(MESH_VERT, PAD_FRAG, { uColor: P.pale, uHot: P.hot, uI: 0.32, uR: 1.3, uSpin: 0, uRip: 0, uRipA: 0, uFill: 0 }, flat);
  const ringDisc = put(keep(new PlaneGeometry(2.6, 2.6)), ringDiscM, 1);
  ringDisc.rotation.x = -Math.PI / 2;
  ringDisc.position.set(PAD_X, RING_Y, 0);
  const appM = S(MESH_VERT, TILE_FRAG, { uColor: P.hot, uHot: P.white, uI: 0, uFill: 0.2 });
  const app = put(keep(new BoxGeometry(0.66, 0.14, 0.66)), appM, 3);
  const appGlowM = S(BB_VERT, RADIAL_FRAG, { uColor: P.pale, uI: 0, uCore: 0.2 });
  const appGlow = put(quad, appGlowM, lo(4, 2.5));
  const liveM = S(BB_VERT, TEX_FRAG, { uMap: atlas, uRect: LIVE_RECT, uColor: P.label, uI: 0 });
  const live = put(quad, liveM, 6);
  const labelM = S(BB_VERT, TEX_FRAG, { uMap: atlas, uRect: LABEL_RECT, uColor: P.label, uI: 0.45 });
  const label = put(quad, labelM, 6);

  return {
    root, floorMat, haze, lanes, stations, retCore, retSleeve, intakeM, intakeGlowM, frags,
    hero, heroM, heroGlow, heroGlowM, heroPool, heroPoolM, tiles, glows, aT, aTattr, aG, aGattr,
    padM, padGlowM, sparks, beam, beamM, ringCoreM, ringSleeveM, ringDiscM, app, appM, appGlow, appGlowM,
    live, liveM, label, labelM,
    dispose: () => bin.forEach((x) => x.dispose()),
  };
}

/* ── the scene ─────────────────────────────────────────────────────────────────────────────────── */

function Scene({ still, canvas, light, onReady, onProgress, textEdge = 0.56 }: Omit<ConceptSceneProps, "active">) {
  const { camera, size, gl } = useThree();
  const P = useMemo(() => palette(light), [light]);
  const kit = useMemo(() => buildKit(light, P), [light, P]);
  useEffect(() => () => kit.dispose(), [kit]);
  const bg = useMemo(() => parseCanvas(canvas, light), [canvas, light]);
  const fr = useMemo(() => framing(size.width / Math.max(1, size.height), textEdge, size.height), [size.width, size.height, textEdge]);

  const H = useRef<HeroState>({ x: INTAKE_X, y: TILE_Y, scale: 1, vis: 1, head: 0, seg: SEGS[0], p: 0 }).current;
  const tmp = useMemo(() => ({ v: new Vector3(), m: new Matrix4(), tint: new Color() }), []);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const frames = useRef(0);

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
    const time = still ? 0 : state.clock.elapsedTime;
    const c = still ? STILL_C : time % PERIOD; // the hero packet's moment
    const cl = still ? STILL_LIVE : c; // the deploy / live layer (in the still: the previous app, already live)
    const ci = still ? STILL_INPUT : c; // the input layer (in the still: the next brief's material arriving)
    const { v, m, tint } = tmp;
    const G = P.glowK;
    heroAt(c, H);

    /* camera: a slow drift and a breath of pointer parallax around the fixed framing */
    const cam = camera as PerspectiveCamera;
    const pt = pointer.current;
    const k = Math.min(1, dt * 1.5);
    pt.x += (pt.tx - pt.x) * k;
    pt.y += (pt.ty - pt.y) * k;
    const az = AZ + Math.sin(time * 0.071) * 0.014 + pt.x * 0.018;
    const el = EL + Math.sin(time * 0.053) * 0.008 - pt.y * 0.01;
    const dist = DIST * (1 + Math.sin(time * 0.047) * 0.012);
    cam.position.set(TARGET.x + dist * Math.sin(az) * Math.cos(el), TARGET.y + dist * Math.sin(el), TARGET.z + dist * Math.cos(az) * Math.cos(el));
    cam.lookAt(TARGET);
    if (cam.fov !== fr.fov) cam.fov = fr.fov;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -fr.sx;
    cam.projectionMatrix.elements[9] = -fr.sy;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const wpp = fr.vh / Math.max(1, size.height); // world units per CSS pixel at the floor plan

    /* floor */
    const fu = kit.floorMat.uniforms;
    fu.uBg.value.copy(bg);
    fu.uRes.value.set(gl.domElement.width, gl.domElement.height);
    fu.uEdge.value = textEdge;

    /* passed gates stay softly lit and relax before the next run */
    const reset = 1 - smooth(PERIOD - 1.4, PERIOD - 0.3, c);

    /* the gates */
    for (const s of kit.stations) {
      let act = 0;
      let verdict: Verdict = "ok";
      let sp = -1;
      for (const g of s.scans) {
        const local = c - g.t0;
        if (local < 0) continue;
        const dur = g.t1 - g.t0;
        const e = local < dur ? smooth(0, 0.08, local) : Math.exp(-(local - dur) / 0.3);
        if (e > act) {
          act = e;
          verdict = g.v;
          sp = local < dur ? local / dur : 1;
        }
      }
      const done = smooth(s.first.t1, s.first.t1 + 0.3, c) * reset;
      const lands = sp < 0 ? 0 : smooth(0.5, 0.58, sp);
      tint.copy(P.hot);
      const glow = Math.min(1, act * 1.2);
      if (verdict === "fail") tint.lerp(P.red, lands);
      else if (verdict === "pass") tint.lerp(P.green, lands);
      else if (verdict === "fix") tint.lerp(P.violet, 0.8);
      const hue = smooth(0, 0.22, act); // the verdict colour holds while the light fades
      s.coreM.uniforms.uI.value = 0.42 + done * 0.16 + act * 1.0;
      (s.coreM.uniforms.uColor.value as Color).copy(P.pale).lerp(tint, hue);
      s.sleeveM.uniforms.uI.value = (0.07 + done * 0.04 + act * 0.4) * G;
      (s.sleeveM.uniforms.uColor.value as Color).copy(P.deep).lerp(tint, hue);
      s.sheetM.uniforms.uScanY.value = sp < 0 ? 0 : 1 - ease(sp / 0.62);
      s.sheetM.uniforms.uScanI.value = act;
      (s.sheetM.uniforms.uColor.value as Color).copy(tint);
      s.sheetM.uniforms.uIdleY.value = 0.5 + 0.47 * Math.sin(time * 1.25 + s.k * 0.85);
      s.sheetM.uniforms.uIdleI.value = 0.2 * (1 - glow);
      s.sillM.uniforms.uI.value = 0.26 + done * 0.16 + act * 0.9;
      (s.sillM.uniforms.uColor.value as Color).copy(P.pale).lerp(tint, hue);
      s.poolM.uniforms.uI.value = (0.05 + done * 0.03 + act * 0.2) * G;
      (s.poolM.uniforms.uColor.value as Color).copy(P.deep).lerp(tint, hue * 0.8);
      s.glyphM.uniforms.uI.value = 0.5 + done * 0.2 + act * 0.45;
      const gs = Math.min(36, Math.max(24, 0.5 / wpp)) * wpp;
      s.glyph.scale.set(gs, gs, 1);
    }

    /* the hero packet: blue-white, violet while the agent fixes it, red when SecOps rejects it, green when it passes */
    const dF = SEG_FAIL.t1 - SEG_FAIL.t0;
    const dX = SEG_FIX.t1 - SEG_FIX.t0;
    const dP = SEG_PASS.t1 - SEG_PASS.t0;
    const fail = smooth(SEG_FAIL.t0 + 0.55 * dF, SEG_FAIL.t0 + 0.66 * dF, c) * (1 - smooth(SEG_FIX.t0 + 0.2 * dX, SEG_FIX.t0 + 0.75 * dX, c));
    const fix = smooth(SEG_FIX.t0, SEG_FIX.t0 + 0.12, c) * (1 - smooth(SEG_FIX.t1 - 0.05, SEG_FIX.t1 + 0.3, c));
    const pass = smooth(SEG_PASS.t0 + 0.55 * dP, SEG_PASS.t0 + 0.66 * dP, c) * (1 - smooth(SEG_PASS.t1 + 0.05, SEG_PASS.t1 + 0.55, c));
    const scanning = H.seg.kind === "scan" && (H.seg.v === "ok" || H.seg.v === "quick");
    const flash = scanning ? smooth(0.45, 0.62, H.p) * (1 - smooth(0.7, 1, H.p)) : 0;
    const onFloor = 1 - smooth(0.12, 0.7, H.y);
    const riding = H.seg.kind === "ret";
    const alarm = fail * (0.55 + 0.45 * Math.sin(time * 15));
    tint.copy(P.hot).lerp(P.violet, fix * 0.85).lerp(P.red, fail).lerp(P.green, pass * 0.9);
    (kit.heroM.uniforms.uColor.value as Color).copy(tint);
    // its rim runs hotter: toward white on dark; on light it keeps the state's colour (toward the hot blue, red would
    // turn purple)
    const heroHot = (kit.heroM.uniforms.uHot.value as Color).copy(tint);
    if (!light) heroHot.lerp(P.white, 0.5);
    kit.heroM.uniforms.uI.value = (0.95 + flash * 0.6 + alarm * 0.4) * H.vis;
    kit.hero.position.set(H.x, H.y, 0);
    kit.hero.scale.setScalar(H.scale);
    kit.heroGlow.position.set(H.x, H.y + 0.03, 0);
    kit.heroGlow.scale.setScalar((1.25 + flash * 0.35 + alarm * 0.35) * H.scale);
    (kit.heroGlowM.uniforms.uColor.value as Color).copy(P.pale).lerp(tint, 0.6 + fail * 0.4);
    kit.heroGlowM.uniforms.uI.value = (0.5 + flash * 0.45 + alarm * 0.55 + pass * 0.3) * G * H.vis;
    kit.heroPool.position.set(H.x, 0.004, 0);
    kit.heroPool.scale.set(1.7, 1.7, 1);
    (kit.heroPoolM.uniforms.uColor.value as Color).copy(P.blue).lerp(tint, 0.5);
    kit.heroPoolM.uniforms.uI.value = 0.28 * G * H.vis * onFloor * H.scale;
    if (light) {
      // the hero is the lane's pulse head, white-hot on dark: in its hot state (and in every flash) a tiny white centre
      // in the blue tile; a verdict colour stays solid
      kit.heroM.uniforms.uWhite.value = Math.max(flash, 1 - Math.min(1, fail + fix + pass));
      // on the overhead lane it passes in front of the chips (on the light canvas a later draw covers an earlier one)
      kit.hero.renderOrder = riding ? 6.6 : 3;
      kit.heroGlow.renderOrder = riding ? 6.5 : 2.5;
    }

    /* the hero's lane carries its light; what it has travelled stays lit (and shrinks back when it is sent back) */
    const laneA = kit.lanes[0];
    let headI = H.vis * onFloor;
    if (H.seg.kind === "form") headI *= smooth(0.7, 1, H.p);
    laneA.mat.uniforms.uHead.value = H.x - laneA.x0;
    laneA.mat.uniforms.uHeadI.value = headI;
    (laneA.mat.uniforms.uHot.value as Color).copy(tint);
    laneA.mat.uniforms.uDone.value = 0.6 * reset * smooth(SEGS[1].t0, SEGS[1].t0 + 0.4, c);
    for (const ln of kit.lanes) ln.mat.uniforms.uTime.value = time;

    /* the return lane lights up while it carries the rejected packet */
    const rAct = smooth(SEG_RET.t0 - 0.2, SEG_RET.t0 + 0.1, c) * (1 - smooth(SEG_RET.t1, SEG_RET.t1 + 0.5, c));
    kit.retCore.uniforms.uHead.value = riding ? ease(H.p) : -1;
    kit.retCore.uniforms.uHeadI.value = riding ? 1 : 0;
    kit.retCore.uniforms.uI.value = 0.24 + rAct * 0.55;
    (kit.retCore.uniforms.uColor.value as Color).copy(P.pale).lerp(P.amber, rAct * 0.7);
    kit.retSleeve.uniforms.uI.value = (0.05 + rAct * 0.22) * G;
    kit.retSleeve.uniforms.uHead.value = riding ? ease(H.p) : -1;
    kit.retSleeve.uniforms.uHeadI.value = riding ? 1 : 0;

    /* the other packets: a steady stream on the outer lanes, brightening as each gate scans them */
    for (let L = 0; L < 2; L++) {
      const lane = kit.lanes[L + 1];
      for (let i = 0; i < N_PER_LANE; i++) {
        const idx = L * N_PER_LANE + i;
        const s = fract((time * LANE_SPEED) / lane.len + i / N_PER_LANE + L * 0.43);
        lane.curve.getPointAt(s, v);
        let bump = 0;
        for (let g = 0; g < STATION_X.length; g++) {
          const d = v.x - STATION_X[g];
          bump = Math.max(bump, Math.exp(-d * d * 20));
        }
        const f = smooth(0, 0.05, s) * (1 - smooth(0.9, 0.985, s));
        m.makeScale(0.78, 0.78, 0.78);
        m.setPosition(v.x, TILE_Y * 0.78, v.z);
        kit.tiles.setMatrixAt(idx, m);
        kit.aT[idx] = f * (0.4 + bump * 0.7);
        m.makeScale(0.85, 0.85, 0.85);
        m.setPosition(v.x, 0.06, v.z);
        kit.glows.setMatrixAt(idx, m);
        kit.aG[idx] = f * (0.3 + bump * 0.6);
      }
    }
    kit.tiles.instanceMatrix.needsUpdate = true;
    kit.glows.instanceMatrix.needsUpdate = true;
    kit.aTattr.needsUpdate = true;
    kit.aGattr.needsUpdate = true;

    /* the intake: the brief's material drifts in, the factory reads it (a violet breath) and the packet is born */
    const absorb = smooth(0.8, 1.15, ci) * (1 - smooth(1.35, 2.1, ci));
    kit.intakeM.uniforms.uSpin.value = time * 0.04;
    kit.intakeM.uniforms.uI.value = 0.45 + absorb * 0.75;
    (kit.intakeM.uniforms.uColor.value as Color).copy(P.pale).lerp(P.violet, absorb * 0.6);
    kit.intakeGlowM.uniforms.uI.value = (0.1 + absorb * 0.65) * G;
    kit.frags.forEach((f, i) => {
      const t0 = 0.02 + i * 0.09;
      const t1 = 1.08 + i * 0.05;
      const p = clamp01((ci - t0) / (t1 - t0));
      const vis = ci < t0 || ci > t1 ? 0 : smooth(0, 0.2, p) * (1 - smooth(0.8, 1, p));
      fragPos(f.o, p, f.icon.position);
      f.glow.position.copy(f.icon.position);
      const px = 34 * (1 - 0.45 * p) * wpp;
      f.icon.scale.set(px, px, 1);
      f.glow.scale.setScalar(px * 2.3);
      f.iconM.uniforms.uI.value = vis * 0.95;
      f.glowM.uniforms.uI.value = vis * 0.4 * G;
    });

    /* deploy: four packets fly in and merge with the hero into one app tile, the pad runs its smoke test */
    const D = SEG_DEPLOY;
    const dd = D.t1 - D.t0;
    const dl = cl - D.t0;
    const deployAct = smooth(D.t0 - 0.25, D.t0 + 0.1, cl) * (1 - smooth(SEG_RISE.t1, SEG_RISE.t1 + 0.9, cl));
    kit.padM.uniforms.uI.value = 0.5 + deployAct * 0.7;
    kit.padM.uniforms.uSpin.value = time * 0.05;
    const q = (dl - 0.42 * dd) / 0.85;
    kit.padM.uniforms.uRip.value = 0.3 + clamp01(q) * 1.3;
    kit.padM.uniforms.uRipA.value = q > 0 && q < 1 ? (1 - q) * 0.9 : 0;
    kit.padGlowM.uniforms.uI.value = (0.22 + deployAct * 0.4) * G;
    kit.sparks.forEach((sk, j) => {
      const sp = clamp01(dl / (0.5 * dd));
      const vis = dl > 0 && dl < 0.5 * dd ? smooth(0, 0.25, sp) * (1 - smooth(0.85, 1, sp)) : 0;
      const e = sp * sp;
      const [sx, sz] = SPARK_FROM[j];
      sk.o.position.set(lerp(sx, PAD_X, e), 0.1 + 0.06 * Math.sin(sp * Math.PI), lerp(sz, 0, e));
      sk.o.scale.setScalar(0.62);
      sk.m.uniforms.uI.value = vis * 0.9;
    });

    /* the app: forms on the pad, rides the beam up, docks in SELISE Blocks and goes live */
    const Rs = SEG_RISE;
    const formAt = D.t0 + 0.3 * dd;
    const end = 1 - smooth(PERIOD - 0.95, PERIOD - 0.1, cl);
    let ay = TILE_Y + 0.04;
    let as = 0;
    let av = 0;
    if (cl >= formAt) {
      av = end;
      if (cl < Rs.t0) as = smooth(formAt, D.t0 + 0.78 * dd, cl);
      else if (cl < Rs.t1) {
        as = 1;
        ay = lerp(TILE_Y + 0.04, RING_Y, ease((cl - Rs.t0) / (Rs.t1 - Rs.t0)));
      } else {
        as = 1;
        ay = RING_Y + Math.sin(time * 1.6) * 0.03;
      }
    }
    const since = cl - Rs.t1;
    const flare = since >= 0 ? Math.exp(-since / 0.6) : 0;
    const liveOn = since >= 0 ? smooth(0, 0.35, since) * end : 0;
    kit.app.position.set(PAD_X, ay, 0);
    kit.app.scale.setScalar(Math.max(0.001, as));
    kit.app.rotation.y = time * 0.45;
    kit.appGlow.position.set(PAD_X, ay + 0.04, 0);
    kit.appGlow.scale.setScalar(1.5 + flare * 1.2);
    const riseA = smooth(Rs.t0 - 0.1, Rs.t0 + 0.15, cl) * (1 - smooth(Rs.t1, Rs.t1 + 0.7, cl));
    kit.beamM.uniforms.uTime.value = time;
    kit.beam.rotation.y = Math.atan2(cam.position.x - PAD_X, cam.position.z);
    kit.ringDiscM.uniforms.uSpin.value = -time * 0.03;
    kit.appM.uniforms.uI.value = av * (1 + flare * 0.5);
    kit.appGlowM.uniforms.uI.value = av * as * (0.55 + flare * 0.6) * G;
    kit.beamM.uniforms.uI.value = 0.13 + riseA * 0.95 + liveOn * 0.28;
    kit.ringCoreM.uniforms.uI.value = 0.45 + flare * 1.3 + liveOn * 0.3;
    (kit.ringCoreM.uniforms.uColor.value as Color).copy(P.pale).lerp(P.hot, Math.min(1, flare + liveOn * 0.5));
    kit.ringSleeveM.uniforms.uI.value = (0.1 + flare * 0.5 + liveOn * 0.12) * G;
    kit.ringDiscM.uniforms.uI.value = 0.3 + liveOn * 0.35 + flare * 0.6;
    if (light) kit.appM.uniforms.uWhite.value = 1; // the live app is white-hot on dark: a tiny white centre in it

    /* the platform label above the ring and the LIVE tag above it, at a fixed legible size */
    const tagH = 26 * wpp;
    const labH = 20 * wpp;
    v.set(PAD_X, RING_Y, 0).addScaledVector(CAM_U, RING_R * Math.sin(EL) + 0.3);
    kit.label.position.copy(v).addScaledVector(CAM_R, labH * LABEL_ASPECT * 0.035).addScaledVector(CAM_U, labH * 0.5);
    kit.label.scale.set(labH * LABEL_ASPECT, labH, 1);
    kit.live.position.copy(v).addScaledVector(CAM_U, labH + 12 * wpp + tagH * 0.5);
    kit.live.scale.set(tagH * LIVE_ASPECT, tagH, 1);
    kit.liveM.uniforms.uI.value = liveOn;
    kit.labelM.uniforms.uI.value = 0.42 + liveOn * 0.45;

    onProgress?.(legendIndexAt(H.head), clamp01(H.head));
    frames.current += 1;
    if (frames.current === (still ? 1 : 3)) onReady?.();
  });

  return (
    <>
      <color attach="background" args={[bg]} />
      <primitive object={kit.root} />
    </>
  );
}

export default function FoundryScene({ active, still, canvas, light, onReady, onProgress, textEdge }: ConceptSceneProps) {
  return (
    <Canvas
      aria-hidden
      dpr={[1, Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1)]}
      frameloop={still ? "demand" : active ? "always" : "never"}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [30, 27, 24], fov: 20, near: 1, far: 260 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Scene key={light ? "ink" : "light"} still={still} canvas={canvas} light={light} onReady={onReady} onProgress={onProgress} textEdge={textEdge} />
    </Canvas>
  );
}
