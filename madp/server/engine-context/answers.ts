// The client's answers come first. What a person answered (and decided) is the highest-priority source of every
// drafting step: it overrides the notes, the files and what was read from them. Pure:
//
//   effectiveAnswers   the answers as they stand: a later answer that confirms or corrects an earlier one (the question
//                      requirements.draft asks when an answer and a document differ) replaces it
//   checkAnswers       after a draft: is every answer reflected (its key facts present) in what was drafted, or listed
//                      as a conflict? The job records the result (its folder and the ledger) and repairs what is missing
//   conflictQuestion   the question the client sees: "Your answer says X, the brief says Y — we followed your answer"
//
// A conflict question is a Clarification of the engine whose RequestKey (the job's key with the local part
// conflictLocalKey) names the answer it is about: it keeps the same conflict from being asked twice, and links the
// reply to the answer.

export interface AnswerItem {
  /** "Clarification:<id>". */
  ref: string;
  number: number;
  question: string;
  answer: string;
  status: string;
  answeredAt?: string;
  /** The answer this one confirms or corrects ("Clarification:<id>"), for a conflict question. */
  confirms?: string;
}

export interface EffectiveAnswer {
  ref: string;
  number: number;
  question: string;
  /** The answer as it stands (the newest reply to the point). */
  answer: string;
  /** The first answer, when a later reply changed it. */
  firstAnswer?: string;
  /** The number of the question whose reply this is, when a later reply confirmed or changed the answer. */
  confirmedIn?: number;
}

const CONFLICT_PART = "answer-conflict:";
const UUIDISH = /^[A-Za-z0-9-]{8,64}$/;

/** A short, stable hash of a text (FNV-1a, 8 hex characters). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The local part of the RequestKey of the question that asks the client to confirm an answer against what `other`
 *  says ("answer-conflict:<clarificationId>:<hash>"): the same conflict always gets the same part (asked once), and it
 *  names the answer. */
export function conflictLocalKey(clarificationId: string, answer: string, other: string): string {
  return `${CONFLICT_PART}${clarificationId}:${shortHash(`${answer.trim().toLowerCase()}|${other.trim().toLowerCase()}`)}`;
}

/** True when a RequestKey is the one of this conflict (whichever job asked it). */
export function isConflictKey(requestKey: string, local: string): boolean {
  return requestKey === local || requestKey.endsWith(`:${local}`);
}

/** The ItemId of the answer a conflict question is about, or "" (not a conflict question). Only the engine's own keys
 *  ("engine:<job>:<attempt>:answer-conflict:<id>:<hash>") count. */
export function confirmedIdOf(requestKey: string): string {
  if (!requestKey.startsWith("engine:")) return "";
  const at = requestKey.indexOf(`:${CONFLICT_PART}`);
  if (at < 0) return "";
  const id = requestKey.slice(at + 1 + CONFLICT_PART.length).split(":")[0] ?? "";
  return UUIDISH.test(id) ? id : "";
}

const at = (s: string | undefined): number => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : 0;
};

/** The answers as they stand, oldest question first: a conflict question's reply replaces the answer it is about when
 *  it is newer; the conflict questions themselves are not listed (pure). */
export function effectiveAnswers(items: readonly AnswerItem[]): EffectiveAnswer[] {
  const answered = items.filter((c) => c.status === "answered" && c.answer.trim() !== "");
  const replies = new Map<string, AnswerItem[]>();
  for (const c of answered) if (c.confirms) replies.set(c.confirms, [...(replies.get(c.confirms) ?? []), c]);
  const out: EffectiveAnswer[] = [];
  for (const c of answered) {
    // a reply to an answer that is no longer there stands on its own
    if (c.confirms && answered.some((x) => x.ref === c.confirms)) continue;
    const newest = (replies.get(c.ref) ?? []).filter((r) => at(r.answeredAt) >= at(c.answeredAt)).sort((a, b) => at(b.answeredAt) - at(a.answeredAt) || b.number - a.number)[0];
    if (!newest) {
      out.push({ ref: c.ref, number: c.number, question: c.question, answer: c.answer.trim() });
      continue;
    }
    const changed = newest.answer.trim().toLowerCase() !== c.answer.trim().toLowerCase();
    out.push({ ref: c.ref, number: c.number, question: c.question, answer: newest.answer.trim(), ...(changed ? { firstAnswer: c.answer.trim() } : {}), confirmedIn: newest.number });
  }
  return out.sort((a, b) => a.number - b.number);
}

// ------------------------------------------------------------------------------------------------- the check

/** Words that carry no fact of their own ("only", "the", "yes"). */
const FILLER = new Set(
  "a an the and or but of for to in on at by with from into onto as is are be was were it its this that these those our your their my we you they them he she his her only just also all any each every per some none no yes not very more most less least one first then than so such via about around up down out over under should would could will can may might must shall do does did done have has had get gets got please thanks ok okay etc page site product".split(" "),
);

const norm = (s: string): string =>
  s.toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\be-mail/g, "email").replace(/[’']/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^\p{L}\p{N}%.\s-]+/gu, " ")
    .replace(/\s+/g, " ").trim();

/** A word's plain stem ("visitors" -> "visitor", "tablets" -> "tablet"), so the draft's wording may differ a little. */
const stem = (w: string): string => (w.length > 4 && /ies$/.test(w) ? `${w.slice(0, -3)}y` : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);

const tokens = (s: string): string[] => norm(s).split(/[\s-]+/).map((w) => w.replace(/^[.%]+|[.]+$/g, "")).filter(Boolean);

export interface KeyFacts {
  /** "100", "2%", "20". */
  numbers: string[];
  /** Stems of the meaningful words. */
  words: string[];
}

/** The key facts of an answer: its numbers and its meaningful words (pure). */
export function keyFactsOf(answer: string): KeyFacts {
  const numbers: string[] = [];
  const words: string[] = [];
  for (const t of tokens(answer)) {
    if (/^\d+(?:\.\d+)?%?$/.test(t)) {
      if (!numbers.includes(t)) numbers.push(t);
    } else if (t.length >= 2 && !FILLER.has(t) && !/^\d/.test(t)) {
      const s = stem(t);
      if (!words.includes(s)) words.push(s);
    }
  }
  return { numbers, words };
}

/** Whether a text holds an answer's key facts: every number, and every word of a short answer (at most three) or six
 *  in ten of a longer one. `missing` names what is not there (pure). */
export function reflects(k: KeyFacts, text: string): { ok: boolean; found: number; missing: string[] } {
  const toks = tokens(text);
  const stems = new Set(toks.map(stem));
  const nums = new Set(toks.filter((t) => /^\d/.test(t)).flatMap((t) => [t, t.replace(/%$/, "")]));
  // "2 %" and "2 percent" are "2%"
  for (const m of norm(text).matchAll(/(\d+(?:\.\d+)?)\s?(?:%|percent\b|per cent\b)/g)) nums.add(`${m[1]}%`);
  const missing: string[] = [];
  let found = 0;
  for (const n of k.numbers) (nums.has(n) ? found++ : missing.push(n));
  const words: string[] = [];
  for (const w of k.words) (stems.has(w) ? found++ : words.push(w));
  missing.push(...words);
  const wordsOk = k.words.length <= 3 ? words.length === 0 : (k.words.length - words.length) / k.words.length >= 0.6;
  return { ok: k.numbers.every((n) => nums.has(n)) && wordsOk, found, missing };
}

export type CheckStatus = "reflected" | "conflict" | "missing" | "unchecked";

export interface CheckItem {
  ref: string;
  number: number;
  question: string;
  answer: string;
  status: CheckStatus;
  /** The key facts the drafted text does not hold. */
  missing: string[];
}

export interface AnswerConflictNote {
  /** The answer followed ("Clarification:<id>"). */
  answerRef: string;
  /** What it is about, in plain words ("the main call to action"). */
  label: string;
  answer: string;
  other: string;
  otherName: string;
}

export interface AnswerCheck {
  /** "requirements" or "scope". */
  step: string;
  checked: number;
  reflected: number;
  /** The answers that differ from a document or an earlier answer: followed, and listed for the client to confirm. */
  conflicts: AnswerConflictNote[];
  /** The answers whose key facts the draft does not hold (and that are no conflict). */
  missing: CheckItem[];
  items: CheckItem[];
  /** True when every answer is reflected; a conflict is reflected too when the draft follows the answer. */
  ok: boolean;
}

/** Checks a draft against the answers: every answered question is reflected (its key facts are in `texts`), or it is a
 *  listed conflict. A conflict whose answer the draft does not follow is "conflict" (and not ok): the draft must follow
 *  the answer (pure). */
export function checkAnswers(o: { step: string; answers: readonly EffectiveAnswer[]; texts: readonly string[]; conflicts?: readonly AnswerConflictNote[] }): AnswerCheck {
  const all = o.texts.filter(Boolean).join("\n");
  const conflicts = o.conflicts ?? [];
  const items: CheckItem[] = o.answers.map((a) => {
    const k = keyFactsOf(a.answer);
    const base = { ref: a.ref, number: a.number, question: a.question, answer: a.answer };
    if (k.numbers.length === 0 && k.words.length === 0) return { ...base, status: "unchecked" as const, missing: [] };
    const r = reflects(k, all);
    if (r.ok) return { ...base, status: "reflected" as const, missing: [] };
    return { ...base, status: conflicts.some((c) => c.answerRef === a.ref) ? ("conflict" as const) : ("missing" as const), missing: r.missing };
  });
  const reflected = items.filter((i) => i.status === "reflected" || i.status === "unchecked").length;
  return {
    step: o.step,
    checked: items.length,
    reflected,
    conflicts: [...conflicts],
    missing: items.filter((i) => i.status === "missing"),
    items,
    ok: reflected === items.length,
  };
}

/** One line for the job's log and message: "6 of 6 answers are in the requirements; 1 differs from the brief". */
export function checkLine(c: AnswerCheck): string {
  const what = c.step === "scope" ? "the scope" : "the requirements";
  const head = c.checked === 0 ? `No answered questions to check in ${what}` : `${c.reflected} of ${c.checked} answer${c.checked === 1 ? "" : "s"} ${c.reflected === 1 ? "is" : "are"} in ${what}`;
  const notIn = c.items.filter((i) => i.status === "missing" || i.status === "conflict").map((i) => `Q${i.number}`);
  const parts = [
    head,
    notIn.length ? `not yet: ${notIn.join(", ")}` : "",
    c.conflicts.length ? `${c.conflicts.length} answer${c.conflicts.length === 1 ? " differs" : "s differ"} from the documents (the answer is followed)` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

// ------------------------------------------------------------------------------------------------- the question

const quoted = (s: string, max = 120): string => {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "");
  return `“${t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`}”`;
};
const option = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "").replace(/[.;]+$/, "");
  return t.length <= 90 ? t : `${t.slice(0, 89).replace(/\s+\S*$/, "")}…`;
};

export interface ConflictToAsk {
  /** "document": a note, a file or the setup says otherwise; "answer": another answer says otherwise. */
  kind: "document" | "answer";
  label: string;
  answerNumber: number;
  answer: string;
  other: string;
  /** "the file “Brief.pdf”", "your answer to question 2". */
  otherName: string;
}

/** The question that asks the client to confirm the answer the draft followed, with the two values as one-click
 *  answers (pure). */
export function conflictQuestion(c: ConflictToAsk): { question: string; options: string[] } {
  const question = c.kind === "answer"
    ? `Two of your answers differ on ${c.label}: ${c.otherName} says ${quoted(c.other)}, your answer to question ${c.answerNumber} says ${quoted(c.answer)}. We followed the newer answer (question ${c.answerNumber}). Which one is right?`
    : `Your answer to question ${c.answerNumber} says ${quoted(c.answer)} for ${c.label}, but ${c.otherName} says ${quoted(c.other)}. We followed your answer. Which one is right?`;
  const a = option(c.answer);
  const b = option(c.other);
  return { question, options: a.toLowerCase() === b.toLowerCase() ? [a] : [a, b] };
}
