/**
 * The cinematic new-project journey as pure data: which room each journey step happens in, per project type, and the
 * world positions the camera walks through. No React, DOM or three.js imports, so it is unit-tested (test/cinematic.test.ts).
 *
 * World (metres, y up; the visitor's eye is at EYE):
 *   lobby (street side)  z  6 … 18   two entrances in the facade at z = 6
 *   coffee shop          x -10 … -2, z -4 … 6   (greenfield)
 *   meeting room         x   2 … 10, z -4 … 6   (brownfield)
 *   corridor             x -10 … 10, z -8 … -4  (behind both rooms)
 *   product team room    x  -4 … 4,  z -16 … -8 (the next step's room)
 */
import { walkProfile } from "@/components/characters/gait";
import { STEP_LABEL, type JourneyStep } from "@/domain/journey";
import { stepLabelFor } from "@/domain/projectType";
import { t } from "@/i18n";

export type CinematicType = "greenfield" | "brownfield";

export const CINEMATIC_TYPES: readonly { id: CinematicType; label: string; room: string; text: string }[] = [
  {
    id: "greenfield",
    get label() { return t("studio.cinematic.types.newProduct", "New product"); },
    get room() { return t("studio.cinematic.places.coffeeShop", "Coffee shop"); },
    get text() { return t("studio.cinematic.types.newProductText", "Meet the business agent over coffee and tell it what to build."); },
  },
  {
    id: "brownfield",
    get label() { return t("studio.cinematic.types.existingProduct", "Existing product"); },
    get room() { return t("studio.cinematic.places.meetingRoom", "Meeting room"); },
    get text() { return t("studio.cinematic.types.existingProductText", "Sit down with the business agent and describe what should change."); },
  },
];

export type RoomId = "cafe" | "meeting" | "product" | "workshop" | "review" | "studio" | "launch";

export interface StepScene {
  step: JourneyStep;
  /** the step's name as the step pages show it */
  label: string;
  room: RoomId;
  /** the place, as the visitor sees it */
  place: string;
  /** who meets the visitor there */
  host: string;
  /** true when the room is built in the 3D world today */
  built: boolean;
}

/** The step's name for the project type (brownfield renames steps 2 and 3; see src/domain/projectType.ts). */
export function stepLabel(type: CinematicType, step: JourneyStep): string {
  return stepLabelFor(type, step)?.label ?? STEP_LABEL[step];
}

const ROOMS: Record<CinematicType, Record<JourneyStep, Omit<StepScene, "step" | "label">>> = {
  greenfield: {
    business: { room: "cafe", get place() { return t("studio.cinematic.places.coffeeShop", "Coffee shop"); }, get host() { return t("studio.cinematic.hosts.businessAgent", "Business agent"); }, built: true },
    understanding: { room: "review", get place() { return t("studio.cinematic.places.reviewRoom", "Review room"); }, get host() { return t("studio.cinematic.hosts.you", "You"); }, built: true },
    sanitization: { room: "product", get place() { return t("studio.cinematic.places.analystOffice", "Business analyst's office"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: true },
    requirements: { room: "workshop", get place() { return t("studio.cinematic.places.requirementsWorkshop", "Requirements workshop"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: false },
    scope: { room: "review", get place() { return t("studio.cinematic.places.scopeReviewRoom", "Scope review room"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: false },
    board: { room: "studio", get place() { return t("studio.cinematic.places.buildStudio", "Build studio"); }, get host() { return t("studio.cinematic.hosts.engineeringTeam", "Engineering team"); }, built: false },
    build: { room: "studio", get place() { return t("studio.cinematic.places.buildStudio", "Build studio"); }, get host() { return t("studio.cinematic.hosts.engineeringTeam", "Engineering team"); }, built: false },
    release: { room: "launch", get place() { return t("studio.cinematic.places.launchDeck", "Launch deck"); }, get host() { return t("studio.cinematic.hosts.releaseManager", "Release manager"); }, built: false },
  },
  brownfield: {
    business: { room: "meeting", get place() { return t("studio.cinematic.places.meetingRoom", "Meeting room"); }, get host() { return t("studio.cinematic.hosts.businessAgent", "Business agent"); }, built: true },
    understanding: { room: "review", get place() { return t("studio.cinematic.places.reviewRoom", "Review room"); }, get host() { return t("studio.cinematic.hosts.you", "You"); }, built: true },
    sanitization: { room: "product", get place() { return t("studio.cinematic.places.productAnalysisLab", "Product analysis lab"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: true },
    requirements: { room: "workshop", get place() { return t("studio.cinematic.places.changeWorkshop", "Change workshop"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: false },
    scope: { room: "review", get place() { return t("studio.cinematic.places.scopeReviewRoom", "Scope review room"); }, get host() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); }, built: false },
    board: { room: "studio", get place() { return t("studio.cinematic.places.buildStudio", "Build studio"); }, get host() { return t("studio.cinematic.hosts.engineeringTeam", "Engineering team"); }, built: false },
    build: { room: "studio", get place() { return t("studio.cinematic.places.buildStudio", "Build studio"); }, get host() { return t("studio.cinematic.hosts.engineeringTeam", "Engineering team"); }, built: false },
    release: { room: "launch", get place() { return t("studio.cinematic.places.launchDeck", "Launch deck"); }, get host() { return t("studio.cinematic.hosts.releaseManager", "Release manager"); }, built: false },
  },
};

export function sceneFor(type: CinematicType, step: JourneyStep): StepScene {
  return { step, label: stepLabel(type, step), ...ROOMS[type][step] };
}

/** The stops of the journey in order, one per room (Board and Build share the build studio and show once, as Build). */
export function journeyStops(type: CinematicType): StepScene[] {
  const order: JourneyStep[] = ["business", "sanitization", "requirements", "scope", "build", "release"];
  return order.map((s) => sceneFor(type, s));
}

/* ── the world and the camera's walks ───────────────────────────────────── */

export type V3 = readonly [number, number, number];
export interface Waypoint { at: V3; look: V3 }

export const EYE = 1.62;
/** the visitor's cruising pace, metres per second (they speed up to it and slow down from it: walkProfile) */
export const WALK_SPEED = 1.35;

/** −1 for the coffee shop (west), +1 for the meeting room (east) */
export const side = (type: CinematicType): -1 | 1 => (type === "greenfield" ? -1 : 1);

export const ROOM_X = 6;
export const BACK_DOOR_X = 3.5;
/** where the business agent stands, facing the visitor (+z) */
export const agentSpot = (type: CinematicType): V3 => [side(type) * ROOM_X, 0, -0.6];
export const PRODUCT_DOOR: V3 = [0, 0, -8];
export const PM_SPOT: V3 = [0, 0, -12.2];
/** step 2: where the business analyst walks to, beside the team's board, once the project is handed over */
export const BOARD_SPOT: V3 = [-3.0, 0, -13.5];

export const LOBBY: Waypoint = { at: [0, EYE, 15], look: [0, 1.55, 6] };

const talkSpot = (type: CinematicType): Waypoint => {
  const x = side(type) * ROOM_X;
  return { at: [x, EYE, 1.95], look: [x, 1.5, -0.6] };
};

const doorSpot: Waypoint = { at: [0, EYE, -4.8], look: [0, 1.7, -8] };

/** From the lobby, through the chosen room's entrance, to the table where the agent waits. */
export function enterPath(type: CinematicType): Waypoint[] {
  const x = side(type) * ROOM_X;
  return [
    LOBBY,
    { at: [x * 0.7, EYE, 10], look: [x, 1.7, 6] },
    { at: [x, EYE, 7.2], look: [x, 1.6, 3] },
    { at: [x, EYE, 4.6], look: [x, 1.5, 0] },
    talkSpot(type),
  ];
}

/** From the table, out of the room's back door and along the corridor to the product team's door. */
export function leavePath(type: CinematicType): Waypoint[] {
  const s = side(type);
  const bx = s * BACK_DOOR_X;
  return [
    talkSpot(type),
    { at: [s * 4.4, EYE, 2.3], look: [bx, 1.7, -4] },
    { at: [bx, EYE, -2.4], look: [bx, 1.7, -6] },
    { at: [bx, EYE, -4.7], look: [bx * 0.5, 1.7, -8] },
    { at: [s * 1.4, EYE, -5.2], look: [0, 1.7, -8] },
    doorSpot,
  ];
}

const pmSpot: Waypoint = { at: [0, EYE, -9.4], look: [0, 1.45, PM_SPOT[2]] };

/** Through the open door into the product team's room. */
export function throughPath(): Waypoint[] {
  return [doorSpot, { at: [0, EYE, -7.2], look: [0, 1.5, -12] }, pmSpot];
}

/** Where the visitor ends step 2's walk: in front of the team's board, the business analyst beside it. */
export const BOARD_VIEW: Waypoint = { at: [-1.0, EYE, -10.5], look: [-2.9, 1.3, -13.0] };

/** Step 2: handed over, on to the product team's board (Product sanitization / Existing product analysis starts there). */
export function onwardPath(): Waypoint[] {
  // the gaze goes with the business analyst on the way to the board
  return [pmSpot, { at: [-0.5, EYE, -9.9], look: [-1.5, 1.4, -12.8] }, BOARD_VIEW];
}

/** The business analyst's own walk in step 2 (floor points, metres) and the way they face at the end: towards the visitor. */
export function rajivWalk(): { path: V3[]; face: number } {
  const [x, , z] = BOARD_SPOT;
  return { path: [PM_SPOT, BOARD_SPOT], face: Math.atan2(BOARD_VIEW.at[0] - x, BOARD_VIEW.at[2] - z) };
}

export type PathKey = "lobby" | "enter" | "leave" | "through" | "onward";

export function pathFor(key: PathKey, type: CinematicType | null): Waypoint[] {
  if (key === "lobby" || !type) return [LOBBY];
  if (key === "enter") return enterPath(type);
  if (key === "leave") return leavePath(type);
  if (key === "onward") return onwardPath();
  return throughPath();
}

/** Length of a walk along its waypoints (straight segments: a lower bound of the smoothed path). */
export function pathLength(path: readonly Waypoint[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1].at, path[i].at];
    d += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return d;
}

/** Seconds the camera takes to walk a path at a human pace (speeding up, cruising, slowing down), never shorter than a beat. */
export function walkSeconds(path: readonly Waypoint[]): number {
  return Math.max(1.2, walkProfile(pathLength(path), WALK_SPEED).duration);
}

/** Smooth start and stop of a walk (smootherstep), t in 0..1. */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/* ── walls ─────────────────────────────────────────────────────────────── */

/** An opening in a wall: centre along the wall, width, bottom and top (a door has bottom 0). */
export interface Opening { at: number; w: number; y0: number; y1: number }

/** Pure: the solid boxes of a wall from a to b (along its axis) with openings cut out: [centre, length, y0, y1][] */
export function wallPieces(a: number, b: number, h: number, openings: readonly Opening[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const sorted = [...openings].sort((x, y) => x.at - y.at);
  let from = a;
  for (const o of sorted) {
    const l = o.at - o.w / 2;
    const r = o.at + o.w / 2;
    if (l > from) out.push([(from + l) / 2, l - from, 0, h]);
    if (o.y0 > 0) out.push([o.at, o.w, 0, o.y0]);
    if (o.y1 < h) out.push([o.at, o.w, o.y1, h]);
    from = r;
  }
  if (b > from) out.push([(from + b) / 2, b - from, 0, h]);
  return out;
}
