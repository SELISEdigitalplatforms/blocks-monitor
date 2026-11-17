/**
 * The mf-delivery registry: op name -> permission, argument validator, handler.
 * functions/_lib (L2) is not on this base, so there is no bind.ts here. The coordinator binds
 * DeliveryPorts and wraps every entry with _lib's defineOp after L2/L2b land; the hosted router is
 * HOST A (POST /api/fn/delivery) or HOST B (Logic Function). Entries carry NO `op` field.
 */
import { type DeliveryOpName, type OpDef, runOp } from "./common";
import type { DeliveryPorts, OpAnswer } from "./ports";
import { approvalPolicySaveOp } from "./approvals/policySave";
import { approvalRequestCancelOp } from "./approvals/requestCancel";
import { approvalRequestCreateOp } from "./approvals/requestCreate";
import { approvalRequestDecideOp } from "./approvals/requestDecide";
import { buildStartOp } from "./build/buildStart";
import { buildRetryAfterDeployOp } from "./build/retryAfterDeploy";
import { milestoneAcceptOp } from "./build/milestoneAccept";
import { milestoneFeedbackOp } from "./build/milestoneFeedback";
import { crSaveDraftOp } from "./changes/crSaveDraft";
import { crStartBuildOp } from "./changes/crStartBuild";
import { crSubmitOp } from "./changes/crSubmit";
import { crAnswerOp } from "./changes/crAnswer";
import { crDecideOp } from "./changes/crDecide";
import { crChecksPolicyOp, crFixChecksOp, crMarkKnownOp } from "./changes/crFixChecks";
import { crContinueIncrementsOp, crParallelStreamsOp } from "./changes/crStreams";
import { ticketCommentOp } from "./board/ticketComment";
import { ticketMoveOp } from "./board/ticketMove";
import { releasePromoteOp } from "./releases/releasePromote";

export const deliveryOps = {
  "ticket.comment": ticketCommentOp,
  "ticket.move": ticketMoveOp,
  "build.start": buildStartOp,
  "build.retryAfterDeploy": buildRetryAfterDeployOp,
  "cr.saveDraft": crSaveDraftOp,
  "cr.startBuild": crStartBuildOp,
  "cr.submit": crSubmitOp,
  "cr.answer": crAnswerOp,
  "cr.decide": crDecideOp,
  "cr.fixChecks": crFixChecksOp,
  "cr.checksPolicy": crChecksPolicyOp,
  "cr.markKnown": crMarkKnownOp,
  "cr.parallelStreams": crParallelStreamsOp,
  "cr.continueIncrements": crContinueIncrementsOp,
  "approvalPolicy.save": approvalPolicySaveOp,
  "approvalRequest.create": approvalRequestCreateOp,
  "approvalRequest.decide": approvalRequestDecideOp,
  "approvalRequest.cancel": approvalRequestCancelOp,
  "release.promote": releasePromoteOp,
  "milestone.accept": milestoneAcceptOp,
  "milestone.feedback": milestoneFeedbackOp,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<DeliveryOpName, OpDef<any>>;

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Runs one envelope { op, requestId, args } against the registry. */
export function invokeDeliveryOp(ports: DeliveryPorts, envelope: unknown): Promise<OpAnswer> {
  const bad = (): Promise<OpAnswer> =>
    Promise.resolve({
      ok: false,
      error: { code: "invalid_input", messageKey: "delivery.op.invalid", params: {} },
      serverNow: ports.now(),
    });
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) return bad();
  const { op, requestId, args } = envelope as Record<string, unknown>;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(deliveryOps, op)) return bad();
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return bad();
  const def = deliveryOps[op as DeliveryOpName] as OpDef<{ projectId: string }>;
  return runOp(ports, { op: op as DeliveryOpName, requestId }, def, args);
}
