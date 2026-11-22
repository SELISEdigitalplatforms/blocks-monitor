// milestones.suggest: the included features of the scope version arranged into milestones — the foundation and the
// main flow first, back office and connections next, nice-to-have and later features last — balanced by the hours
// of their stories. Every included feature lands in exactly one milestone; the version's milestones are replaced
// (rows updated in place by Number, extra ones added, surplus ones removed). A note from the requester is honoured
// ("two milestones", "put the ERP export first").
import type { Row } from "../../../../../functions/_lib/gateway";
import { MILESTONE_LIMITS } from "../../../../../src/domain/milestones";
import { num, str } from "../../context.ts";
import { inParallel, type JobRun, type KindResult } from "../../run.ts";
import { cap, clip, listOf, lower, overlap, plural, wordsOf } from "../../text.ts";
import { WORDS, aActor, ability, actorsPlural, includedFeatures, mentions, type FeatureInfo } from "./common.ts";
import { startsWithVerb } from "./naming.ts";
import { early } from "../../ai/index.ts";
import { aiMilestoneChange, aiMilestones } from "./ai.ts";

const COUNT_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function phaseOf(f: FeatureInfo): number {
  if (f.priority === "later") return 4;
  if (f.priority === "nice") return 3;
  const head = `${f.title} ${f.description}`;
  if (mentions(head, WORDS.foundation)) return 0;
  if (mentions(head, WORDS.desk) || mentions(head, WORDS.integration)) return 2;
  return 1;
}

/** How many milestones fit the features (the note can ask for a number). */
export function milestoneCount(n: number, note: string): number {
  const m = /\b(one|single|two|three|four|five|six|[1-9])\s+(milestones?|steps|releases|phases|parts)\b/i.exec(note);
  const asked = m ? (COUNT_WORDS[m[1]!.toLowerCase()] ?? Number(m[1])) : 0;
  const base = n <= 2 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return Math.max(1, Math.min(n, asked > 0 ? asked : base, MILESTONE_LIMITS.max));
}

/** The order the note asks for: features named with "first" go to the front, with "last"/"later" to the end. */
function applyNote(list: FeatureInfo[], note: string): FeatureInfo[] {
  if (!note.trim()) return list;
  const front: FeatureInfo[] = [];
  const back: FeatureInfo[] = [];
  for (const clause of note.split(/[.;,\n]|\bthen\b/i)) {
    const c = clause.trim();
    if (!c) continue;
    const early = /\b(first|start|begin|early|earlier|asap|priority|before)\b/i.test(c);
    const late = /\b(last|later|end|defer|after|postpone)\b/i.test(c);
    if (!early && !late) continue;
    const cw = wordsOf(c);
    for (const f of list) {
      const tw = wordsOf(f.title);
      const hit = overlap(cw, tw);
      if (hit === 0 || hit < Math.min(2, tw.size)) continue;
      if (early && !front.includes(f)) front.push(f);
      else if (late && !back.includes(f)) back.push(f);
    }
  }
  const rest = list.filter((f) => !front.includes(f) && !back.includes(f));
  return [...front, ...rest, ...back];
}

/** Contiguous groups with the smallest largest group (linear partition over the story hours). */
export function partition(weights: readonly number[], m: number): number[][] {
  const n = weights.length;
  const k = Math.max(1, Math.min(m, n));
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1]! + w);
  const sum = (i: number, j: number) => prefix[j]! - prefix[i]!;
  // best[g][j]: smallest largest group for the first j items in g groups; cut[g][j]: where the last group starts.
  const best: number[][] = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  best[0]![0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        const v = Math.max(best[g - 1]![i]!, sum(i, j));
        // Ties go to the later cut, so earlier milestones carry a little more (the foundation goes first).
        if (v < best[g]![j]! - 1e-9 || (Math.abs(v - best[g]![j]!) < 1e-9 && i > cut[g]![j]!)) {
          best[g]![j] = v;
          cut[g]![j] = i;
        }
      }
    }
  }
  const groups: number[][] = [];
  let j = n;
  for (let g = k; g >= 1; g--) {
    const i = cut[g]![j]!;
    groups.unshift(Array.from({ length: j - i }, (_, x) => i + x));
    j = i;
  }
  return groups;
}

function nameOf(group: FeatureInfo[], used: Set<string>): string {
  const titles = group.map((f) => f.title.trim());
  let name: string;
  if (titles.length === 1) name = titles[0]!;
  else if (titles.length === 2) name = /\band\b/i.test(titles[0]!) ? `${titles[0]}, ${lower(titles[1]!)}` : `${titles[0]} and ${lower(titles[1]!)}`;
  else {
    const rest = titles.slice(1).map(lower);
    // "A, b and c" — or "A, b, c" when a title has an "and" of its own.
    const all = titles.some((t) => /\band\b/i.test(t)) ? [titles[0]!, ...rest].join(", ") : `${[titles[0]!, ...rest.slice(0, -1)].join(", ")} and ${rest[rest.length - 1]}`;
    const two = `${titles[0]}, ${lower(titles[1]!)} and more`;
    name = all.length <= MILESTONE_LIMITS.name ? all : two.length <= MILESTONE_LIMITS.name ? two : `${titles[0]} and more`;
  }
  if (name.length > MILESTONE_LIMITS.name) name = titles.length > 1 ? `${clip(titles[0]!, MILESTONE_LIMITS.name - 9)} and more` : clip(name, MILESTONE_LIMITS.name);
  let unique = name;
  for (let k = 2; used.has(unique.toLowerCase()); k++) unique = `${clip(name, MILESTONE_LIMITS.name - 8)}, part ${k}`;
  used.add(unique.toLowerCase());
  return unique;
}

/** The story that says what someone can do ("See my own prices"), not a name or a fact ("ERP connection"). */
const actionStory = (f: FeatureInfo) => f.stories.find((s) => startsWithVerb(s.title)) ?? null;

/** "Customers can see their own prices and repeat their last order; the order desk can change orders." Features without
 *  such a story are named: "…; it also brings the ERP connection." */
function goalOf(group: FeatureInfo[]): string {
  const byActor = new Map<string, string[]>();
  const named: string[] = [];
  for (const f of group) {
    const s = actionStory(f);
    if (!s) {
      named.push(lower(f.title));
      continue;
    }
    const list = byActor.get(s.actor) ?? [];
    list.push(ability(s.title, s.actor));
    byActor.set(s.actor, list);
  }
  const clauses = [...byActor].map(([actor, things]) => `${actorsPlural(actor)} can ${listOf(things.slice(0, 3))}`);
  const goal = clauses.length
    ? `${cap(clauses.join("; "))}${named.length ? `; it also brings the ${listOf(named)}` : ""}.`
    : `Delivers ${listOf(named.length ? named : group.map((f) => lower(f.title)))}.`;
  return clip(goal, 480);
}

function previewOf(group: FeatureInfo[]): string {
  const picks = group.flatMap((f) => { const s = actionStory(f); return s ? [s] : []; }).slice(0, 2);
  if (picks.length === 0) return clip(`In the preview: ${listOf(group.map((f) => lower(f.title)))}.`, 480);
  const [a, b] = picks;
  const first = `${aActor(a!.actor)} can ${ability(a!.title, a!.actor)}`;
  const second = b ? (b.actor === a!.actor ? ` and ${ability(b.title, b.actor)}` : `, and ${aActor(b.actor)} can ${ability(b.title, b.actor)}`) : "";
  return clip(`In the preview, ${first}${second}.`, 480);
}

export interface PlannedMilestone {
  number: number;
  name: string;
  goal: string;
  preview: string;
  featureRefs: string[];
  hours: number;
}

/** The arrangement (pure: the same features and note give the same plan). */
export function planMilestones(features: readonly FeatureInfo[], note = ""): PlannedMilestone[] {
  if (features.length === 0) return [];
  const ordered = applyNote(
    [...features].sort((a, b) => phaseOf(a) - phaseOf(b) || a.sortOrder - b.sortOrder),
    note,
  );
  const m = milestoneCount(ordered.length, note);
  const groups = partition(ordered.map((f) => Math.max(0.5, f.hours) + 0.5), m);
  const used = new Set<string>();
  return groups.map((idx, i) => {
    const group = idx.map((x) => ordered[x]!);
    return {
      number: i + 1,
      name: nameOf(group, used),
      goal: goalOf(group),
      preview: previewOf(group),
      featureRefs: group.map((f) => f.ref),
      hours: group.reduce((h, f) => h + f.hours, 0),
    };
  });
}

const hoursText = (h: number): string => `${Math.round(h * 10) / 10} h`;

// ------------------------------------------------------------------------------------------------- one change only
// An accepted second-opinion fix ("Move the certificate story to milestone 2") changes the plan the way it says and
// nothing else: every other feature keeps its milestone, every untouched milestone keeps its name, goal and preview.

/** The plan as it is stored, in milestone order. */
export function currentPlan(rows: readonly Row[], features: readonly FeatureInfo[]): PlannedMilestone[] {
  const hours = new Map(features.map((f) => [f.ref, f.hours]));
  return [...rows]
    .sort((a, b) => num(a.Number) - num(b.Number))
    .map((r, i) => {
      const refs = (Array.isArray(r.FeatureRefs) ? (r.FeatureRefs as unknown[]) : []).filter((x): x is string => typeof x === "string");
      return {
        number: num(r.Number) || i + 1, name: str(r.Name), goal: str(r.Goal), preview: str(r.PreviewPoint), featureRefs: refs,
        hours: refs.reduce((h, ref) => h + (hours.get(ref) ?? 0), 0),
      };
    });
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
/** Words of a fix that name the move, not the thing moved. */
const MOVE_WORDS = new Set(["move", "moved", "moving", "put", "shift", "deliver", "story", "storie", "feature", "milestone", "next", "together", "instead", "earlier", "later", "plan", "first", "second", "third", "fourth", "fifth", "sixth"]);
const TARGET = /\b(?:to|into|in|under|on|onto|for)\s+(?:the\s+)?(?:milestone\s*(\d{1,2})\b|m(\d{1,2})\b|(first|second|third|fourth|fifth|sixth)\s+milestone\b)/i;
const QUOTED = /["“”„«»]([^"“”„«»]{3,160})["“”„«»]/g;

/** The feature a piece of a fix names: a quoted story or feature title first, else the words (one clear best). */
function featureNamed(phrase: string, features: readonly FeatureInfo[]): FeatureInfo | null {
  const t = phrase.trim().toLowerCase();
  if (!t) return null;
  const exact = features.find((f) => f.title.toLowerCase() === t || f.stories.some((s) => s.title.toLowerCase() === t));
  if (exact) return exact;
  const words = new Set([...wordsOf(phrase)].filter((w) => !MOVE_WORDS.has(w)));
  if (words.size === 0) return null;
  const scored = features
    .map((f) => ({ f, n: Math.max(overlap(words, wordsOf(f.title)), ...f.stories.map((s) => overlap(words, wordsOf(s.title)))) }))
    .sort((a, b) => b.n - a.n);
  const [best, next] = scored;
  return best && best.n > 0 && (!next || best.n > next.n) ? best.f : null;
}

export interface Move {
  featureRef: string;
  /** The milestone number it goes to. */
  to: number;
  /** Placed after this feature in the target (the fix's "next to …"), else at the end. */
  after: string | null;
}

/** The one move a fix names: a story or feature (quoted, or by its words) and the milestone it goes to ("to
 *  milestone 2", "into M2", "to the second milestone"). Null when the fix is not that simple (pure). */
export function moveOf(note: string, plan: readonly PlannedMilestone[], features: readonly FeatureInfo[]): Move | null {
  const target = TARGET.exec(note);
  if (!target) return null;
  const to = target[1] ? Number(target[1]) : target[2] ? Number(target[2]) : ORDINALS[target[3]!.toLowerCase()]!;
  if (!plan.some((m) => m.number === to)) return null;
  const quoted = [...note.matchAll(QUOTED)].map((m) => m[1]!);
  const subject = quoted.length ? featureNamed(quoted[0]!, features) : featureNamed(note.slice(0, target.index).replace(/\bfrom\s+(?:the\s+)?(?:milestone\s*\d+|m\d+|\w+\s+milestone)\b/gi, ""), features);
  if (!subject || !plan.some((m) => m.featureRefs.includes(subject.ref))) return null;
  const anchor = quoted.length > 1 ? featureNamed(quoted[1]!, features) : null;
  return { featureRef: subject.ref, to, after: anchor && anchor.ref !== subject.ref ? anchor.ref : null };
}

/** The plan with the move applied; the milestones it touches get their goal and preview written again from what they
 *  hold now (a name that only fitted the moved feature too), every other milestone stays exactly as it was. Null when
 *  the move would leave a milestone empty (pure). */
export function applyMove(plan: readonly PlannedMilestone[], features: readonly FeatureInfo[], mv: Move): PlannedMilestone[] | null {
  const from = plan.find((m) => m.featureRefs.includes(mv.featureRef));
  if (!from) return null;
  if (from.number === mv.to) return plan.map((m) => ({ ...m, featureRefs: [...m.featureRefs] }));
  if (from.featureRefs.length <= 1) return null;
  const byRef = new Map(features.map((f) => [f.ref, f]));
  const moved = byRef.get(mv.featureRef)!;
  const used = new Set(plan.map((m) => m.name.toLowerCase()));
  return plan.map((m) => {
    if (m.number !== from.number && m.number !== mv.to) return { ...m, featureRefs: [...m.featureRefs] };
    let refs = m.featureRefs.filter((r) => r !== mv.featureRef);
    if (m.number === mv.to) {
      const at = mv.after ? refs.indexOf(mv.after) : -1;
      refs = at >= 0 ? [...refs.slice(0, at + 1), mv.featureRef, ...refs.slice(at + 1)] : [...refs, mv.featureRef];
    }
    const group = refs.map((r) => byRef.get(r)).filter((f): f is FeatureInfo => Boolean(f));
    let name = m.name;
    // the source's name goes when it named the moved feature and nothing it still holds
    if (m.number === from.number) {
      const own = [...wordsOf(moved.title)].filter((w) => !group.some((f) => wordsOf(f.title).has(w)));
      if (own.some((w) => wordsOf(m.name).has(w))) {
        used.delete(m.name.toLowerCase());
        name = nameOf(group, used);
      }
    }
    return { ...m, name, goal: goalOf(group), preview: previewOf(group), featureRefs: refs, hours: group.reduce((h, f) => h + f.hours, 0) };
  });
}

/** The features a fix names (quoted titles and the words, story titles too), for checking Claude's change (pure). */
export function featuresNamed(note: string, features: readonly FeatureInfo[]): Set<string> {
  const out = new Set<string>();
  for (const q of note.matchAll(QUOTED)) {
    const f = featureNamed(q[1]!, features);
    if (f) out.add(f.ref);
  }
  const rest = note.replace(QUOTED, " ");
  // one clear best by the words ("the certificate story"), and every feature the words name in full
  const best = featureNamed(rest, features);
  if (best) out.add(best.ref);
  const words = new Set([...wordsOf(rest)].filter((w) => !MOVE_WORDS.has(w)));
  for (const f of features) {
    const all = [f.title, ...f.stories.map((s) => s.title)];
    if (all.some((t) => { const tw = wordsOf(t); const hit = overlap(words, tw); return hit > 0 && hit >= Math.min(2, tw.size); })) out.add(f.ref);
  }
  return out;
}

/** Claude's changed plan, checked against the current one: the same milestones (one more only when the fix asks for a
 *  new one), only the features the fix names moved, and the untouched milestones keep their own texts. Null when
 *  anything else moved (pure). */
export function checkChange(next: readonly PlannedMilestone[] | null, cur: readonly PlannedMilestone[], named: ReadonlySet<string>, note: string): PlannedMilestone[] | null {
  if (!next) return null;
  const adds = /\b(?:new|another|extra|add(?:ing)? a|separate|own)\s+milestone\b|\bsplit\b/i.test(note);
  if (next.length !== cur.length && !(adds && next.length === cur.length + 1)) return null;
  const where = (plan: readonly PlannedMilestone[]) => new Map(plan.flatMap((m) => m.featureRefs.map((r) => [r, m.number] as const)));
  const was = where(cur);
  const now = where(next);
  let moved = 0;
  for (const [ref, n] of was) {
    if (now.get(ref) === n) continue;
    if (!named.has(ref)) return null;
    moved += 1;
  }
  if (moved === 0) return null;
  return next.map((m) => {
    const old = cur.find((c) => c.number === m.number);
    const same = old && old.featureRefs.length === m.featureRefs.length && old.featureRefs.every((r) => m.featureRefs.includes(r));
    return same ? { ...old, featureRefs: [...old.featureRefs] } : m;
  });
}

export async function milestonesSuggest(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const version = num(run.input.scopeVersion, p.scopeVersion) || p.scopeVersion;
  const note = str(run.input.note);
  const features = includedFeatures(p, version);
  const storyCount = features.reduce((n, f) => n + f.stories.length, 0);
  await run.step(6, `Reading scope v${version}: ${plural(features.length, "feature")} and ${plural(storyCount, "story", "stories")}.`);
  await run.wait(3);
  if (features.length === 0) return { outputs: [], message: `Scope v${version} has no features to arrange yet.` };
  const existing = p.milestones(version);
  // an accepted second-opinion fix: that one change, everything else stays as it is
  if (run.input.adjust === true && note && existing.length > 0) return adjustMilestones(run, version, features, existing, note);
  const fromAi = early(aiMilestones(run, features, note));

  await run.step(28, note ? "Ordering the features by priority, dependencies and the note." : "Ordering the features by priority and dependencies.");
  await run.wait(4);
  const plan = (await fromAi) ?? planMilestones(features, note);
  const total = features.reduce((h, f) => h + f.hours, 0);
  await run.step(52, `Balancing ${plural(plan.length, "milestone")} over ${hoursText(total)} of stories.`);
  await run.wait(3);

  const byNumber = new Map<number, Row>();
  for (const r of existing) if (!byNumber.has(num(r.Number))) byNumber.set(num(r.Number), r);
  const outputs = await inParallel(plan, 4, async (m, i) => {
    await run.step(60 + Math.round((36 * i) / plan.length), `Writing milestone ${m.number}: ${m.name}.`);
    await run.wait(1.6);
    const fields: Row = {
      ScopeVersion: version,
      Number: m.number,
      Name: m.name,
      Goal: m.goal,
      FeatureRefs: m.featureRefs,
      SortOrder: i,
      PreviewPoint: m.preview,
      Status: "planned",
      EngineJobId: run.id,
    };
    const old = byNumber.get(m.number);
    if (old) {
      await run.update("Milestone", str(old.ItemId), fields);
      return `Milestone:${str(old.ItemId)}`;
    }
    return `Milestone:${await run.insert("Milestone", fields, `milestone-${m.number}`)}`;
  });
  // Milestones beyond the new plan go: the suggestion replaces the arrangement.
  await inParallel(existing, 4, async (r) => {
    const n = num(r.Number);
    if (n < 1 || n > plan.length || byNumber.get(n) !== r) await run.remove("Milestone", str(r.ItemId));
  });
  return { outputs, message: `Proposed ${plural(plan.length, "milestone")}.` };
}

/** milestones.suggest for an accepted fix: a simple move is applied at once (no Claude); any other change goes to
 *  Claude with the current plan and that one change, and is kept only when nothing else moved. Only the milestones
 *  that changed are written; when the change cannot be applied safely the plan stays as it is. */
async function adjustMilestones(run: JobRun, version: number, features: readonly FeatureInfo[], rows: readonly Row[], note: string): Promise<KindResult> {
  const cur = currentPlan(rows, features);
  await run.step(28, "Reading the change the second opinion asks for.");
  const mv = moveOf(note, cur, features);
  let next = mv ? applyMove(cur, features, mv) : null;
  let how = "the change";
  if (next) {
    run.log(`milestones: the fix moves one feature to milestone ${mv!.to}; nothing else changes`);
  } else {
    const named = featuresNamed(note, features);
    next = checkChange(await aiMilestoneChange(run, features, cur, note), cur, named, note);
    how = "Claude's change";
    if (!next) {
      run.log("milestones: the change could not be applied without moving other features; the plan stays as it is");
      return { outputs: [], message: "Kept the milestones as they are: the change would have moved other work too." };
    }
  }
  const byNumber = new Map(rows.map((r) => [num(r.Number), r] as const));
  const changed = next.filter((m) => {
    const old = cur.find((c) => c.number === m.number);
    return !old || old.name !== m.name || old.goal !== m.goal || old.preview !== m.preview || old.featureRefs.join("|") !== m.featureRefs.join("|");
  });
  await run.step(60, changed.length ? `Writing ${plural(changed.length, "changed milestone")}.` : "The plan already says this.");
  const outputs = await inParallel(changed, 4, async (m) => {
    const fields: Row = { ScopeVersion: version, Number: m.number, Name: m.name, Goal: m.goal, FeatureRefs: m.featureRefs, PreviewPoint: m.preview, EngineJobId: run.id };
    const old = byNumber.get(m.number);
    if (old) {
      await run.update("Milestone", str(old.ItemId), fields);
      return `Milestone:${str(old.ItemId)}`;
    }
    return `Milestone:${await run.insert("Milestone", { ...fields, SortOrder: m.number - 1, Status: "planned" }, `milestone-${m.number}`)}`;
  });
  return { outputs, message: changed.length ? `Applied ${how} to ${plural(changed.length, "milestone")}; the others stay as they were.` : "The milestones already follow this change." };
}
