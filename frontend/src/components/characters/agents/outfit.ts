/**
 * The white SELISE polo, painted onto a Rocketbox body texture (whatever the avatar wore: a hoodie, a suit).
 *
 * The body mesh is rasterised in UV space with its bind-pose position and dominant bone per pixel, so every texel knows
 * where on the body it is. Then:
 *  - upper-body garment texels become white piqué cotton (the original's soft folds and baked shading kept, its small
 *    details such as zips, lapels and pockets blurred away; the normal map is low-passed the same way);
 *  - the sleeves end at mid upper arm with a ribbed hem; below that the arm is bare skin (tone sampled from the hands);
 *  - a collar band follows the neckline, with a front placket and two buttons;
 *  - below the belt, navy trousers keeping the original's folds, and dark shoes (a base in shorts first gets long
 *    trouser legs: `trouserLegs`).
 * The logo is not painted (a 1K body texture is too coarse for a wordmark): it is a small plane riding the chest bone
 * (see `logoAnchor`), with its own crisp texture.
 * Runs once per model file in the browser (~100 ms), and scripts/bake writes the result into the shipped GLB.
 */
import { Matrix3, Matrix4, Quaternion, Vector3, type Bone, type BufferAttribute, type SkinnedMesh } from "three";

export interface PoloOptions {
  /** where the sleeve ends, as a fraction of shoulder → elbow */
  sleeveEnd?: number;
  /** shirt hem below the pelvis joint (m) */
  hemDrop?: number;
  /** paint a flat polo collar lying on the shoulders (for a base whose own collar was folded away) */
  paintCollar?: boolean;
  /** sRGB shirt colour */
  shirt?: [number, number, number];
}

export interface PoloResult {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement | null;
  rough: HTMLCanvasElement | null;
  /** logo placement in mesh (bind) space: centre, unit normal, width (m) */
  logo: { center: Vector3; normal: Vector3; width: number };
}

const CLS_NONE = 0, CLS_GARMENT = 1, CLS_HAND = 2, CLS_LEG = 3, CLS_FOOT = 4;

type Img = CanvasImageSource & { width: number; height: number };

function canvasOf(img: Img): { c: HTMLCanvasElement; d: ImageData } {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return { c, d: g.getImageData(0, 0, c.width, c.height) };
}

/** separable box blur of one float channel (in place), restricted to `mask` texels (others neither give nor take) */
function blurMasked(src: Float32Array, mask: Uint8Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horiz: boolean) => {
    const lines = horiz ? h : w, len = horiz ? w : h;
    for (let l = 0; l < lines; l++) {
      let sum = 0, n = 0;
      const at = (k: number) => (horiz ? l * w + k : k * w + l);
      for (let k = -r; k <= r; k++) if (k >= 0 && k < len && mask[at(k)]) { sum += from[at(k)]; n++; }
      for (let k = 0; k < len; k++) {
        const i = at(k);
        to[i] = mask[i] && n ? sum / n : from[i];
        const a = k - r, b = k + r + 1;
        if (a >= 0 && mask[at(a)]) { sum -= from[at(a)]; n--; }
        if (b < len && mask[at(b)]) { sum += from[at(b)]; n++; }
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

const UPPER = /Spine|Neck|Head|Clavicle|UpperArm|Forearm|Pelvis/;
const HAND = /Hand|Finger/;
const LEG = /Thigh|Calf/;
const FOOT = /Foot|Toe/;

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function dressPolo(mesh: SkinnedMesh, o: PoloOptions = {}): PoloResult {
  const sleeveEnd = o.sleeveEnd ?? 0.5;
  const shirtRGB = o.shirt ?? [244, 245, 247];
  const mat = mesh.material as import("three").MeshStandardMaterial;
  const colorImg = mat.map!.image as Img;
  const R = colorImg.width, RH = colorImg.height;

  // ── bind-pose positions, dominant bones, joints ──
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const uv = geo.getAttribute("uv") as BufferAttribute;
  const ji = geo.getAttribute("skinIndex") as BufferAttribute;
  const jw = geo.getAttribute("skinWeight") as BufferAttribute;
  const bones = mesh.skeleton.bones;
  // positions as rendered at rest, in the scene's (y-up) frame: the raw bind space of a Rocketbox file is 3ds Max's z-up
  mesh.skeleton.update();
  const bindPos = (name: string) => {
    const b = bones.find((x) => x.name.replace(/[ _]/g, "") === name.replace(/[ _]/g, ""));
    return b ? b.getWorldPosition(new Vector3()) : null;
  };
  const nV = pos.count;
  const P = new Float32Array(nV * 3);
  const vcls = new Uint8Array(nV);
  const varm = new Uint8Array(nV);
  const v = new Vector3();
  for (let i = 0; i < nV; i++) {
    mesh.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = jw.getComponent(i, k); if (w > bw) { bw = w; best = ji.getComponent(i, k); } }
    const n = bones[best]?.name ?? "";
    varm[i] = /UpperArm|Forearm|Hand|Finger/.test(n) ? 1 : 0;
    vcls[i] = HAND.test(n) ? CLS_HAND : FOOT.test(n) ? CLS_FOOT : LEG.test(n) ? CLS_LEG : UPPER.test(n) ? CLS_GARMENT : CLS_NONE;
  }
  const pelvis = bindPos("Bip01 Pelvis")!, neck = bindPos("Bip01 Neck")!, spine2 = bindPos("Bip01 Spine2")!;
  const arms = [
    { s: bindPos("Bip01 L UpperArm")!, e: bindPos("Bip01 L Forearm")! },
    { s: bindPos("Bip01 R UpperArm")!, e: bindPos("Bip01 R Forearm")! },
  ];
  const leftSide = arms[0].s.x > neck.x ? 1 : -1; // which x sign is the wearer's left
  // tucked in: the shirt ends at the waist under a belt; below it navy chinos, then dark leather shoes
  const beltTop = pelvis.y + (o.hemDrop ?? 0.095), beltBot = beltTop - 0.034;
  const hemY = beltTop;
  const ankle = Math.max(bindPos("Bip01 L Foot")?.y ?? 0.09, bindPos("Bip01 R Foot")?.y ?? 0.09);
  // arm parameter per vertex: 0 at the shoulder joint, 1 at the elbow (side by x)
  const T = new Float32Array(nV).fill(-1);
  for (let i = 0; i < nV; i++) {
    if (!varm[i]) continue; // only the arms have sleeves (in an A-pose the torso would project onto the arm too)
    const x = P[i * 3];
    const a = (x - neck.x) * leftSide >= 0 ? arms[0] : arms[1];
    const ex = a.e.x - a.s.x, ey = a.e.y - a.s.y, ez = a.e.z - a.s.z;
    T[i] = ((x - a.s.x) * ex + (P[i * 3 + 1] - a.s.y) * ey + (P[i * 3 + 2] - a.s.z) * ez) / (ex * ex + ey * ey + ez * ez);
  }

  // neckline: per sector around the neck axis, the highest garment (torso) vertex
  const SECT = 32;
  const ring = new Float32Array(SECT).fill(-Infinity);
  const sectorOf = (x: number, z: number) => {
    const a = Math.atan2(x - neck.x, z - neck.z);
    return ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * SECT) % SECT) + SECT) % SECT;
  };
  for (let i = 0; i < nV; i++) {
    if (vcls[i] !== CLS_GARMENT || T[i] > 0.05) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (Math.hypot(x - neck.x, z - neck.z) > 0.16 || y < spine2.y) continue;
    const s = sectorOf(x, z);
    if (y > ring[s]) ring[s] = y;
  }
  for (let k = 0; k < SECT; k++) if (!Number.isFinite(ring[k])) ring[k] = neck.y - 0.03;
  const ringAt = (x: number, z: number) => {
    const a = ((Math.atan2(x - neck.x, z - neck.z) + Math.PI) / (Math.PI * 2)) * SECT - 0.5;
    const i0 = ((Math.floor(a) % SECT) + SECT) % SECT, i1 = (i0 + 1) % SECT, f = a - Math.floor(a);
    return ring[i0] * (1 - f) + ring[i1] * f;
  };
  const frontRing = ringAt(neck.x, neck.z + 1);

  // ── rasterise: per texel class, arm parameter and bind position ──
  const N = R * RH;
  const cls = new Uint8Array(N), tt = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  // texels of a former bare leg (trouserLegs marks its vertices)
  const bareV = geo.userData.bareLegs as Uint8Array | undefined, bareT = new Uint8Array(N);
  const idx = geo.index;
  const nT = idx ? idx.count / 3 : nV / 3;
  const U = new Float32Array(nV * 2);
  for (let i = 0; i < nV; i++) { U[i * 2] = uv.getX(i) * R - 0.5; U[i * 2 + 1] = uv.getY(i) * RH - 0.5; }
  for (let t = 0; t < nT; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const allHand = vcls[a] === CLS_HAND && vcls[b] === CLS_HAND && vcls[c] === CLS_HAND;
    const isLeg = (k: number) => vcls[k] === CLS_LEG || vcls[k] === CLS_FOOT;
    const allFoot = vcls[a] === CLS_FOOT && vcls[b] === CLS_FOOT && vcls[c] === CLS_FOOT;
    const tc = allHand ? CLS_HAND : allFoot ? CLS_FOOT : isLeg(a) && isLeg(b) && isLeg(c) ? CLS_LEG : CLS_GARMENT;
    const ax = U[a * 2], ay = U[a * 2 + 1], bx = U[b * 2], by = U[b * 2 + 1], cx = U[c * 2], cy = U[c * 2 + 1];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(RH - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    const e = -0.6 / Math.sqrt(Math.abs(det)); // a hair of overlap: no cracks between triangles
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < e || l2 < e || l3 < e) continue;
      const p = y * R + x;
      cls[p] = tc;
      tt[p] = l1 * T[a] + l2 * T[b] + l3 * T[c];
      px[p] = l1 * P[a * 3] + l2 * P[b * 3] + l3 * P[c * 3];
      py[p] = l1 * P[a * 3 + 1] + l2 * P[b * 3 + 1] + l3 * P[c * 3 + 1];
      pz[p] = l1 * P[a * 3 + 2] + l2 * P[b * 3 + 2] + l3 * P[c * 3 + 2];
      bareT[p] = bareV && bareV[a] && bareV[b] && bareV[c] ? 1 : 0;
    }
  }
  // dilate 10 texels so filtering and mip levels at island edges see the same colours
  for (let pass = 0; pass < 10; pass++) {
    const snap = cls.slice();
    for (let y = 1; y < RH - 1; y++) for (let x = 1; x < R - 1; x++) {
      const p = y * R + x;
      if (snap[p]) continue;
      for (const q of [p - 1, p + 1, p - R, p + R]) if (snap[q]) {
        cls[p] = snap[q]; tt[p] = tt[q]; px[p] = px[q]; py[p] = py[q]; pz[p] = pz[q]; bareT[p] = bareT[q];
        break;
      }
    }
  }

  // ── what each texel becomes ──
  const SKIN = 1, SHIRT = 2, PANTS = 3, BELT = 4, SHOE = 5;
  const role = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const c = cls[p];
    if (c === CLS_FOOT) { role[p] = SHOE; continue; }
    if (c !== CLS_GARMENT && c !== CLS_LEG) continue;
    if (c === CLS_GARMENT && tt[p] > sleeveEnd) role[p] = SKIN;
    else if (py[p] >= beltTop) role[p] = SHIRT;
    else if (py[p] >= beltBot) role[p] = BELT;
    else if (py[p] < ankle - 0.012) role[p] = SHOE;
    else role[p] = PANTS;
  }

  // ── colour ──
  const col = canvasOf(colorImg);
  const cd = col.d.data;
  // skin tone: the hands' median-ish colour (bright texels only, no nails/shadow)
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let p = 0; p < N; p++) {
    if (cls[p] !== CLS_HAND) continue;
    const r = cd[p * 4], g = cd[p * 4 + 1], b = cd[p * 4 + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    if (l < 70 || l > 230 || r < g) continue;
    sr += r; sg += g; sb += b; sn++;
  }
  const skin = sn ? [sr / sn, sg / sn, sb / sn] : [196, 150, 120];
  // the original shirt cuffs at the wrists (in the hands' island) become skin as well
  for (let p = 0; p < N; p++) {
    if (cls[p] !== CLS_HAND) continue;
    const r = cd[p * 4], g = cd[p * 4 + 1], b = cd[p * 4 + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    if (r > g + 10 && g > b - 4 && l > 85 && r - b < 120) continue;
    role[p] = SKIN;
  }
  // the shirt's soft shading: blurred luminance of whatever was there, normalised
  const lum = new Float32Array(N), shirtMask = new Uint8Array(N);
  let lsum = 0, ln = 0;
  for (let p = 0; p < N; p++) {
    lum[p] = 0.3 * cd[p * 4] + 0.59 * cd[p * 4 + 1] + 0.11 * cd[p * 4 + 2];
    if (role[p] === SHIRT) { shirtMask[p] = 1; lsum += lum[p]; ln++; }
  }
  const lmean = ln ? lsum / ln : 128;
  const soft = blurMasked(lum, shirtMask, R, RH, Math.round(R / 48));
  // trousers and shoes keep their folds and creases (blurred: no stripes, logos or stitching), recoloured
  // a base in shorts (trouserLegs): the trouser legs below the shorts were bare skin (lighter than the cloth, without
  // folds); they are plain cloth, and the shorts' own shading fades out towards their former hem
  const shortsHem = geo.userData.shortsHemY as number | undefined;
  const bareLeg = (p: number) => bareT[p] === 1;
  const legMask = new Uint8Array(N), shoeMask = new Uint8Array(N);
  let pl = 0, pn = 0, ql = 0, qn = 0;
  for (let p = 0; p < N; p++) {
    if (role[p] === PANTS && !bareLeg(p)) { legMask[p] = 1; pl += lum[p]; pn++; }
    else if (role[p] === SHOE) { shoeMask[p] = 1; ql += lum[p]; qn++; }
  }
  const legSoft = blurMasked(lum, legMask, R, RH, Math.round(R / 110));
  const shoeSoft = blurMasked(lum, shoeMask, R, RH, Math.round(R / 160));
  const pmean = pn ? pl / pn : 100, qmean = qn ? ql / qn : 80;
  const NAVY = [36, 43, 60], SHOE_RGB = [44, 33, 28], BELT_RGB = [36, 27, 23];
  const collarH = 0.042, plW = 0.0135;
  for (let p = 0; p < N; p++) {
    const r0 = role[p];
    if (!r0) continue;
    const x = p % R, y = (p / R) | 0;
    const n = hash(x, y);
    if (r0 === PANTS || r0 === SHOE) {
      const pants = r0 === PANTS, bare = pants && bareLeg(p);
      // either side of the shorts' former hem the shading fades to the plain colour: one cloth, no line where they met
      const nearHem = pants && shortsHem !== undefined ? Math.min(1, Math.abs(py[p] - shortsHem) / 0.08) : 1;
      // (a former bare leg is plain cloth: its skin texture, and what lay hidden under the shorts, says nothing about folds)
      let k = bare ? 1 : 1 + (pants ? 0.6 : 0.8) * nearHem * ((pants ? legSoft[p] / pmean : shoeSoft[p] / qmean) - 1);
      k = Math.min(pants ? 1.3 : 1.6, Math.max(0.55, k)) + (n - 0.5) * 0.03;
      const c = pants ? NAVY : SHOE_RGB;
      cd[p * 4] = Math.min(255, c[0] * k); cd[p * 4 + 1] = Math.min(255, c[1] * k); cd[p * 4 + 2] = Math.min(255, c[2] * k);
      continue;
    }
    if (r0 === BELT) {
      const X = px[p], Y = py[p], Z = pz[p];
      const e = Math.min(Y - beltBot, beltTop - Y);
      let c: number[] = BELT_RGB, k = e < 0.003 ? 0.75 : e < 0.006 ? 1.25 : 1 + (n - 0.5) * 0.08;
      // the buckle, front centre
      if (Z > neck.z && Math.abs(X - neck.x) < 0.022 && e > 0.002) { c = [168, 170, 174]; k = Math.abs(X - neck.x) > 0.018 || e < 0.005 ? 0.75 : 1 + (n - 0.5) * 0.1; }
      cd[p * 4] = Math.min(255, c[0] * k); cd[p * 4 + 1] = Math.min(255, c[1] * k); cd[p * 4 + 2] = Math.min(255, c[2] * k);
      continue;
    }
    if (r0 === SKIN) {
      // bare forearm: the hands' tone, a whisper of variation
      const k = 0.985 + 0.012 * Math.sin(x * 0.045 + y * 0.031) * Math.sin(y * 0.052 - x * 0.017) + 0.01 * n;
      let cr = skin[0] * k, cg = skin[1] * k * 0.995, cb = skin[2] * k * 0.99;
      // the sleeve's edge, anti-aliased: one clean hem line, no stair steps
      const e = tt[p] - sleeveEnd;
      if (cls[p] === CLS_GARMENT && e < 0.012) {
        const a = Math.max(0, Math.min(1, e / 0.012));
        cr = cr * a + shirtRGB[0] * 0.84 * (1 - a); cg = cg * a + shirtRGB[1] * 0.84 * (1 - a); cb = cb * a + shirtRGB[2] * 0.84 * (1 - a);
      }
      cd[p * 4] = Math.min(255, cr); cd[p * 4 + 1] = Math.min(255, cg); cd[p * 4 + 2] = Math.min(255, cb);
      continue;
    }
    // shirt: white cotton with the original's soft folds (clamped), a fine piqué grain
    let shade = 1 + 0.65 * (soft[p] / lmean - 1);
    shade = Math.min(1.04, Math.max(0.74, shade)) + (n - 0.5) * 0.025 + ((x + y) % 3 === 0 ? -0.008 : 0);
    const X = px[p], Y = py[p], Z = pz[p];
    // sleeve hem: a ribbed band at the end of the sleeve, a shadow line at its edge
    const sl = sleeveEnd - tt[p];
    if (tt[p] > 0.12 && sl < 0.07) shade *= sl < 0.012 ? 0.86 : 0.95 + 0.03 * Math.sin(y * 2.2 + x * 0.4);
    // tucked in: a soft blouse above the belt (a shadow line where it goes in)
    const hm = Y - hemY;
    if (hm < 0.035) shade *= hm < 0.005 ? 0.72 : 0.9 + 0.1 * (hm / 0.035) + 0.04 * Math.sin(x * 0.35 + y * 0.05);
    // collar band around the neckline, open in front
    const front = Z > neck.z && Math.abs(X - neck.x) < 0.07;
    const top = ringAt(X, Z);
    const dn = top - Y;
    if (o.paintCollar && tt[p] < 0.1) {
      // a flat collar lying on the shoulders: wider towards its points in front, which stop either side of the placket
      const ax = Math.abs(X - neck.x);
      const fr = Z > neck.z ? Math.max(0, 1 - ax / 0.075) : 0;
      const cw = collarH * 0.8 + fr * 0.03;
      const open = Z > neck.z && ax < 0.011 + Math.max(0, dn) * 0.25;
      if (!open && dn > -0.004 && dn < cw) {
        shade = Math.max(shade, 0.97) * (dn < 0.004 ? 0.86 : cw - dn < 0.0035 ? 0.9 : 1.03);
      } else if (!open && dn >= cw && dn < cw + 0.007) {
        shade *= 0.8 + 0.2 * ((dn - cw) / 0.007); // the collar's soft shadow on the shirt
      }
    }
    // placket with two buttons, front centre
    if (front && Z > neck.z + 0.03 && Y < frontRing && Y > frontRing - 0.15) {
      const ax = Math.abs(X - neck.x);
      if (ax < plW) {
        if (ax > plW - 0.0018) shade *= 0.8;
        if (Y < frontRing - 0.148) shade *= 0.8;
        for (const by of [frontRing - 0.06, frontRing - 0.11]) {
          const d = Math.hypot(X - neck.x, Y - by);
          if (d < 0.0055) shade *= d > 0.0042 ? 0.78 : 0.93;
        }
      }
    }
    cd[p * 4] = Math.min(255, shirtRGB[0] * shade); cd[p * 4 + 1] = Math.min(255, shirtRGB[1] * shade); cd[p * 4 + 2] = Math.min(255, shirtRGB[2] * shade);
  }
  // belt edges, anti-aliased: a texel on the edge mixes in its neighbour's colour by how much of it lies over the line
  {
    const src = new Uint8ClampedArray(cd);
    const band = (r0: number) => (r0 === SHIRT ? 2 : r0 === BELT ? 1 : r0 === PANTS ? 0 : -1);
    for (let y = 1; y < RH - 1; y++) for (let x = 1; x < R - 1; x++) {
      const p = y * R + x, b0 = band(role[p]);
      if (b0 < 0) continue;
      let other = -1;
      for (const q of [p - 1, p + 1, p - R, p + R]) { const bq = band(role[q]); if (bq >= 0 && bq !== b0) { other = q; break; } }
      if (other < 0) continue;
      const line = Math.max(b0, band(role[other])) === 2 ? beltTop : beltBot;
      const g = Math.max(1e-4, (Math.abs(py[p + 1] - py[p - 1]) + Math.abs(py[p + R] - py[p - R])) / 2);
      const a = Math.max(0, Math.min(1, Math.abs(py[p] - line) / g + 0.5));
      for (let c = 0; c < 3; c++) cd[p * 4 + c] = src[p * 4 + c] * a + src[other * 4 + c] * (1 - a);
    }
  }
  // the hand's own texture fades into the forearm's tone over the last few centimetres: no line at the wrist
  const hands = [bindPos("Bip01 L Hand"), bindPos("Bip01 R Hand")];
  const wristW = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    if (cls[p] !== CLS_HAND || role[p] === SKIN) continue;
    const side = (px[p] - neck.x) * leftSide >= 0 ? 0 : 1;
    const h = hands[side], e = arms[side].e;
    if (!h) continue;
    const dx = e.x - h.x, dy = e.y - h.y, dz = e.z - h.z, L = Math.hypot(dx, dy, dz) || 1;
    const along = ((px[p] - h.x) * dx + (py[p] - h.y) * dy + (pz[p] - h.z) * dz) / L; // + towards the elbow
    if (along < -0.04) continue;
    const u = Math.min(1, (along + 0.04) / 0.04), w = u * u * (3 - 2 * u);
    wristW[p] = w;
    for (let c = 0; c < 3; c++) cd[p * 4 + c] = cd[p * 4 + c] * (1 - w) + skin[c] * w;
  }
  col.c.getContext("2d")!.putImageData(col.d, 0, 0);

  // ── normal map: low-passed on the shirt, flat on skin ──
  let normal: HTMLCanvasElement | null = null;
  if (mat.normalMap?.image) {
    const nm = canvasOf(mat.normalMap.image as Img);
    const W = nm.c.width, H = nm.c.height, nd = nm.d.data;
    const map = (q: number) => { const x = q % W, y = (q / W) | 0; return Math.min(RH - 1, (y * RH / H) | 0) * R + Math.min(R - 1, (x * R / W) | 0); };
    const m = new Uint8Array(W * H);
    const ch = [new Float32Array(W * H), new Float32Array(W * H)];
    for (let q = 0; q < W * H; q++) { m[q] = role[map(q)] === SHIRT ? 1 : 0; ch[0][q] = nd[q * 4]; ch[1][q] = nd[q * 4 + 1]; }
    const br = Math.round(W / 45);
    const bx = blurMasked(ch[0], m, W, H, br), byy = blurMasked(ch[1], m, W, H, br);
    const ml = new Uint8Array(W * H);
    for (let q = 0; q < W * H; q++) { const r0 = role[map(q)]; ml[q] = r0 === PANTS || r0 === SHOE ? 1 : 0; }
    const lgx = blurMasked(ch[0], ml, W, H, Math.round(W / 160)), lgy = blurMasked(ch[1], ml, W, H, Math.round(W / 160));
    for (let q = 0; q < W * H; q++) {
      const r0 = role[map(q)];
      if (r0 === SKIN || r0 === BELT) { nd[q * 4] = 128; nd[q * 4 + 1] = 128; nd[q * 4 + 2] = 255; continue; }
      const ww = wristW[map(q)];
      if (ww > 0) {
        // the hand's normal map flattens into the bare forearm (its old cuff rim would read as a line)
        nd[q * 4] = nd[q * 4] * (1 - ww) + 128 * ww; nd[q * 4 + 1] = nd[q * 4 + 1] * (1 - ww) + 128 * ww; nd[q * 4 + 2] = nd[q * 4 + 2] * (1 - ww) + 255 * ww;
        continue;
      }
      if (r0 === PANTS || r0 === SHOE) {
        // a former bare leg is plain cloth (skin relief is not a weave), and the shorts' hem relief fades out where
        // the trouser leg carries on
        const pq = map(q);
        const a = r0 !== PANTS || shortsHem === undefined ? 0.8 : bareLeg(pq) ? 0 : 0.8 * Math.min(1, Math.max(0, py[pq] - shortsHem) / 0.06);
        const nx = 128 + (lgx[q] - 128) * a, ny = 128 + (lgy[q] - 128) * a;
        const fx = nx / 127.5 - 1, fy = ny / 127.5 - 1;
        nd[q * 4] = nx; nd[q * 4 + 1] = ny; nd[q * 4 + 2] = 127.5 + 127.5 * Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy));
        continue;
      }
      if (r0 !== SHIRT) continue;
      const g = (hash(q % W, (q / W) | 0) - 0.5) * 6;
      const nx = 128 + (bx[q] - 128) * 0.55 + g, ny = 128 + (byy[q] - 128) * 0.55 - g;
      const fx = nx / 127.5 - 1, fy = ny / 127.5 - 1;
      nd[q * 4] = nx; nd[q * 4 + 1] = ny; nd[q * 4 + 2] = 127.5 + 127.5 * Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy));
    }
    nm.c.getContext("2d")!.putImageData(nm.d, 0, 0);
    normal = nm.c;
  }

  // ── roughness (glTF: green) ──
  let rough: HTMLCanvasElement | null = null;
  if (mat.roughnessMap?.image) {
    const rm = canvasOf(mat.roughnessMap.image as Img);
    const W = rm.c.width, H = rm.c.height, rd = rm.d.data;
    for (let q = 0; q < W * H; q++) {
      const x = q % W, y = (q / W) | 0;
      const r0 = role[Math.min(RH - 1, (y * RH / H) | 0) * R + Math.min(R - 1, (x * R / W) | 0)];
      if (r0 === SHIRT) rd[q * 4 + 1] = 222;
      else if (r0 === SKIN) rd[q * 4 + 1] = 145;
      else if (r0 === PANTS) rd[q * 4 + 1] = 205;
      else if (r0 === BELT) rd[q * 4 + 1] = 110;
      else if (r0 === SHOE) rd[q * 4 + 1] = 95;
    }
    rm.c.getContext("2d")!.putImageData(rm.d, 0, 0);
    rough = rm.c;
  }

  // ── logo spot: left chest, on the surface (the frontmost body point there) ──
  const lx = neck.x + leftSide * 0.095, ly = Math.min(frontRing - 0.1, (arms[0].s.y + arms[1].s.y) / 2 - 0.055);
  let best = -Infinity;
  const nrm = new Vector3(0, 0, 1);
  const A = new Vector3(), B = new Vector3(), C = new Vector3();
  for (let t = 0; t < nT; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    A.fromArray(P, a * 3); B.fromArray(P, b * 3); C.fromArray(P, c * 3);
    const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((B.y - C.y) * (lx - C.x) + (C.x - B.x) * (ly - C.y)) / det;
    const l2 = ((C.y - A.y) * (lx - C.x) + (A.x - C.x) * (ly - C.y)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * A.z + l2 * B.z + l3 * C.z;
    if (z > best) {
      best = z;
      nrm.copy(B).sub(A).cross(v.copy(C).sub(A)).normalize();
      if (nrm.z < 0) nrm.negate();
    }
  }
  if (!Number.isFinite(best)) best = spine2.z + 0.12;
  // the chest leans; keep the logo upright-ish but tangent to the cloth
  nrm.x *= 0.5; nrm.normalize();
  return { color: col.c, normal, rough, logo: { center: new Vector3(lx, ly, best), normal: nrm, width: 0.078 } };
}

/** The logo plane's matrix in the chest bone's local space, from the model's rest pose (`bone` of the source scene,
 *  never an animated clone): rides the bone like an embroidered patch. Unit width; scale y by 1/aspect. */
export function logoAnchor(bone: Bone, logo: PoloResult["logo"], lift = 0.0035): Matrix4 {
  const n = logo.normal.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), n).normalize();
  const up2 = new Vector3().crossVectors(n, right).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up2, n));
  const at = logo.center.clone().addScaledVector(n, lift);
  const inWorld = new Matrix4().compose(at, q, new Vector3(logo.width, logo.width, 1));
  bone.updateWorldMatrix(true, false);
  return new Matrix4().copy(bone.matrixWorld).invert().multiply(inWorld);
}

/* ── the face: living eyes, skin that is not grey ─────────────────────────── */

export interface EyeInfo {
  /** eye bone name (sanitised, e.g. Bip01_LEye) */
  bone: string;
  /** eyeball centre and radius, rest pose, scene frame */
  center: Vector3;
  radius: number;
}

export interface HeadResult {
  color: HTMLCanvasElement;
  rough: HTMLCanvasElement | null;
  /** where the skin sheen goes (skin only: never on hair, brows or eyes) */
  sheen: HTMLCanvasElement;
  eyes: EyeInfo[];
}

/**
 * The head texture, made less "game character": the sclera warm off-white (never paper white or grey; the iris, the
 * eyeball's front cap, keeps its own colour however light) and the skin's roughness evened out around 0.55 (a soft sheen
 * comes from the material). Also measures each eyeball (vertices skinned to an eye bone) so a cornea and a pupil can sit
 * on it.
 */
export function dressHead(mesh: SkinnedMesh): HeadResult {
  const mat = mesh.material as import("three").MeshStandardMaterial;
  const colorImg = mat.map!.image as Img;
  const R = colorImg.width, RH = colorImg.height;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const uv = geo.getAttribute("uv") as BufferAttribute;
  const ji = geo.getAttribute("skinIndex") as BufferAttribute;
  const jw = geo.getAttribute("skinWeight") as BufferAttribute;
  const bones = mesh.skeleton.bones;
  const nV = pos.count;
  const eyeOf = new Int8Array(nV).fill(-1);
  const eyeBones = bones.map((b, i) => (/(L|R)Eye$/.test(b.name) ? i : -1)).filter((i) => i >= 0);
  const acc = eyeBones.map(() => ({ pts: [] as Vector3[] }));
  const v = new Vector3();
  // how far round the eyeball each eye vertex is from its front (the gaze at rest is +z): cos of that angle
  const front = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = jw.getComponent(i, k); if (w > bw) { bw = w; best = ji.getComponent(i, k); } }
    const e = eyeBones.indexOf(best);
    if (e < 0 || bw < 0.6) continue;
    eyeOf[i] = e;
    const p = mesh.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld).clone();
    acc[e].pts.push(p);
    front[i] = p.clone().sub(bones[eyeBones[e]].getWorldPosition(new Vector3())).normalize().z;
  }
  const eyes: EyeInfo[] = [];
  eyeBones.forEach((bi, e) => {
    const pts = acc[e].pts;
    if (pts.length < 8) return;
    const c = bones[bi].getWorldPosition(new Vector3());
    // the eyeball: centred on the bone; radius = the typical distance of its vertices (the front cap included)
    const d = pts.map((p) => p.distanceTo(c)).sort((a, b) => a - b);
    eyes.push({ bone: bones[bi].name, center: c, radius: d[Math.floor(d.length * 0.8)] });
  });

  // rasterise the eye triangles' texels
  const N = R * RH;
  const eyeMask = new Uint8Array(N), iris = new Uint8Array(N);
  const idx = geo.index;
  const nT = idx ? idx.count / 3 : nV / 3;
  for (let t = 0; t < nT; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (eyeOf[a] < 0 || eyeOf[b] < 0 || eyeOf[c] < 0) continue;
    const ax = uv.getX(a) * R, ay = uv.getY(a) * RH, bx = uv.getX(b) * R, by = uv.getY(b) * RH, cx = uv.getX(c) * R, cy = uv.getY(c) * RH;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1); y <= Math.min(RH - 1, Math.ceil(Math.max(ay, by, cy)) + 1); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1); x <= Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx)) + 1); x++) {
        const l1 = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / det;
        const l2 = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / det;
        if (l1 < -0.05 || l2 < -0.05 || 1 - l1 - l2 < -0.05) continue;
        eyeMask[y * R + x] = 1;
        // the iris and pupil: the front cap, within ~33° of the gaze (a light grey or blue iris is not sclera)
        if (l1 * front[a] + l2 * front[b] + (1 - l1 - l2) * front[c] > 0.84) iris[y * R + x] = 1;
      }
  }

  const col = canvasOf(colorImg);
  const cd = col.d.data;
  const skinLike = (r: number, g: number, b: number) => r > g + 6 && g > b - 6 && r - b > 22 && r > 70;
  for (let p = 0; p < N; p++) {
    if (!eyeMask[p] || iris[p]) continue;
    const r = cd[p * 4], g = cd[p * 4 + 1], b = cd[p * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    // sclera: bright and unsaturated (or a reddish-grey white) → warm off-white, keeping its soft shading
    if (l > 105 && mx - mn < 38) {
      const k = Math.min(1, Math.max(0.78, 0.6 + l / 400));
      cd[p * 4] = 192 * k; cd[p * 4 + 1] = 182 * k; cd[p * 4 + 2] = 172 * k;
    }
  }
  col.c.getContext("2d")!.putImageData(col.d, 0, 0);

  // sheen mask, at quarter size (it is soft anyway)
  const sh = document.createElement("canvas");
  sh.width = R >> 2; sh.height = RH >> 2;
  const sg = sh.getContext("2d")!;
  const sd = sg.createImageData(sh.width, sh.height);
  for (let y = 0; y < sh.height; y++) for (let x = 0; x < sh.width; x++) {
    const p = (y * 4 + 2) * R + x * 4 + 2, q = (y * sh.width + x) * 4;
    const on = !eyeMask[p] && skinLike(cd[p * 4], cd[p * 4 + 1], cd[p * 4 + 2]);
    sd.data[q] = on ? 255 : 0; sd.data[q + 1] = on ? 222 : 0; sd.data[q + 2] = on ? 204 : 0; sd.data[q + 3] = 255;
  }
  sg.putImageData(sd, 0, 0);

  let rough: HTMLCanvasElement | null = null;
  if (mat.roughnessMap?.image) {
    const orig = col.d.data;
    const rm = canvasOf(mat.roughnessMap.image as Img);
    const W = rm.c.width, H = rm.c.height, rd = rm.d.data;
    for (let q = 0; q < W * H; q++) {
      const x = q % W, y = (q / W) | 0;
      const p = Math.min(RH - 1, (y * RH / H) | 0) * R + Math.min(R - 1, (x * R / W) | 0);
      if (eyeMask[p]) rd[q * 4 + 1] = 70;
      else if (skinLike(orig[p * 4], orig[p * 4 + 1], orig[p * 4 + 2])) rd[q * 4 + 1] = 140 + 0.4 * (rd[q * 4 + 1] - 140);
    }
    rm.c.getContext("2d")!.putImageData(rm.d, 0, 0);
    rough = rm.c;
  }
  return { color: col.c, rough, sheen: sh, eyes };
}

/**
 * Folds a standing collar away: every body vertex around the neck above the fold line (the collar's top edge, per angle,
 * less its height) collapses onto the fold line, flush with the shirt, so nothing stands up or flares at the back. The
 * collar that shows is the flat one dressPolo paints (`paintCollar`). Edits the guide's own model file once.
 */
export function foldCollar(mesh: SkinnedMesh, o: { height?: number; radius?: number } = {}): number {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const neckBone = bones.find((b) => b.name.replace(/[ _]/g, "") === "Bip01Neck");
  if (!neckBone) return 0;
  const neck = neckBone.getWorldPosition(new Vector3());
  const rad = o.radius ?? 0.15, collarH = o.height ?? 0.072;
  const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
  const ji = mesh.geometry.getAttribute("skinIndex") as BufferAttribute, jw = mesh.geometry.getAttribute("skinWeight") as BufferAttribute;
  const blend = new Matrix4(), bm = new Matrix4(), A = new Matrix4();
  const w = new Vector3(), l = new Vector3();
  const SECT = 48, BIN = 0.003, BINS = 60;
  const sec = (x: number, z: number) => ((Math.floor(((Math.atan2(x - neck.x, z - neck.z) + Math.PI) / (Math.PI * 2)) * SECT) % SECT) + SECT) % SECT;
  // world positions, and the shirt's surface below the fold (max radius per angle and height), the collar's inner radius
  const W = new Float32Array(pos.count * 3);
  const surf = new Float32Array(SECT * BINS).fill(0);
  const inner = new Float32Array(SECT).fill(Infinity);
  const top = new Float32Array(SECT).fill(-Infinity);
  for (let i = 0; i < pos.count; i++) {
    mesh.applyBoneTransform(i, w.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
    W[i * 3] = w.x; W[i * 3 + 1] = w.y; W[i * 3 + 2] = w.z;
    const r = Math.hypot(w.x - neck.x, w.z - neck.z);
    if (r < rad && w.y > neck.y - 0.05) { const k = sec(w.x, w.z); top[k] = Math.max(top[k], w.y); }
  }
  // the fold line follows the collar: its top edge (smoothed around the neck) less the collar's height
  const Hs = new Float32Array(SECT);
  for (let k = 0; k < SECT; k++) {
    let sum = 0, cnt = 0;
    for (let d = -2; d <= 2; d++) { const v = top[(k + d + SECT) % SECT]; if (Number.isFinite(v)) { sum += v; cnt++; } }
    Hs[k] = Math.max(neck.y - 0.012, (cnt ? sum / cnt : neck.y + 0.06) - collarH);
  }
  // pass 1: the collar's inner radius per angle (above the fold line)
  for (let i = 0; i < pos.count; i++) {
    const wx = W[i * 3], wy = W[i * 3 + 1], wz = W[i * 3 + 2];
    const r = Math.hypot(wx - neck.x, wz - neck.z), k = sec(wx, wz);
    if (wy > Hs[k] && r < rad) inner[k] = Math.min(inner[k], r);
  }
  // pass 2: the shirt's outer surface just below the fold: per angle and height, the nearest surface outside the collar
  surf.fill(Infinity);
  for (let i = 0; i < pos.count; i++) {
    const wx = W[i * 3], wy = W[i * 3 + 1], wz = W[i * 3 + 2];
    const r = Math.hypot(wx - neck.x, wz - neck.z), k = sec(wx, wz), H = Hs[k];
    if (wy > H || r > 0.3) continue;
    const lim = Number.isFinite(inner[k]) ? inner[k] + 0.006 : 0;
    if (r < lim) continue;
    const bin = Math.floor((H - wy) / BIN);
    if (bin < BINS) surf[k * BINS + bin] = Math.min(surf[k * BINS + bin], r);
  }
  // the fold line's radius, smoothed around the neck (a ragged fold line would crumple the collar)
  for (let k = 0; k < SECT; k++) if (!Number.isFinite(inner[k])) inner[k] = NaN;
  const inner0 = Float32Array.from(inner);
  for (let k = 0; k < SECT; k++) {
    let sum = 0, cnt = 0;
    for (let d = -3; d <= 3; d++) { const v = inner0[(k + d + SECT) % SECT]; if (!Number.isNaN(v)) { sum += v; cnt++; } }
    inner[k] = cnt ? sum / cnt : Infinity;
  }
  // fill empty bins from their neighbours (above first)
  for (let k = 0; k < SECT; k++) for (let b = 1; b < BINS; b++) if (!Number.isFinite(surf[k * BINS + b])) surf[k * BINS + b] = surf[k * BINS + b - 1];
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
    const dx = x - neck.x, dz = z - neck.z, r = Math.hypot(dx, dz);
    const k = sec(x, z), H = Hs[k];
    if (r > rad || r < 1e-4 || y <= H) continue;
    // the stand-up part folds away into the neckline (it collapses onto the fold line, flush with the shirt); the
    // collar that shows is the flat one dressPolo paints on the shirt (`paintCollar`)
    const sr = surf[k * BINS];
    const nr = Number.isFinite(sr) ? Math.max(sr - 0.002, (Number.isFinite(inner[k]) ? inner[k] : r)) : r;
    const ny = H - 0.001;
    w.set(neck.x + (dx / r) * nr, ny, neck.z + (dz / r) * nr);
    blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let q = 0; q < 4; q++) {
      const wt = jw.getComponent(i, q);
      if (!wt) continue;
      bm.multiplyMatrices(bones[ji.getComponent(i, q)].matrixWorld, mesh.skeleton.boneInverses[ji.getComponent(i, q)]);
      for (let e = 0; e < 16; e++) blend.elements[e] += bm.elements[e] * wt;
    }
    const F = new Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(blend).multiply(mesh.bindMatrix);
    A.copy(F).invert();
    l.copy(w).applyMatrix4(A);
    const cl = (v: number) => (pos.normalized ? Math.max(-1, Math.min(1, v)) : v);
    pos.setXYZ(i, cl(l.x), cl(l.y), cl(l.z));
    moved++;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
  return moved;
}

/**
 * Slims the long sleeves (and their cuffs) of the base model down to a bare forearm: forearm vertices move towards the
 * elbow-wrist axis so the radius tapers from the elbow to the hand's own wrist, which removes the cuff's ledge at the
 * wrist and the sleeve's bulk. Same caveats as foldCollar (only the guides use these files). Returns vertices moved.
 */
export function slimForearms(mesh: SkinnedMesh, o: { elbow?: number } = {}): number {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const find = (n: string) => bones.findIndex((b) => b.name.replace(/[ _]/g, "") === n);
  const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
  const ji = mesh.geometry.getAttribute("skinIndex") as BufferAttribute, jw = mesh.geometry.getAttribute("skinWeight") as BufferAttribute;
  const blend = new Matrix4(), bm = new Matrix4(), A = new Matrix4();
  const w = new Vector3(), l = new Vector3(), axis = new Vector3(), q = new Vector3();
  const nrm = mesh.geometry.getAttribute("normal") as BufferAttribute | undefined;
  const nw = new Vector3(), nl = new Vector3(), nmat = new Matrix3();
  // mesh islands (connected through shared vertices): the hands are the islands holding finger vertices; the old
  // sleeve and its cuff are another island, even where the cuff is skinned to the hand
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const findRoot = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const idx = mesh.geometry.index;
  if (idx) for (let t = 0; t < idx.count; t += 3) {
    const a = findRoot(idx.getX(t)), b = findRoot(idx.getX(t + 1)), c = findRoot(idx.getX(t + 2));
    parent[b] = a; parent[findRoot(c)] = a;
  }
  const handIsland = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const x = jw.getComponent(i, k); if (x > bw) { bw = x; best = ji.getComponent(i, k); } }
    if (/Finger/.test(bones[best].name)) handIsland.add(findRoot(i));
  }
  const inHand = (i: number) => handIsland.has(findRoot(i));
  let moved = 0;
  for (const side of ["L", "R"]) {
    const fi = find(`Bip01${side}Forearm`), hi = find(`Bip01${side}Hand`);
    if (fi < 0 || hi < 0) continue;
    const E = bones[fi].getWorldPosition(new Vector3()), H = bones[hi].getWorldPosition(new Vector3());
    axis.copy(H).sub(E);
    const len = axis.length();
    axis.normalize();
    // a frame around the forearm axis, and the hand's own wrist profile (radius per angle) just past the wrist joint
    const u = new Vector3().crossVectors(axis, Math.abs(axis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)).normalize();
    const v = new Vector3().crossVectors(axis, u);
    const SECT = 16;
    const prof = new Float32Array(SECT), pn = new Float32Array(SECT);
    const sector = (d: Vector3) => ((Math.floor(((Math.atan2(d.dot(v), d.dot(u)) + Math.PI) / (Math.PI * 2)) * SECT) % SECT) + SECT) % SECT;
    const dominant = (i: number) => {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const x = jw.getComponent(i, k); if (x > bw) { bw = x; best = ji.getComponent(i, k); } }
      return best;
    };
    for (let i = 0; i < pos.count; i++) {
      if (!inHand(i)) continue;
      mesh.applyBoneTransform(i, w.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
      const t = q.copy(w).sub(E).dot(axis);
      if (t < len + 0.006 || t > len + 0.026) continue;
      q.sub(l.copy(axis).multiplyScalar(t));
      const k = sector(q);
      prof[k] += q.length(); pn[k]++;
    }
    let avg = 0, an = 0;
    for (let k = 0; k < SECT; k++) if (pn[k]) { prof[k] /= pn[k]; avg += prof[k]; an++; }
    avg = an ? avg / an : 0.028;
    for (let k = 0; k < SECT; k++) if (!pn[k]) prof[k] = avg;
    const elbowGrow = o.elbow ?? 1.45;
    for (let i = 0; i < pos.count; i++) {
      const dom = dominant(i);
      if (dom !== fi && dom !== hi) continue;
      mesh.applyBoneTransform(i, w.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
      const tl = q.copy(w).sub(E).dot(axis);
      const hand = inHand(i);
      // the hand's own open end (it used to hide in the sleeve) tucks just inside the forearm; the rest of it stays
      if (hand && tl > len + 0.006) continue;
      // the hand itself stays; the (former) sleeve and its cuff, wherever skinned, are slimmed
      const t = Math.max(0, Math.min(1, tl / len));
      const c = E.clone().addScaledVector(axis, Math.min(tl, len));
      const rad = q.copy(w).sub(c);
      const r = rad.length();
      if (r < 1e-4) continue;
      const s2 = t * t * (3 - 2 * t);
      // the wrist's own shape at the wrist, a rounder, fuller forearm towards the elbow; never fatter than it was
      // past the wrist joint (the old cuff) a touch inside the hand's surface, so it hides under it
      const target = hand ? prof[sector(rad)] * 0.97
        : tl > len ? prof[sector(rad)] * 0.96 : (prof[sector(rad)] * 1.01) * (1 + (elbowGrow - 1) * (1 - s2));
      if (r <= target) continue;
      w.copy(c).addScaledVector(rad, target / r);
      blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const wt = jw.getComponent(i, k);
        if (!wt) continue;
        bm.multiplyMatrices(bones[ji.getComponent(i, k)].matrixWorld, mesh.skeleton.boneInverses[ji.getComponent(i, k)]);
        for (let e = 0; e < 16; e++) blend.elements[e] += bm.elements[e] * wt;
      }
      A.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(blend).multiply(mesh.bindMatrix).invert();
      l.copy(w).applyMatrix4(A);
      const cl = (x: number) => (pos.normalized ? Math.max(-1, Math.min(1, x)) : x);
      pos.setXYZ(i, cl(l.x), cl(l.y), cl(l.z));
      if (nrm && (t > 0.7 || hand)) {
        // near the wrist the (former) cuff's normals follow the arm's round surface: no shading crease at the seam
        nw.copy(rad).normalize();
        nl.copy(nw).applyMatrix3(nmat.getNormalMatrix(A));
        nl.normalize();
        const k = hand ? 1 : Math.min(1, (t - 0.7) / 0.25);
        const ox = nrm.getX(i), oy = nrm.getY(i), oz = nrm.getZ(i);
        nl.set(ox + (nl.x - ox) * k, oy + (nl.y - oy) * k, oz + (nl.z - oz) * k).normalize();
        nrm.setXYZ(i, nl.x, nl.y, nl.z);
      }
      moved++;
    }
  }
  pos.needsUpdate = true;
  if (nrm) nrm.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
  return moved;
}

/**
 * Long trousers on a base that wears shorts. The bare lower legs are their own mesh islands (skinned to the thigh and
 * calf, no hip or foot-and-toe parts); the shorts are the rest of the thigh and calf, and end at their lowest point.
 * One trouser leg, measured along the hip-knee-ankle line: the shorts' own width up the thigh, narrowing to the knee,
 * hanging straight over the widest of the calf, and a slim ~5.4 cm at the ankle where it meets the shoe. The shorts'
 * lower thigh is drawn in onto it (a hair wider, so their hem covers where the leg comes out; their inside stays
 * inside); below the hem the bare leg moves out onto it (never inwards); the bare leg still under the shorts stays
 * inside them; round the knee the shorts take the leg's skin weights, so a bent knee bends the cloth. dressPolo then
 * paints the trousers on: the former skin as plain cloth (`bareLegs`), the shorts' shading fading out towards their
 * former hem (`shortsHemY`). Same caveats as foldCollar (only the guides use these files). Returns the vertices moved
 * (0 when the base has no shorts).
 */
export function trouserLegs(mesh: SkinnedMesh, o: { knee?: number; ankle?: number } = {}): number {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const find = (n: string) => bones.findIndex((b) => b.name.replace(/[ _]/g, "") === n);
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const ji = geo.getAttribute("skinIndex") as BufferAttribute, jw = geo.getAttribute("skinWeight") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute | undefined;
  const idx = geo.index;
  if (!idx) return 0;
  const nV = pos.count;
  // rest positions (scene frame) and each vertex's dominant bone
  const W = new Float32Array(nV * 3), dom = new Int32Array(nV);
  const w = new Vector3(), l = new Vector3();
  for (let i = 0; i < nV; i++) {
    mesh.applyBoneTransform(i, w.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
    W[i * 3] = w.x; W[i * 3 + 1] = w.y; W[i * 3 + 2] = w.z;
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const x = jw.getComponent(i, k); if (x > bw) { bw = x; best = ji.getComponent(i, k); } }
    dom[i] = best;
  }
  // mesh islands (connected through shared vertices)
  const parent = new Int32Array(nV).map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < idx.count; t += 3) {
    const a = root(idx.getX(t)), b = root(idx.getX(t + 1)), c = root(idx.getX(t + 2));
    parent[b] = a; parent[root(c)] = a;
  }
  const blend = new Matrix4(), bm = new Matrix4(), M = new Matrix4(), A = new Matrix4(), nmat = new Matrix3();
  const KNEE = o.knee ?? 0.066, ANKLE = o.ankle ?? 0.054, SECT = 32;
  let moved = 0;
  for (const side of ["L", "R"]) {
    const ti = find(`Bip01${side}Thigh`), ci = find(`Bip01${side}Calf`), fi = find(`Bip01${side}Foot`);
    if (ti < 0 || ci < 0 || fi < 0) continue;
    const isLeg = (b: number) => b === ti || b === ci;
    const isFoot = (b: number) => b === fi || /Toe/.test(bones[b].name) && bones[b].name.includes(`_${side}_`);
    const isTrunk = (b: number) => /Pelvis|Spine/.test(bones[b].name);
    // per island: how many of its vertices belong to this leg, the hips, the foot, anything else
    const info = new Map<number, { leg: number; trunk: number; foot: number; calf: number; other: number }>();
    for (let i = 0; i < nV; i++) {
      const r = root(i), b = dom[i];
      let e = info.get(r);
      if (!e) info.set(r, (e = { leg: 0, trunk: 0, foot: 0, calf: 0, other: 0 }));
      if (isLeg(b)) e.leg++; else if (isTrunk(b)) e.trunk++; else if (isFoot(b)) e.foot++; else e.other++;
      if (b === ci) e.calf++;
    }
    // the bare leg: islands of this thigh and calf only (mostly calf); the shoe: islands mostly of the foot; the shorts:
    // every other vertex of this thigh and calf (the cloth may be cut into several UV islands), their lowest is the hem
    const bare = new Set<number>(), shoe = new Set<number>();
    for (const [r, e] of info) {
      if (e.foot > e.leg) shoe.add(r);
      else if (e.leg >= 8 && e.trunk === 0 && e.other <= e.leg * 0.1 && e.calf > e.leg * 0.4 && e.foot < e.leg * 0.25) bare.add(r);
    }
    const isShortsV = (i: number) => isLeg(dom[i]) && !bare.has(root(i)) && !shoe.has(root(i));
    let hemY = Infinity;
    for (let i = 0; i < nV; i++) if (isShortsV(i)) hemY = Math.min(hemY, W[i * 3 + 1]);
    if (!bare.size || !Number.isFinite(hemY)) continue;
    const H = bones[ti].getWorldPosition(new Vector3()), K = bones[ci].getWorldPosition(new Vector3()), F = bones[fi].getWorldPosition(new Vector3());
    if (hemY <= K.y - 0.12 || hemY >= H.y) continue; // shorts end between the hip and just below the knee
    const L1 = H.distanceTo(K), L2 = K.distanceTo(F);
    const d1 = K.clone().sub(H).normalize(), d2 = F.clone().sub(K).normalize();
    // where a point is round the leg line (hip → knee → ankle): s along it, its offset from the line
    const c = new Vector3(), off = new Vector3(), q = new Vector3();
    const place = (x: number, y: number, z: number) => {
      q.set(x, y, z);
      const t1 = Math.max(0, Math.min(L1, l.copy(q).sub(H).dot(d1)));
      const t2 = Math.max(0, Math.min(L2, l.copy(q).sub(K).dot(d2)));
      const c1 = H.clone().addScaledVector(d1, t1), c2 = K.clone().addScaledVector(d2, t2);
      const upper = q.distanceToSquared(c1) < q.distanceToSquared(c2);
      c.copy(upper ? c1 : c2);
      off.copy(q).sub(c);
      return { s: upper ? t1 : L1 + t2, dir: upper ? d1 : d2 };
    };
    // round the leg: the fraction of a turn from the back (atan2 + π), and values kept per sector of it, read back with
    // linear interpolation between sector centres
    const turn = (dir: Vector3) => {
      const u = new Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize(), v = new Vector3().crossVectors(dir, u);
      return (Math.atan2(off.dot(v), off.dot(u)) + Math.PI) / (Math.PI * 2);
    };
    const sectorOf = (a: number) => ((Math.floor(a * SECT) % SECT) + SECT) % SECT;
    const at = (arr: Float32Array, a: number) => {
      const x = a * SECT - 0.5, i0 = ((Math.floor(x) % SECT) + SECT) % SECT, f = x - Math.floor(x);
      return arr[i0] * (1 - f) + arr[(i0 + 1) % SECT] * f;
    };
    /** empty sectors (NaN) take their nearest filled neighbours' values, interpolated round the leg */
    const fill = (arr: Float32Array, dflt: number) => {
      const src = Float32Array.from(arr);
      if (src.every((x) => Number.isNaN(x))) return arr.fill(dflt);
      for (let k = 0; k < SECT; k++) {
        if (!Number.isNaN(src[k])) continue;
        let p = 1, n = 1;
        while (Number.isNaN(src[(k - p + SECT) % SECT])) p++;
        while (Number.isNaN(src[(k + n) % SECT])) n++;
        arr[k] = (src[(k - p + SECT) % SECT] * n + src[(k + n) % SECT] * p) / (p + n);
      }
      return arr;
    };
    const LEN = L1 + L2, EASE = 0.1;
    // how far down the shorts reach round the leg (the hem is not level: shorts dip in front)
    const hemS = new Float32Array(SECT).fill(NaN);
    let sLow = 0;
    for (let i = 0; i < nV; i++) {
      if (!isShortsV(i)) continue;
      const P = place(W[i * 3], W[i * 3 + 1], W[i * 3 + 2]);
      if (P.s < L1 * 0.5) continue;
      const k = sectorOf(turn(P.dir));
      hemS[k] = Number.isNaN(hemS[k]) ? P.s : Math.max(hemS[k], P.s);
      sLow = Math.max(sLow, P.s);
    }
    fill(hemS, sLow);
    let sTop = Infinity;
    for (let k = 0; k < SECT; k++) sTop = Math.min(sTop, hemS[k]);
    // the trouser leg takes over from the shorts' own shape 26 cm above their hem (s0); their radius there
    const s0 = Math.max(L1 * 0.3, sTop - 0.26);
    const r0 = new Float32Array(SECT).fill(NaN), n0 = new Float32Array(SECT);
    for (let i = 0; i < nV; i++) {
      if (!isShortsV(i)) continue;
      const P = place(W[i * 3], W[i * 3 + 1], W[i * 3 + 2]);
      if (Math.abs(P.s - s0) > 0.03) continue;
      const k = sectorOf(turn(P.dir));
      r0[k] = (Number.isNaN(r0[k]) ? 0 : r0[k]) + off.length(); n0[k]++;
    }
    for (let k = 0; k < SECT; k++) if (n0[k]) r0[k] /= n0[k];
    fill(r0, KNEE * 1.3);
    for (let k = 0; k < SECT; k++) r0[k] = Math.max(KNEE, r0[k]);
    // round the knee the shorts move like the leg under them: their own weights swing them with the thigh alone, and a
    // bent knee would open a step at the hem. Their skin weights blend over to the nearest bare-leg vertex's (from 10 cm
    // above the knee joint; fully at it and below).
    const legV: number[] = [];
    for (let i = 0; i < nV; i++) if (bare.has(root(i))) legV.push(i);
    const wsum = new Map<number, number>();
    for (let i = 0; i < nV; i++) {
      if (!isShortsV(i)) continue;
      let f = (place(W[i * 3], W[i * 3 + 1], W[i * 3 + 2]).s - (L1 - 0.1)) / 0.1;
      if (f <= 0) continue;
      f = Math.min(1, f);
      f = f * f * (3 - 2 * f);
      let j = -1, best = Infinity;
      for (const v of legV) {
        const d = (W[v * 3] - W[i * 3]) ** 2 + (W[v * 3 + 1] - W[i * 3 + 1]) ** 2 + (W[v * 3 + 2] - W[i * 3 + 2]) ** 2;
        if (d < best) { best = d; j = v; }
      }
      if (j < 0) continue;
      wsum.clear();
      for (let k = 0; k < 4; k++) {
        const a = jw.getComponent(i, k), b = jw.getComponent(j, k);
        if (a) wsum.set(ji.getComponent(i, k), (wsum.get(ji.getComponent(i, k)) ?? 0) + a * (1 - f));
        if (b) wsum.set(ji.getComponent(j, k), (wsum.get(ji.getComponent(j, k)) ?? 0) + b * f);
      }
      const top = [...wsum].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const tot = top.reduce((x, e) => x + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) { ji.setComponent(i, k, top[k]?.[0] ?? 0); jw.setComponent(i, k, (top[k]?.[1] ?? 0) / tot); }
    }
    ji.needsUpdate = true;
    jw.needsUpdate = true;
    // the trouser leg hangs straight from the hem over the widest of the calf (with a little ease), and narrows only over
    // its last 12 cm to a slim ankle; above the hem the shorts narrow onto it from s0
    const env = new Float32Array(SECT).fill(NaN);
    for (const i of legV) {
      const P = place(W[i * 3], W[i * 3 + 1], W[i * 3 + 2]);
      const a = turn(P.dir), k = sectorOf(a);
      if (P.s < at(hemS, a) || P.s > L1 + L2 * 0.65) continue;
      env[k] = Number.isNaN(env[k]) ? off.length() : Math.max(env[k], off.length());
    }
    fill(env, KNEE);
    const T = Float32Array.from(env, (_, k) => {
      const e = Math.max(env[(k + SECT - 1) % SECT], env[k], env[(k + 1) % SECT]);
      return Math.min(r0[k], Math.max(KNEE * 0.88, e + 0.007));
    });
    const sA = LEN - 0.12;
    const target = (s: number, a: number) => {
      const h = at(hemS, a), tk = at(T, a);
      if (s <= h) {
        const u = Math.max(0, Math.min(1, (s - s0) / Math.max(0.05, h - s0))), rk = at(r0, a);
        return rk + (tk - rk) * u * u * (3 - 2 * u);
      }
      if (s <= sA) return tk;
      const u = Math.min(1, (s - sA) / 0.12);
      return tk + (Math.min(tk, ANKLE) - tk) * u * u * (3 - 2 * u);
    };
    for (let i = 0; i < nV; i++) {
      const isShorts = isShortsV(i), isBare = bare.has(root(i));
      if (!isShorts && !isBare) continue;
      const P = place(W[i * 3], W[i * 3 + 1], W[i * 3 + 2]);
      if (P.s < s0) continue;
      const r = off.length();
      if (r < 1e-4) continue;
      const a = turn(P.dir), t = target(P.s, a);
      const hidden = isBare && P.s < at(hemS, a) - 0.015;
      // the skinning at rest, and whether the vertex faces the leg (the inside of the shorts' hem, its turn-up)
      blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const wt = jw.getComponent(i, k);
        if (!wt) continue;
        bm.multiplyMatrices(bones[ji.getComponent(i, k)].matrixWorld, mesh.skeleton.boneInverses[ji.getComponent(i, k)]);
        for (let m = 0; m < 16; m++) blend.elements[m] += bm.elements[m] * wt;
      }
      M.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(blend).multiply(mesh.bindMatrix);
      const inner = Boolean(nrm) && l.fromBufferAttribute(nrm!, i).applyMatrix3(nmat.getNormalMatrix(M)).dot(off) < 0;
      let want: number, e = 1;
      if (isShorts) {
        // the shorts' lower thigh narrows onto the trouser leg (eased in from s0, so no edge where it starts), a hair
        // wider than the leg below so their hem always covers where the leg comes out; their inside stays inside
        e = Math.min(1, (P.s - s0) / EASE);
        e = e * e * (3 - 2 * e);
        want = r + ((inner ? t * 1.02 - 0.005 : t * 1.02) - r) * e;
      } else if (hidden) {
        // the bare leg still under the shorts stays inside them
        want = Math.min(r, t * 0.95);
      } else want = Math.max(r, t);
      if (Math.abs(want - r) < 1e-4) continue;
      w.copy(c).addScaledVector(off, want / r);
      A.copy(M).invert();
      l.copy(w).applyMatrix4(A);
      const cl = (v: number) => (pos.normalized ? Math.max(-1, Math.min(1, v)) : v);
      pos.setXYZ(i, cl(l.x), cl(l.y), cl(l.z));
      if (nrm) {
        // the cloth's normal points away from the leg line (the bare leg's bumps and the shorts' hem rim are gone; the
        // hidden leg's too, as it shades the triangles that come out from under the hem)
        l.copy(off).normalize().multiplyScalar(inner ? -1 : 1).applyMatrix3(nmat.getNormalMatrix(A)).normalize();
        const ox = nrm.getX(i), oy = nrm.getY(i), oz = nrm.getZ(i);
        l.set(ox + (l.x - ox) * e, oy + (l.y - oy) * e, oz + (l.z - oz) * e).normalize();
        nrm.setXYZ(i, l.x, l.y, l.z);
      }
      moved++;
    }
    const mark = (geo.userData.bareLegs as Uint8Array | undefined) ?? (geo.userData.bareLegs = new Uint8Array(nV));
    for (const i of legV) mark[i] = 1;
    geo.userData.shortsHemY = Math.max((geo.userData.shortsHemY as number | undefined) ?? -Infinity, hemY);
  }
  pos.needsUpdate = true;
  if (nrm) nrm.needsUpdate = true;
  geo.computeBoundingSphere();
  return moved;
}
