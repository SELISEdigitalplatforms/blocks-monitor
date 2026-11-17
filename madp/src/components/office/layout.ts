/** The office floor plan (world units, y up, the room spans x -12..12 and z -8..8; the merge
 *  vestibule behind the repo-lock door spans x 12..15). Stations are the points of interest each
 *  role claims (The Delegation's POI idea). Ported from MADP Studio; the Factory adds the Security lab
 *  (right wall, between the test bench and the door) and the Docs desk (right wall, between the door and
 *  the release gate): both sit outside the walking lanes (the x 5.7..8.1 corridor and the front aisle). */

import type { AgentView, Role } from "./model";

export type Vec2 = { x: number; z: number };
export type Pose = "stand" | "sit" | "write" | "wait" | "slump" | "cheer" | "walk";

export interface Spot extends Vec2 {
  /** facing angle (radians, 0 = +z) once arrived */
  face: number;
  pose: Pose;
}

export const ROOM = { minX: -12, maxX: 12, minZ: -8, maxZ: 8, vestibuleMaxX: 15.5 };

/** desk centre for seat i: 4 columns x 3 rows, monitors face -z, the seat is at +z */
export function deskAt(i: number): Vec2 {
  const col = i % 4;
  const row = Math.floor(i / 4) % 3;
  return { x: -4.5 + col * 3, z: -2.6 + row * 3.1 };
}

export const STATION = {
  whiteboard: { x: -8, z: -7.55 },
  review: { x: -9.6, z: -1.6 },
  debug: { x: -9.4, z: 4.2 },
  bench: { x: 6.6, z: -7.1 },
  security: { x: 9.6, z: -3.4 },
  docs: { x: 10.2, z: 2.6 },
  supervisor: { x: 10.2, z: -6.4 },
  door: { x: 12, z: 0.2 },
  ship: { x: 8.6, z: 6.4 },
  lobbyBench: { x: -5.5, z: 7.1 },
  coffee: { x: 1.5, z: -7.45 },
};

/** Obstacles for path finding (axis-aligned rectangles, centre + half sizes, padded a little). */
export function obstacles(deskCount: number): Array<{ x: number; z: number; hx: number; hz: number }> {
  const desks = Array.from({ length: deskCount }, (_, i) => ({ ...deskAt(i), hx: 0.95, hz: 0.5 }));
  return [
    ...desks,
    { x: STATION.review.x, z: STATION.review.z, hx: 0.9, hz: 0.5 },
    { x: STATION.bench.x, z: STATION.bench.z, hx: 2.1, hz: 0.55 },
    { x: STATION.security.x, z: STATION.security.z, hx: 1.2, hz: 0.45 },
    { x: STATION.docs.x, z: STATION.docs.z, hx: 0.85, hz: 0.45 },
    { x: STATION.lobbyBench.x, z: STATION.lobbyBench.z + 0.2, hx: 1.6, hz: 0.3 },
    { x: 1.5, z: -7.45, hx: 1.0, hz: 0.4 },
    // the right wall, except the doorway at z 0.2 ± 0.8
    { x: 12, z: -4.4, hx: 0.15, hz: 3.8 },
    { x: 12, z: 4.6, hx: 0.15, hz: 3.6 },
    // plants
    { x: -11, z: -7, hx: 0.45, hz: 0.45 },
    { x: 11, z: 7, hx: 0.45, hz: 0.45 },
  ];
}

const facing = (from: Vec2, to: Vec2) => Math.atan2(to.x - from.x, to.z - from.z);

export type AmbientPlace = "bench" | "coffee";

/** Where idle agents hang out: the queue bench (seats 0-3, then standing beside it) or the coffee corner. */
export function ambientSpot(place: AmbientPlace, slot: number): Spot {
  if (place === "bench") {
    if (slot < 4) return { x: STATION.lobbyBench.x - 1.2 + slot * 0.8, z: STATION.lobbyBench.z, face: Math.PI, pose: "sit" };
    return { x: STATION.lobbyBench.x + 2.6, z: STATION.lobbyBench.z - ((slot - 4) % 4) * 0.7, face: -Math.PI / 2, pose: "stand" };
  }
  switch (slot) {
    case 0: return { x: 0.9, z: -6.55, face: Math.PI, pose: "stand" };
    case 1: return { x: 2.1, z: -6.55, face: Math.PI, pose: "stand" };
    case 2: return { x: 0.6, z: -5.6, face: Math.PI / 2, pose: "stand" };
    case 3: return { x: 2.4, z: -5.6, face: -Math.PI / 2, pose: "stand" };
    default: return { x: -0.4 - ((slot - 4) % 4) * 0.7, z: -6.2, face: Math.PI / 2, pose: "stand" };
  }
}

/** Where an agent should be and what it is doing there. "waiting" (blocked, or holding work it sent
 *  back) is the foot-tapping wait pose at the agent's own station. */
export function spotFor(a: AgentView, all: AgentView[], queueIndex = 0): Spot {
  const peers = all.filter((x) => x.role === a.role);
  const i = Math.max(0, peers.indexOf(a));
  const failed = a.status === "fail";
  const waiting = a.status === "waiting";
  const done = a.status === "pass" || a.status === "done";
  const role: Role = a.role;
  switch (role) {
    case "planner": {
      const p = { x: STATION.whiteboard.x + 0.4, z: STATION.whiteboard.z + 1.25 };
      return { ...p, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : a.status === "working" ? "write" : done ? "cheer" : "stand" };
    }
    case "dev": {
      if (a.status === "queued") return ambientSpot("bench", i % 4);
      const d = deskAt(i);
      return { x: d.x, z: d.z + 0.85, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : done ? "stand" : "sit" };
    }
    case "reviewer":
      return { x: STATION.review.x, z: STATION.review.z + 0.85, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : a.status === "working" ? "sit" : "stand" };
    case "fixup":
      return { x: STATION.debug.x - 0.1, z: STATION.debug.z, face: -Math.PI / 2, pose: failed ? "slump" : waiting ? "wait" : a.status === "working" ? "sit" : "stand" };
    case "qa": {
      const x = STATION.bench.x - 1.2 + (i % 3) * 1.2;
      return { x, z: STATION.bench.z + 1.15, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : done ? "cheer" : "stand" };
    }
    case "secops": {
      const x = STATION.security.x - 0.3 + (i % 2) * 0.9;
      return { x, z: STATION.security.z + 1.1, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : done ? "cheer" : "stand" };
    }
    case "docs":
      return { x: STATION.docs.x, z: STATION.docs.z + 0.85, face: Math.PI, pose: failed ? "slump" : waiting ? "wait" : a.status === "working" ? "sit" : "stand" };
    case "integrator": {
      if (a.status === "waiting") return { x: 10.9 - queueIndex * 0.9, z: STATION.door.z + 1.4, face: Math.PI / 2, pose: "wait" };
      if (a.status === "working") return { x: 13.6, z: STATION.door.z, face: Math.PI / 2, pose: "stand" };
      return { x: 10.4, z: STATION.door.z - 1.2, face: Math.PI / 2, pose: failed ? "slump" : done ? "cheer" : "stand" };
    }
    case "shipper": {
      const p = { x: STATION.ship.x - 1.4 + i * 1.1, z: STATION.ship.z - 0.6 };
      return { ...p, face: facing(p, STATION.ship), pose: failed ? "slump" : waiting ? "wait" : done ? "cheer" : "stand" };
    }
    case "autopilot":
      return { x: STATION.supervisor.x, z: STATION.supervisor.z + 0.9, face: Math.PI, pose: "sit" };
  }
}

/** Where a character enters the room. */
export const SPAWN: Vec2 = { x: 0, z: 7.6 };

/** Ghost spots for other runs waiting at the door (after this run's integrator). */
export function queueSpot(k: number): Vec2 {
  return { x: 10.9 - k * 0.9, z: STATION.door.z + 1.4 };
}
