import { defineDeliveryOp, fail, failFromRule, strictArgs, idArg, enumArg, intArg, stringArg } from "../common";
import type { ReadPorts } from "../ports";
import { countedStepRows, policyFromRows, requestsFromRows } from "../rows";
import { decide, decideRight } from "../../../../src/domain/promotion";
import type { ApprovalPolicy } from "../../../../src/domain/promotion";
import { checkComment, recomputeRequestStatus } from "../../../../src/domain/delivery";

/** Separation of duties: a step the requester decided counts only while no other active approver of it exists. */
const counted = <T extends Record<string, unknown>>(steps: readonly T[], requesterId: unknown, activeMemberIds: readonly string[]): T[] =>
  countedStepRows(steps, () => requesterId, activeMemberIds);

const readDecide = (ports: ReadPorts, projectId: string, requestId: string) =>
  Promise.all([
    ports.getById("ApprovalRequest", requestId),
    ports.query("ApprovalStep", { ParentType: "request", ParentId: requestId }),
    ports.query("ApprovalPolicy", { ProjectId: projectId }),
    ports.query("ApprovalStep", { ProjectId: projectId, ParentType: "policy" }),
  ]);

/** The columns requestsFromRows needs; an explicit list, so the re-read never shares a memo entry with round 1. */
const STEP_FIELDS = [
  "ItemId", "ParentType", "ParentId", "StepKey", "StepType", "Label", "Required", "ApproverUserIds",
  "SortOrder", "Decision", "DecidedByUserId", "DecidedAt", "Comment",
] as const;

/**
 * approvalRequest.decide: one approver records one decision on one step.
 * Only that step's ApprovalStep row is written, so two approvers deciding at
 * once never overwrite each other. The status is first computed from the
 * round-1 rows plus this decision; when an approval leaves it pending, the
 * steps and the stored status are read again after the write (one round,
 * beside the notify and audit calls), so the later of two concurrent approvals
 * sees both steps and settles the request (written in the bookkeeping round).
 */
export const approvalRequestDecideOp = defineDeliveryOp({
  permission: "release.approve",
  overlap: true,
  validate(raw) {
    const a = strictArgs(raw, ["projectId", "approvalRequestId", "stepIndex", "decision", "comment"]);
    const comment = a.comment === undefined ? undefined : stringArg(a.comment, "comment", 2000);
    return {
      projectId: idArg(a.projectId, "projectId"),
      approvalRequestId: idArg(a.approvalRequestId, "approvalRequestId"),
      stepIndex: intArg(a.stepIndex, "stepIndex", 0, 7),
      decision: enumArg(a.decision, "decision", ["approved", "rejected"] as const),
      comment,
    };
  },
  prefetch: (ports, args) => readDecide(ports, args.projectId, args.approvalRequestId),
  async handler(ctx, args) {
    const comment = (args.comment ?? "").trim();
    if (comment) {
      const c = checkComment(comment, 2000);
      if (!c.ok) return failFromRule(c);
    }
    const userId = ctx.caller.userId;
    // Round 1 (prefetched by the router): the request, its steps and the project's policies (the environment is not known yet).
    const [requestRow, requestSteps, policyRows, policyStepRows] = await readDecide(ctx.ports, ctx.projectId, args.approvalRequestId);
    await ctx.authorized(); // the membership check ran alongside the reads
    if (!requestRow || requestRow.ProjectId !== ctx.projectId || requestRow.WorkspaceId !== ctx.workspaceId) {
      return fail("not_found", "delivery.approvals.notFound");
    }
    const members = ctx.activeMemberIds;
    const r = requestsFromRows([requestRow], counted(requestSteps, requestRow.RequestedByUserId, members))[0];
    if (!r) return fail("conflict", requestSteps.length === 0 ? "delivery.approvals.preparing" : "delivery.approvals.unreadable");
    if (r.status !== "pending") return fail("conflict", "delivery.approvals.notPending");
    const step = r.request.steps[args.stepIndex];
    if (!step) return fail("invalid_input", "invalid_input", { field: "stepIndex" });
    if (step.decision !== "pending") return fail("conflict", "delivery.approvals.stepDecided");
    // Separation of duties with the one-person fallback (decideRight): the requester decides their own promotion only
    // when no other active approver of this step exists in the workspace; that decision is a recorded self-approval.
    const right = decideRight(r.request, args.stepIndex, userId, { requesterId: r.requestedByUserId, activeMemberIds: members });
    if (!right.ok) {
      return right.reason === "ownRequest"
        ? fail("forbidden", "delivery.approvals.ownRequest", { approvers: right.others.length })
        : fail("forbidden", "delivery.approvals.notApprover");
    }
    const selfApproval = right.self;

    // The saved policy decides what "approved" means. When it is gone,
    // unreadable or has lost its step rows we fall back to the request's own steps with the required
    // flags kept on the step rows, never an empty policy (an empty policy
    // would approve the request on the first decision).
    const loaded = policyFromRows(r.environment, policyRows, policyStepRows);
    const policy: ApprovalPolicy =
      loaded.status === "ok" && loaded.policy.steps.length > 0
        ? loaded.policy
        : {
            environment: r.environment,
            steps: r.request.steps.map((s, i) => ({
              type: s.type,
              ...(s.label !== undefined ? { label: s.label } : {}),
              required: r.meta[i]?.required ?? true,
              approverUserIds: [...s.approverUserIds],
            })),
          };

    const res = decide(
      r.request,
      { stepIndex: args.stepIndex, userId, decision: args.decision, comment: args.comment, at: ctx.now },
      policy,
    );
    if (!res.ok) {
      if (args.decision === "rejected" && !comment) {
        return fail("invalid_input", "delivery.approvals.commentRequired");
      }
      return fail("forbidden", "delivery.approvals.notApprover");
    }

    // Best effort (MF-B03): the gateway has no compare-and-set. The step row was read in round 1 and its
    // Decision is part of `step` above. One write round updates the step and, in the same round, the status
    // computed from that view. An approval that leaves it pending is re-read below (concurrent deciders).
    const stepItemId = r.meta[args.stepIndex].itemId;
    const applied = requestsFromRows(
      [requestRow],
      counted(
        requestSteps.map((row) =>
          row.ItemId === stepItemId ? { ...row, Decision: args.decision, DecidedByUserId: userId, DecidedAt: ctx.now, Comment: comment } : row,
        ),
        requestRow.RequestedByUserId,
        members,
      ),
    )[0];
    let status = applied ? recomputeRequestStatus(applied.request, policy) : r.status;
    await Promise.all([
      ctx.ports.update(
        "ApprovalStep",
        stepItemId,
        ctx.touch({ Decision: args.decision, DecidedByUserId: userId, DecidedAt: ctx.now, Comment: comment }),
      ),
      status !== r.status ? ctx.ports.update("ApprovalRequest", r.id, ctx.touch({ Status: status })) : Promise.resolve(),
    ]);

    const reread =
      status === "pending" && args.decision === "approved"
        ? Promise.all([
            ctx.ports.query("ApprovalStep", { ParentType: "request", ParentId: r.id }, { fields: STEP_FIELDS }),
            ctx.ports.query("ApprovalRequest", { ItemId: r.id }, { fields: ["ItemId", "Status"], limit: 1 }),
          ])
        : null;
    const [fresh] = await Promise.all([
      reread,
      // a self-approval tells nobody else (the requester is the one deciding)
      selfApproval
        ? Promise.resolve()
        : ctx.notify(
            [r.requestedByUserId],
            "approval.decided",
            { version: r.version, stepType: step.type, decision: args.decision },
            r.environment,
          ),
      ctx.audit("approvalRequest.decide", "ApprovalRequest", r.id, {
        environment: r.environment,
        version: r.version,
        stepIndex: args.stepIndex,
        stepType: step.type,
        decision: args.decision,
        selfApproval,
        ...(selfApproval ? { reason: "only approver" } : {}),
      }),
    ]);
    if (fresh) {
      const [freshSteps, storedRows] = fresh;
      const again = requestsFromRows([requestRow], counted(freshSteps, requestRow.RequestedByUserId, members))[0];
      const settled = again ? recomputeRequestStatus(again.request, policy) : status;
      if (settled !== status && storedRows[0]?.Status === "pending") {
        status = settled;
        await ctx.after(() => ctx.ports.update("ApprovalRequest", r.id, ctx.touch({ Status: settled })));
      }
    }
    return { approvalRequestId: r.id, status, stepIndex: args.stepIndex, decision: args.decision, selfApproval };
  },
});
