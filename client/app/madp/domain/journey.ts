/**
 * The journey in its new order, as a pure state machine.
 * Business → Product sanitization → Requirements & objective → Scope confirmation
 * (incl. milestones) → Build (Board, Studio, Timeline) → Release, plus the Wiki page.
 * The stored stage "board" stays; it is shown as the Build step (see SHOWN_STEPS).
 * No React, DOM or store imports, so the server functions can bundle this file.
 */
import type { WorkspacePermission } from "./rbac";
import { prefixPath } from "../lib/pathPrefix";

/** The journey steps, in order. */
export const JOURNEY_STEPS = [
  "business",
  "understanding",
  "sanitization",
  "requirements",
  "scope",
  "board",
  "build",
  "release",
] as const;

export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** Pages of the journey: every step plus the Wiki, which is always open. */
export type JourneyPage = JourneyStep | "wiki";

/** The plain names a person sees (ids and route slugs stay as they are). */
export const STEP_LABEL: Record<JourneyPage, string> = {
  business: "Project setup",
  understanding: "Project understanding",
  sanitization: "Understanding your project",
  requirements: "Goals & requirements",
  scope: "Scope & success",
  board: "Build",
  build: "Build",
  release: "Release",
  wiki: "Wiki",
};

/** Short labels where room is tight. */
export const STEP_SHORT_LABEL: Record<JourneyPage, string> = {
  business: "Setup",
  understanding: "Review",
  sanitization: "Understanding",
  requirements: "Goals",
  scope: "Scope",
  board: "Build",
  build: "Build",
  release: "Release",
  wiki: "Wiki",
};

/** Route slug of each page: /p/:id/<slug>. */
export const JOURNEY_SLUG: Record<JourneyPage, string> = {
  business: "business",
  understanding: "understanding",
  sanitization: "sanitization",
  requirements: "requirements",
  scope: "scope",
  board: "build",
  build: "build",
  release: "delivered",
  wiki: "wiki",
};

/** The page behind a route slug, including the older slugs (brief, objective); null when unknown. */
export function pageFromSlug(slug: string): JourneyPage | null {
  for (const page of Object.keys(JOURNEY_SLUG) as JourneyPage[]) {
    if (page === "board") continue; // shares the slug "build"; the stored stage is shown as Build
    if (JOURNEY_SLUG[page] === slug) return page;
  }
  if (slug === "board") return "build";
  if (slug === "brief") return "business";
  if (slug === "objective") return "requirements";
  return null;
}

/** Where a project stands in the journey. */
export interface StepState {
  step: JourneyStep;
  scopeLocked: boolean;
}

export function initialJourney(): StepState {
  return { step: "business", scopeLocked: false };
}

export type JourneyAction =
  | "business.handOver"
  | "understanding.confirm"
  | "sanitization.complete"
  | "requirements.confirm"
  | "scope.lock"
  | "scope.unlock"
  | "build.start"
  | "build.complete";

/** Who is acting: a person with permissions, or the MADP engine. */
export type JourneyActor =
  | { kind: "user"; permissions: readonly string[] }
  | { kind: "engine" };

/** Facts the rules may need beyond the state itself. */
export interface JourneyFacts {
  milestoneCount?: number;
}

/** Allowed transitions, in journey order. */
export const TRANSITIONS: Readonly<
  Record<
    JourneyAction,
    { from: JourneyStep; to: JourneyStep; by: "user" | "engine"; permission?: WorkspacePermission }
  >
> = {
  "business.handOver": { from: "business", to: "understanding", by: "user", permission: "business.edit" },
  "understanding.confirm": { from: "understanding", to: "sanitization", by: "user", permission: "business.edit" },
  "sanitization.complete": { from: "sanitization", to: "requirements", by: "user", permission: "sanitization.edit" },
  "requirements.confirm": { from: "requirements", to: "scope", by: "user", permission: "requirements.edit" },
  "scope.lock": { from: "scope", to: "board", by: "user", permission: "scope.lock" },
  // Only possible before the build starts, which `from: board` guarantees.
  "scope.unlock": { from: "board", to: "scope", by: "user", permission: "scope.lock" },
  "build.start": { from: "board", to: "build", by: "user", permission: "build.run" },
  "build.complete": { from: "build", to: "release", by: "engine" },
};

export type JourneyResult =
  | { ok: true; state: StepState }
  | { ok: false; state: StepState; reason: string };

/** Applies an action. Never mutates the input; a denial returns the state unchanged. */
export function journeyStep(
  state: StepState,
  action: JourneyAction,
  actor: JourneyActor,
  facts: JourneyFacts = {},
): JourneyResult {
  const t = TRANSITIONS[action];
  const deny = (reason: string): JourneyResult => ({ ok: false, state, reason });
  if (!t) return deny("This step isn't available.");
  if (state.step !== t.from) {
    if (t.from === "board") {
      return deny(stepIndex(state.step) > stepIndex("board") ? "The build has already started." : "Lock the scope first.");
    }
    return deny(`${STEP_LABEL[t.from]} isn't open.`);
  }
  if (actor.kind !== t.by) {
    return deny(t.by === "engine" ? "Only the MADP engine completes the build." : "This step is confirmed by a person.");
  }
  if (actor.kind === "user" && t.permission && !actor.permissions.includes(t.permission)) {
    return deny("You don't have permission for this step.");
  }
  if (action === "scope.lock" && !((facts.milestoneCount ?? 0) >= 1)) {
    return deny("Add at least one milestone before you lock the scope.");
  }
  const scopeLocked = action === "scope.lock" ? true : action === "scope.unlock" ? false : state.scopeLocked;
  return { ok: true, state: { step: t.to, scopeLocked } };
}

/** The actions journeyStep would accept right now, in TRANSITIONS order. */
export function allowedJourneyActions(
  state: StepState,
  actor: JourneyActor,
  facts?: JourneyFacts,
): JourneyAction[] {
  return (Object.keys(TRANSITIONS) as JourneyAction[]).filter((a) => journeyStep(state, a, actor, facts).ok);
}

export function stepIndex(step: JourneyStep): number {
  return JOURNEY_STEPS.indexOf(step);
}

/** The journey facts as stored on a project (status machine plus the sanitized and scope-locked flags). */
export interface StoredJourney {
  status: string;
  resumeTo?: string;
  sanitized?: boolean;
  scopeLocked?: boolean;
}

/** Maps a stored project status to its journey step; a paused project stands where it resumes. */
export function journeyFromStored(j: StoredJourney): StepState {
  const eff = j.status === "paused" ? (j.resumeTo ?? "intake") : j.status;
  let step: JourneyStep;
  switch (eff) {
    case "intake":
    case "draft":
      step = "business";
      break;
    case "understanding":
      step = "understanding";
      break;
    case "understanding-done":
      step = j.sanitized === false ? "sanitization" : "requirements";
      break;
    case "objective":
      step = "requirements";
      break;
    case "scope":
    case "approval":
    case "changes":
    case "abandoned":
    case "rejected":
      step = j.scopeLocked ? "board" : "scope";
      break;
    case "approved":
    case "building":
    case "needs-decision":
    case "preview":
    case "acceptance":
    case "ready":
      step = "build";
      break;
    case "live":
    case "delivered":
      step = "release";
      break;
    default:
      step = "business";
  }
  return { step, scopeLocked: Boolean(j.scopeLocked) || stepIndex(step) >= stepIndex("board") };
}

/** The Wiki is always reachable; a step is reachable once the journey has got there. */
export function isStepReachable(state: StepState, page: JourneyPage): boolean {
  if (page === "wiki") return true;
  return stepIndex(page) <= stepIndex(state.step);
}

/** The steps the app shows, in order (owner 20.10.2026): the Board is the first tab of the Build step, so the stored stage "board" is shown as Build. */
export const SHOWN_STEPS = ["business", "understanding", "sanitization", "requirements", "scope", "build", "release"] as const;
export type ShownStep = (typeof SHOWN_STEPS)[number];

export function shownStep(step: JourneyStep): ShownStep {
  if (step === "board") return "build";
  return step as ShownStep;
}

export function shownStepIndex(step: JourneyStep): number {
  return SHOWN_STEPS.indexOf(shownStep(step));
}

/** The Build step's capsule tabs, in order. */
export const BUILD_TABS = ["board", "studio", "timeline"] as const;
export type BuildTab = (typeof BUILD_TABS)[number];

export function isBuildTab(v: unknown): v is BuildTab {
  return typeof v === "string" && (BUILD_TABS as readonly string[]).includes(v);
}

/** The Timeline stages a link can open on (?stage=…), one per track, in the tracks' order. */
export const TIMELINE_STAGES = ["plan", "build", "review", "test", "security", "docs", "gate", "deploy"] as const;
export type TimelineStage = (typeof TIMELINE_STAGES)[number];

export function isTimelineStage(v: unknown): v is TimelineStage {
  return typeof v === "string" && (TIMELINE_STAGES as readonly string[]).includes(v);
}

/** A link to a tab of the Build step, optionally with a Board ticket highlighted or a Timeline stage in focus:
 *  buildTabPath(id, "timeline", null, "test") is /p/:id/build?tab=timeline&stage=test. */
export function buildTabPath(projectId: string, tab: BuildTab, ticketId?: string | null, stage?: TimelineStage | null): string {
  return prefixPath(`/p/${projectId}/build?tab=${tab}` + (ticketId ? `&ticket=${encodeURIComponent(ticketId)}` : "") + (stage ? `&stage=${stage}` : ""));
}
