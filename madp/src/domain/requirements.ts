/**
 * Pure rules of journey step 3 (Requirements & objective). No imports: the
 * Logic Functions bundle this file unchanged, and the web uses the same code
 * for its checklist, so both sides always agree.
 */

export const REQUIREMENT_LIMITS = {
  maxRequirements: 200,
  /** Ids one reorder may carry: equals PROJECT_LIMITS.requirements (sanitization may create that many; not imported, to avoid a cycle). */
  maxOrderedIds: 300,
  titleMax: 200,
  detailMax: 5000,
  objectiveMax: 2000,
  maxCriteria: 20,
  criterionMax: 500,
  keepVersions: 20,
} as const;

export const REQUIREMENT_PRIORITIES = ["must", "nice", "later"] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export function isRequirementPriority(x: unknown): x is RequirementPriority {
  return typeof x === "string" && (REQUIREMENT_PRIORITIES as readonly string[]).includes(x);
}

export const REQUIREMENT_STATUSES = ["draft", "confirmed", "assumed", "dropped"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export const REMOVED_STATUS = "dropped" as const;
/** Every value except 'dropped' counts as active, unknown or empty ones included. */
export function isActiveRequirementStatus(s: unknown): boolean {
  return s !== REMOVED_STATUS;
}

export const REQUIREMENT_ORIGINS = ["sanitization", "manual", "suggestion", "second-opinion", "feedback"] as const;
export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

const ORIGIN_PREFIXES: readonly (readonly [string, RequirementOrigin])[] = [
  ["suggestion:", "suggestion"],
  ["second-opinion:", "second-opinion"],
  ["feedback:", "feedback"],
  ["manual:", "manual"],
];

/** S1 has no Origin field; provenance travels in SourceRefs. The first matching ref wins. */
export function originFromSourceRefs(refs: readonly string[] | null | undefined): RequirementOrigin {
  for (const ref of refs ?? []) {
    if (typeof ref !== "string") continue;
    for (const [prefix, origin] of ORIGIN_PREFIXES) if (ref.startsWith(prefix)) return origin;
  }
  return "sanitization";
}
export function manualSourceRef(userId: string): string {
  return "manual:" + userId;
}
export function suggestionSourceRef(id: string): string {
  return "suggestion:" + id;
}
export function manualAuthorOf(refs: readonly string[] | null | undefined): string | null {
  for (const ref of refs ?? []) {
    if (typeof ref === "string" && ref.startsWith("manual:") && ref.length > 7) return ref.slice(7);
  }
  return null;
}

// ---- item keys (S1 allows exactly one colon) ----
export const OBJECTIVE_ITEM_KEY = "objective:main";
export const ACCEPTANCE_OBJECTIVE_KEY = "acceptance:objective";

function assertId(id: string): void {
  if (typeof id !== "string" || id === "" || /[:\s]/.test(id)) {
    throw new TypeError("Invalid item id");
  }
}
export function requirementItemKey(id: string): string {
  assertId(id);
  return "requirement:" + id;
}
export function acceptanceItemKey(id: string): string {
  assertId(id);
  return "acceptance:" + id;
}

export type ParsedItemKey =
  | { kind: "requirement"; id: string }
  | { kind: "objective" }
  | { kind: "acceptance"; parent: { type: "objective" } | { type: "requirement"; id: string } };

export function parseItemKey(key: unknown): ParsedItemKey | null {
  if (typeof key !== "string") return null;
  if (key === OBJECTIVE_ITEM_KEY) return { kind: "objective" };
  if (key === ACCEPTANCE_OBJECTIVE_KEY) return { kind: "acceptance", parent: { type: "objective" } };
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  const [head, id] = parts;
  if (id === "" || /\s/.test(id)) return null;
  if (head === "requirement") return { kind: "requirement", id };
  if (head === "acceptance") return { kind: "acceptance", parent: { type: "requirement", id } };
  return null;
}

// ---- version texts (the format L5 writes for v1) ----
export function requirementVersionText(v: { title: string; text: string; priority: RequirementPriority }): string {
  return JSON.stringify({ priority: v.priority, text: v.text, title: v.title });
}
function parseObject(s: unknown): Record<string, unknown> | null {
  if (typeof s !== "string") return null;
  try {
    const o: unknown = JSON.parse(s);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export function parseRequirementVersionText(
  s: string,
): { title: string; text: string; priority: RequirementPriority } | null {
  const o = parseObject(s);
  if (!o || typeof o.title !== "string" || typeof o.text !== "string" || !isRequirementPriority(o.priority)) return null;
  return { title: o.title, text: o.text, priority: o.priority };
}
export function objectiveVersionText(v: { statement: string; highLevelMd?: string; architectureMd?: string }): string {
  return JSON.stringify({
    architectureMd: v.architectureMd ?? "",
    highLevelMd: v.highLevelMd ?? "",
    statement: v.statement,
  });
}
export function parseObjectiveVersionText(
  s: string,
): { architectureMd: string; highLevelMd: string; statement: string } | null {
  const o = parseObject(s);
  if (!o || typeof o.statement !== "string") return null;
  return {
    architectureMd: typeof o.architectureMd === "string" ? o.architectureMd : "",
    highLevelMd: typeof o.highLevelMd === "string" ? o.highLevelMd : "",
    statement: o.statement,
  };
}

// ---- criteria ----
function normaliseAll(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t === "") continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
export function normaliseCriteria(list: readonly unknown[]): string[] {
  return normaliseAll(list).slice(0, REQUIREMENT_LIMITS.maxCriteria);
}
export function checkCriteria(
  list: readonly unknown[],
): { ok: true; criteria: string[] } | { ok: false; reason: "too_many" | "too_long"; index?: number } {
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item === "string" && item.trim().length > REQUIREMENT_LIMITS.criterionMax) {
      return { ok: false, reason: "too_long", index: i };
    }
  }
  const all = normaliseAll(list);
  if (all.length > REQUIREMENT_LIMITS.maxCriteria) return { ok: false, reason: "too_many" };
  return { ok: true, criteria: all };
}
export function criteriaToText(list: readonly string[]): string {
  return list.join("\n");
}
export function textToCriteria(text: string): string[] {
  return normaliseCriteria(text.split(/\r?\n/));
}

// ---- inputs ----
export function checkRequirementInput(input: { title: unknown; detail: unknown; priority: unknown }):
  | { ok: true; value: { title: string; detail: string; priority: RequirementPriority } }
  | { ok: false; field: "title" | "detail" | "priority"; reason: "required" | "too_long" | "invalid" } {
  if (typeof input.title !== "string") return { ok: false, field: "title", reason: input.title == null ? "required" : "invalid" };
  const title = input.title.trim();
  if (title === "") return { ok: false, field: "title", reason: "required" };
  if (title.length > REQUIREMENT_LIMITS.titleMax) return { ok: false, field: "title", reason: "too_long" };
  if (input.detail != null && typeof input.detail !== "string") return { ok: false, field: "detail", reason: "invalid" };
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  if (detail.length > REQUIREMENT_LIMITS.detailMax) return { ok: false, field: "detail", reason: "too_long" };
  if (!isRequirementPriority(input.priority)) return { ok: false, field: "priority", reason: "invalid" };
  return { ok: true, value: { title, detail, priority: input.priority } };
}
export function checkObjectiveText(
  text: unknown,
): { ok: true; value: string } | { ok: false; reason: "required" | "too_long" } {
  const t = typeof text === "string" ? text.trim() : "";
  if (t === "") return { ok: false, reason: "required" };
  if (t.length > REQUIREMENT_LIMITS.objectiveMax) return { ok: false, reason: "too_long" };
  return { ok: true, value: t };
}

// ---- versions ----
export function latestVersions(rows: readonly { itemKey: string; n: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!Number.isInteger(r.n) || r.n <= 0) continue;
    if (r.n > (map.get(r.itemKey) ?? 0)) map.set(r.itemKey, r.n);
  }
  return map;
}
export function currentVersionOf(map: ReadonlyMap<string, number>, key: string): number {
  return map.get(key) ?? 0;
}
/** Always keeps v1 and the 19 highest; returns the rest ascending. */
export function versionsToPrune(ns: readonly number[]): number[] {
  const distinct = [...new Set(ns.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const keep = REQUIREMENT_LIMITS.keepVersions;
  if (distinct.length <= keep) return [];
  const keepTop = distinct[0] === 1 ? keep - 1 : keep;
  const kept = new Set(distinct.slice(distinct.length - keepTop));
  if (distinct[0] === 1) kept.add(1);
  return distinct.filter((n) => !kept.has(n));
}

// ---- suggestions ----
export const SUGGESTION_STATUSES = ["open", "accepted", "dismissed"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
function isSuggestionStatus(x: unknown): x is SuggestionStatus {
  return typeof x === "string" && (SUGGESTION_STATUSES as readonly string[]).includes(x);
}
export function decideSuggestion(
  current: unknown,
  decision: unknown,
): { ok: true; next: SuggestionStatus; changed: boolean } | { ok: false; reason: "invalid_transition" } {
  if (!isSuggestionStatus(current) || !isSuggestionStatus(decision)) return { ok: false, reason: "invalid_transition" };
  if (current === decision) return { ok: true, next: decision, changed: false };
  if (current === "open" || decision === "open") return { ok: true, next: decision, changed: true };
  return { ok: false, reason: "invalid_transition" };
}

// ---- ordering ----
export function reorderPlan(
  orderedIds: readonly string[],
  activeIds: readonly string[],
): { ok: true; plan: { id: string; sortOrder: number }[] } | { ok: false; reason: "not_permutation" } {
  if (orderedIds.length !== activeIds.length) return { ok: false, reason: "not_permutation" };
  const ordered = new Set(orderedIds);
  if (ordered.size !== orderedIds.length) return { ok: false, reason: "not_permutation" };
  const active = new Set(activeIds);
  if (active.size !== activeIds.length) return { ok: false, reason: "not_permutation" };
  for (const id of orderedIds) if (!active.has(id)) return { ok: false, reason: "not_permutation" };
  return { ok: true, plan: orderedIds.map((id, i) => ({ id, sortOrder: i * 10 })) };
}
export function nextSortOrder(existing: readonly number[]): number {
  let max = -10;
  for (const v of existing) if (Number.isFinite(v) && v > max) max = v;
  return max + 10;
}

// ---- step gate ----
export function isRequirementsStepOpen(step: unknown): boolean {
  return step === "requirements";
}

export type ConfirmBlocker =
  | { code: "no_requirements" }
  | { code: "requirements_without_criteria"; ids: string[] }
  | { code: "no_objective" }
  | { code: "objective_without_criteria" }
  | { code: "design_not_confirmed" }
  | { code: "landing_page_not_confirmed" };

export function confirmBlockers(input: {
  requirements: readonly { id: string; status: string; criteria: readonly string[] }[];
  objective: { text: string; criteria: readonly string[] } | null;
  designBrief: { status: string } | null;
  /** The "Add-on: Landing page" section still needs its review (src/domain/landingPage.ts landingBlocks). */
  landingPageOpen?: boolean;
}): ConfirmBlocker[] {
  const out: ConfirmBlocker[] = [];
  const active = input.requirements.filter((r) => isActiveRequirementStatus(r.status));
  if (active.length === 0) out.push({ code: "no_requirements" });
  const bare = active.filter((r) => normaliseCriteria(r.criteria).length === 0).map((r) => r.id);
  if (bare.length > 0) out.push({ code: "requirements_without_criteria", ids: bare });
  const obj = input.objective;
  if (!obj || obj.text.trim() === "") out.push({ code: "no_objective" });
  else if (normaliseCriteria(obj.criteria).length === 0) out.push({ code: "objective_without_criteria" });
  if (input.designBrief?.status !== "confirmed") out.push({ code: "design_not_confirmed" });
  if (input.landingPageOpen) out.push({ code: "landing_page_not_confirmed" });
  return out;
}
