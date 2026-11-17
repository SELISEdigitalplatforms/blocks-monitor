/** Path finding on a 0.25-unit grid with A* and line-of-sight smoothing: a small stand-in for
 *  The Delegation's navmesh, enough for an open-plan office with desks as obstacles. */

import { ROOM, type Vec2 } from "./layout";

const CELL = 0.25;
const W = Math.round((ROOM.vestibuleMaxX - ROOM.minX) / CELL);
const H = Math.round((ROOM.maxZ - ROOM.minZ) / CELL);
const R = 0.32; // character radius

type Rect = { x: number; z: number; hx: number; hz: number };

export class NavGrid {
  private blocked: Uint8Array;

  constructor(rects: Rect[]) {
    this.blocked = new Uint8Array(W * H);
    for (let gz = 0; gz < H; gz++) {
      for (let gx = 0; gx < W; gx++) {
        const p = this.world(gx, gz);
        let b = p.x > ROOM.maxX + 0.1 && (p.z < -1.6 || p.z > 2.0); // vestibule is a short corridor
        for (const r of rects) {
          if (Math.abs(p.x - r.x) < r.hx + R && Math.abs(p.z - r.z) < r.hz + R) { b = true; break; }
        }
        if (p.x < ROOM.minX + R || p.z < ROOM.minZ + R || p.z > ROOM.maxZ - R || p.x > ROOM.vestibuleMaxX - R) b = true;
        this.blocked[gz * W + gx] = b ? 1 : 0;
      }
    }
  }

  private world(gx: number, gz: number): Vec2 {
    return { x: ROOM.minX + (gx + 0.5) * CELL, z: ROOM.minZ + (gz + 0.5) * CELL };
  }

  private cell(p: Vec2): [number, number] {
    return [
      Math.min(W - 1, Math.max(0, Math.floor((p.x - ROOM.minX) / CELL))),
      Math.min(H - 1, Math.max(0, Math.floor((p.z - ROOM.minZ) / CELL))),
    ];
  }

  private free(gx: number, gz: number) {
    return gx >= 0 && gz >= 0 && gx < W && gz < H && !this.blocked[gz * W + gx];
  }

  /** nearest free cell (targets sit next to desks, inside the padding) */
  private nearestFree(gx: number, gz: number): [number, number] {
    if (this.free(gx, gz)) return [gx, gz];
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.free(gx + dx, gz + dz)) return [gx + dx, gz + dz];
        }
      }
    }
    return [gx, gz];
  }

  private sight(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const [gx, gz] = this.cell({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      if (!this.free(gx, gz)) return false;
    }
    return true;
  }

  /** Waypoints from `from` to `to` (both included), smoothed. Falls back to a straight line. */
  path(from: Vec2, to: Vec2): Vec2[] {
    const [sx, sz] = this.nearestFree(...this.cell(from));
    const [tx, tz] = this.nearestFree(...this.cell(to));
    const start = sz * W + sx;
    const goal = tz * W + tx;
    const g = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const open: number[] = [start];
    const f = new Float32Array(W * H).fill(Infinity);
    g[start] = 0;
    const hfn = (i: number) => Math.hypot((i % W) - tx, Math.floor(i / W) - tz);
    f[start] = hfn(start);
    let found = false;
    let guard = 0;
    while (open.length && guard++ < 40000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      const cx = cur % W;
      const cz = Math.floor(cur / W);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.free(nx, nz)) continue;
          if (dx && dz && (!this.free(cx + dx, cz) || !this.free(cx, cz + dz))) continue;
          const ni = nz * W + nx;
          if (closed[ni]) continue;
          const ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            f[ni] = ng + hfn(ni);
            if (!open.includes(ni)) open.push(ni);
          }
        }
      }
    }
    if (!found) return [from, to];
    const cells: Vec2[] = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(this.world(i % W, Math.floor(i / W)));
    cells.reverse();
    cells[0] = from;
    cells.push(to);
    // string pulling
    const out: Vec2[] = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.sight(cells[anchor], cells[i])) {
        out.push(cells[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}
