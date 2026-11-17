// scope.draft: the product manager and the solution architect draft the Scope & delivery plan of a project that has
// just reached Scope & success, from its requirements — so the team reviews a plan instead of filling in an empty one:
//   - one feature per requirement the people use (functional, integration, screens, sign-in), in Must / Should / Could
//     order, linked to its requirement; what the requirements leave out is listed as "Not included";
//   - user stories ("As a customer, I want to book a class online") with the requirement's acceptance criteria, plus
//     the key workflows as stories of the feature they belong to;
//   - the milestones (the same arrangement as milestones.suggest: every included feature in exactly one milestone);
//   - the success & performance targets the product manager proposes (scope.success "propose").
// It only drafts into a draft version with no features: once a person added, removed or changed features, a second
// run changes nothing. The version row is the one a person's first save would make (same natural key).
import { capKey } from "../../../../../functions/_lib/ids";
import type { Row } from "../../../../../functions/_lib/gateway";
import { SCOPE_LIMITS } from "../../../../../src/domain/scope";
import { briefFactsOf } from "../../../../../src/domain/projectBrief";
import { parseSuccessTargets, serializeSuccessTargets } from "../../../../../src/domain/successTargets";
import { num, str, strs } from "../../context.ts";
import { inParallel, type JobRun, type KindResult } from "../../run.ts";
import { cap, clip, overlap, plural, slugOf, wordsOf } from "../../text.ts";
import { includedFeatures } from "./common.ts";
import { planMilestones } from "./milestones.ts";
import { actorOf, featureNameOf, singularActor, wishOf } from "./naming.ts";
import { applyProposals, factsOf, proposeTargets } from "./success.ts";
import { early } from "../../ai/index.ts";
import { aiFeatures, aiMilestones, aiTargets, infoOfDraft } from "./ai.ts";
import { recordScopeAnswers } from "../analysis/followAnswers.ts";

export interface DraftRequirement {
  key: string;
  title: string;
  text: string;
  category: string;
  priority: string;
  criteria: string[];
  sortOrder: number;
}

export interface DraftWorkflow { title: string; who: string; steps: string[] }

export interface DraftInput {
  requirements: DraftRequirement[];
  workflows: DraftWorkflow[];
  /** "Not included: gift vouchers" */
  exclusions: string[];
  /** the project's target users ("Customers, our own team") */
  targetUsers: string;
}

export interface DraftStory { title: string; text: string; actor: string; criteria: string[]; hours: number }
export interface DraftFeature {
  key: string;
  name: string;
  description: string;
  priority: "must" | "nice" | "later";
  requirementKeys: string[];
  stories: DraftStory[];
  dropped: boolean;
}

const ACCESS = /\b(sign[- ]?in|log[- ]?in|password|account|role|permission|access|register|invite)\b/i;
const PRIORITY_ORDER = { must: 0, nice: 1, later: 2 } as const;

/** Is the requirement something people use (a feature), or a quality the whole product has (speed, data, rules)? */
export function isFeatureRequirement(r: Pick<DraftRequirement, "category" | "title" | "text">): boolean {
  if (r.category === "functional" || r.category === "integration" || r.category === "ux" || r.category === "") return true;
  if (r.category === "security") return ACCESS.test(`${r.title} ${r.text}`);
  return false;
}

/** "As a customer, I want to book a class online and pay by card." (the article follows the actor) */
export function storyText(actor: string, wish: string): string {
  const a = actor.trim() || "user";
  const group = /(desk|team|office|department|board|management)$/i.test(a);
  // "an HR contact", "an employee", "a user": the article follows the sound
  const vowel = /^[aeio]/i.test(a) || /^u(?![nr]i|s[eu]|ti)/i.test(a) || /^[AEFHILMNORSX][A-Z]/.test(a);
  const who = group ? `the ${a}` : `${vowel ? "an" : "a"} ${a}`;
  return clip(`As ${who}, I want ${wish.replace(/[.!]+$/, "")}.`, SCOPE_LIMITS.storyText);
}

const hoursFor = (criteria: number): number => Math.min(12, Math.round((2 + criteria * 1.5) * 2) / 2);

/** The first person of the target users ("Customers, our own team" -> "customer"). */
function defaultActor(targetUsers: string, workflows: readonly DraftWorkflow[]): string {
  const first = targetUsers.split(/[,;\n/]| and /i).map((x) => x.trim()).find(Boolean) ?? "";
  const fromUsers = first ? singularActor(first.replace(/^(our|the|all|every)\s+/i, "")) : "";
  if (fromUsers && fromUsers.split(" ").length <= 3) return fromUsers;
  const who = workflows.map((w) => w.who.trim()).find(Boolean);
  return who ? singularActor(who) : "user";
}

/** The plan (pure: the same requirements give the same features and stories). */
export function draftFeatures(x: DraftInput): DraftFeature[] {
  const live = x.requirements.filter((r) => r.title.trim() !== "");
  const used = live.filter(isFeatureRequirement);
  const reqs = (used.length ? used : live).sort(
    (a, b) => (PRIORITY_ORDER[pr(a.priority)] - PRIORITY_ORDER[pr(b.priority)]) || a.sortOrder - b.sortOrder,
  );
  const fallbackActor = defaultActor(x.targetUsers, x.workflows);
  const byName = new Map<string, DraftFeature>();
  const keys = new Set<string>();
  for (const r of reqs) {
    const name = clip(featureNameOf(r.title), SCOPE_LIMITS.featureName) || cap(r.title.trim());
    const actor = clip(actorOf(r.title) || fallbackActor, SCOPE_LIMITS.storyActor);
    const criteria = r.criteria.map((c) => c.trim()).filter(Boolean).slice(0, SCOPE_LIMITS.criteria);
    const story: DraftStory = {
      title: clip(cap(storyTitleOf(r.title, name)), SCOPE_LIMITS.storyTitle),
      text: storyText(actor, wishOf(r.title)),
      actor,
      criteria,
      hours: hoursFor(criteria.length),
    };
    const same = byName.get(name.toLowerCase());
    if (same) {
      same.requirementKeys.push(r.key);
      same.stories.push(story);
      if (PRIORITY_ORDER[pr(r.priority)] < PRIORITY_ORDER[same.priority]) same.priority = pr(r.priority);
      continue;
    }
    let key = slugOf(name, 40) || "feature";
    for (let i = 2; keys.has(key); i++) key = `${slugOf(name, 36)}-${i}`;
    keys.add(key);
    const text = r.text.trim() && r.text.trim().toLowerCase() !== r.title.trim().toLowerCase() ? r.text.trim() : r.title.trim();
    byName.set(name.toLowerCase(), {
      key,
      name,
      description: clip(cap(text.replace(/\s+/g, " ")), 400),
      priority: pr(r.priority),
      requirementKeys: [r.key],
      stories: [story],
      dropped: false,
    });
  }
  const features = [...byName.values()];

  // the key workflows: a story of the feature they belong to (the one sharing the most words)
  for (const w of x.workflows) {
    if (!w.title.trim()) continue;
    const ww = wordsOf(`${w.title} ${w.steps.join(" ")}`);
    let best: DraftFeature | null = null;
    let score = 1;
    for (const f of features) {
      const s = overlap(ww, wordsOf(`${f.name} ${f.description}`));
      if (s > score) [best, score] = [f, s];
    }
    if (!best || best.stories.length >= SCOPE_LIMITS.storiesPerFeature) continue;
    // a workflow that says what a story already says adds nothing
    const tw = wordsOf(w.title);
    if (best.stories.some((st) => overlap(tw, wordsOf(st.text)) >= Math.max(3, Math.ceil(tw.size * 0.7)))) continue;
    const actor = clip(w.who.trim() ? singularActor(w.who) : best.stories[0]!.actor, SCOPE_LIMITS.storyActor);
    const steps = w.steps.map((s) => s.trim()).filter(Boolean).slice(0, SCOPE_LIMITS.criteria);
    best.stories.push({
      title: clip(cap(storyTitleOf(w.title, featureNameOf(w.title))), SCOPE_LIMITS.storyTitle),
      text: storyText(actor, wishOf(w.title.trim())),
      actor,
      criteria: steps,
      hours: hoursFor(steps.length),
    });
  }

  // what the requirements leave out: "Not included" in the plan
  for (const e of x.exclusions) {
    // "Not included: The payroll calculation itself: it stays in …" -> "Payroll calculation", with the reason kept
    const said = e.replace(/^(not included|out of scope|excluded|no)\s*[:\-–]\s*/i, "").trim();
    const head = said.split(/\s*(?::|—|–|\s-\s)\s*/)[0]!.replace(/^(the|a|an)\s+/i, "").replace(/\s+itself$/i, "").trim();
    const name = clip(cap(head), 60);
    const reason = said.length > head.length + 4 ? cap(said.replace(/^(the|a|an)\s+/i, (m) => m)) : "";
    if (!name || byName.has(name.toLowerCase())) continue;
    let key = slugOf(name, 40) || "not-included";
    for (let i = 2; keys.has(key); i++) key = `${slugOf(name, 36)}-${i}`;
    keys.add(key);
    byName.set(name.toLowerCase(), { key, name, description: clip(reason || "Not part of this scope.", 400), priority: "later", requirementKeys: [], stories: [], dropped: true });
    features.push(byName.get(name.toLowerCase())!);
  }
  return features.slice(0, SCOPE_LIMITS.features);
}

function pr(p: string): "must" | "nice" | "later" {
  return p === "nice" || p === "later" ? p : "must";
}

/** A story's short title (the ticket on the board): the action ("Book a class online"), else the feature name. */
function storyTitleOf(title: string, featureName: string): string {
  const wish = wishOf(title);
  if (wish.startsWith("to ") && !wish.startsWith("to be sure")) {
    const ws = wish.slice(3).split(/\s+/);
    if (ws.length <= 10) return ws.join(" ");
    // a long wish ends at its first "and" or comma after three words, never in the middle of a phrase
    const at = ws.findIndex((w, i) => i >= 3 && (w === "and" || /[,;:]$/.test(ws[i - 1] ?? "")));
    return (at > 0 ? ws.slice(0, at) : ws.slice(0, 10)).join(" ").replace(/[,;:]$/, "");
  }
  return featureName;
}

/** The project's records the draft is made from. */
export function draftInputOf(run: JobRun): DraftInput {
  const p = run.p;
  const extras = p.rows("RequirementExtra").filter((e) => e.Status !== "removed" && e.Status !== "deleted");
  return {
    requirements: p.requirements()
      .filter((r) => r.Status !== "dropped")
      .map((r) => ({
        key: str(r.Key),
        title: str(r.Title),
        text: str(r.Text),
        category: str(r.Category),
        priority: str(r.Priority),
        criteria: strs(r.AcceptanceCriteria),
        sortOrder: num(r.SortOrder, num(r.Number)),
      }))
      .filter((r) => r.key !== ""),
    workflows: extras.filter((e) => e.Kind === "workflow").map((e) => ({ title: str(e.Title), who: str(e.Who), steps: strs(e.Steps) })),
    exclusions: extras.filter((e) => e.Kind === "exclusion").map((e) => str(e.Title)).filter(Boolean),
    targetUsers: briefFactsOf(p).targetUsers,
  };
}

export async function scopeDraft(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const versionNumber = num(run.input.scopeVersion, p.scopeVersion) || 1;
  const versionRow = (): Row | undefined => p.rows("ScopeVersion").find((r) => num(r.Number) === versionNumber);
  const v0 = versionRow();
  if (v0 && v0.Status !== "draft") return { outputs: [], message: `Scope v${versionNumber} is locked; nothing was drafted.` };
  if (p.features(versionNumber).length > 0) return { outputs: [], message: `Scope v${versionNumber} already has features; nothing was drafted.` };
  const input = draftInputOf(run);
  if (input.requirements.length === 0) return { outputs: [], message: "There are no requirements to draft the scope from yet." };

  // Claude's features and targets (started now, read when the step gets there), else the built-in plan
  const fromAi = early(aiFeatures(run, input));
  const targetsAi = early(aiTargets(run, { ...factsOf(run, versionNumber), featureText: input.requirements.map((r) => r.title).join("; "), featureCount: input.requirements.length }));
  await run.step(5, `Reading ${plural(input.requirements.length, "requirement")} of ${p.name}.`);
  await run.wait(3);
  const plan = (await fromAi) ?? draftFeatures(input);
  const included = plan.filter((f) => !f.dropped);
  const milestonesAi = early(aiMilestones(run, included.map((f, i) => infoOfDraft(f, i)), ""));
  const storyCount = included.reduce((n, f) => n + f.stories.length, 0);
  await run.step(14, `Grouping them into ${plural(included.length, "feature")} with ${plural(storyCount, "user story", "user stories")}.`);
  await run.wait(4);

  const outputs: string[] = [];
  // the version: the row a person's first save would make (same natural key), so the two never make two v1s
  let version = versionRow();
  if (!version) {
    const id = await run.insert(
      "ScopeVersion",
      { Number: versionNumber, Status: "draft", Title: "First draft", EngineJobId: run.id, Summary: `Drafted from the requirements: ${plural(included.length, "feature")} and ${plural(storyCount, "user story", "user stories")}.` },
      "scope-version",
      { requestKey: capKey(`l7:${run.projectId}:scopeVersion:${versionNumber}`) },
    );
    outputs.push(`ScopeVersion:${id}`);
    version = versionRow();
  }
  // a person may have started meanwhile: their features win
  if (p.features(versionNumber).length > 0) return { outputs, message: `Scope v${versionNumber} got features meanwhile; nothing was drafted.` };

  // every feature with its stories, a few at a time (own RequestKeys: the order of the writes does not matter)
  const written = await inParallel(plan, 4, async (f, i) => {
    const out: string[] = [];
    await run.step(18 + Math.round((44 * i) / Math.max(1, plan.length)), f.dropped ? `Noting what is not included: ${f.name}.` : `Writing ${f.name} and its ${plural(f.stories.length, "user story", "user stories")}.`);
    await run.wait(f.dropped ? 0.6 : 1.6);
    const fid = await run.insert(
      "Feature",
      {
        ScopeVersion: versionNumber,
        Key: f.key,
        Title: f.name,
        Description: f.description,
        Priority: f.priority,
        Status: f.dropped ? "dropped" : "planned",
        RequirementRefs: f.requirementKeys.map((k) => `requirement:${k}`),
        SortOrder: i,
      },
      `feature-${f.key}`,
    );
    out.push(`Feature:${fid}`);
    const stories = await inParallel(f.stories, 4, async (s, n) => {
      const sid = await run.insert(
        "Story",
        {
          ScopeVersion: versionNumber,
          FeatureRef: `feature:${f.key}`,
          Key: `${f.key}-${n + 1}`,
          Title: s.title,
          Text: s.text,
          ActorRole: s.actor,
          AcceptanceCriteria: s.criteria,
          Priority: f.priority,
          EstimateHours: s.hours,
          SortOrder: n,
        },
        `story-${f.key}-${n + 1}`,
      );
      return `Story:${sid}`;
    });
    return [...out, ...stories];
  });
  outputs.push(...written.flat());

  // the milestones: the same arrangement as "Suggest milestones" (only when the version has none yet)
  if (p.milestones(versionNumber).length === 0) {
    await run.step(66, "Arranging the features into milestones, the foundation and the main flow first.");
    await run.wait(3);
    const stored = includedFeatures(p, versionNumber);
    const fromClaude = await milestonesAi;
    const refs = new Set(stored.map((f) => f.ref));
    // Claude's arrangement when it names exactly the features stored now (a person may have changed them meanwhile)
    const milestones = fromClaude && fromClaude.flatMap((m) => m.featureRefs).every((r) => refs.has(r)) && fromClaude.reduce((n, m) => n + m.featureRefs.length, 0) === refs.size
      ? fromClaude
      : planMilestones(stored);
    const mids = await inParallel(milestones, 4, async (m, i) => {
      await run.step(70 + Math.round((14 * i) / Math.max(1, milestones.length)), `Writing milestone ${m.number}: ${m.name}.`);
      await run.wait(1.2);
      const mid = await run.insert(
        "Milestone",
        { ScopeVersion: versionNumber, Number: m.number, Name: m.name, Goal: m.goal, FeatureRefs: m.featureRefs, SortOrder: i, PreviewPoint: m.preview, Status: "planned", EngineJobId: run.id },
        `milestone-${m.number}`,
      );
      return `Milestone:${mid}`;
    });
    outputs.push(...mids);
  }

  // success & performance: the product manager's proposals for the values nobody set yet
  const row = versionRow();
  if (row && row.Status === "draft") {
    await run.step(88, "Proposing the success & performance targets from the goal and the users.");
    await run.wait(2.5);
    const proposals = (await targetsAi) ?? proposeTargets(factsOf(run, versionNumber));
    const { targets, changed } = applyProposals(parseSuccessTargets(row.SuccessTargets), "propose", proposals, [], run.iso());
    if (changed.length) {
      await run.update("ScopeVersion", str(row.ItemId), { SuccessTargets: serializeSuccessTargets(targets) });
      if (!outputs.includes(`ScopeVersion:${str(row.ItemId)}`)) outputs.push(`ScopeVersion:${str(row.ItemId)}`);
    }
  }
  await run.step(96, "Checking the draft against the lock rules and your answers.");
  // every answer of the client in the scope (its features, stories and targets): checked and recorded
  await recordScopeAnswers(run, [
    ...plan.filter((f) => !f.dropped).flatMap((f) => [f.name, f.description, ...f.stories.flatMap((s) => [s.title, s.text, ...s.criteria])]),
    str(versionRow()?.SuccessTargets),
  ]);
  await run.wait(1);
  const ms = p.milestones(versionNumber).length;
  return {
    outputs,
    message: `Drafted ${plural(included.length, "feature")} with ${plural(storyCount, "user story", "user stories")} in ${plural(ms, "milestone")}.`,
  };
}
