/** What the Blocks scope page may show and do, from the project's journey step, the scope version, the caller's
 *  permissions and the build jobs. Pure: no React, no hooks. The server re-checks every write. */
import { JOURNEY_STEPS, stepIndex, type JourneyStep } from "../../../domain/journey";
import { t } from "@/i18n";

export type ScopePhase = "beforeStep" | "draft" | "locked" | "buildStarted" | "released";
export type ReadOnlyReason = "viewer" | "locked" | "released" | null;

export interface ScopePageStateInput {
  stage: JourneyStep;
  version: { status: string } | null;
  permissions: readonly string[];
  buildJobs: readonly { status: string }[];
}

export interface ScopePageState {
  phase: ScopePhase;
  canEditFeatures: boolean;
  canEditMilestones: boolean;
  canLock: boolean;
  showUnlock: boolean;
  canComment: boolean;
  readOnlyReason: ReadOnlyReason;
}

/** A list from a hook result that is either the rows or a query with `data`. */
export function listOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const data = (result as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/** A build job other than a cancelled one means the build has started (or is queued to). */
export const hasLiveBuildJob = (jobs: readonly { status: string }[]): boolean => jobs.some((j) => j.status !== "cancelled");

export function scopePageState({ stage, version, permissions, buildJobs }: ScopePageStateInput): ScopePageState {
  const has = (p: string) => permissions.includes(p);
  const at = JOURNEY_STEPS.includes(stage) ? stepIndex(stage) : -1;
  const buildJob = hasLiveBuildJob(buildJobs);
  const phase: ScopePhase =
    at < stepIndex("scope") ? "beforeStep"
    : at >= stepIndex("release") ? "released"
    : at >= stepIndex("build") || buildJob ? "buildStarted"
    : version?.status === "locked" || at >= stepIndex("board") ? "locked"
    : "draft";
  const draft = phase === "draft";
  return {
    phase,
    canEditFeatures: draft && has("requirements.edit"),
    canEditMilestones: draft && has("milestones.edit"),
    canLock: draft && has("scope.lock"),
    // canUnlock (src/domain/scope.ts): only at step board with no build job other than a cancelled one
    showUnlock: phase === "locked" && stage === "board" && !buildJob && has("scope.lock"),
    canComment: draft && has("comment"),
    readOnlyReason: phase === "released" ? "released"
      : phase === "locked" || phase === "buildStarted" ? "locked"
      : draft && !has("requirements.edit") ? "viewer"
      : null,
  };
}

/** The sentence a read-only Features card shows. A viewer gets none: the view-only note already says it. */
export function readOnlyText(reason: ReadOnlyReason): string | null {
  return reason === "locked" ? t("analysis.scope.readOnly.locked", "The scope is locked, so its features and stories can't be changed.")
    : reason === "released" ? t("analysis.scope.readOnly.released", "This scope is released and can no longer be changed.")
    : null;
}

/* ── the lock checklist ───────────────────────────────────────────────────── */

/** `id` is the feature's ItemId; `ref` (`feature:<Key>`) is only for milestone FeatureRefs. */
export interface ChecklistFeature { id: string; ref: string; priority: string }
/** `featureId` is the feature's ItemId (the data layer translates the stored FeatureRef key). */
export interface ChecklistStory { featureId: string; text: string }
export interface ChecklistMilestone { featureRefs: readonly string[] }

/** `short`: the open condition in a few words, for the step's chip ("1 not in a milestone"). */
export interface ChecklistItem { key: string; ok: boolean; text: string; short?: string }

/** The milestones item while the scope draft is still to propose them (the milestones part's own words). */
export const MILESTONES_DRAFTING = "Your business analyst is planning the milestones from the features";

/** True while the scope draft (scope.draft, queued or running) is still writing the plan: no included feature or no
 *  milestone in it yet. The draft writes the features with their user stories first and the milestones after them
 *  (engine kinds/scope/draft.ts), so until they are in it is the draft's turn, not the person's: nothing may ask them to
 *  add a milestone or to lock yet. */
export function planBeingDrafted(drafting: boolean, included: number, milestones: number): boolean {
  return drafting && (included === 0 || milestones === 0);
}

/** The five lock conditions (the same ones as lockBlockers + validateMilestonePlan("lock"), which the function runs
 *  again). `text` reads as the condition when met and as the reason when open. `drafting`: the scope draft is queued
 *  or running, so a plan without milestones is waiting for the milestones it proposes, not for the person to add one. */
export function lockChecklist(
  features: readonly ChecklistFeature[],
  stories: readonly ChecklistStory[],
  milestones: readonly ChecklistMilestone[],
  drafting = false,
): ChecklistItem[] {
  const included = features.filter((f) => f.priority !== "excluded");
  const withStories = (id: string) => stories.some((s) => s.featureId === id && s.text.trim() !== "");
  const noStories = included.filter((f) => !withStories(f.id));
  const placed = new Set(milestones.flatMap((m) => m.featureRefs));
  const unplaced = included.filter((f) => !placed.has(f.ref));
  const includedRefs = new Set(included.map((f) => f.ref));
  const empty = milestones.filter((m) => !m.featureRefs.some((r) => includedRefs.has(r)));
  return [
    { key: "features", ok: included.length > 0, short: t("analysis.scope.check.noneIncluded", "none included"),
      text: included.length === 1 ? t("analysis.scope.check.featuresIncludedOne", "1 feature is included")
        : included.length > 0 ? t("analysis.scope.check.featuresIncluded", "{count} features are included", { count: included.length })
        : t("analysis.scope.check.includeOne", "Include at least one feature") },
    { key: "stories", ok: noStories.length === 0 && included.length > 0, short: t("analysis.scope.check.withoutStoriesShort", "{count} without stories", { count: noStories.length }),
      text: noStories.length === 0 && included.length > 0 ? t("analysis.scope.check.everyHasStories", "Every included feature has user stories")
        : included.length === 0 ? t("analysis.scope.check.everyNeedsStories", "Every included feature needs user stories")
        : noStories.length === 1 ? t("analysis.scope.check.noStoriesOne", "1 included feature has no user stories")
        : t("analysis.scope.check.noStories", "{count} included features have no user stories", { count: noStories.length }) },
    { key: "milestones", ok: milestones.length > 0,
      short: milestones.length === 0 && drafting ? t("analysis.scope.check.beingPlanned", "being planned") : t("analysis.scope.check.noMilestonesYet", "no milestones yet"),
      text: milestones.length === 1 ? t("analysis.scope.check.milestonesPlannedOne", "1 milestone planned")
        : milestones.length > 0 ? t("analysis.scope.check.milestonesPlanned", "{count} milestones planned", { count: milestones.length })
        : drafting ? t("analysis.scope.check.milestonesDrafting", "Your business analyst is planning the milestones from the features")
        : t("analysis.scope.check.addMilestone", "Add at least one milestone") },
    { key: "placed", ok: unplaced.length === 0 && included.length > 0 && milestones.length > 0, short: t("analysis.scope.check.notInMilestoneShort", "{count} not in a milestone", { count: unplaced.length }),
      text: unplaced.length === 0 && included.length > 0 && milestones.length > 0 ? t("analysis.scope.check.everyPlaced", "Every included feature is in a milestone")
        : unplaced.length > 0 && milestones.length > 0
          ? (unplaced.length === 1 ? t("analysis.scope.check.unplacedOne", "1 included feature is not in a milestone")
            : t("analysis.scope.check.unplaced", "{count} included features are not in a milestone", { count: unplaced.length }))
        : t("analysis.scope.check.everyMustBePlaced", "Every included feature must be in a milestone") },
    { key: "empty", ok: milestones.length > 0 && empty.length === 0,
      short: empty.length === 1 ? t("analysis.scope.check.emptyShortOne", "1 empty milestone") : t("analysis.scope.check.emptyShort", "{count} empty milestones", { count: empty.length }),
      text: milestones.length > 0 && empty.length === 0 ? t("analysis.scope.check.noneEmpty", "No milestone is empty")
        : empty.length === 1 ? t("analysis.scope.check.emptyOne", "1 milestone is empty")
        : empty.length > 0 ? t("analysis.scope.check.empty", "{count} milestones are empty", { count: empty.length })
        : t("analysis.scope.check.noneMayBeEmpty", "No milestone may be empty") },
  ];
}

/** How many stories belong to one of the loaded features (both sides are feature ItemIds). */
export function attachedStoryCount(features: readonly { id: string }[], stories: readonly { featureId: string }[]): number {
  const ids = new Set(features.map((f) => f.id));
  return stories.filter((s) => ids.has(s.featureId)).length;
}

/** The `data` of a hook result (a query), or null. */
export function dataOf<T>(result: unknown): T | null {
  const data = (result as { data?: unknown } | null | undefined)?.data;
  return data === undefined || data === null ? null : (data as T);
}

/** What Share on the scope page shares: the current scope version (its id is the stored item a workspace share and an
 *  external link point at). Without a version there is nothing to point at, so the ref stays empty and the dialog
 *  offers no external link. */
export function scopeShareTarget(projectName: string, versionId: string | null): { type: "scope"; ref: string; label: string } {
  return { type: "scope", ref: versionId ?? "", label: t("analysis.scope.shareLabel", "the scope of {name}", { name: projectName }) };
}
