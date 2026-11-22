// Plain sentences for this lane's messageKeys. Server free text is never shown.
import { successBlockersWords } from "@/components/requirements/domainLabels";
import { t } from "@/i18n";
import { FunctionError, functionErrorMessage } from "../fn";
import { FunctionNotConfiguredError } from "../functions";
import type { LockBlocker } from "../../domain/scope";
import type { FieldIssue } from "../../domain/scope";
import type { MilestoneIssue } from "../../domain/milestones";

/** Every text below is read at call time, so it comes in the current language. */
const notConfiguredText = () => t("analysis.messages.scope.notConfigured", "The project functions are not configured yet, so changes can't be saved.");

/** "Someone else changed this…": the one sentence for a row someone else saved first. */
export const staleRowText = () => t("analysis.messages.scope.staleRow", "Someone else changed this. Reload to see their version.");
/** The same sentence in English, for the callers not switched to staleRowText() yet (it is read once, at load). */
export const STALE_ROW_TEXT = "Someone else changed this. Reload to see their version.";

/** A call that may still land (deadline run out, host busy): one sentence on every Scope surface. */
export const PENDING_TEXT = functionErrorMessage("timeout");
const PENDING_CODES = new Set<string>(["timeout", "unavailable"]);

type Params =Record<string, unknown> | undefined;
type Message = string | ((params: Params) => string);

export interface BlockerNames {
  feature(idOrRef: string): string;
  milestone(key: string): string;
}

const DEFAULT_NAMES: BlockerNames = {
  feature: () => t("analysis.messages.scope.aFeature", "a feature"),
  milestone: () => t("analysis.messages.scope.aMilestone", "a milestone"),
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const joinNames = (names: string[]): string => {
  const unique = [...new Set(names)];
  return unique.length <= 3 ? unique.join(", ")
    : t("analysis.messages.scope.namesAndMore", "{names} and {count} more", { names: unique.slice(0, 3).join(", "), count: unique.length - 3 });
};

/** One lock blocker as a sentence; names are looked up by the caller, unknown ones read "a feature". */
export function lockBlockerText(b: LockBlocker, names: BlockerNames = DEFAULT_NAMES): string {
  switch (b.kind) {
    case "noIncludedFeature":
      return t("analysis.messages.scope.includeFeature", "Include at least one feature.");
    case "featuresWithoutStories":
      return t("analysis.messages.scope.addStoryTo", "Add a user story to {names}.", { names: joinNames(b.featureIds.map((id) => names.feature(id))) });
    case "emptyStories":
      return b.storyIds.length === 1 ? t("analysis.messages.scope.emptyStoryOne", "One user story has no text.")
        : t("analysis.messages.scope.emptyStoryMany", "{count} user stories have no text.", { count: b.storyIds.length });
    case "noMilestone":
      return t("analysis.messages.scope.needMilestone", "A scope needs at least one milestone.");
    case "unassignedFeatures":
      return t("analysis.messages.scope.putInMilestone", "Put {names} in a milestone.", { names: joinNames(b.featureRefs.map((r) => names.feature(r))) });
    case "emptyMilestones":
      return t("analysis.messages.scope.addFeatureTo", "Add a feature to {names} or remove it.", { names: joinNames(b.milestoneKeys.map((k) => names.milestone(k))) });
    default:
      return t("analysis.messages.scope.notReadyToLock", "The scope isn't ready to lock.");
  }
}

/** A field issue as a sentence: "{label} is required." and so on, by rule. */
function fieldRuleText(rule: FieldIssue["rule"], label: string): string {
  switch (rule) {
    case "required": return t("analysis.messages.scope.rule.required", "{label} is required.", { label });
    case "tooLong": return t("analysis.messages.scope.rule.tooLong", "{label} is too long.", { label });
    case "tooMany": return t("analysis.messages.scope.rule.tooMany", "{label} has too many entries.", { label });
    case "unknownRequirement": return t("analysis.messages.scope.rule.unknownRequirement", "{label} points to a requirement that doesn't exist.", { label });
    case "unknownScreen": return t("analysis.messages.scope.rule.unknownScreen", "{label} points to a screen that doesn't exist.", { label });
    case "unknownFeature": return t("analysis.messages.scope.rule.unknownFeature", "{label} points to a feature that doesn't exist.", { label });
    case "unknownStory": return t("analysis.messages.scope.rule.unknownStory", "{label} points to a story that doesn't exist.", { label });
    case "featureRemoved": return t("analysis.messages.scope.rule.featureRemoved", "{label} belongs to a removed feature.", { label });
    case "limit": return t("analysis.messages.scope.rule.limit", "{label} is over the limit.", { label });
    default: return t("analysis.messages.scope.rule.invalid", "{label} isn't valid.", { label });
  }
}

/** A field's name in a sentence; "A field" for any other. */
function fieldLabel(field: string): string {
  switch (field) {
    case "name": return t("analysis.messages.scope.field.name", "The feature name");
    case "description": return t("analysis.messages.scope.field.description", "The description");
    case "priority": return t("analysis.messages.scope.field.priority", "The priority");
    case "excludedReason": return t("analysis.messages.scope.field.excludedReason", "The reason");
    case "requirementIds": return t("analysis.messages.scope.field.requirementIds", "A linked requirement");
    case "screenIds": return t("analysis.messages.scope.field.screenIds", "The linked screens");
    case "actor": return t("analysis.messages.scope.field.actor", "Who");
    case "text": return t("analysis.messages.scope.field.text", "What they can do");
    case "acceptanceCriteria": return t("analysis.messages.scope.field.acceptanceCriteria", "An acceptance criterion");
    case "featureId": return t("analysis.messages.scope.field.featureId", "The story's feature");
    case "id": return t("analysis.messages.scope.field.id", "This item");
    default: return t("analysis.messages.scope.field.unknown", "A field");
  }
}

/** The sentence for a missing required field, where one says it better than "{label} is required". */
function requiredText(field: string): string | null {
  switch (field) {
    case "name": return t("analysis.messages.scope.requiredName", "Give the feature a name.");
    case "actor": return t("analysis.messages.scope.requiredActor", "Say who the story is for.");
    case "text": return t("analysis.messages.scope.requiredText", "Say what they can do.");
    default: return null;
  }
}

/** One field issue as a plain sentence; a path segment or key is never printed. */
export function fieldIssueText(i: FieldIssue): string {
  const segments = i.path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  const head = segments[0] ?? "";
  const max = i.params?.max;
  if (head === "removeFeatureIds" || head === "removeStoryIds") {
    return head === "removeFeatureIds"
      ? t("analysis.messages.scope.featureRemoved", "This feature was already removed. Reload to see the current scope.")
      : t("analysis.messages.scope.storyRemoved", "This story was already removed. Reload to see the current scope.");
  }
  if (i.rule === "limit" && max !== undefined) {
    if (head === "features" && segments.length === 1) return t("analysis.messages.scope.maxFeatures", "A scope can have at most {max} features.", { max: String(max) });
    if (head === "stories" && segments.length === 1) return t("analysis.messages.scope.maxStories", "A scope can have at most {max} user stories.", { max: String(max) });
    if (head === "stories") return t("analysis.messages.scope.maxFeatureStories", "A feature can have at most {max} user stories.", { max: String(max) });
  }
  const field = [...segments].reverse().find((s) => !/^\d+$/.test(s)) ?? "";
  const required = i.rule === "required" ? requiredText(field) : null;
  if (required) return required;
  const label = field === "acceptanceCriteria" && i.rule === "tooMany" ? t("analysis.messages.scope.field.acceptanceCriteriaAll", "The acceptance criteria") : fieldLabel(field);
  if (i.rule === "tooLong") {
    return max != null ? t("analysis.messages.scope.tooLongMax", "{label} can be at most {max} characters.", { label, max: String(max) })
      : t("analysis.messages.scope.tooLongAllowed", "{label} can be at most the allowed number of characters.", { label });
  }
  if (i.rule === "tooMany") {
    return max != null ? t("analysis.messages.scope.tooManyMax", "{label}: at most {max}.", { label, max: String(max) })
      : t("analysis.messages.scope.tooManyAllowed", "{label}: at most the allowed number.", { label });
  }
  return fieldRuleText(i.rule, label);
}

export function milestoneIssueText(i: MilestoneIssue): string {
  switch (i.rule) {
    case "tooFew": return t("analysis.messages.scope.needMilestone", "A scope needs at least one milestone.");
    case "tooMany": return t("analysis.messages.scope.milestone.tooMany", "A scope can have at most 20 milestones.");
    case "nameRequired": return t("analysis.messages.scope.milestone.nameRequired", "Give every milestone a name.");
    case "nameTooLong": return t("analysis.messages.scope.milestone.nameTooLong", "A milestone name can be at most 60 characters.");
    case "nameDuplicate": return t("analysis.messages.scope.milestone.nameDuplicate", "Two milestones have the same name.");
    case "goalTooLong": return t("analysis.messages.scope.milestone.goalTooLong", "A milestone goal can be at most 500 characters.");
    case "unknownFeature": return t("analysis.messages.scope.milestone.unknownFeature", "A milestone holds a feature that doesn't exist.");
    case "excludedFeature": return t("analysis.messages.scope.milestone.excludedFeature", "A milestone holds a feature that isn't included.");
    case "duplicateFeature": return t("analysis.messages.scope.milestone.duplicateFeature", "A feature is in more than one milestone.");
    case "unassignedFeature": return t("analysis.messages.scope.milestone.unassignedFeature", "A feature is not in a milestone.");
    case "emptyMilestone": return t("analysis.messages.scope.milestone.emptyMilestone", "A milestone has no feature.");
    default: return t("analysis.messages.scope.milestone.invalid", "The milestones aren't valid.");
  }
}

const issueList = (p: Params, text: (i: never) => string): string => {
  const lines = list(p?.issues).filter(isRecord).map((i) => text(i as never));
  return lines.length ? [...new Set(lines)].slice(0, 5).join(" ") : "";
};

/** By messageKey; every entry is a function, so its text is read at call time in the current language. */
export const SCOPE_MESSAGES: Record<string, Message> = {
  "scope.notOpen": () => t("analysis.messages.scope.notOpen", "Scope & success opens once the goals and requirements are confirmed."),
  "scope.locked": () => t("analysis.messages.scope.locked", "The scope is locked. Unlock it to make changes."),
  "scope.notLocked": () => t("analysis.messages.scope.notLocked", "The scope is already open for changes."),
  "scope.lockBlocked": (p) => {
    const lines = list(p?.blockers).filter(isRecord).map((b) => lockBlockerText(b as unknown as LockBlocker));
    const success = successBlockersWords(list(p?.success));
    if (success) lines.push(success);
    return lines.length ? lines.join(" ") : t("analysis.messages.scope.notReadyToLock", "The scope isn't ready to lock.");
  },
  "scope.invalid": (p) => issueList(p, fieldIssueText as (i: never) => string)
    || t("analysis.messages.scope.invalid", "Some scope details aren't valid. Check them and try again."),
  "milestones.invalid": (p) => issueList(p, milestoneIssueText as (i: never) => string)
    || t("analysis.messages.scope.milestonesInvalid", "The milestones aren't valid. Check them and try again."),
  "milestones.stale": () => staleRowText(),
  "milestones.needsFeatures": () => t("analysis.messages.scope.needsFeatures", "Add at least one included feature first."),
  "build.started": () => t("analysis.messages.scope.buildStarted", "The build has started, so the scope can't be unlocked."),
  "scope.planRunning": () => t("analysis.messages.scope.planRunning", "The board is being planned from this scope. Wait for it to finish before unlocking."),
  "attachment.type": () => t("analysis.messages.scope.attachmentType", "Only PNG, JPEG, WebP and PDF files can be attached."),
  "attachment.size": () => t("analysis.messages.scope.attachmentSize", "A file can be at most 10 MB."),
  "attachment.count": () => t("analysis.messages.scope.attachmentCount", "A comment can have at most 5 files."),
  "attachment.notReady": () => t("analysis.messages.scope.attachmentNotReady", "A file isn't uploaded yet. Wait for it or remove it."),
  "attachment.missing": () => t("analysis.messages.scope.attachmentMissing", "The file didn't arrive. Try again."),
  "attachment.inUse": () => t("analysis.messages.scope.attachmentInUse", "This file belongs to a posted comment."),
  "challenge.reasonRequired": () => t("analysis.messages.scope.challengeReason", "Give a reason to dismiss this point."),
  "challenge.textRequired": () => t("analysis.messages.scope.challengeText", "Write your answer first."),
  "challenge.decided": () => t("analysis.messages.scope.challengeDecided", "This point was already decided."),
  "comment.required": () => t("analysis.messages.scope.commentRequired", "Write a comment first."),
  "comment.tooLong": () => t("analysis.messages.scope.commentTooLong", "A comment can be at most 5,000 characters."),
};

/** The sentence for a failed call; every unknown key falls back to the code's message. */
export function scopeErrorMessage(e: unknown): string {
  if (e instanceof FunctionNotConfiguredError) return notConfiguredText();
  if (e instanceof FunctionError) {
    const key = e.messageKey;
    if (key && Object.prototype.hasOwnProperty.call(SCOPE_MESSAGES, key)) {
      const m = SCOPE_MESSAGES[key];
      return typeof m === "function" ? m(e.params) : m;
    }
    if (PENDING_CODES.has(e.code)) return PENDING_TEXT;
    return functionErrorMessage(e.code);
  }
  return functionErrorMessage("unknown");
}
