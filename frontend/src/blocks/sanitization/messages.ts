// Plain sentences for the step-specific message keys the function answers with. Server free text is never shown.
import { t } from "@/i18n";
import { FunctionError, functionErrorMessage } from "../fn";
import { FunctionNotConfiguredError } from "../functions";
import { BlocksDataError } from "../data/errors";
import type { SanitizationSection } from "./types";

/** Every text below is read at call time, so it comes in the current language. */
const notConfiguredText = () => t("analysis.messages.sanitization.notConfigured", "This step can't save yet: the project function isn't connected.");
const genericText = () => t("analysis.messages.sanitization.generic", "Something went wrong. Please try again.");

/** A field's name in a sentence ("The question is required."); getters, so each name is read in the current language. */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  get question() { return t("analysis.messages.sanitization.field.question", "The question"); },
  get answer() { return t("analysis.messages.sanitization.field.answer", "The answer"); },
  get reason() { return t("analysis.messages.sanitization.field.reason", "The reason"); },
  get title() { return t("analysis.messages.sanitization.field.title", "The title"); },
  get decisionText() { return t("analysis.messages.sanitization.field.decisionText", "The decision"); },
  get rationale() { return t("analysis.messages.sanitization.field.rationale", "The rationale"); },
  get topic() { return t("analysis.messages.sanitization.field.topic", "The topic"); },
  get choice() { return t("analysis.messages.sanitization.field.choice", "The choice"); },
  get alternativesConsidered() { return t("analysis.messages.sanitization.field.alternativesConsidered", "The alternatives"); },
  get target() { return t("analysis.messages.sanitization.field.target", "The target"); },
  get integrationSystem() { return t("analysis.messages.sanitization.field.integrationSystem", "The external system"); },
  get consultedUserIds() { return t("analysis.messages.sanitization.field.consultedUserIds", "The consulted people"); },
  get description() { return t("analysis.messages.sanitization.field.description", "The description"); },
  get acceptanceCriteria() { return t("analysis.messages.sanitization.field.acceptanceCriteria", "The acceptance criteria"); },
  get statement() { return t("analysis.messages.sanitization.field.statement", "The objective"); },
  get highLevelDetails() { return t("analysis.messages.sanitization.field.highLevelDetails", "The high-level details"); },
  get architectureSummary() { return t("analysis.messages.sanitization.field.architectureSummary", "The architecture summary"); },
  get text() { return t("analysis.messages.sanitization.field.text", "The comment"); },
  get instruction() { return t("analysis.messages.sanitization.field.instruction", "The instruction"); },
  get area() { return t("analysis.messages.sanitization.field.area", "The area"); },
  get priority() { return t("analysis.messages.sanitization.field.priority", "The priority"); },
  get nfrCategory() { return t("analysis.messages.sanitization.field.nfrCategory", "The category"); },
  get ownerUserId() { return t("analysis.messages.sanitization.field.ownerUserId", "The owner"); },
  get sourceId() { return t("analysis.messages.sanitization.field.sourceId", "The source"); },
};

export type MessageParams = Record<string, unknown> | undefined;
type Message = (p: MessageParams) => string;

const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v !== "") ? String(v) : "");
const label = (p: MessageParams) => {
  const raw = typeof p?.field === "string" ? p.field : "";
  const f = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  return Object.prototype.hasOwnProperty.call(FIELD_LABEL, f) ? FIELD_LABEL[f] : t("analysis.messages.sanitization.field.unknown", "This field");
};

/** One blocker as the function and the domain report it. */
export interface BlockerLike {
  messageKey: string;
  params?: Record<string, unknown>;
}

/** Messages by the last segment(s) of the key, so "sanitization.notOpen" and "notOpen" both resolve. */
export const SANITIZATION_MESSAGES: Readonly<Record<string, Message>> = {
  notOpen: () => t("analysis.messages.sanitization.notOpen", "The project analysis hasn't been started yet, so this step isn't open."),
  v1Frozen: () => t("analysis.messages.sanitization.v1Frozen", "Requirements v1 is complete. Make further changes in Goals & requirements."),
  alreadyComplete: () => t("analysis.messages.sanitization.alreadyComplete", "This step is already complete."),
  notReady: (p) => {
    const blockers = Array.isArray(p?.blockers) ? (p.blockers as BlockerLike[]) : [];
    return [t("analysis.messages.sanitization.finishFirst", "Finish these first:"), ...blockers.map((b) => blockerText(b))].join("\n");
  },
  invalidField: (p) => {
    const rule = typeof p?.rule === "string" ? p.rule : "required";
    const n = num(p?.max);
    const field = label(p);
    if (rule === "tooLong") {
      return n ? t("analysis.messages.sanitization.tooLongMax", "{field} is too long (at most {max} characters).", { field, max: n })
        : t("analysis.messages.sanitization.tooLong", "{field} is too long.", { field });
    }
    if (rule === "tooMany") {
      return n ? t("analysis.messages.sanitization.tooManyMax", "{field} has too many entries (at most {max}).", { field, max: n })
        : t("analysis.messages.sanitization.tooMany", "{field} has too many entries.", { field });
    }
    if (rule === "enum" || rule === "format") return t("analysis.messages.sanitization.invalid", "{field} isn't valid.", { field });
    return t("analysis.messages.sanitization.required", "{field} is required.", { field });
  },
  stale: () => t("analysis.messages.sanitization.stale", "Someone else changed this. Reload it to see their version."),
  conflict: () => t("analysis.messages.sanitization.stale", "Someone else changed this. Reload it to see their version."),
  unavailable: () => t("analysis.messages.sanitization.unavailable", "This step isn't available for this project yet."),
  paused: () => t("analysis.messages.sanitization.paused", "This project is paused. Resume it to make changes in this step."),
  forbidden: () => t("analysis.messages.sanitization.forbidden", "Your role can't edit this step."),
  transition: () => t("analysis.messages.sanitization.transition", "This clarification can't move to that status from where it is."),
  cantAnswer: () => t("analysis.messages.sanitization.cantAnswer", "Only the owner of this clarification, or someone who can edit this step, can answer it."),
  attachmentNotReady: () => t("analysis.messages.sanitization.attachmentNotReady", "A file is still uploading or could not be added. Wait for it, or remove it and try again."),
  notMember: () => t("analysis.messages.sanitization.notMember", "That person isn't an active member of this workspace."),
  badReference: () => t("analysis.messages.sanitization.badReference", "That item doesn't belong to this project."),
  notFound: () => t("analysis.messages.sanitization.notFound", "This item no longer exists."),
  clarificationInUse: (p) => {
    const d = num(p?.decisionNumber);
    return d ? t("analysis.messages.sanitization.inUseByDecision", "Decision D-{number} links this clarification, so it can't be deleted.", { number: d.replace(/^D-/, "") })
      : t("analysis.messages.sanitization.inUse", "A decision links this clarification, so it can't be deleted.");
  },
  supersedeTarget: () => t("analysis.messages.sanitization.supersedeTarget", "Only an accepted decision of this project can be superseded."),
  decisionSuperseded: () => t("analysis.messages.sanitization.decisionSuperseded", "A superseded decision stays in the log as it was: it can't be changed or deleted. Deleting the decision that replaced it brings it back."),
  limit: (p) => {
    const n = num(p?.max);
    // the kind is a code ("techDecisions"): shown as words in English only, a plain "entries" otherwise
    const what = typeof p?.kind === "string" ? p.kind.replace(/([A-Z])/g, " $1").toLowerCase() : "entries";
    return n ? t("analysis.messages.sanitization.limitMax", "You've reached the limit of {max} {what} for this project.", { max: n, what })
      : t("analysis.messages.sanitization.limit", "You've reached the limit {what} for this project.", { what });
  },
  notAuthor: () => t("analysis.messages.sanitization.notAuthor", "You can only delete your own comments."),
  batchTooLarge: (p) => {
    const n = num(p?.max);
    return n ? t("analysis.messages.sanitization.batchTooLargeMax", "That is too much to save at once (at most {max} at a time).", { max: n })
      : t("analysis.messages.sanitization.batchTooLarge", "That is too much to save at once.");
  },
  journeyRefused: () => t("analysis.messages.sanitization.journeyRefused", "The project can't move on right now."),
  // blockers
  noRequirements: () => t("analysis.messages.sanitization.noRequirements", "Add at least one requirement."),
  requirementIncomplete: (p) => {
    const r = num(p?.number);
    const title = p?.missing === "title";
    if (r) {
      const number = r.replace(/^R-/, "");
      return title ? t("analysis.messages.sanitization.requirementNeedsTitle", "Give requirement R-{number} a title.", { number })
        : t("analysis.messages.sanitization.requirementNeedsCriterion", "Give requirement R-{number} an acceptance criterion.", { number });
    }
    return title ? t("analysis.messages.sanitization.everyRequirementTitle", "Give every requirement a title.")
      : t("analysis.messages.sanitization.everyRequirementCriterion", "Give every requirement an acceptance criterion.");
  },
  noObjective: () => t("analysis.messages.sanitization.noObjective", "Write the objective statement."),
  openClarifications: (p) => {
    const n = num(p?.count);
    if (!n) return t("analysis.messages.sanitization.openClarifications", "Answer or defer the open clarifications.");
    return n === "1" ? t("analysis.messages.sanitization.openClarificationsOne", "Answer or defer the 1 open clarification.")
      : t("analysis.messages.sanitization.openClarificationsMany", "Answer or defer the {count} open clarifications.", { count: n });
  },
  draftRunning: () => t("analysis.messages.sanitization.draftRunning", "Wait for the MADP draft to finish, or cancel it."),
};

function messageFor(key: string): Message | undefined {
  const parts = key.split(".");
  const last = parts[parts.length - 1];
  return Object.prototype.hasOwnProperty.call(SANITIZATION_MESSAGES, last) ? SANITIZATION_MESSAGES[last] : undefined;
}

/** Plain text for a message key; null when the key is unknown. */
export function sanitizationMessage(key: string, params?: Record<string, unknown>): string | null {
  const m = messageFor(key);
  return m ? m(params) : null;
}

export function blockerText(b: BlockerLike): string {
  return sanitizationMessage(b.messageKey, b.params) ?? t("analysis.messages.sanitization.finishRemaining", "Finish the remaining steps first.");
}

/** The section a blocker is fixed in. */
export function blockerSection(messageKey: string): SanitizationSection {
  return /openClarifications$/.test(messageKey) ? "clarifications" : "requirements";
}

/** The plain sentence for any error of a sanitization read or write. */
export function sanitizationErrorText(e: unknown): string {
  if (e instanceof FunctionNotConfiguredError) return notConfiguredText();
  if (e instanceof FunctionError) {
    if (e.messageKey) {
      const text = sanitizationMessage(e.messageKey, e.params);
      if (text) return text;
    }
    return e.message || functionErrorMessage(e.code);
  }
  if (e instanceof BlocksDataError) return e.message;
  return genericText();
}

