/**
 * approvalRequest.cancel: withdraws a pending request. The requester may cancel their own;
 * holders of release.manage-approvals may cancel any.
 */
import { defineDeliveryOp, fail, strictArgs } from "../common";
import type { ReadPorts } from "../ports";

type Row = Record<string, unknown>;
type Args = Row & { projectId: string };

const readCancel = (ports: ReadPorts, id: string) =>
  Promise.all([ports.getById("ApprovalRequest", id), ports.query("ApprovalStep", { ParentType: "request", ParentId: id })]);

export const approvalRequestCancelOp = defineDeliveryOp({
  permission: ["release.request", "release.manage-approvals"],
  validate: (raw: unknown) => strictArgs(raw, ["projectId", "approvalRequestId"]) as Args,
  prefetch: (ports: ReadPorts, args: Args) =>
    typeof args.approvalRequestId === "string" && args.approvalRequestId ? readCancel(ports, args.approvalRequestId) : undefined,
  handler: async (ctx, args: Args) => {
    const id = args.approvalRequestId;
    if (typeof id !== "string" || !id) return fail("invalid_input", "delivery.approvals.notFound");
    // Raw step rows, so a malformed step still lets its approvers hear about it; read with the request.
    const [requestRow, steps] = (await readCancel(ctx.ports, id)) as [Row | null, Row[]];
    const row = requestRow;
    if (!row || row.ProjectId !== ctx.projectId) {
      return fail("not_found", "delivery.approvals.notFound");
    }
    if (row.Status !== "pending") return fail("conflict", "delivery.approvals.notPending");

    const isRequester = row.RequestedByUserId === ctx.caller.userId && ctx.can("release.request");
    if (!ctx.can("release.manage-approvals") && !isRequester) {
      return fail("forbidden", "delivery.approvals.notRequester");
    }

    // The answer needs no result of the write: it runs in the router's bookkeeping round.
    await ctx.after(() => ctx.ports.update("ApprovalRequest", id, ctx.touch({ Status: "cancelled" })));

    const approvers = [
      ...new Set(
        steps.flatMap((s) => (Array.isArray(s.ApproverUserIds) ? (s.ApproverUserIds as string[]) : [])),
      ),
    ];
    await ctx.notify(
      approvers,
      "approval.cancelled",
      { version: String(row.Version) },
      row.Environment as "stage" | "production",
    );
    await ctx.audit("approvalRequest.cancel", "ApprovalRequest", id, {
      environment: String(row.Environment),
      version: String(row.Version),
    });
    return { approvalRequestId: id, status: "cancelled" };
  },
});
