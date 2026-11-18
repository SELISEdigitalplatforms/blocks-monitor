/** The project journey's steps and their states, from where the project stands (pure). */
import { JOURNEY_SLUG, SHOWN_STEPS, STEP_LABEL, pageFromSlug, shownStepIndex, stepIndex, type JourneyPage, type JourneyStep } from "@/madp/domain/journey";
import { ANALYSIS_STEPS, PHASES, PHASE_COUNT, PHASE_SLUG, phaseIndex, phaseOf, phaseOfPage, type AnalysisStep, type Phase } from "@/madp/domain/phases";
import { type ProjectType } from "@/madp/domain/projectType";
import { t } from "@/madp/i18n";
import { phaseName, phaseShortName, stepName, stepShortName } from "@/madp/components/project/stepNames";

export type NavStepId = JourneyPage;
export type NavStepState = "done" | "current" | "upcoming" | "disabled";
export interface NavStep { id: NavStepId; n: number | null; label: string; short?: string; slug: string; state: NavStepState; reason?: string }

/** The steps in order: number, label and the route slug (/p/:id/<slug>). The Wiki is not numbered. */
export const NAV_STEPS: { id: NavStepId; n: number | null; label: string; slug: string }[] = [
  ...SHOWN_STEPS.map((id, i) => ({ id: id as NavStepId, n: i + 1 as number | null, label: STEP_LABEL[id], slug: JOURNEY_SLUG[id] })),
  { id: "wiki", n: null, label: STEP_LABEL.wiki, slug: JOURNEY_SLUG.wiki },
];
/** The numbered steps (6): the Board is a tab of the Build step. */
export const NAV_STEP_COUNT = SHOWN_STEPS.length;

/** The label to draw at a viewport width: the short one between md and 1280 px, the full one elsewhere (pure). */
export function stepLabel(step: { id: NavStepId; label: string; short?: string }, width: number): string {
  return width >= 768 && width < 1280 ? step.short ?? stepShortName(step.id) : step.label;
}

/** The step a project path belongs to, or null. */
export function navStepFromPath(pathname: string): NavStepId | null {
  const slug = /^\/p\/[^/]+\/([^/]+)\/?$/.exec(pathname)?.[1];
  return slug ? pageFromSlug(slug) : null;
}

/** Pages with a right-hand column (Project setup, Understanding your project, Goals & requirements, Scope & success). */
export const hasAside = (id: NavStepId | null) => id === "business" || id === "sanitization" || id === "requirements" || id === "scope";

/** The journey row from lg: the journey bar, then the Assign control (compact below xl, at the width of the pages' right column from xl). */
export const NAV_ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_340px]";

/** The steps with the names of the project type (an existing product renames steps 2 and 3). */
function typedSteps(type: ProjectType) {
  return NAV_STEPS.map((s) => ({ ...s, label: stepName(s.id, type), short: stepShortName(s.id) }));
}

/** Why a step that is not open yet is locked (the step before it is not finished). */
function lockReasons(step: JourneyStep, type: ProjectType): Partial<Record<NavStepId, string>> {
  const startFirst = t("project.lock.startAnalysis", "Start the project analysis first");
  return {
    sanitization: startFirst,
    requirements: step === "sanitization"
      ? (type === "brownfield" ? t("project.lock.finishUnderstandingProduct", "Finish understanding your product first") : t("project.lock.finishUnderstandingProject", "Finish understanding your project first"))
      : startFirst,
    scope: t("project.lock.confirmRequirements", "Confirm the requirements first"),
    build: t("project.lock.lockScope", "Lock the scope first"),
    release: t("project.lock.finishBuild", "Finish the build first"),
  };
}

/** The steps of a Blocks project: "current" is the page being viewed, the rest follows the Project's journey step (pure). */
export function blocksProjectSteps({ step, viewing, type = "greenfield" }: { step: JourneyStep | null; viewing: NavStepId | null; type?: ProjectType }): NavStep[] {
  const view: NavStepId | null = viewing === "board" ? "build" : viewing;
  const steps = typedSteps(type);
  // The step is unknown while the project loads: neutral steps, no disabled state and no reason.
  if (step === null) return steps.map((s) => ({ ...s, state: view === s.id ? "current" : "upcoming" }));
  const at = shownStepIndex(step);
  const reasons = lockReasons(step, type);
  return steps.map((s) => {
    const idx = SHOWN_STEPS.indexOf(s.id as (typeof SHOWN_STEPS)[number]);
    const reachable = s.id === "wiki" || idx <= at;
    const state: NavStepState = view === s.id ? "current" : !reachable ? "disabled"
      : s.id !== "wiki" && idx < at ? "done" : "upcoming";
    return { ...s, state, ...(state === "disabled" ? { reason: reasons[s.id] } : {}) };
  });
}

/* ── the journey bar ──────────────────────────────────────────────────────── */

/** Where a step stands in the journey: finished, the one the project is on, the one after it, or further on. */
export type JourneyStatus = "done" | "now" | "next" | "locked";

/** What happens in each step, in one plain sentence, and who works on it. */
export interface StepGuide { what: string; who: string }

const ba = () => t("project.guide.who.businessAnalyst", "Business analyst");
const team = () => t("project.guide.who.buildTeam", "Build team");

const GUIDE: Record<ProjectType, Record<(typeof SHOWN_STEPS)[number], () => StepGuide>> = {
  greenfield: {
    business: () => ({ what: t("project.guide.greenfield.business", "Describe the client, their business and what they need, then start the project analysis."), who: ba() }),
    understanding: () => ({ what: t("project.guide.greenfield.understanding", "Check what was read from your project setup and files, confirm what you need, then confirm."), who: ba() }),
    sanitization: () => ({ what: t("project.guide.greenfield.sanitization", "Open questions are answered and key decisions made, so everyone understands the product the same way."), who: ba() }),
    requirements: () => ({ what: t("project.guide.greenfield.requirements", "Every requirement is written down, traced to where it came from and checked, with one clear goal."), who: ba() }),
    scope: () => ({ what: t("project.guide.greenfield.scope", "Features, screens, plan and estimate are agreed, with how success will be measured, and then locked."), who: ba() }),
    build: () => ({ what: t("project.guide.greenfield.build", "The product is built milestone by milestone; every task can be followed on the board."), who: team() }),
    release: () => ({ what: t("project.guide.greenfield.release", "The finished product is checked, released and handed over to the client."), who: team() }),
  },
  brownfield: {
    business: () => ({ what: t("project.guide.brownfield.business", "Describe the client, their product and the change they want, name its code repository, then start the project analysis."), who: ba() }),
    understanding: () => ({ what: t("project.guide.brownfield.understanding", "Check what was read from your project setup, your files and the existing product, then confirm."), who: ba() }),
    sanitization: () => ({ what: t("project.guide.brownfield.sanitization", "The existing product is read and described as it is today, and the change the client wants is clarified."), who: ba() }),
    requirements: () => ({ what: t("project.guide.brownfield.requirements", "The change is written down as clear requirements, each traced to where it came from, with one clear goal."), who: ba() }),
    scope: () => ({ what: t("project.guide.brownfield.scope", "What changes, the plan and the estimate are agreed, with how success will be measured, and then locked."), who: ba() }),
    build: () => ({ what: t("project.guide.brownfield.build", "The change is built milestone by milestone in the product's own code; every task can be followed on the board."), who: team() }),
    release: () => ({ what: t("project.guide.brownfield.release", "The changed product is checked, released and handed over to the client."), who: team() }),
  },
  greyfield: {
    business: () => ({ what: t("project.guide.greyfield.business", "Describe the client, their product and why it is rebuilt."), who: ba() }),
    understanding: () => ({ what: t("project.guide.greyfield.understanding", "Check what was read from the existing product's documents, then confirm."), who: ba() }),
    sanitization: () => ({ what: t("project.guide.greyfield.sanitization", "The existing product is read and described, with the business rules and data to keep."), who: ba() }),
    requirements: () => ({ what: t("project.guide.greyfield.requirements", "Every requirement of the rebuilt product is written down and checked, with one clear goal."), who: ba() }),
    scope: () => ({ what: t("project.guide.greyfield.scope", "Features, screens, plan and estimate are agreed, with how success will be measured, and then locked."), who: ba() }),
    build: () => ({ what: t("project.guide.greyfield.build", "The product is rebuilt milestone by milestone; every task can be followed on the board."), who: team() }),
    release: () => ({ what: t("project.guide.greyfield.release", "The rebuilt product is checked, released and handed over to the client."), who: team() }),
  },
};

export function stepGuide(id: (typeof SHOWN_STEPS)[number], type: ProjectType = "greenfield"): StepGuide {
  return GUIDE[type][id]();
}

/** What happens in each of the four steps (owner 08.11.2026), in one plain sentence, and who works on it. */
const PHASE_GUIDE: Record<ProjectType, Record<Phase, () => StepGuide>> = {
  greenfield: {
    setup: GUIDE.greenfield.business,
    analysis: () => ({ what: t("project.phaseGuide.greenfield.analysis", "The project is understood, open questions are answered, the requirements are written down and the scope is agreed and locked."), who: ba() }),
    engineering: GUIDE.greenfield.build,
    release: GUIDE.greenfield.release,
  },
  brownfield: {
    setup: GUIDE.brownfield.business,
    analysis: () => ({ what: t("project.phaseGuide.brownfield.analysis", "The existing product is read, the change is clarified and written down as requirements, and its scope is agreed and locked."), who: ba() }),
    engineering: GUIDE.brownfield.build,
    release: GUIDE.brownfield.release,
  },
  greyfield: {
    setup: GUIDE.greyfield.business,
    analysis: () => ({ what: t("project.phaseGuide.greyfield.analysis", "The existing product is read and described, the requirements are written down and the scope is agreed and locked."), who: ba() }),
    engineering: GUIDE.greyfield.build,
    release: GUIDE.greyfield.release,
  },
};

/** An existing product attached to the Factory as it is live: it had no analysis and works through change requests,
 *  never milestone by milestone. */
const LIVE_PHASE_GUIDE: Record<Phase, () => StepGuide> = {
  setup: () => ({ what: t("project.phaseGuide.live.setup", "The product's profile, its code and the material you share, kept for everyone who works on it."), who: ba() }),
  analysis: () => ({ what: t("project.phaseGuide.live.analysis", "What the live product does today, written down from its code and documents."), who: ba() }),
  engineering: () => ({ what: t("project.phaseGuide.live.engineering", "Each approved change request is built in the product's own code and put on the development environment; every task can be followed on the board."), who: team() }),
  release: () => ({ what: t("project.phaseGuide.live.release", "Each change moves from development to staging and production, with release notes."), who: team() }),
};

export function phaseGuide(id: Phase, type: ProjectType = "greenfield", live = false): StepGuide {
  return live ? LIVE_PHASE_GUIDE[id]() : PHASE_GUIDE[type][id]();
}

/** Why a step that is not open yet is locked. */
function phaseLock(id: Phase): string {
  switch (id) {
    case "setup": return "";
    case "analysis": return t("project.lock.startAnalysis", "Start the project analysis first");
    case "engineering": return t("project.lock.lockScope", "Lock the scope first");
    case "release": return t("project.lock.finishBuild", "Finish the build first");
  }
}

/** One step of the journey bar's list. */
export interface JourneyItem {
  id: Phase;
  n: number;
  label: string;
  /** The compact name for tight widths. */
  short: string;
  slug: string;
  status: JourneyStatus;
  /** Done and current steps open; later ones are locked. */
  open: boolean;
  /** The page being viewed. */
  viewing: boolean;
  /** Why a locked step is not open yet. */
  reason?: string;
  what: string;
  who: string;
}

export interface Journey {
  /** The step the project is on (1-based) and its item; null while the project loads. */
  at: number | null;
  now: JourneyItem | null;
  /** The page being viewed, when it is one of the four steps. */
  viewing: JourneyItem | null;
  items: JourneyItem[];
  total: number;
}

/** The page a project path shows: a stored step's page, the Business Analysis page ("analysis"), or null. */
export function viewFromPath(pathname: string): NavStepId | "analysis" | null {
  const slug = /^\/p\/[^/]+\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (slug === PHASE_SLUG.analysis || slug === "analysis-next") return "analysis";
  return slug ? pageFromSlug(slug) : null;
}

/** The journey bar's model: the four steps, where the project stands and which steps can be opened (pure). */
export function journeyOf({ step, viewing, type = "greenfield", live = false }: { step: JourneyStep | null; viewing: NavStepId | "analysis" | null; type?: ProjectType; live?: boolean }): Journey {
  const view = phaseOfPage(viewing);
  const at = step === null ? null : phaseIndex(phaseOf(step));
  const items: JourneyItem[] = PHASES.map((id, i) => {
    const status: JourneyStatus = at === null ? "next" : i < at ? "done" : i === at ? "now" : i === at + 1 ? "next" : "locked";
    const open = at === null ? view === id : i <= at;
    const guide = phaseGuide(id, type, live);
    const lock = phaseLock(id);
    return {
      id, n: i + 1, label: phaseName(id), short: phaseShortName(id), slug: PHASE_SLUG[id], status, open, viewing: view === id,
      ...(at !== null && !open && lock ? { reason: lock } : {}),
      what: guide.what, who: guide.who,
    };
  });
  return { at: at === null ? null : at + 1, now: at === null ? null : items[at], viewing: items.find((s) => s.viewing) ?? null, items, total: PHASE_COUNT };
}

/** One part of the Business Analysis page (a stored step shown as a section). */
export interface AnalysisPart {
  id: AnalysisStep;
  n: number;
  label: string;
  status: JourneyStatus;
  /** Reached: its section shows the step's own page; otherwise the section says why it is not open yet. */
  open: boolean;
  reason?: string;
  what: string;
}

/** The Business Analysis page's parts and where each stands (pure). A project past the analysis has every part done. */
export function analysisParts({ step, type = "greenfield" }: { step: JourneyStep | null; type?: ProjectType }): AnalysisPart[] {
  const at = step === null ? -1 : stepIndex(step);
  const reasons = step === null ? {} : lockReasons(step, type);
  return ANALYSIS_STEPS.map((id, i) => {
    const idx = stepIndex(id);
    const status: JourneyStatus = at < 0 ? "next" : idx < at ? "done" : idx === at ? "now" : idx === at + 1 ? "next" : "locked";
    const open = at >= 0 && idx <= at;
    return {
      id, n: i + 1, label: stepName(id, type), status, open,
      ...(!open && at >= 0 ? { reason: (reasons as Partial<Record<string, string>>)[id] ?? t("project.lock.notOpenYet", "Not open yet") } : {}),
      what: stepGuide(id, type).what,
    };
  });
}

/** What the status chip of a step says. */
export const STATUS_TEXT: Record<JourneyStatus, string> = {
  get done() { return t("project.status.done", "Done"); },
  get now() { return t("project.status.now", "Now"); },
  get next() { return t("project.status.next", "Next"); },
  get locked() { return t("project.status.locked", "Locked"); },
};
