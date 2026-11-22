import { PEOPLE, type PersonModel } from "./manifest";
import type { Role } from "../model";

/** The people cast per agent role (model ids, in order). Roles without an entry keep the code-built character. */
export const CAST: Readonly<Partial<Record<Role, readonly string[]>>> = {
  planner: ["business_man"],
  dev: ["hoodie_character", "casual_character", "punk_a"],
  reviewer: ["woman_casual"],
  qa: ["animated_woman"],
  secops: ["punk_b"],
  docs: ["woman"],
  shipper: ["man_in_suit"],
};

const castIds = new Set(Object.values(CAST).flatMap((l) => l ?? []));

/** Every model not used in CAST, in manifest order (visitors and extra people). */
export const VISITOR_MODELS: readonly PersonModel[] = PEOPLE.filter((p) => !castIds.has(p.id));

/** The agent's person; index = its position among agents of the same role. Null when the role has no cast. */
export function castFor(role: Role, index = 0): PersonModel | null {
  const ids = CAST[role];
  if (!ids || ids.length === 0) return null;
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const find = (id: string) => PEOPLE.find((p) => p.id === id) ?? null;
  if (i < ids.length) return find(ids[i]);
  const extra = i - ids.length;
  if (extra < VISITOR_MODELS.length) return VISITOR_MODELS[extra];
  return find(ids[(extra - VISITOR_MODELS.length) % ids.length]);
}

/** The unique models needed for these agents, in first-use order. */
export function castInUse(agents: readonly { role: Role }[]): PersonModel[] {
  const seen = new Map<Role, number>();
  const out = new Map<string, PersonModel>();
  for (const a of agents) {
    const idx = seen.get(a.role) ?? 0;
    seen.set(a.role, idx + 1);
    const m = castFor(a.role, idx);
    if (m && !out.has(m.id)) out.set(m.id, m);
  }
  return [...out.values()];
}
