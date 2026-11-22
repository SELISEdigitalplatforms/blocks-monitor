import { describe, expect, it } from "vitest";
import {
  BEHIND, cameraWay, corridor, ESCORT_ASSISTANT, escortCameraPath, FOLLOW, followShare, pathLength, pointAt, progressOf,
} from "../../src/components/cinematic/visit/escort";
import { frameSpeaker, MAX_DISTANCE, stageLayout } from "../../src/components/cinematic/visit/layout";
import { DOORS, STAGES, type XZ } from "../../src/components/cinematic/journey/places";

const door = DOORS.find((d) => d.id === "meeting-front")!;

/** where a polyline crosses the door's line near the door (x 5..12), or null */
function crossing(p: readonly XZ[], z: number): number | null {
  for (let i = 1; i < p.length; i++) {
    const [x0, z0] = p[i - 1];
    const [x1, z1] = p[i];
    if ((z0 - z) * (z1 - z) <= 0 && z0 !== z1) {
      const x = x0 + ((z - z0) / (z1 - z0)) * (x1 - x0);
      if (x > 5 && x < 12) return x;
    }
  }
  return null;
}

function views(w: number, h: number) {
  const l = stageLayout({ w, h });
  const frame = (role: "assistant" | "pm", stage: "reception" | "meeting") => {
    const s = STAGES[stage][role];
    const f = frameSpeaker({ at: s.at, yaw: s.yaw, aspect: w / h, fov: 50, ...l.speaker, maxDistance: MAX_DISTANCE[stage] });
    return [f.pos[0], f.pos[2]] as XZ;
  };
  return { from: frame("assistant", "reception"), to: frame("pm", "meeting") };
}

/** the escort, the assistant walking his way at a steady pace and the visitor following by the rule */
function walkIt(w: number, h: number) {
  const { from, to } = views(w, h);
  const way = cameraWay(from, to);
  let share = 0;
  let closest = Infinity;
  let ahead = Infinity;
  // the step aside, while he gestures
  share = followShare(way, ESCORT_ASSISTANT[0], share);
  for (let f = 0; f <= 1.0001; f += 0.002) {
    const a = pointAt(ESCORT_ASSISTANT, f);
    share = followShare(way, a, share, f >= 1);
    const c = way.points[Math.round(share * (way.points.length - 1))];
    closest = Math.min(closest, Math.hypot(a[0] - c[0], a[1] - c[1]));
    if (share > way.aside + 0.01 && f < 1) ahead = Math.min(ahead, corridor(a) - corridor(c));
  }
  return { share, closest, ahead };
}

describe("the escort to the meeting table", () => {
  it("goes through the meeting room's door, both of them, with room to spare", () => {
    const { from, to } = views(1440, 900);
    const lo = door.at[0] - door.width / 2 + 0.25;
    const hi = door.at[0] + door.width / 2 - 0.25;
    for (const p of [ESCORT_ASSISTANT, escortCameraPath(from, to)]) {
      const x = crossing(p, door.at[2]);
      expect(x).not.toBeNull();
      expect(x!).toBeGreaterThan(lo);
      expect(x!).toBeLessThan(hi);
    }
  });

  it("keeps the visitor behind the assistant and a person's distance away, all the way, on every screen", () => {
    for (const [w, h] of [[1440, 900], [1920, 1080], [1024, 700], [390, 844]]) {
      const r = walkIt(w, h);
      expect(r.closest).toBeGreaterThan(1.05);
      // once he has passed, he leads (along the corridor) by at least BEHIND
      expect(r.ahead).toBeGreaterThanOrEqual(BEHIND - 0.05);
      // and the visitor arrives where the analyst is in view
      expect(r.share).toBe(1);
    }
  });

  it("never walks back and never comes closer than a person's distance, wherever he is", () => {
    const { from, to } = views(1440, 900);
    const way = cameraWay(from, to);
    const there = followShare(way, [5, 1.35], 0.4);
    expect(there).toBeGreaterThanOrEqual(0.4);
    const c = way.points[Math.round(there * (way.points.length - 1))];
    expect(Math.hypot(c[0] - 5, c[1] - 1.35)).toBeGreaterThanOrEqual(FOLLOW);
    // him standing right in the way: the visitor waits where they are
    expect(followShare(way, way.points[200], 0.45)).toBe(0.45);
  });

  it("measures how far along his way someone is from the gait's remaining waypoints", () => {
    const total = pathLength(ESCORT_ASSISTANT);
    const left = ESCORT_ASSISTANT.slice(1).map(([x, z]) => ({ x, z }));
    expect(progressOf(ESCORT_ASSISTANT[0][0], ESCORT_ASSISTANT[0][1], left, total)).toBeCloseTo(0, 5);
    const end = ESCORT_ASSISTANT[ESCORT_ASSISTANT.length - 1];
    expect(progressOf(end[0], end[1], [], total)).toBe(1);
  });
});
