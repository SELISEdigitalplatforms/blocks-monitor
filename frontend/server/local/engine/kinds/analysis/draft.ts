// requirements.draft (the first draft of Requirements v1): requirements from the wishes and constraints of the notes
// and the brief, the accepted decisions, the technical targets and the answered questions (their answers become
// acceptance criteria), plus the objective with its high-level description and architecture outline.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { JobRun } from "../../run.ts";
import { num, str, strs } from "../../context.ts";
import { cap, clip, listOf, lower, sentence, wordsOf } from "../../text.ts";
import { actorLabel, mainActor, readFacts, type Fact, type Facts } from "./facts.ts";
import { asStatement, clausesOf, isVerb, startsWithVerb, thingsIn, thirdPerson, titleOf } from "./grammar.ts";
import { before, similar } from "./own.ts";
import { techCandidates } from "./technical.ts";
import { descriptionOf, goalChipsOnly, isNotSure, setupOf, suggestionFor } from "./setup.ts";
import { CONSTRAINT_LABEL } from "../../../../../src/domain/setupDetails";
import { ctxFor, productNounOf, topicById, topicsByPosition, topicsOf, type Category } from "./topics.ts";

export interface PlannedReq {
  local: string;
  key: string;
  Title: string;
  Text: string;
  Category: Category;
  Priority: "must" | "nice" | "later";
  AcceptanceCriteria: string[];
  SourceRefs: string[];
}

interface Candidate {
  title: string;
  text: string;
  category: Category | null;
  priority: "must" | "nice" | "later";
  sources: string[];
  criteria: string[];
  /** The line it came from (for its topics and numbers). */
  line: string;
  origin: "note" | "brief" | "decision" | "tech" | "answer" | "baseline";
  /** The topic it was made for (answers and baselines). */
  topic?: string;
  /** The priority the client gave the must-have in the setup: it wins over the priority of a twin from the notes. */
  setPriority?: "must" | "nice" | "later";
}

const LATER = /\b(later|phase 2|second phase|nice to have|optional|if possible|in a later)\b/i;

function categoryOf(text: string, fallback: Category = "functional"): Category {
  const t = text.toLowerCase();
  if (/\b(switzerland|swiss|data cent(?:re|er)|hosting|response|seconds|offline|reception|peak|availability|performance|keeps? working)\b/.test(t)) return "nfr";
  if (/\b(login|log in|sign in|password|account|permission|role|bank details|four-eyes|secrecy|access)\b/.test(t)) return "security";
  if (/\b(erp|sap|abacus|bexio|crm|sharepoint|interface|api|export|import|provider|software|order portal)\b/.test(t)) return "integration";
  if (/\b(migrat|history|archive|retention|take over|imported)\w*/.test(t)) return "data";
  const topic = topicsOf(t)[0];
  return topic?.category && topic.category !== "other" ? topic.category : fallback;
}

/** "Suppliers upload themselves" -> "Suppliers upload certificates themselves". */
function fillObject(clause: string, facts: Facts): string {
  const m = /^(.*?\b(?:upload|register|report|sign|enter|book)s?)\s+(themselves|on their own|by themselves)$/i.exec(clause);
  if (!m) return clause;
  const th = thingsIn(facts.all, 2);
  return th.length ? `${m[1]} ${listOf(th)} ${m[2]}` : clause;
}

function todayContext(c: { title: string; text: string }, facts: Facts): string {
  const w = wordsOf(`${c.title} ${c.text}`);
  let best: { text: string; score: number } | null = null;
  for (const l of facts.lines) {
    if (l.kind !== "today") continue;
    let shared = 0;
    for (const x of l.words) if (w.has(x)) shared += 1;
    if (shared >= 2 && (!best || shared > best.score)) best = { text: l.text, score: shared };
  }
  if (!best) return "";
  const t = best.text.replace(/^today\s*[:,]?\s*/i, "").replace(/[.;]+$/, "");
  return /\btoday\b/i.test(t) ? ` ${sentence(t)}` : ` Today ${/^[A-Z]{2}|^[A-Z][a-z]+ [A-Z]/.test(t) ? t : lower(t)}.`;
}

/** "Markus wants a first look…": a person's own wish about the project, not a requirement of the product. */
function aboutAPerson(clause: string, facts: Facts): boolean {
  const first = clause.trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Z][a-z]+$/.test(first)) return false;
  if (facts.actors.some((a) => a.name.toLowerCase() === first.toLowerCase())) return false;
  return /^(\w+)\s+(wants?|will|would|asks?|needs?|checks?|expects?|prefers?)\b/i.test(clause.trim()) && !/^(the|a|an|each|every|all|our|their)$/i.test(first);
}

const MODAL = /\b(must|should|shall|needs? to|has to|have to|may not|cannot)\b/i;
/** What the people a product is for do themselves ("upload their certificates", "order online", "book a class"). */
const USER_VERB = /^(upload|register|sign|order|book|see|find|download|pay|receive|choose|pick|repeat|report|request|submit|track|follow|search|view|enter|scan|photograph|capture|read|get|check in|confirm|cancel|change their|add their)\b/i;
/** Verbs of what the product does on its own (it shows, warns, sends, suggests). */
const SYSTEM_VERB = /^(show|display|list|highlight|flag|warn|alert|remind|notify|send|suggest|calculate|match|validate|check that)\b/i;

function fromLines(facts: Facts, productNoun: string): Candidate[] {
  const out: Candidate[] = [];
  const ordered = [...facts.lines.filter((l) => l.source.type !== "brief"), ...facts.lines.filter((l) => l.source.type === "brief")];
  for (const f of ordered) {
    if (f.kind !== "wish" && f.kind !== "constraint" && f.kind !== "agreed") continue;
    // the goal of the setup is the objective's statement, not a requirement of its own
    if (f.heading === "Goal") continue;
    for (const part of clausesOf(f.text)) {
      if (part.split(/\s+/).length < 3 || aboutAPerson(part, facts)) continue;
      // In a constraint, only the parts that constrain ("…; the portal team maintains the code" is a fact).
      if (f.kind === "constraint" && !MODAL.test(part)) continue;
      // what the product itself does ("Show the minutes lost per site", "Send each driver the route") has the product as
      // its subject, not the people it is for
      const raw = /^(must|should|shall|needs? to|has to)\b/i.test(part)
        ? `The ${productNoun} ${part.charAt(0).toLowerCase()}${part.slice(1)}`
        : SYSTEM_VERB.test(part)
          ? `The ${productNoun} ${part.replace(/^(\w+)/, (v) => thirdPerson(v.toLowerCase())).replace(/\b(and|or) (\w+)\b/g, (m, c: string, v: string) => (isVerb(v) && !/s$/.test(v) ? `${c} ${thirdPerson(v.toLowerCase())}` : m))}`
        : /^let\s+\S/i.test(part)
          ? `The ${productNoun} lets ${part.replace(/^let\s+/i, "")}`
        : startsWithVerb(part)
          // the people the product is for do what they do themselves (upload, order, book…); planning, exporting or
          // assigning is the team's work: "the team" never names the wrong people
          ? USER_VERB.test(part)
            ? `${cap(actorLabel(mainActor(facts).name))} ${part.charAt(0).toLowerCase()}${part.slice(1)}`
            : `The ${productNoun} lets the team ${part.charAt(0).toLowerCase()}${part.slice(1)}`
          : part;
      const clause = fillObject(raw, facts);
      const statement = asStatement(clause);
      // a wish written as an action ("Plan delivery slots for each order") keeps its own words as the title: the subject
      // the text adds is a guess, the title should not repeat it
      const title = titleOf(raw !== part && !/^(must|should|shall|needs? to|has to)\b/i.test(part) ? fillObject(cap(part), facts) : statement);
      if (title.length < 10) continue;
      out.push({
        title,
        text: sentence(statement),
        category: f.kind === "constraint" ? categoryOf(statement, "nfr") : null,
        priority: f.priority ?? (LATER.test(f.text) ? "later" : "must"),
        ...(f.priority ? { setPriority: f.priority } : {}),
        sources: f.source.type === "brief" ? [] : [f.source.id],
        criteria: [],
        line: clause,
        origin: f.source.type === "brief" ? "brief" : "note",
      });
    }
  }
  return out;
}

function fromDecisions(run: JobRun, ids: Set<string> | null): Candidate[] {
  return before(run, "Decision")
    .filter((d) => d.Status === "accepted" && (!ids || ids.has(str(d.ItemId))))
    .map((d) => {
      const statement = str(d.Statement) || str(d.Title);
      const criteria = statement.split(/;\s+|\.\s+/).map((s) => s.trim().replace(/\.$/, "")).filter((s) => s.length > 8);
      return {
        title: titleOf(str(d.Title) || statement),
        text: sentence(statement),
        category: categoryOf(`${str(d.Title)} ${statement}`),
        priority: "must" as const,
        sources: [str(d.ItemId), ...(str(d.ClarificationId) ? [str(d.ClarificationId)] : []), ...(str(d.SourceRef) ? [str(d.SourceRef)] : [])],
        criteria,
        line: `${str(d.Title)} ${statement}`,
        origin: "decision" as const,
      };
    });
}

function fromTech(run: JobRun, ids: Set<string> | null): Candidate[] {
  const out: Candidate[] = [];
  for (const t of before(run, "TechDecision")) {
    if (t.Status === "rejected" || (ids && !ids.has(str(t.ItemId)))) continue;
    const area = str(t.Area);
    if (area === "nfr" && str(t.NfrTarget)) {
      out.push({
        title: titleOf(str(t.Title)),
        text: sentence(str(t.Choice) || str(t.Title)),
        category: "nfr",
        priority: "must",
        sources: [str(t.ItemId)],
        criteria: [str(t.NfrTarget).replace(/\.$/, "")],
        line: `${str(t.Title)} ${str(t.Choice)}`,
        origin: "tech",
      });
    } else if (area === "integration") {
      const sys = str(t.IntegrationSystem) || str(t.Title);
      out.push({
        title: titleOf(/^(connection|data exchange|e-signature)/i.test(str(t.Title)) ? str(t.Title) : `Data exchange with ${sys}`),
        text: sentence(str(t.Choice) || `Data is exchanged with ${sys}`),
        category: "integration",
        priority: "must",
        sources: [str(t.ItemId)],
        criteria: [],
        line: `${str(t.Title)} ${str(t.Choice)} ${sys}`,
        origin: "tech",
      });
    }
  }
  return out;
}

/** Splits an answer into criteria: "Photos and PDFs up to 20 MB each, several at once; no Office files." */
function answerCriteria(answer: string): string[] {
  return answer
    .split(/;\s+|\.\s+/)
    .map((s) => cap(s.trim().replace(/[.;]+$/, "")))
    .filter((s) => s.length >= 12 && s.split(/\s+/).length >= 3 && !/^(yes|no|ok|agreed|as (written|described|discussed))\b/i.test(s))
    .slice(0, 3);
}

function topicCriteria(c: Candidate, facts: Facts, productNoun: string, region: string): string[] {
  const out: string[] = [];
  const own = c.topic ? topicById(c.topic) : undefined;
  const list = [...(own ? [own] : []), ...topicsByPosition(`${c.title} ${c.line}`).filter((t) => t !== own)];
  for (const t of list) {
    const list = t.criteria(ctxFor(facts, c.line || c.title, { productNoun, region }));
    for (const x of list) if (out.length < 3) out.push(x);
    if (out.length >= 2) break;
  }
  return out;
}

/** The topic a question is mainly about: the one it names first (with a requirement title, when asked). */
function mainTopic(q: string, withTitle = false) {
  return topicsByPosition(q).filter((t) => !withTitle || t.title)[0];
}

function genericCriteria(c: Candidate): string[] {
  const t = c.title.toLowerCase();
  if (/\b(see|sees|list|lists|visible|overview|glance)\b/.test(t)) return ["The list shows the most recent entries first", "An empty list says that there is nothing to do"];
  if (/\b(keeps? working|during the change)\b/.test(t)) return ["The current functions stay available during the switch-over", "No planned downtime during working hours"];
  if (/\b(approv|check)\w*/.test(t)) return ["The decision is recorded with name and time", "The person concerned is informed of the outcome"];
  return ["Works on phone and desktop browsers", "Every change is recorded with name and time"];
}

export function planRequirements(run: JobRun, o?: { max?: number; withObjectiveRefs?: boolean }): PlannedReq[] {
  const refs = (run.input.refs ?? {}) as Record<string, unknown>;
  const idSet = (k: string): Set<string> | null => (Array.isArray(refs[k]) && (refs[k] as unknown[]).length > 0 ? new Set(strs(refs[k])) : null);
  const facts = readFacts(run.p, run.input.refs ? (refs as { docNoteIds?: unknown; docFileIds?: unknown }) : undefined);
  const productNoun = productNounOf(run.p.name, run.p.brief);
  const region = str(run.p.project.ClientRegion);
  const instruction = str(run.input.instruction);

  const answered = before(run, "Clarification").filter((c) => c.Status === "answered" && str(c.Answer).trim() !== "");
  const existing = before(run, "Requirement").filter((r) => r.Status !== "dropped");
  const existingWords = existing.map((r) => wordsOf(`${str(r.Title)} ${str(r.Text)}`));

  let cands: Candidate[] = [...fromLines(facts, productNoun), ...fromDecisions(run, idSet("decisionIds")), ...fromTech(run, idSet("techDecisionIds"))];

  // What a project of this kind needs although nobody wrote it down.
  const mentioned = (id: string) => Boolean(topicById(id)?.match.test(facts.all));
  const baseline: [string, boolean][] = [
    ["login", mentioned("login") || /\b(suppliers|clients|customers|partners|employees)\b/i.test(facts.all)],
    ["reminder", mentioned("expiry") || mentioned("reminder")],
    ["roles", true],
  ];
  for (const [id, wanted] of baseline) {
    const t = topicById(id);
    if (!wanted || !t?.title) continue;
    const ctx = ctxFor(facts, "", { productNoun, region });
    cands.push({ title: titleOf(t.title(ctx)), text: "", category: t.category, priority: "nice", sources: [], criteria: [], line: t.id, origin: "baseline", topic: t.id });
  }

  // One requirement per need: later duplicates give their sources to the first; what is required already is left out.
  const dedupe = (list: Candidate[], into: Candidate[] = []): Candidate[] => {
    for (const c of list) {
      const w = wordsOf(`${c.title} ${c.text}`);
      if (existingWords.some((e) => similar(w, e, 0.5))) continue;
      const twin = into.find((k) => similar(wordsOf(`${k.title} ${k.text}`), w, 0.6) || similar(wordsOf(k.title), wordsOf(c.title), c.origin === "brief" ? 0.45 : 0.6));
      if (twin) {
        if (c.setPriority && !twin.setPriority) {
          twin.priority = c.setPriority;
          twin.setPriority = c.setPriority;
        }
        twin.sources.push(...c.sources);
        if (twin.criteria.length < 2) twin.criteria.push(...c.criteria);
        continue;
      }
      into.push(c);
    }
    return into;
  };
  cands = dedupe(cands);

  // Each answer goes to the one requirement it is about: its main topic (the first one named), else shared words.
  const usedAnswers = new Set<string>();
  for (const a of answered) {
    const q = str(a.Question);
    const main = mainTopic(q);
    let best: { c: Candidate; score: number } | null = null;
    for (const c of cands) {
      const about = `${c.title} ${c.text} ${c.line}`;
      let score = 0;
      if (main && (main.match.test(about) || c.line === main.id)) score += 3;
      const qw = wordsOf(`${q} ${str(a.Answer)}`);
      for (const x of wordsOf(about)) if (qw.has(x)) score += 1;
      if (score >= 3 && (!best || score > best.score)) best = { c, score };
    }
    if (!best) continue;
    best.c.criteria.unshift(...answerCriteria(str(a.Answer)).slice(0, 2));
    best.c.sources.push(str(a.ItemId));
    usedAnswers.add(str(a.ItemId));
  }
  const extra: Candidate[] = [];
  for (const a of answered) {
    if (usedAnswers.has(str(a.ItemId))) continue;
    const topic = mainTopic(str(a.Question), true);
    if (!topic) continue;
    const ctx = ctxFor(facts, str(a.Question), { productNoun, region });
    const title = titleOf(topic.title!(ctx));
    const answerText = sentence(str(a.Answer));
    extra.push({
      title,
      text: answerText.length < 70 || !/\b(is|are|must|should|gets?|has|have|will|stay|stays|go|goes)\b/i.test(answerText) ? `${sentence(title)} ${answerText}` : answerText,
      category: topic.category === "other" ? null : topic.category,
      priority: "must",
      sources: [str(a.ItemId), ...(str(a.SourceRef) ? [str(a.SourceRef)] : [])],
      criteria: answerCriteria(str(a.Answer)),
      line: `${str(a.Question)} ${str(a.Answer)}`,
      origin: "answer",
      topic: topic.id,
    });
  }
  cands = dedupe(extra, cands);

  // A person's instruction ("focus on the supplier side") moves what it names to the front.
  if (instruction) {
    const iw = wordsOf(instruction);
    const hit = (c: Candidate) => [...wordsOf(`${c.title} ${c.text}`)].some((w) => iw.has(w));
    cands = [...cands.filter(hit).map((c) => ({ ...c, priority: "must" as const })), ...cands.filter((c) => !hit(c))];
  }

  const max = o?.max ?? 10;
  const baselines = cands.filter((c) => c.origin === "baseline");
  const rest = cands.filter((c) => c.origin !== "baseline");
  const chosen = [...rest.slice(0, max), ...baselines].slice(0, Math.max(Math.min(max, rest.length + 1), Math.min(max, 3)));

  const taken = new Set(existing.map((r) => str(r.Key)));
  return chosen.map((c, i) => {
    const textBase = c.text || sentence(c.title);
    const text = clip(`${textBase}${c.origin === "baseline" ? "" : todayContext(c, facts)}`, 5000);
    const criteria: string[] = [];
    const push = (x: string) => {
      const clean = clip(cap(x.trim().replace(/\.$/, "")), 500);
      if (criteria.length < 4 && clean && !criteria.some((y) => similar(y, clean, 0.8) || y === clean) && !similar(clean, c.title, 0.9)) criteria.push(clean);
    };
    for (const x of [...c.criteria, ...topicCriteria(c, facts, productNoun, region)]) push(x);
    if (criteria.length < 2) for (const x of genericCriteria(c)) push(x);
    let key = c.title
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, "")
      .split(/\s+/)
      .filter((w) => !/^(the|a|an|of|for|in|on|and|to|with|their|its|is|are|be)$/.test(w))
      .slice(0, 4)
      .join("-");
    key = key.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `requirement-${i + 1}`;
    let k = key.slice(0, 40).replace(/-+$/, "");
    for (let n = 2; taken.has(k); n++) k = `${key.slice(0, 36)}-${n}`;
    taken.add(k);
    return {
      local: `req-${i}`,
      key: k,
      Title: clip(c.title, 200),
      Text: text,
      Category: c.category ?? categoryOf(`${c.title} ${c.text}`),
      Priority: c.priority,
      AcceptanceCriteria: criteria.slice(0, Math.max(2, Math.min(4, criteria.length))),
      SourceRefs: [...new Set(c.sources.filter(Boolean))],
    };
  });
}

// ---------------------------------------------------------------------------------------------------- objective

export interface PlannedObjective {
  Statement: string;
  AcceptanceCriteria: string[];
  HighLevelMd: string;
  ArchitectureMd: string;
}

function statementOf(run: JobRun, facts: Facts): string {
  const p = run.p;
  // The goal of the setup says it in the client's own words; else the brief's wishes.
  const goal = facts.lines.filter((l) => l.source.type === "brief" && l.heading === "Goal");
  const wishes = goal.length ? goal : facts.lines.filter((l) => l.source.type === "brief" && l.kind === "wish");
  const pick = wishes.length ? wishes : facts.lines.filter((l) => l.kind === "wish").slice(0, 2);
  let s = pick.map((l, i) => (i === 0 ? asStatement(l.text) : lower(asStatement(l.text))).replace(/[.;]+$/, "")).join("; ");
  // a goal of quick picks only ("Sell online, fewer mistakes") reads as a statement with the project's description
  const chips = goalChipsOnly(setupOf(p).goal);
  const about = descriptionOf(p).replace(/[.;!]+$/, "");
  if (chips && about) s = `${about}, to ${listOf(chips)}`;
  if (!s) s = about || `${p.name} is in use`;
  const actor = mainActor(facts);
  const first = actor.name.replace(/[-/]/g, "\\$&");
  if (p.client && actor.count && new RegExp(`^${first}\\b`, "i").test(s)) {
    s = s.replace(new RegExp(`^${first}\\b`, "i"), `${p.client.replace(/\s+(AG|GmbH|SA|Sàrl|Ltd|AG & Co\.? KG)$/, "")}'s ${actor.count} ${actorLabel(actor.name)}`);
  } else if (p.client && !s.includes(p.client)) {
    const firstWord = s.split(/\s+/)[0] ?? "";
    const keepCase = /^[A-Z]{2,}/.test(firstWord) || (/^[A-Z]/.test(firstWord) && !/^(The|A|An|Each|Every|All|Clients?|Customers?|Suppliers?|Employees?|Drivers?|Technicians?|Users?|Staff)$/.test(firstWord));
    s = `At ${p.client.replace(/\s+(AG|GmbH|SA|Sàrl|Ltd)$/, "")}, ${keepCase ? s : lower(s)}`;
  }
  if (p.existingProduct && !/existing/i.test(s)) s = `${s}, on the existing ${productNounOf(p.name, p.brief)}`;
  return clip(sentence(s), 2000);
}

function bullets(items: string[]): string {
  return items.map((x) => `- ${x.replace(/[.;]+$/, "")}`).join("\n");
}

export function planObjective(run: JobRun, reqs: readonly PlannedReq[]): PlannedObjective {
  const facts = readFacts(run.p);
  const p = run.p;
  const all = [...before(run, "Requirement").filter((r) => r.Status !== "dropped").map((r) => ({ Title: str(r.Title), Priority: str(r.Priority), Category: str(r.Category) })), ...reqs];
  const musts = all.filter((r) => r.Priority === "must");
  const criteria = musts
    .filter((r) => r.Category === "functional" || r.Category === "integration" || r.Category === "ux" || !r.Category)
    .slice(0, 3)
    .map((r) => r.Title);
  for (const r of musts) if (criteria.length < 3 && !criteria.includes(r.Title)) criteria.push(r.Title);

  // ## Users
  const users: string[] = [];
  for (const a of facts.actors.filter((x) => !["users"].includes(x.name)).slice(0, 4)) {
    users.push(`${a.count ? `About ${a.count} ` : ""}${a.count ? actorLabel(a.name) : cap(actorLabel(a.name))}${p.client && a === facts.actors[0] ? ` (${p.client})` : ""}`);
  }
  for (const s of facts.stakeholders.slice(0, 3)) users.push(s);
  const flows = musts.filter((r) => !["nfr", "security"].includes(r.Category)).slice(0, 6).map((r) => r.Title);
  const volumes = facts.lines.filter((l) => /\d/.test(l.text) && l.kind === "fact").slice(0, 4).map((l) => l.text);
  const today = facts.lines.filter((l) => l.kind === "today").slice(0, 3).map((l) => cap(l.text.replace(/^today\s*[:,]?\s*/i, "")));
  const later = all.filter((r) => r.Priority === "later").map((r) => r.Title);
  // The setup's own answers: who uses it, the key workflows, what is left out, what to respect, who approves.
  const setup = setupOf(p);
  if (setup.targetUsers && !users.some((u) => similar(u, setup.targetUsers, 0.8))) users.unshift(cap(setup.targetUsers.replace(/[.;]+$/, "")));
  const workflows = setup.workflows.length ? setup.workflows : flows;
  const constraints = setup.constraints.filter((c) => c.text.trim()).map((c) => `${CONSTRAINT_LABEL[c.kind]}: ${c.text.trim()}`);
  // Where the client wasn't sure ("Not sure"), the product manager suggests the usual answer, to confirm or change.
  const suggested: string[] = [];
  for (const c of p.clarifications().filter((x) => x.Status === "deferred" && isNotSure(x.DeferReason))) {
    const q = str(c.Question);
    const topic = topicsByPosition(q)[0];
    const s = suggestionFor(q, topic ? topic.criteria(ctxFor(facts, q, { productNoun: productNounOf(p.name, p.brief), region: str(p.project.ClientRegion) }))[0] : null);
    if (s) suggested.push(`${q.replace(/\s+/g, " ").trim()} Suggested: ${sentence(s)}`);
  }
  const sections = [
    setup.goal ? `## Goal\n${sentence(setup.goal)}` : "",
    users.length ? `## Users\n${bullets(users)}` : "",
    workflows.length ? `## ${setup.workflows.length ? "Key workflows" : "Main flows"}\n${bullets(workflows)}` : "",
    volumes.length ? `## Volumes\n${bullets(volumes)}` : "",
    today.length ? `## Today\n${bullets(today)}` : "",
    later.length ? `## Not in the first phase\n${bullets(later)}` : "",
    setup.exclusions.length ? `## Not included\n${bullets(setup.exclusions)}` : "",
    constraints.length ? `## Constraints\n${bullets(constraints)}` : "",
    setup.approvalOwnerName ? `## Approval\n${setup.approvalOwnerName} approves the result.` : "",
    suggested.length ? `## Suggested where you weren't sure\n${bullets(suggested.slice(0, 8))}` : "",
  ].filter(Boolean);

  // Architecture: the project's technical decisions, else what the technical review would propose.
  const tds = before(run, "TechDecision").filter((t) => t.Status !== "rejected");
  const proposed = techCandidates(run, facts);
  const byArea = (area: string): Row | { Choice: string; NfrTarget?: string; IntegrationSystem?: string } | undefined =>
    tds.find((t) => t.Area === area) ?? proposed.find((t) => t.Area === area);
  const choice = (x: Row | { Choice: string } | undefined) => (x ? str((x as Row).Choice) : "");
  const integrations = [...tds.filter((t) => t.Area === "integration"), ...proposed.filter((t) => t.Area === "integration" && !tds.some((d) => d.Area === "integration"))].map(
    (t) => `${str((t as Row).IntegrationSystem) || str((t as Row).Title)}: ${lower(str((t as Row).Choice))}`,
  );
  const targets = [...tds.filter((t) => str(t.NfrTarget)), ...proposed.filter((t) => t.NfrTarget && !tds.some((d) => d.Area === "nfr"))].map((t) => str((t as Row).NfrTarget));
  const arch = [
    `## Components\n${bullets([choice(byArea("stack")), choice(byArea("security")) ? `Sign-in: ${lower(choice(byArea("security")))}` : "", /\bupload|photo|file|document/i.test(facts.all) ? "Files in Storage, linked to their records" : "", choice(byArea("data"))].filter(Boolean))}`,
    integrations.length ? `## Integrations\n${bullets(integrations)}` : "",
    choice(byArea("hosting")) ? `## Hosting\n${bullets([choice(byArea("hosting"))])}` : "",
    targets.length ? `## Quality targets\n${bullets(targets)}` : "",
  ].filter(Boolean);

  return {
    Statement: statementOf(run, facts),
    AcceptanceCriteria: criteria.length >= 2 ? criteria : [...criteria, "The first milestone is in use by the first group of users"].slice(0, 3),
    HighLevelMd: clip(sections.join("\n\n"), 20000),
    ArchitectureMd: clip(arch.join("\n\n"), 20000),
  };
}

// ---------------------------------------------------------------------------------------------------- look & feel

/** The product manager's first "look & feel" (the screens & design instruction, describe mode), in plain words from
 *  who uses it and where: people review it with the requirements and approve it with them. */
export function planDesignInstruction(run: JobRun): string {
  const p = run.p;
  const setup = setupOf(p);
  const facts = readFacts(p);
  // the person's own words about the users when there are any ("Customers, managers. Event managers and guests…")
  const own = setup.targetUsers.split(/\.\s+/).map((x) => x.trim()).filter(Boolean);
  const users = (own.length > 1 ? own.slice(1).join(", ") : own[0] ?? "") || listOf(facts.actors.slice(0, 2).map((a) => actorLabel(a.name)));
  const text = `${facts.all} ${setup.targetUsers} ${descriptionOf(p)}`;
  const outside = /\b(phones?|mobile|on the go|on site|in the field|drivers?|technicians?|customers?|guests?|the public|shoppers?|visitors?|warehouse|on the road)\b/i.test(text);
  const office = /\b(staff|team|office|managers?|admins?|back office|desk|accountants?|clerks?|planners?|dispatchers?)\b/i.test(text);
  const where = outside && office ? "on a phone for people on the go and on a laptop for the team" : outside ? "on a phone first" : "on a laptop or desktop first, and on a tablet";
  const brand = p.client ? `${p.client.replace(/\s+(AG|GmbH|SA|Sàrl|Ltd)$/, "")}'s own colours and logo` : "your own colours and logo";
  const forWhom = users ? ` for ${lower(users.replace(/[.;]+$/, ""))}` : "";
  if (p.existingProduct) {
    return clip([
      `Keeps the look and feel of today's ${productNounOf(p.name, p.brief)}: new screens fit in with the ones people know.`,
      `Easy to use without training${forWhom}, with clear labels and plain words.`,
      `Works ${where}.`,
    ].join(" "), 2000);
  }
  return clip([
    `Clean, calm and easy to use without training${forWhom}.`,
    `Works ${where}, with large buttons, clear labels and plain words.`,
    `Uses ${brand}; the screens follow the order of the everyday work.`,
  ].join(" "), 2000);
}

/** The Objective row to write: a new one, the empty fields of a draft one, or nothing (confirmed or complete). */
export function objectiveWrite(run: JobRun, planned: PlannedObjective): { mode: "insert"; fields: Row } | { mode: "update"; id: string; fields: Row } | { mode: "none"; id?: string } {
  const row = run.p.rows("Objective")[0];
  if (!row) return { mode: "insert", fields: { ...planned, SpecVersion: 1, Status: "draft" } };
  const id = str(row.ItemId);
  if (row.RequestKey === run.key("objective")) return { mode: "none", id };
  if (row.Status === "confirmed") return { mode: "none" };
  // Filled in by this job before a restart: nothing more to write, but it is still this job's output.
  if (str(row.Statement) === planned.Statement || str(row.HighLevelMd) === planned.HighLevelMd) return { mode: "none", id };
  const patch: Row = {};
  if (!str(row.Statement).trim()) patch.Statement = planned.Statement;
  if (strs(row.AcceptanceCriteria).length === 0) patch.AcceptanceCriteria = planned.AcceptanceCriteria;
  if (!str(row.HighLevelMd).trim()) patch.HighLevelMd = planned.HighLevelMd;
  if (!str(row.ArchitectureMd).trim()) patch.ArchitectureMd = planned.ArchitectureMd;
  if (Object.keys(patch).length === 0) return { mode: "none" };
  if (!num(row.SpecVersion)) patch.SpecVersion = 1;
  return { mode: "update", id, fields: patch };
}

export type { Fact };
