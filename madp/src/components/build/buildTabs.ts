/** Pure helpers for the Build step's Board, Studio and Timeline capsule tabs. */
import { JOURNEY_STEPS, isBuildTab, isTimelineStage, stepIndex, type BuildTab, type JourneyStep, type TimelineStage } from "@/domain/journey";
import { isActiveEngineJob, type EngineJob } from "@/blocks/engine/types";
import type { StageId } from "@/data/types";
import { t } from "@/i18n";

export const BUILD_TAB_LABEL: Record<BuildTab, string> = {
  get board() { return t("build.tabs.board", "Board"); },
  get studio() { return t("build.tabs.studio", "Studio"); },
  get timeline() { return t("build.tabs.timeline", "Timeline"); },
};

/** The build has started once the project reached the stored build stage (or later) or a build.run job is active. */
export function isBuildStarted({ stage, jobs }: { stage: string; jobs: readonly EngineJob[] }): boolean {
  if ((JOURNEY_STEPS as readonly string[]).includes(stage) && stepIndex(stage as JourneyStep) >= stepIndex("build")) return true;
  return jobs.some((j) => j.kind === "build.run" && isActiveEngineJob(j));
}

/** A valid ?tab wins; a linked ?ticket opens the Board; otherwise Studio once the build started, else Board. */
export function resolveBuildTab({ tab, ticket, started }: { tab: string | null; ticket: string | null; started: boolean }): BuildTab {
  if (tab && isBuildTab(tab)) return tab;
  if (ticket) return "board";
  return started ? "studio" : "board";
}

/** A copy of the search params with the tab set; every other param is kept. */
export function searchWithBuildTab(search: URLSearchParams, tab: BuildTab): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set("tab", tab);
  return next;
}

/** A successful start moves to the Studio; a failed one stays where it is. */
export function tabAfterStart(ok: boolean, current: BuildTab): BuildTab {
  return ok ? "studio" : current;
}

/* ── the Build step's main area ───────────────────────────────────────────── */

/** The Build step's main area: Overview (the milestone in plain words, the default), the Board, the Queue (the planned
 *  work as a dependency map and a list) and the Studio and Timeline. */
export type StepTab = "overview" | "queue" | BuildTab;
export const STEP_TABS: readonly StepTab[] = ["overview", "board", "queue", "studio", "timeline"];
export const STEP_TAB_LABEL: Record<StepTab, string> = {
  get overview() { return t("build.tabs.overview", "Overview"); },
  get queue() { return t("build.tabs.queue", "Queue"); },
  get board() { return BUILD_TAB_LABEL.board; },
  get studio() { return BUILD_TAB_LABEL.studio; },
  get timeline() { return BUILD_TAB_LABEL.timeline; },
};

export const isStepTab = (v: unknown): v is StepTab => v === "overview" || v === "queue" || isBuildTab(v);

/** A valid ?tab wins (the old /board link keeps landing on the Board); a linked ?ticket opens the Board; else Overview. */
export function resolveStepTab({ tab, ticket }: { tab: string | null; ticket: string | null }): StepTab {
  if (isStepTab(tab)) return tab;
  if (ticket) return "board";
  return "overview";
}

/** A copy of the search params with the main-area tab set; every other param is kept. */
export function searchWithStepTab(search: URLSearchParams, tab: StepTab): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set("tab", tab);
  return next;
}

/* ── a linked Timeline stage (?stage=test, the Projects page's Tests link) ── */

/** The Timeline track each ?stage name opens on. */
export const TIMELINE_STAGE_ID: Record<TimelineStage, StageId> = {
  plan: "01", build: "02", review: "03", test: "04", security: "05", docs: "06", gate: "07", deploy: "deploy",
};

/** The track a ?stage names; null for none or an unknown name. */
export function linkedTimelineStage(stage: string | null): StageId | null {
  return isTimelineStage(stage) ? TIMELINE_STAGE_ID[stage] : null;
}

/** A copy of the search params without the linked stage (once the person picks a stage or follows the live one). */
export function searchWithoutStage(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete("stage");
  return next;
}

/** A calm note in a selected track that has nothing recorded yet. */
export const STAGE_EMPTY_NOTE: Partial<Record<StageId, string>> = { get "04"() { return t("build.tabs.testsEmpty", "No test runs yet. Tests run during each build."); } };
