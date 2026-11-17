// sanitization.assist, focus "clarifications": the open questions a business analyst would raise after reading the
// notes and files: the notes' own open points first, then what the notes leave unsaid about uploads, expiry,
// sign-in, approvals, integrations, limits and the like. Nothing already asked or decided is asked again.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { JobRun } from "../../run.ts";
import { str } from "../../context.ts";
import { clip, question, wordsOf } from "../../text.ts";
import { mainActor, readFacts, type Fact, type Facts } from "./facts.ts";
import { SETUP_QUESTIONS_PER_READING, setupGaps, setupOf } from "./setup.ts";
import { before, similar } from "./own.ts";
import { ctxFor, productNounOf, TOPICS, topicsOf, type Topic } from "./topics.ts";

export interface PlannedQuestion {
  local: string;
  question: string;
  sourceType: "doc-note" | "doc-file" | "engine";
  sourceRef: string;
  owner: string;
  topic: string;
  /** Two to four one-click answers that fit this question (Claude writes them with the question); none for the
   *  built-in plan, whose questions the page answers from their wording (answerOptions.ts). */
  options?: string[];
}

/** Turns an open point of a note into a clean question. */
export function openPointAsQuestion(text: string): string {
  let t = text.trim().replace(/^(open|question|unclear|to clarify|tbd)\s*[:\-–]\s*/i, "");
  t = t.replace(/\s*\(([^)]*)\)\s*$/, " ($1)");
  return question(t);
}

function existingTexts(run: JobRun): { texts: string[]; words: Set<string>[] } {
  const texts: string[] = [];
  for (const c of before(run, "Clarification")) texts.push(`${str(c.Question)} ${str(c.Answer)}`);
  for (const d of before(run, "Decision")) if (d.Status !== "rejected") texts.push(`${str(d.Title)} ${str(d.Statement)}`);
  return { texts, words: texts.map((t) => wordsOf(t)) };
}

function coveredBy(topic: Topic, existing: string[]): boolean {
  return existing.some((t) => topic.match.test(t));
}

function sourceOf(f: Fact | null, facts: Facts, run: JobRun): Pick<PlannedQuestion, "sourceType" | "sourceRef" | "owner"> {
  if (f && f.source.type === "doc-note") return { sourceType: "doc-note", sourceRef: f.source.id, owner: f.source.by || run.requester };
  // A question about a file's subject points at the file.
  if (f) {
    const file = facts.files.find((x) => similar(x.name, f.text, 0.5));
    if (file) return { sourceType: "doc-file", sourceRef: file.id, owner: file.by || run.requester };
  }
  return { sourceType: "engine", sourceRef: "", owner: run.requester };
}

/** The questions to write, in order (3 to 6, fewer when the notes are already well covered). */
export function planQuestions(run: JobRun, o?: { only?: string; max?: number }): PlannedQuestion[] {
  const refs = (run.input.refs ?? undefined) as { docNoteIds?: unknown; docFileIds?: unknown } | undefined;
  const facts = readFacts(run.p, refs);
  const ex = existingTexts(run);
  const out: PlannedQuestion[] = [];
  const usedTopics = new Set<string>();
  const productNoun = productNounOf(run.p.name, run.p.brief);
  const region = str(run.p.project.ClientRegion);
  const max = o?.max ?? 6;
  const dup = (q: string) => {
    const w = wordsOf(q);
    return ex.words.some((e) => similar(w, e, 0.55)) || out.some((p) => similar(w, p.question, 0.55));
  };

  // 1. The notes' own open points, as they were written.
  for (const f of facts.lines) {
    if (out.length >= max) break;
    if (f.kind !== "open" || f.source.type === "brief") continue;
    const q = openPointAsQuestion(f.text);
    if (q.length < 12 || dup(q)) continue;
    for (const t of topicsOf(q)) usedTopics.add(t.id);
    out.push({ local: `q-open-${out.length}`, question: clip(q, 2000), ...sourceOf(f, facts, run), topic: "open" });
  }

  // 2. What the setup leaves open, as the product manager asks it before the scope is locked: what it should achieve
  //    and for whom, what should change, then the success and performance targets ("how many", "how fast").
  const setup = setupOf(run.p);
  const approver = setup.approvalOwnerUserId && run.p.members().some((m) => m.userId === setup.approvalOwnerUserId) ? setup.approvalOwnerUserId : "";
  const todayMeasure = facts.lines.find((l) => l.kind === "today" && /\d/.test(l.text))?.text ?? null;
  const actor = mainActor(facts);
  let fromSetup = 0;
  for (const g of setupGaps(setup, {
    productNoun, client: run.p.client, existing: run.p.existingProduct, all: facts.all, actor,
    todayMeasure, wishes: facts.lines.filter((l) => l.kind === "wish").length,
  })) {
    if (out.length >= max || fromSetup >= SETUP_QUESTIONS_PER_READING) break;
    if (o?.only && `setup-${g.id}` !== o.only) continue;
    if (ex.texts.some((t) => g.match.test(t)) || dup(g.question)) continue;
    fromSetup += 1;
    out.push({ local: `q-setup-${g.id}`, question: g.question, sourceType: "engine", sourceRef: "", owner: g.owner === "approver" && approver ? approver : run.requester, topic: `setup-${g.id}` });
  }

  // 3. What the lines touch on but do not settle. A constraint, an agreement or an exclusion already settles its topic
  //    ("Must stay in our data centre" answers where the data is hosted).
  const settledTopics = new Set<string>();
  for (const f of facts.lines) if (f.kind === "constraint" || f.kind === "agreed" || f.kind === "excluded") for (const t of topicsOf(f.text)) if (t.id !== "deadline") settledTopics.add(t.id);
  const candidates: { topic: Topic; fact: Fact }[] = [];
  for (const f of facts.lines) {
    if (f.kind === "open" || f.kind === "constraint" || f.kind === "agreed" || f.kind === "excluded") continue;
    for (const t of topicsOf(f.text)) if (!settledTopics.has(t.id) && !candidates.some((c) => c.topic.id === t.id)) candidates.push({ topic: t, fact: f });
  }
  // Lines that already state the answer (numbers, choices) make weaker questions: those come last.
  const settled = (c: { topic: Topic; fact: Fact }) => (/\d/.test(c.fact.text) && c.topic.id !== "reminder" && c.topic.id !== "deadline" ? 1 : 0);
  candidates.sort((a, b) => settled(a) - settled(b));
  for (const c of candidates) {
    if (out.length >= max) break;
    if (o?.only && c.topic.id !== o.only) continue;
    if (usedTopics.has(c.topic.id) || coveredBy(c.topic, ex.texts)) continue;
    const q = c.topic.question(ctxFor(facts, c.fact.text, { productNoun, region }));
    if (dup(q)) continue;
    usedTopics.add(c.topic.id);
    out.push({ local: `q-${c.topic.id}`, question: clip(q, 2000), ...sourceOf(c.fact, facts, run), topic: c.topic.id });
  }

  // 4. What every project of this kind must settle, when the notes are silent about it.
  if (out.length < 3) {
    for (const t of TOPICS.filter((x) => x.projectWide)) {
      if (out.length >= Math.max(3, Math.min(max, 4))) break;
      if (o?.only && t.id !== o.only) continue;
      if (usedTopics.has(t.id) || coveredBy(t, ex.texts) || !t.projectWide!(facts, region)) continue;
      const q = t.question(ctxFor(facts, "", { productNoun, region }));
      if (dup(q)) continue;
      usedTopics.add(t.id);
      out.push({ local: `q-${t.id}`, question: q, sourceType: "engine", sourceRef: "", owner: run.requester, topic: t.id });
    }
  }
  return out;
}

/** One question answering a person's request about a record ("refId" / "question" of the input). */
export function planFollowUp(run: JobRun, ref: Row | null, asked: string): PlannedQuestion[] {
  const facts = readFacts(run.p);
  const base = asked || `${str(ref?.Question)} ${str(ref?.Title)} ${str(ref?.Choice)}`;
  const topic = topicsOf(base)[0];
  const productNoun = productNounOf(run.p.name, run.p.brief);
  let q: string;
  if (asked) q = question(asked);
  else if (topic) q = topic.question(ctxFor(facts, base, { productNoun, region: str(run.p.project.ClientRegion) }));
  else q = question(`Is ${clip(base.trim(), 160).replace(/[?.]+$/, "")} still current, and who confirms it`);
  return [{ local: "q-follow-up", question: clip(q, 2000), sourceType: "engine", sourceRef: "", owner: str(ref?.OwnerUserId) || run.requester, topic: topic?.id ?? "follow-up" }];
}
