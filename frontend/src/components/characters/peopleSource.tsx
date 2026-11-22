/**
 * The cast as a people set for the 3D office: the same shape as the office's PeopleSource
 * (src/components/office/people/source.ts on feat/office-3d: castFor, prefetch, Person with PersonSlotProps), typed
 * structurally here so this module does not depend on the office. Wire it with
 *   setPeopleSource(createRealisticPeopleSource({ personHeight: PERSON_HEIGHT }))
 * before the office mounts.
 */
import { useMemo, useRef, type MutableRefObject } from "react";
import { officeActivity, seedOf, type Activity, type OfficeMotion } from "./controller";
import { prefetchCharacters } from "./loader";
import { RealPerson } from "./RealPerson";
import { castForRole, type CharacterId, type Tier } from "./registry";

export interface CastModel {
  /** unique per character and tier (the office keys models by id) */
  id: string;
  character: CharacterId;
  tier: Tier;
}

export interface OfficePersonProps {
  model: CastModel;
  id: string;
  status: string;
  ghost?: boolean;
  reducedMotion: boolean;
  facing?: boolean;
  motion: MutableRefObject<OfficeMotion>;
  onReady: (person: { headY: number }) => void;
}

export function createRealisticPeopleSource({ personHeight, tier = "far" }: { personHeight: number; tier?: Tier }) {
  function OfficePerson({ model, id, status, reducedMotion, facing, motion, onReady }: OfficePersonProps) {
    const statusRef = useRef(status);
    statusRef.current = status;
    // read the office's motion ref live, every frame, without a frame of lag
    const activity = useMemo(() => ({
      get current() { return officeActivity(statusRef.current, motion.current); },
      set current(_v) { /* read-only view */ },
    }), [motion]) as MutableRefObject<Activity & { speed?: number }>;
    // greet when selected for a chat; a short wave when a stage passes
    const waveKey = facing ? `facing:${id}` : status === "pass" || status === "done" ? `${status}:${id}` : null;
    return (
      <RealPerson id={model.character} tier={model.tier} height={personHeight} activity={activity} waveKey={waveKey}
        reduced={reducedMotion} seed={seedOf(id)} onReady={onReady} />
    );
  }
  return {
    name: "rocketbox",
    castFor(role: string, index: number): CastModel | null {
      const character = castForRole(role, index);
      return character ? { id: `${character}.${tier}`, character, tier } : null;
    },
    prefetch(agents: readonly { role: string }[]): void {
      const seen = new Map<string, number>();
      const people: { id: CharacterId; tier: Tier }[] = [];
      for (const a of agents) {
        const i = seen.get(a.role) ?? 0;
        seen.set(a.role, i + 1);
        const c = castForRole(a.role, i);
        if (c) people.push({ id: c, tier });
      }
      prefetchCharacters(people);
    },
    Person: OfficePerson,
  };
}
