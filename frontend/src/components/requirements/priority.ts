/** Requirement priorities in plain words (Must / Should / Could). Pure.
 *  The stored values stay the ones every reader already knows (Requirement.Priority "must" | "nice" | "later", which the
 *  scope, the engine and the sanitization step read too); only the words people see are Must, Should and Could:
 *    must  → Must   (we can't go live without it)
 *    nice  → Should (important, but it could follow soon after)
 *    later → Could  (nice to have, if there is time)
 *  The setup answers use "must" | "should" | "could" (src/domain/setupDetails.ts); toStoredPriority maps them. */
import { t } from "@/i18n";
import type { RequirementPriority } from "@/domain/requirements";

export const PRIORITY_ORDER: readonly RequirementPriority[] = ["must", "nice", "later"];

/** The words are getters: read at render time, so each one comes in the current language. */
export const PRIORITY_WORD: Readonly<Record<RequirementPriority, string>> = {
  get must() { return t("analysis.requirements.priorityMust", "Must"); },
  get nice() { return t("analysis.requirements.priorityShould", "Should"); },
  get later() { return t("analysis.requirements.priorityCould", "Could"); },
};

export const PRIORITY_HINT: Readonly<Record<RequirementPriority, string>> = {
  get must() { return t("analysis.requirements.priorityMustHint", "We can't go live without it"); },
  get nice() { return t("analysis.requirements.priorityShouldHint", "Important, but it could follow soon after"); },
  get later() { return t("analysis.requirements.priorityCouldHint", "Nice to have, if there is time"); },
};

export const PRIORITY_TONE: Readonly<Record<RequirementPriority, "accent" | "neutral" | "warning">> = {
  must: "accent",
  nice: "neutral",
  later: "warning",
};

/** A setup or engine priority ("must" | "should" | "could", or a stored one) as the stored value; anything else is "must". */
export function toStoredPriority(p: unknown): RequirementPriority {
  if (p === "should" || p === "nice") return "nice";
  if (p === "could" || p === "later") return "later";
  return "must";
}

export type PriorityCounts = Record<RequirementPriority, number>;

export function countPriorities(list: readonly { priority: string }[]): PriorityCounts {
  const out: PriorityCounts = { must: 0, nice: 0, later: 0 };
  for (const r of list) {
    const p = r.priority as RequirementPriority;
    if (p in out) out[p] += 1;
  }
  return out;
}

/** "3 must · 2 should · 1 could" (empty groups left out); "" when there are none. */
export function priorityLine(c: PriorityCounts): string {
  return PRIORITY_ORDER.filter((p) => c[p] > 0).map((p) => `${c[p]} ${PRIORITY_WORD[p].toLowerCase()}`).join(" · ");
}

/** The filter on the requirements list: everything or one priority. */
export type PriorityFilter = "all" | RequirementPriority;

export function filterByPriority<T extends { priority: string }>(list: readonly T[], f: PriorityFilter): T[] {
  return f === "all" ? [...list] : list.filter((r) => r.priority === f);
}

/** The list in groups of one priority (Must first), each keeping its own order; empty groups left out. */
export function groupByPriority<T extends { priority: string }>(list: readonly T[]): { priority: RequirementPriority; items: T[] }[] {
  return PRIORITY_ORDER.map((p) => ({ priority: p, items: list.filter((r) => r.priority === p) })).filter((g) => g.items.length > 0);
}
