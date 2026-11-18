/** The compact lists of the Business Analysis page ("Master features", "Workflows, constraints & not included"): the
 *  pure rules behind the rows and their ⋯ menus. Grouping and numbering by priority, the counts on a row, where an item
 *  came from (in words and as a kind for its icon), the order after a move inside a priority group, the expanded rows,
 *  and which menu actions a person gets. No React. */
import { t } from "@/madp/i18n";
import { PRIORITY_ORDER, type PriorityFilter } from "@/madp/components/requirements/priority";
import type { RequirementOrigin, RequirementPriority } from "@/madp/domain/requirements";
import type { ExtraOrigin } from "@/madp/domain/requirementsExtras";

/** "1 check", "3 checks". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The checks count on a requirement's row; a requirement without a check says so (it blocks confirming). */
export function checksLabel(n: number): string {
  if (n <= 0) return t("analysis.brief.noChecksYet", "No checks yet");
  return n === 1 ? t("analysis.brief.checksOne", "1 check") : t("analysis.brief.checksMany", "{count} checks", { count: n });
}

/** The steps count on a workflow's row. */
export function stepsLabel(n: number): string {
  if (n <= 0) return t("analysis.brief.noStepsYet", "No steps yet");
  return n === 1 ? t("analysis.brief.stepsOne", "1 step") : t("analysis.brief.stepsMany", "{count} steps", { count: n });
}

/** "01", "02" … "10": the number in front of a row. */
export const rowNumber = (n: number) => String(n).padStart(2, "0");

/** The detail only repeats the title (the draft's "Title." under "Title"): shown once. Same rule as RequirementRow. */
export function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/[.;!]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

// ------------------------------------------------------------------------------------------------ priority groups

export interface NumberedItem<T> { item: T; n: number }
export interface PriorityGroup<T> { priority: RequirementPriority; items: NumberedItem<T>[] }

/** The list in groups of one priority (Must, Should, Could), each keeping the list's order, numbered 1…n in that order
 *  across the groups. The filter then keeps one group; the numbers stay the same, so "07" is always the same item.
 *  Empty groups are left out. Unknown priorities count as Must (as the records do). */
export function priorityGroups<T extends { priority: string }>(list: readonly T[], filter: PriorityFilter = "all"): PriorityGroup<T>[] {
  const of = (r: T): RequirementPriority => ((PRIORITY_ORDER as readonly string[]).includes(r.priority) ? r.priority as RequirementPriority : "must");
  let n = 0;
  const groups = PRIORITY_ORDER.map((p) => ({
    priority: p,
    items: list.filter((r) => of(r) === p).map((item) => ({ item, n: ++n })),
  }));
  return groups.filter((g) => g.items.length > 0 && (filter === "all" || g.priority === filter));
}

/** The full order after moving `id` one place up (-1) or down (1) among the items of its own priority: it swaps places
 *  with its nearest neighbour of the same priority; the other items keep their places. Null at the group's edge or for
 *  an unknown id. */
export function moveWithinPriority<T extends { id: string; priority: string }>(list: readonly T[], id: string, dir: -1 | 1): string[] | null {
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].priority !== list[i].priority) j += dir;
  if (j < 0 || j >= list.length) return null;
  const ids = list.map((r) => r.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/** Whether `id` can move up / down inside its priority group. */
export function moveBounds<T extends { id: string; priority: string }>(list: readonly T[], id: string): { up: boolean; down: boolean } {
  return { up: moveWithinPriority(list, id, -1) !== null, down: moveWithinPriority(list, id, 1) !== null };
}

// ------------------------------------------------------------------------------------------------ expanded rows

/** The set with `id` added or removed. */
export function toggleIn(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** True when every one of `ids` is open (and there is at least one). */
export function allOpen(ids: readonly string[], open: ReadonlySet<string>): boolean {
  return ids.length > 0 && ids.every((id) => open.has(id));
}

/** "Expand all" opens the shown rows (others stay as they are); "Collapse all" closes them. */
export function expandAll(ids: readonly string[], open: ReadonlySet<string>): Set<string> {
  return allOpen(ids, open) ? new Set([...open].filter((id) => !ids.includes(id))) : new Set([...open, ...ids]);
}

// ------------------------------------------------------------------------------------------------ where it came from

/** The kind of source, for the row's small icon. */
export type SourceKind = "analysis" | "suggestion" | "second-opinion" | "feedback" | "person" | "setup" | "draft";

export function requirementSource(origin: RequirementOrigin | string): SourceKind {
  switch (origin) {
    case "sanitization": return "analysis";
    case "suggestion": return "suggestion";
    case "second-opinion": return "second-opinion";
    case "feedback": return "feedback";
    default: return "person";
  }
}

export function extraSource(e: { fromSetup: boolean; origin: ExtraOrigin | string }): SourceKind {
  if (e.fromSetup || e.origin === "setup") return "setup";
  if (e.origin === "engine") return "draft";
  return "person";
}

/** Where a workflow, constraint or exclusion came from, in words (the same words as the Workflows tab). */
export function extraSourceLabel(e: { fromSetup: boolean; origin: ExtraOrigin | string }, author: string | null): string {
  switch (extraSource(e)) {
    case "setup": return t("analysis.brief.sourceSetup", "From the project setup");
    case "draft": return t("analysis.brief.sourceDraft", "From your business analyst's draft");
    default: return author?.trim()
      ? t("analysis.brief.sourceAddedBy", "Added by {name}", { name: author.trim() })
      : t("analysis.brief.sourceAddedByMember", "Added by a workspace member");
  }
}

// ------------------------------------------------------------------------------------------------ the ⋯ menu

/** The comment entry of an item's menu: "comment" when the person may add one (the "comment" permission while the
 *  requirements are open), "view" when they may only read an existing thread, null when there is nothing for them. */
export function commentMode(a: { commentable: boolean; canComment: boolean; stepOpen: boolean; count: number }): "comment" | "view" | null {
  if (!a.commentable) return null;
  if (a.canComment && a.stepOpen) return "comment";
  return a.count > 0 ? "view" : null;
}

export type RequirementAction = "edit" | "priority" | "checks" | "comment" | "moveUp" | "moveDown" | "delete";
export type ExtraAction = "edit" | "comment" | "moveUp" | "moveDown" | "delete";

/** A requirement's menu, in order. A person who cannot edit gets the comment entry only (when there is one). */
export function requirementActions(a: { editable: boolean; comment: "comment" | "view" | null }): RequirementAction[] {
  const out: RequirementAction[] = [];
  if (a.editable) out.push("edit", "priority", "checks");
  if (a.comment) out.push("comment");
  if (a.editable) out.push("moveUp", "moveDown", "delete");
  return out;
}

/** A workflow's, constraint's or exclusion's menu, in order. */
export function extraActions(a: { editable: boolean; comment: "comment" | "view" | null }): ExtraAction[] {
  const out: ExtraAction[] = [];
  if (a.editable) out.push("edit");
  if (a.comment) out.push("comment");
  if (a.editable) out.push("moveUp", "moveDown", "delete");
  return out;
}

/** The comment entry's words: "Comment" or "View comments", with the count beside it. */
export function commentEntry(mode: "comment" | "view", count: number): { label: string; hint?: string } {
  const label = mode === "comment"
    ? (count > 0 ? t("analysis.brief.comments", "Comments") : t("analysis.brief.comment", "Comment"))
    : t("analysis.brief.viewComments", "View comments");
  return { label, ...(count > 0 ? { hint: String(count) } : {}) };
}
