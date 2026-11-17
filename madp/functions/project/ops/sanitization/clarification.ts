// clarification.* ops of Product sanitization (design 12.2 step 2).
// Order in every handler: gate -> permission -> parse -> one parallel read batch -> writes.
import {
  canAnswerClarification,
  clarificationTransition,
  parseAnswer,
  parseClarificationInput,
  parseDeferReason,
  PROJECT_LIMITS,
} from "../../../../src/domain/sanitization";
import { fail, gate, notFound, ok, projectRow, requirePermission, activeMemberIds, countRows, insertNumbered, topNumber, versionCheck, withReads } from "./common";
import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";
import { draftWhenAnswered } from "./autoDraft";
import { DRAFT_CHECK_FIELDS, MAX_TALK_ATTACHMENTS, claimDrafts } from "../../../../src/domain/attachments";

type Reader = Pick<ReadEnv, "gateway" | "project">;

type Args = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// The domain parsers answer either a value or {ok:false, messageKey}.
function parsed<T>(r: unknown): { value: T } | { error: OpResult } {
  const x = r as { ok?: boolean; value?: T; messageKey?: string; params?: Record<string, unknown> } | null;
  if (x && x.ok === false) {
    return { error: fail("invalid_input", x.messageKey ?? "sanitization.invalid", x.params) };
  }
  if (x && x.ok === true && "value" in x) return { value: x.value as T };
  return { value: r as T };
}

/** 'own': this caller's earlier save already holds `values` (nothing to write, answer with the stored row). */
function seenOf(row: Row, args: Args, ctx: OpContext, values: Record<string, unknown>): "fresh" | "own" | "stale" {
  return versionCheck(row, str(args.expectedUpdatedAt), ctx.userId, { values });
}

const staleResult = (): OpResult => fail("conflict", "sanitization.stale");

async function loadRow(ctx: Reader, args: Args): Promise<Row | null> {
  const id = str(args.id);
  if (!id) return null;
  return (await projectRow(ctx, "Clarification", id)) as Row | null;
}

/** The reads of clarification.save (shared with its prefetch). */
function saveReads(env: Reader, input: { ownerUserId: string; sourceType: string; sourceRef: string }, id: string) {
  return Promise.all([
    id ? projectRow(env, "Clarification", id) : Promise.resolve(null),
    id ? Promise.resolve(0) : countRows(env, "Clarification", PROJECT_LIMITS.clarifications),
    input.ownerUserId ? activeMemberIds(env) : Promise.resolve(null),
    input.sourceRef
      ? projectRow(env, input.sourceType === "doc-file" ? "DocFile" : "DocNote", input.sourceRef)
      : Promise.resolve(null),
    id ? Promise.resolve(null) : topNumber(env, "Clarification"),
  ]);
}

function savePrefetch(env: Reader, args: Args) {
  const p = parsed<{ ownerUserId: string; sourceType: string; sourceRef: string }>(parseClarificationInput(args));
  return "error" in p ? null : saveReads(env, p.value, str(args.id));
}

async function save(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const p = parsed<{ question: string; ownerUserId: string; sourceType: string; sourceRef: string }>(
    parseClarificationInput(args),
  );
  if ("error" in p) return p.error;
  const input = p.value;
  const id = str(args.id);

  const [existing, count, members, source, top] = await saveReads(ctx, input, id);

  if (id && !existing) return notFound("clarification");
  if (!id && (count as number) >= PROJECT_LIMITS.clarifications) {
    return fail("limit_reached", "sanitization.limit", { kind: "clarifications", max: PROJECT_LIMITS.clarifications });
  }
  if (input.ownerUserId && !new Set(Array.from(members as Iterable<string>)).has(input.ownerUserId)) {
    return fail("invalid_input", "sanitization.notMember", { field: "ownerUserId" });
  }
  if (input.sourceRef) {
    const src = source as Row | null;
    const gone = !src || (input.sourceType === "doc-file" && (src.Status === "deleted" || src.Status === "rejected"));
    if (gone) return fail("invalid_input", "sanitization.badReference", { field: "sourceId" });
  }

  const fields = {
    Question: input.question,
    OwnerUserId: input.ownerUserId,
    SourceType: input.sourceType,
    SourceRef: input.sourceRef,
  };
  if (existing) {
    const seen = seenOf(existing as Row, args, ctx, fields);
    if (seen === "stale") return staleResult();
    if (seen === "own") return ok({ clarification: existing });
    // the engine's one-click answers were written for the old wording: a reworded question goes without them
    const prev = existing as Row;
    const reworded = str(prev.Question) !== input.question && Array.isArray(prev.Options) && prev.Options.length > 0;
    const row = await ctx.gateway.update("Clarification", str(args.id), reworded ? { ...fields, Options: [] } : fields);
    ctx.audit({ action: "clarification.save", targetType: "clarification", targetId: String(row.ItemId ?? args.id), details: { created: false, number: row.Number, status: row.Status, fields: Object.keys(fields) } });
    return ok({ clarification: row });
  }
  const { row } = await insertNumbered(ctx, "Clarification", { ...fields, Status: "open" }, "clarification", {
    knownMax: top as number | null,
  });
  ctx.audit({ action: "clarification.save", targetType: "clarification", targetId: String(row.ItemId), details: { created: true, number: row.Number, status: row.Status } });
  return ok({ clarification: row });
}

/** The attachment ids an answer names (args.attachmentIds), unique; null when the list is not a list of ids. */
function answerFileIds(args: Args): string[] | null {
  if (args.attachmentIds === undefined || args.attachmentIds === null) return [];
  if (!Array.isArray(args.attachmentIds) || args.attachmentIds.some((x) => typeof x !== "string" || x === "")) return null;
  return [...new Set(args.attachmentIds as string[])];
}

/** The Attachment rows of an answer's files (shared with the prefetch, so the handler's read costs no round trip). */
function answerFileRows(env: Reader, args: Args): Promise<Row[]> {
  const ids = answerFileIds(args);
  if (!ids || ids.length === 0 || ids.length > MAX_TALK_ATTACHMENTS) return Promise.resolve([]);
  return env.gateway.list("Attachment", { ProjectId: str(env.project.ItemId), ItemId: { in: ids } }, { fields: DRAFT_CHECK_FIELDS });
}

/** The files of an answer (args.attachmentIds + args.draftKey, from the answer box's uploads; src/domain/attachments.ts). */
function answerFiles(
  ctx: OpContext,
  args: Args,
  clarificationId: string,
  rows: readonly Row[],
): { error: OpResult } | { attach: () => Promise<void>; count: number; ids: string[] } {
  const ids = answerFileIds(args);
  if (!ids) return { error: fail("invalid_input", "sanitization.invalidField", { field: "attachmentIds", rule: "format" }) };
  if (ids.length > MAX_TALK_ATTACHMENTS) return { error: fail("invalid_input", "sanitization.invalidField", { field: "attachmentIds", rule: "tooMany", max: MAX_TALK_ATTACHMENTS }) };
  if (ids.length === 0) return { attach: async () => undefined, count: 0, ids: [] };
  const projectId = str(ctx.project.ItemId);
  const claim = claimDrafts(rows, { ids, ownerType: "clarification", draftKey: str(args.draftKey), userId: ctx.userId, projectId, ownerId: clarificationId });
  if (!claim.ok) return { error: fail("invalid_input", "sanitization.attachmentNotReady") };
  return {
    attach: async () => {
      await Promise.all(claim.move.map((id) => ctx.gateway.patch("Attachment", id, { OwnerId: clarificationId })));
    },
    count: ids.length,
    ids,
  };
}

async function answer(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const [row, fileRows] = await Promise.all([loadRow(ctx, args), answerFileRows(ctx, args)]);
  if (!row) return notFound("clarification");
  if (!canAnswerClarification({ userId: ctx.userId, permissions: ctx.permissions }, { ownerUserId: str(row.OwnerUserId) })) {
    return fail("forbidden", "sanitization.cantAnswer");
  }
  const p = parsed<string>(parseAnswer(args.answer));
  if ("error" in p) return p.error;
  // Files sent with the answer: the caller's own ready drafts of this answer box (or, on a retry, already this question's).
  const files = answerFiles(ctx, args, str(args.id), fileRows);
  if ("error" in files) return files.error;
  // Before the transition: a timed-out answer that landed leaves the row answered already.
  const seen = seenOf(row, args, ctx, { Answer: p.value, Status: "answered", AnsweredByUserId: ctx.userId });
  if (seen === "own") {
    await files.attach();
    return ok({ clarification: row });
  }
  const t = clarificationTransition(row.Status as never, "answer", { answer: p.value });
  if (!t.ok) return fail("conflict", "sanitization.transition");
  if (seen === "stale") return staleResult();
  // The files go onto the question before the answer lands, so the draft that the answer may start reads them.
  await files.attach();
  const updated = await ctx.gateway.update("Clarification", str(args.id), {
    Answer: p.value,
    Status: "answered",
    AnsweredByUserId: ctx.userId,
    AnsweredAt: ctx.now(),
  });
  ctx.audit({
    action: "clarification.answer", targetType: "clarification", targetId: str(args.id),
    details: { number: row.Number, status: "answered", ...(files.count ? { files: files.count, attachmentIds: files.ids } : {}) },
  });
  const draftJobId = await draftWhenAnswered(ctx);
  return ok({ clarification: updated, ...(draftJobId ? { draftJobId } : {}) });
}

async function defer(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const p = parsed<string>(parseDeferReason(args.reason));
  if ("error" in p) return p.error;
  const row = await loadRow(ctx, args);
  if (!row) return notFound("clarification");
  const seen = seenOf(row, args, ctx, { Status: "deferred", DeferReason: p.value });
  if (seen === "own") return ok({ clarification: row });
  const t = clarificationTransition(row.Status as never, "defer", { reason: p.value });
  if (!t.ok) return fail("conflict", "sanitization.transition");
  if (seen === "stale") return staleResult();
  const updated = await ctx.gateway.update("Clarification", str(args.id), { Status: "deferred", DeferReason: p.value });
  ctx.audit({ action: "clarification.defer", targetType: "clarification", targetId: str(args.id), details: { number: row.Number, status: "deferred" } });
  const draftJobId = await draftWhenAnswered(ctx);
  return ok({ clarification: updated, ...(draftJobId ? { draftJobId } : {}) });
}

async function reopen(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const row = await loadRow(ctx, args);
  if (!row) return notFound("clarification");
  const seen = seenOf(row, args, ctx, { Status: "open" });
  if (seen === "own") return ok({ clarification: row });
  const t = clarificationTransition(row.Status as never, "reopen", {});
  if (!t.ok) return fail("conflict", "sanitization.transition");
  if (seen === "stale") return staleResult();
  const updated = await ctx.gateway.update("Clarification", str(args.id), { Status: "open" });
  ctx.audit({ action: "clarification.reopen", targetType: "clarification", targetId: str(args.id), details: { number: row.Number, status: "open" } });
  return ok({ clarification: updated });
}

function removeReads(env: Reader, args: Args) {
  const id = str(args.id);
  if (!id) return Promise.resolve([null, []] as [Row | null, Row[]]);
  return Promise.all([
    projectRow(env, "Clarification", id),
    env.gateway.list("Decision", { ProjectId: str(args.projectId), ClarificationId: id }, { fields: ["ItemId", "Number"], first: 1 }),
    env.gateway.verify("Clarification", id),
  ]).then(([row, linked]) => [row, linked]) as Promise<[Row | null, Row[]]>;
}

async function remove(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const id = str(args.id);
  if (!id) return notFound("clarification");
  const [row, linked] = await removeReads(ctx, args);
  if (!row) return notFound("clarification");
  const first = (linked as Row[])[0];
  if (first) return fail("conflict", "sanitization.clarificationInUse", { decisionNumber: first.Number });
  await ctx.gateway.remove("Clarification", id);
  ctx.audit({ action: "clarification.delete", targetType: "clarification", targetId: id, details: { number: row.Number } });
  return ok({ id });
}

const rowRead = { prefetch: (env: ReadEnv, args: Args) => loadRow(env, args) };

export const CLARIFICATION_OPS: OpTable = {
  "clarification.save": withReads(save, { prefetch: savePrefetch }),
  "clarification.answer": withReads(answer, { prefetch: (env, args) => Promise.all([loadRow(env, args), answerFileRows(env, args)]) }),
  "clarification.defer": withReads(defer, rowRead),
  "clarification.reopen": withReads(reopen, rowRead),
  "clarification.delete": withReads(remove, { prefetch: (env, args) => removeReads(env, args) }),
};
