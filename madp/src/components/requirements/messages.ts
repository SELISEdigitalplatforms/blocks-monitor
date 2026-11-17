/** Plain copy for every messageKey this lane's functions answer with, and the one error-to-text mapper of the page.
 *  Pure: the lane's specifics travel in messageKey, the code stays one of the shared FUNCTION_ERROR_MESSAGES codes. */
import { t } from "@/i18n";
import { BlocksDataError } from "@/blocks/data/errors";
import { FunctionError, functionErrorMessage } from "@/blocks/fn";
import { FunctionNotConfiguredError } from "@/blocks/functions";

/** Getters: each text is read at render time, so it comes in the current language. */
export const REQUIREMENTS_MESSAGES: Record<string, string> = {
  get "requirements.closed"() { return t("analysis.requirements.msgClosed", "The requirements are confirmed, so they stay as they are."); },
  get "version.stale"() { return t("analysis.requirements.msgVersionStale", "Someone saved a newer version first. Reload to see it, then edit again."); },
  get "version.notFound"() { return t("analysis.requirements.msgVersionNotFound", "That version no longer exists."); },
  get "requirement.removed"() { return t("analysis.requirements.msgRequirementRemoved", "That requirement was removed."); },
  get "requirement.limit"() { return t("analysis.requirements.msgRequirementLimit", "A project holds up to 200 requirements."); },
  get "criteria.tooMany"() { return t("analysis.requirements.msgCriteriaTooMany", "Up to 20 acceptance criteria fit on one item."); },
  get "suggestion.transition"() { return t("analysis.requirements.msgSuggestionTransition", "That suggestion can't change to this state."); },
  get "reorder.mismatch"() { return t("analysis.requirements.msgReorderMismatch", "The list changed meanwhile. Reload and move it again."); },
  get "requirements.blockers"() { return t("analysis.requirements.msgBlockers", "Some items are still open before you can continue."); },
  get "objective.notFound"() { return t("analysis.requirements.msgObjectiveNotFound", "The objective was not found."); },
  get "numbering.busy"() { return t("analysis.requirements.msgNumberingBusy", "Another save was in progress. Try again."); },
  get "design.type"() { return t("analysis.requirements.msgDesignType", "Use PNG, JPEG, WebP or PDF files."); },
  get "design.fileTooLarge"() { return t("analysis.requirements.msgDesignFileTooLarge", "A sample can be up to 10 MB."); },
  get "design.tooManySamples"() { return t("analysis.requirements.msgDesignTooManySamples", "Up to 10 samples can be added."); },
  get "design.totalTooLarge"() { return t("analysis.requirements.msgDesignTotalTooLarge", "The samples can total up to 50 MB."); },
  get "design.notSampleMode"() { return t("analysis.requirements.msgDesignNotSampleMode", "Switch to \"From a sample\" to add samples."); },
  get "design.sampleOrder"() { return t("analysis.requirements.msgDesignSampleOrder", "The sample order is out of date. Reload and try again."); },
  get "design.uploadMissing"() { return t("analysis.requirements.msgDesignUploadMissing", "The file did not arrive. Upload it again."); },
  get "design.notConfirmable"() { return t("analysis.requirements.msgDesignNotConfirmable", "Review and approve the Figma Make screens matching the current requirements before continuing."); },
  get "design.plannerOwned"() { return t("analysis.requirements.msgDesignPlannerOwned", "The business analyst generates the design from your requirements. Request a design change instead of editing it directly."); },
  get "design.feedbackRequired"() { return t("analysis.requirements.msgDesignFeedbackRequired", "Describe the change you want so it can be recorded against the requirements and design revision."); },
  get "design.previousJobRunning"() { return t("analysis.requirements.msgDesignPreviousJob", "An earlier design task is finishing. The Figma Make design will be prepared afterwards."); },
  get "input.invalid"() { return t("analysis.requirements.msgInputInvalid", "Check the entered values and try again."); },
  get "extra.limit"() { return t("analysis.requirements.msgExtraLimit", "A list holds up to 40 items."); },
  get "extra.removed"() { return t("analysis.requirements.msgExtraRemoved", "That item was removed."); },
};

/** The text to show for any failed read or write of this page. */
export function requirementsErrorMessage(e: unknown): string {
  if (e instanceof FunctionNotConfiguredError) return t("analysis.requirements.msgNotConfigured", "This can't be saved yet: the project function is not configured.");
  if (e instanceof FunctionError) {
    const key = e.messageKey;
    if (key && Object.prototype.hasOwnProperty.call(REQUIREMENTS_MESSAGES, key)) return REQUIREMENTS_MESSAGES[key];
    return functionErrorMessage(e.code);
  }
  if (e instanceof BlocksDataError) return e.message;
  return t("analysis.requirements.msgGeneric", "Something went wrong. Please try again.");
}
