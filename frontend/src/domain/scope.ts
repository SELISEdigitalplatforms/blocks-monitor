// Pure scope rules (no I/O). Shared by the scope.* functions and the scope page.
import type { WorkspacePermission } from "./rbac";
import { milestoneLockBlockers } from "./milestones";
import type { MilestoneBlocker, MilestonePlan } from "./milestones";

export type FeaturePriority = "must" | "nice" | "later" | "excluded";
const PRIORITIES: readonly string[] = ["must", "nice", "later", "excluded"];

export interface DraftFeature {
  id?: string;
  clientKey?: string;
  name: string;
  description: string;
  priority: FeaturePriority;
  excludedReason?: string;
  requirementIds: string[];
  screenIds: string[];
  sortOrder: number;
}

export interface DraftStory {
  id?: string;
  clientKey?: string;
  /** An existing feature id, or the clientKey of a feature in the same change. */
  featureId: string;
  actor: string;
  text: string;
  acceptanceCriteria: string[];
  sortOrder: number;
}

// Where S1's validations are stricter than the design, the S1 number is used.
export const SCOPE_LIMITS = {
  features: 100,
  storiesPerFeature: 40,
  stories: 400,
  criteria: 20,
  criterionChars: 500,
  screensPerFeature: 30,
  featureName: 120, // S1 Feature.Title allows 200
  featureDescription: 2000, // S1 Feature.Description allows 5000
  excludedReason: 500,
  storyActor: 60, // S1 Story.ActorRole: 60
  storyText: 500, // S1 Story.Text allows 5000
  storyTitle: 200, // S1 Story.Title: 200
} as const;

export function normaliseCriteria(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= SCOPE_LIMITS.criteria) break;
  }
  return out;
}

// S1 Feature.Key / Milestone.FeatureRefs pattern.
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Refs ALWAYS use the feature's Key (a server-made UUIDv5 natural id), never
 * the gateway ItemId: `feature:<Feature.Key>`.
 */
export function featureRef(featureKey: string): string {
  return "feature:" + featureKey;
}

export function parseFeatureRef(ref: string): string | null {
  if (typeof ref !== "string" || !ref.startsWith("feature:")) return null;
  const key = ref.slice("feature:".length);
  return KEY_RE.test(key) ? key : null;
}

export function requirementRef(key: string): string {
  return "requirement:" + key;
}

export function parseRequirementRef(ref: string): string | null {
  if (typeof ref !== "string" || !ref.startsWith("requirement:")) return null;
  const key = ref.slice("requirement:".length);
  return KEY_RE.test(key) ? key : null;
}

export function storyTitle(actor: string, text: string): string {
  return `${actor} can ${text}`.trim().slice(0, SCOPE_LIMITS.storyTitle);
}

export interface ScopeChange {
  upsertFeatures?: DraftFeature[];
  removeFeatureIds?: string[];
  upsertStories?: DraftStory[];
  removeStoryIds?: string[];
}

export interface ScopeRefs {
  requirementIds: readonly string[];
  screenIds: readonly string[];
  features: readonly { id: string }[];
  stories: readonly { id: string; featureId: string }[];
}

export interface FieldIssue {
  path: string;
  rule:
    | "required"
    | "tooLong"
    | "tooMany"
    | "unknownRequirement"
    | "unknownScreen"
    | "unknownFeature"
    | "unknownStory"
    | "featureRemoved"
    | "limit"
    | "invalid";
  params?: Record<string, string | number>;
}

export function validateScopeChange(change: ScopeChange, refs: ScopeRefs, mode: "save"): FieldIssue[] {
  void mode;
  const issues: FieldIssue[] = [];
  const L = SCOPE_LIMITS;
  const reqs = new Set(refs.requirementIds);
  const screens = new Set(refs.screenIds);
  const featureIds = new Set(refs.features.map((f) => f.id));
  const storyIds = new Set(refs.stories.map((s) => s.id));
  const removedFeatures = new Set(change.removeFeatureIds ?? []);
  const upF = change.upsertFeatures ?? [];
  const upS = change.upsertStories ?? [];
  const newFeatureKeys = new Set<string>();

  (change.removeFeatureIds ?? []).forEach((id, i) => {
    if (!featureIds.has(id)) issues.push({ path: `removeFeatureIds.${i}`, rule: "unknownFeature" });
  });
  (change.removeStoryIds ?? []).forEach((id, i) => {
    if (!storyIds.has(id)) issues.push({ path: `removeStoryIds.${i}`, rule: "unknownStory" });
  });

  upF.forEach((f, i) => {
    const p = `upsertFeatures.${i}`;
    if (f.id) {
      if (!featureIds.has(f.id)) issues.push({ path: `${p}.id`, rule: "unknownFeature" });
    } else if (f.clientKey) newFeatureKeys.add(f.clientKey);
    else issues.push({ path: `${p}.id`, rule: "invalid" });
    const name = (f.name ?? "").trim();
    if (!name) issues.push({ path: `${p}.name`, rule: "required" });
    else if (name.length > L.featureName) issues.push({ path: `${p}.name`, rule: "tooLong", params: { max: L.featureName } });
    if ((f.description ?? "").length > L.featureDescription)
      issues.push({ path: `${p}.description`, rule: "tooLong", params: { max: L.featureDescription } });
    if (!PRIORITIES.includes(f.priority)) issues.push({ path: `${p}.priority`, rule: "invalid" });
    else if (f.priority === "excluded" && (f.excludedReason ?? "").length > L.excludedReason)
      issues.push({ path: `${p}.excludedReason`, rule: "tooLong", params: { max: L.excludedReason } });
    (f.requirementIds ?? []).forEach((r, j) => {
      if (!reqs.has(r)) issues.push({ path: `${p}.requirementIds.${j}`, rule: "unknownRequirement" });
    });
    const sids = f.screenIds ?? [];
    if (sids.length > L.screensPerFeature)
      issues.push({ path: `${p}.screenIds`, rule: "tooMany", params: { max: L.screensPerFeature } });
    sids.forEach((s, j) => {
      if (!screens.has(s)) issues.push({ path: `${p}.screenIds.${j}`, rule: "unknownScreen" });
    });
  });

  upS.forEach((s, i) => {
    const p = `upsertStories.${i}`;
    if (s.id) {
      if (!storyIds.has(s.id)) issues.push({ path: `${p}.id`, rule: "unknownStory" });
    } else if (!s.clientKey) issues.push({ path: `${p}.id`, rule: "invalid" });
    if (removedFeatures.has(s.featureId)) issues.push({ path: `${p}.featureId`, rule: "featureRemoved" });
    else if (!featureIds.has(s.featureId) && !newFeatureKeys.has(s.featureId))
      issues.push({ path: `${p}.featureId`, rule: "unknownFeature" });
    const actor = (s.actor ?? "").trim();
    if (!actor) issues.push({ path: `${p}.actor`, rule: "required" });
    else if (actor.length > L.storyActor) issues.push({ path: `${p}.actor`, rule: "tooLong", params: { max: L.storyActor } });
    const text = (s.text ?? "").trim();
    if (!text) issues.push({ path: `${p}.text`, rule: "required" });
    else if (text.length > L.storyText) issues.push({ path: `${p}.text`, rule: "tooLong", params: { max: L.storyText } });
    const crit = s.acceptanceCriteria ?? [];
    if (crit.length > L.criteria) issues.push({ path: `${p}.acceptanceCriteria`, rule: "tooMany", params: { max: L.criteria } });
    crit.forEach((c, j) => {
      if (String(c).length > L.criterionChars)
        issues.push({ path: `${p}.acceptanceCriteria.${j}`, rule: "tooLong", params: { max: L.criterionChars } });
    });
  });

  // Totals after the change.
  const featuresAfter = featureIds.size - [...removedFeatures].filter((id) => featureIds.has(id)).length + newFeatureKeys.size;
  if (featuresAfter > L.features) issues.push({ path: "features", rule: "limit", params: { max: L.features } });

  const removedStories = new Set(change.removeStoryIds ?? []);
  const perFeature = new Map<string, number>();
  let storiesAfter = 0;
  for (const s of refs.stories) {
    if (removedStories.has(s.id) || removedFeatures.has(s.featureId)) continue;
    storiesAfter++;
    perFeature.set(s.featureId, (perFeature.get(s.featureId) ?? 0) + 1);
  }
  for (const s of upS) {
    if (s.id || removedFeatures.has(s.featureId)) continue;
    storiesAfter++;
    perFeature.set(s.featureId, (perFeature.get(s.featureId) ?? 0) + 1);
  }
  if (storiesAfter > L.stories) issues.push({ path: "stories", rule: "limit", params: { max: L.stories } });
  for (const [fid, n] of perFeature) {
    if (n > L.storiesPerFeature)
      issues.push({ path: `stories.${fid}`, rule: "limit", params: { max: L.storiesPerFeature } });
  }
  return issues;
}

export interface LockFeature {
  id: string;
  key: string;
  priority: FeaturePriority;
}
export interface LockStory {
  id: string;
  featureId: string;
  text: string;
}
export type LockBlocker =
  | { kind: "noIncludedFeature" }
  | { kind: "featuresWithoutStories"; featureIds: string[] }
  | { kind: "emptyStories"; storyIds: string[] }
  | MilestoneBlocker;

export function lockBlockers(input: {
  features: readonly LockFeature[];
  stories: readonly LockStory[];
  milestones: MilestonePlan;
}): LockBlocker[] {
  const out: LockBlocker[] = [];
  const included = input.features.filter((f) => f.priority !== "excluded");
  if (included.length === 0) out.push({ kind: "noIncludedFeature" });
  const ids = new Set(included.map((f) => f.id));
  const withStories = new Set(input.stories.filter((s) => ids.has(s.featureId)).map((s) => s.featureId));
  const without = included.filter((f) => !withStories.has(f.id)).map((f) => f.id);
  if (without.length) out.push({ kind: "featuresWithoutStories", featureIds: without });
  const empty = input.stories.filter((s) => ids.has(s.featureId) && !(s.text ?? "").trim()).map((s) => s.id);
  if (empty.length) out.push({ kind: "emptyStories", storyIds: empty });
  out.push(...milestoneLockBlockers(input.milestones, included.map((f) => featureRef(f.key))));
  return out;
}

export function isScopeStepOpen(step: string): boolean {
  return step === "scope";
}

export function canUnlock(input: { step: string; buildJobs: readonly { kind: string; status: string }[] }): boolean {
  if (input.step !== "board") return false;
  return !input.buildJobs.some(
    (j) => (j.kind === "build.run" || j.kind === "change.build") && j.status !== "cancelled",
  );
}

export const SCOPE_OP_NAMES = [
  "scope.open",
  "scope.save",
  "milestones.save",
  "milestones.suggest",
  "scope.grill",
  "scope.challenge.decide",
  "scope.challenge.undo",
  "scope.lock",
  "scope.unlock",
  "scope.feedback.add",
  "scope.feedback.setStatus",
  "scope.attachment.presign",
  "scope.attachment.commit",
  "scope.attachment.delete",
  "scope.attachment.url",
  "scope.screens.urls",
  "scope.success.save",
  "scope.success.ask",
  "scope.screens.review",
] as const;
export type ScopeOpName = (typeof SCOPE_OP_NAMES)[number];

// There is no scope.edit key in the catalogue, so editing the scope content uses
// requirements.edit. If the catalogue gains one, only this table changes.
export const SCOPE_OP_PERMISSION: Readonly<Record<ScopeOpName, WorkspacePermission>> = {
  "scope.open": "view",
  "scope.attachment.url": "view",
  "scope.screens.urls": "view",
  "scope.save": "requirements.edit",
  "scope.grill": "requirements.edit",
  "scope.challenge.decide": "requirements.edit",
  "scope.challenge.undo": "requirements.edit",
  "milestones.save": "milestones.edit",
  "milestones.suggest": "milestones.edit",
  "scope.lock": "scope.lock",
  "scope.unlock": "scope.lock",
  "scope.feedback.add": "comment",
  "scope.feedback.setStatus": "comment",
  "scope.attachment.presign": "comment",
  "scope.attachment.commit": "comment",
  "scope.attachment.delete": "comment",
  "scope.success.save": "requirements.edit",
  "scope.success.ask": "requirements.edit",
  "scope.screens.review": "requirements.edit",
};

/** Ops that only read (kind "view"); every other op is a command. */
export const SCOPE_VIEW_OPS = ["scope.attachment.url", "scope.screens.urls"] as const;
