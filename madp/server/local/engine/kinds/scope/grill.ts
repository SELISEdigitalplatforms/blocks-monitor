// scope.grill: the second opinion on a scope version — a review of the features, stories, milestones and
// requirements by fixed rules (coverage, acceptance criteria, sizes, milestone order, roles, personal data, offline
// use, connections, e-mails, amounts), each point phrased with the project's own titles. Points a person already
// decided on an earlier opinion are not raised again.
import type { Row } from "../../../../../functions/_lib/gateway";
import { num, str, strs } from "../../context.ts";
import { inParallel, type JobRun, type KindResult } from "../../run.ts";
import { cap, clip, listOf, lower, overlap, plural, wordsOf } from "../../text.ts";
import { early } from "../../ai/index.ts";
import { aiPoints } from "./ai.ts";
import { WORDS, aActor, actorsOf, actorsPlural, includedFeatures, mainActor, mentions, type FeatureInfo, type StoryInfo } from "./common.ts";

type Severity = "high" | "medium" | "low";

export interface Point {
  rule: string;
  severity: Severity;
  question: string;
  why: string;
  fix: string;
  target: { type: "feature" | "story"; id: string };
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const MAX_POINTS = 6;
const MIN_POINTS = 3;
/** How many points one rule may raise. */
const PER_RULE: Record<string, number> = { coverage: 2, "no-stories": 2, "milestone-gap": 2, acceptance: 2 };

const q = (s: string) => `"${s.trim()}"`;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const PERSONAL: [RegExp, string, boolean][] = [
  [/payslip/, "payslips", true],
  [/salar/, "salary data", true],
  [/health|medical|sick/, "health data", true],
  [/bank|iban/, "bank details", true],
  [/signature/, "signatures", false],
  [/photo/, "photos", false],
  [/absence/, "absence records", true],
  [/employee/, "employee data", false],
  [/tax/, "tax documents", true],
  [/personal|private/, "personal data", false],
];

function systemOf(text: string, title = ""): { system: string; noun: string } {
  const head = title.toLowerCase();
  const t = text.toLowerCase();
  const system = /\bsap\b/.test(t) ? "SAP" : /abacus/.test(t) ? "Abacus" : /bexio/.test(t) ? "bexio" : /\berp\b/.test(t) ? "ERP" : /\bcrm\b/.test(t) ? "CRM" : /accounting/.test(t) ? "accounting system" : "connected system";
  const nounOf = (x: string) => (/export|csv|into the|to the erp/.test(x) ? "export" : /import|from the/.test(x) ? "import" : /sync/.test(x) ? "synchronisation" : "");
  const noun = nounOf(head) || nounOf(t) || "transfer";
  return { system, noun };
}

/** A missing acceptance criterion that fits the story. */
function criterionFor(s: StoryInfo): [string, string] {
  return criterionByWords(s.title.toLowerCase()) ?? criterionByWords(`${s.title} ${s.text}`.toLowerCase()) ?? ["A person without access sees a clear message instead of the data", "Errors are shown in plain words with what to do next"];
}

function criterionByWords(t: string): [string, string] | null {
  if (/search|find|filter|catalog|list|browse|^see |^view |^show /.test(t)) return ["An empty result shows a clear message and how to search differently", "Results appear within 2 seconds for the largest customer"];
  if (/upload|photo|scan|document|certificate|receipt|file/.test(t)) return ["A failed upload can be retried without taking the photo or choosing the file again", "Files larger than 20 MB are refused with a clear message"];
  if (/sign|signature/.test(t)) return ["A signature can be cleared and given again before it is saved", "The signed document shows who signed and when"];
  if (/order|submit|send|request|report|book|save/.test(t)) return ["If sending fails, nothing is lost and it can be sent again", "A second tap on send does not create a duplicate"];
  if (/status|track|follow|progress/.test(t)) return ["The status shows when it was last updated", "A status that has not changed for a day is highlighted"];
  if (/approve|review|check|decide/.test(t)) return ["A rejection needs a reason that the requester sees", "Every decision is logged with who and when"];
  return null;
}

function closestFeature(features: readonly FeatureInfo[], text: string): FeatureInfo | undefined {
  const w = wordsOf(text);
  let best: FeatureInfo | undefined;
  let score = -1;
  for (const f of features) {
    const s = overlap(w, f.words);
    if (s > score) [best, score] = [f, s];
  }
  return best;
}

export interface GrillInput {
  version: number;
  features: FeatureInfo[];
  /** Dropped features (only their requirement refs matter). */
  dropped: { title: string; requirementRefs: string[] }[];
  milestones: { number: number; name: string; featureRefs: string[] }[];
  requirements: { number: number; key: string; title: string; text: string; priority: string }[];
  /** Texts of the requirements, the objective and the technical decisions (what the team already settled). */
  settled: string;
  client: string;
}

/** Every point the rules find, most severe first (pure). */
export function findPoints(x: GrillInput): Point[] {
  const out: Point[] = [];
  const { features, version } = x;
  const fid = (f: FeatureInfo) => ({ type: "feature" as const, id: f.id });
  const settled = x.settled.toLowerCase();

  // A feature nobody can build: no stories.
  for (const f of features.filter((f) => f.stories.length === 0)) {
    out.push({
      rule: "no-stories",
      severity: "high",
      question: `What will people actually do in ${q(f.title)}?`,
      why: `${q(f.title)} has no stories yet, so the board cannot plan any work for it and scope v${version} cannot be locked.`,
      fix: f.description
        ? `Add at least one story with acceptance criteria to ${q(f.title)}, starting from its description: ${clip(f.description, 160)}`
        : `Add at least one story with acceptance criteria to ${q(f.title)}.`,
      target: fid(f),
    });
  }

  // Requirements no feature refers to.
  const covered = new Set(features.flatMap((f) => f.requirementRefs));
  const droppedRefs = new Set(x.dropped.flatMap((d) => d.requirementRefs));
  for (const r of x.requirements) {
    const ref = `requirement:${r.key}`;
    if (covered.has(ref) || features.length === 0) continue;
    const near = closestFeature(features, `${r.title} ${r.text}`)!;
    const inDropped = droppedRefs.has(ref);
    out.push({
      rule: "coverage",
      severity: r.priority === "must" ? "high" : "medium",
      question: `Which feature delivers R-${r.number} ${q(r.title)}?`,
      why: inDropped
        ? `Only a dropped feature refers to R-${r.number}, so nothing on the board would build it, although it is a ${r.priority === "must" ? "must" : r.priority === "nice" ? "nice-to-have" : "later"} requirement.`
        : `No feature in scope v${version} refers to R-${r.number}, so nothing on the board would build it.`,
      fix: `Link R-${r.number} to ${q(near.title)} and add a story for it, or set the requirement to later if v${version} can go live without it.`,
      target: fid(near),
    });
  }

  // Milestones: a feature in no milestone; a later feature built before must features.
  if (x.milestones.length > 0) {
    const placed = new Map<string, number>();
    for (const m of x.milestones) for (const r of m.featureRefs) placed.set(r, m.number);
    for (const f of features.filter((f) => !placed.has(f.ref))) {
      const near = [...x.milestones].sort((a, b) => {
        const sa = overlap(f.words, wordsOf(a.name));
        const sb = overlap(f.words, wordsOf(b.name));
        return sb - sa || a.number - b.number;
      })[f.priority === "must" ? 0 : x.milestones.length - 1] ?? x.milestones[0]!;
      out.push({
        rule: "milestone-gap",
        severity: f.priority === "must" ? "high" : "medium",
        question: `Which milestone builds ${q(f.title)}?`,
        why: `${q(f.title)} is ${f.priority === "must" ? "a must feature" : f.priority === "nice" ? "a nice-to-have feature" : "planned for later"} but no milestone contains it, and the lock needs every feature of the scope in a milestone.`,
        fix: `Add ${q(f.title)} to milestone ${near.number} ${q(near.name)}${f.priority === "must" ? " next to the features it depends on" : " at the end of the plan"}.`,
        target: fid(f),
      });
    }
    const first = x.milestones.find((m) => m.number === Math.min(...x.milestones.map((n) => n.number)));
    if (first) {
      for (const f of features.filter((f) => f.priority !== "must" && first.featureRefs.includes(f.ref))) {
        const must = features.find((g) => g.priority === "must" && (placed.get(g.ref) ?? 0) > first.number);
        if (!must) continue;
        out.push({
          rule: "milestone-order",
          severity: "medium",
          question: `Should ${q(f.title)} really be built in milestone ${first.number}?`,
          why: `It is ${f.priority === "later" ? "planned for later" : "a nice-to-have"}, while the must feature ${q(must.title)} only comes in milestone ${placed.get(must.ref)}.`,
          fix: `Move ${q(f.title)} to the last milestone and bring ${q(must.title)} forward.`,
          target: fid(f),
        });
      }
    }
  }

  // Acceptance criteria that only cover the good case.
  const stories = features.flatMap((f) => f.stories.map((s) => ({ f, s })));
  const weak = stories
    .filter(({ s }) => s.criteria.length <= 1)
    .sort((a, b) => (a.f.priority === "must" ? 0 : 1) - (b.f.priority === "must" ? 0 : 1) || a.s.criteria.length - b.s.criteria.length || b.s.hours - a.s.hours);
  for (const { s } of weak) {
    const [c1, c2] = criterionFor(s);
    out.push({
      rule: "acceptance",
      severity: s.criteria.length === 0 ? "high" : "medium",
      question: `How will the tests show that ${q(s.title)} also works when something goes wrong?`,
      why:
        s.criteria.length === 0
          ? `The story has no acceptance criteria, so the QA agent has nothing to test against.`
          : `The story has one acceptance criterion (${q(s.criteria[0]!)}), which covers the good case only; empty, error and permission cases are open.`,
      fix: `Add criteria such as ${q(c1)} and ${q(c2)}.`,
      target: { type: "story", id: s.id },
    });
  }

  // The largest story, when it is far above the rest.
  const hours = stories.map(({ s }) => s.hours).filter((h) => h > 0);
  const mid = median(hours);
  const big = [...stories].sort((a, b) => b.s.hours - a.s.hours)[0];
  if (big && mid > 0 && big.s.hours >= 2 * mid && big.s.hours >= 2) {
    out.push({
      rule: "size",
      severity: "medium",
      question: `Can ${q(big.s.title)} be split into smaller stories?`,
      why: `At ${big.s.hours} h it is the largest story in the scope, ${Math.round((big.s.hours / mid) * 10) / 10} times the median story; a story this size is hard to review and test in one pass.`,
      fix: `Split it into the main path first and the special cases second, each with its own acceptance criteria.`,
      target: { type: "story", id: big.s.id },
    });
  }

  // Personal data without access and retention rules.
  if (!/retention|data protection|privacy|dsg|gdpr|deleted after/.test(settled)) {
    for (const f of features) {
      const hit = PERSONAL.find(([re]) => re.test(f.text));
      if (!hit) continue;
      const [, noun, strong] = hit;
      out.push({
        rule: "privacy",
        severity: strong ? "high" : "medium",
        question: `Who may see the ${noun} in ${q(f.title)}, and how long are they kept?`,
        why: `${q(f.title)} handles ${noun}, which is personal data under the Swiss Data Protection Act; the stories do not say who may read it or when it is deleted.`,
        fix: `Add a story for access by role and a retention rule (such as deletion after ${strong ? "10 years for payroll and tax records" : "13 months"}), and log every access to the ${noun}.`,
        target: fid(f),
      });
      break;
    }
  }

  // Phones without signal.
  if (!/offline|no signal|without signal|no connection|without connection/.test(`${settled} ${features.map((f) => f.text).join(" ")}`)) {
    const f = features.find((g) => mentions(g.text, ["phone", "mobile", "driver", "technician", "on site", "plant room", "on the road", "tablet"]));
    if (f) {
      const actor = f.stories[0]?.actor ?? mainActor(features);
      out.push({
        rule: "offline",
        severity: "medium",
        question: `What happens in ${q(f.title)} when the phone has no signal?`,
        why: `${cap(actorsPlural(actor))} use it on the phone away from the office; the stories assume a connection, so a lost signal would lose what was entered.`,
        fix: "Keep entries on the phone until they are sent, show what is still waiting, and send them automatically when the connection is back.",
        target: fid(f),
      });
    }
  }

  // Several roles and nobody says how they sign in.
  const actors = actorsOf(features);
  if (actors.length >= 2 && !features.some((f) => mentions(f.text, WORDS.access)) && !mentions(settled, WORDS.access)) {
    const f = features[0]!;
    out.push({
      rule: "access",
      severity: "medium",
      question: `How do ${listOf(actors.slice(0, 3).map(actorsPlural))} sign in, and who sets up their access?`,
      why: `The scope has ${plural(actors.length, "role")} (${listOf(actors.map(lower))}) but no story about sign-in or permissions, so the build would have to guess who may see what.`,
      fix: `Add a story "Sign in and see only what my role allows" to ${q(f.title)}, with one acceptance criterion per role.`,
      target: fid(f),
    });
  }

  // Connections to other systems: the failure case.
  for (const f of features.filter((g) => mentions(`${g.title} ${g.description}`, WORDS.integration)).slice(0, 1)) {
    const { system, noun } = systemOf(f.text, f.title);
    const owner = actors.find((a) => mentions(a, WORDS.desk)) ?? "the team";
    out.push({
      rule: "integration",
      severity: f.priority === "must" ? "high" : "medium",
      question: `What happens when the ${system} ${noun} fails or is rejected?`,
      why: `${q(f.title)} depends on data exchanged with the ${system}; the stories describe the good case only, so a failed or partial ${noun} would go unnoticed until someone misses the data.`,
      fix: `Add a criterion that a failed ${noun} is retried, reported to ${owner === "the team" ? owner : actorsPlural(owner)} and can be sent again by hand.`,
      target: fid(f),
    });
  }

  // E-mails and reminders: language and sender.
  for (const f of features.filter((g) => mentions(g.text, WORDS.notify)).slice(0, 1)) {
    const kind = /remind/.test(f.text) ? "reminders" : /notification|push/.test(f.text) ? "notifications" : "e-mails";
    out.push({
      rule: "notify",
      severity: "low",
      question: `In which language and from which sender do the ${kind} of ${q(f.title)} go out?`,
      why: `${q(f.title)} sends ${kind}, but the language, the sender address and what happens to undeliverable mail are not decided.`,
      fix: `Send in the recipient's language (German, French or English) from a no-reply address of ${x.client || "the client"}, and show undeliverable mail to the team.`,
      target: fid(f),
    });
  }

  // Amounts: VAT and rounding.
  if (!(/vat/.test(settled) && /round/.test(settled))) {
    for (const f of features.filter((g) => mentions(g.text, WORDS.money)).slice(0, 1)) {
      out.push({
        rule: "amounts",
        severity: "low",
        question: `Are the amounts in ${q(f.title)} shown with or without VAT, and how are they rounded?`,
        why: `Amounts appear in ${q(f.title)}, but the acceptance criteria do not say whether VAT is included or how amounts are rounded.`,
        fix: `State the rule in the criteria, such as "prices excluding VAT, totals rounded to the nearest cent".`,
        target: fid(f),
      });
    }
  }

  // Quiet scopes still get a few practical points.
  if (features.length > 0) {
    const last = features[features.length - 1]!;
    const first = features[0]!;
    const actor = mainActor(features) || "user";
    out.push({
      rule: "empty-state",
      severity: "low",
      question: `What does ${q(last.title)} show before there is any data?`,
      why: `The first time ${aActor(actor)} opens it, there is nothing to list yet; no story says what they see then.`,
      fix: `Add a criterion for the empty state: a short explanation and the one action that fills it.`,
      target: fid(last),
    });
    out.push({
      rule: "support",
      severity: "low",
      question: `Who answers questions from ${actorsPlural(actor)} in the first weeks after go-live?`,
      why: `The scope has no help or contact point, so questions would arrive by phone and e-mail at whoever people know.`,
      fix: `Add a help link with a contact of ${x.client || "the client"} to ${q(first.title)} and name who answers.`,
      target: fid(first),
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** The points to raise: at most 6, a few per rule and per target, skipping what people decided before. */
export function choosePoints(all: readonly Point[], decided: ReadonlySet<string>): Point[] {
  const out: Point[] = [];
  const perRule = new Map<string, number>();
  const perTarget = new Map<string, number>();
  const generic = new Set(["empty-state", "support"]);
  for (const p of all) {
    if (out.length >= MAX_POINTS) break;
    if (decided.has(p.question)) continue;
    if (generic.has(p.rule) && out.length >= MIN_POINTS) continue;
    const r = perRule.get(p.rule) ?? 0;
    const t = perTarget.get(p.target.id) ?? 0;
    if (r >= (PER_RULE[p.rule] ?? 1) || t >= 2) continue;
    out.push(p);
    perRule.set(p.rule, r + 1);
    perTarget.set(p.target.id, t + 1);
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function readinessOf(points: readonly Pick<Point, "severity">[]): number {
  const n = (s: Severity) => points.filter((p) => p.severity === s).length;
  return Math.max(35, 100 - 18 * n("high") - 8 * n("medium") - 3 * n("low"));
}

function inputOf(run: JobRun, version: number): GrillInput {
  const p = run.p;
  const all = p.features(version);
  return {
    version,
    features: includedFeatures(p, version),
    dropped: all.filter((f) => f.Status === "dropped").map((f) => ({ title: str(f.Title), requirementRefs: strs(f.RequirementRefs) })),
    milestones: p.milestones(version).map((m) => ({ number: num(m.Number), name: str(m.Name), featureRefs: strs(m.FeatureRefs) })),
    requirements: p
      .requirements()
      .filter((r) => r.Status !== "dropped" && str(r.Key))
      .map((r) => ({ number: num(r.Number), key: str(r.Key), title: str(r.Title), text: str(r.Text), priority: str(r.Priority) || "must" })),
    settled: [
      ...p.requirements().map((r) => `${str(r.Title)} ${str(r.Text)} ${strs(r.AcceptanceCriteria).join(" ")}`),
      ...p.techDecisions().filter((t) => t.Status !== "rejected").map((t) => `${str(t.Title)} ${str(t.Choice)} ${str(t.Rationale)}`),
      str(p.objective()?.Statement),
    ].join(" "),
    client: p.client,
  };
}

export async function scopeGrill(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const version = num(run.input.scopeVersion, p.scopeVersion) || p.scopeVersion;
  const x = inputOf(run, version);
  const storyCount = x.features.reduce((n, f) => n + f.stories.length, 0);
  const decidedBefore = new Set(p.rows("Challenge").filter((c: Row) => c.Status !== "open").map((c: Row) => str(c.Question)));
  // Claude's second opinion, started now and read when the checks are done (else the built-in rules)
  const fromAi = early(aiPoints(run, x, decidedBefore));
  await run.step(5, `Reading scope v${version}: ${plural(x.features.length, "feature")}, ${plural(storyCount, "story", "stories")}, ${plural(x.requirements.length, "requirement")}.`);
  await run.wait(4);
  await run.step(20, "Checking that every requirement is covered by a feature.");
  await run.wait(4);
  await run.step(38, "Checking acceptance criteria and story sizes.");
  await run.wait(4);
  await run.step(55, "Checking roles, personal data, offline use and connections.");
  await run.wait(4);

  const decided = new Set(
    p.rows("Challenge")
      .filter((c: Row) => c.Status !== "open")
      .map((c: Row) => str(c.Question)),
  );
  const points = (await fromAi)?.filter((pt) => !decided.has(pt.question)) ?? choosePoints(findPoints(inputOf(run, version)), decided);
  const count = (s: Severity) => points.filter((pt) => pt.severity === s).length;
  await run.step(70, `Writing the second opinion: ${plural(points.length, "point")}.`);
  const opinionId = await run.insert(
    "SecondOpinion",
    { ScopeVersion: version, EngineJobId: run.id, Readiness: readinessOf(points), OpenHigh: count("high"), OpenMedium: count("medium"), OpenLow: count("low") },
    "opinion",
  );
  const outputs = [`SecondOpinion:${opinionId}`];
  // the points, a few at a time (own RequestKeys: the order of the writes does not matter)
  const ids = await inParallel(points, 6, async (pt, i) => {
    await run.wait(1.5);
    await run.step(72 + Math.round((26 * (i + 1)) / Math.max(1, points.length)), `${cap(pt.severity)}: ${clip(pt.question, 150)}`);
    return run.insert(
      "Challenge",
      {
        OpinionId: opinionId,
        ChallengeType: pt.rule,
        Severity: pt.severity,
        Question: pt.question,
        Why: pt.why,
        SuggestedFix: pt.fix,
        TargetType: pt.target.type,
        TargetRef: `${pt.target.type}:${pt.target.id}`,
        AnswerText: "",
        DismissReason: "",
        FinalText: "",
        Status: "open",
      },
      `challenge-${i + 1}`,
    );
  });
  outputs.push(...ids.map((id) => `Challenge:${id}`));
  return { outputs, message: `Raised ${plural(points.length, "point")} on scope v${version}.` };
}
