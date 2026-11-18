import { designSource, makeProjectUrl, parseMakePrototype, rawDesignRequirements, type MakePrototype } from "./figmaMake";
import { parseFigmaScreens, type FigmaScreens } from "./figmaScreens";
import { briefFacts, type BriefRecords } from "./projectBrief";

export interface DesignIntent {
  version: 1;
  project: Record<string, unknown>;
  objective: { statement: string; criteria: string[] };
  requirements: ReturnType<typeof rawDesignRequirements>;
  extras: Record<string, unknown>[];
}
const text = (v: unknown) => typeof v === "string" ? v : "";
const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const PROJECT_KEYS = ["Goal", "TargetUsers", "Brief", "SetupWorkflows", "SetupExclusions", "SetupConstraints", "SetupMustHaves"];

/** The records besides the project row that hold what the project is about (projectBrief.ts BriefRecords). */
export type DesignFacts = BriefRecords;

/** The project part of the intent: the project's own fields first; an empty Brief, Goal or TargetUsers is filled from
 *  the records that now hold them (briefFacts: the Project brief note's description, the answers to the business
 *  analyst's brief questions, the same rule as every engine kind), then the objective statement for the goal. Only the
 *  note the guided start flagged is read: the functions load only that one (design/context.ts), so both sides hash
 *  alike. */
export function designProject(project: Record<string, unknown>, objective: Record<string, unknown> | null | undefined, facts: DesignFacts = {}): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(PROJECT_KEYS.map((k) => [k, project[k] ?? ""]));
  const f = briefFacts(project, { notes: (facts.notes ?? []).filter((n) => n.IsProjectBrief === true), clarifications: facts.clarifications });
  if (!text(project.Brief).trim() && f.description) out.Brief = f.description;
  const ownGoal = text(project.Goal).trim(), ownUsers = text(project.TargetUsers).trim();
  // a field the project already answers well enough stays exactly as stored (an unchanged project keeps its source)
  if (f.goal !== ownGoal) out.Goal = f.goal;
  else if (!ownGoal && text(objective?.Statement).trim()) out.Goal = text(objective?.Statement).trim();
  if (f.targetUsers !== ownUsers) out.TargetUsers = f.targetUsers;
  return out;
}

export function designIntent(project: Record<string, unknown>, objective: Record<string, unknown> | null | undefined,
  requirements: readonly Record<string, unknown>[], extras: readonly Record<string, unknown>[], facts: DesignFacts = {}): DesignIntent {
  return { version: 1, project: designProject(project, objective, facts),
    objective: { statement: text(objective?.Statement), criteria: strings(objective?.AcceptanceCriteria) },
    requirements: rawDesignRequirements(requirements).sort((a, b) => a.key.localeCompare(b.key)),
    extras: extras.filter((r) => r.Status !== "removed" && r.IsDeleted !== true).map((r) => ({
      kind: text(r.Kind), title: text(r.Title), who: text(r.Who), steps: strings(r.Steps), constraintKind: text(r.ConstraintKind),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
/** A project's rows as the engine holds them (its ProjectView). */
export interface DesignRows {
  readonly project: Record<string, unknown>;
  objective(): Record<string, unknown> | undefined;
  requirements(): readonly Record<string, unknown>[];
  rows(schema: string): readonly Record<string, unknown>[];
}
/** The intent from the engine's rows: the same records as the functions' loadDesignIntent, so both sides hash alike. */
export const designIntentOf = (p: DesignRows): DesignIntent => designIntent(p.project, p.objective(), p.requirements(), p.rows("RequirementExtra"),
  { notes: p.rows("DocNote"), clarifications: p.rows("Clarification") });
export const factoryDesignSource = (intent: DesignIntent): string => `factory-v1:${designSource(JSON.stringify(intent), [])}`;

/** What a saved design's source is checked against. `source` is the current intent's: a new design is made from it.
 *  `legacySource` is the same records worked out as before 08.11, when the intent read only the project's own Goal,
 *  TargetUsers and Brief (not yet the Project brief note, the brief answers or the objective as the goal): a design made
 *  then carries that source. */
export interface DesignSources { source: string; legacySource: string }
export function designSources(intent: DesignIntent, project: Record<string, unknown>): DesignSources {
  const legacy: DesignIntent = { ...intent, project: Object.fromEntries(PROJECT_KEYS.map((k) => [k, project[k] ?? ""])) };
  return { source: factoryDesignSource(intent), legacySource: factoryDesignSource(legacy) };
}
/** designSources from the engine's rows (the functions' loadDesignSources reads the same records). */
export const designSourcesOf = (p: DesignRows): DesignSources => designSources(designIntentOf(p), p.project);
/** Whether a saved design was made from the project's current records: its source is the current intent's, or it was
 *  made before 08.11 and the records that intent read are unchanged. Reading the description and the brief answers
 *  since then is no change of the project, so it never makes an approved design out of date by itself; a change of
 *  the goal, the users, the description field, the setup lists, the objective, a requirement or an extra still does. */
export function designSourceCurrent(stored: unknown, sources: Partial<DesignSources> | null | undefined): boolean {
  return typeof stored === "string" && stored !== "" && !!sources && (stored === sources.source || stored === sources.legacySource);
}
export const factoryPreviewPath = (projectId: string, revision: string): string => `/api/design-preview/${encodeURIComponent(projectId)}/${encodeURIComponent(revision)}`;
export interface FactoryPrototype {
  provider: "factory";
  projectUrl: string;
  previewUrl: string;
  revision: string;
  source: string;
  jobId: string;
  artifactFileId: string;
  projectId: string;
  figmaReferenceUrl: string | null;
}
export function parseFactoryPrototype(raw: unknown): FactoryPrototype | null {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!p || p.provider !== "factory" || ![p.projectId, p.jobId, p.revision, p.artifactFileId].every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v)) ||
      !/^[a-f0-9]{64}$/.test(p.revision) ||
      typeof p.source !== "string" || !/^(factory-v1:ux-|pending:)/.test(p.source) ||
      p.previewUrl !== factoryPreviewPath(p.projectId, p.revision) || p.projectUrl !== p.previewUrl ||
      (p.figmaReferenceUrl !== null && !makeProjectUrl(p.figmaReferenceUrl))) return null;
    return p as FactoryPrototype;
  } catch { return null; }
}
export function parseProductPrototype(raw: unknown): MakePrototype | FactoryPrototype | FigmaScreens | null {
  return parseFigmaScreens(raw) ?? parseFactoryPrototype(raw) ?? parseMakePrototype(raw);
}

/** One requirement's place in a design: the screens that show it and its acceptance criteria, or, when nothing about
 *  it is seen on a screen (a background import, a data feed), no screens and a short reason people can read. */
export interface DesignCoverage { key: string; screens: string[]; criteria: string[]; noScreenReason?: string | null }

// The requirement map comes from a model. It repeats each requirement's acceptance criteria, and the copies vary by
// run: a screen reference or frame node id appended ("... waiting requests (3:2 l…"), curly quotes, other casing or
// punctuation, a cut-off ending. The check is tolerant of that form and strict on substance: every criterion must be
// accounted for under its own requirement, an exact criterion id ("AC2") wins, and no fuzzy similarity is used, so two
// criteria that differ in a number or a word never merge.
export type CoverageProblem =
  | { kind: "malformed"; index: number }
  | { kind: "unknownRequirement"; key: string }
  | { kind: "duplicateRequirement"; key: string }
  | { kind: "missingRequirement"; key: string }
  | { kind: "noScreens"; key: string }
  | { kind: "missingCriterion"; key: string; criterion: string }
  | { kind: "wrongRequirement"; key: string; criterion: string; belongsTo: string };
export interface CoverageCheck {
  ok: boolean;
  /** One entry per requirement in intent order, with the requirement's exact criteria (only meaningful when ok). */
  coverage: DesignCoverage[];
  problems: CoverageProblem[];
  /** Lines of the map that name no criterion (notes, invented or ambiguous lines); dropped from the coverage. */
  ignored: { key: string; text: string }[];
}
export interface CoverageOptions {
  /** Screen names, node ids and files of the result: a trailing "(Requests list)" naming one is a screen reference. */
  screenRefs?: readonly string[];
  /** The result's screens: an entry naming no screen and no reason takes the screens that list its key. */
  manifest?: readonly { nodeId: string; requirementKeys: readonly string[] }[];
}

// A number keeps its inner separators ("8.1", "1'000", "3:2"), so numbers that differ only there never match.
const tokens = (s: string): string[] => s.normalize("NFKC").toLowerCase().replace(/(?<=\p{N})’(?=\p{N})/gu, "'")
  .match(/\p{N}+(?:[.,:/']\p{N}+)*|[\p{L}\p{M}]+|[\p{Sc}%‰<>=≤≥±+]/gu) ?? [];
/** Case, whitespace, quotes and punctuation removed; words, whole numbers, currency and comparison signs kept. */
export const normaliseCriterion = (s: string): string => tokens(s).join(" ");
const TRUNCATED = /(?:…|\.{3})[\s"'”’»)\]]*$/u;
const NUMBER = /^\p{N}/u;
const NODE_ID = /\d+:\d+/;
const REF_START = /^(?:see|screens?|frames?|nodes?|shown|covered|mapped|via)\b|^(?:→|->|=>)/i;
const MAX_REASON = 300;

function refLike(content: string, refs: readonly string[]): boolean {
  const c = content.trim();
  if (!c) return false;
  if (NODE_ID.test(c) || REF_START.test(c)) return true;
  const n = normaliseCriterion(c);
  return !!n && refs.some((r) => { const rn = normaliseCriterion(r); return !!rn && (n === rn || n.startsWith(`${rn} `)); });
}
/** The text without its last trailing screen reference, or null when it ends with none. */
function stripTrailingRef(s: string, refs: readonly string[]): string | null {
  const group = s.match(/^([\s\S]*\S)\s*[([{]([^()[\]{}]*)[)\]}]?[\s.,;:]*$/u);
  if (group && refLike(group[2], refs)) return group[1];
  const separated = s.match(/^([\s\S]*\S)\s*(?:[-–—|:→]|->|=>)\s*(?:(?:see|screens?|frames?|nodes?)\s*:?\s*)?\d+:\d+[\s\S]*$/iu);
  if (separated) return separated[1];
  const bare = s.match(/^([\s\S]*?\S)\s+\d+:\d+(?:\s*[,;&/]\s*\d+:\d+)*[\s.,;]*$/u);
  return bare ? bare[1] : null;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function stripLeading(s: string, key: string): string {
  return s.replace(/^\s*(?:[-*•·▪]\s+|\(?\d{1,2}[.)]\s+)/u, "").replace(new RegExp(`^\\s*\\[?${escapeRe(key)}\\]?\\s*[:\\-–—)]\\s*`, "iu"), "");
}
/** The ways a copied criterion may be written, least changed first. */
function forms(raw: string, key: string, refs: readonly string[]): string[] {
  const out = [raw];
  const lead = stripLeading(raw, key);
  if (lead !== raw) out.push(lead);
  for (const base of out.slice()) {
    let s = base;
    for (let i = 0; i < 3; i++) { const next = stripTrailingRef(s, refs); if (next === null || next === s) break; s = next; out.push(s); }
  }
  return [...new Set(out)];
}
/** Whether a cut-off copy (rt) confidently starts the criterion (ct). A number is never matched by its first digits. */
function prefixOf(rt: string[], ct: string[]): boolean {
  if (!rt.length || rt.length > ct.length) return false;
  const last = rt.length - 1;
  for (let i = 0; i < last; i++) if (rt[i] !== ct[i]) return false;
  const a = rt[last], b = ct[last];
  if (NUMBER.test(a) || NUMBER.test(b) ? a !== b : !b.startsWith(a)) return false;
  const chars = rt.join(" ").length;
  return (last >= 3 && chars >= 20) || chars >= 0.6 * ct.join(" ").length;
}

interface Criteria { texts: readonly string[]; norms: string[] }
const criteriaOf = (r: { criteria: readonly string[] }): Criteria => ({ texts: r.criteria, norms: r.criteria.map(normaliseCriterion) });
/** The index of the one criterion this text names (the first of identical copies), or null. */
function textMatch(raw: string, c: Criteria, key: string, refs: readonly string[]): number | null {
  for (const form of forms(raw, key, refs)) {
    const n = normaliseCriterion(form);
    if (!n) continue;
    const exact = c.norms.indexOf(n);
    if (exact >= 0) return exact;
    if (TRUNCATED.test(form)) {
      const rt = tokens(form);
      // A cut-off start shared by several criteria names none of them.
      const hits = [...new Set(c.norms.filter((cn) => cn && prefixOf(rt, cn.split(" "))))];
      if (hits.length === 1) return c.norms.indexOf(hits[0]);
    }
  }
  return null;
}
/** A criterion id ("AC2", "R1/AC2", "[AC2] text"), resolved against the requirement keys. */
function criterionId(raw: string, keys: readonly string[]): { key: string | null; n: number; rest: string } | null {
  const m = raw.match(/^\s*[[(]?\s*(?:([^\s/#:]+?)(?:\s*[/#.:]\s*|\s+))?AC\s*-?\s*(\d{1,3})(?![\p{L}\p{N}])\s*[\])]?\s*[:.)\-–—,;]?\s*([\s\S]*)$/iu);
  if (!m) return null;
  const key = m[1] === undefined ? null : resolveRequirementKey(keys, m[1]);
  if (m[1] !== undefined && !key) return null;
  return { key, n: Number(m[2]), rest: m[3] };
}

/** The requirement key a model wrote ("r1", " R1 ", "R1: Submit a request"), or null when it names none. */
export function resolveRequirementKey(keys: readonly string[], raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (keys.includes(t)) return t;
  const lower = t.toLowerCase().replace(/^\[/, "");
  const same = keys.filter((k) => k.toLowerCase() === lower);
  if (same.length === 1) return same[0];
  const prefixed = keys.filter((k) => lower.startsWith(k.toLowerCase()) && /^[\]\s:\-–—()]/u.test(lower.slice(k.length)))
    .sort((a, b) => b.length - a.length);
  return prefixed.length && (prefixed.length === 1 || prefixed[0].length > prefixed[1].length) ? prefixed[0] : null;
}

/** The requirements a screen shows, in words: each key its manifest names (as the model wrote it) resolved against the
 *  project's requirements (resolveRequirementKey) and shown by the requirement's title; the key itself only when no
 *  requirement or no title is found. Each requirement once, in the manifest's order. */
export function screenRequirementTitles(keys: readonly unknown[], requirements: readonly { key: string; title: string }[]): string[] {
  const known = requirements.filter((r) => r.key);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = resolveRequirementKey(known.map((r) => r.key), raw);
    const title = key ? (known.find((r) => r.key === key)?.title ?? "").trim() : "";
    const label = title || (typeof raw === "string" ? raw.trim() : "");
    const id = key ?? `raw:${label}`;
    if (!label || seen.has(id)) continue;
    seen.add(id);
    out.push(label);
  }
  return out;
}

/** The ids the planner is given for each requirement's criteria (AC1, AC2, ... in their order). */
export function designCoverageTemplate(intent: DesignIntent) {
  return intent.requirements.map((r) => ({ key: r.key, title: r.title, criteria: r.criteria.map((text, i) => ({ id: `AC${i + 1}`, text })) }));
}

/** The requirement map checked against the intent: every requirement once, every criterion under its own requirement,
 *  every requirement on a screen or explicitly without one for a stated reason. Semantic alignment is reviewed
 *  separately and remains human-reviewable. */
export function checkDesignCoverage(intent: DesignIntent, coverage: unknown, options: CoverageOptions = {}): CoverageCheck {
  const refs = options.screenRefs ?? [];
  const keys = intent.requirements.map((r) => r.key);
  const problems: CoverageProblem[] = [];
  const ignored: { key: string; text: string }[] = [];
  const entries = new Map<string, Record<string, unknown>>();
  (Array.isArray(coverage) ? coverage : []).forEach((c: any, index) => {
    if (!c || typeof c !== "object" || typeof c.key !== "string" || !Array.isArray(c.screens) || !Array.isArray(c.criteria) ||
      !c.screens.every((s: unknown) => typeof s === "string" && s.trim())) { problems.push({ kind: "malformed", index }); return; }
    const key = resolveRequirementKey(keys, c.key);
    if (!key) problems.push({ kind: "unknownRequirement", key: c.key.slice(0, 128) });
    else if (entries.has(key)) problems.push({ kind: "duplicateRequirement", key });
    else entries.set(key, c);
  });
  if (!Array.isArray(coverage)) problems.push({ kind: "malformed", index: -1 });
  const all = intent.requirements.map((r) => ({ r, c: criteriaOf(r) }));
  const result: DesignCoverage[] = [];
  for (const { r, c } of all) {
    const entry = entries.get(r.key);
    if (!entry) { problems.push({ kind: "missingRequirement", key: r.key }); continue; }
    const rawReason = typeof entry.noScreenReason === "string" ? entry.noScreenReason.replace(/\s+/g, " ").trim() : "";
    const reason = rawReason.length > MAX_REASON ? `${rawReason.slice(0, MAX_REASON - 1).trimEnd()}…` : rawReason;
    let screens = (entry.screens as string[]).map((s) => s.trim());
    // An entry that names no screen and gives no reason takes the screens listing its key; a stated reason stands.
    if (!screens.length && reason.length < 3 && options.manifest) {
      screens = options.manifest.filter((s) => s.requirementKeys.some((k) => resolveRequirementKey(keys, k) === r.key)).map((s) => s.nodeId);
    }
    if (!screens.length && reason.length < 3) problems.push({ kind: "noScreens", key: r.key });
    const covered = new Set<string>();
    for (const item of entry.criteria as unknown[]) {
      if (typeof item !== "string" || !item.trim()) continue;
      const own = ownMatch(item, r.key, c, keys, refs);
      if (typeof own === "number") { covered.add(c.norms[own]); continue; }
      const other = own ?? all.find((o) => o.r.key !== r.key && textMatch(item, o.c, o.r.key, refs) !== null)?.r.key;
      if (other) problems.push({ kind: "wrongRequirement", key: r.key, criterion: item.slice(0, 500), belongsTo: other });
      else ignored.push({ key: r.key, text: item.slice(0, 500) });
    }
    if (screens.length) {
      c.norms.forEach((n, i) => { if (!covered.has(n) && c.norms.indexOf(n) === i) problems.push({ kind: "missingCriterion", key: r.key, criterion: c.texts[i] }); });
    }
    result.push({ key: r.key, screens, criteria: [...r.criteria], noScreenReason: screens.length ? null : reason || null });
  }
  return { ok: problems.length === 0, coverage: result, problems, ignored };
}
/** The index of the requirement's criterion this line names; another requirement's key when its id names one there. */
function ownMatch(item: string, key: string, c: Criteria, keys: readonly string[], refs: readonly string[]): number | string | null {
  const exact = c.norms.indexOf(normaliseCriterion(item));
  if (exact >= 0 && c.norms[exact]) return exact;
  const id = criterionId(item, keys);
  if (id && (id.key === null || id.key === key) && id.n >= 1 && id.n <= c.texts.length) {
    const byText = id.rest.trim() ? textMatch(id.rest, c, key, refs) : null;
    // An id with the text of a different criterion is a contradiction, not a match.
    return byText === null || c.norms[byText] === c.norms[id.n - 1] ? c.norms.indexOf(c.norms[id.n - 1]) : null;
  }
  if (id && id.key && id.key !== key) return id.key;
  return textMatch(item, c, key, refs);
}

/** Structural traceability as a yes/no (see checkDesignCoverage). */
export function validDesignCoverage(intent: DesignIntent, coverage: readonly DesignCoverage[], options?: CoverageOptions): boolean {
  return checkDesignCoverage(intent, coverage, options).ok;
}

/** The start of a failed design job's message when the screens were made but their requirement map is incomplete. */
export const COVERAGE_FAILURE_PREFIX = "Screens were made, but the requirement map is incomplete: ";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** One problem in plain words, naming the requirement by its title. */
export function describeCoverageProblem(intent: DesignIntent, p: CoverageProblem): string {
  const title = (key: string) => `"${clip(intent.requirements.find((r) => r.key === key)?.title || key, 60)}"`;
  switch (p.kind) {
    case "malformed": return "the map has an entry that cannot be read.";
    case "unknownRequirement": return `it names a requirement that does not exist (${clip(p.key, 40)}).`;
    case "duplicateRequirement": return `${title(p.key)} appears more than once.`;
    case "missingRequirement": return `${title(p.key)} is missing.`;
    case "noScreens": return `${title(p.key)} has no screen and no reason why none is needed.`;
    case "missingCriterion": return `${title(p.key)} leaves out "${clip(p.criterion, 70)}".`;
    case "wrongRequirement": return `"${clip(p.criterion, 50)}" is listed under ${title(p.key)} but belongs to ${title(p.belongsTo)}.`;
  }
}
/** The job message for an incomplete map: the first problem in plain words, within the 200 characters a job keeps. */
export function coverageFailureMessage(intent: DesignIntent, problems: readonly CoverageProblem[]): string {
  const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : "";
  return `${COVERAGE_FAILURE_PREFIX}${clip(problems.length ? describeCoverageProblem(intent, problems[0]) : "unknown.", 200 - COVERAGE_FAILURE_PREFIX.length - more.length)}${more}`;
}
