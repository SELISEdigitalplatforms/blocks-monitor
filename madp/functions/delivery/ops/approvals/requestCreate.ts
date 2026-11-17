/**
 * approvalRequest.create: opens one pending approval request for a version.
 * The requester always comes from the caller context.
 */
import { defineDeliveryOp, fail, failFromRule, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { approvalStepRow, loadPolicyRows, loadReleaseStates, policyFromRows, readPolicyRows, readReleases } from "../rows";
import { checkPromotionVersion, checkVersion } from "../../../../src/domain/delivery";
import {
  normalizePolicy,
  requestFromPolicy,
  validatePolicy,
} from "../../../../src/domain/promotion";

type Row = Record<string, unknown>;
type Args = Row & { projectId: string };

const readRequests = (ports: ReadPorts, projectId: string, environment: string) =>
  ports.query("ApprovalRequest", { ProjectId: projectId, Environment: environment });

export const approvalRequestCreateOp = defineDeliveryOp({
  permission: "release.request",
  overlap: true,
  validate: (raw: unknown) => strictArgs(raw, ["projectId", "environment", "version"]) as Args,
  prefetch: (ports: ReadPorts, args: Args) =>
    args.environment === "stage" || args.environment === "production"
      ? Promise.all([readPolicyRows(ports, args.projectId), readReleases(ports, args.projectId), readRequests(ports, args.projectId, args.environment)])
      : undefined,
  handler: async (ctx, args: Args) => {
    const environment = args.environment;
    if (environment !== "stage" && environment !== "production") {
      return fail("invalid_input", "delivery.approvals.invalidEnvironment");
    }
    if (typeof args.version !== "string") {
      return fail("invalid_input", "delivery.release.invalidVersion");
    }
    const v = checkVersion(args.version);
    if (!v.ok) return failFromRule(v);
    const version = v.value;

    // Round 1 (prefetched by the router): the policy, the releases and the environment's requests.
    const [policyData, released, requestRows] = await Promise.all([
      loadPolicyRows(ctx),
      loadReleaseStates(ctx),
      readRequests(ctx.ports, ctx.projectId, environment),
    ]);
    await ctx.authorized();
    const policy = policyFromRows(environment, policyData.policyRows, policyData.policyStepRows);
    // Approvers may have left since the policy was saved.
    if (policy.status !== "ok") return fail("invalid_input", "delivery.approvals.noPolicy");
    const normalized = normalizePolicy(policy.policy);
    if (!validatePolicy(normalized, ctx.activeMemberIds).ok) {
      return fail("invalid_input", "delivery.approvals.noPolicy");
    }

    const source = checkPromotionVersion(released.states, environment, version);
    if (!source.ok) return failFromRule(source);

    const raw = requestRows as Row[];
    if (raw.some((r) => r.Environment === environment && r.Status === "pending")) {
      return fail("conflict", "delivery.approvals.pending");
    }
    const attempt =
      1 + raw.filter((r) => r.Environment === environment && r.Version === version).length;

    // DEVIATION from the brief: the steps cannot be written first, because the gateway assigns
    // ItemIds (F0 rejects client ItemIds) and the parent id exists only after this insert.
    // A pending request without steps can never pass canPromote; the web shows it as being prepared.
    // The RequestKey names the next free slot of the environment (the requests read above). Two creators that
    // saw the same slot get the SAME row back (existing), so a race never leaves two pending requests and
    // needs no read-back round; a creator whose slot row is not its own request is told it is pending.
    const inserted = await ctx.ports.insert(
      "ApprovalRequest",
      ctx.stamp({
        ProjectId: ctx.projectId,
        Environment: environment,
        Version: version,
        Status: "pending",
        PolicyId: String(policy.row.ItemId),
        Attempt: attempt,
        RequestedByUserId: ctx.caller.userId,
      }),
      { requestKey: `approvalRequest:${ctx.projectId}:${environment}:slot${raw.length}` },
    );
    const id = inserted.itemId;
    if (inserted.existing) {
      const mine = (await ctx.ports.getById("ApprovalRequest", id)) as Row | null;
      if (!mine || mine.RequestedByUserId !== ctx.caller.userId || mine.Version !== version) {
        return fail("conflict", "delivery.approvals.pending");
      }
    }

    // The steps are keyed by the request id and the answer needs none of their results: they run in the router's
    // bookkeeping round, together with the audit, the notifications and the Operation record.
    const opened = requestFromPolicy(normalized, version);
    await ctx.after(() =>
      Promise.all(
        opened.steps.map((step, i) =>
          ctx.ports.insert(
            "ApprovalStep",
            approvalStepRow(ctx, {
              parentType: "request",
              parentId: id,
              index: i,
              step: { ...step, required: normalized.steps[i].required },
              required: normalized.steps[i].required,
            }),
            { requestKey: `approvalRequest:${id}:step:${i}` },
          ),
        ),
      ),
    );

    const approvers = [...new Set(opened.steps.flatMap((s) => [...s.approverUserIds]))];
    await ctx.notify(approvers, "approval.requested", { version }, environment);
    await ctx.audit("approvalRequest.create", "ApprovalRequest", id, {
      environment,
      version,
      attempt,
    });
    return { approvalRequestId: id, attempt };
  },
});
