// Decision log ops (design 12.2 step 2): decision.save, decision.delete.
import { parseDecisionInput, PROJECT_LIMITS } from "../../../../src/domain/sanitization";
import { countRows, fail, fromCheck, gate, insertNumbered, notFound, ok, projectRow, requirePermission, topNumber, versionCheck, withReads } from "./common";
import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";

type Reader = Pick<ReadEnv, "gateway" | "project">;

type Args = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function badRef(field: string): OpResult {
  return fail("invalid_input", "sanitization.badReference", { field });
}

/** The reads of decision.save, shared by the handler and its prefetch so the prefetched reads are the handler's own. */
function saveReads(env: Reader, args: Args) {
  const parsed = parseDecisionInput(args);
  if (!parsed.ok) return null;
  const input = parsed.value;
  const id = str(args.id);
  if (id) {
    return Promise.all([
      projectRow(env, "Decision", id),
      input.clarificationId ? projectRow(env, "Clarification", input.clarificationId) : Promise.resolve(null),
    ]).then(([row, clar]) => ({ id, row, clar }));
  }
  return Promise.all([
    input.clarificationId ? projectRow(env, "Clarification", input.clarificationId) : Promise.resolve(null),
    input.supersedesId ? projectRow(env, "Decision", input.supersedesId) : Promise.resolve(null),
    countRows(env, "Decision", PROJECT_LIMITS.decisions),
    topNumber(env, "Decision"),
  ]).then(([clar, target, count, top]) => ({ id, clar, target, count, top }));
}

async function save(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "reachable");
  if (blocked) return blocked;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const parsed = parseDecisionInput(args);
  if (!parsed.ok) return fromCheck(parsed);
  const input = parsed.value;
  const id = str(args.id);

  if (id) {
    if (input.supersedesId) {
      return fail("invalid_input", "sanitization.invalidField", { field: "supersedesId", rule: "format" });
    }
    const { row, clar } = (await saveReads(ctx, args)) as { row: Row | null; clar: Row | null };
    if (!row) return notFound("decision");
    if (row.Status === "superseded") return fail("conflict", "sanitization.decisionSuperseded");
    const values = {
      Title: input.title,
      Statement: input.statement,
      Rationale: input.rationale,
      ClarificationId: input.clarificationId,
    };
    const seen = versionCheck(row, args.expectedUpdatedAt, ctx.userId, { values });
    if (seen === "stale") return fail("conflict", "sanitization.stale");
    if (seen === "own") return ok({ decision: row, superseded: null });
    if (input.clarificationId && !clar) return badRef("clarificationId");
    const updated = await ctx.gateway.update("Decision", row.ItemId, values);
    ctx.audit({ action: "decision.save", targetType: "decision", targetId: String(row.ItemId), details: { created: false, number: row.Number, status: row.Status, fields: ["Title", "Statement", "Rationale", "ClarificationId"] } });
    return ok({ decision: updated, superseded: null });
  }

  const { clar, target, count, top } = (await saveReads(ctx, args)) as {
    clar: Row | null;
    target: Row | null;
    count: number;
    top: number | null;
  };
  if (input.clarificationId && !clar) return badRef("clarificationId");
  if (input.supersedesId && !target) return badRef("supersedesId");

  // A retry after a partial run: this request's own decision exists already. Looked up only where it matters.
  let mine: Row | null = null;
  const needsMine = count >= PROJECT_LIMITS.decisions || (target !== null && target.Status !== "accepted");
  if (needsMine) mine = await ctx.gateway.findMine("Decision", "decision");

  let decision: Row | null = mine;
  if (!decision) {
    if (target && target.Status !== "accepted") {
      return fail("invalid_input", "sanitization.supersedeTarget");
    }
    if (count >= PROJECT_LIMITS.decisions) {
      return fail("limit_reached", "sanitization.limit", { kind: "decisions", max: PROJECT_LIMITS.decisions });
    }
    const inserted = await insertNumbered(
      ctx,
      "Decision",
      {
        Title: input.title,
        Statement: input.statement,
        Rationale: input.rationale,
        ClarificationId: input.clarificationId,
        Status: "accepted",
        DecidedByUserId: ctx.userId,
        DecidedAt: ctx.now(),
        SupersededById: "",
      },
      "decision",
      { knownMax: top },
    );
    decision = inserted.row;
    ctx.audit({ action: "decision.save", targetType: "decision", targetId: String(decision.ItemId), details: { created: true, number: decision.Number, status: decision.Status, ...(target ? { supersedesId: target.ItemId } : {}) } });
  }
  let superseded: Row | null = null;
  if (target) {
    // The old row needs the new id, so it is flipped in the bookkeeping round (a failure marks the run failed and a
    // retry runs again). A retry after a partial run finds it already flipped.
    if (target.Status === "superseded" && target.SupersededById === decision.ItemId) {
      superseded = target;
    } else {
      const patch = { Status: "superseded", SupersededById: decision.ItemId };
      ctx.after(() => ctx.gateway.patch("Decision", target.ItemId, patch));
      superseded = { ...target, ...patch, UpdatedByUserId: ctx.userId, LastUpdatedDate: ctx.issuedStamp() };
    }
  }
  return ok({ decision, superseded });
}

/** The reads of decision.delete (shared with its prefetch). */
function delReads(env: Reader, args: Args) {
  const id = str(args.id);
  if (!id) return null;
  return Promise.all([
    projectRow(env, "Decision", id),
    env.gateway.list("Decision", { ProjectId: env.project.ItemId, SupersededById: id }),
    env.gateway.verify("Decision", id),
  ]).then(([row, older]) => [row, older] as [Row | null, Row[]]);
}

async function del(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "reachable");
  if (blocked) return blocked;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const id = str(args.id);
  if (!id) return fail("invalid_input", "sanitization.invalidField", { field: "id", rule: "required" });
  const [row, older] = (await delReads(ctx, args)) as [Row | null, Row[]];
  const restore = () =>
    Promise.all(older.map((o) => ctx.gateway.patch("Decision", o.ItemId, { Status: "accepted", SupersededById: "" })));
  const restoredId = older.length > 0 ? older[older.length - 1].ItemId : "";
  if (!row) {
    // A retry of a run that removed the row but stopped before the restore: finish the restore.
    if (older.length === 0) return notFound("decision");
    await restore();
    ctx.audit({ action: "decision.delete", targetType: "decision", targetId: id, details: { restoredId } });
    return ok({ id, restoredId });
  }
  if (row.Status === "superseded") return fail("conflict", "sanitization.decisionSuperseded");
  // One round: the removal starts first, so its existence check is still answered by the memo before the restore drops it.
  // A run that stops between them is finished by its retry, which finds either the row or the older decision.
  ctx.audit({ action: "decision.delete", targetType: "decision", targetId: id, details: { number: row.Number, restoredId } });
  await Promise.all([ctx.gateway.remove("Decision", id), restore()]);
  return ok({ id, restoredId });
}

export const DECISION_OPS: OpTable = {
  "decision.save": withReads(save, { prefetch: (env, args) => saveReads(env, args) }),
  "decision.delete": withReads(del, { prefetch: (env, args) => delReads(env, args) }),
};
