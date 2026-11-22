// Building a milestone or a change with the official MADP engine: the Factory's approved plan (tickets, acceptance,
// the team's comments, the change analysis, the product facts) becomes the lane's description; `madp feature` plans,
// develops in parallel, gates, commits, pushes and deploys it to dev; a change of one ticket goes through
// `madp quick`. Releases to stage and production are `madp promote` (a fast-forward of the tested dev commit).
import fs from "node:fs";
import path from "node:path";
import type { BuildTicket, ChangeBrief, FeatureBuildBrief } from "../build/prompt.ts";
import { changeBlock } from "../build/prompt.ts";
import { JobFailure, type JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { ensureBlocksSession, storeOf, tenantOf } from "./blocksLogin.ts";
import { handoffBlock, placeHandoff, removeHandoff, type Handoff } from "./handoff.ts";
import { parseRegistry } from "./hostRegistry.ts";
import { laneFailure, needsAttention, officialHome, runLane, type LaneResult, type LaneStep } from "./madp.ts";
import { isBrief, NEUTRAL_RULE, privateTerms, productSentence, recordText, scrubTask, withoutTerms, type Terms } from "./neutral.ts";
import type { AcceptCheck } from "../../../../src/domain/afterDeploy";

export interface WorkAsk {
  product: string;
  /** "Milestone 1: Browse and buy" or "CR-3: Rename the Save button". */
  label: string;
  goal: string;
  tickets: BuildTicket[];
  /** What earlier builds made (the app has it). */
  built: BuildTicket[];
  /** What later milestones add (leave room, do not build now). */
  later: string[];
  facts?: string[];
  change?: ChangeBrief;
  /** The approved design and the attached files placed in every repo for this work (handoff.ts placeHandoff). */
  handoff?: Pick<Handoff, "design" | "attachments">;
  /** A fix round of a change whose own checks failed after its deploy (src/domain/changeChecks.ts): what to fix, with
   *  the failing checks, their output, the deployed commits and the rule (failingChecks.ts fixBlock). It takes the
   *  place of the tickets: the change's tickets are built already and are listed as built. */
  fix?: string;
  /** A revert (src/domain/changeChecks.ts): only the commit's words and the change's record come from here (revert.ts
   *  runs the lane). */
  revert?: boolean;
  /** A fix round or a revert: the build it fixes or takes off again (its increment of a feature and its tickets) and
   *  the fix round's number, for the change's record. Its head keeps that build's analysis, increment and tickets (the
   *  round builds no tickets of its own); its round says "fix round <n>" or that development was put back. */
  fixes?: { round?: number; feature?: FeatureBuildBrief; tickets: BuildTicket[] };
  /** A fix round: the live tests ("<repo key>:<repo path>", e.g. "api:test/tariffs.mjs") that failed on dev and that
   *  this work must make pass. The lane reproduces them on dev before its developers start, hands them the output and
   *  a probe of dev, and runs them again after the deploy (`--live-check`); `madp accept` runs them with the change's
   *  own tests (`--also`). */
  liveChecks?: string[];
  /** A fix round: what the change's checks on dev reported after the last deploy (AcceptOutcome.checks, the engine's
   *  structured result). The lane's developers get every check; its failed live tests become live checks
   *  (`--failed-checks`); a "not judged" check is the environment's and is never fixed in code. */
  failedChecks?: AcceptCheck[];
  /** A fix round: the commits the build (or the round) whose checks failed deployed (`--previous-commit`): the engine's
   *  diagnosis sees what they changed, and a round after one that changed nothing the failing checks exercise goes
   *  deep. */
  fixesCommits?: string[];
  /** A fix round: every commit of the change before it (its base build and earlier rounds, `--change-commit`): never
   *  "before this change" for the checks' baseline. */
  changeCommits?: string[];
  /** Live tests ("<repo>:<path>") that run again in the checks after the deploy (`madp accept --also`) without being the
   *  round's targets: the failing ones the round before's diagnosis put in the environment (their verdict stays). */
  alsoChecks?: string[];
}

const bullets = (xs: string[]): string => xs.map((x) => `- ${x.trim().replace(/^-\s+/, "")}`).join("\n");

/** The lane's description: everything the Factory's planning decided, in the order a developer reads it. Internal
 *  codenames, the host's private terms and planning notes ("Why: ... parity", priorities) are taken out of it first
 *  (neutral.ts scrubTask; the design handoff keeps its file paths), and its ground rules keep them, people's names and
 *  the task's own text out of the code, the texts and the commits (pure, `terms` defaults to the engine host's). */
export function describeWork(a: WorkAsk, terms: Terms = privateTerms()): string {
  const out: string[] = [`${a.product}: ${a.label}`];
  if (a.goal.trim()) out.push(`## Goal\n${a.goal.trim()}`);
  if (a.change) out.push(changeBlock(a.change));
  // a fix round: what the checks found takes the place of the tickets
  const open = a.fix ? [] : a.tickets.filter((t) => !t.done);
  if (a.fix) out.push(a.fix);
  else out.push(`## Build these ${open.length === 1 ? "ticket" : `${open.length} tickets`} (each is done when its acceptance criteria hold)`);
  for (const t of open) {
    const lines = [`### #${t.number} ${t.title}`];
    if (t.feature) lines.push(`Feature: ${t.feature}`);
    if (t.description.trim()) lines.push(t.description.trim());
    if (t.acceptance.length) lines.push(`Acceptance criteria:\n${bullets(t.acceptance)}`);
    if (t.comments?.length) lines.push(`What the team wrote on this ticket (follow it):\n${bullets(t.comments)}`);
    out.push(lines.join("\n"));
  }
  // the design handoff names the files placed in the repos: its paths stay as they are
  const design = a.handoff ? handoffBlock(a.handoff) : "";
  const designAt = design ? out.push(design) - 1 : -1;
  if (a.facts?.length) out.push(`## Product rules (keep them everywhere)\n${bullets(a.facts)}`);
  if (a.built.length) out.push(`## Already in the product (keep working, do not rebuild)\n${bullets(a.built.map((t) => `#${t.number} ${t.title}`))}`);
  if (a.later.length) out.push(`## Coming in later milestones (leave room, do not build now)\n${bullets(a.later)}`);
  const clean = out.map((part, i) => (i === designAt ? part : scrubTask(part, terms))).filter((part) => part.trim());
  clean.push(`## Ground rules\n- Keep the product's design system, routes and existing behaviour.\n- Plain product wording on every screen; no placeholder or test text.\n- The API and the web app stay consistent: a field the web app shows is one the API returns.\n- ${NEUTRAL_RULE}`);
  return `${clean.join("\n\n")}\n`;
}

/** One line as plain text: markdown markers, emphasis, code ticks and link targets dropped; e-mail addresses and
 *  @-mentions left out (a commit names no people). */
const plain = (s: string): string =>
  s
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "")
    .replace(/(^|\s)@[\w-]+(\.[\w-]+)*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]?\s*([.,;:!?)])/g, "$1")
    .trim();

/** "Rename the button" → "rename the button"; codes and acronyms ("CR-001", "API", "iOS") stay. */
const lowerFirst = (s: string): string => (/^[A-Z][^A-Z\d\s]+(\s|$)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** At most `n` characters, cut at a word (a body's gist may end in "..."). */
function clipWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, Math.max(1, n - 3));
  return `${(cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,;:-]+$/, "")}...`;
}

// A phrase starts at these words: a title cut right before one reads as a whole phrase (the engine's quick_ops.shorten).
const PHRASE_START = new Set(
  "with without and or but for to of in on at by from via using including plus so that which when where while if as into onto per vs versus than then after before until because".split(" "),
);
// A cut title never ends on one of these (it would end mid-phrase).
const DANGLING = new Set([...PHRASE_START, ..."a an the its their our your his her my this these those".split(" ")]);

/** A commit title in at most `n` characters, cut where a phrase ends and never with "...": the longest run of whole
 *  words that fits and ends before a word that starts a phrase ("with", "and", "for", …) or after a comma, semicolon
 *  or colon, when that keeps at least half of the room; else the longest run of whole words without the small words
 *  it would end on. A first word longer than `n` is cut hard (pure). */
export function clipTitle(s: string, n: number): string {
  const flat = s.split(/\s+/).filter(Boolean).join(" ");
  if (flat.length <= n) return flat;
  const words = flat.split(" ");
  let fit = 0;
  while (fit < words.length && words.slice(0, fit + 1).join(" ").length <= n) fit += 1;
  if (fit === 0) return flat.slice(0, n).replace(/[\s,;:-]+$/, "");
  const clean = (k: number): string => {
    const ws = words.slice(0, k);
    while (ws.length > 1 && DANGLING.has(ws[ws.length - 1]!.toLowerCase().replace(/[,;:]+$/, ""))) ws.pop();
    return ws.join(" ").replace(/[\s,;:\-–(]+$/, "");
  };
  for (let k = fit; k > 0; k -= 1) {
    const endsPhrase = /[,;:]$/.test(words[k - 1]!) || PHRASE_START.has(words[k]!.toLowerCase());
    if (endsPhrase && words.slice(0, k).join(" ").length * 2 >= n) return clean(k);
  }
  return clean(fit);
}

/** The sentences of a text that may go into a commit body (neutral.ts productSentence), from its prose only: headings,
 *  lists, tables, quotes and code are left out, and a brief or a prompt gives none (pure). */
function productSentences(text: string, terms: Terms): string[] {
  if (isBrief(text)) return [];
  let fenced = false;
  const prose: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && line.trim() && !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\|)/.test(line)) prose.push(plain(line));
  }
  const flat = prose.filter(Boolean).join(" ");
  return (flat.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((x) => productSentence(x, terms)).filter((x): x is string => !!x);
}

/** A commit body: the whole sentences that fit about three lines (a single longer one is cut at a word). */
function bodyOf(sentences: string[], max = 220): string {
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (out && next.length > max) break;
    out = next;
  }
  return clipWords(out.trim(), max);
}

// The first word of an imperative subject (or its "-s" or "-ing" form: "Adds", "Sharing" stay as they are).
const VERBS = new Set(
  ("add allow let show hide rename remove delete drop make support enable disable change update move use keep fix improve display list export " +
    "import send create edit sort filter group link open close save print refresh replace split merge limit require validate calculate " +
    "compute track record store log handle prevent stop start set mark warn notify block unblock sync translate format round reorder " +
    "simplify clarify speed extend introduce offer provide accept reject check cache load reuse shorten widen narrow align unify upgrade " +
    "migrate convert attach detach archive restore copy duplicate share invite assign schedule remind pay refund bill invoice charge apply " +
    "match connect disconnect configure customise customize localise localize label rework redesign restyle clean tidy polish highlight " +
    "resize reset select pick choose search find count sum total lock unlock reveal prefill fill tighten").split(" "),
);
const isVerb = (word: string): boolean => {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (VERBS.has(w)) return true;
  const stems = [w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/(.)\1ing$/, "$1")];
  return stems.some((x) => x !== w && VERBS.has(x));
};

/** "Partial invoices" -> "add partial invoices" for a new feature; a title that starts with a verb, a change's or a
 *  fix's title stays as it is. */
const imperative = (what: string, feature: boolean): string => (feature && what && !isVerb(what.split(" ")[0]!) ? `add ${lowerFirst(what)}` : what);

/** What the lane's commit says (`--title`, `--summary`): a short conventional subject in the product's words (the lane
 *  adds the repo as its scope; with a 3-letter scope it fits 72 characters, a longer title is cut where a phrase ends,
 *  never with "...", and keeps its "(part n of m)"), and a body of at most about three lines on what changed for the
 *  people who use the product: the change analysis's summary (a feature's increment: its goal), else the request's own
 *  description when it is one. Never the task or a brief, no change request code, no planning notes (parity,
 *  priorities), no people's names or e-mail addresses, no internal codenames or private terms (neutral.ts: a title
 *  loses the words, a body the sentences) and no tool or AI trailer; the product's registry sets the author (pure,
 *  `terms` defaults to the engine host's). */
export function commitOf(a: WorkAsk, terms: Terms = privateTerms()): { title: string; summary: string } {
  const label = plain(a.label);
  const tidy = (x: string): string => withoutTerms(x, terms).replace(/\s+/g, " ").replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, "").trim();
  const from = (...texts: (string | undefined)[]): string => {
    for (const t of texts) {
      const body = t ? bodyOf(productSentences(t, terms)) : "";
      if (body) return body;
    }
    return "";
  };
  const cr = /^([A-Z]{1,4}-\d+):\s*(.+?)(?:\s*\(increment (\d+) of (\d+)\b[^)]*\))?$/.exec(label);
  if (cr) {
    const [, code, raw, part, of] = cr;
    const fix = code.startsWith("FX-") || a.change?.kind === "fix" || !!a.fix;
    const feature = !fix && (!!a.change?.feature || a.change?.kind === "feature");
    const text = tidy(raw) || tidy(a.tickets.find((t) => !t.done)?.title ?? "") || "update the product";
    // "Profile: rename the button": the area label is left out of the subject and named in the body
    const area = /^([^:]{1,30}):\s+([A-Za-z][a-z]*\s+\S.*)$/.exec(text);
    const dropped = area && area[1].split(" ").length <= 3 ? area : null;
    const what = imperative(lowerFirst((dropped ? dropped[2] : text).replace(/[\s.]+$/, "")), feature);
    const suffix = part ? ` (part ${part} of ${of})` : "";
    const why = from(a.change?.feature?.goal, a.change?.summary, a.goal);
    const line = !why ? (dropped ? productSentence(`${text.replace(/[\s.]+$/, "")}.`, terms) ?? "" : "") : dropped && !why.toLowerCase().includes(dropped[1].toLowerCase()) ? `${dropped[1]}: ${why}` : why;
    // a revert takes the change off the environment again; a fix round makes it work as its checks expect
    if (a.revert) return { title: `revert: ${clipTitle(what.replace(/^add /, ""), 60 - suffix.length)}${suffix}`, summary: "Takes this change off the development environment again: its own checks there did not pass." };
    if (a.fix) return { title: `fix: ${clipTitle(what.replace(/^add /, ""), 60 - suffix.length)}${suffix}`, summary: line ? `${line} Fixes what its own checks found on the development environment.` : "Fixes what its own checks found on the development environment." };
    return { title: `${fix ? "fix" : "feat"}: ${clipTitle(what, 60 - suffix.length)}${suffix}`, summary: line };
  }
  const why = from(a.goal);
  const ms = /^Milestone (\d+):\s*(.+)$/i.exec(label);
  if (ms) return { title: `feat: ${clipTitle(`build milestone ${ms[1]}: ${tidy(ms[2]) || "the next part"}`, 60)}`, summary: why };
  return { title: `feat: ${clipTitle(lowerFirst(tidy(label) || "update the product"), 60)}`, summary: why };
}

/** The change's record the lane writes into the product repo (`--change-record`, the engine's
 *  docs/changes/<id>.md, schema madp-change-record/1) and commits with the build. */
export interface ChangeRecordFile {
  schema: "madp-change-record/1";
  id: string;
  title: string;
  kind: string;
  summary: string;
  /** increment, build, fix (a fix's build), fix-round (a round after the change's checks failed on dev: n its number,
   *  title the increment it fixes) or revert (development put back to the last build whose checks passed). */
  round: { kind: "increment" | "build" | "fix" | "fix-round" | "revert"; n?: number; of?: number; title?: string; goal?: string };
  increments: { n: number; title: string; goal: string; state: "built" | "this build" | "later" }[];
  touches: string[];
  parts: string[];
  codeAreas: string[];
  acceptanceCriteria: string[];
  decisions: { question: string; answer: string }[];
  risks: string[];
  tickets: { number: number; title: string; acceptance: string[] }[];
}

/** "Increment 3: Title: goal" (FeatureBuildBrief.earlier / later) -> its parts. */
function incrementLine(line: string): { n: number; title: string; goal: string } | null {
  const m = /^Increment (\d+):\s*([^:]+?)(?::\s*(.*))?$/.exec(line.trim());
  return m ? { n: Number(m[1]), title: m[2]!.trim(), goal: (m[3] ?? "").trim() } : null;
}

/** The record of a change's build (null for a milestone, or a label without a change code): the analysis as approved
 *  for this build, its increments with their state, and the tickets this build makes, in neutral words (neutral.ts
 *  recordText: no codenames, private terms, planning notes, people or e-mail addresses; the tickets' comments are
 *  left out). The engine adds its plan and the round (pure, `terms` defaults to the engine host's). A fix round and a
 *  revert (WorkAsk.fix, .revert) keep the increment and the tickets of the build they are about (WorkAsk.fixes); a
 *  revert's increment is to be built again ("later"). */
export function changeRecordOf(a: WorkAsk, terms: Terms = privateTerms()): ChangeRecordFile | null {
  const m = /^([A-Z]{1,6}-\d{1,6}):\s*(.+?)(?:\s*\(increment (\d+) of (\d+)\b[^)]*\))?$/.exec(plain(a.label));
  if (!m) return null;
  const [, id, rawTitle] = m;
  const say = (s: string | undefined): string => recordText(s ?? "", terms);
  const many = (xs: string[] | undefined): string[] => (xs ?? []).map(say).filter(Boolean);
  const c = a.change;
  const f = a.fixes?.feature ?? c?.feature;
  const title = withoutTerms(rawTitle!, terms).replace(/\s+/g, " ").trim() || id!;
  const kind = id!.startsWith("FX-") ? "fix" : c?.kind === "fix" ? "fix" : f || c?.kind === "feature" ? "feature" : "change";
  const increments: ChangeRecordFile["increments"] = [];
  if (f) {
    for (const l of f.earlier) { const i = incrementLine(l); if (i) increments.push({ ...i, state: "built" }); }
    increments.push({ n: f.increment, title: f.title, goal: f.goal, state: a.revert ? "later" : "this build" });
    for (const l of f.later) { const i = incrementLine(l); if (i) increments.push({ ...i, state: "later" }); }
  }
  const of = f ? `increment ${f.increment} of ${f.of}: ${say(f.title)}` : "";
  const round: ChangeRecordFile["round"] = a.revert ? { kind: "revert", ...(f ? { n: f.increment, of: f.of, title: say(f.title) } : {}) }
    : a.fix ? { kind: "fix-round", ...(a.fixes?.round ? { n: a.fixes.round } : {}), ...(of ? { title: of } : {}) }
      : f ? { kind: "increment", n: f.increment, of: f.of, title: say(f.title), goal: say(f.goal) } : { kind: kind === "fix" ? "fix" : "build" };
  const tickets = a.fixes && (a.fix || a.revert) ? a.fixes.tickets : a.tickets.filter((t) => !t.done);
  return {
    schema: "madp-change-record/1",
    id: id!,
    title,
    kind,
    summary: say(c?.summary) || say(a.goal),
    round,
    increments: increments.map((i) => ({ ...i, title: say(i.title), goal: say(i.goal) })).filter((i) => i.title),
    touches: many(c?.touches),
    parts: f?.parts ?? [],
    codeAreas: many(f?.codeAreas),
    acceptanceCriteria: many(c?.acceptanceCriteria),
    decisions: (c?.answers ?? []).map((x) => ({ question: say(x.question), answer: say(x.answer) })).filter((x) => x.question && x.answer),
    risks: many([...(c?.conflicts ?? []), ...(c?.risks ?? [])]),
    tickets: tickets.map((t) => ({ number: t.number, title: say(t.title), acceptance: many(t.acceptance) })).filter((t) => t.title),
  };
}

/** The lane options the installed official engine knows (the Factory and the engine can be updated in either order):
 *  `--change-record`, `--live-check`, `--failed-checks` and `--fix-round` (a fix round with depth: the engine diagnoses
 *  first, decides the depth, guards against a change that fixes nothing and deploys, checks and iterates by itself)
 *  on both work lanes. */
export function engineLaneOptions(home = officialHome()): { changeRecord: boolean; liveCheck: boolean; failedChecks: boolean; fixRound: boolean; changeCommit: boolean; diagnosis: boolean; mergeTurn: boolean } {
  const has = (flag: string): boolean => {
    try {
      return ["quick.py", "feature.py"].every((f) => fs.readFileSync(path.join(home, "MADP", "orchestrator", "cli", f), "utf8").includes(`"${flag}"`));
    } catch {
      return false;
    }
  };
  // --change-commit and --diagnosis come with the fix rounds' options (cli/quick.py add_fix_args, used by both lanes)
  const fixArgs = (flag: string): boolean => {
    try {
      return fs.readFileSync(path.join(home, "MADP", "orchestrator", "cli", "quick.py"), "utf8").includes(`"${flag}"`) && has("--fix-round");
    } catch {
      return false;
    }
  };
  // parallel streams: an isolated run that waits for its turn in the caller's merge queue (primitives/merge_turn.py)
  return { changeRecord: has("--change-record"), liveCheck: has("--live-check"), failedChecks: has("--failed-checks"), fixRound: has("--fix-round"), changeCommit: fixArgs("--change-commit"), diagnosis: fixArgs("--diagnosis"), mergeTurn: has("--merge-turn") };
}

/** A change of one ticket goes through the quick lane; everything else (a milestone, a feature on an existing product)
 *  through the feature lane. */
export const laneFor = (kind: "milestone" | "change" | "feature", tickets: number): "quick" | "feature" => (kind === "change" && tickets === 1 ? "quick" : "feature");

/** The lane of a fix round. Its failing checks in more than one repo: the feature lane (a planner and one developer
 *  per repo). In one repo, with an engine that does fix rounds with depth (`--fix-round`): the quick lane, which
 *  diagnoses first with the strong model, goes deep when product behaviour fails, guards against a change that fixes
 *  nothing and deploys, checks and iterates by itself. An engine without it: the feature lane, whose planner (the
 *  strong model) is the depth the quick lane's single developer lacked (09.11.2026 CR-006: 9 turns, one test parameter,
 *  the same checks failing after the deploy) (pure). */
export function fixLaneOf(ask: Pick<WorkAsk, "liveChecks" | "failedChecks">, o: { fixRound: boolean }): "quick" | "feature" {
  const repos = new Set([...liveChecksOf(ask).map((x) => x.split(":")[0]!), ...(ask.failedChecks ?? []).filter((c) => c.verdict === "failed" && c.repo).map((c) => c.repo)]);
  if (repos.size > 1) return "feature";
  return o.fixRound ? "quick" : "feature";
}

/** How long the Factory waits for a lane: a fix round with depth deploys and checks up to the engine's iterations
 *  (pipeline.yml fix.max_iterations, no new one after fix.max_minutes = 120), so it gets 180 minutes (pure). */
export const laneTimeoutMs = (lane: "quick" | "feature", fixRound = false): number => (fixRound ? 180 : lane === "quick" ? 40 : 120) * 60_000;

/** What the engine's fix round did (its `fixround  ...` line on stdout, fix_round_ops.LoopResult.line): the deploy
 *  iterations, the depth, the changes the no-op guard did not count as a fix, why it ended and what still failed
 *  (pure; null when the lane printed none). */
export interface FixLoop {
  line: string;
  round: number;
  iterations: number;
  of: number;
  depth: string;
  notAFix: number;
  passed: boolean;
  still: string[];
  /** The round's structured result (madp-fix-round/1, `fixresult  <path>`): the checks after the deploy take what its
   *  recheck passed on the deployed commit from it (`madp accept --passed-in-round`). */
  result?: string;
  /** The failing test files the round's diagnosis put in the environment, with evidence (their verdict stays failed). */
  environment?: FixEnvironment[];
  /** What the round's recheck passed on the deployed commit: repo -> files. */
  passedInRound?: Record<string, { commit: string; files: string[] }>;
  /** The round found nothing to change: why the failing checks are the environment's (madp-fix-round/1
   *  `nothing_to_change`). It deployed nothing and ended normally; a person decides. */
  nothing?: string[];
}

/** A failing test file the diagnosis of a fix round put in the environment, with evidence. */
export interface FixEnvironment {
  repo: string;
  file: string;
  cause: string;
  evidence: string[];
}

/** The fix round's structured result the lane wrote (its `fixresult  <path>` line), when it is a file in one of the
 *  lane's report folders (`dirs`); else null (pure but for the read). */
export function fixResultOf(stdout: string, dirs: string[]): { path: string; environment: FixEnvironment[]; passedInRound: NonNullable<FixLoop["passedInRound"]>; nothing: string[] } | null {
  const m = [...stdout.matchAll(/^fixresult\s+(\S.*\.json)\s*$/gm)].at(-1);
  if (!m) return null;
  const file = path.resolve(m[1]!.trim());
  if (!dirs.some((d) => path.dirname(file) === path.resolve(d))) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (data.schema !== "madp-fix-round/1") return null;
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
    const environment: FixEnvironment[] = (Array.isArray(data.environment) ? data.environment : []).map((e) => e as Record<string, unknown>)
      .filter((e) => str(e.repo, 40) && str(e.file, 200)).slice(0, 20)
      .map((e) => ({ repo: str(e.repo, 40), file: str(e.file, 200), cause: str(e.cause, 300), evidence: (Array.isArray(e.evidence) ? e.evidence : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 4) }))
      .filter((e) => e.evidence.length);
    const passedInRound: NonNullable<FixLoop["passedInRound"]> = {};
    for (const [repo, v] of Object.entries((data.passed_in_round ?? {}) as Record<string, { commit?: unknown; files?: unknown }>)) {
      const commit = str(v?.commit, 40);
      const files = v?.files && typeof v.files === "object" ? Object.keys(v.files as object).slice(0, 50) : [];
      if (/^[0-9a-f]{7,40}$/i.test(commit) && files.length) passedInRound[repo] = { commit, files };
    }
    const nothing = (Array.isArray(data.nothing_to_change) ? data.nothing_to_change : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 6);
    return { path: file, environment, passedInRound, nothing };
  } catch {
    return null;
  }
}

/** The diagnosis a quick lane made for a fix round and kept for the lane that takes it over (its `diagnosis  <path>`
 *  line, madp-fix-diagnosis/1), when it is a file in one of the lane's report folders; else "". */
export function handedDiagnosisOf(stdout: string, dirs: string[]): string {
  const m = [...stdout.matchAll(/^diagnosis\s+(\S.*\.json)\s*$/gm)].at(-1);
  if (!m) return "";
  const file = path.resolve(m[1]!.trim());
  return dirs.some((d) => path.dirname(file) === path.resolve(d)) && fs.existsSync(file) ? file : "";
}

export function fixLoopOf(stdout: string): FixLoop | null {
  const line = [...stdout.matchAll(/^fixround\s+(.+)$/gm)].at(-1)?.[1]?.trim();
  if (!line) return null;
  const m = /^round (\d+): (\d+) deploy iteration\(s\) of at most (\d+)/.exec(line);
  if (!m) return null;
  const still = /; still failing: (.+)$/.exec(line)?.[1] ?? "";
  // nothing to change (no iteration deployed): the failing checks are the environment's, a person decides
  const nothing = /; nothing to change: the failing checks are the environment's \((.+)\); a person decides/.exec(line)?.[1] ?? "";
  return {
    line: line.slice(0, 600),
    round: Number(m[1]),
    iterations: Number(m[2]),
    of: Number(m[3]),
    depth: /; depth (light|deep)\b/.exec(line)?.[1] ?? "",
    notAFix: Number(/; (\d+) not a fix \(guard\)/.exec(line)?.[1] ?? 0),
    passed: /the failing live tests pass on /.test(line),
    still: still ? still.split("; ").map((s) => s.trim()).filter(Boolean).slice(0, 6) : [],
    ...(nothing && Number(m[2]) === 0 ? { nothing: [nothing.slice(0, 300)] } : {}),
  };
}

/** The job's words for a fix round's iterations: "after 2 deploy iterations (deep)", with how many changes were not
 *  a fix (pure). */
export function fixLoopWords(f: FixLoop | null | undefined): string {
  if (!f) return "";
  const n = `${f.iterations} deploy iteration${f.iterations === 1 ? "" : "s"} of at most ${f.of}`;
  return `${n}${f.depth ? `, ${f.depth}` : ""}${f.notAFix ? `; ${f.notAFix} change${f.notAFix === 1 ? " was" : "s were"} not a fix` : ""}`;
}

/** The feature lane's --max-steps: the caller's (a feature on an existing product sizes it), else one per open ticket;
 *  3 to the lane's hard cap 12. */
export const laneSteps = (open: number, maxSteps?: number): number => Math.min(12, Math.max(3, maxSteps ?? open));

/** The commits a lane reports (its commit/push steps and the "repos" line of its summary). */
export function commitsOf(r: Pick<LaneResult, "steps" | "stdout">): string[] {
  const found = new Set<string>();
  for (const s of r.steps) if (/^(commit|push)/.test(s.name)) for (const m of s.outcome.matchAll(/\b[0-9a-f]{7,40}\b/g)) found.add(m[0]);
  const repos = /^repos\s+(.*)$/m.exec(r.stdout)?.[1] ?? "";
  for (const m of repos.matchAll(/\b[0-9a-f]{7,40}\b/g)) found.add(m[0]);
  return [...found];
}

export interface WorkResult {
  lane: "quick" | "feature";
  commits: string[];
  seconds: number;
  steps: LaneStep[];
  /** A fix round with depth: what the engine's loop did (fixLoopOf). */
  fixLoop?: FixLoop;
  /** The work's live checks (liveChecksOf: the given ones and, in a fix round, the test files that failed after the
   *  last deploy): `madp accept` runs them again after the steps after the deploy (acceptance.ts acceptTargets), also
   *  in a repo the work did not change. */
  liveChecks?: string[];
}

/** The lane deployed the work, but the change's own tests on dev did not pass (lane exit 12, QUICK-LANE.md "Live
 *  acceptance"): nothing was rolled back. A JobFailure (code "madp.accept"), so a caller that does not know it still
 *  fails the job in plain words; a caller that does reads `work` (commits, steps) and can finish the steps after the
 *  deploy and mark the work as needing attention. */
export class LaneAttention extends JobFailure {
  constructor(
    message: string,
    code: string,
    readonly work: WorkResult,
  ) {
    super(message, code);
    this.name = "LaneAttention";
  }
}

/** The options every work lane gets: the commits' short subject and body of their own (not the description),
 *  `--no-accept` when the job runs the change's own checks itself after its steps after the deploy, the change's record
 *  file (`--change-record`), a fix round's live checks (`--live-check`) and, when the engine does fix rounds with depth
 *  (`fixRound`), the round's number (`--fix-round`) and the commits it fixes (`--previous-commit`), each only when
 *  given (pure). */
export function laneArgs(ask: WorkAsk, o: { noAccept?: boolean; recordFile?: string; liveChecks?: boolean; checksFile?: string; fixRound?: boolean; changeCommit?: boolean } = {}): string[] {
  const c = commitOf(ask);
  // with the checks file the engine takes the failed live tests from it; the explicit ones still go as --live-check
  const checks = o.liveChecks ? liveChecksOf(o.checksFile ? { liveChecks: ask.liveChecks } : ask) : [];
  const fix = o.fixRound && ask.fix ? ["--fix-round", String(Math.max(1, ask.fixes?.round ?? 1))] : [];
  const previous = fix.length ? [...new Set((ask.fixesCommits ?? []).filter((x) => /^[0-9a-f]{7,40}$/i.test(x)))].slice(0, 10) : [];
  // the change's earlier commits: never "before this change" for the checks' baseline inside the round
  const change = fix.length && o.changeCommit ? [...new Set((ask.changeCommits ?? []).filter((x) => /^[0-9a-f]{7,40}$/i.test(x)))].slice(0, 40) : [];
  return [
    "--title", c.title, "--summary", c.summary,
    ...(o.noAccept ? ["--no-accept"] : []),
    ...(o.recordFile ? ["--change-record", o.recordFile] : []),
    ...(o.checksFile ? ["--failed-checks", o.checksFile] : []),
    ...checks.flatMap((x) => ["--live-check", x]),
    ...fix,
    ...previous.flatMap((x) => ["--previous-commit", x]),
    ...(change.length ? ["--change-commit", change.join(",")] : []),
  ];
}

/** A work's live checks as the lanes take them: "<repo key>:<repo-relative path>", no "..", no absolute path: the given
 *  ones, then the test files that FAILED after the last deploy (failedChecks; never a "not judged" check, the fixtures
 *  script or the step as a whole) (pure). */
export function liveChecksOf(ask: Pick<WorkAsk, "liveChecks" | "failedChecks">): string[] {
  const failed = (ask.failedChecks ?? [])
    .filter((c) => c.verdict === "failed" && c.repo && c.file && !/fixtures/i.test(c.why))
    .map((c) => `${c.repo}:${c.file}`);
  const ok = (x: string): boolean => {
    const m = /^([A-Za-z0-9_.-]+):(.+)$/.exec(x);
    if (!m) return false;
    const p = m[2]!.replace(/\\/g, "/");
    return !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.split("/").includes("..");
  };
  return [...new Set([...(ask.liveChecks ?? []), ...failed].map((x) => x.trim()).filter(ok))];
}

/** A stream's lane could not land its work on the latest development branch: the rebase onto it conflicted (also after
 *  the engine's one conflict fix-up), or the gates failed on the rebased code. Nothing was pushed or deployed; the
 *  work goes back to its developers (a new run on the latest branch), never forced in. */
export class MergeConflict extends JobFailure {
  constructor(message: string, readonly reason: string) {
    super(message, "madp.merge_conflict");
    this.name = "MergeConflict";
  }
}

/** The failure of an isolated lane that could not land cleanly, at its turn or while it waited for it (integrate or
 *  pre-rebase: integrate_conflict, rebase_failed, regate_failed, refresh_conflict, refresh_failed), or "" (pure). The
 *  lane first resolves a conflict in place (both intents, the gates again); this is what is left when that failed. */
export function mergeFailureOf(r: Pick<LaneResult, "steps" | "tail">): string {
  // at its turn (integrate) or while it waited for it (pre-rebase onto what landed meanwhile)
  for (const s of [...r.steps].reverse()) {
    const m = /^FAILED \((integrate_conflict|rebase_failed|regate_failed|refresh_conflict|refresh_failed)\)/.exec(s.outcome);
    if (/^(integrate|pre-rebase)/.test(s.name) && m) return m[1]!;
  }
  const t = r.tail.map((l) => /\b(integrate_conflict|rebase_failed|regate_failed|refresh_conflict|refresh_failed)\b/.exec(l)?.[1]).find(Boolean);
  return t ?? "";
}

/** A stream (parallel streams, kinds/delivery.ts): the lane works in its own working copies (`--isolate`) and waits on
 *  `turnFile` before it integrates (`--merge-turn`); when it says so (its step `merge-turn: waiting`), `grant` waits for
 *  the job's turn in the product's merge queue and then writes "go" there. */
export interface LaneStream {
  turnFile: string;
  grant: () => Promise<void>;
}

/** Runs the work on the official engine; the lane's steps go to `onStep` as they happen. `noAccept`: the lane skips the
 *  change's own checks on dev (`--no-accept`), because the job runs them itself after its data tables and texts
 *  (acceptance.ts); only when the installed engine has the option (acceptance.ts engineAccepts). */
export async function runOfficialWork(run: JobRun, app: OfficialApp, ask: WorkAsk, o: { kind: "milestone" | "change" | "feature"; onStep: (s: LaneStep) => Promise<void>; maxSteps?: number; noAccept?: boolean; stream?: LaneStream }): Promise<WorkResult> {
  const work = path.join(app.dir, "work");
  fs.mkdirSync(work, { recursive: true });
  const file = path.join(work, `${run.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}.md`);
  const open = ask.tickets.filter((t) => !t.done).length;
  // the change's record (docs/changes/<id>.md in the repos, committed with the build) and a fix round's live checks,
  // when the installed engine takes them
  const can = engineLaneOptions();
  const record = can.changeRecord ? changeRecordOf(ask) : null;
  const recordFile = record ? file.replace(/\.md$/, ".change.json") : "";
  if (record) fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  // the checks after the deploy run them again whether or not the lane takes them (`madp accept --also`), and the ones
  // that run again without being the round's targets
  const liveChecks = [...new Set([...liveChecksOf(ask), ...liveChecksOf({ liveChecks: ask.alsoChecks ?? [] })])];
  // a fix round: what the last deploy's checks reported, for the engine to read (the failed live tests, the reasons)
  const checksFile = can.failedChecks && ask.failedChecks?.length ? file.replace(/\.md$/, ".checks.json") : "";
  if (checksFile) fs.writeFileSync(checksFile, `${JSON.stringify({ checks: ask.failedChecks }, null, 2)}\n`);
  const deep = !!ask.fix && can.fixRound;
  // a stream: its own working copies, and its turn in the merge queue before it integrates (never a fix round: those
  // deploy and check again and again, so they run in the turn from the start)
  const stream = o.stream && can.mergeTurn && !ask.fix ? o.stream : undefined;
  const isolated = stream ? ["--isolate", "--merge-turn", stream.turnFile] : [];
  const commit = [...laneArgs(ask, { ...o, recordFile, liveChecks: can.liveCheck, checksFile, fixRound: can.fixRound, changeCommit: can.changeCommit }), ...isolated];
  // the lane asks for its turn with its step line; the steps are handed on in order, so nothing after it runs before
  const onStep = stream
    ? async (s: LaneStep) => {
      if (s.name === "merge-turn" && /^waiting/.test(s.outcome)) {
        await stream.grant();
        return;
      }
      await o.onStep(s);
    }
    : o.onStep;
  const started = Date.now();
  // a fix round: diagnosed, at the depth it needs, deployed and checked again by the engine (fixLaneOf); a lane that
  // cannot place the task in one repo goes to the feature lane (exit 2 below)
  let lane = ask.fix ? fixLaneOf(ask, can) : laneFor(o.kind, open);
  // the lane runs in the product's own Blocks login store (ensureApp connected it)
  const blocksConfigDir = storeOf(parseRegistry(fs.readFileSync(app.registry, "utf8")), app.name, "dev");
  // the plan's size: a fix round's failed checks (one more for a cause they share), a build's open tickets
  const failedCount = (ask.failedChecks ?? []).filter((c) => c.verdict === "failed").length;
  const steps = laneSteps(ask.fix ? Math.min(6, failedCount + 1) : open, o.maxSteps);
  const feature = (handed = "") =>
    runLane(run, ["feature", "--description-file", file, "--project", app.registry, "--env", "dev", "--max-steps", String(steps), ...commit, ...(handed ? ["--diagnosis", handed] : [])], {
      projectDir: app.dir, label: "feature", timeoutMs: laneTimeoutMs("feature", deep), onStep, blocksConfigDir, blocksTenant: app.tenant,
    });
  const reportDirs = ["quick", "feature"].map((k) => path.join(app.dir, "reports", k));
  // the approved design and the attached files go into every repo the lane may work in (git-ignored, never committed)
  // and the description names them; they are taken out again after the lane
  const handoff = await placeHandoff(run, Object.values(app.repos), ask.tickets);
  let r: LaneResult;
  try {
    fs.writeFileSync(file, describeWork({ ...ask, handoff }));
    if (lane === "quick") {
      r = await runLane(run, ["quick", "--task-file", file, "--project", app.registry, "--env", "dev", ...commit], { projectDir: app.dir, label: "quick", timeoutMs: laneTimeoutMs("quick", deep), onStep, blocksConfigDir, blocksTenant: app.tenant });
      // a task the quick lane cannot place in one repo (exit 2: "ambiguous, give --target", or a fix round whose
      // diagnosis puts causes in another repo) is a feature; the quick lane's diagnosis goes with it (no second one
      // unless the code moved)
      if (r.code === 2) {
        lane = "feature";
        const handed = ask.fix && can.diagnosis ? handedDiagnosisOf(r.stdout, reportDirs) : "";
        if (handed) run.log(`${ask.label}: the quick lane handed the round over with its diagnosis (${path.basename(handed)})`);
        r = await feature(handed);
      }
    } else {
      r = await feature();
    }
  } finally {
    removeHandoff(handoff);
  }
  const parsed = ask.fix ? fixLoopOf(r.stdout) : null;
  // the round's structured result: what its recheck passed (counted by the checks after the deploy) and the files its
  // diagnosis put in the environment
  const result = parsed ? fixResultOf(r.stdout, reportDirs) : null;
  const loop: FixLoop | null = parsed ? { ...parsed, ...(result ? { result: result.path, environment: result.environment, passedInRound: result.passedInRound, ...(result.nothing.length ? { nothing: result.nothing } : {}) } : {}) } : null;
  if (loop) run.log(`${ask.label}: fix round ${loop.round}: ${loop.line}`);
  const done: WorkResult = { lane, commits: commitsOf(r), seconds: Math.round((Date.now() - started) / 1000), steps: r.steps, ...(liveChecks.length ? { liveChecks } : {}), ...(loop ? { fixLoop: loop } : {}) };
  if (r.code !== 0 && needsAttention(r.code) && !r.capacity) {
    const f = laneFailure(ask.label, r);
    throw new LaneAttention(f.message, f.code, done);
  }
  if (r.code !== 0 && stream && !r.capacity) {
    const why = mergeFailureOf(r);
    if (why) throw new MergeConflict(`${ask.label} could not be merged cleanly onto the latest development branch (${why === "regate_failed" ? "its checks failed on top of the changes that landed meanwhile" : "it conflicts with changes that landed meanwhile"}). Nothing was deployed.`.slice(0, 300), why);
  }
  if (r.code !== 0) throw laneFailure(ask.label, r, { fix: !!ask.fix });
  return done;
}

/** True when the address answers 200 within about a minute (the lanes smoke-test too; this is the Factory's own look
 *  before it shows the address to people). */
export async function answers(url: string, tries = 6): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (res.ok) return true;
    } catch {
      /* again */
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  return false;
}

/** A tested dev commit to stage or production: `madp promote` (fast-forward only, then deploy and smoke), signed in to
 *  Blocks in that environment's own login store (people connect it on the release page when it has no session). */
export async function promote(run: JobRun, app: OfficialApp, env: "stage" | "production", step: (pct: number, line: string) => Promise<void> = (p, l) => run.step(p, l)): Promise<string> {
  const name = env === "stage" ? "stg" : "prod";
  const yml = fs.readFileSync(app.registry, "utf8");
  if (!new RegExp(`^\\s+${name}:`, "m").test(yml)) {
    throw new JobFailure(`${env === "stage" ? "Stage" : "Production"} is not set up for this product yet: its Blocks ${env} project and branch "${name}" must be added to the product's MADP registry first.`, "release.env_missing");
  }
  const data = parseRegistry(yml);
  await ensureBlocksSession(run, { product: run.p.name, name: app.name, env: name, data }, { step, pct: 30 });
  const r = await runLane(run, ["promote", "--project", app.registry, "--env", name, "--yes", "--json"], { projectDir: app.dir, label: "promote", timeoutMs: 60 * 60_000, blocksConfigDir: storeOf(data, app.name, name), blocksTenant: tenantOf(data, name) });
  if (r.code !== 0) throw laneFailure(`Releasing to ${env}`, r);
  const m = /https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"]*/i.exec(r.stdout);
  return m ? m[0] : app.url;
}
