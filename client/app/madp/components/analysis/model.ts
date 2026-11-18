/**
 * Business Analysis (owner 08.11.2026, second round): one interactive page led by the business analyst.
 * Left: the business analyst's panel — a checklist of the analysis, marked one by one, and the conversation (questions
 * asked back like a real business analyst would, one at a time). Right: the analysis document, filled part by part.
 * Front end only: every part reads the records the old four steps read, and every action calls the ops they call.
 * No React imports here (pure).
 */
import type { JourneyStep } from "@/madp/domain/journey";
import { stepIndex } from "@/madp/domain/journey";
import { t } from "@/madp/i18n";

/** The parts of the analysis document, in order (the right column). */
export const DOC_PARTS = [
  "understood",
  "files",
  "objective",
  "features",
  "workflows",
  "scope",
  "screens",
  "milestones",
  "success",
] as const;
export type DocPart = (typeof DOC_PARTS)[number];

/** Read at render time: each label is looked up in the current language when it is read. */
export const DOC_PART_LABEL: Record<DocPart, string> = {
  get understood() { return t("analysis.workspace.part.understood", "What we understood"); },
  get files() { return t("analysis.workspace.part.files", "What we read from your files"); },
  get objective() { return t("analysis.workspace.part.objective", "Objective"); },
  get features() { return t("analysis.workspace.part.features", "Master features"); },
  get workflows() { return t("analysis.workspace.part.workflows", "Workflows, constraints & not included"); },
  get scope() { return t("analysis.workspace.part.scope", "Features & user stories"); },
  get screens() { return t("analysis.workspace.part.screens", "Screens and look & feel"); },
  get milestones() { return t("analysis.workspace.part.milestones", "Milestones"); },
  get success() { return t("analysis.workspace.part.success", "Success metrics"); },
};

/** The stored journey step that writes each part (the part is open once the project has reached it). */
export const PART_STEP: Record<DocPart, JourneyStep> = {
  understood: "understanding",
  files: "understanding",
  objective: "requirements",
  features: "requirements",
  workflows: "requirements",
  scope: "scope",
  screens: "scope",
  milestones: "scope",
  success: "scope",
};

/** The business analyst's checklist (the left column), in order. Each item points at the part it fills. */
export const PM_ITEMS = ["brief", "understood", "questions", "requirements", "scope"] as const;
export type PmItem = (typeof PM_ITEMS)[number];

export const PM_ITEM_LABEL: Record<PmItem, string> = {
  get brief() { return t("analysis.workspace.item.brief", "Objective and end users"); },
  get understood() { return t("analysis.workspace.item.understood", "Confirm what we understood"); },
  get questions() { return t("analysis.workspace.item.questions", "Answer the open questions"); },
  get requirements() { return t("analysis.workspace.item.requirements", "Approve the requirements"); },
  get scope() { return t("analysis.workspace.item.scope", "Agree and lock the scope"); },
};

/** The part a checklist item opens on the right. */
export const PM_ITEM_PART: Record<PmItem, DocPart> = {
  brief: "objective",
  understood: "understood",
  questions: "understood",
  requirements: "features",
  scope: "scope",
};

/** The stored step during which each checklist item is the one to do. */
export const PM_ITEM_STEP: Record<PmItem, JourneyStep> = {
  brief: "understanding",
  understood: "understanding",
  questions: "sanitization",
  requirements: "requirements",
  scope: "scope",
};

export type ItemState = "done" | "now" | "later";

/** Where a checklist item stands from the stored step (brief is done once both answers exist; the panel decides). */
export function pmItemState(item: PmItem, step: JourneyStep | null): ItemState {
  if (!step) return "later";
  const at = stepIndex(step);
  const own = stepIndex(PM_ITEM_STEP[item]);
  if (item === "brief") return at > stepIndex("understanding") ? "done" : at === stepIndex("understanding") ? "now" : "later";
  if (item === "understood") return at > own ? "done" : at === own ? "now" : "later";
  return at > own ? "done" : at === own ? "now" : "later";
}

/** A part has content to show once the project has reached the step that writes it. */
export function partOpen(part: DocPart, step: JourneyStep | null): boolean {
  return !!step && stepIndex(step) >= stepIndex(PART_STEP[part]);
}

/** The props every part and the panel receive. */
export interface AnalysisCtx {
  projectId: string;
  workspaceId: string | null;
  step: JourneyStep | null;
  type: "greenfield" | "brownfield" | "greyfield";
}
