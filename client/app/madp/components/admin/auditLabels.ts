/** The audit log in plain words: every recorded action as a short sentence a non-technical admin reads at a glance
 *  ("project.create" → "Created a project"), in the current language. The stored action keys never reach the screen. */
import { t } from "@/madp/i18n";

const LABEL: Readonly<Record<string, () => string>> = {
  // people, accounts and workspaces
  "me.bootstrap": () => t("platform.auditLabels.meBootstrap", "Signed in for the first time"),
  "account.create": () => t("platform.auditLabels.accountCreate", "Created an account"),
  "account.deactivate": () => t("platform.auditLabels.accountDeactivate", "Deactivated an account"),
  "account.reactivate": () => t("platform.auditLabels.accountReactivate", "Reactivated an account"),
  "member.invite": () => t("platform.auditLabels.memberInvite", "Invited someone to a workspace"),
  "member.remove": () => t("platform.auditLabels.memberRemove", "Removed someone from a workspace"),
  "member.role": () => t("platform.auditLabels.memberRole", "Changed someone's role"),
  "member.setRole": () => t("platform.auditLabels.memberSetRole", "Changed someone's role"),
  "member.leave": () => t("platform.auditLabels.memberLeave", "Left a workspace"),
  "accessRequest.list": () => t("platform.auditLabels.accessRequestList", "Looked at the people waiting for an account"),
  "workspace.create": () => t("platform.auditLabels.workspaceCreate", "Created a workspace"),
  "workspace.rename": () => t("platform.auditLabels.workspaceRename", "Renamed a workspace"),
  "workspace.suspend": () => t("platform.auditLabels.workspaceSuspend", "Suspended a workspace"),
  "workspace.resume": () => t("platform.auditLabels.workspaceResume", "Resumed a workspace"),
  "workspace.list": () => t("platform.auditLabels.workspaceList", "Looked at all workspaces"),
  "workspace.inspect": () => t("platform.auditLabels.workspaceInspect", "Opened another workspace"),
  "workspace.exported": () => t("platform.auditLabels.workspaceExported", "Downloaded a workspace"),
  "workspaceRole.save": () => t("platform.auditLabels.workspaceRoleSave", "Saved a workspace role"),
  "workspaceRole.delete": () => t("platform.auditLabels.workspaceRoleDelete", "Deleted a workspace role"),
  "workspaceRole.applyTemplate": () => t("platform.auditLabels.workspaceRoleApplyTemplate", "Added a role from a template to an organization"),
  "people.access": () => t("platform.auditLabels.peopleAccess", "Looked at a person's access"),
  "platformRole.save": () => t("platform.auditLabels.platformRoleSave", "Saved a platform role"),
  "platformRole.delete": () => t("platform.auditLabels.platformRoleDelete", "Deleted a platform role"),
  "platformRole.assign": () => t("platform.auditLabels.platformRoleAssign", "Gave someone a platform role"),
  "platformRole.unassign": () => t("platform.auditLabels.platformRoleUnassign", "Took a platform role away"),
  "setting.save": () => t("platform.auditLabels.settingSave", "Changed a platform setting"),
  "seed.started": () => t("platform.auditLabels.seedStarted", "Started loading workspace content"),
  "seed.applied": () => t("platform.auditLabels.seedApplied", "Loaded workspace content"),
  "seed.removed": () => t("platform.auditLabels.seedRemoved", "Removed loaded workspace content"),
  // projects and the journey
  "project.create": () => t("platform.auditLabels.projectCreate", "Created a project"),
  "project.update": () => t("platform.auditLabels.projectUpdate", "Updated a project"),
  "project.delete": () => t("platform.auditLabels.projectDelete", "Deleted a project"),
  "project.assign": () => t("platform.auditLabels.projectAssign", "Assigned a project"),
  "project.setup": () => t("platform.auditLabels.projectSetup", "Worked on the project setup"),
  "project.setup.save": () => t("platform.auditLabels.projectSetupSave", "Saved the project setup"),
  "project.addon.landingPage.save": () => t("platform.auditLabels.projectAddonLandingPageSave", "Saved the landing page answers"),
  "project.addon.landingPage.confirm": () => t("platform.auditLabels.projectAddonLandingPageConfirm", "Confirmed the landing page section"),
  "project.setup.suggestion.decide": () => t("platform.auditLabels.projectSetupSuggestionDecide", "Decided on a suggestion in the project setup"),
  "business.handOver": () => t("platform.auditLabels.businessHandOver", "Started the project analysis"),
  "analysis.start": () => t("platform.auditLabels.analysisStart", "Started the project analysis"),
  "sanitization.assist": () => t("platform.auditLabels.sanitizationAssist", "Asked the business analyst for help"),
  "sanitization.draftInitial": () => t("platform.auditLabels.sanitizationDraftInitial", "Got the first understanding of the project"),
  "sanitization.draftAuto": () => t("platform.auditLabels.sanitizationDraftAuto", "Got an updated understanding of the project"),
  "sanitization.complete": () => t("platform.auditLabels.sanitizationComplete", "Confirmed the project understanding"),
  "clarification.save": () => t("platform.auditLabels.clarificationSave", "Saved a question"),
  "clarification.answer": () => t("platform.auditLabels.clarificationAnswer", "Answered a question"),
  "clarification.defer": () => t("platform.auditLabels.clarificationDefer", "Put a question aside"),
  "clarification.reopen": () => t("platform.auditLabels.clarificationReopen", "Reopened a question"),
  "clarification.delete": () => t("platform.auditLabels.clarificationDelete", "Deleted a question"),
  "decision.save": () => t("platform.auditLabels.decisionSave", "Saved a decision"),
  "decision.delete": () => t("platform.auditLabels.decisionDelete", "Deleted a decision"),
  "discussion.add": () => t("platform.auditLabels.discussionAdd", "Added to a discussion"),
  "discussion.delete": () => t("platform.auditLabels.discussionDelete", "Deleted a discussion entry"),
  "initialRequirements.save": () => t("platform.auditLabels.initialRequirementsSave", "Saved the first requirements"),
  "requirement.save": () => t("platform.auditLabels.requirementSave", "Saved a requirement"),
  "requirements.confirm": () => t("platform.auditLabels.requirementsConfirm", "Approved the requirements"),
  "designBrief.save": () => t("platform.auditLabels.designBriefSave", "Saved the design brief"),
  "designBrief.confirm": () => t("platform.auditLabels.designBriefConfirm", "Confirmed the design brief"),
  "extra.save": () => t("platform.auditLabels.extraSave", "Saved a project detail"),
  "extra.remove": () => t("platform.auditLabels.extraRemove", "Removed a project detail"),
  "scope.success.save": () => t("platform.auditLabels.scopeSuccessSave", "Saved the success targets"),
  "scope.lock": () => t("platform.auditLabels.scopeLock", "Locked the scope"),
  "scope.unlock": () => t("platform.auditLabels.scopeUnlock", "Unlocked the scope"),
  "build.start": () => t("platform.auditLabels.buildStart", "Started the build"),
  "build.retryAfterDeploy": () => t("platform.auditLabels.buildRetryAfterDeploy", "Asked to finish the steps after a deploy"),
  "job.cancel": () => t("platform.auditLabels.jobCancel", "Stopped work in progress"),
  "cr.startBuild": () => t("platform.auditLabels.crStartBuild", "Started building a change"),
  "cr.submit": () => t("platform.auditLabels.crSubmit", "Sent a change for analysis"),
  "cr.answer": () => t("platform.auditLabels.crAnswer", "Answered questions on a change"),
  "cr.decide": () => t("platform.auditLabels.crDecide", "Approved or rejected a change"),
  "cr.fixChecks": () => t("platform.auditLabels.crFixChecks", "Started a fix round or put development back after a change's checks failed"),
  "cr.checksPolicy": () => t("platform.auditLabels.crChecksPolicy", "Changed what happens when a change's checks fail"),
  "cr.markKnown": () => t("platform.auditLabels.crMarkKnown", "Marked a failing check of a change as known before the change (or took the mark back)"),
  "cr.parallelStreams": () => t("platform.auditLabels.crParallelStreams", "Changed how many change requests build side by side"),
  "cr.continueIncrements": () => t("platform.auditLabels.crContinueIncrements", "Turned on or off that the next increment starts by itself when the checks pass"),
  "feedback.comment.add": () => t("platform.auditLabels.feedbackCommentAdd", "Commented on feedback"),
  "sample.url": () => t("platform.auditLabels.sampleUrl", "Opened a shared preview"),
  // material, sharing and releases
  "doc.folder.create": () => t("platform.auditLabels.docFolderCreate", "Created a folder"),
  "doc.file.commit": () => t("platform.auditLabels.docFileCommit", "Added a file"),
  "doc.note.save": () => t("platform.auditLabels.docNoteSave", "Saved a note"),
  "shareLink.create": () => t("platform.auditLabels.shareLinkCreate", "Shared a link"),
  "shareLink.revoke": () => t("platform.auditLabels.shareLinkRevoke", "Stopped a shared link"),
  "approvalPolicy.save": () => t("platform.auditLabels.approvalPolicySave", "Changed the release approvals"),
  "approvalRequest.create": () => t("platform.auditLabels.approvalRequestCreate", "Asked for a release approval"),
  "approvalRequest.decide": () => t("platform.auditLabels.approvalRequestDecide", "Decided on a release approval"),
  "release.promote": () => t("platform.auditLabels.releasePromote", "Released a version"),
};

/** The action as a plain sentence; an action without a label is spelled out from its key ("wiki.page.save" →
 *  "Wiki page save"). */
export function auditActionLabel(action: string): string {
  const known = Object.prototype.hasOwnProperty.call(LABEL, action) ? LABEL[action] : undefined;
  if (known) return known();
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[.\-_\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return t("platform.auditLabels.otherChange", "Other change");
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
