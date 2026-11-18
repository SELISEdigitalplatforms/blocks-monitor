/** Shared accessory geometry and materials for the code-built characters. Each geometry is created
 *  lazily on first use, exists once, and is never disposed (characters mount with dispose={null}).
 *  Ported from MADP Studio; the Factory adds SecOps (beanie with a pompom, a shield) and Docs (a square
 *  cap with a tassel, a book). */

import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry } from "three";

function lazy<T>(make: () => T): () => T {
  let v: T | undefined;
  return () => (v ??= make());
}

/** a heater shield outline, 0.2 wide and 0.25 tall, centred on the origin */
export function shieldShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.1, 0.12);
  s.lineTo(0.1, 0.12);
  s.lineTo(0.1, 0.02);
  s.quadraticCurveTo(0.1, -0.08, 0, -0.13);
  s.quadraticCurveTo(-0.1, -0.08, -0.1, 0.02);
  s.closePath();
  return s;
}

const beret = lazy(() => new CylinderGeometry(0.2, 0.22, 0.07, 20));
const headphoneBand = lazy(() => new TorusGeometry(0.215, 0.025, 8, 24, Math.PI));
const earCup = lazy(() => new BoxGeometry(0.06, 0.12, 0.1));
const glassesRing = lazy(() => new TorusGeometry(0.05, 0.012, 6, 16));
const hardHat = lazy(() => new SphereGeometry(0.215, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
const hatBrim = lazy(() => new CylinderGeometry(0.26, 0.26, 0.025, 24));
const capDome = lazy(() => new SphereGeometry(0.205, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
const capPeak = lazy(() => new BoxGeometry(0.3, 0.02, 0.18));
const headlampBand = lazy(() => new TorusGeometry(0.205, 0.022, 8, 28));
const lamp = lazy(() => new CylinderGeometry(0.04, 0.05, 0.05, 12));
const wrenchHandle = lazy(() => new BoxGeometry(0.03, 0.2, 0.03));
const wrenchHead = lazy(() => new TorusGeometry(0.04, 0.014, 6, 12));
const visorBand = lazy(() => new CylinderGeometry(0.212, 0.212, 0.07, 24, 1, true));
const visorBrim = lazy(() => new BoxGeometry(0.28, 0.015, 0.14));
const chestBadge = lazy(() => new CylinderGeometry(0.055, 0.055, 0.02, 16));
const marker = lazy(() => new CylinderGeometry(0.018, 0.018, 0.16, 8));
const clipboard = lazy(() => new BoxGeometry(0.2, 0.26, 0.02));
// SecOps
const beanie = lazy(() => new SphereGeometry(0.218, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56));
const beanieCuff = lazy(() => new CylinderGeometry(0.224, 0.224, 0.07, 24, 1, true));
const pompom = lazy(() => new SphereGeometry(0.05, 12, 8));
const shield = lazy(() => new ExtrudeGeometry(shieldShape(), { depth: 0.025, bevelEnabled: false, curveSegments: 8 }));
// Docs
const capBand = lazy(() => new CylinderGeometry(0.17, 0.18, 0.08, 20));
const capBoard = lazy(() => new BoxGeometry(0.42, 0.02, 0.42));
const tassel = lazy(() => new CylinderGeometry(0.008, 0.008, 0.16, 6));
const tasselEnd = lazy(() => new SphereGeometry(0.022, 8, 6));
const bookCover = lazy(() => new BoxGeometry(0.17, 0.23, 0.06));
const bookPages = lazy(() => new BoxGeometry(0.16, 0.214, 0.048));

export const GEAR = {
  get beret() { return beret(); },
  get headphoneBand() { return headphoneBand(); },
  get earCup() { return earCup(); },
  get glassesRing() { return glassesRing(); },
  get hardHat() { return hardHat(); },
  get hatBrim() { return hatBrim(); },
  get capDome() { return capDome(); },
  get capPeak() { return capPeak(); },
  get headlampBand() { return headlampBand(); },
  get lamp() { return lamp(); },
  get wrenchHandle() { return wrenchHandle(); },
  get wrenchHead() { return wrenchHead(); },
  get visorBand() { return visorBand(); },
  get visorBrim() { return visorBrim(); },
  get chestBadge() { return chestBadge(); },
  get marker() { return marker(); },
  get clipboard() { return clipboard(); },
  get beanie() { return beanie(); },
  get beanieCuff() { return beanieCuff(); },
  get pompom() { return pompom(); },
  get shield() { return shield(); },
  get capBand() { return capBand(); },
  get capBoard() { return capBoard(); },
  get tassel() { return tassel(); },
  get tasselEnd() { return tasselEnd(); },
  get bookCover() { return bookCover(); },
  get bookPages() { return bookPages(); },
};

const materials = new Map<string, MeshStandardMaterial>();

/** Cached material; never mutate the result. */
export function gearMaterial(color: string, opts?: { ghost?: boolean; emissive?: boolean }): MeshStandardMaterial {
  const ghost = opts?.ghost === true;
  const emissive = opts?.emissive === true;
  const key = `${color}|${ghost}|${emissive}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.6 });
    if (ghost) {
      m.transparent = true;
      m.opacity = 0.45;
    }
    if (emissive) {
      m.emissive.set(color);
      m.emissiveIntensity = 0.9;
    }
    materials.set(key, m);
  }
  return m;
}
