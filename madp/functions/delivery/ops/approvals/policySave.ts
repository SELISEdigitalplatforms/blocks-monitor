/**
 * approvalPolicy.save: insert-or-update the project's approval policy for stage or production.
 * The approvers are checked against the workspace's active members, loaded server-side.
 */
import { defineDeliveryOp, fail, failFromRule, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { approvalStepRow } from "../rows";
import { checkPolicyInput, stepKeyFor } from "../../../../src/domain/delivery";
import { normalizePolicy, validatePolicy } from "../../../../src/domain/promotion";

type Row = Record<string, unknown>;
type Args = Row & { projectId: string };

const readPolicy = (ports: ReadPorts, projectId: string, environment: unknown) =>
  Promise.all([
    ports.query("ApprovalPolicy", { ProjectId: projectId, Environment: environment as string }),
    ports.query("ApprovalStep", { ProjectId: projectId, ParentType: "policy" }),
  ]);

export const approvalPolicySaveOp = defineDeliveryOp({
  permission: "release.manage-approvals",
  overlap: true,
  validate: (raw: unknown) => strictArgs(raw, ["projectId", "environment", "steps"]) as Args,
  prefetch: (ports: ReadPorts, args: Args) =>
    args.environment === "stage" || args.environment === "production" ? readPolicy(ports, args.projectId, args.environment) : undefined,
  handler: async (ctx, args: Args) => {
    const environment = args.environment;
    if (environment !== "stage" && environment !== "production") {
      return fail("invalid_input", "delivery.approvals.invalidPolicy");
    }
    // Round 1 (prefetched by the router): the policy row and the project's policy steps.
    const reads = readPolicy(ctx.ports, ctx.projectId, environment) as Promise<[Row[], Row[]]>;
    reads.catch(() => undefined);
    await ctx.authorized();
    const checked = checkPolicyInput(environment, args.steps);
    if (!checked.ok) return failFromRule(checked);
    const policy = normalizePolicy(checked.value);
    // Approvers must be active members; the reason text never reaches the envelope.
    if (!validatePolicy(policy, ctx.activeMemberIds).ok) {
      return fail("invalid_input", "delivery.approvals.invalidPolicy");
    }
    const [found, policyStepRows] = await reads;
    // No upsert exists: the fixed request key collapses concurrent first saves onto one row.
    let policyId: string;
    let created = false;
    if (found.length > 0) {
      policyId = String([...found].sort((a, b) => (String(a.ItemId) < String(b.ItemId) ? -1 : 1))[0].ItemId);
    } else {
      const ins = await ctx.ports.insert(
        "ApprovalPolicy",
        ctx.stamp({ ProjectId: ctx.projectId, Environment: environment, Status: "active" }),
        { requestKey: `approvalPolicy:${ctx.projectId}:${environment}` },
      );
      policyId = ins.itemId;
      created = true;
    }

    // A concurrent first save may have made the row: its steps are not in the round-1 read, so insert is by key.
    const existing = policyStepRows.filter((row) => row.ParentId === policyId);
    const byKey = new Map<string, Row>();
    const stale: Row[] = [];
    for (const row of existing) {
      const key = String(row.StepKey);
      if (byKey.has(key)) stale.push(row);
      else byKey.set(key, row);
    }

    const wanted = new Set<string>();
    const writes: Array<() => Promise<unknown>> = [];
    for (let i = 0; i < policy.steps.length; i++) {
      const step = policy.steps[i];
      const key = stepKeyFor(i, step.type);
      wanted.add(key);
      const row = byKey.get(key);
      if (row) {
        writes.push(() =>
          ctx.ports.update(
            "ApprovalStep",
            String(row.ItemId),
            ctx.touch({
              StepType: step.type,
              Label: step.label ?? "",
              Required: step.required,
              ApproverUserIds: [...step.approverUserIds],
              SortOrder: i,
            }),
          ),
        );
      } else {
        writes.push(() =>
          ctx.ports.insert(
            "ApprovalStep",
            approvalStepRow(ctx, {
              parentType: "policy",
              parentId: policyId,
              index: i,
              step,
              required: step.required,
            }),
            { requestKey: ctx.requestKey(`step:${key}`) },
          ),
        );
      }
    }
    for (const [key, row] of byKey) {
      if (!wanted.has(key)) stale.push(row);
    }
    for (const row of stale) writes.push(() => ctx.ports.remove("ApprovalStep", String(row.ItemId)));
    // The parent's own touch only matters for an existing policy; a new row was just stamped.
    if (!created) writes.push(() => ctx.ports.update("ApprovalPolicy", policyId, ctx.touch({})));
    // The answer needs none of these results: they go to the router's bookkeeping round.
    await ctx.after(() => Promise.all(writes.map((w) => w())));

    await ctx.audit("approvalPolicy.save", "ApprovalPolicy", policyId, {
      environment,
      steps: policy.steps.length,
    });
    return { policyId, environment, steps: policy.steps.length };
  },
});
