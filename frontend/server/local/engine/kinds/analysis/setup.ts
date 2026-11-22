// The project's setup answers as the product manager reads them: the guided start (goal, users, where the product runs,
// its test version, how it is started) and the setup windows (must-haves with a priority, key workflows, what to leave
// out, what to respect, what should change, who approves). They become lines of the facts (facts.ts), shape the
// objective of the draft (draft.ts) and leave gaps the questions ask about: above all the success and performance
// targets ("how many users", "how fast"), which every project must settle before the scope is locked.
import type { ProjectView } from "../../context.ts";
import { str } from "../../context.ts";
import { lower, sentence, statementsOf } from "../../text.ts";
import { detailsFromRow, type ConstraintItem, type MustHave } from "../../../../../src/domain/setupDetails";
import { briefFactsOf, parseTestEnv, type TestEnvInfo } from "../../../../../src/domain/projectBrief";
import { GOAL_CHIPS } from "../../../../../src/domain/guidedStart";

export interface SetupAnswers {
  goal: string;
  targetUsers: string;
  appUrl: string;
  testEnv: TestEnvInfo | null;
  runInstructions: string;
  mustHaves: MustHave[];
  workflows: string[];
  exclusions: string[];
  constraints: ConstraintItem[];
  intendedChanges: string;
  changeTags: string[];
  approvalOwnerUserId: string;
  approvalOwnerName: string;
}

/** The goal and the users are the project's own fields, else the business analyst's recorded answers (briefFactsOf). */
export function setupOf(p: ProjectView): SetupAnswers {
  const row = p.project;
  const d = detailsFromRow(row);
  const approver = str(row.ApprovalOwnerUserId);
  const about = briefFactsOf(p);
  return {
    goal: about.goal,
    targetUsers: about.targetUsers,
    appUrl: str(row.AppUrl).trim(),
    testEnv: parseTestEnv(str(row.TestEnv) || null),
    runInstructions: str(row.RunInstructions).trim(),
    mustHaves: d.mustHaves,
    workflows: d.workflows,
    exclusions: d.exclusions,
    constraints: d.constraints,
    intendedChanges: d.intendedChanges.trim(),
    changeTags: d.changeTags,
    approvalOwnerUserId: approver,
    approvalOwnerName: approver ? p.personName(approver) : "",
  };
}

/** True when the setup says anything at all (a project set up before the guided start has none of it). */
export function hasSetup(s: SetupAnswers): boolean {
  return Boolean(s.goal || s.targetUsers || s.mustHaves.length || s.workflows.length || s.exclusions.length || s.constraints.length || s.intendedChanges || s.changeTags.length);
}

export type SetupLineKind = "wish" | "constraint" | "excluded" | "fact";
export interface SetupLine {
  text: string;
  kind: SetupLineKind;
  heading: string;
  /** The requirement priority a must-have asks for. */
  priority?: "must" | "nice" | "later";
}

const PRIORITY: Record<MustHave["priority"], "must" | "nice" | "later"> = { must: "must", should: "nice", could: "later" };

/** "German and French" -> "Must be available in German and French": the constraints as the requirements read them.
 *  A line with several needs ("It has to fit the point-of-sale system; Read access to the door lock system") gives one
 *  line each, and a need that is already a sentence keeps its own words. */
function constraintLines(c: ConstraintItem): SetupLine[] {
  const t = c.text.trim().replace(/[.;]+$/, "");
  if (!t) return [];
  const line = (text: string, kind: SetupLineKind = "constraint"): SetupLine => ({ text, kind, heading: "Constraints" });
  switch (c.kind) {
    case "deadline": return [line(`Deadline: ${t}`, "fact")];
    case "budget": return [line(`Budget: ${t}`, "fact")];
    case "compliance": return [line(`Must comply with ${t}`)];
    case "languages": return [line(`Must be available in ${t}`)];
    case "integrations": return t.split(/;\s+|\s+and also\s+/).map((x) => x.trim()).filter(Boolean).map((x) => line(integrationLine(x)));
    default:
      return t.split(/;\s+/).map((x) => x.trim()).filter(Boolean).map((x) =>
        line(/\b(must|should|has to|have to|needs? to)\b/i.test(x) || /^[A-ZÄÖÜ][\w’' -]*\s+(is|are|was|were|has|have|can|works?|runs?)\b/.test(x) ? x : `Must respect ${lower(x)}`));
  }
}

/** One system to fit in with: "It has to fit SAP" -> "Must connect to SAP", "Read access to the door lock system" ->
 *  "Must have read access to the door lock system", "Exchange orders with the ERP" -> "Must exchange orders with the ERP". */
function integrationLine(raw: string): string {
  const t = raw.replace(/^(?:it|the (?:app|application|portal|system|product|tool|platform))\s+(?:has to|must|should|needs to|will)\s+(?:fit(?: into| with)?|connect (?:to|with)|work with|integrate with|talk to)\s+/i, "")
    .replace(/^(?:fit(?: into| with)?|connect (?:to|with)|work with|integrate with)\s+/i, "").trim();
  if (/^(?:read|write|read and write|read-only|full|direct)\s+access\b/i.test(t)) return `Must have ${lower(t)}`;
  if (/^(?:sync|import|export|exchange|send|receive|read|write|update|push|pull|share)\b/i.test(t)) return `Must ${lower(t)}`;
  if (/\b(must|should|has to|needs? to)\b/i.test(t)) return t;
  return `Must connect to ${lower(t)}`;
}

/** The setup answers as lines of the facts, in the order a person reads the brief. */
export function setupLines(s: SetupAnswers): SetupLine[] {
  const out: SetupLine[] = [];
  for (const g of statementsOf(s.goal)) out.push({ text: g, kind: "wish", heading: "Goal" });
  if (s.targetUsers) out.push({ text: sentence(s.targetUsers), kind: "fact", heading: "Who will use it" });
  for (const c of statementsOf(s.intendedChanges)) out.push({ text: c, kind: "wish", heading: "What should change" });
  for (const t of s.changeTags) out.push({ text: `Change wanted: ${t}`, kind: "fact", heading: "What should change" });
  for (const m of s.mustHaves) out.push({ text: m.text, kind: "wish", heading: "What it must do", priority: PRIORITY[m.priority] });
  for (const w of s.workflows) out.push({ text: w, kind: "wish", heading: "Key workflows" });
  for (const x of s.exclusions) out.push({ text: x, kind: "excluded", heading: "Not included" });
  for (const c of s.constraints) out.push(...constraintLines(c));
  if (s.appUrl) out.push({ text: `The product runs at ${s.appUrl}`, kind: "fact", heading: "Where it runs today" });
  if (s.runInstructions) out.push({ text: `How it is started: ${s.runInstructions.replace(/\s+/g, " ")}`, kind: "fact", heading: "How it is started" });
  return out;
}

// ------------------------------------------------------------------------------------------------- the gaps

export interface SetupGap {
  id: string;
  question: string;
  /** Already settled when an earlier question or decision matches. */
  match: RegExp;
  /** Who is asked: the approval owner for goals and targets, else the person who asked for the reading. */
  owner: "approver" | "requester";
}

export interface GapContext {
  productNoun: string;
  client: string;
  existing: boolean;
  /** All the project's text (notes, files, brief, setup), lower case. */
  all: string;
  /** The main people group and its count, when the text gives one ("850 clients"). */
  actor: { name: string; count?: number };
  /** Something measurable about today's way of working ("Staff spend about 2 days per week chasing…"). */
  todayMeasure: string | null;
  /** Wishes of the material, for "is the goal clear". */
  wishes: number;
}

const PEAK = /\b(?:peak|busiest|season|rush|month[- ]end|year[- ]end)\b[^.;\n]{0,60}/i;
const SPEED_SAID = /\b(\d+(?:[.,]\d+)?\s*(?:seconds?|secs?|ms)\b|response time|within \d)/i;
const USERS_SAID = /\b(at the same time|concurrent(?:ly)?|simultaneous(?:ly)?|in parallel)\b/i;
const SUCCESS_SAID = /\b(success|kpi|we will know|measure(?:d)? by|target of)\b/i;
const VOLUME_SAID = /\b(per (?:year|month|week|day)|a (?:year|month|week|day)|\d+\s*(?:gb|tb)|data volume)\b/i;

/** The setup's gaps, most important first: what it should achieve and for whom, what should change, then the success
 *  and performance targets, then (existing products) the test version and how the product is started. */
export function setupGaps(s: SetupAnswers, c: GapContext): SetupGap[] {
  const out: SetupGap[] = [];
  const noun = c.productNoun;
  const the = c.existing ? `the ${noun}` : `the new ${noun}`;
  if (!s.goal && c.wishes === 0) {
    out.push({ id: "goal", owner: "approver", match: /\b(goal|achieve|purpose|objective)\b/i,
      question: `What should ${the} achieve for ${c.client || "the business"}: which problem does it solve, and what changes for the people who use it?` });
  }
  if (!s.targetUsers && !c.actor.count && c.actor.name === "users") {
    out.push({ id: "users", owner: "approver", match: /\bwho will use\b|\bwhich (?:groups|people)\b/i,
      question: `Who will use ${the}: which groups of people, and roughly how many of each?` });
  }
  if (c.existing && !s.intendedChanges && s.changeTags.length === 0 && s.mustHaves.length === 0) {
    out.push({ id: "changes", owner: "approver", match: /\b(what should change|change first|stay exactly)\b/i,
      question: `What should change first in the ${noun}, and what must stay exactly as it is today?` });
  }
  if (!SUCCESS_SAID.test(c.all)) {
    const measure = c.todayMeasure ? ` (today: ${lower(c.todayMeasure.replace(/[.;]+$/, ""))})` : "";
    out.push({ id: "success", owner: "approver", match: /\b(worked|success|which number should change)\b/i,
      question: `How will you know ${the} worked a few months after it goes live: which number should change, and by how much${measure}?` });
  }
  if (!USERS_SAID.test(c.all)) {
    const peak = PEAK.exec(c.all)?.[0]?.trim();
    const who = c.actor.name === "users" ? "people" : c.actor.name;
    const when = `at the busiest moment${peak ? ` (${peak.replace(/[:.,;]+$/, "")})` : ""}`;
    out.push({ id: "users-at-once", owner: "approver", match: /\b(at the same time|how many people|how many of them)\b/i,
      question: c.actor.count
        ? `About ${c.actor.count} ${who} are mentioned. How many of them use it at the same time ${when}, and how many more do you expect in two years?`
        : `How many people will use ${the} in total, how many at the same time ${when}, and how many more do you expect in two years?` });
  }
  if (!SPEED_SAID.test(c.all)) {
    const slow = /\b(slow|faster|takes too long|make it faster)\b/i.test(c.all);
    out.push({ id: "speed", owner: "approver", match: /\b(how fast|respond|response time)\b/i,
      question: slow
        ? `The ${noun} is described as slow today. How fast must the most used screens respond for it to feel right: say, a list within 2 seconds and a photo upload within 5 seconds on a phone?`
        : `How fast must ${the} respond for it to feel right: say, a page within 2 seconds, and is there a moment when it must not slow down?` });
  }
  if (/\b(upload|file|photo|document|receipt|attachment|certificate)s?\b/i.test(c.all) && !VOLUME_SAID.test(c.all)) {
    out.push({ id: "volume", owner: "requester", match: /\b(how much data|how many (?:files|documents|uploads)|per year)\b/i,
      question: `How much will be stored: roughly how many files or records per year, and how long must they be kept?` });
  }
  if (c.existing && (!s.testEnv || s.testEnv.available !== "yes")) {
    out.push({ id: "test-version", owner: "requester", match: /\b(test version|staging|safe copy|test environment)\b/i,
      question: s.testEnv?.available === "no"
        ? `There is no safe test version of the ${noun} yet. Can one be set up as a copy of today's ${noun}, and who can give us access to it?`
        : `Is there a safe test version of the ${noun} we can work on without touching real data, and who can give us access to it?` });
  }
  if (c.existing && !s.runInstructions) {
    out.push({ id: "run", owner: "requester", match: /\b(how is it started|started and deployed|deploy(?:ed|ment)? today)\b/i,
      question: `How is the ${noun} started and deployed today, and who knows that setup best?` });
  }
  for (const k of s.constraints) {
    if (k.text.trim()) continue;
    const ask: Partial<Record<ConstraintItem["kind"], string>> = {
      deadline: `You mentioned a deadline: by which date must the ${noun} be in use, and what happens on that date?`,
      budget: "You mentioned a budget: what is the budget for the first version, and what does it have to cover?",
      compliance: "You mentioned compliance: which rules must the product follow, such as data protection or an industry standard?",
      languages: "You mentioned languages: which languages are needed from the start, and which can follow later?",
      integrations: `You mentioned other systems: which systems must the ${noun} connect to, and which data goes where?`,
    };
    const q = ask[k.kind];
    if (q) out.push({ id: `constraint-${k.kind}`, owner: "approver", match: new RegExp(`\\byou mentioned ${k.kind === "integrations" ? "other systems" : k.kind}\\b`, "i"), question: q });
  }
  return out;
}

/** The questions a setup gap would raise, at most `max` per reading (the next reading asks the rest). */
export const SETUP_QUESTIONS_PER_READING = 3;

// ------------------------------------------------------------------------------------------------- "not sure"

/** A question set aside with "Not sure" (its reason, see the step's understandingModel). */
export const isNotSure = (reason: unknown): boolean => typeof reason === "string" && /^not sure\b/i.test(reason.trim());

const SUGGESTIONS: [RegExp, string][] = [
  [/\b(at the same time|how many people|how many of them)\b/i, "Plan for about one in ten users at the same time at the busiest moment, and for twice today's number of users in two years"],
  [/\b(how fast|respond)\b/i, "The most used screens open within 2 seconds, and an upload finishes within 5 seconds on a phone"],
  [/\b(worked|which number should change)\b/i, "The time spent today on this work halves within six months after going live"],
  [/\b(how much will be stored|files or records per year)\b/i, "Plan for three times today's yearly volume, and keep records as long as the law requires"],
  [/\b(test version)\b/i, "A separate copy of the product without real client data is set up for testing"],
  [/\b(started and deployed)\b/i, "The start-up is documented from the code and confirmed with your IT"],
];

/** The product manager's suggestion for a question the client wasn't sure about; null when only the client can say. */
export function suggestionFor(question: string, fromTopic?: string | null): string | null {
  for (const [re, s] of SUGGESTIONS) if (re.test(question)) return s;
  if (/\b(achieve|who will use|what should change first)\b/i.test(question)) return null;
  return fromTopic?.trim() ? fromTopic.trim() : null;
}

/** The project in the client's words: the brief, else the "About the project" section of the Project brief note
 *  (the guided start writes the description only there; briefFactsOf). */
export function descriptionOf(p: ProjectView): string {
  return briefFactsOf(p).description;
}

/** A goal made only of the guided start's quick picks ("Sell online, fewer mistakes") as things to do ("sell online",
 *  "make fewer mistakes"); null when the goal has words of its own. */
export function goalChipsOnly(goal: string): string[] | null {
  const parts = goal.trim().replace(/[.;!]+$/, "").split(/\s*,\s*/).filter(Boolean);
  if (!parts.length) return null;
  const chips = GOAL_CHIPS.map((c) => c.toLowerCase());
  if (!parts.every((x) => chips.includes(x.toLowerCase()))) return null;
  return parts.map((x) => (/^fewer\b/i.test(x) ? `make ${lower(x)}` : lower(x)));
}
