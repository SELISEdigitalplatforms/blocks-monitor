// The client's answers win over the documents (engine-context/answers.ts, facts.ts; kinds/analysis/followAnswers.ts):
// the facts take the answer's value and keep the difference as a conflict; the prompts carry the answers as their own
// block before the documents; requirements.draft checks that every answer is in the requirements (asking Claude once
// more, else adding the answer as a criterion), and asks the client to confirm each conflict. The cases: the landing
// page whose client answered "Download the app" while the PDF brief says "Join the Waitlist", and a currency.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/answersFirst.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createEngine } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import { readLedger } from "../../server/engine-context/store.ts";
import { assertRowValid } from "../../functions/_lib/testing";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { checkAnswers, checkLine, confirmedIdOf, conflictLocalKey, conflictQuestion, effectiveAnswers, keyFactsOf, reflects, type AnswerItem } from "../../server/engine-context/answers.ts";
import { answerFactsOf, factsLine, factsRules, projectFactsIn, resolveProjectFacts, type FactAnswer } from "../../server/engine-context/facts.ts";
import { answersBlock } from "../../server/local/engine/ai/answers.ts";
import { mergeConflicts } from "../../server/local/engine/kinds/analysis/followAnswers.ts";
import type { AiConflict } from "../../server/local/engine/kinds/analysis/ai.ts";
import type { FactConflict } from "../../server/engine-context/facts.ts";
import { currencyRule } from "../../server/local/engine/kinds/scope/designAi.ts";
import type { ContextFile } from "../../server/engine-context/store.ts";
import { makeWorld, type World } from "./harness";

// These tests drive the focused AI calls; the planner agent mode (analysis/agent.ts) is off here, as on a host without
// the official engine's planner AGENT.md.
vi.mock("../../server/local/engine/kinds/analysis/agent.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), hasAgentPlanner: () => false }));


const s = (v: unknown) => (typeof v === "string" ? v : "");
const props = (r: AiRequest): string[] => Object.keys((r.schema as { properties?: object }).properties ?? {});

// the owner's PDF brief as its extraction reads it (the parts about the main action)
const BRIEF_PDF = `# client-brief.pdf

## Page 1

CLIENT REQUIREMENTS / AR + AI STARTUP
01 Project objective
Create a premium, dark-mode landing page for a tech startup combining augmented reality (AR) with
artificial intelligence (AI). Attract AR users globally, explain the product quickly, and encourage visitors to
join the waitlist.
Background
#080B12
Primary CTA
#7C3AED
04 Positioning and primary action
Proposed headline: "Experience a smarter layer of reality."
Primary CTA: "Join the Waitlist". Secondary CTA: "See How It Works".
Working assumption: A prelaunch product with English as the initial site language.

## Page 2

05 Required sections, in order
Header Logo, anchor links to Experience, How It Works and FAQ, plus the main CTA. Use a sticky
header and a compact mobile menu.
Final CTA + footer Repeat the waitlist CTA and form.
06 Interactions and signup
The main CTA scrolls to the waitlist form; the secondary CTA opens the product experience section. Collect
email only, validate entries, prevent duplicate submissions and display clear success or error messages.`;

const QUESTIONS: [string, string][] = [
  ["What is the main action you want a visitor to take on the page?", "Download the app"],
  ["Which AR devices should the product and page talk about first?", "Phones and tablets"],
  ["Which details should we collect from visitors who sign up?", "Email address only"],
  ["Which languages should the page be shown in at launch?", "English only"],
  ["How many visitors a month do you expect in the first three months?", "100"],
  ["How many visitors should sign up for the page to count as a success?", "2% of visitors"],
];
const items = (ids: string[] = QUESTIONS.map((_, i) => `q${i + 1}`)): AnswerItem[] =>
  QUESTIONS.map(([question, answer], i) => ({ ref: `Clarification:${ids[i]}`, number: i + 1, question, answer, status: "answered", answeredAt: `2026-11-01T01:3${i}:00.000Z` }));
const asFacts = (list: AnswerItem[]): FactAnswer[] => effectiveAnswers(list).map((a) => ({ ref: a.ref, number: a.number, question: a.question, answer: a.answer }));
const PDF_DOC = { text: BRIEF_PDF, ref: "DocFile:0b7e1c2d-4f5a-4b6c-8d7e-9f0a1b2c3d4e", name: "the file “client-brief.pdf”" };

// what the live draft wrote: everything from the PDF (the waitlist), the answers' other facts in it
const WAITLIST_DRAFT = [
  "Visitors join the waitlist with their email\nVisitors leave just their email address to join the waitlist.\nOnly the email address is asked for",
  "The page explains the AR and AI product quickly\nVisitors on phones and tablets understand the product within seconds.",
  "The page is in English\nThe page is shown in English only at launch.",
  "The team can see whether 2% of visitors sign up\nThe team checks signups against visits; about 100 visitors a month are expected in the first three months.",
];

describe("the client's answers win over the documents (pure)", () => {
  it("the landing page: the answer's main action wins over the PDF's, and the difference is kept as a conflict", () => {
    // the PDF alone says "Join the Waitlist" (its colour row "Primary CTA #7C3AED" is not an action)
    expect(projectFactsIn([BRIEF_PDF]).primaryAction).toBe("Join the Waitlist");
    expect(answerFactsOf(QUESTIONS[0]![0], QUESTIONS[0]![1])).toEqual({ primaryAction: "Download the app" });
    for (const [q, a] of QUESTIONS.slice(1)) expect(answerFactsOf(q, a)).toEqual({});

    const r = resolveProjectFacts({ answers: asFacts(items()), documents: [{ text: "To attract AR audiences, dark mode theme", name: "the project setup" }, PDF_DOC] });
    expect(r.facts.primaryAction).toBe("Download the app");
    expect(r.fromAnswers).toEqual(["primaryAction"]);
    expect(r.conflicts).toEqual([{
      fact: "primaryAction", label: "the main call to action", kind: "document", answerRef: "Clarification:q1", answerNumber: 1, answerKind: "question", question: QUESTIONS[0]![0],
      answer: "Download the app", other: "Join the Waitlist", otherRef: PDF_DOC.ref, otherName: PDF_DOC.name,
    }]);
    // the design screens and the build get the same main action (factsRules is shared by both)
    expect(factsRules(r.facts).join("\n")).toContain('- Main call to action: "Download the app". The main button and every main call to action say exactly this');
    expect(currencyRule({ currency: "", facts: r.facts })).toContain('Main call to action: "Download the app"');
    expect(factsLine(r.facts)).toBe('main call to action "Download the app"');
  });

  it("the check finds the answer the waitlist draft left out, and the question says what we followed", () => {
    const answers = effectiveAnswers(items());
    const conflicts = [{ answerRef: "Clarification:q1", label: "the main call to action", answer: "Download the app", other: "Join the Waitlist", otherName: PDF_DOC.name }];
    const c = checkAnswers({ step: "requirements", answers, texts: WAITLIST_DRAFT, conflicts });
    expect(c.items.map((i) => [i.number, i.status])).toEqual([[1, "conflict"], [2, "reflected"], [3, "reflected"], [4, "reflected"], [5, "reflected"], [6, "reflected"]]);
    expect(c.items[0]!.missing).toEqual(["download", "app"]);
    expect(c.ok).toBe(false);
    expect(checkLine(c)).toBe("5 of 6 answers are in the requirements; not yet: Q1; 1 answer differs from the documents (the answer is followed)");
    // a draft that follows the answer passes
    const ok = checkAnswers({ step: "requirements", answers, texts: [...WAITLIST_DRAFT, "Visitors download the app from the main button"], conflicts });
    expect(ok.ok).toBe(true);

    const q = conflictQuestion({ kind: "document", label: "the main call to action", answerNumber: 1, answer: "Download the app", other: "Join the Waitlist", otherName: PDF_DOC.name });
    expect(q.question).toBe("Your answer to question 1 says “Download the app” for the main call to action, but the file “client-brief.pdf” says “Join the Waitlist”. We followed your answer. Which one is right?");
    expect(q.options).toEqual(["Download the app", "Join the Waitlist"]);
  });

  it("the client's reply to the conflict question replaces the answer: the PDF's action then stands, without a conflict", () => {
    const id = "074ed5a5-7ae7-474b-87bb-b092b46f3c14";
    const key = capKey(`engine:job-1:1:${conflictLocalKey(id, "Download the app", "Join the Waitlist")}`);
    expect(confirmedIdOf(key)).toBe(id);
    expect(confirmedIdOf("engine:job-1:1:req-3")).toBe("");
    const list = items([id, "b", "c", "d", "e", "f"]);
    const reply: AnswerItem = { ref: "Clarification:reply", number: 7, question: "Your answer to question 1 says …", answer: "Join the Waitlist", status: "answered", answeredAt: "2026-11-01T02:00:00.000Z", confirms: `Clarification:${id}` };
    const eff = effectiveAnswers([...list, reply]);
    expect(eff.map((a) => a.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(eff[0]).toMatchObject({ answer: "Join the Waitlist", firstAnswer: "Download the app", confirmedIn: 7 });
    const r = resolveProjectFacts({ answers: asFacts([...list, reply]), documents: [PDF_DOC] });
    expect(r.facts.primaryAction).toBe("Join the Waitlist");
    expect(r.conflicts).toEqual([]);
    // "keep my answer": the answer stays, confirmed
    expect(effectiveAnswers([...list, { ...reply, answer: "Download the app" }])[0]).toMatchObject({ answer: "Download the app", confirmedIn: 7 });
    expect(effectiveAnswers([...list, { ...reply, answer: "Download the app" }])[0]!.firstAnswer).toBeUndefined();
  });

  it("the currency: the answer wins over the brief's CHF (design and build both say EUR); two answers that differ are a conflict too", () => {
    const brief = { text: "Plans and prices\nAll prices are in CHF. The basic plan costs CHF 49 per month and includes 8.1% VAT.", ref: "DocNote:n1", name: "the note “Pricing”" };
    const answers: FactAnswer[] = [
      { ref: "Clarification:c1", number: 1, question: "Which currency should prices be shown in?", answer: "Euros (EUR)" },
      { ref: "Clarification:c2", number: 2, question: "Which VAT rate applies, and is it in the prices shown?", answer: "19%, included in the prices" },
    ];
    expect(projectFactsIn([brief.text]).currency).toBe("CHF");
    const r = resolveProjectFacts({ answers, documents: [brief], currency: "CHF" });
    expect(r.facts.currency).toBe("EUR");
    expect(r.facts.tax).toEqual({ name: "VAT", percent: 19, included: true });
    expect(r.conflicts.map((c) => [c.fact, c.answer, c.other, c.otherName])).toEqual([
      ["currency", "EUR", "CHF", "the note “Pricing”"],
      ["tax", "VAT 19%, included in the prices", "VAT 8.1%", "the note “Pricing”"],
    ]);
    expect(factsRules(r.facts)[0]).toBe('- Currency: EUR. Every price, fee, payout and amount is in EUR, written like "€24.00"; no other currency anywhere.');
    expect(currencyRule({ currency: r.facts.currency!, facts: r.facts })).toMatch(/is in EUR, the currency the material uses/);
    expect(currencyRule({ currency: r.facts.currency!, facts: r.facts })).toMatch(/VAT: 19%, included in the prices shown/);

    // a later answer on the same point wins, and the difference is listed (the newer answer is followed)
    const two = resolveProjectFacts({ answers: [...answers, { ref: "Clarification:c3", number: 3, question: "In which currency are the payouts made?", answer: "CHF" }], documents: [] });
    expect(two.facts.currency).toBe("CHF");
    expect(two.conflicts.find((c) => c.kind === "answer")).toMatchObject({ fact: "currency", answer: "CHF", other: "EUR", otherName: "your answer to question 1", answerNumber: 3 });
  });

  it("one disagreement found twice (the project facts and Claude's draft) is asked about once", () => {
    const answers = [{ ref: "Clarification:c4", number: 4, question: "Should the menu list allergens or dietary labels?", answer: "Only vegan and vegetarian labels. Important: show all menu prices in EUR, not CHF." }];
    const facts = [{ fact: "currency", label: "the currency", kind: "document", answerRef: "Clarification:c4", answerNumber: 4, answerKind: "question", question: answers[0]!.question, answer: "EUR", other: "CHF", otherRef: "DocFile:f1", otherName: "the file “cafe-brief.md”" }] as unknown as FactConflict[];
    const drafted: AiConflict[] = [
      { answerRef: "Clarification:c4", answerNumber: 4, answerKind: "clarification", question: answers[0]!.question, point: "the currency for menu prices", answerSays: "Show all menu prices in EUR, not CHF", otherSays: "All prices are shown in CHF", otherRef: "DocFile:f1", otherName: "the file “cafe-brief.md”", kind: "document" },
      // a different point of the same answer and file stays its own conflict
      { answerRef: "Clarification:c4", answerNumber: 4, answerKind: "clarification", question: answers[0]!.question, point: "the diet labels", answerSays: "Only vegan and vegetarian labels", otherSays: "Every allergen is listed", otherRef: "DocFile:f1", otherName: "the file “cafe-brief.md”", kind: "document" },
    ];
    const merged = mergeConflicts(answers, facts, drafted);
    expect(merged.map((c) => [c.label, c.answer, c.other, c.found])).toEqual([
      ["the currency", "EUR", "CHF", "facts"],
      ["the diet labels", "Only vegan and vegetarian labels", "Every allergen is listed", "draft"],
    ]);
  });

  it("key facts: numbers must be there, short answers word for word, longer ones mostly", () => {
    expect(keyFactsOf("2% of visitors")).toEqual({ numbers: ["2%"], words: ["visitor"] });
    expect(reflects(keyFactsOf("2% of visitors"), "at least 2 percent of the visitors").ok).toBe(true);
    expect(reflects(keyFactsOf("About 1,000 orders a month"), "around 1000 orders each month").ok).toBe(true);
    expect(reflects(keyFactsOf("Email address only"), "Visitors give their e-mail address").ok).toBe(true);
    expect(reflects(keyFactsOf("Download the app"), "Join the waitlist").ok).toBe(false);
    expect(checkAnswers({ step: "requirements", answers: [{ ref: "Clarification:x", number: 9, question: "Is that right?", answer: "Yes" }], texts: [] }).items[0]!.status).toBe("unchecked");
  });

  it("the prompt block: the answers first, stated as overriding the documents, with tags and the conflicts", () => {
    const r = resolveProjectFacts({ answers: asFacts(items()), documents: [PDF_DOC] });
    const ctx = {
      sections: {
        basics: { factConflicts: r.conflicts },
        clarifications: [...items(), { ref: "Clarification:q9", number: 9, question: "Who writes the FAQ answers?", answer: "", status: "deferred", deferReason: "Not sure yet" }],
        decisions: { decisions: [{ ref: "Decision:d1", number: 1, title: "Hosting", statement: "The page is hosted in the EU.", status: "accepted" }] },
      },
    } as unknown as ContextFile;
    const b = answersBlock(ctx);
    expect(b.text).toMatch(/^The client's answers and decisions \(The client's answers and decisions come first: they override the notes, the files and what was read from them\. Where a document says something else, follow the answer/);
    expect(b.text).toContain("[A1] Question 1: What is the main action you want a visitor to take on the page?\nAnswer: Download the app");
    expect(b.text).toContain("[A7] Decision 1: Hosting: The page is hosted in the EU.");
    expect(b.text).toContain('- the main call to action: your answer to question 1 says "Download the app"; the file “client-brief.pdf” says "Join the Waitlist". Follow the answer.');
    expect(b.text).toContain("Questions set aside, not answered yet (decide nothing on them; say what is still open):\n- Question 9: Who writes the FAQ answers? (Not sure yet)");
    expect(b.tags.get("A1")).toMatchObject({ ref: "Clarification:q1", id: "q1", kind: "clarification" });
    expect(b.tags.get("A7")).toMatchObject({ ref: "Decision:d1", kind: "decision" });
  });
});

// ------------------------------------------------------------------------------------------------- requirements.draft

const NOTE = BRIEF_PDF.replace(/^# .*\n/, "");

/** The draft Claude wrote on DEV (the waitlist everywhere); `followed` when the prompt says the answers were left out. */
function waitlist(followed: boolean) {
  return {
    requirements: [
      followed
        ? { title: "Visitors download the app from the main button", text: "The main button asks visitors to download the app; the page leads every visitor there.", category: "functional", priority: "must", acceptanceCriteria: ["The main button says Download the app", "Every section ends with the same button"], sources: ["A1", "N1"] }
        : { title: "Visitors join the waitlist with their email", text: "Visitors leave just their email address to join the waitlist.", category: "functional", priority: "must", acceptanceCriteria: ["Only the email address is asked for", "A clear success message shows after signing up"], sources: ["N1"] },
      { title: "The page explains the AR and AI product quickly", text: "Visitors on phones and tablets understand the product within seconds.", category: "ux", priority: "must", acceptanceCriteria: ["The hero says what the product does in one sentence", "It reads well on phones and tablets"], sources: ["N1", "A2"] },
      { title: "The page is in English", text: "The page is shown in English only at launch.", category: "ux", priority: "must", acceptanceCriteria: ["Every text is in English", "No language switch is shown"], sources: ["A4"] },
      { title: "The team can see whether 2% of visitors sign up", text: "The team checks signups against visits; about 100 visitors a month are expected in the first three months.", category: "data", priority: "nice", acceptanceCriteria: ["The signup rate is shown against the 2% goal", "Visits and signups are counted per month"], sources: ["A5", "A6"] },
      ...(followed ? [{ title: "Visitors leave their email address for news", text: "Visitors can leave only their email address to hear about the launch.", category: "functional", priority: "nice", acceptanceCriteria: ["Only the email address is asked for", "A clear success message shows"], sources: ["A3"] }] : []),
    ],
    conflicts: [],
  };
}

const OBJECTIVE = {
  statement: "A premium dark-mode landing page that explains the AR and AI product quickly to AR users around the world",
  acceptanceCriteria: ["2% of visitors act on the main button", "Visitors understand the product within seconds"],
  highLevelMd: "## Goal\n- Attract AR users\n\n## Users\n- AR users around the world",
  architectureMd: "## Components\n- One responsive landing page",
  lookAndFeel: "Dark, calm and premium, for AR users on phones and tablets, with one strong product visual.",
  workflows: [], notIncluded: ["The AR application itself", "Customer accounts"], constraints: [{ kind: "languages", text: "English only at launch" }],
};

let calls: AiRequest[] = [];
afterEach(() => {
  setAiRunner(null);
  calls = [];
});

describe("requirements.draft follows the client's answers (local engine, Claude stubbed)", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());

  /** A project as the owner's: only the brief (a note) and the six answered questions. */
  async function landingProject(name: string, note = NOTE, questions = QUESTIONS): Promise<{ p: Row; pid: string; noteId: string; qIds: string[] }> {
    const p = w.project(name);
    const pid = s(p.ItemId);
    for (const schema of ["Requirement", "Objective", "DesignBrief", "Clarification", "Decision", "TechDecision", "DocNote", "DocFile", "RequirementExtra", "Suggestion"]) {
      for (const r of w.rows(schema, pid)) await w.gw.remove(schema, s(r.ItemId));
    }
    const by = s(p.CreatedByUserId);
    const stamp = { ProjectId: pid, WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by };
    const noteId = (await w.gw.insert("DocNote", { ...stamp, Title: "AR + AI landing page brief", BodyMd: note, IsProjectBrief: false, RequestKey: capKey(`test:answers:${name}:note`) })).itemId!;
    const qIds: string[] = [];
    for (const [i, [question, answer]] of questions.entries()) {
      const r = w.store.insert("Clarification", {
        ...stamp, Number: i + 1, Question: question, Answer: answer, Status: "answered", OwnerUserId: by, AnsweredByUserId: by,
        AnsweredAt: new Date(w.now().getTime() + i * 1000).toISOString(), SourceType: "doc-note", SourceRef: noteId, SortOrder: i + 1, RequestKey: capKey(`test:answers:${name}:q${i + 1}`),
      } as Row);
      qIds.push(s(r.ItemId));
    }
    return { p, pid, noteId, qIds };
  }

  const draft = async (name: string, key: string) => {
    const id = await w.queue({ project: name, kind: "requirements.draft", input: { projectId: s(w.project(name).ItemId), sanitizationVersion: 1 }, key });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status, `${s(j.Message)}\n${w.log.join("\n")}`).toBe("succeeded");
    return { id, job: j };
  };

  it("the landing page: the waitlist draft is written again with the answer, and the client is asked to confirm the difference", async () => {
    setAiRunner(async (r) => {
      calls.push(r);
      if (props(r).includes("requirements")) return waitlist(r.prompt.includes("A first draft did not follow these answers"));
      if (props(r).includes("statement")) return OBJECTIVE;
      throw new Error(`no stub for ${props(r).join(",")}`);
    });
    const { pid, noteId, qIds } = await landingProject("Spare Parts Webshop");
    const { id, job } = await draft("Spare Parts Webshop", "answers-1");

    // the prompt: the answers as their own block, stated as overriding the documents, before the note
    const reqCalls = calls.filter((c) => props(c).includes("requirements"));
    expect(reqCalls).toHaveLength(2);
    const first = reqCalls[0]!.prompt;
    expect(first).toContain("- The client's answers and decisions come first: they override the notes, the files and what was read from them.");
    expect(first).toContain("[A1] Question 1: What is the main action you want a visitor to take on the page?\nAnswer: Download the app");
    expect(first.indexOf("[A1] Question 1:")).toBeLessThan(first.indexOf('[N1] Note "AR + AI landing page brief"'));
    expect(first).toContain('- the main call to action: your answer to question 1 says "Download the app"; the note “AR + AI landing page brief” says "Join the Waitlist". Follow the answer.');
    expect(first).toContain('Project facts (the client\'s answers first, then the material; use exactly these): main call to action "Download the app"');
    // the second try names what the first draft left out
    expect(reqCalls[1]!.prompt).toContain('Question 1 ("What is the main action you want a visitor to take on the page?"): "Download the app", not "Join the Waitlist" as the note “AR + AI landing page brief” says');
    // the objective's prompt states the rule too
    expect(calls.find((c) => props(c).includes("statement"))!.prompt).toContain("The client's answers and decisions come first");

    // the requirements follow the answer and name it as their source
    const reqs = w.rows("Requirement", pid).filter((r) => s(r.RequestKey).startsWith(`engine:${id}:`));
    const main = reqs.find((r) => r.Title === "Visitors download the app from the main button")!;
    expect(main, reqs.map((r) => r.Title).join(" | ")).toBeTruthy();
    expect(main.SourceRefs).toEqual(expect.arrayContaining([qIds[0], noteId]));
    expect(reqs.some((r) => /waitlist/i.test(`${s(r.Title)} ${s(r.Text)}`))).toBe(false);
    for (const r of reqs) expect(() => assertRowValid("Requirement", r, { read: true })).not.toThrow();
    // every answer is cited by the requirement that holds it
    for (const q of qIds) expect(reqs.some((r) => (r.SourceRefs as string[]).includes(q)), q).toBe(true);

    // the conflict, visible: an open question with the two values as one-click answers, about the note
    const asked = w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${id}:`));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      Question: "Your answer to question 1 says “Download the app” for the main call to action, but the note “AR + AI landing page brief” says “Join the Waitlist”. We followed your answer. Which one is right?",
      Status: "open", Options: ["Download the app", "Join the Waitlist"], SourceType: "doc-note", SourceRef: noteId, Number: 7,
    });
    expect(confirmedIdOf(s(asked[0]!.RequestKey))).toBe(qIds[0]);
    expect(() => assertRowValid("Clarification", asked[0]!, { read: true })).not.toThrow();
    expect(s(job.OutputRefs ?? job.OutputRefsJson ?? "") + JSON.stringify(job)).toContain(`Clarification:${s(asked[0]!.ItemId)}`);
    expect(s(job.Message)).toMatch(/One answer differs from the documents: we followed your answer, please confirm in the questions\.$/);
    expect(w.log.some((l) => l.includes("answers: the draft leaves out 1 answer(s); asking once more"))).toBe(true);
    expect(w.log.some((l) => l.includes("answers: 6 of 6 answers are in the requirements; 1 answer differs from the documents (the answer is followed) (after a second try); 1 conflict question(s) asked"))).toBe(true);

    // a second draft does not ask the same thing again
    setAiRunner(async (r) => (props(r).includes("requirements") ? waitlist(true) : OBJECTIVE));
    for (const r of w.rows("Requirement", pid)) await w.gw.remove("Requirement", s(r.ItemId));
    const again = await draft("Spare Parts Webshop", "answers-2");
    expect(w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${again.id}:`))).toHaveLength(0);

    // the client picks the brief's action in reply: the refresh follows the reply, and nothing is asked again
    await w.gw.update("Clarification", s(asked[0]!.ItemId), { Answer: "Join the Waitlist", Status: "answered", AnsweredByUserId: s(asked[0]!.OwnerUserId), AnsweredAt: new Date(w.now().getTime() + 3_600_000).toISOString() });
    calls = [];
    setAiRunner(async (r) => {
      calls.push(r);
      return props(r).includes("requirements") ? waitlist(false) : OBJECTIVE;
    });
    const rid = await w.queue({ project: "Spare Parts Webshop", kind: "requirements.draft", input: { projectId: pid, purpose: "refresh" }, key: "answers-refresh" });
    await w.settle();
    expect(w.get("EngineJob", rid).Status, w.log.slice(-20).join("\n")).toBe("succeeded");
    const refresh = calls.filter((c) => props(c).includes("requirements"));
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.prompt).toContain('[A1] Question 1: What is the main action you want a visitor to take on the page?\nAnswer: Join the Waitlist (changed in question 7; the first answer was "Download the app")');
    expect(refresh[0]!.prompt).toContain('main call to action "Join the Waitlist"');
    expect(refresh[0]!.prompt).not.toContain("Where an answer and the documents differ");
    expect(w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${rid}:`))).toHaveLength(0);
    expect(w.rows("Requirement", pid).some((r) => /join the waitlist/i.test(s(r.Title)))).toBe(true);
  });

  it("when Claude keeps the document's version, the answer becomes a criterion; the currency answer wins too", async () => {
    setAiRunner(async (r) => {
      calls.push(r);
      if (props(r).includes("requirements")) return waitlist(false);
      if (props(r).includes("statement")) return OBJECTIVE;
      throw new Error(`no stub for ${props(r).join(",")}`);
    });
    const note = `${NOTE}\nPricing: the app costs CHF 4.90 a month after launch; all prices are in CHF.`;
    const questions: [string, string][] = [...QUESTIONS, ["Which currency should prices be shown in?", "Euros (EUR)"]];
    const { pid, noteId, qIds } = await landingProject("Service Technician Portal", note, questions);
    const { id } = await draft("Service Technician Portal", "answers-3");

    const first = calls.find((c) => props(c).includes("requirements"))!.prompt;
    expect(first).toContain("Currency: EUR (the one the material uses");
    expect(first).toContain('- the currency: your answer to question 7 says "EUR"; the note “AR + AI landing page brief” says "CHF". Follow the answer.');

    const reqs = w.rows("Requirement", pid).filter((r) => s(r.RequestKey).startsWith(`engine:${id}:`));
    const criteria = reqs.flatMap((r) => r.AcceptanceCriteria as string[]);
    expect(criteria).toContain('Follows your answer to question 1: Download the app (not "Join the Waitlist" from the note “AR + AI landing page brief”)');
    expect(criteria).toContain('Follows your answer to question 7: Euros (EUR) (not "CHF" from the note “AR + AI landing page brief”)');
    expect(reqs.find((r) => (r.AcceptanceCriteria as string[]).some((c) => c.startsWith("Follows your answer to question 1")))!.SourceRefs).toContain(qIds[0]);

    const asked = w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${id}:`));
    expect(asked.map((c) => [c.Question, c.Options, c.SourceRef])).toEqual([
      ["Your answer to question 1 says “Download the app” for the main call to action, but the note “AR + AI landing page brief” says “Join the Waitlist”. We followed your answer. Which one is right?", ["Download the app", "Join the Waitlist"], noteId],
      ["Your answer to question 7 says “EUR” for the currency, but the note “AR + AI landing page brief” says “CHF”. We followed your answer. Which one is right?", ["EUR", "CHF"], noteId],
    ]);
    expect(w.log.some((l) => /answers: 7 of 7 answers are in the requirements; 2 answers differ from the documents \(the answer is followed\) \(after a second try\); 2 added as acceptance criteria; 2 conflict question\(s\) asked/.test(l)), w.log.filter((l) => l.includes("answers:")).join("\n")).toBe(true);
  });
});

describe("the answers check is in the job's folder and the ledger (project folders)", () => {
  let w: World;
  let root: string;
  let prevRoot: string | undefined;
  beforeAll(async () => {
    w = await makeWorld();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-answers-root-"));
    prevRoot = process.env.MF_ENGINE_ROOT;
    process.env.MF_ENGINE_ROOT = root;
  });
  afterAll(() => {
    if (prevRoot === undefined) delete process.env.MF_ENGINE_ROOT;
    else process.env.MF_ENGINE_ROOT = prevRoot;
    w?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records a check event with every answer's status and the conflict", async () => {
    const engine = createEngine({
      store: w.store, gateway: w.gw, config: () => w.config, log: (l) => w.log.push(l), writers: writerOf, now: () => w.now(),
      sleep: (_ms, signal) => new Promise((resolve, reject) => (signal.aborted ? reject(new Error("aborted")) : setImmediate(resolve))),
      sweepMs: 0, projectFolder: (ws, id, o) => projectWorkspace(root, ws, id, o),
    });
    setAiRunner(async (r) => (props(r).includes("requirements") ? waitlist(true) : OBJECTIVE));
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const ws = s(p.WorkspaceId);
    for (const schema of ["Requirement", "Objective", "DesignBrief", "Clarification", "Decision", "TechDecision", "DocNote", "DocFile", "RequirementExtra"]) {
      for (const r of w.rows(schema, pid)) await w.gw.remove(schema, s(r.ItemId));
    }
    const by = s(p.CreatedByUserId);
    const stamp = { ProjectId: pid, WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by };
    await w.gw.insert("DocNote", { ...stamp, Title: "AR + AI landing page brief", BodyMd: NOTE, IsProjectBrief: false, RequestKey: capKey("test:answers:ledger:note") });
    QUESTIONS.forEach(([question, answer], i) => w.store.insert("Clarification", {
      ...stamp, Number: i + 1, Question: question, Answer: answer, Status: "answered", OwnerUserId: by, AnsweredByUserId: by, AnsweredAt: w.now().toISOString(), SourceType: "", SourceRef: "", SortOrder: i + 1, RequestKey: capKey(`test:answers:ledger:q${i}`),
    } as Row));
    const id = await w.queue({ project: s(p.Name), kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1 }, key: "answers-ledger" });
    for (let i = 0; i < 80 && w.store.rows("EngineJob").some((j) => ["queued", "claimed", "running"].includes(String(j.Status))); i++) {
      engine.tick();
      await engine.idle();
    }
    engine.stop();
    expect(w.get("EngineJob", id).Status, w.log.slice(-15).join("\n")).toBe("succeeded");
    const kb = path.join(root, "projects", ws, pid, "artifacts", "brief");
    const ev = readLedger(kb).find((e) => e.type === "check" && e.jobId === id)!;
    expect(ev).toMatchObject({ name: "answers", kind: "requirements.draft", step: "requirements", ok: true, checked: 6, reflected: 6, retried: false });
    expect((ev.items as { number: number; status: string }[]).map((i) => i.status)).toEqual(["reflected", "reflected", "reflected", "reflected", "reflected", "reflected"]);
    expect(ev.conflicts).toEqual([expect.objectContaining({ number: 1, about: "the main call to action", followed: "Download the app", other: "Join the Waitlist", found: "facts", settled: false })]);
    expect(typeof ev.contextVersion).toBe("number");
    const file = JSON.parse(fs.readFileSync(path.join(root, "projects", ws, pid, "jobs", `${id}-1`, "answers-check.json"), "utf8"));
    expect(file).toMatchObject({ name: "answers", jobId: id, ok: true, asked: [expect.stringMatching(/^Clarification:/)] });
    // the context's facts: the answer's action, the conflict kept
    const ctx = JSON.parse(fs.readFileSync(path.join(kb, "context.json"), "utf8"));
    expect(ctx.sections.basics.facts.primaryAction).toBe("Download the app");
    expect(ctx.sections.basics.factConflicts[0]).toMatchObject({ fact: "primaryAction", answer: "Download the app", other: "Join the Waitlist" });
  });
});
