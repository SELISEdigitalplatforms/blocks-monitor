// Claude-written analysis work (see ../../ai/index.ts): the clarifying questions of sanitization.assist and the
// requirements, objective and look & feel of requirements.draft. Each planner answers the writer's own plan type, or
// null so the writer keeps its built-in plan. The `accept` functions are exported for the tests.
import type { Row } from "../../../../../functions/_lib/gateway";
import { str, strs } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { slugOf } from "../../text.ts";
import { aiJson } from "../../ai/index.ts";
import { S, STAGED, arr, markdown, obj, oneOf, text, texts } from "../../ai/check.ts";
import { CONSTRAINT_KINDS, checkExtra, type ConstraintKind, type ExtraInput } from "../../../../../src/domain/requirementsExtras";
import { projectMaterial, type SourceTag } from "../../ai/material.ts";
import { ANSWERS_FIRST, type AnswerTag } from "../../ai/answers.ts";
import type { PlannedQuestion } from "./clarify.ts";
import type { PlannedObjective, PlannedReq } from "./draft.ts";
import type { Area, PlannedTech } from "./technical.ts";
import { before, similar } from "./own.ts";
import { setupOf } from "./setup.ts";
import type { Category } from "./topics.ts";

const ANALYST = "You are the business analyst of the product team.";
const PM = "You are Rajiv, the product manager of the product team.";
const CATEGORIES: readonly Category[] = ["functional", "integration", "nfr", "security", "data", "ux", "other"];
const PRIORITIES = ["must", "nice", "later"] as const;

const bullets = (rows: readonly string[]): string => (rows.length ? rows.map((r) => `- ${r}`).join("\n") : "- (none)");

// ------------------------------------------------------------------------------------------------- questions

export interface QuestionContext {
  requester: string;
  approver: string;
  existing: string[];
  sources: Map<string, SourceTag>;
  /** At least this many questions (0 when the built-in plan found nothing either). */
  min: number;
  max: number;
}

/** The page adds these to every question itself ("Other…", "Not sure", "Later"): never stored as an option. */
const OWN_CHOICES = /^(other|others|something else|not sure|i('| a)m not sure|don'?t know|i don'?t know|unsure|later|answer later|skip|n\/a|none of (these|the above))\b\W*$/i;

/** The one-click answers of a question: 2 to 4 short, distinct answers; [] when fewer than two are usable. */
export function acceptOptions(v: unknown): string[] {
  const out = texts(v, 6, 90, 1)
    .map((t) => t.replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, "").replace(/\.$/, "").trim())
    .filter((t) => t.length >= 1 && !OWN_CHOICES.test(t));
  const unique = out.filter((t, i) => out.findIndex((o) => o.toLowerCase() === t.toLowerCase()) === i).slice(0, 4);
  return unique.length >= 2 ? unique : [];
}

export function acceptQuestions(raw: unknown, c: QuestionContext): PlannedQuestion[] | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.questions)) return null;
  const out: PlannedQuestion[] = [];
  for (const x of arr(o.questions)) {
    const q = obj(x);
    let t = q ? text(q.question, 400, 12) : null;
    if (!q || !t) continue;
    if (!/[?]$/.test(t)) t = `${t.replace(/[.!]+$/, "")}?`;
    if (c.existing.some((e) => similar(e, t!, 0.7)) || out.some((p) => similar(p.question, t!, 0.7))) continue;
    const src = c.sources.get(str(q.source).replace(/[[\]]/g, "").trim());
    const owner = q.forApprover === true && c.approver ? c.approver : src?.by || c.requester;
    out.push({
      local: `q-ai-${out.length}`,
      question: t,
      sourceType: src ? src.type : "engine",
      sourceRef: src ? src.id : "",
      owner,
      topic: "ai",
      options: acceptOptions(q.options),
    });
    if (out.length >= c.max) break;
  }
  return out.length >= c.min ? out : null;
}

const QUESTION_SCHEMA = S.obj({
  questions: S.list(S.obj({
    question: S.str("One short question, at most 200 characters."),
    source: S.str('Tag of the note or file it comes from ("N1", "F2"), or "".'),
    forApprover: { type: "boolean", description: "True when only the person who approves the result can answer it." },
    options: S.list(S.str(), 4, "Two to four short answers a person can pick with one click, each one a complete answer to this exact question."),
  }), 8),
});

/** The clarifying questions (null: keep the built-in plan). `ref`/`fallbackCount` shape a follow-up or the minimum. */
export async function aiQuestions(run: JobRun, o: { ref?: Row | null; fallbackCount: number; max?: number; beat?: boolean }): Promise<PlannedQuestion[] | null> {
  const refs = (run.input.refs ?? {}) as { docNoteIds?: unknown; docFileIds?: unknown };
  const m = await projectMaterial(run, { files: true, noteIds: strs(refs.docNoteIds), fileIds: strs(refs.docFileIds), answerFiles: true });
  const asked = before(run, "Clarification").map((c) => str(c.Question)).filter(Boolean);
  const setup = setupOf(run.p);
  const approver = setup.approvalOwnerUserId && run.p.members().some((x) => x.userId === setup.approvalOwnerUserId) ? setup.approvalOwnerUserId : "";
  const follow = o.ref !== undefined && o.ref !== null;
  const max = follow ? 1 : (o.max ?? 6);
  const refText = follow ? [str(o.ref!.Question), str(o.ref!.Answer), str(o.ref!.Title), str(o.ref!.Choice), str(o.ref!.Text)].filter(Boolean).join(" — ") : "";
  const prompt = [
    follow
      ? `A person asked for a follow-up question on this point: "${refText}". Write exactly one new question that takes it further.`
      : "Read what the client shared about their product and write the clarifying questions you still need answered before the requirements can be written.",
    "",
    "Rules:",
    follow ? "- Exactly one question." : `- Usually 3 to ${max} questions, the most important first; fewer when the material already answers most things.`,
    "- Exactly one point per question: one sentence, at most 160 characters, no second question added; easy to answer for a business person; no technical words.",
    "- Ask what is really open for this product: who does what, the rules, money (prices, fees, payouts), approvals, limits, what happens when something goes wrong, and the success targets (how many people, how fast).",
    "- Never repeat or rephrase a question already asked, and never ask what the material already answers.",
    '- "source": the tag of the note or file the question comes from, or "" when it comes from the setup answers.',
    '- "forApprover": true only for questions the person who approves the result must answer (priorities, budget, success targets).',
    '- "options": two to four answers the client can pick with one click. Each one is a complete, realistic answer to exactly this question for this product, in its own units and scale (days for a review, a percentage for a fee, a currency amount the material uses for money), at most 60 characters, distinct from each other, the most likely first. Never "Other", "Not sure" or "Later" (the page adds those). Never options that contradict the material.',
    "",
    `Questions already asked:\n${bullets(asked.slice(-25))}`,
    "",
    `Material:\n${m.text}`,
  ].join("\n");
  return aiJson(run, {
    task: follow ? "follow-up question" : "questions",
    role: ANALYST,
    prompt,
    schema: QUESTION_SCHEMA,
    beat: o.beat,
    images: m.images,
    accept: (raw) => acceptQuestions(raw, { requester: run.requester, approver, existing: asked, sources: m.sources, min: follow ? 1 : Math.min(o.fallbackCount, 1), max }),
  });
}

// ------------------------------------------------------------------------------------------------- requirements

export interface RequirementContext {
  sources: Map<string, SourceTag>;
  /** "A1" -> the client's answer or decision (ai/answers.ts): a requirement citing it names it in its SourceRefs. */
  answers?: Map<string, AnswerTag>;
  existing: string[];
  min: number;
  max: number;
}

const tagOf = (s: unknown): string => String(s ?? "").replace(/[[\]\s]/g, "").toUpperCase();

export function acceptRequirements(raw: unknown, c: RequirementContext): PlannedReq[] | null {
  const o = obj(raw);
  if (!o) return null;
  const keys = new Set<string>();
  const out: PlannedReq[] = [];
  for (const x of arr(o.requirements)) {
    const r = obj(x);
    const title = r ? text(r.title, 200, 6) : null;
    if (!r || !title) continue;
    if (c.existing.some((e) => similar(e, title, 0.8)) || out.some((p) => similar(p.Title, title, 0.8))) continue;
    const body = text(r.text, 5000, 10) ?? title;
    const criteria = texts(r.acceptanceCriteria, 4, 500, 6).map((t) => t.replace(/\.$/, ""));
    if (criteria.length < 2) continue;
    let key = slugOf(title.replace(/^(the|a|an)\s+/i, ""), 40);
    for (let n = 2; keys.has(key); n++) key = `${slugOf(title, 36)}-${n}`;
    keys.add(key);
    const refs = [...new Set(arr(r.sources).map((s) => c.sources.get(tagOf(s))?.id ?? c.answers?.get(tagOf(s))?.id).filter((s): s is string => Boolean(s)))];
    out.push({
      local: `req-${out.length}`,
      key,
      Title: title,
      Text: body,
      Category: oneOf(r.category, CATEGORIES) ?? "functional",
      Priority: oneOf(r.priority, PRIORITIES) ?? "must",
      AcceptanceCriteria: criteria,
      SourceRefs: refs,
    });
    if (out.length >= c.max) break;
  }
  return out.length >= c.min ? out : null;
}

const REQUIREMENT_SCHEMA = S.obj({
  requirements: S.list(S.obj({
    title: S.str("Short, at most 80 characters, says what people can do."),
    text: S.str("One to three plain sentences: who, what and why."),
    category: S.enum(CATEGORIES),
    priority: S.enum(PRIORITIES, "must = needed for the first release, nice = should have, later = could wait."),
    acceptanceCriteria: S.list(S.str(), 4, "Two to four short checks a business person can verify."),
    sources: S.list(S.str(), 6, 'Tags of the answers, notes or files it comes from ("A1", "N1", "F1"); every answer it follows is named.'),
  }), 14),
  conflicts: S.list(S.obj({
    answer: S.str('Tag of the client\'s answer ("A1").'),
    point: S.str('What it is about, a few words ("the main button", "the currency").'),
    answerSays: S.str("What the answer says, in its own words, at most 80 characters."),
    other: S.str('Tag of the note, file or other answer that says otherwise ("F1", "N1", "A3").'),
    otherSays: S.str("What that one says, in its own words, at most 80 characters."),
  }), 8, "Every point where an answer and a note, a file or another answer disagree; empty when they agree."),
});

/** A point where the client's answer and a document (or another answer) disagree, as Claude reported it. The
 *  requirements follow the answer; requirements.draft asks the client to confirm it. */
export interface AiConflict {
  /** The answer followed ("Clarification:<id>" or "Decision:<id>"). */
  answerRef: string;
  answerNumber: number;
  answerKind: "clarification" | "decision";
  question: string;
  point: string;
  answerSays: string;
  otherSays: string;
  /** "DocFile:<id>", "DocNote:<id>", "Clarification:<id>"; "" when the tag was not one of the material. */
  otherRef: string;
  otherName: string;
  kind: "document" | "answer";
}

/** The conflicts of Claude's answer that name a real answer and say what both sides say (pure). */
export function acceptConflicts(raw: unknown, c: Pick<RequirementContext, "sources" | "answers">): AiConflict[] {
  const o = obj(raw);
  const out: AiConflict[] = [];
  for (const x of arr(o?.conflicts)) {
    const k = obj(x);
    const a = k ? c.answers?.get(tagOf(k.answer)) : undefined;
    const answerSays = k ? text(k.answerSays, 120, 2) : null;
    const otherSays = k ? text(k.otherSays, 120, 2) : null;
    if (!k || !a || !answerSays || !otherSays || answerSays.toLowerCase() === otherSays.toLowerCase()) continue;
    const doc = c.sources.get(tagOf(k.other));
    const other = doc ? null : c.answers?.get(tagOf(k.other));
    if (other && other.ref === a.ref) continue;
    const prefix = doc ? (doc.type === "doc-file" ? "DocFile" : "DocNote") : "";
    const conflict: AiConflict = {
      answerRef: a.ref, answerNumber: a.number, answerKind: a.kind, question: a.question,
      point: text(k.point, 80, 2) ?? "this point",
      answerSays, otherSays,
      otherRef: doc ? `${prefix}:${doc.id}` : other ? other.ref : "",
      otherName: doc ? (doc.type === "doc-file" ? `the file “${doc.name}”` : `the note “${doc.name}”`) : other ? (other.kind === "decision" ? `your decision ${other.number}` : `your answer to question ${other.number}`) : "the documents",
      kind: other ? "answer" : "document",
    };
    if (out.some((y) => y.answerRef === conflict.answerRef && similar(y.otherSays, conflict.otherSays, 0.8))) continue;
    out.push(conflict);
  }
  return out;
}

/** The rules of every requirements prompt on the client's answers, word for word. */
export const ANSWER_RULES = [
  `- ${ANSWERS_FIRST}`,
  "- Write each requirement the way the answers say, never the document's version of the same point (for example another main button, price, currency, limit or rule).",
  '- Every answer shows up in the requirements: put what it says (its own words and numbers) into the text or an acceptance criterion of the requirement it is about, and name the answer\'s tag ("A1") in that requirement\'s sources.',
  '- List every point where an answer and a note or a file (or two answers) disagree under "conflicts"; the requirements follow the answer, and the client is asked to confirm it.',
];

export interface DraftedRequirements {
  requirements: PlannedReq[];
  conflicts: AiConflict[];
}

/** The requirements (null: keep the built-in plan). `max` 3 is the "a few missing ones" of sanitization.assist. */
export async function aiRequirements(run: JobRun, o: { max: number; fallbackCount: number; beat?: boolean; replacing?: ReadonlySet<string> }): Promise<PlannedReq[] | null> {
  return (await aiDraftRequirements(run, o))?.requirements ?? null;
}

/** The requirements with the conflicts Claude found between the answers and the documents (null: keep the built-in
 *  plan). `fix` names the answers a first draft left out: the second call writes the list again with them. */
export async function aiDraftRequirements(run: JobRun, o: { max: number; fallbackCount: number; beat?: boolean; replacing?: ReadonlySet<string>; fix?: readonly string[] }): Promise<DraftedRequirements | null> {
  const refs = (run.input.refs ?? {}) as { docNoteIds?: unknown; docFileIds?: unknown };
  const m = await projectMaterial(run, { files: true, noteIds: strs(refs.docNoteIds), fileIds: strs(refs.docFileIds), answerFiles: true });
  // a refresh rewrites the drafted requirements nobody edited: they are not "existing", the rest are
  const existing = before(run, "Requirement").filter((r) => r.Status !== "dropped" && !o.replacing?.has(str(r.ItemId))).map((r) => str(r.Title)).filter(Boolean);
  const few = o.max <= 3;
  const instruction = str(run.input.instruction);
  const prompt = [
    few
      ? `Read the material and the requirements written so far, and write up to ${o.max} requirements that are still missing.`
      : o.replacing?.size
        ? "The client has now answered the open questions. Write the first version of the requirements for this product again from the material, so that every answer is in it."
        : "Write the first version of the requirements for this product from the material.",
    "",
    "Rules:",
    few ? `- At most ${o.max}; none when nothing important is missing.` : `- ${Math.min(6, o.max)} to ${o.max} requirements, each one thing people need, in order of importance.`,
    "- Every must-have of the setup becomes a requirement with its priority (must stays must, should becomes nice, could becomes later).",
    "",
    "The client's answers (the tagged answers and decisions in the material):",
    ...ANSWER_RULES,
    o.fix?.length ? `- A first draft did not follow these answers; this time every one of them must be in the requirements, the way the answer says:\n${o.fix.map((f) => `  - ${f}`).join("\n")}` : "",
    "",
    "Writing:",
    '- title: at most 80 characters and says what people can do, e.g. "Sellers upload an asset with its licence and price".',
    "- text: one to three plain sentences: who, what and why.",
    "- acceptanceCriteria: two to four short checks a business person can verify, without technical words.",
    '- Leave out what is listed under "Not included", and do not repeat a requirement that exists already.',
    instruction ? `- The person asked: "${instruction}"` : "",
    "",
    `Requirements that exist already:\n${bullets(existing.slice(0, 40))}`,
    "",
    `Material:\n${m.text}`,
  ].filter((l) => l !== "").join("\n");
  return aiJson(run, {
    task: few ? "missing requirements" : o.fix?.length ? "requirements (every answer)" : "requirements",
    role: ANALYST,
    prompt,
    schema: REQUIREMENT_SCHEMA,
    beat: o.beat,
    images: m.images,
    timeoutMs: 90_000,
    accept: (raw) => {
      const requirements = acceptRequirements(raw, { sources: m.sources, answers: m.answers, existing, min: few || o.fallbackCount === 0 ? 0 : 3, max: o.max });
      return requirements ? { requirements, conflicts: acceptConflicts(raw, { sources: m.sources, answers: m.answers }) } : null;
    },
  });
}

// ------------------------------------------------------------------------------------------------- objective

export interface ObjectivePlan {
  objective: PlannedObjective;
  lookAndFeel: string | null;
  /** The Requirements document's other lists (key workflows, not included, constraints) from the material and the
   *  answers; written as RequirementExtra rows (extras.ts) when the project has none yet. */
  extras: ExtraInput[];
}

/** The key workflows, what is left out and the constraints of Claude's answer, checked like a person's items
 *  (requirementsExtras.ts checkExtra); repeats and anything unusable left out. */
export function acceptExtras(o: Record<string, unknown>): ExtraInput[] {
  const out: ExtraInput[] = [];
  const add = (raw: Parameters<typeof checkExtra>[0]) => {
    const c = checkExtra(raw);
    if (!c.ok || STAGED.test(`${c.value.title} ${c.value.who} ${c.value.steps.join(" ")}`)) return;
    const v = c.value;
    if (out.some((e) => e.kind === v.kind && (e.title.toLowerCase() === v.title.toLowerCase() || similar(e.title, v.title, 0.8)))) return;
    if (out.filter((e) => e.kind === v.kind).length >= 8) return;
    out.push(v);
  };
  for (const x of arr(o.workflows)) {
    const w = obj(x);
    if (!w) continue;
    const steps = texts(w.steps, 8, 200, 2).map((t) => t.replace(/\.$/, ""));
    if (steps.length < 2) continue;
    add({ kind: "workflow", title: text(w.title, 120, 4) ?? "", who: text(w.who, 60, 2) ?? "", steps });
  }
  for (const x of texts(o.notIncluded, 12, 200, 3)) add({ kind: "exclusion", title: x.replace(/\.$/, "") });
  let others = 0;
  for (const x of arr(o.constraints)) {
    const c = obj(x);
    const t = c ? text(c.text, 250, 4) : null;
    if (!c || !t) continue;
    const kind = constraintKindOf(t, oneOf(c.kind, CONSTRAINT_KINDS) ?? "other");
    // "Something else" only for the few fixed rules no kind fits (the currency, the devices)
    if (kind === "other" && ++others > MAX_OTHER) continue;
    add({ kind: "constraint", title: t.replace(/\.$/, ""), constraintKind: kind });
  }
  return out;
}

const MAX_OTHER = 2;
/** The words that say which kind a constraint is, in the order they are tried. */
const KIND_WORDS: readonly [ConstraintKind, RegExp][] = [
  ["deadline", /\b(deadline|go[- ]live|launch(?:es|ed)? (?:by|before|on)|live (?:by|before)|ready (?:by|before)|by (?:the end of )?(?:January|February|March|April|May|June|July|August|September|October|November|December|Q[1-4]|20\d\d))\b/i],
  ["budget", /\b(budget|project cost|costs? at most|spend at most|at most (?:EUR|CHF|USD|GBP|€|\$|£) ?\d[\d,. ]*(?:k|000)? (?:for|to build))\b/i],
  ["compliance", /\b(VAT|GST|sales tax|tax(?:es)?|GDPR|DSGVO|revDSG|nDSG|data protection|privacy|personal data|laws?|legal|regulat\w*|licen[cs]e (?:terms|text)|consumer|refunds?|withdrawal|KYC|AML|PCI|WCAG|accessib\w*|retention|kept for \d+ years|audit)\b/i],
  ["languages", /\b(English|German|French|Italian|Spanish|Portuguese|Dutch|Bengali|Bangla|Hindi|Arabic|languages?|translat\w*|multilingual|locali[sz]\w*)\b/i],
  ["integrations", /\b(Stripe|PayPal|TWINT|Adyen|Klarna|card payments?|pays? by card|payment (?:provider|gateway|service)|API|integrat\w*|connect(?:s|ed|ion)? (?:to|with)|ERP|CRM|SSO|single sign-on|Microsoft 365|Google Workspace|Slack|e-?mail (?:service|provider)|accounting (?:system|software)|bexio|Xero|SAP|webhooks?)\b/i],
];

/** The kind of a constraint: Claude's own kind when it names one, else the kind its words say, else "other" (pure). */
export function constraintKindOf(text: string, given: ConstraintKind): ConstraintKind {
  if (given !== "other") return given;
  for (const [kind, words] of KIND_WORDS) if (words.test(text)) return kind;
  return "other";
}

export function acceptObjective(raw: unknown): ObjectivePlan | null {
  const o = obj(raw);
  if (!o) return null;
  const statement = text(o.statement, 600, 20);
  const criteria = texts(o.acceptanceCriteria, 3, 300, 6).map((t) => t.replace(/\.$/, ""));
  const high = markdown(o.highLevelMd, 8000, 40);
  const arch = markdown(o.architectureMd, 6000, 30);
  if (!statement || criteria.length < 2 || !high || !arch || !/^## /m.test(high)) return null;
  return {
    objective: { Statement: /[.!?]$/.test(statement) ? statement : `${statement}.`, AcceptanceCriteria: criteria, HighLevelMd: high, ArchitectureMd: arch },
    lookAndFeel: text(o.lookAndFeel, 2000, 30),
    extras: acceptExtras(o),
  };
}

const OBJECTIVE_SCHEMA = S.obj({
  statement: S.str("One or two sentences: what the product achieves and for whom."),
  acceptanceCriteria: S.list(S.str(), 3, "Two or three results that show the objective is met."),
  highLevelMd: S.str('Markdown with "## " sections: Goal, Users, Key workflows, Not included, Constraints, Approval (only those the material supports), each with short "- " bullets.'),
  architectureMd: S.str('Markdown with "## " sections: Components, Connections, Hosting, Quality targets (only those that apply), in plain words a business owner understands.'),
  lookAndFeel: S.str("Two or three sentences on the look and feel of the screens: for whom, on which devices, the tone."),
  workflows: S.list(S.obj({
    title: S.str("The workflow's name, at most 80 characters, e.g. \"A creator lists a new asset\"."),
    who: S.str("Who does it, a few words (\"Creator\", \"Marketplace team\")."),
    steps: S.list(S.str(), 8, "Three to six short steps in order, each one plain sentence."),
  }), 6, "The key workflows the material describes (who does what, step by step), the most important first."),
  notIncluded: S.list(S.str(), 12, "What the first version does not do, one item each, in the material's words: every item of its own list (\"not in the first release\", \"out of scope\", \"not included\", \"later\") and what the answers leave out."),
  constraints: S.list(S.obj({
    kind: S.enum(CONSTRAINT_KINDS, "deadline: a date or time limit; budget: money for building it; compliance: laws, tax and VAT, data protection, licence terms, consumer rights such as refund periods; languages: the languages of the screens and texts; integrations: systems it connects to (payment providers, e-mail, accounting, sign-in); other: only a fixed rule none of these fits (the currency, the devices)."),
    text: S.str("The constraint in the material's words, one line."),
  }), 8, "What the product must respect from outside, each with the kind that fits; \"other\" at most twice."),
});

/** The objective with its high-level description and architecture outline, and the first look & feel. */
export async function aiObjective(run: JobRun, o: { beat?: boolean } = {}): Promise<ObjectivePlan | null> {
  // the files whole (a brief's out-of-scope list and key numbers often come last)
  const m = await projectMaterial(run, { files: true, fileMax: 9000, budget: 14000, answerFiles: true });
  const prompt = [
    "Write the objective of this product for the requirements document, from the material.",
    "",
    "Rules:",
    "- statement: one or two sentences, what it achieves and for whom. Where the client gave the goal in their own words (Goal above, their answer about the main objective), the statement says that goal.",
    "- acceptanceCriteria: two or three results that show it works (for example adoption or time saved), measurable where the material allows.",
    "- highLevelMd and architectureMd: Markdown, \"## \" headings and short \"- \" bullets, plain words, no code, no product names of tools unless the material names them.",
    "- lookAndFeel: two or three sentences for the designer.",
    `- ${ANSWERS_FIRST} The statement, the lists and the outline say what the answers say.`,
    "- workflows, notIncluded, constraints: the lists of the requirements document, only from the material and the answered questions; leave a list empty when the material says nothing about it.",
    "- notIncluded: every item the material lists as not in the first release, out of scope, not included or for later goes in, one item each (a list of six gives six items).",
    "- constraints: what the product must respect from outside, with the kind that fits (deadline, budget, compliance for laws, tax, VAT, data protection and refund rights, languages, integrations for payment providers and other systems); \"other\" at most twice, for the currency or the devices. The business rules the product carries out itself (commission split, payout schedule, minimum payout, price and file limits) are requirements, not constraints: leave them out. Keep the material's numbers and names.",
    "",
    `Material:\n${m.text}`,
  ].join("\n");
  return aiJson(run, { task: "objective", role: PM, prompt, schema: OBJECTIVE_SCHEMA, beat: o.beat, images: m.images, accept: acceptObjective });
}

// ------------------------------------------------------------------------------------------------- technical decisions

const ARCHITECT = "You are the solution architect of the product team.";
const TECH_AREAS: readonly Area[] = ["stack", "architecture", "integration", "nfr", "security", "data", "hosting", "other"];
const NFR_CATEGORIES = ["performance", "security", "availability", "scalability", "accessibility", "privacy", "compliance", "operability", "other"] as const;

export interface TechContext {
  /** Titles of the technical decisions that exist (not rejected). */
  existing: string[];
  /** Areas that have a decision already (left out unless `area` asks for one). */
  decidedAreas: ReadonlySet<string>;
  /** Only this area (a follow-up on a decision), else any. */
  area?: string;
  min: number;
  max: number;
}

export function acceptTech(raw: unknown, c: TechContext): PlannedTech[] | null {
  const o = obj(raw);
  if (!o) return null;
  const out: PlannedTech[] = [];
  for (const x of arr(o.decisions)) {
    const t = obj(x);
    const area = t ? oneOf(t.area, TECH_AREAS) : null;
    const title = t ? text(t.title, 120, 6) : null;
    const choice = t ? text(t.choice, 500, 12) : null;
    const rationale = t ? text(t.rationale, 1200, 20) : null;
    if (!t || !area || !title || !choice || !rationale) continue;
    if (c.area ? area !== c.area : c.decidedAreas.has(area) && area !== "integration") continue;
    if (c.existing.some((e) => similar(e, title, 0.7)) || out.some((p) => similar(p.Title, title, 0.7))) continue;
    let nfrCategory = "";
    let nfrTarget = "";
    let system = "";
    if (area === "nfr") {
      nfrCategory = oneOf(t.nfrCategory, NFR_CATEGORIES) ?? "";
      nfrTarget = text(t.nfrTarget, 300, 4) ?? "";
      if (!nfrCategory || !nfrTarget) continue;
    } else if (area === "integration") {
      system = text(t.integrationSystem, 120, 2) ?? "";
      if (!system) continue;
    }
    out.push({
      local: c.area ? "t-follow-up" : `t-ai-${out.length}`,
      Area: area,
      Title: title,
      Choice: choice,
      Rationale: rationale,
      Alternatives: texts(t.alternatives, 3, 200, 4),
      NfrCategory: nfrCategory,
      NfrTarget: nfrTarget,
      IntegrationSystem: system,
    });
    if (out.length >= c.max) break;
  }
  return out.length >= c.min ? out : null;
}

const TECH_SCHEMA = S.obj({
  decisions: S.list(S.obj({
    area: S.enum(TECH_AREAS),
    title: S.str("The decision in a few words, at most 80 characters."),
    choice: S.str("What we propose, one or two plain sentences, concrete for this product."),
    rationale: S.str("Why, two or three plain sentences tied to what the client said (users, volumes, money, files, connections)."),
    alternatives: S.list(S.str(), 3, "Two other options that were weighed, a few words each."),
    nfrCategory: S.str('Only for area "nfr": one of performance, security, availability, scalability, accessibility, privacy, compliance, operability, other; else "".'),
    nfrTarget: S.str('Only for area "nfr": the measurable target, e.g. "Search answers within 1 second for 95% of searches"; else "".'),
    integrationSystem: S.str('Only for area "integration": the other system, e.g. "Stripe Connect"; else "".'),
  }), 6),
});

/** The proposed technical decisions (null: keep the built-in plan). `area` and `question` shape a follow-up. */
export async function aiTech(run: JobRun, o: { max: number; fallbackCount: number; area?: string; question?: string; ref?: Row | null }): Promise<PlannedTech[] | null> {
  const refs = (run.input.refs ?? {}) as { docNoteIds?: unknown; docFileIds?: unknown };
  const m = await projectMaterial(run, { files: true, noteIds: strs(refs.docNoteIds), fileIds: strs(refs.docFileIds), budget: 6000, answerFiles: true });
  const all = before(run, "TechDecision").filter((t) => t.Status !== "rejected");
  const existing = all.map((t) => str(t.Title)).filter(Boolean);
  const decidedAreas = new Set(all.map((t) => str(t.Area)));
  const p = run.p;
  const repo = p.repo.owner && p.repo.name ? `${p.repo.owner}/${p.repo.name}` : p.repo.name;
  const follow = Boolean(o.area || o.question);
  const prompt = [
    follow
      ? `A person asked for another technical proposal${o.area ? ` in the area "${o.area}"` : ""}${o.question ? `: "${o.question}"` : ""}${o.ref ? ` (about "${str(o.ref.Title)}: ${str(o.ref.Choice)}")` : ""}. Write exactly one proposal.`
      : `Propose the technical decisions ${p.name} needs before the requirements are written, for the areas that have no decision yet.`,
    "",
    "Rules:",
    follow ? "- Exactly one proposal, different from the decisions that exist." : `- ${Math.min(3, o.max)} to ${o.max} proposals, one per area, the most important first: how it is built (stack), connections to other systems the material names (payments, payouts, e-mail, accounting), the main quality target with a number, security and personal data, hosting.`,
    p.existingProduct
      ? `- This changes an existing product${repo ? ` (code in ${repo})` : ""}: extend what is there instead of rebuilding.`
      : "- A new product, built on SELISE Blocks (sign-in and roles, Data Gateway for the records with access per role, Storage for files, Mail for e-mails); name other services only where the material needs them (for example a payment provider).",
    "- Every proposal is specific to this product and the material: its users, its money flows, its files, its volumes. No generic text that fits any product.",
    "- The answered questions and the decisions in the material are settled: build on them, never against them.",
    "- Plain words a business owner understands; a technical name only where it is the decision (a provider, a format).",
    "",
    `Technical decisions that exist (do not repeat):\n${bullets(all.map((t) => `[${str(t.Area)}] ${str(t.Title)}: ${str(t.Choice)}`).slice(0, 20))}`,
    "",
    `Material:\n${m.text}`,
  ].join("\n");
  return aiJson(run, {
    task: follow ? "technical follow-up" : "technical decisions",
    role: ARCHITECT,
    prompt,
    schema: TECH_SCHEMA,
    images: m.images,
    accept: (raw) => acceptTech(raw, { existing, decidedAreas, area: o.area, min: follow ? 1 : Math.min(2, Math.max(1, o.fallbackCount)), max: follow ? 1 : o.max }),
  });
}
