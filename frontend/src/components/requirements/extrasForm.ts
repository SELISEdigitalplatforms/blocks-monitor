/** The add / edit form of a key workflow, a "not included" item or a constraint: its values and the first problem a
 *  person must fix before saving (the op checks again with src/domain/requirementsExtras.ts checkExtra). Pure. */
import { t } from "@/i18n";
import { EXTRA_LIMITS, type ConstraintKind, type ExtraKind } from "@/domain/requirementsExtras";

export interface ExtraFormValue { title: string; who: string; steps: string[]; constraintKind: ConstraintKind }

/** One step per line, blank lines left out. */
export const linesOf = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** The first problem with the values, or null (the op checks again). */
export function extraProblem(kind: ExtraKind, v: ExtraFormValue): string | null {
  const title = v.title.trim();
  if (!title && !(kind === "constraint" && v.constraintKind !== "other")) {
    return kind === "workflow" ? t("analysis.requirements.nameWorkflow", "Name the workflow.")
      : kind === "exclusion" ? t("analysis.requirements.sayLeftOut", "Say what is left out.")
      : t("analysis.requirements.describeConstraint", "Describe the constraint.");
  }
  if (title.length > EXTRA_LIMITS.title) return t("analysis.requirements.titleTooLong", "Up to {max} characters.", { max: EXTRA_LIMITS.title });
  if (kind === "workflow") {
    if (v.who.trim().length > EXTRA_LIMITS.who) return t("analysis.requirements.whoTooLong", "\"Who\" can hold up to {max} characters.", { max: EXTRA_LIMITS.who });
    if (v.steps.length > EXTRA_LIMITS.steps) return t("analysis.requirements.tooManySteps", "Up to {max} steps.", { max: EXTRA_LIMITS.steps });
    if (v.steps.some((s) => s.length > EXTRA_LIMITS.step)) return t("analysis.requirements.stepTooLong", "Each step can hold up to {max} characters.", { max: EXTRA_LIMITS.step });
  }
  return null;
}

