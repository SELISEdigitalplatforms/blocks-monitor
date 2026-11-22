/** The engine's and the agents' words for people, in the current language: the job statuses and kinds
 *  (src/domain/engineJob.ts), the agents' roles (src/domain/agentChat.ts) and the chat offers' buttons
 *  (src/domain/chatActions.ts). Those domain modules stay free of the language runtime because the engine and the
 *  Blocks functions import them too; the screens read these records instead (each value is read when it is shown). */
import { t } from "@/i18n";
import type { EngineJobKind, EngineJobStatus } from "@/domain/engineJob";
import type { ChatRole } from "@/domain/agentChat";
import type { ChatActionKind } from "@/domain/chatActions";

/** JOB_STATUS_LABEL in the current language. */
export const JOB_STATUS_TEXT: Readonly<Record<EngineJobStatus, string>> = {
  get queued() { return t("build.jobs.status.queued", "Waiting to start"); },
  get claimed() { return t("build.jobs.status.claimed", "Started"); },
  get running() { return t("build.jobs.status.running", "In progress"); },
  get succeeded() { return t("build.jobs.status.succeeded", "Done"); },
  get failed() { return t("build.jobs.status.failed", "Failed"); },
  get cancelled() { return t("build.jobs.status.cancelled", "Cancelled"); },
};

/** ENGINE_JOB_KIND_LABEL in the current language. */
export const ENGINE_JOB_KIND_TEXT: Readonly<Record<EngineJobKind, string>> = {
  get "requirements.draft"() { return t("build.jobs.kind.requirementsDraft", "Requirements draft"); },
  get "sanitization.assist"() { return t("build.jobs.kind.sanitizationAssist", "Clarifying questions"); },
  get "design.generate"() { return t("build.jobs.kind.designGenerate", "Screen designs"); },
  get "scope.draft"() { return t("build.jobs.kind.scopeDraft", "Scope draft"); },
  get "scope.grill"() { return t("build.jobs.kind.scopeGrill", "Second opinion"); },
  get "scope.success"() { return t("build.jobs.kind.scopeSuccess", "Success & performance"); },
  get "milestones.suggest"() { return t("build.jobs.kind.milestonesSuggest", "Milestone plan"); },
  get "board.plan"() { return t("build.jobs.kind.boardPlan", "Work plan"); },
  get "build.run"() { return t("build.jobs.kind.buildRun", "Build"); },
  get "change.build"() { return t("build.jobs.kind.changeBuild", "Change build"); },
  get "change.analyse"() { return t("build.jobs.kind.changeAnalyse", "Change analysis"); },
  get "fix.analyse"() { return t("build.jobs.kind.fixAnalyse", "Bug analysis"); },
  get "preview.deploy"() { return t("build.jobs.kind.previewDeploy", "Milestone preview"); },
  get "wiki.generate"() { return t("build.jobs.kind.wikiGenerate", "Wiki pages"); },
  get "docs.generate"() { return t("build.jobs.kind.docsGenerate", "Project documentation"); },
  get "chat.reply"() { return t("build.jobs.kind.chatReply", "Assistant reply"); },
  get "setup.assist"() { return t("build.jobs.kind.setupAssist", "Reading what you shared"); },
  get "feedback.apply"() { return t("build.jobs.kind.feedbackApply", "Working on your feedback"); },
  get "file.extract"() { return t("build.jobs.kind.fileExtract", "Reading your file"); },
  get "engine.skills-sync"() { return t("build.jobs.kind.engineSkillsSync", "Syncing Blocks skills"); },
  get "product.document"() { return t("build.jobs.kind.productDocument", "Documenting the live product"); },
  get "platform.feedback"() { return t("build.jobs.kind.platformFeedback", "Sending feedback to the team board"); },
};

/** HUMAN_ROLE in the current language. */
export const HUMAN_ROLE_TEXT: Readonly<Record<ChatRole, string>> = {
  get planner() { return t("build.roles.planner", "Business analyst"); },
  get dev() { return t("build.roles.dev", "Tech lead"); },
  get reviewer() { return t("build.roles.reviewer", "Code reviewer"); },
  get qa() { return t("build.roles.qa", "QA engineer"); },
  get secops() { return t("build.roles.secops", "Security engineer"); },
  get docs() { return t("build.roles.docs", "Technical writer"); },
  get shipper() { return t("build.roles.shipper", "Release manager"); },
};

/** ACTION_BUTTON in the current language. */
export const ACTION_BUTTON_TEXT: Readonly<Record<ChatActionKind, string>> = {
  get "change-request"() { return t("build.chat.action.changeRequest", "Create the change request"); },
  get "preview-fix"() { return t("build.chat.action.previewFix", "Send it as preview feedback"); },
  get "update-design"() { return t("build.chat.action.updateDesign", "Post it on the screen"); },
  get "add-to-scope"() { return t("build.chat.action.addToScope", "Post it on the scope"); },
  get "parallel-streams"() { return t("build.chat.action.parallelStreams", "Set the parallel streams"); },
  get "continue-increments"() { return t("build.chat.action.continueIncrements", "Change the setting"); },
};
