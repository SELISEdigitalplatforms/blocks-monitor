// What the business notes, files and brief of a project say, line by line: open questions, wishes, today's way of
// working, constraints and plain facts, plus the people, systems, technology, volumes and dates they mention. The
// analysis writers (questions, technical proposals, requirements, review) all start from these facts.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { ProjectView } from "../../context.ts";
import { str, strs } from "../../context.ts";
import { overlap, plain, statementsOf, wordsOf } from "../../text.ts";
import { setupLines, setupOf } from "./setup.ts";

/** "excluded": left out on purpose (the setup's "Not included"); settles its topics and never becomes a requirement. */
export type LineKind = "open" | "wish" | "today" | "constraint" | "agreed" | "fact" | "excluded";

export interface Source {
  type: "doc-note" | "doc-file" | "brief";
  id: string;
  /** Who wrote it (the note's or file's creator). */
  by: string;
  title: string;
}

export interface Fact {
  text: string;
  kind: LineKind;
  source: Source;
  heading: string;
  words: Set<string>;
  /** A must-have's priority from the setup (should = nice, could = later). */
  priority?: "must" | "nice" | "later";
}

export interface Actor {
  name: string;
  count?: number;
}

export interface Facts {
  lines: Fact[];
  files: { id: string; name: string; by: string }[];
  actors: Actor[];
  systems: string[];
  stack: string[];
  stakeholders: string[];
  dates: string[];
  /** Everything in one lower-case text (for "is X mentioned at all"). */
  all: string;
}

const OPEN = /^(open|open question|question|unclear|to clarify|to be clarified|tbd|tbc)\s*[:\-–]\s*/i;
const WISH = /^(wish(es)?(\s*\d+)?|goal|need|idea|request)\s*[:\-–]\s*/i;
const TODAY = /^(today|currently|now|problem|pain point|issue)\s*[:\-–]\s*/i;
const RECOMMEND = /^.{0,40}\brecommendations?\s*[:\-–]\s*/i;
const PEOPLE_LINE = /^(call|kick-?off|workshop|meeting|visit|walkthrough|interview|review)\b[^·]{0,60}·\s*/i;
const TODAY_HINT = /\b(today|currently|by hand|by e-?mail|e-?mailed|excel|paper|printed|printouts?|print|shared folder|manual(ly)?|scanned|one by one|chasing|takes about|complain|spend|still|nobody notices|slow|hard to use|work from)\b/i;
const WISH_HINT = /\b(should|wants?|would like|needs? to|shall|wish)\b/i;
const MUST_HINT = /\bmust\b/i;

/** Lines of a markdown note with the heading they stand under. */
function noteLines(md: string): { text: string; heading: string }[] {
  const out: { text: string; heading: string }[] = [];
  let heading = "";
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = plain(h[1]!);
      continue;
    }
    if (/^[-*_]{3,}$/.test(line)) continue;
    const text = plain(line.replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, ""));
    if (text.length >= 8) out.push({ text, heading });
  }
  return out;
}

export function classify(text: string, heading = ""): { kind: LineKind; text: string } {
  let t = text.trim();
  if (OPEN.test(t)) return { kind: "open", text: t.replace(OPEN, "") };
  if (/\?\s*$/.test(t)) return { kind: "open", text: t.replace(/^(question|q)\s*[:\-–]\s*/i, "") };
  if (WISH.test(t)) return { kind: "wish", text: t.replace(WISH, "") };
  if (RECOMMEND.test(t)) return { kind: "wish", text: t.replace(RECOMMEND, "") };
  if (TODAY.test(t)) return { kind: "today", text: t.replace(TODAY, "") };
  if (/^agreed\b/i.test(heading) || /^(agreed|decided|decision)\s*[:\-–]\s*/i.test(t)) {
    t = t.replace(/^(agreed|decided|decision)\s*[:\-–]\s*/i, "");
    return { kind: "agreed", text: t };
  }
  if (MUST_HINT.test(t)) return { kind: "constraint", text: t };
  if (WISH_HINT.test(t)) return { kind: "wish", text: t };
  if (TODAY_HINT.test(t)) return { kind: "today", text: t };
  return { kind: "fact", text: t };
}

const ACTOR_WORDS = [
  "quality assurance", "service partners", "industrial customers", "sales staff", "fiduciary staff", "warehouse staff", "order desk",
  "payroll team", "portal team", "suppliers", "clients", "customers", "drivers", "employees", "employers", "technicians", "partners",
  "dealers", "visitors", "tenants", "patients", "students", "members", "agents", "planners", "auditors", "managers", "admins",
  "administrators", "dispatchers", "dispatch", "purchasing", "finance", "accounting", "staff", "users", "qa",
];

const SYSTEMS: [RegExp, string][] = [
  [/\bSAP S\/4HANA\b/i, "SAP S/4HANA"],
  [/\bSAP Business One\b/i, "SAP Business One"],
  [/\bSAP\b/, "SAP"],
  [/\bAbacus\b/i, "Abacus"],
  [/\bBexio\b/i, "Bexio"],
  [/\bProffix\b/i, "Proffix"],
  [/\bNavision\b/i, "Navision"],
  [/\bDynamics(?: 365)?\b/i, "Microsoft Dynamics"],
  [/\bSalesforce\b/i, "Salesforce"],
  [/\bSharePoint\b/i, "SharePoint"],
  [/\bDATEV\b/i, "DATEV"],
  [/\bGitLab\b/i, "GitLab"],
  [/\be-?signature provider\b/i, "e-signature provider"],
  [/\border portal\b/i, "order portal"],
  [/\bpayroll software\b/i, "payroll software"],
  [/\baccounting software\b/i, "accounting software"],
  [/\bCRM\b/, "CRM"],
  [/\bERP\b/, "ERP"],
];

const STACK: [RegExp, string][] = [
  [/\bLaravel(?: \d+)?\b/i, ""],
  [/\bPHP(?: \d+(?:\.\d+)?)?\b/i, ""],
  [/\bSpring Boot(?: \d+)?\b/i, ""],
  [/\bJava\/Spring\b/i, ""],
  [/\bAngular(?: \d+)?\b/i, ""],
  [/\bReact(?: Native)?\b/, ""],
  [/\bVue(?:\.js)?\b/i, ""],
  [/\.NET(?: \d+)?\b/i, ""],
  [/\bNode(?:\.js)?\b/, ""],
  [/\bDjango\b/i, ""],
  [/\bRuby on Rails\b/i, ""],
  [/\bMySQL\b/i, ""],
  [/\bPostgreSQL\b/i, ""],
  [/\bSQL Server\b/i, ""],
  [/\bOracle\b/i, ""],
  [/\bMongoDB\b/i, ""],
  [/\bjQuery\b/i, ""],
  [/\bBlade\b/, ""],
];

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
const DATE = new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)?\\.?\\s+${MONTH}(?:\\s+\\d{4})?|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`, "i");

function within(ids: unknown, id: string): boolean {
  const list = strs(ids);
  return list.length === 0 || list.includes(id);
}

/** Reads the facts of a project; `refs` (the job's input) limits the notes and files to those the job was given. */
export function readFacts(p: ProjectView, refs?: { docNoteIds?: unknown; docFileIds?: unknown }): Facts {
  const lines: Fact[] = [];
  const stakeholders: string[] = [];
  const add = (text: string, heading: string, source: Source) => {
    const c = classify(text, heading);
    if (c.text.length < 6) return;
    lines.push({ text: c.text.replace(/\s+/g, " ").trim(), kind: c.kind, source, heading, words: wordsOf(c.text) });
  };

  // The setup answers (project fields) are the source of truth; the "Project brief" note repeats them, so a note line
  // that says the same as a setup line is read once.
  const setup = setupLines(setupOf(p));
  const setupWords = setup.map((l) => wordsOf(l.text));
  const repeatsSetup = (w: Set<string>) => w.size > 0 && setupWords.some((s) => s.size > 0 && overlap(s, w) >= Math.max(2, Math.ceil(Math.min(s.size, w.size) * 0.85)));

  for (const n of p.notes()) {
    const id = str(n.ItemId);
    if (refs && !within(refs.docNoteIds, id)) continue;
    const source: Source = { type: "doc-note", id, by: str(n.CreatedByUserId), title: str(n.Title) };
    for (const l of noteLines(str(n.BodyMd))) {
      if (PEOPLE_LINE.test(l.text)) {
        for (const who of l.text.replace(PEOPLE_LINE, "").split(/,\s+(?![^(]*\))/)) if (who.trim()) stakeholders.push(who.trim());
        continue;
      }
      // "Simon's notes from a walkthrough with Beat (staging copy):" introduces the list; it says nothing itself.
      if (/:\s*$/.test(l.text) && l.text.length < 90) continue;
      if (repeatsSetup(wordsOf(l.text))) continue;
      add(l.text, l.heading, source);
    }
  }
  const brief = p.brief;
  const briefSource: Source = { type: "brief", id: p.id, by: str(p.project.CreatedByUserId), title: "Brief" };
  for (const s of statementsOf(brief)) {
    // A brief describes the product to come; only a sentence about today's way of working is "today".
    const today = TODAY_HINT.test(s) && !/\b(instead of|should|wants?|would like)\b/i.test(s);
    const c = classify(s);
    const kind: LineKind = c.kind === "open" ? "open" : today ? "today" : "wish";
    if (c.text.length >= 6) lines.push({ text: c.text.replace(/\s+/g, " ").trim(), kind, source: briefSource, heading: "", words: wordsOf(c.text) });
  }

  const setupSource: Source = { type: "brief", id: p.id, by: str(p.project.CreatedByUserId), title: "Project setup" };
  for (const l of setup) {
    lines.push({ text: l.text.replace(/\s+/g, " ").trim(), kind: l.kind, source: setupSource, heading: l.heading, words: wordsOf(l.text), ...(l.priority ? { priority: l.priority } : {}) });
  }

  const files = p
    .files()
    .filter((f) => !refs || within(refs.docFileIds, str(f.ItemId)))
    .map((f: Row) => ({ id: str(f.ItemId), name: str(f.Name), by: str(f.CreatedByUserId) }));

  const allText = [brief, ...lines.map((l) => l.text), ...files.map((f) => f.name)].join("\n");
  const all = allText.toLowerCase();

  // People and their numbers: "About 140 active suppliers", "850 active clients", "22 drivers on 14 trucks".
  const actors: Actor[] = [];
  const seen = new Set<string>();
  const counted = /\b(\d[\d'’,.]*)\s+(?:active\s+|new\s+|small\s+|registered\s+|business\s+)?([a-z][a-z-]+)/gi;
  for (const m of allText.matchAll(counted)) {
    const noun = m[2]!.toLowerCase();
    if (!ACTOR_WORDS.includes(noun) || seen.has(noun)) continue;
    const n = Number(m[1]!.replace(/['’,]/g, ""));
    if (!Number.isFinite(n) || n <= 1) continue;
    seen.add(noun);
    actors.push({ name: noun, count: n });
  }
  for (const w of ACTOR_WORDS) {
    if (seen.has(w)) continue;
    const re = new RegExp(`\\b${w.replace(/[-/]/g, "\\$&")}\\b`, "i");
    if (re.test(allText)) {
      seen.add(w);
      actors.push({ name: w });
    }
  }
  // "QA" is quality assurance; "staff" and "users" say little when a more precise group is named.
  if (seen.has("qa") && seen.has("quality assurance")) actors.splice(actors.findIndex((a) => a.name === "qa"), 1);
  const precise = actors.filter((a) => !["users", "staff", "qa"].includes(a.name));
  const orderedActors = [...precise, ...actors.filter((a) => !precise.includes(a))];

  const systems: string[] = [];
  for (const [re, name] of SYSTEMS) if (re.test(allText) && !systems.some((s) => s.includes(name) || name.includes(s))) systems.push(name);

  const stack: string[] = [];
  for (const [re] of STACK) {
    const m = re.exec(allText);
    if (m && !stack.some((s) => s.toLowerCase().startsWith(m[0].toLowerCase().split(" ")[0]!))) stack.push(m[0]);
  }

  const dates: string[] = [];
  for (const l of lines) {
    const m = DATE.exec(l.text);
    if (m && !dates.includes(m[1]!)) dates.push(m[1]!);
  }

  return { lines, files, actors: orderedActors, systems, stack, stakeholders, dates, all };
}

/** The group the work is mostly for: the counted one first, else the first named. */
export function mainActor(f: Facts, fallback = "users"): Actor {
  return f.actors.find((a) => a.count !== undefined && !["staff", "users"].includes(a.name)) ?? f.actors[0] ?? { name: fallback };
}

/** A people group named in the text, the counted one first. */
export function actorIn(f: Facts, text: string): string | null {
  const t = text.toLowerCase();
  for (const a of f.actors) if (new RegExp(`\\b${a.name.replace(/[-/]/g, "\\$&")}\\b`).test(t)) return a.name;
  return null;
}

/** A display form of an actor group: QA stays upper case. */
export function actorLabel(name: string): string {
  return name === "qa" ? "QA" : name;
}
