// The client's answers and decisions as their own block of a prompt's material (material.ts), placed before the notes
// and the files and stated as what overrides them. Each answer carries a tag ([A1]) so a planner can cite it as a
// source (a requirement's SourceRefs then name the Clarification or the Decision). The answers are the ones that stand
// (engine-context/answers.ts effectiveAnswers: a reply to a conflict question replaces the answer it is about), and
// the points where an answer and a document differ (engine-context/facts.ts, the context's basics.factConflicts) are
// listed with the answer as the one followed. Pure.
import type { ContextFile } from "../../../engine-context/store.ts";
import { effectiveAnswers, type AnswerItem } from "../../../engine-context/answers.ts";
import type { FactConflict } from "../../../engine-context/facts.ts";

export interface AnswerTag {
  /** "Clarification:<id>" or "Decision:<id>". */
  ref: string;
  /** The row's ItemId (what a requirement's SourceRefs hold). */
  id: string;
  kind: "clarification" | "decision";
  number: number;
  question: string;
  answer: string;
}

/** The rule every drafting prompt states with the block, word for word. */
export const ANSWERS_FIRST =
  "The client's answers and decisions come first: they override the notes, the files and what was read from them. Where a document says something else, follow the answer (a later answer replaces an earlier one on the same point).";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const fold = (s: string): string => s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const idOf = (ref: string): string => ref.slice(ref.indexOf(":") + 1);
const MAX_ANSWERS = 40;
const MAX_OPEN = 10;
const MAX_DECISIONS = 12;

/** The conflict line a prompt shows ("- the main call to action: your answer to question 1 says …"). */
export function conflictLine(c: FactConflict): string {
  const who = c.answerKind === "decision" ? `your decision ${c.answerNumber}` : `your answer to question ${c.answerNumber}`;
  return `- ${c.label}: ${who} says "${c.answer}"; ${c.otherName} says "${c.other}". Follow ${c.kind === "answer" ? "the newer answer" : "the answer"}.`;
}

/** The block, its tags and the records it shows; `text` is "" when there is nothing answered, decided or open. */
export function answersBlock(ctx: ContextFile, o: { extra?(ref: string): string } = {}): { text: string; tags: Map<string, AnswerTag>; used: string[] } {
  const tags = new Map<string, AnswerTag>();
  const used: string[] = [];
  const lines: string[] = [];
  const items = ctx.sections.clarifications as unknown as (AnswerItem & { deferReason?: string })[];
  const answers = effectiveAnswers(items.map((c) => ({ ref: str(c.ref), number: Number(c.number) || 0, question: str(c.question), answer: str(c.answer), status: str(c.status), answeredAt: str(c.answeredAt), ...(str(c.confirms) ? { confirms: str(c.confirms) } : {}) }))).slice(-MAX_ANSWERS);
  for (const a of answers) {
    const tag = `A${tags.size + 1}`;
    tags.set(tag, { ref: a.ref, id: idOf(a.ref), kind: "clarification", number: a.number, question: a.question, answer: a.answer });
    used.push(a.ref);
    const later = a.confirmedIn !== undefined && a.firstAnswer ? ` (changed in question ${a.confirmedIn}; the first answer was "${fold(a.firstAnswer)}")` : a.confirmedIn !== undefined ? ` (confirmed in question ${a.confirmedIn})` : "";
    lines.push(`[${tag}] Question ${a.number}: ${fold(a.question)}\nAnswer: ${fold(a.answer)}${later}${o.extra?.(a.ref) ?? ""}`);
  }
  const decisions = ctx.sections.decisions.decisions.filter((d) => d.status === "accepted").slice(0, MAX_DECISIONS);
  for (const d of decisions) {
    const tag = `A${tags.size + 1}`;
    tags.set(tag, { ref: str(d.ref), id: idOf(str(d.ref)), kind: "decision", number: Number(d.number) || 0, question: str(d.title), answer: str(d.statement) });
    used.push(str(d.ref));
    lines.push(`[${tag}] Decision ${Number(d.number) || tags.size}: ${fold(`${str(d.title)}: ${str(d.statement)}`)}`);
  }
  const open = items.filter((c) => c.status === "deferred").slice(0, MAX_OPEN);
  const conflicts = ctx.sections.basics.factConflicts ?? [];
  if (!lines.length && !open.length) return { text: "", tags, used };
  const out: string[] = [];
  if (lines.length) {
    out.push(`The client's answers and decisions (${ANSWERS_FIRST} Cite an answer by its tag, e.g. "A1", where a field asks for sources):\n${lines.join("\n")}`);
  }
  if (conflicts.length) out.push(`Where an answer and the documents differ (the answer is followed; the client is asked to confirm it):\n${conflicts.map(conflictLine).join("\n")}`);
  if (open.length) {
    used.push(...open.map((c) => str(c.ref)));
    out.push(`Questions set aside, not answered yet (decide nothing on them; say what is still open):\n${open.map((c) => `- Question ${Number(c.number) || ""}: ${fold(str(c.question))}${str(c.deferReason) ? ` (${fold(str(c.deferReason))})` : ""}`).join("\n")}`);
  }
  return { text: out.join("\n\n"), tags, used };
}
