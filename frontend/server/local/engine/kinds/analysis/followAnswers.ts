// The client's answers win in requirements.draft (engine-context/answers.ts): after the draft is planned, every
// answered question must be in it (its key facts) or be a listed conflict. The step
//   1. checks the plan against the answers as they stand (a reply to a conflict question replaces the answer),
//   2. when an answer is not in it, asks Claude once more with the answers it left out (when Claude wrote the plan),
//   3. repairs what is still missing: the answer becomes an acceptance criterion of the requirement it is about, and
//      every requirement that follows an answer names it in its SourceRefs,
//   4. asks the client to confirm each conflict ("Your answer says X, the brief says Y — we followed your answer"):
//      an open Clarification with the two values as one-click answers; its reply replaces the answer and refreshes the
//      draft (autoDraft.ts),
//   5. records the check in the job's folder and the ledger (engine-context/hooks.ts recordCheck) and the log.
import { str } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { clip, wordsOf } from "../../text.ts";
import type { PlannedReq } from "./draft.ts";
import type { AiConflict, DraftedRequirements } from "./ai.ts";
import { before, mine, nextNumber, similar } from "./own.ts";
import { contextOf, recordCheck } from "../../../../engine-context/hooks.ts";
import {
  checkAnswers, checkLine, conflictLocalKey, conflictQuestion, effectiveAnswers, isConflictKey, keyFactsOf, reflects,
  type AnswerCheck, type AnswerConflictNote, type AnswerItem, type EffectiveAnswer,
} from "../../../../engine-context/answers.ts";
import type { FactConflict } from "../../../../engine-context/facts.ts";

/** A conflict to record, and to ask about unless the client settled it already. */
export interface PlannedConflict {
  answerRef: string;
  answerNumber: number;
  question: string;
  label: string;
  answer: string;
  other: string;
  otherRef: string;
  otherName: string;
  kind: "document" | "answer";
  /** "decision": an accepted decision of the log is followed; recorded, not asked (a person decided it). */
  answerKind: "question" | "decision";
  /** "facts" (the project facts disagree) or "draft" (Claude reported it while drafting). */
  found: "facts" | "draft";
  /** True when the client already confirmed or changed this answer in reply to a conflict question. */
  settled: boolean;
}

const idOf = (ref: string): string => ref.slice(ref.indexOf(":") + 1);
const reqText = (r: PlannedReq): string => [r.Title, r.Text, ...r.AcceptanceCriteria].join("\n");

/** The answers as they stand, from the job's context snapshot. */
export async function answersOf(run: JobRun): Promise<{ answers: EffectiveAnswer[]; factConflicts: FactConflict[] }> {
  const ctx = await contextOf(run);
  const items = (ctx.sections.clarifications as unknown as AnswerItem[]).map((c) => ({ ...c, ref: str(c.ref), question: str(c.question), answer: str(c.answer), status: str(c.status), answeredAt: str(c.answeredAt) }));
  return { answers: effectiveAnswers(items), factConflicts: ctx.sections.basics.factConflicts ?? [] };
}

/** Every meaningful word of the shorter text is in the longer one ("CHF" in "All prices are shown in CHF"). */
function within(a: string, b: string): boolean {
  const A = wordsOf(a);
  const B = wordsOf(b);
  if (A.size === 0 || B.size === 0) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

/** Two conflicts are the same disagreement: the same answer against the same source, with the same point or values
 *  (the project facts find "EUR" against "CHF"; Claude, drafting, reports "prices in EUR" against "prices in CHF"). */
function sameConflict(x: PlannedConflict, c: PlannedConflict): boolean {
  if (x.answerRef !== c.answerRef) return false;
  if (x.label === c.label || similar(x.other, c.other, 0.7) || x.other.toLowerCase() === c.other.toLowerCase()) return true;
  if (x.otherRef && c.otherRef && x.otherRef !== c.otherRef) return false;
  return (within(x.answer, c.answer) && within(x.other, c.other)) || within(x.label, c.label);
}

/** The facts' conflicts and Claude's, one per answer and other value (pure). */
export function mergeConflicts(answers: readonly EffectiveAnswer[], facts: readonly FactConflict[], drafted: readonly AiConflict[]): PlannedConflict[] {
  const settled = (ref: string) => answers.some((a) => a.ref === ref && a.confirmedIn !== undefined);
  const known = new Set(answers.map((a) => a.ref));
  const out: PlannedConflict[] = [];
  const add = (c: PlannedConflict) => {
    if (c.answerKind === "question" && !known.has(c.answerRef)) return;
    if (out.some((x) => sameConflict(x, c))) return;
    out.push(c);
  };
  for (const f of facts) {
    add({ answerRef: f.answerRef, answerNumber: f.answerNumber, question: f.question, label: f.label, answer: f.answer, other: f.other, otherRef: f.otherRef, otherName: f.otherName, kind: f.kind, answerKind: f.answerKind, found: "facts", settled: settled(f.answerRef) });
  }
  for (const d of drafted) {
    add({ answerRef: d.answerRef, answerNumber: d.answerNumber, question: d.question, label: d.point, answer: d.answerSays, other: d.otherSays, otherRef: d.otherRef, otherName: d.otherName, kind: d.kind, answerKind: d.answerKind === "decision" ? "decision" : "question", found: "draft", settled: settled(d.answerRef) });
  }
  return out;
}

const notes = (c: readonly PlannedConflict[]): AnswerConflictNote[] => c.map((x) => ({ answerRef: x.answerRef, label: x.label, answer: x.answer, other: x.other, otherName: x.otherName }));

/** The requirement an answer is about: the one sharing most of its question's and answer's words (pure). */
function bestFor(plan: readonly PlannedReq[], a: EffectiveAnswer): number {
  const k = keyFactsOf(`${a.question} ${a.answer}`);
  let best = -1;
  let score = 0;
  plan.forEach((r, i) => {
    const s = reflects(k, reqText(r)).found;
    if (s > score) {
      score = s;
      best = i;
    }
  });
  if (best >= 0) return best;
  const must = plan.findIndex((r) => r.Priority === "must");
  return must >= 0 ? must : 0;
}

/** The plan with every answer in it (pure): a requirement that holds an answer's key facts names the answer in its
 *  SourceRefs; an answer no requirement holds becomes an acceptance criterion of the requirement it is about. */
export function repairPlan(plan: readonly PlannedReq[], answers: readonly EffectiveAnswer[], check: AnswerCheck, conflicts: readonly PlannedConflict[]): { plan: PlannedReq[]; repaired: string[] } {
  const out = plan.map((r) => ({ ...r, AcceptanceCriteria: [...r.AcceptanceCriteria], SourceRefs: [...r.SourceRefs] }));
  const repaired: string[] = [];
  if (out.length === 0) return { plan: out, repaired };
  for (const a of answers) {
    const item = check.items.find((i) => i.ref === a.ref);
    if (!item || item.status === "unchecked") continue;
    const id = idOf(a.ref);
    if (item.status === "reflected") {
      const k = keyFactsOf(a.answer);
      for (const r of out) if (reflects(k, reqText(r)).ok && !r.SourceRefs.includes(id)) r.SourceRefs.push(id);
      continue;
    }
    const r = out[bestFor(out, a)]!;
    const c = conflicts.find((x) => x.answerRef === a.ref);
    const criterion = clip(`Follows your answer to question ${a.number}: ${a.answer.replace(/\s+/g, " ").trim().replace(/\.$/, "")}${c ? ` (not "${c.other}" from ${c.otherName})` : ""}`, 500);
    if (!r.AcceptanceCriteria.includes(criterion)) r.AcceptanceCriteria.push(criterion);
    if (!r.SourceRefs.includes(id)) r.SourceRefs.push(id);
    repaired.push(a.ref);
  }
  return { plan: out, repaired };
}

export interface FollowedAnswers {
  plan: PlannedReq[];
  /** The check of the plan as written (after the second try and the repairs). */
  check: AnswerCheck;
  /** The check of the first draft. */
  first: AnswerCheck;
  conflicts: PlannedConflict[];
  repaired: string[];
  retried: boolean;
}

/** The plan made to follow every answer (steps 1 to 3). `others` are texts of the requirements document that count
 *  too (the requirements that stay, the workflows, what is left out, the constraints); `retry` asks Claude again. */
export async function followAnswers(run: JobRun, o: {
  plan: PlannedReq[];
  drafted: readonly AiConflict[];
  others?: readonly string[];
  /** The requirements the plan rewrites (a refresh): they do not count as they are now. */
  replacing?: ReadonlySet<string>;
  retry?: (fix: string[]) => Promise<DraftedRequirements | null>;
}): Promise<FollowedAnswers> {
  const { answers, factConflicts } = await answersOf(run);
  const stays = before(run, "Requirement").filter((r) => r.Status !== "dropped" && !o.replacing?.has(str(r.ItemId))).map((r) => `${str(r.Title)}\n${str(r.Text)}`);
  const texts = (plan: readonly PlannedReq[]) => [...plan.map(reqText), ...stays, ...(o.others ?? [])];
  let conflicts = mergeConflicts(answers, factConflicts, o.drafted);
  let plan = o.plan;
  const first = checkAnswers({ step: "requirements", answers, texts: texts(plan), conflicts: notes(conflicts) });
  let check = first;
  let retried = false;
  const notIn = (c: AnswerCheck) => c.items.filter((i) => i.status === "missing" || i.status === "conflict");
  if (notIn(first).length && o.retry) {
    const fix = notIn(first).map((i) => {
      const c = conflicts.find((x) => x.answerRef === i.ref);
      return `Question ${i.number} ("${i.question.replace(/\s+/g, " ").trim()}"): "${i.answer}"${c ? `, not "${c.other}" as ${c.otherName} says` : ""}`;
    });
    run.log(`answers: the draft leaves out ${fix.length} answer(s); asking once more`);
    retried = true;
    const again = await o.retry(fix).catch(() => null);
    if (again?.requirements.length) {
      const merged = mergeConflicts(answers, factConflicts, [...o.drafted, ...again.conflicts]);
      const second = checkAnswers({ step: "requirements", answers, texts: texts(again.requirements), conflicts: notes(merged) });
      if (notIn(second).length < notIn(first).length) {
        plan = again.requirements;
        conflicts = merged;
        check = second;
      }
    }
  }
  const fixed = repairPlan(plan, answers, check, conflicts);
  const final = checkAnswers({ step: "requirements", answers, texts: texts(fixed.plan), conflicts: notes(conflicts) });
  return { plan: fixed.plan, check: final, first, conflicts, repaired: fixed.repaired, retried };
}

/** Step 4: the conflict questions the client sees (the ones not settled and not asked before); answers their refs. */
export async function askConflicts(run: JobRun, conflicts: readonly PlannedConflict[]): Promise<string[]> {
  const out: string[] = [];
  const rows = run.p.rows("Clarification");
  let next = nextNumber(run, "Clarification");
  for (const c of conflicts) {
    if (c.settled || c.answerKind !== "question") continue;
    const answerId = idOf(c.answerRef);
    const original = rows.find((r) => str(r.ItemId) === answerId);
    if (!original) continue;
    const local = conflictLocalKey(answerId, c.answer, c.other);
    // a resumed run of this job: its own question is its output; one an earlier job asked stays as it is
    const own = mine(run, "Clarification", local);
    if (own) {
      out.push(`Clarification:${str(own.ItemId)}`);
      continue;
    }
    if (rows.some((r) => isConflictKey(str(r.RequestKey), local))) continue;
    const q = conflictQuestion({ kind: c.kind, label: c.label, answerNumber: c.answerNumber, answer: c.answer, other: c.other, otherName: c.otherName });
    const docType = c.otherRef.startsWith("DocFile:") ? "doc-file" : c.otherRef.startsWith("DocNote:") ? "doc-note" : "engine";
    const n = next++;
    const id = await run.insert("Clarification", {
      Number: n,
      Question: clip(q.question, 2000),
      Answer: "",
      Status: "open",
      OwnerUserId: str(original.AnsweredByUserId) || str(original.OwnerUserId) || run.requester,
      SourceType: docType,
      SourceRef: docType === "engine" ? "" : idOf(c.otherRef),
      DeferReason: "",
      SortOrder: n,
      ...(q.options.length >= 2 ? { Options: q.options } : {}),
    }, local);
    out.push(`Clarification:${id}`);
  }
  return out;
}

/** Step 5: the check in the job's folder, the ledger and the log; answers the line for the job's message. */
export function recordAnswerCheck(run: JobRun, f: FollowedAnswers, asked: readonly string[]): string {
  const line = checkLine(f.check);
  run.log(`answers: ${line}${f.retried ? " (after a second try)" : ""}${f.repaired.length ? `; ${f.repaired.length} added as acceptance criteria` : ""}${asked.length ? `; ${asked.length} conflict question(s) asked` : ""}`);
  recordCheck(run, "answers", {
    step: f.check.step,
    ok: f.check.ok,
    checked: f.check.checked,
    reflected: f.check.reflected,
    firstDraft: { reflected: f.first.reflected, notIn: f.first.items.filter((i) => i.status === "missing" || i.status === "conflict").map((i) => ({ ref: i.ref, number: i.number, missing: i.missing })) },
    retried: f.retried,
    repaired: f.repaired,
    items: f.check.items.map((i) => ({ ref: i.ref, number: i.number, status: i.status, missing: i.missing })),
    conflicts: f.conflicts.map((c) => ({ answerRef: c.answerRef, number: c.answerNumber, about: c.label, followed: c.answer, other: c.other, otherRef: c.otherRef, otherName: c.otherName, kind: c.kind, found: c.found, settled: c.settled })),
    asked,
  });
  return line;
}

/** The answers check of a drafted scope (scope.draft): every answer in its features, stories and targets, or a listed
 *  conflict. Recorded only (the job's folder, the ledger, the log); the requirements step already made the requirements
 *  follow every answer. Never throws. */
export async function recordScopeAnswers(run: JobRun, texts: readonly string[]): Promise<AnswerCheck | null> {
  try {
    const { answers, factConflicts } = await answersOf(run);
    const conflicts = mergeConflicts(answers, factConflicts, []);
    const check = checkAnswers({ step: "scope", answers, texts, conflicts: notes(conflicts) });
    run.log(`answers: ${checkLine(check)}`);
    recordCheck(run, "answers", {
      step: "scope",
      ok: check.ok,
      checked: check.checked,
      reflected: check.reflected,
      items: check.items.map((i) => ({ ref: i.ref, number: i.number, status: i.status, missing: i.missing })),
      conflicts: conflicts.map((c) => ({ answerRef: c.answerRef, number: c.answerNumber, about: c.label, followed: c.answer, other: c.other, otherName: c.otherName, settled: c.settled })),
    });
    return check;
  } catch (e) {
    run.log(`answers: the scope check failed (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}
