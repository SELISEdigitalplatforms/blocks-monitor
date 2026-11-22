/** The names of the journey's steps, phases and project types in the chosen language, read at render time. Show these
 *  on screen instead of the domain's STEP_LABEL, STEP_SHORT_LABEL, PHASE_LABEL, PHASE_SHORT_LABEL,
 *  ANALYSIS_SECTION_LABEL, phaseLabelOf, stepLabelFor and TYPE_LABEL: src/domain is bundled into the Blocks functions
 *  and the engine (no React, no Vite), so its constants stay English (test/journey/stepNames.test.ts keeps both equal). */
import { t } from "@/i18n";
import type { JourneyPage, JourneyStep } from "@/domain/journey";
import { phaseOf, type Phase } from "@/domain/phases";
import type { ProjectType } from "@/domain/projectType";

/** The full name of a journey page. */
export function stepName(id: JourneyPage, type: ProjectType = "greenfield"): string {
  if (type === "brownfield" && id === "sanitization") return t("project.steps.brownfield.sanitization", "Understanding your product");
  if (type === "brownfield" && id === "requirements") return t("project.steps.brownfield.requirements", "Goals for the change");
  switch (id) {
    case "business": return t("project.steps.label.business", "Project setup");
    case "understanding": return t("project.steps.label.understanding", "Project understanding");
    case "sanitization": return t("project.steps.label.sanitization", "Understanding your project");
    case "requirements": return t("project.steps.label.requirements", "Goals & requirements");
    case "scope": return t("project.steps.label.scope", "Scope & success");
    case "board": return t("project.steps.label.board", "Build");
    case "build": return t("project.steps.label.build", "Build");
    case "release": return t("project.steps.label.release", "Release");
    case "wiki": return t("project.steps.label.wiki", "Wiki");
  }
}

/** The compact name of a journey page, where room is tight. */
export function stepShortName(id: JourneyPage): string {
  switch (id) {
    case "business": return t("project.steps.short.business", "Setup");
    case "understanding": return t("project.steps.short.understanding", "Review");
    case "sanitization": return t("project.steps.short.sanitization", "Understanding");
    case "requirements": return t("project.steps.short.requirements", "Goals");
    case "scope": return t("project.steps.short.scope", "Scope");
    case "board": return t("project.steps.short.board", "Build");
    case "build": return t("project.steps.short.build", "Build");
    case "release": return t("project.steps.short.release", "Release");
    case "wiki": return t("project.steps.short.wiki", "Wiki");
  }
}

/** The name of one of the four phases (the journey bar's steps). */
export function phaseName(id: Phase): string {
  switch (id) {
    case "setup": return t("project.phases.label.setup", "Project Setup");
    case "analysis": return t("project.phases.label.analysis", "Business Analysis");
    case "engineering": return t("project.phases.label.engineering", "Software Engineering");
    case "release": return t("project.phases.label.release", "Release");
  }
}

/** The compact name of a phase. */
export function phaseShortName(id: Phase): string {
  switch (id) {
    case "setup": return t("project.phases.short.setup", "Setup");
    case "analysis": return t("project.phases.short.analysis", "Analysis");
    case "engineering": return t("project.phases.short.engineering", "Engineering");
    case "release": return t("project.phases.short.release", "Release");
  }
}

/** The phase name of a stored step ("Business Analysis" for "requirements"), as the domain's phaseLabelOf. */
export function phaseNameOf(step: JourneyStep): string {
  return phaseName(phaseOf(step));
}

/** The name of a project type (the domain's TYPE_LABEL). */
export function typeName(type: ProjectType): string {
  switch (type) {
    case "greenfield": return t("project.type.greenfield", "New product");
    case "brownfield": return t("project.type.brownfield", "Existing product");
    case "greyfield": return t("project.type.greyfield", "Rebuilt product");
  }
}
