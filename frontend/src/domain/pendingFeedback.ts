/**
 * Feedback still under way when a step is signed off (the scope lock, the requirements approval): the items whose
 * comments the team still works on (thread open or working) and the items the team updated that wait for the person
 * (thread updated). Pure; the names come from the data the page already has, never ids.
 */
import { needsWork } from "./feedback";

export interface PendingThreadLike { targetType: string; targetId: string; status: string }

export interface PendingFeedback {
  /** names of the items the team still works on (open or working) */
  working: string[];
  /** names of the items the team updated, waiting for the person to have a look */
  waiting: string[];
}

/** The name shown for an item whose name is blank. */
export const UNNAMED_ITEM = "an item";

export const NO_PENDING_FEEDBACK: PendingFeedback = { working: [], waiting: [] };

/**
 * The pending feedback of the threads whose TargetType is one of `types`, in the order of `types`, then by name.
 * `nameOf` gives the item's plain name; it returns null when the item is not part of this step any more (a removed
 * item, an older version), so its thread is left out. A blank name shows as "an item".
 */
export function pendingFeedback(
  threads: Iterable<PendingThreadLike> | null | undefined,
  types: readonly string[],
  nameOf: (type: string, id: string) => string | null,
): PendingFeedback {
  if (!threads) return NO_PENDING_FEEDBACK;
  const working: { rank: number; name: string; key: string }[] = [];
  const waiting: { rank: number; name: string; key: string }[] = [];
  const seen = new Set<string>();
  for (const t of threads) {
    const rank = types.indexOf(t.targetType);
    if (rank < 0) continue;
    const key = `${t.targetType}:${t.targetId}`;
    if (seen.has(key)) continue;
    const status = String(t.status ?? "");
    const list = needsWork(status) ? working : status === "updated" ? waiting : null;
    if (!list) continue;
    const name = nameOf(t.targetType, t.targetId);
    if (name === null) continue;
    seen.add(key);
    list.push({ rank, name: name.replace(/\s+/g, " ").trim() || UNNAMED_ITEM, key });
  }
  const order = (a: { rank: number; name: string; key: string }, b: { rank: number; name: string; key: string }) =>
    a.rank - b.rank || a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { working: working.sort(order).map((x) => x.name), waiting: waiting.sort(order).map((x) => x.name) };
}

export const hasPendingFeedback = (p: PendingFeedback): boolean => p.working.length > 0 || p.waiting.length > 0;

/** Plain words for the warning. */
export const PENDING_WORKING_TITLE = "Some comments are still being worked on";
export const PENDING_WAITING_TITLE = "Updates waiting for you";
