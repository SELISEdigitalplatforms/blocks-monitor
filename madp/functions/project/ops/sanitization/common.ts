/**
 * Shared helpers of the Product sanitization ops.
 *
 * Every handler follows this order: gate -> permission -> parse with
 * src/domain/sanitization -> one parallel batch of cross-reference reads ->
 * writes, children first and the state change last -> ok. Aim for at most 3
 * sequential gateway round trips. No module state: warm sandboxes are shared.
 */
import { can } from "../../../../src/domain/rbac";
import { insertWithNextNumber, NumberingConflictError } from "../../../../src/domain/numbering";
import { sanitizationPhase } from "../../../../src/domain/sanitization";
import { isFreshStamp, isOwnLandedWrite } from "../../../_lib/stamps";
import type { ErrorCode, Handler, OpContext, OpResult, ReadEnv, Row } from "./ports";

/** What the read helpers need: the same shape in a handler (OpContext) and in a prefetch (ReadEnv). */
type Reader = Pick<ReadEnv, "gateway" | "project">;

type Fail = Extract<OpResult, { ok: false }>;

/**
 * Thrown by insertNumbered when no number could be allocated. The router
 * (bind.ts, test memory host) turns it into the carried failure answer.
 */
export class OpFailure extends Error {
  readonly result: Fail;
  constructor(result: Fail) {
    super(result.error.messageKey);
    this.name = "OpFailure";
    this.result = result;
  }
}

export function ok<T>(data: T): OpResult<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, messageKey: string, params?: Record<string, unknown>): Fail {
  return params === undefined
    ? { ok: false, error: { code, messageKey } }
    : { ok: false, error: { code, messageKey, params } };
}

/** Turns a failed domain check ({ok:false, messageKey, params?}) into invalid_input. */
export function fromCheck(check: { messageKey: string; params?: Record<string, unknown> }): Fail {
  return fail("invalid_input", check.messageKey, check.params);
}

export function notFound(kind: string): Fail {
  return fail("not_found", "sanitization.notFound", { kind });
}

/**
 * Journey gate. 'reachable': the step must have been reached (any later phase
 * passes). 'current': additionally not completed (v1 is frozen afterwards).
 * 'complete': leaves completed and paused projects to the handler.
 */
export function gate(ctx: OpContext, need: "reachable" | "current" | "complete"): Fail | null {
  const phase = sanitizationPhase({
    stage: String(ctx.project.Stage ?? ""),
    resumeTo: typeof ctx.project.ResumeTo === "string" ? ctx.project.ResumeTo : undefined,
  });
  if (phase === "unavailable") return fail("invalid_input", "sanitization.unavailable");
  if (phase === "notOpen") return fail("invalid_input", "sanitization.notOpen");
  if (need === "current" && phase === "completed") return fail("invalid_input", "sanitization.v1Frozen");
  return null;
}

export function requirePermission(ctx: OpContext, permission: string): Fail | null {
  return can(ctx.permissions, permission as Parameters<typeof can>[1])
    ? null
    : fail("forbidden", "sanitization.forbidden");
}

/** A row of `schema` that belongs to THIS project; null for an empty id or a foreign row. */
export async function projectRow(ctx: Reader, schema: string, id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || id === "") return null;
  const row = await ctx.gateway.get(schema, id);
  return row && row.ProjectId === ctx.project.ItemId ? row : null;
}

export async function activeMemberIds(ctx: Reader): Promise<Set<string>> {
  const rows = await ctx.gateway.list("Membership", { Status: "active" }, { fields: ["UserId"], max: 1000 });
  const ids = new Set<string>();
  for (const r of rows) if (typeof r.UserId === "string" && r.UserId !== "") ids.add(r.UserId);
  return ids;
}

/** Rows of `schema` in this project, counted up to max + 1 (so "> max" means over the limit). */
export async function countRows(ctx: Reader, schema: string, max: number): Promise<number> {
  try {
    const rows = await ctx.gateway.list(schema, { ProjectId: ctx.project.ItemId }, { fields: ["ItemId"], max: max + 1 });
    return rows.length;
  } catch (e) {
    // A faithful gateway refuses a set bigger than max + 1 instead of cutting it: that still means "over the limit".
    if ((e as { code?: unknown } | null)?.code === "limit_reached") return max + 1;
    throw e;
  }
}

/** The highest Number in this project (null when there is none): one sorted single-row read. */
export async function topNumber(ctx: Reader, schema: string): Promise<number | null> {
  const top = await ctx.gateway.list(schema, { ProjectId: ctx.project.ItemId }, {
    fields: ["Number"],
    sort: [{ field: "Number", dir: "desc" }],
    first: 1,
  });
  const n = top[0]?.Number;
  return typeof n === "number" ? n : null;
}

/**
 * Inserts a row with the next per-project Number (max + 1 behind the unique
 * (ProjectId, Number) index; a clash re-reads the max). `onDuplicate` lets a
 * caller recognise "this request already wrote it": on a clash it runs first,
 * and a row it returns is the answer (existing:true); only null retries.
 */
export async function insertNumbered(
  ctx: OpContext,
  schema: string,
  fields: Record<string, unknown>,
  localKey: string,
  opts?: { onDuplicate?: () => Promise<Row | null>; knownMax?: number | null },
): Promise<{ row: Row; existing: boolean }> {
  const projectId = ctx.project.ItemId;
  // A caller that already read the top Number (null: none yet) spares the first attempt its own read; a clash re-reads.
  let known = opts?.knownMax;
  try {
    const res = await insertWithNextNumber<{ row: Row; existing: boolean }>({
      readMax: async () => {
        if (known !== undefined) {
          const n = known;
          known = undefined;
          return n;
        }
        return topNumber(ctx, schema);
      },
      insert: async (n) => {
        try {
          return await ctx.gateway.insert(schema, { ...fields, ProjectId: projectId, Number: n }, localKey);
        } catch (e) {
          if (opts?.onDuplicate && ctx.gateway.isDuplicateKey(e)) {
            const mine = await opts.onDuplicate();
            if (mine) return { row: mine, existing: true };
          }
          throw e;
        }
      },
      isDuplicateKey: (e) => ctx.gateway.isDuplicateKey(e),
    });
    return res.value;
  } catch (e) {
    if (e instanceof NumberingConflictError) throw new OpFailure(fail("conflict", "sanitization.stale"));
    throw e;
  }
}

/**
 * Best-effort compare-and-set (MF-B03): 'fresh' when expectedUpdatedAt is the stored LastUpdatedDate or the stamp this
 * caller's own earlier write issued (answers are built without a read-back, so the client holds that stamp). Otherwise
 * 'own' when the stored row is this caller's write that already holds the request's values (a timed-out save that landed
 * later: nothing to write, answer with the stored row), else 'stale'.
 */
export function versionCheck(
  row: Row,
  expectedUpdatedAt: unknown,
  userId: string,
  own?: { values?: Record<string, unknown>; requestKey?: string },
): "fresh" | "own" | "stale" {
  if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt !== "") {
    // A row without a stored stamp has nothing to compare with (the platform always stamps; a bare test store may not).
    if (typeof row.LastUpdatedDate !== "string") return "fresh";
    if (!isFreshStamp({ expected: expectedUpdatedAt, stored: row, callerUserId: userId })) {
      return own && isOwnLandedWrite({ stored: row, callerUserId: userId, expected: expectedUpdatedAt, ...own }) ? "own" : "stale";
    }
  }
  return "fresh";
}

export function staleCheck(row: Row, expectedUpdatedAt: unknown, userId = ""): Fail | null {
  return versionCheck(row, expectedUpdatedAt, userId) === "stale" ? fail("conflict", "sanitization.stale") : null;
}

/** An op table entry: the handler plus the reads it starts in the router's first round trip. */
export function withReads(
  handler: (args: Record<string, unknown>, ctx: OpContext) => Promise<OpResult>,
  extra: { prefetch?: Handler["prefetch"]; record?: Handler["record"] },
): Handler {
  return Object.assign(handler, extra);
}
