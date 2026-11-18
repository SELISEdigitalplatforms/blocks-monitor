/** Pure helpers for the approvals UI (policy editor, request panel, promote action). */
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import type { PolicyRecord, RequestRecord } from "@/madp/blocks/delivery/types";
import {
  defaultApprovalPolicy,
  normalizePolicy,
  policyGaps,
  validatePolicy,
  type ApprovalPolicy,
  type ApprovalPolicyStep,
  type ApprovalStepType,
  type Decision,
  type GatedEnvironment,
} from "@/madp/domain/promotion";
import { checkPolicyInput, LIMITS } from "@/madp/domain/delivery";
import { t } from "@/madp/i18n";

/** English names of the gated environments (the source texts; screens read envLabel / envInSentence). */
export const ENV_LABEL: Record<GatedEnvironment, string> = { stage: "Staging", production: "Production" };

/** The environment's name in the current language ("Staging"). */
export function envLabel(env: GatedEnvironment): string {
  return env === "production" ? t("platform.approvals.env.production", "Production") : t("platform.approvals.env.stage", "Staging");
}

/** The environment's name inside a sentence ("to staging"); German keeps the noun capitalized. */
export function envInSentence(env: GatedEnvironment): string {
  return env === "production" ? t("platform.approvals.envInSentence.production", "production") : t("platform.approvals.envInSentence.stage", "staging");
}

/** Why a promotion is refused for want of a complete approval policy, or null when the policy is complete (C1).
 *  Only the structure is checked: the policy's own approver ids are passed as the known members. */
export function policyGap(environment: GatedEnvironment, policy: PolicyRecord | null): string | null {
  const env = envInSentence(environment);
  if (!policy) {
    return t("platform.approvals.gap.noPolicy", "Set up who approves a release to {env} first.", { env });
  }
  const approverIds = policy.policy.steps.flatMap((s) => s.approverUserIds);
  const v = validatePolicy(policy.policy, approverIds);
  if (!v.ok) return t("platform.approvals.gap.incomplete", "Who approves a release to {env} is not complete: {reason}", { env, reason: v.reason });
  // release.promote refuses a policy without these required steps (the owner minimum): the page says so up front
  const missing = policyGaps(environment, policy.policy).map((type) => stepTypeName(type));
  if (missing.length === 0) return null;
  const steps = missing.join(t("platform.approvals.and", " and "));
  return missing.length > 1
    ? t("platform.approvals.gap.missingSteps", "A release to {env} needs a required {steps} approval steps.", { env, steps })
    : t("platform.approvals.gap.missingStep", "A release to {env} needs a required {steps} approval step.", { env, steps });
}

/** The short name of a required step type inside a sentence ("QA", "architect", "security"). */
function stepTypeName(type: string): string {
  if (type === "qa") return t("platform.approvals.stepType.qa", "QA");
  if (type === "architect") return t("platform.approvals.stepType.architect", "architect");
  if (type === "security") return t("platform.approvals.stepType.security", "security");
  return type;
}

/** A step's decision in the current language. */
export function decisionLabel(d: Decision): string {
  if (d === "approved") return t("platform.approvals.decision.approved", "Approved");
  if (d === "rejected") return t("platform.approvals.decision.rejected", "Changes asked");
  return t("platform.approvals.decision.pending", "Waiting");
}

/** Why a step's Required switch cannot be turned off, or null when it is free. */
export function forcedRequiredReason(env: GatedEnvironment, type: ApprovalStepType): string | null {
  if (env === "production") return t("platform.approvals.forced.production", "Every step is required for production.");
  if (type === "architect" || type === "security") {
    return t("platform.approvals.forced.stage", "Architect and security approvals are always required for staging.");
  }
  return null;
}

/** The saved policy, or the suggested one. Its approver lists are empty, unless the workspace has exactly one active
 *  member: nobody else can approve, so that person is already ticked in every step (still only a suggestion until saved). */
export function editorDraftFrom(record: PolicyRecord | null, env: GatedEnvironment, activeMemberIds: readonly string[] = []): ApprovalPolicy {
  if (record) return record.policy;
  const only = activeMemberIds.length === 1 ? [activeMemberIds[0]] : [];
  // QA is offered on both: optional for staging, required for production (a production release needs it)
  return defaultApprovalPolicy(env, { includeQa: true, approvers: { architect: only, security: only, qa: only } });
}

/** The first suggested step nobody approves yet although it is required, or null (to point at it next to Save). */
export function stepMissingApprovers(env: GatedEnvironment, steps: readonly ApprovalPolicyStep[]): number | null {
  const i = normalizePolicy({ environment: env, steps: steps.map((s) => ({ ...s })) }).steps.findIndex((s) => s.required && s.approverUserIds.length === 0);
  return i < 0 ? null : i;
}

/** A stable fingerprint of a policy's steps, to tell when the stored steps changed. */
export function policyStepsSignature(steps: readonly ApprovalPolicyStep[]): string {
  return JSON.stringify(steps.map((s) => [s.type, s.label ?? "", s.required, s.approverUserIds]));
}

/** Whether the editor's local draft is dropped for the stored steps: only after a save, once the stored steps changed.
 *  Unsaved edits are never overwritten by a refetch. */
export function draftSupersededBySaved(hasDraft: boolean, sigAtSave: string | null, sig: string): boolean {
  return hasDraft && sigAtSave !== null && sig !== sigAtSave;
}

/** checkPolicyInput accepts either a reason string/null or an { ok, reason } result; read both. */
function inputProblem(env: GatedEnvironment, draft: ApprovalPolicy): string | null {
  const r = checkPolicyInput(env, draft.steps as never) as unknown;
  if (r === null || r === undefined || r === true) return null;
  if (typeof r === "string") return r;
  const o = r as { ok?: boolean; reason?: string; messageKey?: string };
  if (o.ok === false) return o.reason ?? o.messageKey ?? t("platform.approvals.policyInvalid", "The policy is not valid.");
  return null;
}

/** The first problem with a draft (limits, then the domain rules), or null. */
export function draftProblem(
  draft: ApprovalPolicy,
  env: GatedEnvironment,
  activeMemberIds: readonly string[],
): string | null {
  const input = inputProblem(env, draft);
  if (input) return input;
  const v = validatePolicy(normalizePolicy({ ...draft, environment: env }), activeMemberIds);
  return v.ok ? null : v.reason;
}

export function canSubmitRejection(comment: string): boolean {
  const t = comment.trim();
  return t.length >= 1 && t.length <= LIMITS.approvalComment;
}

/** Cancel: a pending request, by a manager or by its requester holding release.request. */
export function canCancel(ctx: DeliveryContext, request: RequestRecord): boolean {
  if (request.status !== "pending") return false;
  if (ctx.can("release.manage-approvals")) return true;
  return !!ctx.userId && request.requestedByUserId === ctx.userId && ctx.can("release.request");
}
