// request.outcome: the stored outcome of a requestId (any function), so the web can resolve a timed-out save before it
// resends. A view: one find on the Operation row through the service gateway, writes nothing. Another user's request
// looks exactly like nothing stored.
import { OpError, defineOp, f, v, type OpCtx, type OpDeps } from "../../../_lib";
import { LIB_FIELDS } from "../../../_lib/fields";
import { REQUEST_ID_PATTERN } from "../../../../src/domain/fnContract";

type Outcome = { requestId: string; state: "done" | "failed" | "unknown"; op: string | null; data: unknown; errorCode: string | null };

export const requestOutcome = defineOp({
  op: "request.outcome",
  kind: "view",
  scope: "self",
  early: true,
  args: v.object({
    requestId: v.string({ pattern: REQUEST_ID_PATTERN, max: 64 }),
    op: v.optional(v.string({ max: 100 })),
  }),
  async handler(ctx: OpCtx, args, deps: OpDeps): Promise<Outcome> {
    const svc = deps.svc;
    if (!svc) throw new OpError("internal");
    const { requestId } = args;
    const unknown: Outcome = { requestId, state: "unknown", op: null, data: null, errorCode: null };
    const page = await svc.find("Operation", {
      where: f.eq("RequestId", requestId),
      fields: [...LIB_FIELDS.Operation],
      page: 1,
      pageSize: 1,
    });
    const row = page.items[0];
    if (!row || row.ActorUserId !== ctx.caller.userId) return unknown;
    if (args.op !== undefined && args.op !== row.Op) return unknown;
    const op = typeof row.Op === "string" ? row.Op : null;
    if (row.Status === "done") {
      let data: unknown = null;
      if (typeof row.ResultJson === "string" && row.ResultJson !== "") {
        try {
          data = JSON.parse(row.ResultJson);
        } catch {
          data = null;
        }
      }
      return { requestId, state: "done", op, data, errorCode: null };
    }
    if (row.Status === "failed") {
      return { requestId, state: "failed", op, data: null, errorCode: typeof row.ErrorCode === "string" ? row.ErrorCode : null };
    }
    return unknown;
  },
});
