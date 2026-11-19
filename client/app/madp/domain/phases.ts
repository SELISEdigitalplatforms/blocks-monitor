/**
 * The four steps a person sees (owner, 08.11.2026): Project Setup → Business Analysis → Software Engineering → Release.
 * Front end only: the stored journey (journey.ts: business, understanding, sanitization, requirements, scope, board,
 * build, release) and every backend rule stay exactly as they are. A phase groups stored steps:
 *   setup       = business
 *   analysis    = understanding, sanitization, requirements, scope (one page, /p/:id/analysis, one section each)
 *   engineering = board, build (the Build page: Board, Studio, Timeline)
 *   release     = release
 * No React, DOM or store imports.
 */
import { JOURNEY_SLUG, STEP_LABEL, type JourneyPage, type JourneyStep } from "./journey";
import { prefixPath } from "../lib/pathPrefix";

export const PHASES = ["setup", "analysis", "engineering", "release"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  setup: "Project Setup",
  analysis: "Business Analysis",
  engineering: "Software Engineering",
  release: "Release",
};

/** Short labels where room is tight. */
export const PHASE_SHORT_LABEL: Record<Phase, string> = {
  setup: "Setup",
  analysis: "Analysis",
  engineering: "Engineering",
  release: "Release",
};

/** Route slug of each phase: /p/:id/<slug>. */
export const PHASE_SLUG: Record<Phase, string> = {
  setup: JOURNEY_SLUG.business,
  analysis: "analysis",
  engineering: JOURNEY_SLUG.build,
  release: JOURNEY_SLUG.release,
};

/** The stored steps shown together on the Business Analysis page, in order (each is one section of the page). */
export const ANALYSIS_STEPS = ["understanding", "sanitization", "requirements", "scope"] as const;
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number];

export function isAnalysisStep(v: unknown): v is AnalysisStep {
  return typeof v === "string" && (ANALYSIS_STEPS as readonly string[]).includes(v);
}

/** The section names on the Business Analysis page. */
export const ANALYSIS_SECTION_LABEL: Record<AnalysisStep, string> = {
  understanding: STEP_LABEL.understanding,
  sanitization: STEP_LABEL.sanitization,
  requirements: STEP_LABEL.requirements,
  scope: STEP_LABEL.scope,
};

/** The phase a stored journey step belongs to. */
export function phaseOf(step: JourneyStep): Phase {
  if (step === "business") return "setup";
  if (step === "board" || step === "build") return "engineering";
  if (step === "release") return "release";
  return "analysis";
}

/** The phase a page belongs to (the Wiki and unknown pages: none). */
export function phaseOfPage(page: JourneyPage | "analysis" | null | undefined): Phase | null {
  if (!page || page === "wiki") return null;
  if (page === "analysis") return "analysis";
  return phaseOf(page);
}

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

/** "Step n of 4" for a stored step (1-based). */
export function phaseNumber(step: JourneyStep): number {
  return phaseIndex(phaseOf(step)) + 1;
}

export const PHASE_COUNT = PHASES.length;

/** The label of the phase a stored step belongs to ("Business Analysis" for scope). */
export function phaseLabelOf(step: JourneyStep): string {
  return PHASE_LABEL[phaseOf(step)];
}

/** The page of a stored step: the Business Analysis steps open their section of /p/:id/analysis. */
export function stepPath(projectId: string, step: JourneyStep | JourneyPage): string {
  if (isAnalysisStep(step)) return prefixPath(`/p/${projectId}/analysis#${step}`);
  return prefixPath(`/p/${projectId}/${JOURNEY_SLUG[step]}`);
}

/** The page where a project stands now (its phase page; an analysis step opens its section). */
export function phasePath(projectId: string, phase: Phase): string {
  return prefixPath(`/p/${projectId}/${PHASE_SLUG[phase]}`);
}
