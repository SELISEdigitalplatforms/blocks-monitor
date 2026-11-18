/**
 * The decisions people make on the project brief (Project understanding step), stored as ProjectAnswer rows: one row per
 * item, QuestionKey unique per project. Pure; shared by the op that writes them (functions project.brief.decide), the
 * web's brief route that reads them (server/api/brief) and the MADP engine, which writes the same decisions into the
 * project's knowledge base on the engine host (decisions.json) before it builds the brief there.
 */

export const BRIEF_ANSWER_SCHEMA = "ProjectAnswer";
export type BriefDecisionKind = "requirement" | "conflict" | "confirm";

const REQ_KEY = /^R-[0-9a-f]{10}$/;
const CONFLICT_KEY = /^C-[0-9a-f]{10}$/;
const PREFIX = { requirement: "brief-req-", conflict: "brief-conflict-" } as const;
const CONFIRMED = "brief-confirmed";

/** What the brief shows for a conflict handed to the business analyst. */
export const CONFLICT_TO_PM = "Your business analyst settles this with you in the next step.";

export interface BriefDecisionSet {
  requirements: Record<string, "confirmed" | "rejected">;
  conflicts: Record<string, string>;
  confirmedAt?: string;
  confirmedByUserId?: string;
}

/** A valid decision: the item key fits its kind and the value is one the kind allows (null = undo). */
export function isBriefDecision(kind: unknown, key: unknown, value: unknown): boolean {
  if (kind === "requirement") return typeof key === "string" && REQ_KEY.test(key) && (value === "confirmed" || value === "rejected" || value === null);
  if (kind === "conflict") return typeof key === "string" && CONFLICT_KEY.test(key) && (value === "product_manager" || value === null);
  if (kind === "confirm") return (key === "" || key === undefined) && (value === "confirmed" || value === null);
  return false;
}

/** The ProjectAnswer QuestionKey of one decision (lower case: the schema's pattern is ^[a-z0-9][a-z0-9-]{0,62}$). */
export function briefQuestionKey(kind: BriefDecisionKind, key = ""): string {
  return kind === "confirm" ? CONFIRMED : `${PREFIX[kind]}${key.toLowerCase()}`;
}

/** True for a ProjectAnswer row that holds a brief decision. */
export const isBriefAnswer = (questionKey: unknown): boolean => typeof questionKey === "string" && questionKey.startsWith("brief-");

const upperKey = (rest: string): string => `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;

/** The decisions from the project's ProjectAnswer rows (rows of other questions are ignored). */
export function decisionsFromAnswers(rows: readonly Record<string, unknown>[]): BriefDecisionSet {
  const out: BriefDecisionSet = { requirements: {}, conflicts: {} };
  for (const r of rows) {
    const q = typeof r.QuestionKey === "string" ? r.QuestionKey : "";
    const v = typeof r.OptionId === "string" ? r.OptionId : "";
    if (q.startsWith(PREFIX.requirement)) {
      const key = upperKey(q.slice(PREFIX.requirement.length));
      if (REQ_KEY.test(key) && (v === "confirmed" || v === "rejected")) out.requirements[key] = v;
    } else if (q.startsWith(PREFIX.conflict)) {
      const key = upperKey(q.slice(PREFIX.conflict.length));
      if (CONFLICT_KEY.test(key) && v === "product_manager") out.conflicts[key] = CONFLICT_TO_PM;
    } else if (q === CONFIRMED && v === "confirmed") {
      const at = typeof r.Text === "string" && r.Text ? r.Text : typeof r.LastUpdatedDate === "string" ? r.LastUpdatedDate : "";
      if (at) out.confirmedAt = at;
      const by = typeof r.UpdatedByUserId === "string" && r.UpdatedByUserId ? r.UpdatedByUserId : typeof r.CreatedByUserId === "string" ? r.CreatedByUserId : "";
      if (by) out.confirmedByUserId = by;
    }
  }
  return out;
}
