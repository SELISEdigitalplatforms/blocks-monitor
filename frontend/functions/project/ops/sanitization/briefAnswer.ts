// clarification.answerBrief: the answer to the business analyst's own brief question ("What is the main objective of
// …?" / "Who will use it day to day?") from step 1 of Business Analysis, in ONE write. The question's words come from
// the project's name (projectBrief briefQuestions), so the record is exactly the one briefAnswers / briefFacts read for
// "What we understood" and every engine kind. One answer is one record: the question already recorded is answered (a
// retry finds its own answer and writes nothing), else one row is written already answered; nothing is written when the
// answer is refused. Open copies of the same question left without an answer (written by the two-call path before
// 08.11, whose answer never landed) go, so the questions list keeps one.
import { briefQuestions } from "../../../../src/domain/projectBrief";
import { PROJECT_LIMITS, parseAnswer } from "../../../../src/domain/sanitization";
import { countRows, fail, gate, insertNumbered, ok, requirePermission, topNumber, withReads } from "./common";
import { draftWhenAnswered } from "./autoDraft";
import type { OpContext, OpResult, OpTable, Row } from "./ports";

type Args = Record<string, unknown>;
export type BriefAbout = "goal" | "users";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The answer's limits, the same as the step-1 box (BriefStep MAX). */
export const BRIEF_ANSWER_MAX: Readonly<Record<BriefAbout, number>> = { goal: 2000, users: 1000 };

/** An open copy of the brief question nobody answered, that a person's two-call save left (never the engine's). */
const strayCopy = (r: Row): boolean =>
  r.Status === "open" && !str(r.Answer).trim() && !str(r.RequestKey).startsWith("engine:") && !str(r.SourceRef);

/** The row the answer goes onto: one answered already (the earliest), else the earliest of the question's rows. */
export function briefTarget(rows: readonly Row[]): Row | null {
  const live = rows.filter((r) => r.IsDeleted !== true).slice().sort((a, b) => num(a.Number) - num(b.Number) || str(a.ItemId).localeCompare(str(b.ItemId)));
  return live.find((r) => r.Status === "answered") ?? live[0] ?? null;
}

async function answerBrief(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, "reachable");
  if (g) return g;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const about = args.about;
  if (about !== "goal" && about !== "users") return fail("invalid_input", "sanitization.invalidField", { field: "about", rule: "enum" });
  const parsed = parseAnswer(args.answer);
  if (!parsed.ok) return fail("invalid_input", parsed.messageKey, parsed.params);
  const answer = parsed.value;
  if (answer.length > BRIEF_ANSWER_MAX[about]) {
    return fail("invalid_input", "sanitization.invalidField", { field: "answer", rule: "maxLength", max: BRIEF_ANSWER_MAX[about] });
  }
  const question = briefQuestions(str(ctx.project.Name))[about];
  const projectId = str(ctx.project.ItemId);

  // one round: the question's rows, the count (limit) and the top number (a new row's number)
  const [asked, count, top] = await Promise.all([
    ctx.gateway.list("Clarification", { ProjectId: projectId, Question: question }, { max: PROJECT_LIMITS.clarifications }),
    countRows(ctx, "Clarification", PROJECT_LIMITS.clarifications),
    topNumber(ctx, "Clarification"),
  ]);
  const target = briefTarget(asked);
  const strays = asked.filter((r) => r !== target && r.IsDeleted !== true && strayCopy(r));
  // a copy a decision points to stays (clarification.delete refuses it too)
  const linked = strays.length
    ? new Set((await ctx.gateway.list("Decision", { ProjectId: projectId, ClarificationId: { in: strays.map((r) => str(r.ItemId)) } }, { fields: ["ClarificationId"], max: PROJECT_LIMITS.decisions }))
        .map((d) => str(d.ClarificationId)))
    : new Set<string>();

  const answered = { Answer: answer, Status: "answered", AnsweredByUserId: ctx.userId, AnsweredAt: ctx.now() };
  let row: Row;
  let created = false;
  if (target) {
    // a retry (or the same words again) finds its answer in place: nothing to write; a question set aside is answered now
    const patch = target.Status === "deferred" ? { ...answered, DeferReason: "" } : answered;
    row = target.Status === "answered" && str(target.Answer) === answer ? target : await ctx.gateway.update("Clarification", str(target.ItemId), patch);
  } else {
    if (count >= PROJECT_LIMITS.clarifications) {
      return fail("limit_reached", "sanitization.limit", { kind: "clarifications", max: PROJECT_LIMITS.clarifications });
    }
    // one insert, answered already: there is never an open question without its answer
    ({ row } = await insertNumbered(ctx, "Clarification", { Question: question, OwnerUserId: "", SourceType: "", SourceRef: "", ...answered }, `brief:${about}`, { knownMax: top }));
    created = true;
  }
  const removed = strays.filter((r) => !linked.has(str(r.ItemId))).map((r) => str(r.ItemId));
  await Promise.all(removed.map((id) => ctx.gateway.remove("Clarification", id)));

  ctx.audit({
    action: "clarification.answer", targetType: "clarification", targetId: str(row.ItemId),
    details: { number: row.Number, status: "answered", brief: about, created, ...(removed.length ? { removedCopies: removed.length } : {}) },
  });
  const draftJobId = await draftWhenAnswered(ctx);
  return ok({ clarification: row, ...(removed.length ? { removed } : {}), ...(draftJobId ? { draftJobId } : {}) });
}

export const BRIEF_ANSWER_OPS: OpTable = {
  "clarification.answerBrief": withReads(answerBrief, {}),
};
