/** The change request lifecycle in the UI (CHANGE-PROCESS-31.10): Requested → Analysis → Questions → Approval → Build →
 *  Development → Staging → Production. Pure: the step and the stage come from the ChangeRequest status and its
 *  Analysis, nothing is invented. A change request saved before the analysis existed (no Analysis, already building or
 *  released) keeps its old view: `legacy`. */
import type { DeliveryChangeRequest } from "@/blocks/delivery/types";
import { incrementsOf, parseChangeAnalysis, planIndexOf, unansweredQuestions, type ChangeAnalysis } from "@/domain/changeAnalysis";
import { CHANGE_STEPS, changeStepIndex, type ChangeStep } from "@/domain/delivery";
import { t } from "@/i18n";

export const STEP_LABEL: Record<ChangeStep, string> = {
  get requested() { return t("changes.step.requested", "Requested"); },
  get analysis() { return t("changes.step.analysis", "Analysis"); },
  get questions() { return t("changes.step.questions", "Questions"); },
  get approval() { return t("changes.step.approval", "Approval"); },
  get build() { return t("changes.step.build", "Build"); },
  get dev() { return t("changes.step.dev", "Development"); },
  get stage() { return t("changes.step.stage", "Staging"); },
  get production() { return t("changes.step.production", "Production"); },
};
export type LifecycleStepId = ChangeStep;
export type LifecycleState = "done" | "now" | "todo" | "skipped" | "failed" | "rejected";
export interface LifecycleStep { id: LifecycleStepId; label: string; state: LifecycleState; title: string }

/** What the change request page shows. */
export type ChangeStage =
  | "draft" // saved, not submitted yet
  | "analysing" // the business analyst is analysing it
  | "questions" // open questions for you
  | "refining" // every question is answered; the analysis is being refined
  | "review" // waiting for approval
  | "approved" // approved, fast lane: the build can start
  | "scope" // approved or judged a new feature: it goes through Scope & success
  | "rejected"
  | "analysisFailed"
  | "buildFailed"
  | "buildLost" // "building", but no build of its own ever reached the engine (its start answered nothing of its own)
  | "building"
  | "released" // released-dev, promoted-stage, promoted-production
  | "legacy"; // no analysis and already building or released: the old view

/** The decision fields of a change request (additive ChangeRequest fields; absent on older rows). */
export interface ChangeDecision {
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  selfApproved: boolean;
}

const OLD_STATUSES = new Set(["building", "released-dev", "promoted-stage", "promoted-production"]);
const RELEASED = new Set(["released-dev", "promoted-stage", "promoted-production"]);

/** The parsed Analysis of a change request, or null (none yet, or not readable). */
export function analysisOf(cr: Pick<DeliveryChangeRequest, "analysis">): ChangeAnalysis | null {
  return cr.analysis ? parseChangeAnalysis(cr.analysis) : null;
}

export function decisionOf(cr: Pick<DeliveryChangeRequest, "decidedAt" | "decidedByUserId" | "decisionNote" | "selfApproved">): ChangeDecision {
  return { decidedAt: cr.decidedAt ?? null, decidedByUserId: cr.decidedByUserId ?? null, decisionNote: cr.decisionNote ?? null, selfApproved: cr.selfApproved === true };
}

/** True when the change's newest change.build job stopped (failed or cancelled) and none runs: the engine leaves the
 *  change request at "building" then, and cr.startBuild takes it as a retry (checkChangeForBuild lastBuildFailed). */
export function buildStopped(job: { status: string } | null | undefined): boolean {
  return !!job && (job.status === "failed" || job.status === "cancelled");
}

/** How long a change may read "building" without any build of its own before the page says the request did not reach
 *  the development team: a start writes "building" only after its job is queued, so the job shows up within a few
 *  reads; two minutes leave room for a slow read. */
export const LOST_BUILD_MS = 2 * 60_000;

/** When a change is at "building" (`updatedAt`: when that was written) and the time now, for buildLost. */
export interface BuildClock {
  updatedAt?: string | null;
  now: number;
}

/** True when the change reads "building" but has no build of its own at all (`build`: its newest change.build job, by
 *  its input) for longer than LOST_BUILD_MS (or since an unknown time): the start never queued one (09.11.2026,
 *  PrimaBook CR-021: the start answered another change's running build). It is never "being built" then; cr.startBuild
 *  takes it as a retry (pure). */
export function buildLost(status: string, build: { status: string } | null | undefined, clock: BuildClock | null | undefined): boolean {
  if (status !== "building" || build || !clock) return false;
  const at = Date.parse(clock.updatedAt ?? "");
  return !Number.isFinite(at) || clock.now - at > LOST_BUILD_MS;
}

/** The stage of a change request from its status, analysis and decision; `build` is its newest change.build job (a
 *  change still "building" whose job stopped is buildFailed, so "Start the build again" is offered). The page says a
 *  change is being built only while its newest build has not ended: one still "building" whose newest build SUCCEEDED
 *  has nothing running (a start that queued no job left it there), so a feature delivery offers its next increment
 *  and any other change its build again (cr.startBuild takes both). With `clock`, one still "building" without any
 *  build of its own after LOST_BUILD_MS is buildLost (buildLost). */
export function changeStage(status: string, analysis: ChangeAnalysis | null, decision: Pick<ChangeDecision, "decidedAt">, build?: { status: string } | null, analyse?: { status: string } | null, clock?: BuildClock | null): ChangeStage {
  if (!analysis && OLD_STATUSES.has(status)) return "legacy";
  switch (status) {
    case "draft": return "draft";
    // `analyse` is the change's newest change.analyse job: one the system stopped (its time limit, its last attempt) leaves
    // the request analysing or refining with nothing running, so "Try the analysis again" is offered (cr.submit takes it)
    case "analysing": return buildStopped(analyse) ? "analysisFailed" : "analysing";
    case "questions":
      if (!analysis || unansweredQuestions(analysis).length > 0) return "questions";
      return buildStopped(analyse) ? "analysisFailed" : "refining";
    case "review": return "review";
    case "approved": return analysis?.route === "scope" ? "scope" : "approved";
    case "rejected": return "rejected";
    // an approved change failed in its build; otherwise the analysis failed
    case "failed": return decision.decidedAt && analysis ? "buildFailed" : "analysisFailed";
    case "building":
      if (analysis && buildStopped(build)) return "buildFailed";
      if (analysis && build?.status === "succeeded") return analysis.route === "feature" ? "approved" : "buildFailed";
      if (analysis && buildLost(status, build, clock)) return "buildLost";
      return "building";
    default: return RELEASED.has(status) ? "released" : "draft";
  }
}


const nowTitle = (id: LifecycleStepId): string | undefined => ({
  requested: t("changes.step.now.requested", "Saved; not sent for analysis yet"),
  analysis: t("changes.step.now.analysis", "The business analyst is analysing the change"),
  questions: t("changes.step.now.questions", "Questions for you"),
  approval: t("changes.step.now.approval", "Waiting for approval"),
  build: t("changes.step.now.build", "Ready to build"),
} as Partial<Record<LifecycleStepId, string>>)[id];

/** The eight steps with their state (the step itself from changeStepIndex). Released steps up to the change's
 *  environment are done; with `unfinished` (its steps after the deploy did not all finish: src/domain/afterDeploy.ts)
 *  the environment it is on is not done yet. */
export function lifecycleSteps(status: string, stage: ChangeStage, analysis: ChangeAnalysis | null, decidedAt: string | null, unfinished: boolean | "broken" = false): LifecycleStep[] {
  const at = changeStepIndex(status, !!decidedAt);
  const released = RELEASED.has(status) ? at : undefined;
  const noQuestions = !!analysis && analysis.questions.length === 0;
  return CHANGE_STEPS.map((id, i) => {
    const s = { id, label: STEP_LABEL[id] };
    let state: LifecycleState;
    if (released !== undefined && unfinished && i === released) {
      return { id: s.id, label: s.label, state: "now", title: unfinished === "broken" ? t("changes.step.title.broken", "{step}: there, but not usable yet (its own checks failed)", { step: s.label }) : t("changes.step.title.unfinished", "{step}: live, but the steps after the deploy are not finished", { step: s.label }) };
    }
    if (released !== undefined) state = i <= released ? "done" : "todo";
    else if (i < at) state = "done";
    else if (i > at) state = "todo";
    else state = stage === "rejected" ? "rejected" : stage === "analysisFailed" || stage === "buildFailed" || stage === "buildLost" ? "failed" : "now";
    if (s.id === "questions" && noQuestions && state === "done") state = "skipped";
    if (s.id === "build" && stage === "scope" && state === "now") state = "todo";
    const title = state === "done" ? t("changes.step.title.done", "{step}: done", { step: s.label })
      : state === "skipped" ? t("changes.step.title.skipped", "No questions were needed")
      : state === "rejected" ? t("changes.step.title.rejected", "The change was rejected")
      : state === "failed" ? (stage === "buildLost" ? t("changes.step.title.lost", "{step}: the request did not reach the development team; it can be started again", { step: s.label }) : t("changes.step.title.failed", "{step} stopped; it can be tried again", { step: s.label }))
      : state === "now" ? (stage === "refining" ? t("changes.step.title.refining", "Your answers are in; the analysis is being refined") : stage === "building" ? t("build.step.milestone.building", "Being built") : nowTitle(s.id) ?? s.label)
      : t("changes.step.title.todo", "{step}: not yet", { step: s.label });
    return { id: s.id, label: s.label, state, title };
  });
}

/** The kind of change in plain words. */
export const KIND_WORD: Record<ChangeAnalysis["kind"], string> = {
  get fix() { return t("changes.kind.fix", "Fix"); },
  get change() { return t("changes.kind.change", "Change"); },
  get feature() { return t("changes.kind.feature", "New feature"); },
};

/** "2 tickets" */
export const ticketCount = (n: number): string => (n === 1 ? t("build.step.ticketsOne", "{count} ticket", { count: n }) : t("build.step.ticketsMany", "{count} tickets", { count: n }));

/** One build of a feature on an existing product, as the change request page shows it. */
export interface IncrementState {
  n: number;
  title: string;
  goal: string;
  /** The planned tickets of the increment (indexes into analysis.tickets). */
  tickets: number[];
  /** Its tickets on the board that are done. */
  done: number;
  /** Every ticket of it is on the board and done: built and on dev. */
  built: boolean;
}

/**
 * The increments of a feature on an existing product (Analysis route "feature") with what the board says about them:
 * the tickets of the change (PlanRef cr:<id>:<k>) that are done. `next` is the first increment not built yet (null when
 * all are). Null for any other change (pure).
 */
export function featureProgress(
  analysis: ChangeAnalysis | null,
  changeRequestId: string,
  tickets: readonly { planRef: string; isDone: boolean }[],
): { increments: IncrementState[]; next: number | null; built: number } | null {
  if (!analysis || analysis.route !== "feature" || !analysis.feature) return null;
  const doneAt = new Map<number, boolean>();
  for (const t of tickets) {
    const k = planIndexOf(t.planRef, changeRequestId);
    if (k !== null) doneAt.set(k, (doneAt.get(k) ?? true) && t.isDone);
  }
  const increments = incrementsOf(analysis).map((i) => {
    const done = i.tickets.filter((k) => doneAt.get(k) === true).length;
    return { ...i, done, built: i.tickets.length > 0 && done === i.tickets.length };
  });
  const next = increments.find((i) => !i.built)?.n ?? null;
  return { increments, next, built: increments.filter((i) => i.built).length };
}

/** "API, web app and data" */
export function partsText(p: { api: boolean; web: boolean; data: boolean }): string {
  const xs = [p.api ? t("changes.parts.api", "API") : "", p.web ? t("changes.parts.web", "web app") : "", p.data ? t("changes.parts.data", "data") : ""].filter(Boolean);
  return xs.length <= 1 ? xs[0] ?? "" : t("build.streams.listed", "{first} and {last}", { first: xs.slice(0, -1).join(", "), last: xs[xs.length - 1]! });
}

/** "3 builds" */
export const buildCount = (n: number): string => (n === 1 ? t("changes.buildsOne", "{count} build", { count: n }) : t("changes.buildsMany", "{count} builds", { count: n }));
