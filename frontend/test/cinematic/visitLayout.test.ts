import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { bubbleBox, canSend, composerState, EDGE, frameSpeaker, MAX_DISTANCE, sendsOnEnter, stageLayout, TOP_BAR } from "../../src/components/cinematic/visit/layout";
import type { ComposerSpec } from "../../src/components/cinematic/visit/chat";
import { STAGES } from "../../src/components/cinematic/journey/places";

const text: ComposerSpec = { mode: "text", label: "Your answer" };
const choose: ComposerSpec = { mode: "none", label: "Your answer", replies: [{ id: "a", label: "A" }] };

function project(f: ReturnType<typeof frameSpeaker>, aspect: number, p: [number, number, number]) {
  const cam = new PerspectiveCamera(50, aspect, 0.05, 80);
  cam.position.set(...f.pos);
  cam.lookAt(...f.target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return new Vector3(...p).project(cam);
}

describe("the office's layout: a room, a bubble, a slim input", () => {
  it("has no panel: the person stands in the room, the step list beside it when there is room", () => {
    const laptop = stageLayout({ w: 1440, h: 900 });
    expect(laptop.mode).toBe("wide");
    expect(laptop.steps.shown).toBe(true);
    expect(laptop.input.width).toBeLessThanOrEqual(680);
    expect(stageLayout({ w: 1024, h: 700 }).steps.shown).toBe(false);
    const phone = stageLayout({ w: 390, h: 844 });
    expect(phone.mode).toBe("phone");
    expect(phone.input.width).toBe(390 - 24);
  });

  const head = (x: number, y: number, r = 34) => ({ x, y, r, top: y - 60, bottom: y + 40 });
  const overlaps = (b: { left: number; top: number; width: number }, h: ReturnType<typeof head>, height: number) =>
    b.left < h.x + h.r && b.left + b.width > h.x - h.r && b.top < h.bottom && b.top + height > h.top;

  it("never puts the bubble on the face, ears or hair: clear of the head's whole box, at every size and spot", () => {
    for (const vp of [{ w: 1024, h: 700 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 }]) {
      const l = stageLayout(vp);
      // the head where the layout puts it, and anywhere else the walk can take it
      for (const fx of [l.speaker.x, 0.15, 0.3, 0.5, 0.7, 0.85, 0.97]) {
        for (const r of [20, 34, 60]) {
          const h = head(fx * vp.w, vp.h * 0.32, r);
          const b = bubbleBox(h, 140, vp, l);
          expect(overlaps(b, h, 140)).toBe(false);
          expect(b.left).toBeGreaterThanOrEqual(EDGE - 1);
          expect(b.top).toBeGreaterThanOrEqual(TOP_BAR);
          if (b.side === "right") expect(b.left).toBeGreaterThanOrEqual(h.x + h.r + 20);
          if (b.side === "left") expect(b.left + b.width).toBeLessThanOrEqual(h.x - h.r - 20);
          if (l.steps.shown && b.side === "left") expect(b.left).toBeGreaterThanOrEqual(l.steps.left + l.steps.width);
        }
      }
    }
    // a head near the right edge: the bubble goes to its left
    const l = stageLayout({ w: 1440, h: 900 });
    expect(bubbleBox(head(1300, 300), 120, { w: 1440, h: 900 }, l).side).toBe("left");
  });

  it("puts the bubble above the top of the head on a phone, below the top bar and above the input", () => {
    const vp = { w: 390, h: 844 };
    const l = stageLayout(vp);
    const h = head(195, 360);
    const b = bubbleBox(h, 120, vp, l);
    expect(b.side).toBe("above");
    expect(b.top + 120).toBeLessThanOrEqual(h.top);
    expect(b.top).toBeGreaterThanOrEqual(TOP_BAR);
    expect(b.width).toBe(vp.w - 32);
  });

  it("frames the speaking person where the layout wants them, and stays in the room", () => {
    for (const vp of [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 1024, h: 700 }, { w: 390, h: 844 }]) {
      const l = stageLayout(vp);
      const aspect = vp.w / vp.h;
      for (const [stage, role] of [["reception", "assistant"], ["meeting", "pm"]] as const) {
        const s = STAGES[stage][role];
        const f = frameSpeaker({ at: s.at, yaw: s.yaw, aspect, fov: 50, ...l.speaker, maxDistance: MAX_DISTANCE[stage] });
        expect(f.distance).toBeLessThanOrEqual(MAX_DISTANCE[stage]);
        const head = project(f, aspect, [s.at[0], 1.74, s.at[2]]);
        expect((head.x + 1) / 2).toBeCloseTo(l.speaker.x, 1);
        expect(Math.abs(head.y)).toBeLessThan(1);
      }
      // at the meeting table the visitor stands inside the glass room (its front is at z 0.5)
      const pm = STAGES.meeting.pm;
      expect(frameSpeaker({ at: pm.at, yaw: pm.yaw, aspect, fov: 50, ...l.speaker, maxDistance: MAX_DISTANCE.meeting }).pos[2]).toBeLessThan(0.5);
    }
  });

  it("knows the input's states: typed words are always welcome, Send waits while the other side thinks", () => {
    expect(composerState(null, false)).toBe("closed");
    expect(composerState(text, false)).toBe("write");
    expect(composerState(text, true)).toBe("wait");
    expect(composerState(choose, false)).toBe("choose");
    expect(canSend("write", "  hi ")).toBe(true);
    expect(canSend("choose", "yes")).toBe(true);
    expect(canSend("write", "   ")).toBe(false);
    expect(canSend("wait", "hi")).toBe(false);
    expect(canSend("closed", "hi")).toBe(false);
  });

  it("sends on Enter, makes a new line on Shift + Enter, never while composing", () => {
    expect(sendsOnEnter({ key: "Enter" })).toBe(true);
    expect(sendsOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendsOnEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(sendsOnEnter({ key: "a" })).toBe(false);
  });
});
