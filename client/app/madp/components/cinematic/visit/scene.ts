/** The bridge between the office visit and the 3D floor (no React): who the visitor talks to, where the layout wants
 *  them on screen (the camera frames them there), a "snap" counter that puts the camera and the guides straight at the
 *  place in use (a skipped walk, a visit resumed at the table), and two per-frame channels written by the floor and
 *  read without re-rendering anything: where each person's head is on screen (the speech bubble follows it) and where
 *  the escort is (the camera follows the assistant). The floor's own movement state (the place, a walk in progress)
 *  stays in the journey store, which the floor already reads. */
import { create } from "zustand";
import { STAGES, type StageId } from "../journey/places";
import { frameSpeaker, MAX_DISTANCE, type V3 } from "./layout";

export interface OfficeScene {
  /** the office visit is on screen (the scripted promo film keeps its own framing) */
  office: boolean;
  /** who the camera frames */
  focus: "assistant" | "pm";
  /** where the layout wants the person: x as a fraction of the width, the head's height on screen, their share of it */
  framing: { x: number; headNdcY: number; heightShare: number };
  snapN: number;
  /** the person you talk to is thinking (working on what you asked): a thinking look */
  thinking: "assistant" | "pm" | null;
  set: (patch: Partial<Omit<OfficeScene, "set" | "snap">>) => void;
  snap: () => void;
}

export const useOfficeScene = create<OfficeScene>()((set) => ({
  office: false,
  focus: "assistant",
  framing: { x: 0.44, headNdcY: 0.42, heightShare: 0.78 },
  snapN: 0,
  thinking: null,
  set: (patch) => set(patch),
  snap: () => set((s) => ({ snapN: s.snapN + 1 })),
}));

/** Each person's head on screen, written by the floor every frame (CSS px of the canvas): the mouth (x, y), the head's
 *  half-width with ears, hair and a little sway (r), its top and bottom, and `on` when it is in front of the camera and
 *  inside the frame. The speech bubble keeps clear of this box. */
export interface HeadOnScreen { x: number; y: number; r: number; top: number; bottom: number; on: boolean }
export const heads: Record<"assistant" | "pm", HeadOnScreen> = {
  assistant: { x: 0, y: 0, r: 0, top: 0, bottom: 0, on: false },
  pm: { x: 0, y: 0, r: 0, top: 0, bottom: 0, on: false },
};

/** The escort as it happens, written by the assistant's walk every frame (no React state). */
export const escort = {
  /** the walk is under way (from the first step aside to the arrival) */
  active: false,
  /** where the assistant is now */
  x: 0,
  z: 0,
  /** he has arrived at the table and stopped */
  done: false,
  /** when the walk started (performance.now()) */
  startedAt: 0,
};

/** The visitor's resting view at a place in the office visit: in front of the guide they talk to, the guide where the
 *  layout leaves room, and never outside the room; null outside the office visit (the place's own view). */
export function officeView(stage: StageId, aspect: number, fov = 50): { pos: V3; target: V3 } | null {
  const s = useOfficeScene.getState();
  if (!s.office || stage === "engineering" || stage === "buildfloor") return null;
  const spot = STAGES[stage][s.focus];
  const f = frameSpeaker({ at: spot.at, yaw: spot.yaw, aspect, fov, ...s.framing, maxDistance: MAX_DISTANCE[stage] });
  return { pos: f.pos, target: f.target };
}

/** The view where the escort ends: the analyst at the table, framed for this screen. */
export function tableView(aspect: number, fov = 50): { pos: V3; target: V3 } {
  const s = useOfficeScene.getState();
  const spot = STAGES.meeting.pm;
  const f = frameSpeaker({ at: spot.at, yaw: spot.yaw, aspect, fov, ...s.framing, maxDistance: MAX_DISTANCE.meeting });
  return { pos: f.pos, target: f.target };
}
