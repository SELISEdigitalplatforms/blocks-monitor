/** Pure helpers of the "At a glance" aside: the suggestions summary and the confirm checklist. */
import { t } from "@/madp/i18n";
import type { ReqTab } from "./requirementsTab";

/** "8 open" as the value, the accepted and dismissed counts as the quiet second line. */
export function suggestionsSummary(c: { accepted: number; dismissed: number; open: number }): { value: string; detail: string } {
  return {
    value: t("analysis.requirements.suggestionsOpen", "{count} open", { count: c.open }),
    detail: t("analysis.requirements.suggestionsDecided", "{accepted} accepted · {dismissed} dismissed", { accepted: c.accepted, dismissed: c.dismissed }),
  };
}

/** One unmet item from src/domain/requirements confirmBlockers (the function re-checks with the same rules).
 *  Read loosely by its code, so a rename of the domain's wording does not break the checklist. */
export interface ConfirmBlocker {
  code?: string;
  kind?: string;
  type?: string;
  ids?: readonly string[];
  requirementIds?: readonly string[];
  [key: string]: unknown;
}

export type ChecklistKey = "requirements" | "criteria" | "objective" | "design";

export interface ChecklistItem { key: ChecklistKey; label: string; done: boolean; tab: ReqTab; detail?: string }

const CHECKLIST_KEYS: readonly ChecklistKey[] = ["requirements", "criteria", "objective", "design"];

function checklistLabel(key: ChecklistKey): string {
  switch (key) {
    case "requirements": return t("analysis.requirements.checkRequirements", "Requirements");
    case "criteria": return t("analysis.requirements.checkCriteria", "Every requirement has acceptance criteria");
    case "objective": return t("analysis.requirements.checkObjective", "Objective with criteria");
    case "design": return t("analysis.requirements.checkDesign", "Design instruction confirmed");
  }
}
const TAB: Record<ChecklistKey, ReqTab> = { requirements: "must", criteria: "must", objective: "objective", design: "design" };

const codeOf = (b: ConfirmBlocker) => String(b.code ?? b.kind ?? b.type ?? "").toLowerCase();

/** Which checklist item a blocker belongs to. */
export function blockerKey(b: ConfirmBlocker): ChecklistKey {
  const c = codeOf(b);
  if (c.includes("design")) return "design";
  if (c.includes("objective")) return "objective";
  if (c.includes("criteria") || c.includes("acceptance")) return "criteria";
  return "requirements";
}

/** The add-on's section still waits for its review (its own place on the page, not one of the four checklist items). */
export const isLandingBlocker = (b: ConfirmBlocker): boolean => codeOf(b).includes("landing");

const idsOf = (b: ConfirmBlocker) => b.ids ?? b.requirementIds ?? [];

/** A plain reason for one blocker. */
export function blockerText(b: ConfirmBlocker): string {
  if (isLandingBlocker(b)) return t("analysis.requirements.blockLanding", "Review and confirm the landing page section.");
  switch (blockerKey(b)) {
    case "design": return t("analysis.requirements.blockDesign", "Review and approve the generated Figma Make screens.");
    case "objective": return codeOf(b).includes("criteria") || codeOf(b).includes("acceptance")
      ? t("analysis.requirements.blockObjectiveCriteria", "Add acceptance criteria to the objective.") : t("analysis.requirements.blockObjective", "Write the objective.");
    case "criteria": {
      const n = idsOf(b).length;
      if (n === 1) return t("analysis.requirements.blockCriteriaOne", "1 requirement lacks acceptance criteria.");
      return n > 0 ? t("analysis.requirements.blockCriteriaMany", "{count} requirements lack acceptance criteria.", { count: n })
        : t("analysis.requirements.blockCriteriaAll", "Add acceptance criteria to every requirement.");
    }
    default: return t("analysis.requirements.blockRequirements", "Add at least one requirement.");
  }
}

/** The four checklist items, in order. An item is done when no blocker belongs to it. */
export function checklistItems(blockers: readonly ConfirmBlocker[]): ChecklistItem[] {
  return CHECKLIST_KEYS.map((key) => {
    const mine = blockers.filter((b) => !isLandingBlocker(b) && blockerKey(b) === key);
    const item: ChecklistItem = { key, label: checklistLabel(key), done: mine.length === 0, tab: TAB[key] };
    if (key === "criteria" && mine.length > 0) {
      const n = new Set(mine.flatMap((b) => idsOf(b))).size;
      if (n > 0) {
        item.detail = n === 1 ? t("analysis.requirements.lacksCriteriaOne", "1 requirement lacks criteria")
          : t("analysis.requirements.lacksCriteriaMany", "{count} requirements lack criteria", { count: n });
      }
    }
    return item;
  });
}
