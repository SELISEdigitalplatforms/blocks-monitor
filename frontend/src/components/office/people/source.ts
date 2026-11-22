/** The seam between the office and the people it shows. Character.tsx and Office3D.tsx only talk to the active
 *  PeopleSource: which model an agent wears, a prefetch after the room's first frame, and the component that shows and
 *  animates one person. The default is the CC0 Quaternius set (quaternius.ts, WebAssembly-free). Another set (e.g. the
 *  realistic people in src/components/characters/) plugs in with setPeopleSource() before the office mounts, without
 *  touching the office. Until a person reports ready (and for roles a set does not cast) the code-built body shows. */

import type { ComponentType, MutableRefObject } from "react";
import type { AgentStatus, Role } from "../model";

/** what the character is doing, written by Character every frame */
export interface PersonMotion {
  moving: boolean;
  /** walking speed (world units per second) */
  speed: number;
  seated: boolean;
  /** turning on the spot with small steps (a large turn from standing) */
  turning?: boolean;
}

/** what a person reports once drawn: its head height in world units (the office's people stand PERSON_HEIGHT tall) */
export interface PersonReady {
  headY: number;
}

export interface PersonSlotProps<M> {
  model: M;
  /** the agent's stable id (seeds per-person variation) */
  id: string;
  status: AgentStatus;
  ghost?: boolean;
  reducedMotion: boolean;
  /** selected for a chat: greet once when this turns true */
  facing?: boolean;
  motion: MutableRefObject<PersonMotion>;
  /** the person is in the scene and drawn: the code-built body hides */
  onReady: (person: PersonReady) => void;
}

export interface PeopleSource<M extends { id: string } = { id: string }> {
  name: string;
  /** the model an agent wears; index = its position among agents of the same role; null keeps the code-built body */
  castFor(role: Role, index: number): M | null;
  /** start downloading what these agents wear (called once the room has drawn its first frame) */
  prefetch(agents: readonly { role: Role }[]): void;
  /** shows and animates one person inside the agent's root group (feet at y 0, facing +z) */
  Person: ComponentType<PersonSlotProps<M>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let active: PeopleSource<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fallback: PeopleSource<any> | null = null;

/** the set in use (the registered default until setPeopleSource is called) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function peopleSource(): PeopleSource<any> {
  const s = active ?? fallback;
  if (!s) throw new Error("No people source registered");
  return s;
}

/** use another people set (call before the office mounts); null goes back to the default */
export function setPeopleSource<M extends { id: string }>(s: PeopleSource<M> | null): void {
  active = s;
}

/** registers the default set (quaternius.ts does this when imported) */
export function registerDefaultPeople<M extends { id: string }>(s: PeopleSource<M>): void {
  fallback = s;
}
