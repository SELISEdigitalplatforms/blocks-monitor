import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { STAGE_FOV, frameSpots, roomHome, type Home } from "./fit";

/** the room's outer corners (Furniture.tsx Room and ShipGate): slab edge, wall tops, vestibule, the gate's beam */
const ROOM = [
  [-12.2, -0.3, 8.2], [12.2, -0.3, 8.2], [12.2, -0.3, -8.2], [-12.2, -0.3, -8.2],
  [-12.3, 2.6, -8.3], [12.2, 2.6, -8.3], [-12.3, 2.6, 8.2], [12.2, 1.8, 8.2], [12.2, 1.8, -8.2],
  [15.5, -0.24, 2.1], [15.5, -0.24, -1.7], [7.35, 2.45, 6.6], [9.85, 2.45, 6.6],
] as const;

/** screen box (px) of the given points seen from a home view on a w x h stage */
function box(home: Home, w: number, h: number, points: readonly (readonly [number, number, number])[]) {
  const cam = new PerspectiveCamera(STAGE_FOV, w / h, 0.5, 400);
  cam.position.set(...home.position);
  cam.lookAt(new Vector3(...home.target));
  cam.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const v = new Vector3(...p).project(cam);
    const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

describe("roomHome", () => {
  it("shows the whole room inside every card size, centred on the axis that binds", () => {
    for (const [w, h] of [[929, 480], [752, 440], [1180, 540], [520, 300], [360, 420]]) {
      const b = box(roomHome({ width: w, height: h }), w, h, ROOM);
      expect(b.x0).toBeGreaterThan(0);
      expect(b.y0).toBeGreaterThan(0);
      expect(b.x1).toBeLessThan(w);
      expect(b.y1).toBeLessThan(h);
      // centred: the free space left and right (and above and below) differs by a few pixels at most
      expect(Math.abs(b.x0 - (w - b.x1))).toBeLessThan(3);
      expect(Math.abs(b.y0 - (h - b.y1))).toBeLessThan(3);
      // and large: the room fills the card on one axis (the margin is 3 % of the size on each side)
      expect(Math.max((b.x1 - b.x0) / w, (b.y1 - b.y0) / h)).toBeGreaterThan(0.9);
    }
  });

  it("keeps the room below a header the host draws over the top", () => {
    const w = 929, h = 480, top = 104;
    const b = box(roomHome({ width: w, height: h, top }), w, h, ROOM);
    expect(b.y0).toBeGreaterThan(top);
    expect(b.y1).toBeLessThan(h);
  });
});

describe("frameSpots", () => {
  it("frames the spots in the part left of a docked panel", () => {
    const w = 1000, h = 600, right = 384;
    const spots = [{ x: -8, z: -6 }, { x: -6, z: -5 }];
    const home = frameSpots({ width: w, height: h, spots, minD: 9, maxD: 42, right });
    const b = box(home, w, h, spots.flatMap((s) => [[s.x, 0, s.z], [s.x, 2.05, s.z]] as const));
    expect(b.x0).toBeGreaterThan(0);
    expect(b.x1).toBeLessThan(w - right);
    // roughly in the middle of the free part
    expect(Math.abs((b.x0 + b.x1) / 2 - (w - right) / 2)).toBeLessThan(60);
  });
});
