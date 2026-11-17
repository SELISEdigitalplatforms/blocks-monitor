/** The office floor of a client visit, west to east: Reception (logo wall, desk) → the glass Meeting room (table, live
 *  wall screen) → the open Engineering floor (the engineer's monitor) → the Build floor behind glass doors (the agents'
 *  desks, the big board). Floor y = 0, the entrance and the walkway are at +z, the back wall at z = -8.5.
 *  Movement happens only between these four places, along walking paths through real doors. */
import { t } from "@/i18n";

export type StageId = "reception" | "meeting" | "engineering" | "buildfloor";
export type Vec3 = [number, number, number];
export type XZ = [number, number];

export const STAGE_ORDER: StageId[] = ["reception", "meeting", "engineering", "buildfloor"];

export interface Stage {
  id: StageId;
  label: string;
  kicker: string;
  /** where the guides stand while talking, and the yaw they settle to (0 faces +z) */
  assistant: { at: Vec3; yaw: number };
  pm: { at: Vec3; yaw: number };
  /** the visitor's eyes (about 1.6 m), framed as a medium shot with the guides on the thirds */
  camera: { pos: Vec3; target: Vec3 };
  /** which side of each guide's head the speech bubble opens to (the side with free space) */
  bubble: { assistant: 1 | -1; pm: 1 | -1 };
}

export const STAGES: Record<StageId, Stage> = {
  // the Assistant waits just in front of the desk's left end, the logo wall centred behind
  reception: {
    id: "reception",
    get label() { return t("studio.cinematic.places.factory", "Factory"); },
    get kicker() { return t("studio.cinematic.places.welcome", "Welcome to MADP Factory"); },
    assistant: { at: [-0.25, 0, -1.05], yaw: 0.75 },
    pm: { at: [2.4, 0, -1.0], yaw: -0.6 },
    camera: { pos: [0.55, 1.6, 1.75], target: [0.45, 1.4, -2.6] },
    bubble: { assistant: -1, pm: 1 },
  },
  // a standing meeting at the table's near end, the two guides angled to each other and to the visitor
  meeting: {
    id: "meeting",
    get label() { return t("studio.cinematic.places.meetingRoom", "Meeting room"); },
    get kicker() { return t("studio.cinematic.places.discovery", "Discovery"); },
    assistant: { at: [9.3, 0, -2.6], yaw: 0.75 },
    pm: { at: [11.7, 0, -2.6], yaw: -0.75 },
    camera: { pos: [10.5, 1.58, 0.3], target: [10.5, 1.55, -5] },
    bubble: { assistant: -1, pm: 1 },
  },
  // either side of the engineer's monitor
  engineering: {
    id: "engineering",
    get label() { return t("studio.cinematic.places.engineering", "Engineering"); },
    get kicker() { return t("studio.cinematic.places.codeHome", "Your code home"); },
    assistant: { at: [18.4, 0, -0.55], yaw: 0.9 },
    pm: { at: [20.3, 0, -0.5], yaw: -0.9 },
    camera: { pos: [19.3, 1.6, 1.9], target: [19.45, 1.2, -1.6] },
    bubble: { assistant: -1, pm: 1 },
  },
  buildfloor: {
    id: "buildfloor",
    get label() { return t("studio.cinematic.places.buildFloor", "Build floor"); },
    get kicker() { return t("studio.cinematic.places.readyToBuild", "Ready to build"); },
    assistant: { at: [31.0, 0, 1.0], yaw: 0.7 },
    pm: { at: [33.0, 0, 1.0], yaw: -0.7 },
    camera: { pos: [32, 1.6, 3.3], target: [32, 1.45, -5] },
    bubble: { assistant: -1, pm: 1 },
  },
};

/** The walks between places: the visitor's path (eye height comes from the stages), and the guides' paths. */
export interface Walk {
  camera: XZ[];
  assistant: XZ[];
  pm?: XZ[];
}

export const WALKS: Record<Exclude<StageId, "reception">, Walk> = {
  // out of reception along the walkway, in through the meeting room's sliding glass door, to the table
  meeting: {
    camera: [[0.55, 1.75], [3.4, 2.9], [8.3, 2.2], [8.4, 0.1], [10.5, 0.3]],
    assistant: [[1.2, 0.9], [4.2, 2.5], [8.3, 1.5], [8.3, -0.9], [9.3, -2.6]],
  },
  // through the meeting room's east door onto the engineering floor
  engineering: {
    camera: [[10.5, 0.3], [12.8, -0.3], [14.6, -0.5], [17.4, 1.3], [19.3, 1.9]],
    assistant: [[10.2, -1.6], [12.9, -0.9], [14.6, -0.6], [16.6, -0.4], [18.4, -0.55]],
    pm: [[12.6, -1.6], [14.6, -0.9], [17.6, 0.4], [20.3, -0.5]],
  },
  // along the walkway and through the build floor's glass double doors
  buildfloor: {
    camera: [[19.3, 1.9], [22.6, 2.4], [24.5, 2.3], [28.0, 2.6], [32, 3.3]],
    assistant: [[21.0, 1.4], [24.5, 1.9], [28.0, 1.7], [31.0, 1.0]],
    pm: [[22.4, 0.9], [24.5, 2.6], [28.8, 2.4], [33.0, 1.0]],
  },
};

/** The business analyst joins the meeting midway: in from the walkway through the glass door. */
export const PM_JOIN: { from: Vec3; path: XZ[] } = {
  from: [3.6, 0, 3.4],
  path: [[8.3, 1.9], [8.3, -0.6], [10.5, -1.5], [11.7, -2.6]],
};

/** Doors that slide open when someone comes near (centre, axis the panels slide along, opening width). */
export const DOORS: { id: string; at: Vec3; axis: "x" | "z"; width: number; double?: boolean }[] = [
  { id: "meeting-front", at: [8.3, 0, 0.5], axis: "x", width: 1.5 },
  { id: "meeting-east", at: [14, 0, -0.5], axis: "z", width: 1.5 },
  { id: "build", at: [24.5, 0, 2.3], axis: "z", width: 2.4, double: true },
];

/** walking pace of the visitor's eyes (m/s), close to the guides' calm pace */
export const PACE = 0.95;

export function pathLength(p: XZ[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}

/** how long the walk to a place takes (ms), the same for the camera and the flow */
export function walkMs(to: StageId): number {
  if (to === "reception") return 0;
  return Math.round((pathLength(WALKS[to].camera) / PACE) * 1000 + 1400);
}

export const stageIndex = (id: StageId) => STAGE_ORDER.indexOf(id);
