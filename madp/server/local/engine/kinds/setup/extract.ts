// What the business agent finds in the material people share during the setup: must-haves (with a priority), key
// workflows, things to leave out, constraints (by kind), and a goal or the users when the project has none yet.
// Everything comes from the documents' own words: their sections ("What it must do", "Constraints", "Out of scope"…),
// labelled lines ("What we need: …"), sentences that say what is needed or must be respected, and the columns of a
// spreadsheet export. Findings the project already has, or that repeat each other, are left out. Pure.
import type { ConstraintKind, Priority, SetupDetails } from "../../../../../src/domain/setupDetails";
import { TEXT_MAX, type SuggestionKind } from "../../../../../src/domain/setupAgent";
import { cap, listOf, overlap, plain, wordsOf } from "../../text.ts";
import type { ReadText } from "./read.ts";

export interface SourceDoc {
  /** "DocFile:<id>" or "DocNote:<id>". */
  ref: string;
  name: string;
  read: ReadText;
}

export interface ExtractContext {
  productName: string;
  goal: string;
  users: string;
  details: SetupDetails;
}

export interface Finding {
  kind: SuggestionKind;
  text: string;
  priority: Priority;
  constraintKind: ConstraintKind;
  sourceRef: string;
  sourceName: string;
}

/** At most this many findings of a kind per reading. */
export const FINDINGS_MAX: Readonly<Record<SuggestionKind, number>> = { mustHave: 8, workflow: 5, exclusion: 5, constraint: 6, goal: 1, users: 1 };

type Section = "must" | "workflow" | "exclusion" | "constraint" | "systems" | "users" | "goal" | "success" | "skip";

interface Statement {
  text: string;
  section: Section | null;
  sectionPriority?: Priority;
  item: boolean;
  doc: SourceDoc;
}

// ------------------------------------------------------------------------------------------------- sections

const SECTIONS: [RegExp, Section, Priority?][] = [
  [/\b(next steps|action items?|to-?dos?|tasks|attendees|participants|agenda|contacts?|appendix|change ?log|history|open questions|questions|signatures?)\b/i, "skip"],
  [/\b(nice[- ]to[- ]haves?|could[- ]haves?|wish ?list|later|ideas|future|phase 2|someday)\b/i, "must", "could"],
  [/\b(should[- ]haves?|important)\b/i, "must", "should"],
  [/\b(not included|out of scope|not in scope|exclusions?|leave out|won'?t have|won'?t do|non-?goals|not now|not part of)\b/i, "exclusion"],
  [/\b(what it must do|must[- ]?haves?|requirements?|key features|features|what we need|functions|capabilities|in scope|what it should do|must do)\b/i, "must", "must"],
  [/\b(constraints?|must respect|limitations?|deadlines?|timeline|budget|compliance|languages?|security|non-?functional|technical setting|boundaries)\b/i, "constraint"],
  [/\b(systems|integrations?|interfaces|connected systems|tools we use|landscape)\b/i, "systems"],
  [/\b(workflows?|process(es)?|how it works|who does what|journeys?|day in the life|flows?|routines?)\b/i, "workflow"],
  [/\b(who uses it|users|target users|audience|personas|roles|who it is for)\b/i, "users"],
  [/\b(success|measure|kpis?|targets|metrics|outcomes?)\b/i, "success"],
  [/\b(summary|goals?|objectives?|vision|purpose|why|background|overview|about)\b/i, "goal"],
];

export function sectionOf(heading: string): { section: Section | null; priority?: Priority } {
  const h = plain(heading).toLowerCase();
  if (!h) return { section: null };
  for (const [re, section, priority] of SECTIONS) if (re.test(h)) return { section, priority };
  return { section: null };
}

// ------------------------------------------------------------------------------------------------- statements

const ITEM = /^([-*+•]|\d+[.)])\s+/;
const TASK = /^(\[[ xX]\]\s+|to ?do:\s*)/i;
/** Labels whose lines say nothing about the product. */
const SKIP_LABEL = /^(where|when|date|attendees|participants|from|to|cc|subject|minutes|next call|next meeting|prepared by|author|contact|phone|e-?mail|updated|version)$/i;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9“"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The heading a line is, if it is one: "## …", a bold line alone, or a short "Label:" line. */
function headingOf(line: string): string | null {
  const h = /^#{1,6}\s+(.*)$/.exec(line);
  if (h) return h[1]!;
  const bold = /^\*\*([^*]{2,60})\*\*:?$/.exec(line);
  if (bold) return bold[1]!;
  if (/^[A-ZÄÖÜ][^.!?]{1,48}:$/.test(line) && !/^(from|to|cc|subject|date)$/i.test(line.slice(0, -1))) return line.slice(0, -1);
  return null;
}

function statementsOfDoc(doc: SourceDoc): Statement[] {
  const out: Statement[] = [];
  const r = doc.read;
  if (r.type === "none" || r.type === "table" || !r.text.trim()) return out;
  let section: Section | null = null;
  let priority: Priority | undefined;
  const push = (text: string, item: boolean) => {
    const t = plain(text).replace(/\s+/g, " ").trim();
    if (t.length >= 8) out.push({ text: t, section, sectionPriority: priority, item, doc });
  };
  const paragraphs: string[] = [];
  const flush = () => {
    if (!paragraphs.length) return;
    for (const s of sentencesOf(paragraphs.join(" "))) push(s, false);
    paragraphs.length = 0;
  };
  for (const raw of r.text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flush(); continue; }
    const h = headingOf(line);
    if (h !== null) {
      flush();
      // a document's title (# …) names the document, not a section
      if (/^#\s/.test(line)) { section = null; priority = undefined; continue; }
      const s = sectionOf(h);
      section = s.section;
      priority = s.priority;
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const text = line.replace(ITEM, "");
      if (TASK.test(text)) continue;
      push(text, true);
      continue;
    }
    if (TASK.test(line)) { flush(); continue; }
    paragraphs.push(line);
  }
  flush();
  return out;
}

// ------------------------------------------------------------------------------------------------- reading a statement

const TODAY = /\b(today|currently|at the moment|right now|nowadays|lose|loses|losing|lost|workarounds?|work around|by hand|on paper|paper forms?|phone calls|excel|spreadsheets?|chasing|takes (about|too)|complain\w*|too slow|nobody notices|printouts?|thank you|as promised|in copy|kind regards)\b/i;
const UNSETTLED = /\b(not (yet )?(discussed|known|decided|clear|agreed)|tbd|tbc|to be (clarified|decided|confirmed|discussed)|unclear|open question|still open)\b/i;
const MUST = /\b(must|has to|have to|needs? to|should|shall|wants? (\w+ ){0,3}to|would like (\w+ ){0,3}to|we need|be able to|it is important that|is required|are required)\b/i;
const EXCLUDE = /\b(not part of|out of scope|not in scope|no changes (to|inside|in)|we (don'?t|do not) need|is not needed|isn'?t needed|are not needed|not needed (now|yet|for)|later phase|in a later (phase|release|version)|stays as it is|stay as they are|leave out|left out|excluded|not in the first (version|release)|not for (the )?(first|now))\b/i;
const ROUTINE = /\b((every|each) (morning|day|evening|week|shift|month|night|monday|tuesday|wednesday|thursday|friday)|first thing|at the end of (the|each|every) (day|week|month|shift)|(once|when|after|as soon as) (a|an|the) [a-z-]+ (is|are|arrives?|comes? in|has|gets))\b/i;
const ACTOR = /\b(staff|team|teams|manager|managers|picker|pickers|driver|drivers|planner|planners|dispatcher|customer|customers|supplier|suppliers|technician|technicians|clerk|assistant|lead|agent|accountant|buyer|buyers|nurse|teacher|member|members|admin|desk|operator|operators|employee|employees|client|clients)\b/i;

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DEADLINE = new RegExp(
  `\\b(by|before|until|no later than|in time for|ready for|ready by|live (by|before|in|for)|go-?live|deadline)\\b[^.]*?\\b(\\d{1,2}\\.?\\s+${MONTH}\\b|${MONTH}\\s+\\d{4}|${MONTH}\\b|q[1-4]\\b|20\\d\\d|season|summer|winter|spring|autumn|christmas|easter|holidays?)`,
  "i",
);
const LANG = "(?:German|French|Italian|English|Romansh|Spanish|Portuguese|Dutch|Polish)";
const LANGUAGES = new RegExp(`\\b${LANG}\\b[^.]{0,40}\\b(and|,|or)\\s+${LANG}\\b|\\blanguages?\\b`, "i");

/** The kind of constraint a statement is, or null when it is no constraint. */
export function constraintKindOf(text: string, inSection = false): ConstraintKind | null {
  if (/\b(CHF|EUR|USD|GBP)\s?\d|[€$£]\s?\d|\bbudget\b/i.test(text)) return "budget";
  if (DEADLINE.test(text)) return "deadline";
  if (/\b(revDSG|nDSG|DSG|GDPR|DSGVO|data protection|privacy|ISO ?\d{3,5}|HACCP|FINMA|GxP|compliance|compliant|audit trail|personal data|data stays? in|hosted in switzerland)\b/i.test(text)) return "compliance";
  if (LANGUAGES.test(text)) return "languages";
  if (/\b(has to fit|must fit|fits? (into|with)|connect(s|ed)? (to|with)|integrat\w*|sync\w* with|import(ed)? from|export(ed)? to|read access to|interface to|talks? to|single sign-?on|sso)\b/i.test(text)) return "integrations";
  if (/\b(has to run on|must run on|have to run on|runs? on (the )?(phones?|tablets?|handhelds?|scanners?|existing)|work(s)? offline|offline|on the handheld|devices? (we|they|stores?) (already )?own)\b/i.test(text)) return "other";
  return inSection ? "other" : null;
}

/** "one day before", "two weeks later", "30 minutes ahead": a time, not a wish for later. */
const SPAN = /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|hours?|days?|weeks?|months?)\s+(later|before|after|ahead|earlier|in advance|beforehand|prior)\b/gi;

function priorityOf(raw: string, fallback: Priority): Priority {
  const text = raw.replace(SPAN, " ");
  if (/\b(nice to have|if there is time|could|later|eventually|one day|maybe|optional)\b/i.test(text)) return "could";
  if (/\b(must|has to|have to|critical|essential|can'?t go live without|we need|what we need|required)\b/i.test(text)) return "must";
  if (/\b(should|important|would like|ideally|we'?d like)\b/i.test(text)) return fallback === "must" ? "should" : fallback;
  return fallback;
}

/** The priority a line's label gives ("Must", "Should have", "Nice to have"…), "exclusion" for "Won't", else null. */
export function priorityLabelOf(label: string): Priority | "exclusion" | null {
  const l = label.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
  if (/^(must|must[- ]haves?|must do)$/.test(l)) return "must";
  if (/^(should|should[- ]haves?)$/.test(l)) return "should";
  if (/^(could|could[- ]haves?|nice[- ]to[- ]haves?|optional|later)$/.test(l)) return "could";
  if (/^(won't|won't haves?|will not|wont)$/.test(l)) return "exclusion";
  return null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A must-have in plain words: the product, the person who wants it and the modal verb are left out. */
export function mustText(text: string, product: string): string {
  let t = text.trim().replace(/^(what we need|we need|need|must|must-have|requirement|feature|wish|request)\s*[:\-–]\s*/i, "");
  const subject = `(?:${[product ? esc(product) : "", "it", "the (?:app|tool|portal|system|platform|solution|product)", "we", "you"].filter(Boolean).join("|")})`;
  t = t.replace(new RegExp(`^[A-ZÄÖÜ][\\wäöü-]*\\s+(?:wants|would like|needs|asks for)\\s+${subject}\\s+to\\s+`, "i"), "");
  t = t.replace(new RegExp(`^${subject}\\s+(?:should|must|needs to|has to|shall|will|would|can)\\s+(?:be able to\\s+)?`, "i"), "");
  t = t.replace(/^(?:we|they)\s+(?:need|want|would like)\s+(?:to\s+)?/i, "");
  t = t.replace(/[.;!]+$/, "").trim();
  return cap(t);
}

const clean = (t: string): string => cap(t.trim().replace(/\s+/g, " ").replace(/[.;]+$/, ""));

// ------------------------------------------------------------------------------------------------- tables

const STATUS_ORDER = ["new", "to do", "open", "planned", "in progress", "waiting", "on hold", "blocked", "late", "overdue", "escalated", "in review", "done", "closed", "resolved", "cancelled"];

function tableFindings(doc: SourceDoc): Finding[] {
  const rows = doc.read.rows ?? [];
  if (rows.length < 4) return [];
  const head = rows[0]!.map((h) => h.trim());
  const data = rows.slice(1).filter((r) => r.length >= head.length - 1);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const status = col(/^(status|state|stage)$/i);
  const owner = col(/^(owner|assignee|assigned to|responsible|who|handled by)$/i);
  const item = col(/^(item|task|order|ticket|case|subject|title|type|request)$/i);
  const site = col(/^(site|store|location|depot|branch|region|warehouse|plant)$/i);
  const num = head.findIndex((h, i) => /(minutes|hours|days|lost|delay|cost|amount|qty|quantity|count|value)/i.test(h) && data.every((r) => /^-?[\d'’.,]+$/.test((r[i] ?? "").trim() || "0")));
  const base = { sourceRef: doc.ref, sourceName: doc.name, priority: "should" as Priority, constraintKind: "other" as ConstraintKind };
  const out: Finding[] = [];
  if (status >= 0 && owner >= 0) {
    const seen = [...new Set(data.map((r) => (r[status] ?? "").trim()).filter(Boolean))];
    const ordered = seen.sort((a, b) => (STATUS_ORDER.indexOf(a.toLowerCase()) + 99) % 99 - (STATUS_ORDER.indexOf(b.toLowerCase()) + 99) % 99);
    const first = ordered.find((s) => ["new", "to do", "open", "planned"].includes(s.toLowerCase())) ?? ordered[0];
    const last = [...ordered].reverse().find((s) => ["done", "closed", "resolved"].includes(s.toLowerCase())) ?? ordered[ordered.length - 1];
    let nouns: string[] = [];
    if (item >= 0) {
      const count = new Map<string, number>();
      for (const r of data) {
        const n = (r[item] ?? "").replace(/[\s#-]*[\d][\w-]*$/, "").trim().toLowerCase();
        if (n) count.set(n, (count.get(n) ?? 0) + 1);
      }
      nouns = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    }
    if (first && last && first !== last) {
      // the kinds of item in parentheses: "Every item (table plan, event calendar or arrivals today) has one owner …"
      const what = nouns.length ? `Every item (${listOf(nouns, "or")})` : "Every item";
      const late = seen.some((s) => /^(late|overdue|escalated)$/i.test(s));
      out.push({ ...base, kind: "workflow", text: `${what} has one owner who moves it from ${first} to ${last}${late ? " and escalates it when it runs late" : ""}` });
    }
  }
  if (num >= 0 && (site >= 0 || owner >= 0)) {
    const by = site >= 0 ? site : owner;
    out.push({ ...base, kind: "mustHave", text: `Show the ${head[num]!.toLowerCase()} per ${head[by]!.toLowerCase()} at a glance` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- the reading

const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9äöüéèà ]+/g, " ").replace(/\s+/g, " ").trim();

/** True when two statements say the same (most of the shorter one's words are in the other). */
export function sameFinding(a: string, b: string): boolean {
  if (fold(a) === fold(b)) return true;
  const A = wordsOf(a), B = wordsOf(b);
  if (A.size === 0 || B.size === 0) return false;
  return overlap(A, B) / Math.min(A.size, B.size) >= 0.75;
}

/** Sources in the order a person would read them: documents, then e-mails, then notes, then data. */
const ORDER: Record<ReadText["type"], number> = { markdown: 0, pdf: 0, text: 1, email: 2, table: 3, none: 4 };

export function extractFindings(docs: readonly SourceDoc[], ctx: ExtractContext): Finding[] {
  const sorted = [...docs].sort((a, b) => ORDER[a.read.type] - ORDER[b.read.type] || (a.ref.startsWith("DocNote") ? 1 : 0) - (b.ref.startsWith("DocNote") ? 1 : 0));
  const found: Finding[] = [];
  const goals: { text: string; doc: SourceDoc }[] = [];
  const successes: string[] = [];
  const users: { text: string; doc: SourceDoc }[] = [];
  const systems: { text: string; doc: SourceDoc }[] = [];

  const add = (f: Finding) => {
    const max = TEXT_MAX[f.kind];
    const text = f.text.length > max ? `${f.text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : f.text;
    if (text.length < 10) return;
    found.push({ ...f, text });
  };

  for (const doc of sorted) {
    if (doc.read.type === "table") {
      for (const f of tableFindings(doc)) add(f);
      continue;
    }
    for (const st of statementsOfDoc(doc)) {
      const t = st.text;
      // an open point is a question for later, not a finding
      if (UNSETTLED.test(t)) continue;
      const base = { sourceRef: doc.ref, sourceName: doc.name, priority: "must" as Priority, constraintKind: "other" as ConstraintKind };
      // a labelled line: "Peak times: Monday mornings", "What we need: …"
      const label = /^([A-ZÄÖÜa-zäöü][\w äöü'’-]{1,28}):\s+(.+)$/.exec(t);
      if (label && SKIP_LABEL.test(label[1]!.trim())) continue;
      // "Must: …", "Should have: …", "Nice to have: …", "Won't: …": the label is the priority, the rest is the finding
      const ranked = label && (!st.section || st.section === "must") ? priorityLabelOf(label[1]!) : null;
      if (ranked === "exclusion") { add({ ...base, kind: "exclusion", text: clean(label![2]!) }); continue; }
      if (ranked) { add({ ...base, kind: "mustHave", priority: ranked, text: mustText(label![2]!, ctx.productName) }); continue; }
      const labelSection = label ? sectionOf(label[1]!) : { section: null };
      const section = st.section ?? labelSection.section;
      const sectionPriority = st.sectionPriority ?? labelSection.priority;
      // a line whose label names its section ("Not included: gift vouchers"): the words after the label are the finding
      const body = !st.section && labelSection.section && label ? label[2]!.trim() : t;
      if (section === "skip") continue;
      if (section === "systems") { systems.push({ text: clean(body), doc }); continue; }
      if (section === "users") { if (st.item) users.push({ text: clean(body), doc }); continue; }
      if (section === "success") { successes.push(clean(body).replace(/^success is measured as:\s*/i, "")); continue; }
      if (section === "goal") {
        if (/\b(should|so that|help|aims? to|in order to)\b/i.test(body) && !TODAY.test(body)) goals.push({ text: body, doc });
        if (/\bfalls? from\b|\brises? from\b|\bfrom \d[^.]* to \d/i.test(body)) successes.push(clean(body.replace(/^.*?(is simple|measure of success)[^:]*:\s*/i, "")));
        continue;
      }
      if (section === "must") {
        const kind = constraintKindOf(body);
        if (kind && kind !== "integrations" && !st.item) { add({ ...base, kind: "constraint", constraintKind: kind, text: clean(body) }); continue; }
        add({ ...base, kind: "mustHave", priority: priorityOf(body, sectionPriority ?? "must"), text: mustText(body.replace(/^\*\*([^*]+)\*\*/, "$1"), ctx.productName) });
        continue;
      }
      if (section === "exclusion") { add({ ...base, kind: "exclusion", text: clean(body) }); continue; }
      if (section === "constraint") { add({ ...base, kind: "constraint", constraintKind: constraintKindOf(t, true)!, text: clean(body) }); continue; }
      if (section === "workflow") { add({ ...base, kind: "workflow", text: clean(body) }); continue; }

      // no section that says it: the statement's own words decide
      if (/\bfalls? from\b|\brises? from\b|\bfrom \d[^.]* to \d/i.test(t) && /\b(if it works|success|measured|target)\b/i.test(t)) {
        successes.push(clean(t.replace(/^(if it works|success is measured as)[,:]?\s*/i, "")));
        continue;
      }
      if (TODAY.test(t) && !/^(what we need|we need)\b/i.test(t)) continue;
      if (EXCLUDE.test(t)) { add({ ...base, kind: "exclusion", text: clean(t) }); continue; }
      const access = /\bcan give us (read )?access to (.+)$/i.exec(t);
      if (access) { add({ ...base, kind: "constraint", constraintKind: "integrations", text: clean(`Read access to ${access[2]!}`) }); continue; }
      if (label && /^peak (times?|hours?|days?|season)$/i.test(label[1]!.trim())) {
        add({ ...base, kind: "constraint", constraintKind: "other", text: clean(`${label[1]!.trim()} are ${label[2]!.replace(/[.]+$/, "")}`.replace(/^(\w)/, (c) => c.toUpperCase())) });
        continue;
      }
      const ck = constraintKindOf(t);
      if (ck && (MUST.test(t) || ck !== "integrations" || /has to fit|must fit/i.test(t))) {
        add({ ...base, kind: "constraint", constraintKind: ck, text: clean(t.split(/;\s+/)[0]!) });
        continue;
      }
      if (ROUTINE.test(t) && ACTOR.test(t) && !/\?$/.test(t)) { add({ ...base, kind: "workflow", text: clean(t) }); continue; }
      if (MUST.test(t) && t.length >= 20 && !/\?$/.test(t) && !/^(would like to see|let'?s|please|could you)\b/i.test(t)) {
        add({ ...base, kind: "mustHave", priority: priorityOf(t, "must"), text: mustText(t, ctx.productName) });
      }
    }
  }

  // the systems it must work with: one integrations constraint with what the project does not name yet
  if (systems.length) {
    const have = ctx.details.constraints.filter((c) => c.kind === "integrations").map((c) => c.text).join("; ");
    const missing = systems.filter((s) => !have || overlap(wordsOf(s.text), wordsOf(have)) < Math.max(1, Math.ceil(wordsOf(s.text).size * 0.6)));
    if (missing.length) {
      const names = missing.map((s) => s.text.replace(/^(The|A|An|Our) /, (m) => m.toLowerCase()));
      add({ kind: "constraint", constraintKind: "integrations", text: `${have ? "Also work with" : "Work with"} ${listOf(names)}`, priority: "must", sourceRef: missing[0]!.doc.ref, sourceName: missing[0]!.doc.name });
    }
  }
  if (!ctx.goal.trim() && goals.length) {
    const g = mustText(goals[0]!.text, ctx.productName).replace(/[.]+$/, "");
    const s = successes.find(Boolean);
    add({ kind: "goal", text: s ? `${g}, so that ${s.charAt(0).toLowerCase()}${s.slice(1)}` : g, priority: "must", constraintKind: "other", sourceRef: goals[0]!.doc.ref, sourceName: goals[0]!.doc.name });
  }
  if (!ctx.users.trim() && users.length) {
    const names = users.slice(0, 5).map((u, i) => (i === 0 ? u.text : /^[A-Z]{2,}/.test(u.text) ? u.text : u.text.charAt(0).toLowerCase() + u.text.slice(1)));
    add({ kind: "users", text: listOf(names), priority: "must", constraintKind: "other", sourceRef: users[0]!.doc.ref, sourceName: users[0]!.doc.name });
  }

  return newFindings(found, ctx);
}

/** The findings without what the project has already and without repeats, at most FINDINGS_MAX of a kind (also for
 *  the findings Claude writes, see ai.ts). */
export function newFindings(found: readonly Finding[], ctx: ExtractContext): Finding[] {
  const have: Record<SuggestionKind, string[]> = {
    mustHave: ctx.details.mustHaves.map((m) => m.text),
    workflow: ctx.details.workflows,
    exclusion: ctx.details.exclusions,
    constraint: ctx.details.constraints.map((c) => c.text),
    goal: ctx.goal ? [ctx.goal] : [],
    users: ctx.users ? [ctx.users] : [],
  };
  const out: Finding[] = [];
  const per = new Map<SuggestionKind, number>();
  for (const f of found) {
    if (have[f.kind].some((h) => sameFinding(h, f.text))) continue;
    if (f.kind === "mustHave" && have.constraint.some((h) => sameFinding(h, f.text))) continue;
    const related = (o: Finding) => o.kind === f.kind || (o.kind === "constraint" && f.kind === "mustHave") || (o.kind === "mustHave" && f.kind === "constraint");
    if (out.some((o) => related(o) && sameFinding(o.text, f.text))) continue;
    if ((per.get(f.kind) ?? 0) >= FINDINGS_MAX[f.kind]) continue;
    per.set(f.kind, (per.get(f.kind) ?? 0) + 1);
    out.push(f);
  }
  return out;
}
