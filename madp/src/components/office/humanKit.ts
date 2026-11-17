/** Shared building blocks for the office people: body measurements, geometry (two levels of detail),
 *  cached physically based materials and a curated look per role. Everything is built in code (no
 *  third-party assets). Each geometry and material exists once and is shared by every character; the
 *  characters mount them with dispose={null}, so nothing here is ever disposed. */

import {
  BoxGeometry, type BufferGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, DataTexture, DoubleSide, ExtrudeGeometry, LatheGeometry,
  MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shieldShape } from "./gear";
import type { Role } from "./model";
import { hashOf } from "./palette";

export type Lod = "full" | "lite";

/** Body measurements in world units (about metres). The figure is ~1.75 tall: about 6.5 heads. */
export const BODY = {
  /** hips group (pelvis centre) standing, and seated on a 0.5 m seat */
  hipY: 0.9,
  sitHipY: 0.61,
  /** spine pivot above the hips; neck top (head pivot) and shoulder joints above the spine pivot */
  spineY: 0.1,
  headY: 0.5,
  shoulderY: 0.365,
  shoulderX: [0.188, 0.172] as const,
  hipX: 0.085,
  thigh: 0.4,
  shin: 0.4,
  upperArm: 0.29,
  forearm: 0.26,
  /** torso depth relative to its width (the lathe torso is squashed front to back) */
  torsoDepth: 0.66,
};

/* ── geometry ─────────────────────────────────────────────────────────────── */

const v = (r: number, y: number) => new Vector2(Math.max(1e-4, r), y);

/** a tapered limb hanging from its joint at y 0 to the next joint at y -len, rounded at both ends */
function limb(len: number, r0: number, r1: number, segs: number, cap: number, bulge = 0, at = 0.3): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2); pts.push(v(Math.cos(a) * r1, -len + Math.sin(a) * r1)); }
  if (bulge > 0) pts.push(v((r0 + (r1 - r0) * at) * (1 + bulge), -len * at));
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * (Math.PI / 2); pts.push(v(Math.cos(a) * r0, Math.sin(a) * r0)); }
  return new LatheGeometry(pts, segs);
}

/** torso outlines (radius, height above the spine pivot), bottom to top: 0 broader shoulders, 1 a defined waist */
const TORSO: readonly (readonly [number, number])[][] = [
  [[0, -0.15], [0.12, -0.146], [0.148, -0.1], [0.15, -0.04], [0.146, 0.04], [0.152, 0.12], [0.167, 0.2], [0.177, 0.27], [0.177, 0.32], [0.166, 0.36], [0.141, 0.395], [0.1, 0.426], [0.058, 0.446], [0, 0.452]],
  [[0, -0.15], [0.124, -0.146], [0.156, -0.1], [0.153, -0.05], [0.133, 0.03], [0.137, 0.1], [0.153, 0.18], [0.159, 0.24], [0.156, 0.3], [0.149, 0.35], [0.129, 0.39], [0.095, 0.421], [0.056, 0.441], [0, 0.447]],
];
const torsoRadius = (build: 0 | 1, y: number) => {
  const p = TORSO[build];
  for (let i = 1; i < p.length; i++) if (y <= p[i][1]) { const [r0, y0] = p[i - 1], [r1, y1] = p[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); }
  return 0;
};
/** where the front of the torso is at a height (for placing details on the chest) */
export const chestZ = (build: 0 | 1, y: number) => torsoRadius(build, y) * BODY.torsoDepth;

/** an open-front vest shell over a torso outline (the gap faces +z) */
function vest(build: 0 | 1, segs: number, gap: number): LatheGeometry {
  const pts = TORSO[build].filter(([, y]) => y >= -0.13 && y <= 0.39).map(([r, y]) => v(r * 1.07 + 0.004, y));
  return new LatheGeometry(pts, segs, gap / 2, Math.PI * 2 - gap);
}

/** a short afro-textured crop: a scalp cap with soft curls, merged into one geometry */
function curls(w: number, h: number): BufferGeometry {
  const parts: BufferGeometry[] = [new SphereGeometry(1, w, h, 0, Math.PI * 2, 0, 1.5)];
  const ring = (theta: number, n: number, off: number, r: number) => {
    for (let i = 0; i < n; i++) {
      const phi = off + (i / n) * Math.PI * 2;
      const b = new SphereGeometry(r, Math.max(6, w >> 1), Math.max(4, h >> 1));
      b.translate(-Math.cos(phi) * Math.sin(theta) * 0.97, Math.cos(theta) * 0.97, Math.sin(phi) * Math.sin(theta) * 0.97);
      parts.push(b);
    }
  };
  ring(0.25, 4, 0.3, 0.26);
  ring(0.75, 8, 0, 0.24);
  ring(1.2, 10, 0.2, 0.22);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g ?? parts[0];
}

/** the head: one smooth egg (cranium wider than the chin), squashed a little front to back by the mesh */
const HEAD: readonly (readonly [number, number])[] = [
  [0, -0.024], [0.03, -0.02], [0.052, -0.008], [0.068, 0.008], [0.08, 0.026], [0.09, 0.046], [0.099, 0.068], [0.106, 0.092], [0.111, 0.118],
  [0.112, 0.142], [0.108, 0.168], [0.099, 0.192], [0.083, 0.214], [0.058, 0.232], [0.03, 0.241], [0, 0.244],
];

function buildKit(lod: Lod) {
  const full = lod === "full";
  const R = full ? 18 : 9; // radial segments of the limbs and torso
  const C = full ? 4 : 2; // limb cap rings
  const SW = full ? 28 : 12, SH = full ? 20 : 9; // big spheres
  const BW = full ? 12 : 7, BH = full ? 9 : 5; // small spheres
  return {
    torso: [new LatheGeometry(TORSO[0].map(([r, y]) => v(r, y)), full ? 24 : 10), new LatheGeometry(TORSO[1].map(([r, y]) => v(r, y)), full ? 24 : 10)] as const,
    vest: [vest(0, full ? 24 : 10, 0.62), vest(1, full ? 24 : 10, 0.62)] as const,
    cardigan: [vest(0, full ? 24 : 10, 0.42), vest(1, full ? 24 : 10, 0.42)] as const,
    thigh: limb(BODY.thigh, 0.074, 0.054, R, C),
    shin: limb(BODY.shin, 0.054, 0.04, R, C, 0.14, 0.32),
    upperArm: limb(BODY.upperArm, 0.054, 0.043, R, C, 0.06, 0.35),
    forearm: limb(BODY.forearm, 0.043, 0.032, R, C, 0.08, 0.25),
    head: new LatheGeometry(HEAD.map(([r, y]) => v(r, y)), full ? 32 : 12),
    neck: new CylinderGeometry(0.041, 0.047, 0.13, full ? 14 : 8, 1, true),
    sphere: new SphereGeometry(1, SW, SH),
    ball: new SphereGeometry(1, BW, BH),
    thumb: new CapsuleGeometry(0.012, 0.024, 2, full ? 8 : 5),
    shoe: new CapsuleGeometry(0.047, 0.13, full ? 4 : 2, full ? 12 : 7),
    sole: new RoundedBoxGeometry(0.094, 0.02, 0.215, full ? 2 : 1, 0.009),
    // hair
    cap: new SphereGeometry(1, SW, SH, 0, Math.PI * 2, 0, 1.55),
    capShort: new SphereGeometry(1, SW, SH, 0, Math.PI * 2, 0, 1.38),
    bobShell: new SphereGeometry(1, SW, SH, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0.45, 1.72),
    longShell: new SphereGeometry(1, SW, SH, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0.45, 1.95),
    curls: curls(full ? 20 : 10, full ? 14 : 7),
    tail: new CapsuleGeometry(0.034, 0.16, full ? 4 : 2, full ? 10 : 6),
    tie: new TorusGeometry(0.031, 0.011, 6, full ? 14 : 8),
    // face
    mouth: new TorusGeometry(0.025, 0.0058, 6, 16, Math.PI),
    mouthOpen: new CircleGeometry(0.023, 16, Math.PI, Math.PI),
    brow: new CapsuleGeometry(0.0058, 0.03, 2, 6),
    // garments
    collar: new CylinderGeometry(0.058, 0.07, 0.065, full ? 18 : 10, 1, true),
    rib: new TorusGeometry(0.052, 0.011, 6, full ? 18 : 10),
    cuff: new TorusGeometry(0.046, 0.011, 6, full ? 14 : 8),
    stripe: new CylinderGeometry(1, 1, 0.032, full ? 24 : 10, 1, true, 0.36, Math.PI * 2 - 0.72),
    string: new CylinderGeometry(0.0038, 0.0038, 0.11, 4),
    strap: new BoxGeometry(0.009, 0.17, 0.004),
    collarPoint: new BoxGeometry(0.05, 0.012, 0.04),
    pocket: new RoundedBoxGeometry(0.06, 0.06, 0.012, 1, 0.005),
    zip: new BoxGeometry(0.008, 0.34, 0.004),
    // hats and glasses
    beanie: new SphereGeometry(1, SW, SH, 0, Math.PI * 2, 0, Math.PI * 0.56),
    band: new CylinderGeometry(1, 1, 1, full ? 24 : 12, 1, true),
    board: new BoxGeometry(0.34, 0.016, 0.34),
    rim: new TorusGeometry(0.026, 0.0042, 6, full ? 20 : 10),
    bar: new CylinderGeometry(0.0032, 0.0032, 1, 4),
    cone: new CylinderGeometry(0.004, 0.018, 0.045, 8),
    // props
    clipboard: new RoundedBoxGeometry(0.17, 0.23, 0.012, 2, 0.006),
    paper: new BoxGeometry(0.146, 0.18, 0.003),
    clip: new BoxGeometry(0.06, 0.024, 0.014),
    tablet: new RoundedBoxGeometry(0.17, 0.235, 0.012, 2, 0.008),
    screen: new BoxGeometry(0.148, 0.205, 0.002),
    laptop: new RoundedBoxGeometry(0.32, 0.022, 0.23, 2, 0.008),
    card: new RoundedBoxGeometry(0.056, 0.076, 0.006, 1, 0.004),
    shield: new ExtrudeGeometry(shieldShape(), { depth: 0.022, bevelEnabled: full, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: full ? 10 : 5 }),
    parcel: new RoundedBoxGeometry(0.42, 0.3, 0.3, 2, 0.02),
    blob: new CircleGeometry(0.5, full ? 32 : 16),
  };
}

export type Kit = ReturnType<typeof buildKit>;
const kits = new Map<Lod, Kit>();
export function kit(lod: Lod): Kit {
  let k = kits.get(lod);
  if (!k) { k = buildKit(lod); kits.set(lod, k); }
  return k;
}

/* ── materials ────────────────────────────────────────────────────────────── */

export type Finish = "skin" | "cloth" | "knit" | "hair" | "shoe" | "sole" | "eye" | "gloss" | "metal" | "glow" | "paper" | "plastic" | "reflective";
const FINISH: Record<Finish, { roughness: number; metalness?: number; emissive?: number }> = {
  skin: { roughness: 0.56 }, cloth: { roughness: 0.84 }, knit: { roughness: 0.95 }, hair: { roughness: 0.48 }, shoe: { roughness: 0.42 },
  sole: { roughness: 0.7 }, eye: { roughness: 0.18 }, gloss: { roughness: 0.08 }, metal: { roughness: 0.32, metalness: 0.65 },
  glow: { roughness: 0.35, emissive: 0.75 }, paper: { roughness: 0.92 }, plastic: { roughness: 0.4 }, reflective: { roughness: 0.3, metalness: 0.2, emissive: 0.18 },
};
const mats = new Map<string, MeshStandardMaterial>();

/** Cached material for a colour and finish; never mutate the result. */
export function surface(color: string, finish: Finish, ghost = false): MeshStandardMaterial {
  const key = `${color}|${finish}|${ghost}`;
  let m = mats.get(key);
  if (!m) {
    const f = FINISH[finish];
    m = new MeshStandardMaterial({ color, roughness: f.roughness, metalness: f.metalness ?? 0 });
    if (f.emissive) { m.emissive.set(color); m.emissiveIntensity = f.emissive; }
    if (finish === "hair" || finish === "eye") m.side = DoubleSide;
    if (ghost) { m.transparent = true; m.opacity = 0.45; m.depthWrite = false; }
    mats.set(key, m);
  }
  return m;
}

let catchlight: MeshBasicMaterial | null = null;
/** the tiny white highlight in each eye */
export function catchlightMaterial(): MeshBasicMaterial {
  return (catchlight ??= new MeshBasicMaterial({ color: "#ffffff" }));
}

const blobs = new Map<string, MeshBasicMaterial>();
let blobTexture: DataTexture | null = null;
/** soft contact shadow under each character (a radial falloff; also grounds them where shadow maps are off) */
export function blobMaterial(dark: boolean): MeshBasicMaterial {
  const key = dark ? "dark" : "light";
  let m = blobs.get(key);
  if (!m) {
    if (!blobTexture) {
      const n = 64, data = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const d = Math.min(1, Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2));
        const a = Math.pow(1 - d * d * (3 - 2 * d), 1.4);
        data[(y * n + x) * 4 + 3] = Math.round(a * 255);
      }
      blobTexture = new DataTexture(data, n, n);
      blobTexture.needsUpdate = true;
    }
    m = new MeshBasicMaterial({ map: blobTexture, color: dark ? "#05040c" : "#2a2440", transparent: true, depthWrite: false, opacity: dark ? 0.55 : 0.3,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    blobs.set(key, m);
  }
  return m;
}

/* ── looks ────────────────────────────────────────────────────────────────── */

export type HairStyle = "crop" | "quiff" | "bob" | "ponytail" | "bun" | "curls" | "long";

export interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  /** 0 broader shoulders, 1 a defined waist */
  build: 0 | 1;
  iris: string;
  trousers: string;
  shoes: string;
  sole: string;
}

/** One curated, inclusive look per pipeline agent; extra agents of a role get a varied look from their id. */
const ROLE_LOOK: Partial<Record<Role, Look>> = {
  planner: { skin: "#a8714f", hair: "#22191a", style: "ponytail", build: 1, iris: "#3b2618", trousers: "#2f3550", shoes: "#3a2c26", sole: "#e9e4dc" },
  dev: { skin: "#f0c9a8", hair: "#6e4a2e", style: "quiff", build: 0, iris: "#4f6f8f", trousers: "#3f5578", shoes: "#f3f3f6", sole: "#d8d9e0" },
  reviewer: { skin: "#5d3a27", hair: "#151418", style: "curls", build: 0, iris: "#2a1a12", trousers: "#5b5346", shoes: "#2b2320", sole: "#3a302b" },
  qa: { skin: "#f5d9c4", hair: "#a84f2a", style: "bob", build: 1, iris: "#4d7550", trousers: "#2e3446", shoes: "#f3f3f6", sole: "#c9ccd8" },
  secops: { skin: "#c68a63", hair: "#18161c", style: "long", build: 1, iris: "#3b2618", trousers: "#262a36", shoes: "#1f2029", sole: "#41434f" },
  docs: { skin: "#8a5a3c", hair: "#1d1715", style: "crop", build: 0, iris: "#2e1d14", trousers: "#a69373", shoes: "#4a3426", sole: "#2c211b" },
  shipper: { skin: "#7a4b32", hair: "#1a1414", style: "bun", build: 1, iris: "#2e1d14", trousers: "#2b3040", shoes: "#2a2b33", sole: "#f0f0f2" },
  fixup: { skin: "#e3b48f", hair: "#3b2a20", style: "crop", build: 0, iris: "#3b2618", trousers: "#3a3f52", shoes: "#2a2b33", sole: "#8c8f9c" },
  integrator: { skin: "#b97f5a", hair: "#2b211c", style: "bun", build: 1, iris: "#3b2618", trousers: "#2f3550", shoes: "#2a2b33", sole: "#e9e4dc" },
};

const SKINS = ["#f5d9c4", "#ecc19d", "#d9a47c", "#c68a63", "#a8714f", "#8a5a3c", "#6b4430", "#4f3121"];
const HAIRS = ["#151418", "#2b211c", "#4a3326", "#6e4a2e", "#a84f2a", "#c9a063", "#5d5d66"];
const STYLES: HairStyle[] = ["crop", "quiff", "bob", "ponytail", "bun", "curls", "long"];
const TROUSERS = ["#2f3550", "#3f5578", "#262a36", "#5b5346", "#a69373"];

export function lookFor(role: Role, id: string): Look {
  const base = ROLE_LOOK[role] ?? ROLE_LOOK.dev!;
  const own = id.slice(id.lastIndexOf(":") + 1);
  if (own === role) return base;
  const h = hashOf(id);
  const style = STYLES[(h >>> 7) % STYLES.length];
  return {
    ...base,
    skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 4) % HAIRS.length], style,
    build: style === "bob" || style === "ponytail" || style === "long" || style === "bun" ? 1 : 0,
    trousers: TROUSERS[(h >>> 11) % TROUSERS.length],
  };
}
