/**
 * The cast of MADP Factory: every person on the platform is a Microsoft Rocketbox avatar (MIT), built by
 * scripts/characters/build.mjs into public/madp/models/people-real, animated with the shared Rocketbox clips. One family,
 * one skeleton, one look. Mirrors scripts/characters/cast.json (test/characters.test.ts keeps them in step).
 * No React, no three.js: unit-tested.
 */

export const PEOPLE_BASE = "/madp/models/people-real/";

export type CharacterId = "phillip" | "rajiv" | "planner" | "developer" | "reviewer" | "tester" | "secops" | "docs" | "release";
export type Tier = "close" | "far";
export type Build = "m" | "f";

export interface Character {
  id: CharacterId;
  /** the name people see */
  name: string;
  role: string;
  build: Build;
  /** has a close-up file (1K textures, facial blend shapes) */
  close: boolean;
  /** the face at rest (close-ups): e.g. heavier eyelids */
  face?: { blink?: number };
}

/** Owner, 08.11.2026: no invented human names presented as people. The cast shows by role (the business analyst who
 *  plans and analyses with the client, the tech lead who builds); the ids stay as they were. */
export const CHARACTERS: Readonly<Record<CharacterId, Character>> = {
  phillip: { id: "phillip", name: "Business agent", role: "Business agent", build: "m", close: true },
  rajiv: { id: "rajiv", name: "Business analyst", role: "Business analyst", build: "m", close: true },
  planner: { id: "planner", name: "Business analyst", role: "Business analyst", build: "f", close: false },
  developer: { id: "developer", name: "Tech lead", role: "Tech lead", build: "m", close: false },
  reviewer: { id: "reviewer", name: "Reviewer", role: "Reviewer", build: "f", close: false },
  tester: { id: "tester", name: "Tester", role: "Tester", build: "f", close: false },
  secops: { id: "secops", name: "SecOps", role: "Security", build: "m", close: false },
  docs: { id: "docs", name: "Docs", role: "Documentation", build: "f", close: false },
  release: { id: "release", name: "Release gate", role: "Release gate", build: "m", close: false },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

/** The clips every person shares (one file per build): two idles and two talks for variety, a listening nod. */
export const CLIP_NAMES = ["idle", "idle2", "talk", "talk2", "listen", "nod", "wave", "walk", "sit"] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/** Within this distance (metres, camera to person) a close-up file is worth its download. */
export const CLOSE_RANGE = 4;

export function isCharacterId(v: unknown): v is CharacterId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CHARACTERS, v);
}

/** the model file for a person at a tier; a person without a close-up file always uses the far one */
export function modelUrl(id: CharacterId, tier: Tier): string {
  const c = CHARACTERS[id];
  return `${PEOPLE_BASE}${id}.${tier === "close" && c.close ? "close" : "far"}.glb`;
}

export function clipsUrl(id: CharacterId): string {
  return `${PEOPLE_BASE}anims-${CHARACTERS[id].build}.glb`;
}

export function tierFor(id: CharacterId, distance: number): Tier {
  return CHARACTERS[id].close && distance < CLOSE_RANGE ? "close" : "far";
}

/** Which person plays each office agent role; the index (an agent's place among agents of the same role) walks the
 *  pool so two agents of one role are two people. Unknown roles: null (the office keeps its code-built body). */
export const ROLE_POOLS: Readonly<Record<string, readonly CharacterId[]>> = {
  planner: ["planner", "rajiv"],
  dev: ["developer", "secops", "release"],
  fixup: ["developer", "release"],
  reviewer: ["reviewer", "docs"],
  qa: ["tester", "planner"],
  secops: ["secops", "developer"],
  docs: ["docs", "reviewer"],
  integrator: ["release", "developer"],
  shipper: ["release", "phillip"],
  autopilot: ["phillip"],
};

export function castForRole(role: string, index: number): CharacterId | null {
  const pool = ROLE_POOLS[role];
  if (!pool?.length) return null;
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return pool[i % pool.length];
}

/** Every file a set of people needs (models and their clip files), without duplicates. */
export function filesFor(people: readonly { id: CharacterId; tier: Tier }[]): string[] {
  const out = new Set<string>();
  for (const p of people) {
    out.add(modelUrl(p.id, p.tier));
    out.add(clipsUrl(p.id));
  }
  return [...out];
}

/** glTF extensions that need a WebAssembly decoder (blocked by the app's CSP: no 'wasm-unsafe-eval'). */
export const WASM_EXTENSIONS = ["EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_draco_mesh_compression", "KHR_texture_basisu"] as const;

/** the WebAssembly-only extensions a glTF's JSON requires or uses (empty when it decodes natively) */
export function wasmExtensionsIn(json: { extensionsRequired?: string[]; extensionsUsed?: string[] }): string[] {
  const all = new Set([...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])]);
  return WASM_EXTENSIONS.filter((e) => all.has(e));
}
