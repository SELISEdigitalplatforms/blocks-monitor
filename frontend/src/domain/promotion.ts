/**
 * Release promotion approval rules (design 13.2): dev -> stage -> production.
 * Pure functions, no imports, so the Logic Functions can bundle the same code.
 */

/** Environments in promotion order. */
export const ENVIRONMENTS = ["dev", "stage", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export type GatedEnvironment = "stage" | "production";

/** The environment a release is promoted to next, or null after production. */
export function nextEnvironment(env: Environment): Environment | null {
  const i = ENVIRONMENTS.indexOf(env);
  return i >= 0 && i < ENVIRONMENTS.length - 1 ? ENVIRONMENTS[i + 1] : null;
}

/** Stage and production need approvals; dev stays automatic after the gates. */
export function needsApproval(env: Environment): env is GatedEnvironment {
  return env === "stage" || env === "production";
}

export type ApprovalStepType = "architect" | "security" | "qa" | "custom";

export interface ApprovalPolicyStep {
  type: ApprovalStepType;
  label?: string;
  required: boolean;
  approverUserIds: readonly string[];
}

export interface ApprovalPolicy {
  environment: GatedEnvironment;
  steps: readonly ApprovalPolicyStep[];
}

export type Decision = "pending" | "approved" | "rejected";

export interface ApprovalRequestStep {
  type: ApprovalStepType;
  label?: string;
  approverUserIds: readonly string[];
  decision: Decision;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface ApprovalRequest {
  environment: GatedEnvironment;
  version: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  steps: readonly ApprovalRequestStep[];
}

/** The default policy: architect + security required; QA optional on stage only. */
export function defaultApprovalPolicy(
  env: GatedEnvironment,
  opts?: {
    includeQa?: boolean;
    approvers?: Partial<Record<ApprovalStepType, readonly string[]>>;
  },
): ApprovalPolicy {
  const approvers = opts?.approvers ?? {};
  const step = (type: ApprovalStepType, required: boolean): ApprovalPolicyStep => ({
    type,
    required,
    approverUserIds: [...(approvers[type] ?? [])],
  });
  const steps: ApprovalPolicyStep[] = [step("architect", true), step("security", true)];
  if (opts?.includeQa) steps.push(step("qa", env === "production"));
  return { environment: env, steps };
}

/** Production forces every step required; stage forces architect and security required. Pure copy. */
export function normalizePolicy(p: ApprovalPolicy): ApprovalPolicy {
  return {
    environment: p.environment,
    steps: p.steps.map((s) => ({
      ...s,
      approverUserIds: [...s.approverUserIds],
      required:
        p.environment === "production" ||
        s.type === "architect" ||
        s.type === "security" ||
        s.required,
    })),
  };
}

/**
 * The owner minimum (C1): the approver roles the project's policy must require but does not.
 * Stage needs architect + security; production needs every approver (QA included).
 * Policies stay saveable at any time; only the promotion is gated on this.
 */
export function policyGaps(env: GatedEnvironment, policy: ApprovalPolicy): ApprovalStepType[] {
  const roles: ApprovalStepType[] = env === "production" ? ["architect", "security", "qa"] : ["architect", "security"];
  const required = new Set(normalizePolicy(policy).steps.filter((s) => s.required).map((s) => s.type));
  return roles.filter((r) => !required.has(r));
}

/** Checks a policy against the active workspace members. */
export function validatePolicy(
  p: ApprovalPolicy,
  activeMemberIds: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const n = normalizePolicy(p);
  if (n.environment === "stage") {
    for (const t of ["architect", "security"] as const) {
      if (!n.steps.some((s) => s.type === t)) {
        return { ok: false, reason: `Staging needs ${/^[aeiou]/i.test(t) ? "an" : "a"} ${t} approval step.` };
      }
    }
  }
  const members = new Set(activeMemberIds);
  const types = new Set<ApprovalStepType>();
  const labels = new Set<string>();
  for (const s of n.steps) {
    if (s.type === "custom") {
      const label = (s.label ?? "").trim();
      if (!label) return { ok: false, reason: "A custom approval step needs a label." };
      const key = label.toLowerCase();
      if (labels.has(key)) return { ok: false, reason: `Two custom steps share the label "${label}".` };
      labels.add(key);
    } else {
      if (types.has(s.type)) return { ok: false, reason: `The ${s.type} step appears more than once.` };
      types.add(s.type);
    }
    const name = s.type === "custom" ? (s.label ?? "custom").trim() : s.type;
    if (s.required && s.approverUserIds.length === 0) {
      return { ok: false, reason: `The ${name} step needs at least one approver.` };
    }
    for (const id of s.approverUserIds) {
      if (!members.has(id)) {
        return { ok: false, reason: `The ${name} approvers must be active workspace members.` };
      }
    }
  }
  return { ok: true };
}

/** Opens a pending approval request from a policy. */
export function requestFromPolicy(p: ApprovalPolicy, version: string): ApprovalRequest {
  return {
    environment: p.environment,
    version,
    status: "pending",
    steps: p.steps.map((s) => ({
      type: s.type,
      ...(s.label !== undefined ? { label: s.label } : {}),
      approverUserIds: [...s.approverUserIds],
      decision: "pending" as const,
      decidedBy: null,
      decidedAt: null,
      comment: null,
    })),
  };
}

/** True when the request is pending, the step is pending and the user is one of its approvers. */
export function canDecide(req: ApprovalRequest, stepIndex: number, userId: string): boolean {
  if (req.status !== "pending") return false;
  const step = req.steps[stepIndex];
  if (!step || step.decision !== "pending") return false;
  return step.approverUserIds.includes(userId);
}

/**
 * The people besides the requester who could decide a step: its approvers who are active members of the workspace.
 */
export function otherApprovers(
  step: Pick<ApprovalRequestStep, "approverUserIds">,
  requesterId: string | null | undefined,
  activeMemberIds: readonly string[],
): string[] {
  const active = new Set(activeMemberIds);
  return [...new Set(step.approverUserIds)].filter((id) => id !== requesterId && active.has(id));
}

/** Who may decide a step: `self` is true when the requester approves their own request (the only approver left). */
export type DecideRight =
  | { ok: true; self: boolean }
  | { ok: false; reason: "notPending" | "notApprover" | "ownRequest"; others: string[] };

/**
 * Four-eyes with a one-person fallback. An approver of the step decides it; the person who asked for the promotion
 * decides it only when no other active approver of that step exists in the workspace (then it is a self-approval,
 * recorded as such). While another approver exists, they must decide it.
 */
export function decideRight(
  req: ApprovalRequest,
  stepIndex: number,
  userId: string,
  o: { requesterId: string | null | undefined; activeMemberIds: readonly string[] },
): DecideRight {
  const step = req.steps[stepIndex];
  if (req.status !== "pending" || !step || step.decision !== "pending") return { ok: false, reason: "notPending", others: [] };
  const others = otherApprovers(step, o.requesterId, o.activeMemberIds);
  if (!step.approverUserIds.includes(userId) || !o.activeMemberIds.includes(userId)) return { ok: false, reason: "notApprover", others };
  if (!o.requesterId || userId !== o.requesterId) return { ok: true, self: false };
  return others.length === 0 ? { ok: true, self: true } : { ok: false, reason: "ownRequest", others };
}

/**
 * Whether a recorded decision counts. A decision by the requester counts only while no other active approver of that
 * step exists (the same rule as decideRight); otherwise the step still waits for someone else.
 */
export function decisionCounts(
  step: Pick<ApprovalRequestStep, "approverUserIds" | "decidedBy" | "decision">,
  requesterId: string | null | undefined,
  activeMemberIds: readonly string[],
): boolean {
  if (step.decision === "pending" || !requesterId || step.decidedBy !== requesterId) return true;
  return otherApprovers(step, requesterId, activeMemberIds).length === 0;
}

/** The request with every decision that does not count (decisionCounts) shown as pending again. */
export function countedRequest(
  req: ApprovalRequest,
  requesterId: string | null | undefined,
  activeMemberIds: readonly string[],
): ApprovalRequest {
  if (req.steps.every((s) => decisionCounts(s, requesterId, activeMemberIds))) return req;
  return {
    ...req,
    steps: req.steps.map((s) =>
      decisionCounts(s, requesterId, activeMemberIds) ? s : { ...s, decision: "pending" as const, decidedBy: null, decidedAt: null, comment: null },
    ),
  };
}

export type PromoteCheck =
  | { ok: true }
  | { ok: false; reason: string; missing: readonly ApprovalStepType[] };

/** Records one decision without mutating the input. */
export function decide(
  req: ApprovalRequest,
  input: {
    stepIndex: number;
    userId: string;
    decision: "approved" | "rejected";
    comment?: string;
    at: string;
  },
  policy: ApprovalPolicy,
): { ok: true; request: ApprovalRequest } | { ok: false; request: ApprovalRequest; reason: string } {
  if (!canDecide(req, input.stepIndex, input.userId)) {
    return { ok: false, request: req, reason: "You can't decide this step." };
  }
  const comment = (input.comment ?? "").trim();
  if (input.decision === "rejected" && !comment) {
    return { ok: false, request: req, reason: "Add a comment saying what has to change." };
  }
  const steps = req.steps.map((s, i) =>
    i === input.stepIndex
      ? {
          ...s,
          approverUserIds: [...s.approverUserIds],
          decision: input.decision,
          decidedBy: input.userId,
          decidedAt: input.at,
          comment: comment || null,
        }
      : { ...s, approverUserIds: [...s.approverUserIds] },
  );
  const next: ApprovalRequest = { ...req, steps };
  if (input.decision === "rejected") {
    return { ok: true, request: { ...next, status: "rejected" } };
  }
  return {
    ok: true,
    request: canPromote(policy, next).ok ? { ...next, status: "approved" } : next,
  };
}

/** Whether the request satisfies the CURRENT policy (normalized) for promotion. */
export function canPromote(
  policy: ApprovalPolicy,
  request: ApprovalRequest | null,
  version?: string,
): PromoteCheck {
  const n = normalizePolicy(policy);
  const required = n.steps.filter((s) => s.required);
  if (!request) {
    return {
      ok: false,
      reason: "Send it for approval first.",
      missing: required.map((s) => s.type),
    };
  }
  if (request.environment !== n.environment) {
    return { ok: false, reason: "This request is for a different environment.", missing: [] };
  }
  if (version !== undefined && request.version !== version) {
    return { ok: false, reason: "This request is for a different version.", missing: [] };
  }
  if (
    request.status === "rejected" ||
    request.status === "cancelled" ||
    request.steps.some((s) => s.decision === "rejected")
  ) {
    return { ok: false, reason: "Changes were asked for. Send it for approval again first.", missing: [] };
  }
  const missing = required
    .filter(
      (ps) =>
        !request.steps.some(
          (rs) =>
            rs.type === ps.type &&
            (ps.type !== "custom" || (rs.label ?? "") === (ps.label ?? "")) &&
            rs.decision === "approved",
        ),
    )
    .map((s) => s.type);
  if (missing.length > 0) {
    return { ok: false, reason: `Waiting for: ${missing.join(", ")}.`, missing };
  }
  return { ok: true };
}
