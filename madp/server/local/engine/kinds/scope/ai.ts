// Claude-written scope work (see ../../ai/index.ts): the features and stories of scope.draft, the milestones, the
// success & performance proposals, the second opinion of scope.grill and the cross-cutting tasks of board.plan. Each
// planner answers the writer's own plan type, or null so the writer keeps its built-in plan. The `accept` functions
// are pure and exported for the tests.
import { SCOPE_LIMITS } from "../../../../../src/domain/scope";
import { MILESTONE_LIMITS } from "../../../../../src/domain/milestones";
import { RESPONSE_TIME_CHOICES, SUCCESS_KEYS, VALUE_MAX, type SuccessKey } from "../../../../../src/domain/successTargets";
import { TASK_KINDS } from "../../../../../src/domain/ticketRole";
import type { JobRun } from "../../run.ts";
import { slugOf } from "../../text.ts";
import { aiJson } from "../../ai/index.ts";
import { S, arr, number, obj, oneOf, text, texts } from "../../ai/check.ts";
import { projectMaterial } from "../../ai/material.ts";
import type { FeatureInfo } from "./common.ts";
import { storyText, type DraftFeature, type DraftInput, type DraftStory } from "./draft.ts";
import type { PlannedMilestone } from "./milestones.ts";
import type { Proposal, SuccessFacts } from "./success.ts";
import type { GrillInput, Point } from "./grill.ts";
import type { Task } from "./board.ts";

const PM = "You are Rajiv, the product manager of the product team.";
const ARCHITECT = "You are the solution architect of the product team.";
const PLANNER = "You are the delivery planner of the product team.";
const PRIORITIES = ["must", "nice", "later"] as const;
const half = (h: number): number => Math.round(h * 2) / 2;
/** The answered questions and the decisions settle details: every planner follows them over the documents and never
 *  asks about them again (ai/answers.ts). */
const SETTLED = "- The client's answers and decisions in the project material are settled by the client and override the notes and files: where a document says otherwise, follow the answer (the main call to action, fees, payouts, refunds, who may do what, limits), and never ask about them again.";

/** The project's material for a planner (ai/material.ts): basics, notes, the answered questions and the decisions; the
 *  context digest is left out (the prompt lists the scope itself). */
async function materialOf(run: JobRun, budget: number): Promise<string> {
  const m = await projectMaterial(run, { budget, contextBudget: 0 });
  return `Project material (from the client: setup, the client's answers and decisions, notes):\n${m.text}`;
}
const tagOf = (s: unknown): string => String(s ?? "").replace(/[[\]\s]/g, "").toUpperCase();

/** The scope as a short list with tags (F1 = a feature, F1.S2 = its second story). */
export function scopeList(features: readonly FeatureInfo[]): string {
  return features
    .map((f, i) => [
      `[F${i + 1}] ${f.title} (${f.priority}, ${f.hours} h): ${f.description}`,
      ...f.stories.map((s, n) => `   [F${i + 1}.S${n + 1}] ${s.title} — ${s.text}${s.criteria.length ? ` Checks: ${s.criteria.join("; ")}` : ""} (${s.hours} h)`),
    ].join("\n"))
    .join("\n");
}

/** Feature and story tags in visible text ("Move F3 and F5", "F4.S2: what happens…") become their quoted titles. */
export function untag(t: string, features: readonly FeatureInfo[]): string {
  return t.replace(/[[(]?\bF(\d+)(?:\.S(\d+))?\b[\])]?/g, (m, fi: string, si?: string) => {
    const f = features[Number(fi) - 1];
    const st = f && si ? f.stories[Number(si) - 1] : undefined;
    return st ? `“${st.title}”` : f ? `“${f.title}”` : m;
  }).replace(/^“([^”]+)”:\s*/, "“$1”: ");
}

// ------------------------------------------------------------------------------------------------- features (scope.draft)

export function acceptFeatures(raw: unknown, x: DraftInput): DraftFeature[] | null {
  const o = obj(raw);
  if (!o) return null;
  const reqKeys = new Set(x.requirements.map((r) => r.key));
  const keys = new Set<string>();
  const names = new Set<string>();
  const out: DraftFeature[] = [];
  const keyOf = (name: string) => {
    let key = slugOf(name, 40) || "feature";
    for (let i = 2; keys.has(key); i++) key = `${slugOf(name, 36)}-${i}`;
    keys.add(key);
    return key;
  };
  for (const raw of arr(o.features)) {
    const f = obj(raw);
    const name = f ? text(f.name, SCOPE_LIMITS.featureName, 3) : null;
    if (!f || !name || names.has(name.toLowerCase())) continue;
    const stories: DraftStory[] = [];
    for (const s of arr(f.stories)) {
      const st = obj(s);
      const title = st ? text(st.title, SCOPE_LIMITS.storyTitle, 3) : null;
      if (!st || !title) continue;
      const actor = text(st.actor, SCOPE_LIMITS.storyActor, 2) ?? "user";
      const said = text(st.text, SCOPE_LIMITS.storyText, 8);
      const criteria = texts(st.criteria, 6, SCOPE_LIMITS.criterionChars, 4).map((c) => c.replace(/\.$/, ""));
      stories.push({
        title,
        text: said && /^As (a|an|the)\b/i.test(said) ? said : storyText(actor, `to ${(said ?? title).replace(/^(to|I want to)\s+/i, "").replace(/^\w/, (c) => c.toLowerCase())}`),
        actor,
        criteria,
        hours: half(number(st.hours, 1, 16) ?? 2 + criteria.length * 1.5),
      });
      if (stories.length >= 8) break;
    }
    if (stories.length === 0) continue;
    names.add(name.toLowerCase());
    out.push({
      key: keyOf(name),
      name,
      description: text(f.description, 600, 6) ?? name,
      priority: oneOf(f.priority, PRIORITIES) ?? "must",
      requirementKeys: [...new Set(arr(f.requirementKeys).map(String).filter((k) => reqKeys.has(k)))],
      stories,
      dropped: false,
    });
    if (out.length >= 14) break;
  }
  // a plan that leaves most requirements without a feature is not the plan the team reviews
  const covered = new Set(out.flatMap((f) => f.requirementKeys));
  if (out.length === 0 || covered.size < Math.ceil(reqKeys.size * 0.5)) return null;
  for (const raw of arr(o.notIncluded)) {
    const e = obj(raw);
    const name = e ? text(e.name, 60, 3) : null;
    if (!e || !name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    out.push({ key: keyOf(name), name, description: text(e.reason, SCOPE_LIMITS.excludedReason, 4) ?? "Not part of this scope.", priority: "later", requirementKeys: [], stories: [], dropped: true });
  }
  return out;
}

const FEATURE_SCHEMA = S.obj({
  features: S.list(S.obj({
    name: S.str("Short feature name, at most 50 characters."),
    description: S.str("One or two plain sentences."),
    priority: S.enum(PRIORITIES),
    requirementKeys: S.list(S.str(), 6, "Keys of the requirements it delivers."),
    stories: S.list(S.obj({
      title: S.str("Short action, at most 60 characters, e.g. \"Upload an asset with its licence\"."),
      actor: S.str("Who, singular, e.g. \"seller\"."),
      text: S.str("As a <actor>, I want <what> so that <why>."),
      criteria: S.list(S.str(), 5, "Two to four checks a business person can verify."),
      hours: S.num("Estimate in hours, 1 to 12."),
    }), 6),
  }), 14),
  notIncluded: S.list(S.obj({ name: S.str(), reason: S.str() }), 8),
});

export async function aiFeatures(run: JobRun, x: DraftInput): Promise<DraftFeature[] | null> {
  const reqs = x.requirements.map((r) => `- ${r.key} [${r.priority}, ${r.category || "functional"}] ${r.title}: ${r.text}${r.criteria.length ? ` Checks: ${r.criteria.join("; ")}` : ""}`);
  const material = await materialOf(run, 3000);
  const prompt = [
    `Turn the requirements of ${run.p.name} into the first draft of the scope: features with user stories.`,
    "",
    "Rules:",
    "- One feature for each thing people use; join requirements that belong together. Qualities of the whole product (speed, data protection, hosting) are not features of their own: put them into the checks of the stories they touch.",
    "- Order: the foundation first (accounts, the catalogue or main records), then the main flow, then back office and reports; must before nice before later.",
    "- Every requirement key appears in exactly one feature's requirementKeys.",
    "- Each feature has one to four stories. A story title is a short action; the text is \"As a <actor>, I want … so that …\"; two to four checks from the requirement's criteria; an honest estimate in hours (1 to 12).",
    "- Use the key workflows as stories of the feature they belong to.",
    '- notIncluded: what the setup says is not included, each with the reason in a few words.',
    "- Use the answers to the questions in the stories and their checks, in the answers' own words and numbers (for example the main call to action, the fee a sale pays, when payouts are made, the refund rule).",
    SETTLED,
    "",
    `Requirements:\n${reqs.join("\n")}`,
    x.workflows.length ? `\nKey workflows:\n${x.workflows.map((w) => `- ${w.title}${w.who ? ` (${w.who})` : ""}${w.steps.length ? `: ${w.steps.join(" → ")}` : ""}`).join("\n")}` : "",
    x.exclusions.length ? `\nNot included:\n${x.exclusions.map((e) => `- ${e}`).join("\n")}` : "",
    x.targetUsers ? `\nWho uses it: ${x.targetUsers}` : "",
    "",
    material,
  ].join("\n");
  return aiJson(run, { task: "scope features", role: PM, prompt, schema: FEATURE_SCHEMA, timeoutMs: 90_000, accept: (raw) => acceptFeatures(raw, x) });
}

/** A drafted feature as the scope writers read a stored one (for the milestones before the rows exist). */
export function infoOfDraft(f: DraftFeature, sortOrder: number): FeatureInfo {
  const text = [f.name, f.description, ...f.stories.map((s) => `${s.title} ${s.text} ${s.criteria.join(" ")}`)].join(" ");
  return {
    id: "",
    key: f.key,
    ref: `feature:${f.key}`,
    title: f.name,
    description: f.description,
    priority: f.priority,
    requirementRefs: f.requirementKeys.map((k) => `requirement:${k}`),
    sortOrder,
    stories: f.stories.map((s, n) => ({ id: "", key: `${f.key}-${n + 1}`, title: s.title, text: s.text, actor: s.actor, criteria: s.criteria, hours: s.hours, sortOrder: n })),
    hours: f.stories.reduce((h, s) => h + s.hours, 0),
    words: new Set(),
    text: text.toLowerCase(),
  };
}

// ------------------------------------------------------------------------------------------------- milestones

export function acceptMilestones(raw: unknown, features: readonly FeatureInfo[]): PlannedMilestone[] | null {
  const o = obj(raw);
  if (!o) return null;
  const byTag = new Map(features.map((f, i) => [`F${i + 1}`, f]));
  const placed = new Set<string>();
  const used = new Set<string>();
  const groups: { name: string; goal: string; preview: string; features: FeatureInfo[] }[] = [];
  for (const raw of arr(o.milestones)) {
    const m = obj(raw);
    let name = m ? text(m.name, MILESTONE_LIMITS.name, 3) : null;
    if (!m || !name) continue;
    const mine: FeatureInfo[] = [];
    for (const t of arr(m.features)) {
      const f = byTag.get(tagOf(t));
      if (f && !placed.has(f.ref)) {
        placed.add(f.ref);
        mine.push(f);
      }
    }
    if (mine.length === 0) continue;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name.slice(0, MILESTONE_LIMITS.name - 8)}, part ${k}`;
    used.add(name.toLowerCase());
    const goal = text(m.goal, 480, 10);
    const preview = text(m.preview, 480, 10);
    groups.push({ name: untag(name, features), goal: goal ? untag(goal, features) : `Delivers ${mine.map((f) => f.title.toLowerCase()).join(", ")}.`, preview: preview ? untag(preview, features) : "", features: mine });
    if (groups.length >= MILESTONE_LIMITS.max) break;
  }
  if (groups.length === 0) return null;
  const missing = features.filter((f) => !placed.has(f.ref));
  if (missing.length > Math.ceil(features.length / 3)) return null;
  groups[groups.length - 1]!.features.push(...missing);
  return groups.map((g, i) => ({
    number: i + 1,
    name: g.name,
    goal: g.goal,
    preview: g.preview || `In the preview: ${g.features.map((f) => f.title.toLowerCase()).join(", ")}.`,
    featureRefs: g.features.map((f) => f.ref),
    hours: g.features.reduce((h, f) => h + f.hours, 0),
  }));
}

const MILESTONE_SCHEMA = S.obj({
  milestones: S.list(S.obj({
    name: S.str("At most 50 characters."),
    goal: S.str("One or two sentences: what people can do once it is delivered."),
    preview: S.str('One sentence starting "In the preview, …": what the client can try.'),
    features: S.list(S.str(), 20, 'Feature tags ("F1").'),
  }), 8),
});

export async function aiMilestones(run: JobRun, features: readonly FeatureInfo[], note: string): Promise<PlannedMilestone[] | null> {
  if (features.length === 0) return null;
  const total = features.reduce((h, f) => h + f.hours, 0);
  const material = await materialOf(run, 1500);
  const prompt = [
    `Arrange the features of ${run.p.name} into delivery milestones.`,
    "",
    "Rules:",
    `- ${features.length <= 2 ? "One" : features.length <= 4 ? "Two" : features.length <= 9 ? "Three" : "Three or four"} milestones unless the note asks otherwise; every feature in exactly one milestone.`,
    "- The foundation and the main flow first, so the first preview already shows something people can use; back office, reports and connections next; nice-to-have and later features last.",
    "- Keep the milestones roughly balanced by hours.",
    "- name: what the milestone brings in a few words; goal: what people can do then; preview: what the client tries in that preview.",
    note ? `- The person's note: "${note}"` : "",
    SETTLED,
    "",
    `Features (total ${total} h):\n${scopeList(features).split("\n").filter((l) => !l.startsWith("   ")).join("\n")}`,
    "",
    material,
  ].filter((l) => l !== "").join("\n");
  return aiJson(run, { task: "milestones", role: PLANNER, prompt, schema: MILESTONE_SCHEMA, accept: (raw) => acceptMilestones(raw, features) });
}

/** One change to the current milestone plan (an accepted second-opinion fix): Claude gets the plan and the change and
 *  answers the whole plan; milestones.ts checkChange keeps it only when nothing else moved. */
export async function aiMilestoneChange(run: JobRun, features: readonly FeatureInfo[], current: readonly PlannedMilestone[], change: string): Promise<PlannedMilestone[] | null> {
  if (features.length === 0 || current.length === 0) return null;
  const tag = new Map(features.map((f, i) => [f.ref, `F${i + 1}`]));
  const plan = current.map((m) => `- Milestone ${m.number} "${m.name}": ${m.featureRefs.map((r) => tag.get(r)).filter(Boolean).join(", ")}\n  goal: ${m.goal}\n  preview: ${m.preview}`).join("\n");
  const prompt = [
    `Apply one agreed change to the delivery milestones of ${run.p.name}.`,
    "",
    "Rules:",
    "- Change only what the change says. Every other feature stays in the milestone it is in, in the same order.",
    "- Keep the number and order of the milestones (add one only when the change asks for a new milestone).",
    "- The milestones the change does not touch keep their name, goal and preview word for word; rewrite the goal and preview only of the milestones that gain or lose a feature, so they say what those milestones now bring.",
    "- A story is delivered with its feature: moving a story moves the feature it belongs to.",
    "",
    `The change: "${change}"`,
    "",
    `Current milestones:\n${plan}`,
    "",
    `Features and their stories:\n${features.map((f, i) => `[F${i + 1}] ${f.title} (${f.hours} h): ${f.stories.map((x) => x.title).join("; ")}`).join("\n")}`,
  ].join("\n");
  return aiJson(run, { task: "milestone change", role: PLANNER, prompt, schema: MILESTONE_SCHEMA, accept: (raw) => acceptMilestones(raw, features) });
}

// ------------------------------------------------------------------------------------------------- success & performance

export function acceptTargets(raw: unknown): Record<SuccessKey, Proposal> | null {
  const o = obj(raw);
  if (!o) return null;
  const out = {} as Record<SuccessKey, Proposal>;
  for (const k of SUCCESS_KEYS) {
    const v = obj(o[k]);
    if (!v) return null;
    const reason = text(v.reason, 600, 10);
    if (!reason) return null;
    if (k === "responseTime") {
      const c = RESPONSE_TIME_CHOICES.find((x) => x.id === v.choice);
      if (!c) return null;
      out[k] = { value: c.value, choice: c.id, reason };
    } else {
      const value = text(v.value, VALUE_MAX, 4);
      if (!value) return null;
      out[k] = { value, choice: "", reason };
    }
  }
  return out;
}

const target = (d: string) => S.obj({ value: S.str(d), reason: S.str("One sentence: why this value.") });
const TARGET_SCHEMA = S.obj({
  outcome: target("The result that shows it works, measurable, with a time frame."),
  users: target("How many people use it, and how many at the same time at the peak."),
  responseTime: S.obj({ choice: S.enum(RESPONSE_TIME_CHOICES.map((c) => c.id), RESPONSE_TIME_CHOICES.map((c) => `${c.id} = ${c.value}`).join("; ")), reason: S.str() }),
  dataVolume: target("How much data a year (records, files and their size) and how long it is kept."),
  availability: target("When it is used most, the peak times, and when maintenance may happen."),
});

export async function aiTargets(run: JobRun, f: SuccessFacts, questions: Partial<Record<SuccessKey, string>> = {}): Promise<Record<SuccessKey, Proposal> | null> {
  const m = await projectMaterial(run, { noAnswers: false, budget: 3000 });
  const asked = Object.entries(questions).filter(([, q]) => q);
  const prompt = [
    `Propose the success and performance targets of ${f.name}: realistic values for this product and its users, to confirm or change.`,
    "",
    "Rules:",
    "- Values are short (at most 200 characters), concrete, with numbers; reasons are one plain sentence.",
    "- Base the numbers on the material (who uses it, how many, the goal); where it says nothing, propose the usual value for a product of this kind and say so in the reason.",
    asked.length ? `- The team asked these questions; answer them in the values:\n${asked.map(([k, q]) => `  - ${k}: ${q}`).join("\n")}` : "",
    "",
    f.featureText ? `Features in scope: ${f.featureText.slice(0, 1500)}` : "",
    "",
    `Material:\n${m.text}`,
  ].filter((l) => l !== "").join("\n");
  return aiJson(run, { task: "success targets", role: PM, prompt, schema: TARGET_SCHEMA, accept: acceptTargets });
}

// ------------------------------------------------------------------------------------------------- second opinion

export const GRILL_RULES = ["coverage", "acceptance", "size", "milestone-order", "milestone-gap", "access", "privacy", "offline", "integration", "notify", "amounts", "empty-state", "support", "no-stories"] as const;
const SEVERITIES = ["high", "medium", "low"] as const;

export function acceptPoints(raw: unknown, features: readonly FeatureInfo[], decided: ReadonlySet<string>): Point[] | null {
  const o = obj(raw);
  if (!o) return null;
  const targets = new Map<string, Point["target"]>();
  features.forEach((f, i) => {
    targets.set(`F${i + 1}`, { type: "feature", id: f.id });
    f.stories.forEach((s, n) => targets.set(`F${i + 1}.S${n + 1}`, { type: "story", id: s.id }));
  });
  const out: Point[] = [];
  for (const raw of arr(o.points)) {
    const p = obj(raw);
    const question = p ? text(p.question, 400, 12) : null;
    const tg = p ? targets.get(tagOf(p.target)) ?? targets.get(tagOf(p.target).split(".")[0]!) : undefined;
    if (!p || !question || !tg || !tg.id || decided.has(question) || out.some((x) => x.question === question)) continue;
    const why = text(p.why, 600, 10);
    const fix = text(p.fix, 600, 10);
    if (!why || !fix) continue;
    out.push({ rule: oneOf(p.rule, GRILL_RULES) ?? "acceptance", severity: oneOf(p.severity, SEVERITIES) ?? "medium", question: untag(question, features), why: untag(why, features), fix: untag(fix, features), target: tg });
    if (out.length >= 6) break;
  }
  if (out.length < Math.min(3, features.length)) return null;
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const POINT_SCHEMA = S.obj({
  points: S.list(S.obj({
    rule: S.enum(GRILL_RULES),
    severity: S.enum(SEVERITIES, "high = blocks the lock, medium = should be settled, low = worth a look."),
    question: S.str("The point as a question, at most 200 characters, naming the feature or story."),
    why: S.str("One or two sentences: why it matters for the client."),
    fix: S.str("One sentence: the concrete change to the scope."),
    target: S.str('Tag of the feature or story it is about ("F2" or "F2.S1").'),
  }), 8),
});

export async function aiPoints(run: JobRun, x: GrillInput, decided: ReadonlySet<string>): Promise<Point[] | null> {
  if (x.features.length === 0) return null;
  const reqs = x.requirements.map((r) => `- ${r.key} [${r.priority}] ${r.title}`).join("\n");
  const ms = x.milestones.map((m) => `- Milestone ${m.number} ${m.name}: ${m.featureRefs.map((ref) => `F${x.features.findIndex((f) => f.ref === ref) + 1}`).filter((t) => t !== "F0").join(", ")}`).join("\n");
  const material = await materialOf(run, 1500);
  const prompt = [
    `Give a second opinion on scope v${x.version} of ${run.p.name} before it is locked: the points the team should settle first.`,
    "",
    "Rules:",
    "- Three to six points, the most important first, each about one feature or story (its tag).",
    "- Look for: requirements no feature covers, missing checks (what happens when something fails, limits, empty lists), stories too big to build in a day or two, milestones in the wrong order, who may see what, personal data, money (prices, fees, payouts, refunds), e-mails people expect, connections to other systems.",
    "- Only real gaps of this scope; never a point the requirements, the answered questions or the decisions already settle, nor one listed as already decided.",
    SETTLED,
    "- When a fix moves a feature to another milestone, say so in the fix with both milestone numbers (\"Move … from milestone 2 to milestone 1\").",
    "- Plain words, no technical terms. In the question, why and fix, name features and stories by their titles in quotes, never by their tags.",
    "",
    `Requirements:\n${reqs}`,
    "",
    `Scope:\n${scopeList(x.features)}`,
    ms ? `\nMilestones:\n${ms}` : "",
    decided.size ? `\nAlready decided (do not raise again):\n${[...decided].slice(0, 20).map((d) => `- ${d}`).join("\n")}` : "",
    "",
    material,
  ].join("\n");
  return aiJson(run, { task: "second opinion", role: ARCHITECT, prompt, schema: POINT_SCHEMA, accept: (raw) => acceptPoints(raw, x.features, decided) });
}

// ------------------------------------------------------------------------------------------------- board tasks

const TASK_ROLES = TASK_KINDS;

export function acceptTasks(raw: unknown, milestones: readonly { number: number; features: FeatureInfo[] }[]): Task[][] | null {
  const o = obj(raw);
  if (!o) return null;
  const all = milestones.flatMap((m) => m.features);
  const byTag = new Map(all.map((f, i) => [`F${i + 1}`, f]));
  const out: Task[][] = milestones.map(() => []);
  const tags = new Set<string>();
  for (const raw of arr(o.tasks)) {
    const t = obj(raw);
    const title = t ? text(t.title, 200, 6) : null;
    const at = t ? milestones.findIndex((m) => m.number === number(t.milestone, 0, 99)) : -1;
    if (!t || !title || at < 0 || out[at]!.length >= 2) continue;
    const role = oneOf(t.role, TASK_ROLES) ?? "other";
    const feature = byTag.get(tagOf(t.feature));
    const base = role === "pipeline" ? "ci" : role === "access" ? "auth" : role === "interface" ? `int-${feature?.key ?? slugOf(title, 30)}`.slice(0, 40) : role === "offline" ? "offline-store" : role === "review" ? "sec" : role === "backend" ? "api" : slugOf(title, 30);
    let tag = base;
    for (let n = 2; tags.has(tag); n++) tag = `${base.slice(0, 36)}-${n}`;
    tags.add(tag);
    const acceptance = texts(t.acceptance, 4, 500, 6).map((a) => a.replace(/\.$/, ""));
    out[at]!.push({
      tag,
      kind: role,
      title: untag(title, all),
      hours: half(number(t.hours, 1, 16) ?? 3),
      description: untag(text(t.description, 2000, 10) ?? title, all),
      acceptance: (acceptance.length ? acceptance : [title]).map((a) => untag(a, all)),
      ...(feature ? { feature: feature.key } : {}),
    });
  }
  return out.some((m) => m.length > 0) ? out : null;
}

const TASK_SCHEMA = S.obj({
  tasks: S.list(S.obj({
    milestone: S.num("Milestone number."),
    role: S.enum(TASK_ROLES),
    title: S.str("Short, at most 60 characters."),
    description: S.str("One or two plain sentences."),
    acceptance: S.list(S.str(), 3, "Two checks."),
    hours: S.num("1 to 8."),
    feature: S.str('Tag of the feature it serves ("F3"), or "".'),
  }), 10),
});

export async function aiTasks(run: JobRun, milestones: readonly { number: number; name: string; features: FeatureInfo[] }[]): Promise<Task[][] | null> {
  if (milestones.length === 0) return null;
  let i = 0;
  const list = milestones.map((m) => `Milestone ${m.number} ${m.name}:\n${m.features.map((f) => `  [F${++i}] ${f.title}: ${f.description}`).join("\n")}`).join("\n");
  const material = await materialOf(run, 1500);
  const prompt = [
    `The scope of ${run.p.name} is locked. The board already gets one ticket per user story. Add the cross-cutting tasks a team adds for the work no single story covers.`,
    "",
    "Rules:",
    `- At most two tasks per milestone, ${Math.min(8, milestones.length * 2)} at most in all; only tasks this product really needs (for example the build pipeline and preview, sign-in and roles, file storage, payment provider, a connection to another system, a security review of personal data or payouts).`,
    "- Each task: the milestone it belongs to, its kind (role), a short title, one or two plain sentences, two checks and an honest estimate in hours.",
    `- ${run.p.existingProduct ? "This changes an existing product: the pipeline must keep the existing release process working." : "A new product: the first milestone needs the build pipeline with a preview environment."}`,
    SETTLED,
    "",
    list,
    "",
    material,
  ].join("\n");
  return aiJson(run, { task: "board tasks", role: PLANNER, prompt, schema: TASK_SCHEMA, accept: (raw) => acceptTasks(raw, milestones) });
}
