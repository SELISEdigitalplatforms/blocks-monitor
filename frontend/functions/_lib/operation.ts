import type { Caller } from "./caller";
import { OpError } from "./errors";
import { LIB_FIELDS } from "./fields";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import type { BoundIds } from "./ids";

/** Refusals that repeat for the same input, so a retry would only fail again. */
export const DETERMINISTIC_REFUSALS: readonly string[] = [
  "invalid_input",
  "forbidden",
  "not_member",
  "not_found",
  "conflict",
  "limit_reached",
  "approval_required",
];

/** Longest ResultJson stored for replays. */
export const MAX_RESULT_CHARS = 20_000;

const MAX_ATTEMPT = 10;

export interface OperationScope {
  workspaceId?: string | null;
  projectId?: string | null;
  attempt: number;
}

export interface OperationLog {
  /** Replays a finished run of the same caller and op; refuses a foreign requestId. */
  lookup(): Promise<{ replay: unknown } | null>;
  /** `via`: the gateway to write with (default: the request's; late bookkeeping writes outside the request's accounting). */
  recordDone(result: unknown, o: OperationScope, via?: RawGateway): Promise<void>;
  recordFailed(code: string, o: OperationScope): Promise<void>;
  /** The flush after the data writes failed: let a retry run the handler again. */
  markFailedAfterFlush(via?: RawGateway): Promise<void>;
}

function rowOf(res: unknown): Row | null {
  const list = Array.isArray(res) ? res : (res as { items?: unknown } | null)?.items;
  return Array.isArray(list) && list.length > 0 ? (list[0] as Row) : null;
}

function clampAttempt(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_ATTEMPT, Math.trunc(n))) : 0;
}

export function createOperationLog(o: {
  raw: RawGateway;
  fn: string;
  op: string;
  requestId: string;
  ids: BoundIds;
  caller: Caller;
}): OperationLog {
  const { raw, op, requestId, ids, caller } = o;
  let known: Row | null = null;
  let knownId: string | null = null;

  const idOf = (row: Row | null): string | null =>
    row && typeof row.ItemId === "string" && row.ItemId ? row.ItemId : null;

  async function save(patch: Record<string, string | number>, scope: OperationScope, gw: RawGateway = raw) {
    const itemId = knownId ?? idOf(known);
    if (itemId) {
      await gw.update("Operation", itemId, {
        ...patch,
        Attempt: clampAttempt(scope.attempt),
        UpdatedByUserId: caller.userId,
      });
      return;
    }
    const row: Record<string, unknown> = {
      RequestKey: ids.base,
      RequestId: requestId,
      Op: op,
      ActorUserId: caller.userId,
      ...patch,
      Attempt: clampAttempt(scope.attempt),
      CreatedByUserId: caller.userId,
      UpdatedByUserId: caller.userId,
    };
    if (scope.workspaceId) row.WorkspaceId = scope.workspaceId;
    if (scope.projectId) row.ProjectId = scope.projectId;
    // A duplicate means a concurrent twin finished first, which is fine.
    const res = await gw.insert("Operation", row);
    if (res.created) knownId = res.itemId;
  }

  return {
    async lookup() {
      known = rowOf(
        await raw.find("Operation", {
          where: f.eq("RequestId", requestId),
          fields: LIB_FIELDS.Operation,
          pageSize: 1,
        }),
      );
      if (!known) return null;
      if (known.ActorUserId !== caller.userId || known.Op !== op) throw new OpError("conflict");
      if (known.Status === "done" && typeof known.ResultJson === "string" && known.ResultJson) {
        try {
          return { replay: JSON.parse(known.ResultJson) as unknown };
        } catch {
          return null;
        }
      }
      return null;
    },

    async recordDone(result, scope, via) {
      let json = JSON.stringify(result ?? null);
      if (json.length > MAX_RESULT_CHARS) json = "";
      await save({ Status: "done", ResultJson: json, ErrorCode: "" }, scope, via);
    },

    async recordFailed(code, scope) {
      if (!DETERMINISTIC_REFUSALS.includes(code)) return;
      await save({ Status: "failed", ErrorCode: code }, scope);
    },

    async markFailedAfterFlush(via) {
      const gw = via ?? raw;
      if (!knownId && !idOf(known)) {
        known = rowOf(
          await gw.find("Operation", {
            where: f.eq("RequestId", requestId),
            fields: LIB_FIELDS.Operation,
            pageSize: 1,
          }),
        );
      }
      const itemId = knownId ?? idOf(known);
      if (!itemId) return;
      await gw.update("Operation", itemId, {
        Status: "failed",
        ErrorCode: "unavailable",
        UpdatedByUserId: caller.userId,
      });
    },
  };
}
