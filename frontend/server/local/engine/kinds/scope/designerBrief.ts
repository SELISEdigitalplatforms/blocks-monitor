// The design brief: written by the business analyst inside design.generate, right before the screens are drawn. It
// gathers everything Business Analysis recorded (the product, its objective, its users, devices, every requirement with
// its acceptance criteria, workflows, what is left out, constraints, the answered questions) and the style direction
// chosen for the product with its reason. It is saved as design-brief.md next to the design's other handoff files
// (and listed in "What MADP produced"), and the designer works from it together with the house principles, the chosen
// style direction and the screen recipes (designKit.ts).
//
// The style: one short call through the engine's JSON runner (aiJson) picks a direction from the catalogue; an answer
// that names no direction of the catalogue, or no answer at all, gives the default direction of styles/README.md with
// the reason "closest general fit". A revision keeps the previous design's direction unless the person's feedback asks
// for a different look, style or colour mood; then the direction is chosen again with that feedback, and the brief
// says so. The choice is recorded per job (design-style.json), so a resumed job draws with the same direction.
//
// Never part of the design intent that is hashed (designIntentOf / factoryDesignSource): an approved design stays
// approved whatever direction a later brief would choose.
import fs from "node:fs";
import path from "node:path";
import { JobGone, type JobRun } from "../../run.ts";
import { aiJson } from "../../ai/index.ts";
import type { DesignRows } from "../../../../../src/domain/factoryDesign.ts";
import { briefFacts } from "../../../../../src/domain/projectBrief.ts";
import { detailsFromRow } from "../../../../../src/domain/setupDetails.ts";
import { constraintText, extraFromRow, groupExtras, setupRecords, type ExtraRecord } from "../../../../../src/domain/requirementsExtras.ts";
import { projectTypeOf, TYPE_LABEL } from "../../../../../src/domain/projectType.ts";
import { bytesOf, selectRecipes, type DesignKit, type DesignRecipe, type DesignStyle } from "./designKit.ts";

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const line = (s: string): string => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ------------------------------------------------------------------------------------------------- the facts

export interface DesignBriefFacts {
  name: string;
  description: string;
  goal: string;
  objective: { statement: string; criteria: string[] };
  users: string;
  roles: string[];
  industry: string;
  region: string;
  productType: string;
  /** Phone frames are needed when the requirements, the answers or the setup mention phone use. */
  phone: { needed: boolean; evidence: string[]; leftOut: string[] };
  requirements: { key: string; title: string; text: string; criteria: string[]; priority: string }[];
  mustHaves: { text: string; priority: string }[];
  workflows: { title: string; who: string; steps: string[] }[];
  exclusions: string[];
  constraints: string[];
  brand: string[];
  languages: string[];
  accessibility: string[];
  formats: string[];
  answers: { number: number; question: string; answer: string }[];
  /** An existing product: what should change. */
  changes: string;
}

const PHONE = /\b(mobile|phones?|smartphones?|iphones?|android|ios|tablets?|on the go|responsive)\b/i;
const BRAND = /\b(brand(?:ing|ed)?|colou?rs?|logos?|typefaces?|fonts?|palette|corporate identity|style ?guide)\b|#[0-9a-f]{6}\b/i;
const LANGUAGES = /\b(languages?|multilingual|bilingual|translat\w*|locali[sz]\w*)\b/i;
const ACCESSIBILITY = /\b(accessib\w*|wcag|screen readers?|a11y|contrast|colou?r ?blind\w*|keyboard|dyslexi\w*|low vision|large text)\b/i;
const FORMATS = /\b(currenc(?:y|ies)|CHF|EUR|USD|GBP|BDT|date formats?|time ?zones?|decimal|thousands separator|regional formats?|locale)\b|[€£]/i;

/** Sentences of the texts that match, each once, in order. */
function mentions(texts: readonly { text: string; where: string }[], re: RegExp, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    for (const raw of t.text.split(/(?<=[.!?])\s+|\n+/)) {
      const s = line(raw.replace(/^[-*•\s]+/, ""));
      if (!s || !re.test(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${clip(s, 280)}${t.where ? ` (${t.where})` : ""}`);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Everything Business Analysis recorded about the product, from the engine's rows. */
export function designBriefFacts(p: DesignRows): DesignBriefFacts {
  const project = p.project;
  const objective = p.objective() ?? null;
  const f = briefFacts(project, { notes: p.rows("DocNote"), clarifications: p.rows("Clarification") });
  const setup = detailsFromRow(project);
  const extraRows = p.rows("RequirementExtra");
  const extras: ExtraRecord[] = extraRows.length
    ? extraRows.filter((r) => r.IsDeleted !== true).map(extraFromRow).filter((e): e is ExtraRecord => e !== null)
    : setupRecords(setup);
  const by = groupExtras(extras);
  const requirements = p.requirements().filter((r) => r.Status !== "dropped" && r.IsDeleted !== true).map((r) => ({
    key: str(r.Key) || str(r.ItemId), title: line(str(r.Title)), text: str(r.Text).trim(), criteria: strs(r.AcceptanceCriteria).map(line).filter(Boolean), priority: str(r.Priority),
  }));
  const workflows = by.workflow.map((w) => ({ title: line(w.title), who: line(w.who), steps: w.steps.map(line).filter(Boolean) }));
  const answers = p.rows("Clarification").filter((c) => c.IsDeleted !== true && c.Status === "answered" && str(c.Answer).trim())
    .map((c) => ({ number: typeof c.Number === "number" ? c.Number : 0, question: line(str(c.Question)), answer: str(c.Answer).trim() }))
    .sort((a, b) => a.number - b.number);
  const constraints = by.constraint.map((c) => line(constraintText(c))).filter(Boolean);
  const languageConstraints = by.constraint.filter((c) => c.constraintKind === "languages").map((c) => line(constraintText(c)));
  const reqTexts = requirements.map((r) => ({ text: [r.title, r.text, ...r.criteria].join("\n"), where: r.key }));
  const answerTexts = answers.map((a) => ({ text: a.answer, where: a.number ? `answer to Q${a.number}` : "an answer" }));
  const setupTexts = [
    { text: f.description, where: "description" }, { text: f.goal, where: "goal" }, { text: f.targetUsers, where: "users" },
    { text: str(objective?.Statement), where: "objective" },
    ...setup.mustHaves.map((m) => ({ text: m.text, where: "setup" })),
    ...workflows.map((w) => ({ text: [w.title, w.who, ...w.steps].join("\n"), where: "workflow" })),
    ...setup.changeTags.map((t) => ({ text: t, where: "setup" })),
    { text: str(project.IntendedChanges), where: "setup" },
  ];
  const constraintTexts = constraints.map((c) => ({ text: c, where: "constraint" }));
  const all = [...setupTexts, ...reqTexts, ...answerTexts, ...constraintTexts];
  const phoneEvidence = mentions(all, PHONE, 6);
  return {
    name: line(str(project.Name)) || "The product",
    description: f.description,
    goal: f.goal,
    objective: { statement: str(objective?.Statement).trim(), criteria: strs(objective?.AcceptanceCriteria).map(line).filter(Boolean) },
    users: f.targetUsers,
    roles: [...new Set(workflows.map((w) => w.who).filter(Boolean))],
    industry: line(str(project.ClientIndustry)),
    region: line(str(project.ClientRegion)),
    productType: TYPE_LABEL[projectTypeOf(str(project.RepoMode))],
    phone: { needed: phoneEvidence.length > 0, evidence: phoneEvidence, leftOut: by.exclusion.map((e) => line(e.title)).filter((t) => PHONE.test(t)) },
    requirements,
    mustHaves: setup.mustHaves.map((m) => ({ text: line(m.text), priority: m.priority })),
    workflows,
    exclusions: by.exclusion.map((e) => line(e.title)).filter(Boolean),
    constraints,
    brand: mentions(all, BRAND, 8),
    languages: [...new Set([...languageConstraints, ...mentions([...reqTexts, ...answerTexts, ...setupTexts], LANGUAGES, 6)])],
    accessibility: mentions(all, ACCESSIBILITY, 6),
    formats: mentions(all, FORMATS, 6),
    answers,
    changes: str(project.IntendedChanges).trim(),
  };
}

/** The words of the product the screen recipes are matched against. */
export function productWords(f: DesignBriefFacts): string {
  return [f.description, f.goal, f.objective.statement, ...f.requirements.flatMap((r) => [r.title, r.text, ...r.criteria]),
    ...f.workflows.flatMap((w) => [w.title, ...w.steps]), ...f.mustHaves.map((m) => m.text), f.phone.needed ? "mobile phone" : ""].join("\n");
}

// ------------------------------------------------------------------------------------------------- the style

export type StyleHow = "chosen" | "default" | "kept" | "changed" | "keptAfterFeedback" | "keptUnchecked";
const HOWS: readonly StyleHow[] = ["chosen", "default", "kept", "changed", "keptAfterFeedback", "keptUnchecked"];
/** What the design records about its style direction (PrototypeJson.style and design-style.json). */
export interface StyleChoice { styleId: string; styleName: string; reason: string }
export interface StyleRecord extends StyleChoice {
  version: 1;
  how: StyleHow;
  /** The previous design's direction, on a revision. */
  previousStyleId: string | null;
  previousStyleName: string | null;
}
export const FALLBACK_REASON = "closest general fit";

/** Whether design feedback may ask for a different look, style or colour mood (and so for the direction to be chosen
 *  again). Wide on purpose: a yes only starts the short check, which says itself whether the feedback asks for a
 *  different look; a no keeps the direction without asking. */
const LOOK = /\b(look(?:s|ing)?(?: and feel)?|feel|style[sd]?|styling|theme[sd]?|colou?r(?:s|ful|ing)?|palette|mood|vibe|aesthetic\w*|visual(?:s|ly)?|brand(?:ing)?|dark(?:er)?|light(?:er)?|bright(?:er)?|vibrant|muted|bold(?:er)?|playful|serious|corporate|premium|luxur\w*|minimal\w*|modern|classic|warm(?:er)?|cool(?:er)?|calm(?:er)?|friendl(?:y|ier)|fun(?:ner)?|elegant|sleek|clean(?:er)?|dated|old[- ]fashioned|boring|dull|bland|generic|cheerful|sober|pastel|neon|gradients?|typography|fonts?|typefaces?|identity)\b/i;
export const asksForNewLook = (feedback: string): boolean => LOOK.test(feedback);

/** The style a design records in its PrototypeJson, or null. */
export function previousStyleOf(prototypeJson: unknown): StyleChoice | null {
  try {
    const p = typeof prototypeJson === "string" ? JSON.parse(prototypeJson) : prototypeJson;
    const s = p && typeof p === "object" ? (p as Record<string, unknown>).style as Record<string, unknown> | undefined : undefined;
    if (!s || typeof s.styleId !== "string" || !s.styleId || typeof s.styleName !== "string" || typeof s.reason !== "string") return null;
    return { styleId: s.styleId, styleName: s.styleName, reason: s.reason };
  } catch { return null; }
}
/** The choice the design records (PrototypeJson.style): the direction and the reason people read. */
export const styleOfRecord = (r: StyleRecord): StyleChoice => ({ styleId: r.styleId, styleName: r.styleName, reason: r.reason });

const NO_AI_WORDS = /\b(AI|A\.I\.|artificial intelligence|LLM|language model|chatbot)\b/i;

/** The facts the style is chosen from: short, so the call stays cheap. */
function styleFacts(f: DesignBriefFacts) {
  return {
    product: f.name, description: clip(f.description, 900), goal: clip(f.goal || f.objective.statement, 400), users: clip(f.users, 400),
    roles: f.roles.slice(0, 8), industry: f.industry, region: f.region, kind: f.productType, devices: f.phone.needed ? "desktop and phone" : "desktop",
    requirements: f.requirements.slice(0, 40).map((r) => clip(r.title, 120)), constraints: f.constraints.slice(0, 12).map((c) => clip(c, 200)),
    brand: f.brand.slice(0, 6), notIncluded: f.exclusions.slice(0, 10).map((e) => clip(e, 160)),
  };
}

interface StyleAnswer extends StyleChoice { asksForDifferentLook: boolean | null }
/** One short call: the direction of the catalogue that fits the product, or null (no answer, or not a direction of
 *  the catalogue). On a revision it also says whether the feedback asks for a different look. Never throws but for a
 *  cancelled job. */
async function askStyle(run: JobRun, kit: DesignKit, f: DesignBriefFacts, o: { previous?: DesignStyle; feedback?: string }): Promise<StyleAnswer | null> {
  const ids = kit.styles.map((s) => s.id);
  const catalogue = kit.styles.map((s) => ({ id: s.id, name: s.name, summary: s.summary, use_when: s.useWhen, avoid_when: s.avoidWhen, density: s.density }));
  const prompt = [
    "Choose the one style direction from the catalogue that fits this product, its users, its industry and its devices best. Respect each direction's use_when and avoid_when. Brand colours or a typeface the client gave are applied within any direction; they do not decide it alone.",
    o.previous ? `The previous design used the direction "${o.previous.id}" (${o.previous.name}). The person's feedback on it is below. In asksForDifferentLook say whether the feedback asks for a different overall look, style or colour mood (true) or only for changes within the current look, such as content, layout or wording (false). Keep "${o.previous.id}" unless it asks for a different look; then choose the direction that matches what they ask for.` : "",
    "In reason, say in one or two short sentences, for the client, why this direction fits the product and its users. Name no tools and no people.",
    "", `Product: ${JSON.stringify(styleFacts(f))}`, "", `Catalogue: ${JSON.stringify(catalogue)}`,
    o.feedback ? `\nFeedback (quoted, the person's words): ${JSON.stringify(clip(o.feedback, 1500))}` : "",
  ].filter((s) => s !== "").join("\n");
  try {
    const properties: Record<string, object> = { styleId: { type: "string", enum: ids }, reason: { type: "string" }, ...(o.previous ? { asksForDifferentLook: { type: "boolean" } } : {}) };
    return await aiJson<StyleAnswer>(run, {
      task: "design style", role: "You are the business analyst of the product team. You choose the visual style direction the screen designer follows for this product.",
      // without an answer the house's default direction is recorded as such (how: "default"), nothing invented
      prompt, timeoutMs: 60_000, orNull: true,
      schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
      accept: (raw) => {
        const r = raw as { styleId?: unknown; reason?: unknown; asksForDifferentLook?: unknown } | null;
        const style = kit.styles.find((s) => s.id === (typeof r?.styleId === "string" ? r.styleId.trim() : ""));
        const reason = typeof r?.reason === "string" ? line(r.reason) : "";
        if (!style || !reason || (o.previous && typeof r?.asksForDifferentLook !== "boolean")) return null;
        return { styleId: style.id, styleName: style.name, reason: NO_AI_WORDS.test(reason) ? `It suits ${f.name} and its users best among the house style directions.` : clip(reason, 600),
          asksForDifferentLook: o.previous ? r!.asksForDifferentLook as boolean : null };
      },
    });
  } catch (e) {
    if (e instanceof JobGone || run.signal?.aborted) throw e;
    run.log(`design style: no answer (${(e as Error).message})`);
    return null;
  }
}

/** The direction for this design: chosen for the product, or on a revision the previous one unless the feedback asks
 *  for a different look. */
export async function chooseDesignStyle(run: JobRun, kit: DesignKit, f: DesignBriefFacts, o: { previous?: StyleChoice | null; feedback?: string } = {}): Promise<StyleRecord> {
  const feedback = (o.feedback ?? "").trim();
  const prev = o.previous ? kit.styles.find((s) => s.id === o.previous!.styleId) : undefined;
  const record = (s: DesignStyle, reason: string, how: StyleHow): StyleRecord => ({ version: 1, styleId: s.id, styleName: s.name, reason, how,
    previousStyleId: prev?.id ?? o.previous?.styleId ?? null, previousStyleName: prev?.name ?? o.previous?.styleName ?? null });
  if (prev) {
    if (!feedback || !asksForNewLook(feedback)) return record(prev, o.previous!.reason || FALLBACK_REASON, "kept");
    const again = await askStyle(run, kit, f, { previous: prev, feedback });
    if (!again) return record(prev, o.previous!.reason || FALLBACK_REASON, "keptUnchecked");
    // feedback within the current look keeps the direction, whatever the answer named
    if (!again.asksForDifferentLook) return record(prev, o.previous!.reason || FALLBACK_REASON, "kept");
    const style = kit.styles.find((s) => s.id === again.styleId)!;
    return record(style, again.reason, style.id === prev.id ? "keptAfterFeedback" : "changed");
  }
  const chosen = await askStyle(run, kit, f, feedback ? { feedback } : {});
  if (chosen) return record(kit.styles.find((s) => s.id === chosen.styleId)!, chosen.reason, "chosen");
  return record(kit.styles.find((s) => s.id === kit.defaultStyleId) ?? kit.styles[0], FALLBACK_REASON, "default");
}

function readRecord(file: string, kit: DesignKit): StyleRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as StyleRecord;
    const style = kit.styles.find((s) => s.id === r.styleId);
    if (r.version !== 1 || !style || typeof r.reason !== "string" || !HOWS.includes(r.how)) return null;
    return { ...r, styleName: style.name };
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------------- the brief

const HOW: Record<StyleHow, (r: StyleRecord, feedback: boolean) => string> = {
  chosen: () => "Chosen by the business analyst from the house style directions for this product.",
  default: () => "The house default direction, the closest general fit.",
  kept: (_r, feedback) => `Kept from the previous design${feedback ? "; nothing in the feedback asks for a different look" : ""}.`,
  changed: (r) => `Changed for this revision: the feedback asks for a different look${r.previousStyleName ? `, so ${r.previousStyleName} gives way to ${r.styleName}` : ""}.`,
  keptAfterFeedback: (r) => `Kept from the previous design: the feedback asks for a different look, and ${r.styleName} still fits it best, so the feedback is applied within this direction.`,
  keptUnchecked: () => "Kept from the previous design; the feedback is applied within this direction.",
};

/** The design brief as Markdown (design-brief.md). Says only what the records say. */
export function designBriefMarkdown(f: DesignBriefFacts, style: DesignStyle, choice: StyleRecord, o: { feedback?: string; revision?: boolean } = {}): string {
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);
  const list = (items: readonly string[], empty: string) => (items.length ? items.map((i) => `- ${i}`) : [empty]);
  push(`# Design brief: ${f.name}`, "", `_Written by the business analyst for the screen designer from what Business Analysis gathered${o.revision ? ", for a revision of the previous design" : ""}._`, "");

  push("## The product", "", f.description || "No description of the product was recorded.", "");
  push(`- Kind of product: ${f.productType}`);
  if (f.industry) push(`- Industry: ${f.industry}`);
  if (f.region) push(`- Region: ${f.region}`);
  if (f.changes) push(`- What should change: ${line(f.changes)}`);
  push("");

  push("## Objective", "", f.objective.statement || f.goal || "No objective was recorded.", "");
  if (f.objective.statement && f.goal && line(f.goal) !== line(f.objective.statement)) push(`Goal in the client's words: ${f.goal}`, "");
  if (f.objective.criteria.length) push("The objective is met when:", ...f.objective.criteria.map((c) => `- ${c}`), "");

  push("## Who uses it", "", f.users || "The users were not described.", "");
  if (f.roles.length) push(`Roles in the workflows: ${f.roles.join(", ")}.`, "");

  push("## Devices", "", "- Desktop: a 1440 px frame for every screen.");
  if (f.phone.needed) push("- Phone: 390 px frames of the key flows. Phone use is mentioned in:", ...f.phone.evidence.map((e) => `  - ${e}`));
  else push("- Phone: not mentioned in the requirements, the answers or the setup, so no phone frames are required.");
  if (f.phone.leftOut.length) push(`- Left out of this version: ${f.phone.leftOut.map((e) => `"${e}"`).join(", ")}.`);
  push("");

  push(`## Requirements (${f.requirements.length})`, "");
  if (!f.requirements.length) push("No requirements were recorded.", "");
  for (const r of f.requirements) {
    push(`### ${r.key}. ${r.title || "Untitled requirement"}${r.priority ? ` _(${r.priority})_` : ""}`, "");
    if (r.text && line(r.text) !== r.title) push(r.text, "");
    if (r.criteria.length) push(...r.criteria.map((c, i) => `- AC${i + 1}: ${c}`), "");
  }
  if (f.mustHaves.length) push("## Must-haves from the setup", "", ...f.mustHaves.map((m) => `- ${m.text}${m.priority ? ` _(${m.priority})_` : ""}`), "");

  push("## Workflows", "");
  if (f.workflows.length) for (const w of f.workflows) push(`- **${w.title || "Workflow"}**${w.who ? ` (${w.who})` : ""}${w.steps.length ? `: ${w.steps.join(" → ")}` : ""}`);
  else push("No workflows were recorded.");
  push("", "## Not included", "", ...list(f.exclusions, "Nothing was set aside."), "");

  push("## Constraints", "", ...list(f.constraints, "No constraints were recorded."), "");
  push("### Brand", "", ...list(f.brand, "No brand colours, logo or typeface were given: the style direction sets them."), "");
  push("### Languages", "", ...list(f.languages, "No languages were named: design in English."), "");
  push("### Accessibility", "", "- WCAG AA contrast in light and dark, visible focus, never colour alone for meaning (house principles).", ...f.accessibility.map((a) => `- ${a}`), "");
  push("### Regional formats", "");
  push(f.region ? `- Dates, times, numbers and money in the format of ${f.region}.` : "- No region was recorded: use one consistent regional format for dates, numbers and money.");
  push(...f.formats.map((x) => `- ${x}`), "");

  push("## Answered questions", "");
  if (f.answers.length) for (const a of f.answers) push(`- **${a.number ? `Q${a.number}. ` : ""}${a.question}** ${line(a.answer)}`);
  else push("No questions were answered yet.");
  push("");

  push(`## Style direction: ${style.name}`, "");
  if (style.summary) push(style.summary, "");
  push(`- Why: ${choice.reason}`);
  push(`- How it was chosen: ${HOW[choice.how](choice, !!(o.feedback ?? "").trim())}`);
  if (style.density) push(`- Density: ${style.density}`);
  push(`- The designer follows ${style.file} together with the house principles (PRINCIPLES.md); a principle wins over the style.`, "");

  const feedback = (o.feedback ?? "").trim();
  if (feedback) push("## Feedback for this revision", "", ...feedback.split(/\r?\n/).map((l) => `> ${l}`), "");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

// ------------------------------------------------------------------------------------------------- preparing a job

export interface PreparedDesignBrief {
  facts: DesignBriefFacts;
  style: DesignStyle;
  record: StyleRecord;
  /** design-brief.md as written. */
  brief: string;
  /** The recipes for this product within their budget (designKit.ts selectRecipes). */
  recipes: DesignRecipe[];
}
export const DESIGN_BRIEF_FILE = "design-brief.md";
export const DESIGN_STYLE_FILE = "design-style.json";

/** The brief of this job in its artifacts folder: the recorded style direction (chosen once per job; a resumed job
 *  keeps it), the brief written from the current records. With `choose` false (a recorded result only being saved) no
 *  direction is chosen: a job that drew before it had a brief gets none. */
export async function prepareDesignBrief(run: JobRun, dir: string, kit: DesignKit, o: { prototypeJson: unknown; feedback: string; revision: boolean; choose: boolean }): Promise<PreparedDesignBrief | null> {
  const recordFile = path.join(dir, DESIGN_STYLE_FILE);
  const facts = designBriefFacts(run.p as unknown as DesignRows);
  let record = readRecord(recordFile, kit);
  if (!record) {
    if (!o.choose) return null;
    record = await chooseDesignStyle(run, kit, facts, { previous: previousStyleOf(o.prototypeJson), feedback: o.feedback });
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
  }
  const style = kit.styles.find((s) => s.id === record!.styleId)!;
  const brief = designBriefMarkdown(facts, style, record, { feedback: o.feedback, revision: o.revision });
  fs.writeFileSync(path.join(dir, DESIGN_BRIEF_FILE), brief);
  run.log(`design brief: ${style.id} (${record.how}), ${facts.requirements.length} requirement(s), phone ${facts.phone.needed ? "yes" : "no"}`);
  return { facts, style, record, brief, recipes: selectRecipes(kit.recipes, productWords(facts)) };
}

// ------------------------------------------------------------------------------------------------- the designer's prompt

/** A system prompt goes to the Claude CLI as one argument; Linux allows 128 KiB per argument. */
export const DESIGNER_SYSTEM_MAX_BYTES = 120_000;
const BRIEF_MAX_BYTES = 40_000;
const BRIEF_REST = "\n\n(The brief goes on in design-brief.md in the working directory: read all of it before planning.)";

/** The text cut at a line end so it takes at most `max` bytes. */
function clipBytes(text: string, max: number, note: string): string {
  if (bytesOf(text) <= max) return text;
  const room = Math.max(0, max - bytesOf(note));
  let used = 0;
  const kept: string[] = [];
  for (const l of text.split("\n")) {
    const b = bytesOf(l) + 1;
    if (used + b > room) break;
    kept.push(l);
    used += b;
  }
  return `${kept.join("\n").trimEnd()}${note}`;
}

/** The designer's system prompt: SKILL.md (Figma screens only), the house principles, the chosen style direction, the
 *  screen recipes and the design brief, then the job's own instructions. Within DESIGNER_SYSTEM_MAX_BYTES: the brief
 *  comes before the recipes when room is short (the complete brief is in the working directory). */
export function designerSystem(o: { kit: DesignKit; prepared: PreparedDesignBrief | null; instructions: string; withSkill: boolean }): string {
  const { kit, prepared } = o;
  const principles = `## House design principles\n\nThese apply to every screen whatever the style direction. When the style direction and a principle disagree, the principle wins.\n\n${kit.principles}`;
  // a job that started drawing before it had a brief resumes without one, in the look it already has
  if (!prepared) return [o.withSkill ? kit.skill : "", principles, o.instructions].filter(Boolean).join("\n\n");
  const style = `## The chosen style direction: ${prepared.style.name}\n\nFollow this direction for colour, typography, density, shape and character. Why it was chosen: ${prepared.record.reason}\n\n${prepared.style.text}`;
  const fixed = [o.withSkill ? kit.skill : "", principles, style, o.instructions].filter(Boolean);
  let room = DESIGNER_SYSTEM_MAX_BYTES - fixed.reduce((n, s) => n + bytesOf(s) + 2, 0) - 400;
  const briefHead = "## The design brief\n\nThe business analyst wrote this brief from everything Business Analysis gathered; it is design-brief.md in the working directory. Design from it: the product, its users and devices, every requirement, the constraints and the chosen style direction.\n\n";
  const brief = clipBytes(`${briefHead}${prepared.brief.trim()}`, Math.max(2_000, Math.min(BRIEF_MAX_BYTES, room)), BRIEF_REST);
  room -= bytesOf(brief);
  const recipes: string[] = [];
  const recipeHead = "## Screen recipes\n\nThe house structures for the kinds of screen this product needs. Build each screen's structure from its recipe and style it with the chosen direction.\n\n";
  let used = bytesOf(recipeHead);
  for (const r of prepared.recipes) {
    const b = bytesOf(r.text) + 2;
    if (used + b > room) continue;
    recipes.push(r.text);
    used += b;
  }
  const recipeSection = recipes.length ? `${recipeHead}${recipes.join("\n\n")}` : "";
  return [o.withSkill ? kit.skill : "", principles, style, recipeSection, brief, o.instructions].filter(Boolean).join("\n\n");
}
