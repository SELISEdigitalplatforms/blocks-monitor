/** Goals & requirements beyond the requirements themselves: the key workflows (who does what, step by step), what is
 *  not included, and the constraints (deadline, budget, compliance, languages, integrations…). Pure: the page, the
 *  ops (functions/project/ops/requirements/extras.ts), the local engine and the seed share these rules.
 *
 *  Stored one row per item in RequirementExtra:
 *    ProjectId, Kind ("workflow" | "exclusion" | "constraint"), Title (the workflow's name, the excluded thing, or the
 *    constraint's words), Who (workflow: who does it), Steps (workflow: one line per step), ConstraintKind (constraint:
 *    deadline | budget | compliance | languages | integrations | other), SortOrder, Status ("active" | "removed"),
 *    Origin ("setup" | "engine" | "person" | "live-product"), CreatedByUserId.
 *  A project without rows shows its setup answers (Project.SetupWorkflows / SetupExclusions / SetupConstraints); the
 *  first edit imports them as rows (extrasFromSetup), so nothing given at the setup is lost. */
import { CONSTRAINT_KINDS, CONSTRAINT_LABEL, cleanLines, isConstraintKind, oneLine, type ConstraintKind, type SetupDetails } from "./setupDetails";

export const EXTRA_SCHEMA = "RequirementExtra";
export const EXTRA_KINDS = ["workflow", "exclusion", "constraint"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];
export const isExtraKind = (v: unknown): v is ExtraKind => (EXTRA_KINDS as readonly unknown[]).includes(v);

/** "live-product": documented from the live product's code and documents (product.document, src/domain/liveProduct.ts). */
export const EXTRA_ORIGINS = ["setup", "engine", "person", "live-product"] as const;
export type ExtraOrigin = (typeof EXTRA_ORIGINS)[number];

export const EXTRA_LIMITS = { title: 300, who: 120, step: 300, steps: 20, perKind: 40 } as const;

export { CONSTRAINT_KINDS, CONSTRAINT_LABEL, isConstraintKind, type ConstraintKind };

export interface ExtraInput { kind: ExtraKind; title: string; who: string; steps: string[]; constraintKind: ConstraintKind | "" }

export interface ExtraRecord extends ExtraInput {
  id: string;
  sortOrder: number;
  origin: ExtraOrigin;
  authorUserId: string | null;
  /** True for an item shown from the setup answers that has no row yet (it becomes a row at the first edit). */
  fromSetup: boolean;
}

export const EXTRA_LABEL: Readonly<Record<ExtraKind, { title: string; one: string; add: string; empty: string }>> = {
  workflow: { title: "Key workflows", one: "workflow", add: "Add a workflow", empty: "No workflows yet. Describe who does what, step by step." },
  exclusion: { title: "Not included", one: "item", add: "Add something we leave out", empty: "Nothing is left out yet. Say what this version won't do, so nobody expects it." },
  constraint: { title: "Constraints", one: "constraint", add: "Add a constraint", empty: "No constraints yet. Add the deadline, budget, rules, languages or systems we must respect." },
};

/** Cleans one item; the error names the field a person must fix. */
export function checkExtra(raw: { kind: unknown; title?: unknown; who?: unknown; steps?: unknown; constraintKind?: unknown }):
  | { ok: true; value: ExtraInput }
  | { ok: false; field: "kind" | "title" | "who" | "steps" | "constraintKind"; reason: "required" | "too_long" | "invalid" | "too_many" } {
  if (!isExtraKind(raw.kind)) return { ok: false, field: "kind", reason: "invalid" };
  const kind = raw.kind;
  const title = typeof raw.title === "string" ? oneLine(raw.title) : "";
  const who = kind === "workflow" && typeof raw.who === "string" ? oneLine(raw.who) : "";
  if (raw.steps !== undefined && (!Array.isArray(raw.steps) || raw.steps.some((x) => typeof x !== "string"))) return { ok: false, field: "steps", reason: "invalid" };
  const steps = kind === "workflow" ? cleanLines((raw.steps as string[] | undefined) ?? []) : [];
  let constraintKind: ConstraintKind | "" = "";
  if (kind === "constraint") {
    if (!isConstraintKind(raw.constraintKind)) return { ok: false, field: "constraintKind", reason: "invalid" };
    constraintKind = raw.constraintKind;
  }
  if (!title && !(kind === "constraint" && constraintKind !== "other")) return { ok: false, field: "title", reason: "required" };
  if (title.length > EXTRA_LIMITS.title) return { ok: false, field: "title", reason: "too_long" };
  if (who.length > EXTRA_LIMITS.who) return { ok: false, field: "who", reason: "too_long" };
  if (steps.length > EXTRA_LIMITS.steps) return { ok: false, field: "steps", reason: "too_many" };
  if (steps.some((s) => s.length > EXTRA_LIMITS.step)) return { ok: false, field: "steps", reason: "too_long" };
  return { ok: true, value: { kind, title, who, steps, constraintKind } };
}

/** "Employee: request leave → team lead approves" style lines from the setup become a workflow: the part before a
 *  colon is who (when short), the rest is split into steps at arrows or semicolons. A plain sentence stays the title. */
export function workflowFromLine(line: string): Pick<ExtraInput, "title" | "who" | "steps"> {
  const text = oneLine(line);
  const colon = text.indexOf(":");
  const who = colon > 0 && colon <= 40 ? text.slice(0, colon).trim() : "";
  const rest = who ? text.slice(colon + 1).trim() : text;
  const parts = rest.split(/\s*(?:→|->|;|\bthen\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const steps = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
    return { title: who ? `${who}: ${steps[0]}` : steps[0], who, steps };
  }
  return { title: rest, who, steps: [] };
}

/** The setup answers as items (in their order): what a project without RequirementExtra rows shows and imports. */
export function extrasFromSetup(setup: Pick<SetupDetails, "workflows" | "exclusions" | "constraints">): ExtraInput[] {
  const out: ExtraInput[] = [];
  for (const w of setup.workflows) {
    const f = workflowFromLine(w);
    if (f.title) out.push({ kind: "workflow", ...f, constraintKind: "" });
  }
  for (const x of setup.exclusions) if (oneLine(x)) out.push({ kind: "exclusion", title: oneLine(x), who: "", steps: [], constraintKind: "" });
  for (const c of setup.constraints) {
    if (!isConstraintKind(c.kind)) continue;
    out.push({ kind: "constraint", title: oneLine(c.text), who: "", steps: [], constraintKind: c.kind });
  }
  return out;
}

/** The setup items shown before the first edit, with stable ids so the list does not jump. */
export function setupRecords(setup: Pick<SetupDetails, "workflows" | "exclusions" | "constraints">): ExtraRecord[] {
  const n: Record<ExtraKind, number> = { workflow: 0, exclusion: 0, constraint: 0 };
  return extrasFromSetup(setup).map((e) => {
    n[e.kind] += 1;
    return { ...e, id: `setup:${e.kind}:${n[e.kind]}`, sortOrder: n[e.kind], origin: "setup", authorUserId: null, fromSetup: true };
  });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** One RequirementExtra row as a record (unknown kinds give null). */
export function extraFromRow(r: Record<string, unknown>): ExtraRecord | null {
  if (!isExtraKind(r.Kind) || str(r.Status) === "removed") return null;
  const origin = (EXTRA_ORIGINS as readonly unknown[]).includes(r.Origin) ? (r.Origin as ExtraOrigin) : "person";
  return {
    id: str(r.ItemId), kind: r.Kind, title: str(r.Title), who: str(r.Who),
    steps: Array.isArray(r.Steps) ? (r.Steps as unknown[]).filter((x): x is string => typeof x === "string") : [],
    constraintKind: r.Kind === "constraint" && isConstraintKind(r.ConstraintKind) ? r.ConstraintKind : r.Kind === "constraint" ? "other" : "",
    sortOrder: typeof r.SortOrder === "number" ? r.SortOrder : 0, origin, authorUserId: str(r.CreatedByUserId) || null, fromSetup: false,
  };
}

/** Rows (any order, removed ones skipped) as one list per kind, each in its order. */
export function groupExtras(list: readonly ExtraRecord[]): Record<ExtraKind, ExtraRecord[]> {
  const by = (k: ExtraKind) => list.filter((e) => e.kind === k).sort((a, b) => a.sortOrder - b.sortOrder);
  return { workflow: by("workflow"), exclusion: by("exclusion"), constraint: by("constraint") };
}

/** The kind a constraint is shown with in a list ("Deadline"), or "" for "other": "Something else" names the choice in
 *  the kind picker, not a category, so the item reads as its own words (as constraintText does). */
export function constraintTag(kind: ConstraintKind | "" | null | undefined): string {
  const k = kind || "other";
  return k === "other" ? "" : CONSTRAINT_LABEL[k];
}

/** A constraint in words: "Deadline: live before 1 March" (or just the kind when nothing more was said). */
export function constraintText(e: Pick<ExtraRecord, "constraintKind" | "title">): string {
  const k = e.constraintKind || "other";
  if (k === "other") return e.title;
  return e.title ? `${CONSTRAINT_LABEL[k]}: ${e.title}` : CONSTRAINT_LABEL[k];
}

/** The constraint kinds not used yet (each kind but "other" once), in their usual order. */
export function freeConstraintKinds(list: readonly Pick<ExtraRecord, "constraintKind">[]): ConstraintKind[] {
  const used = new Set(list.map((c) => c.constraintKind));
  return CONSTRAINT_KINDS.filter((k) => k === "other" || !used.has(k));
}
