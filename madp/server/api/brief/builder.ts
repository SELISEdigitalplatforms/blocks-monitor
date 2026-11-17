/**
 * Brief Builder — merges the project's own answers, every file's findings and your decisions into one project brief.
 *
 * Stage 2 of the two-stage pipeline:
 * - The project's answers come from where they are recorded (Blocks: read as the signed-in person, see access.ts: the
 *   project's fields, the Project brief note, the answers to the business analyst's brief questions, the drafted
 *   objective; local: the knowledge base's form-answers.json). The name is never replaced by the project id.
 * - Groups findings by feature, deduplicates equal requirements (keeping every source) under stable keys
 * - Identifies contradictions (never silently resolves them)
 * - Separates confirmed facts, proposals and questions that are really still open
 * - Lists every file of the project with its reading status (also files not read yet)
 * - Applies your decisions (requirements confirmed or set aside, conflicts handed to the product manager)
 * The brief is rebuilt whenever one of its inputs changes (inputFingerprint), so readers never see stale answers.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { NormalizedFindings, CandidateRequirement, Observation } from "../extraction/normalize.ts";
import { kbDir, writeBrief, readBrief, readFormAnswers, writeFormAnswers, readDecisions, type BriefDecisions, type KbKey } from "../knowledgeBase.ts";
import { extractionStatus } from "../../../src/domain/extractionStatus.ts";
import { formAnswersFromFacts, type ProjectFacts } from "./access.ts";
import { briefObjective } from "../../../src/domain/projectBrief.ts";
import type { PublishedReading } from "../extraction/process.ts";

/** Bumped when the brief's shape changes, so older saved briefs are rebuilt once (3: the goal and the users wherever
 *  they are recorded, the drafted objective, brief.md without a note box over its version line; 4: no features or
 *  disagreements guessed from keywords, 12.11.2026). */
export const BRIEF_SCHEMA = 4;

/** "not_read": a file of the project that has not been read yet (no extraction attempt saved). */
export type AttachmentState = "pending" | "processing" | "ready" | "failed" | "unsupported" | "not_read";

export interface BriefRequirement {
  /** Stable key (the same text from the same source keeps its key across rebuilds). Never shown to people. */
  id: string;
  description: string;
  sourceRefs: string[];
  /** Plain source names: file names, or "Your project setup". */
  sources: string[];
  /** explicit = stated in a source; inferred = proposed from a source; confirmed = you confirmed a proposal. */
  basis: "explicit" | "inferred" | "confirmed";
  needsConfirmation?: boolean;
}

export interface Feature {
  name: string;
  confirmedRequirements: BriefRequirement[];
  proposedRequirements: BriefRequirement[];
  openQuestions: { question: string; source: string }[];
  conflicts: { description: string; sources: string[] }[];
}

export interface BriefQuestion {
  key: string;
  question: string;
  priority: string;
  context: string;
  /** basics = a start question left unanswered (goal, users); material = asked by one of your files. */
  kind: "basics" | "material";
  topic?: "goal" | "users";
}

export interface BriefAttachment {
  fileId: string;
  name: string;
  status: AttachmentState;
  observationCount: number;
  requirementCount?: number;
  summary?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ProjectBrief {
  schema: number;
  version: number;
  generatedAt: string;
  inputFingerprint: string;
  /** Where the project's answers came from. */
  source: "blocks" | "local";
  project: { id: string; name: string; kind: string; problem: string; desiredOutcome: string };
  targetUsers: { persona: string; description: string; source: string }[];
  userJourneys: { persona: string; journey: string }[];
  features: Feature[];
  rejectedRequirements: BriefRequirement[];
  businessRules: { rule: string; sourceRefs: string[]; basis: string }[];
  constraints: { kind: string; text: string; source: string }[];
  integrations: { name: string; description: string; sourceRefs: string[] }[];
  nonFunctionalRequirements: { description: string; sourceRefs: string[] }[];
  outOfScope: string[];
  conflicts: { key: string; description: string; sources: string[]; resolution: string | null }[];
  openQuestions: BriefQuestion[];
  attachmentStatus: BriefAttachment[];
  confirmedAt?: string;
  confirmedByUserId?: string;
}

interface SourceInput {
  fileId: string;
  name: string;
  status: AttachmentState;
  hash: string;
  at: string;
  findings?: NormalizedFindings;
  errorCode?: string;
  errorMessage?: string;
}

export interface BriefInputs {
  source: "blocks" | "local";
  answers: Record<string, unknown>;
  /** The business analyst's drafted objective statement: the brief's objective while the answers record no goal. */
  objective?: string;
  sources: SourceInput[];
  decisions: BriefDecisions;
  fingerprint: string;
}

const sha = (s: string, n = 16) => createHash("sha256").update(s).digest("hex").slice(0, n);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every saved extraction of the project, keyed by file id. */
function savedSources(key: KbKey): Map<string, SourceInput> {
  const out = new Map<string, SourceInput>();
  const sourcesDir = join(kbDir(key), "sources");
  if (!existsSync(sourcesDir)) return out;
  for (const entry of readdirSync(sourcesDir)) {
    const extractionPath = join(sourcesDir, entry, "extraction.json");
    const metaPath = join(sourcesDir, entry, "meta.json");
    if (!existsSync(extractionPath) && !existsSync(metaPath)) continue;
    try {
      const findings = existsSync(extractionPath) ? JSON.parse(readFileSync(extractionPath, "utf-8")) as NormalizedFindings : undefined;
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf-8")) : {};
      const status = extractionStatus(meta, findings);
      const fileId = str(meta.sourceId) || findings?.sourceId || entry;
      out.set(fileId, {
        fileId, name: str(meta.fileName) || findings?.fileName || "", status,
        hash: str(meta.contentHash) || entry, at: str(meta.extractedAt) || str(meta.startedAt),
        ...(status === "ready" && findings ? { findings } : {}),
        ...(status === "failed" && str(meta.errorCode) ? { errorCode: str(meta.errorCode), errorMessage: str(meta.errorMessage) } : {}),
      });
    } catch { /* skip malformed */ }
  }
  return out;
}

/** The brief's inputs and their fingerprint. With `facts` (Blocks), the project's answers and file list are the live
 *  ones read as the signed-in person; they are also saved as form-answers.json for the product manager's tools. */
export function briefInputs(key: KbKey, facts: ProjectFacts | null): BriefInputs {
  const saved = savedSources(key);
  let answers: Record<string, unknown>;
  let sources: SourceInput[];
  if (facts) {
    answers = formAnswersFromFacts(facts);
    writeFormAnswers(key, answers);
    // Only the project's own files, in their order; a file never read yet is listed as such.
    sources = facts.files
      .filter((f) => f.ready || saved.has(f.id))
      .map((f) => {
        const s = saved.get(f.id);
        return s ? { ...s, name: f.name || s.name } : { fileId: f.id, name: f.name, status: "not_read" as const, hash: "", at: "" };
      });
  } else {
    answers = readFormAnswers(key);
    sources = [...saved.values()].map((s) => ({ ...s, name: s.name || "Uploaded file" }));
  }
  const decisions = readDecisions(key);
  const objective = facts?.objective ?? "";
  const fingerprint = sha(JSON.stringify({
    schema: BRIEF_SCHEMA, answers, objective,
    sources: sources.map((s) => [s.fileId, s.name, s.status, s.hash, s.at]),
    decisions,
  }));
  return { source: facts ? "blocks" : "local", answers, objective, sources, decisions, fingerprint };
}

/** The saved brief when it is still current, else a fresh one (saved). */
export function ensureBrief(key: KbKey, facts: ProjectFacts | null): ProjectBrief {
  const inputs = briefInputs(key, facts);
  const prev = readBrief(key) as ProjectBrief | null;
  if (prev && prev.schema === BRIEF_SCHEMA && prev.inputFingerprint === inputs.fingerprint) return prev;
  return writeNew(key, inputs, prev);
}

/** Build (or rebuild) the unified project brief now. */
export function buildBrief(key: KbKey, facts: ProjectFacts | null = null): ProjectBrief {
  return writeNew(key, briefInputs(key, facts), readBrief(key) as ProjectBrief | null);
}

// ── Blocks mode: the brief from Blocks alone ──────────────────────────────────
// The MADP engine reads the files on the engine host and publishes each reading to Blocks Storage (file.extract);
// people's decisions are ProjectAnswer rows. A web server, wherever it runs, builds the brief from those (read as the
// signed-in person) and never writes or reads a folder of its own.

/** Loads what the engine published for one reading (Storage object id); null when it cannot be loaded. */
export type ReadingLoader = (objectId: string) => Promise<PublishedReading | null>;

const NO_DECISIONS: BriefDecisions = { requirements: {}, conflicts: {} };

/** The brief's inputs from the project's Blocks rows (facts read as the caller) and the engine's published readings. */
export async function blocksBriefInputs(facts: ProjectFacts, load: ReadingLoader): Promise<BriefInputs> {
  const readings = new Map((facts.blocks?.readings ?? []).map((r) => [r.fileId, r]));
  const answers = formAnswersFromFacts(facts);
  const sources: SourceInput[] = await Promise.all(facts.files.filter((f) => f.ready || readings.has(f.id)).map(async (f): Promise<SourceInput> => {
    const r = readings.get(f.id);
    if (!r || r.status === "cancelled") return { fileId: f.id, name: f.name, status: "not_read", hash: "", at: "" };
    const base = { fileId: f.id, name: f.name, hash: `${r.jobId}:${r.status}`, at: r.at };
    if (r.status === "queued") return { ...base, status: "pending" };
    if (r.status === "claimed" || r.status === "running") return { ...base, status: "processing" };
    if (r.status === "failed") return { ...base, status: "failed", errorCode: r.errorCode || "engine.failed", errorMessage: r.message || "This file could not be read." };
    const published = r.objectId ? await load(r.objectId).catch(() => null) : null;
    if (!published) return { ...base, status: "failed", errorCode: "reading.unavailable", errorMessage: "What the team found in this file could not be loaded. Try again." };
    if (published.status === "ready") return { ...base, status: "ready", findings: published.findings };
    return { ...base, status: published.status, ...(published.errorCode ? { errorCode: published.errorCode, errorMessage: published.errorMessage ?? "" } : {}) };
  }));
  const decisions = facts.blocks?.decisions ?? NO_DECISIONS;
  const objective = facts.objective;
  const fingerprint = sha(JSON.stringify({
    schema: BRIEF_SCHEMA, answers, objective,
    sources: sources.map((s) => [s.fileId, s.name, s.status, s.hash, s.at]),
    decisions,
  }));
  return { source: "blocks", answers, objective, sources, decisions, fingerprint };
}

/** The last brief this server built per project (its version counts up while the inputs change). */
const blocksBriefs = new Map<string, ProjectBrief>();
const BLOCKS_BRIEFS_MAX = 500;

/** The current brief of a Blocks project, built in memory from Blocks (nothing is written on the web server). */
export async function blocksBrief(facts: ProjectFacts, load: ReadingLoader): Promise<ProjectBrief> {
  const inputs = await blocksBriefInputs(facts, load);
  const prev = blocksBriefs.get(facts.id);
  if (prev && prev.schema === BRIEF_SCHEMA && prev.inputFingerprint === inputs.fingerprint) return prev;
  const brief = mergeToBrief(facts.id, (prev?.version ?? 0) + 1, inputs);
  blocksBriefs.delete(facts.id);
  blocksBriefs.set(facts.id, brief);
  if (blocksBriefs.size > BLOCKS_BRIEFS_MAX) blocksBriefs.delete(blocksBriefs.keys().next().value!);
  return brief;
}

function writeNew(key: KbKey, inputs: BriefInputs, prev: ProjectBrief | null): ProjectBrief {
  const brief = mergeToBrief(key.projectId, (prev?.version || 0) + 1, inputs);
  writeBrief(key, brief);
  return brief;
}

// ── the merge (pure) ────────────────────────────────────────────────────────

const ANSWERED_GOAL = /^(what|which)\b.{0,40}\b(problem|goal|purpose|objective|aim)s?\b/i;
const ANSWERED_USERS = /^who\b.{0,40}\b(users?|audience|personas?|use (it|this|the (app|application|system|product|platform)))\b/i;

export function mergeToBrief(projectId: string, version: number, inputs: BriefInputs): ProjectBrief {
  const a = inputs.answers;
  // the goal and the users as recorded (access.ts factsFromRows: briefFacts), the objective last the drafted statement,
  // as Business Analysis shows them: a question is open only while nothing records its answer
  const goal = briefObjective(str(a.goal), inputs.objective);
  const users = str(a.targetUsers);
  const project = { id: projectId, name: str(a.name), kind: str(a.kind) || "new", problem: goal, desiredOutcome: str(a.description) };

  const targetUsers: ProjectBrief["targetUsers"] = users ? [{ persona: "Primary users", description: users, source: "guided:targetUsers" }] : [];

  const constraints: ProjectBrief["constraints"] = [];
  if (Array.isArray(a.constraints)) {
    for (const c of a.constraints) {
      if (c && typeof c === "object" && str((c as { text?: unknown }).text)) {
        constraints.push({ kind: str((c as { kind?: unknown }).kind) || "other", text: str((c as { text?: unknown }).text), source: "guided:constraints" });
      }
    }
  }
  const outOfScope = Array.isArray(a.exclusions) ? a.exclusions.map(str).filter(Boolean) : [];

  const nameOf = new Map(inputs.sources.map((s) => [s.fileId, s.name]));
  const refName = (ref: string) => {
    const [head] = ref.split(":");
    if (head === "guided") return "Your project setup";
    return nameOf.get(head) || "Your material";
  };

  // Observations, candidates and questions from every file that was read.
  const findings = inputs.sources.filter((s) => s.status === "ready" && s.findings).map((s) => s.findings!);
  const allObservations: (Observation & { sourceId: string })[] = [];
  const candidates: { text: string; basis: CandidateRequirement["basis"]; refs: string[]; origin: string }[] = [];
  const fileQuestions: { question: string; sourceId: string }[] = [];
  const requirementCount = new Map<string, number>();
  for (const f of findings) {
    for (const obs of f.observations || []) allObservations.push({ ...obs, sourceId: f.sourceId });
    for (const req of f.candidateRequirements || []) {
      if (!str(req.text)) continue;
      candidates.push({ text: str(req.text), basis: req.basis, refs: (req.evidenceRefs || []).map((r) => `${f.sourceId}:${r}`), origin: f.sourceId });
      requirementCount.set(f.sourceId, (requirementCount.get(f.sourceId) || 0) + 1);
    }
    for (const q of f.openQuestions || []) if (str(q)) fileQuestions.push({ question: str(q), sourceId: f.sourceId });
  }
  // The guided start's must-haves are your own words: confirmed requirements.
  if (Array.isArray(a.mustHaves)) {
    for (const m of a.mustHaves) {
      const text = str((m as { text?: unknown } | null)?.text);
      if (text) candidates.push({ text, basis: "explicit", refs: ["guided:mustHaves"], origin: "guided" });
    }
  }

  // Deduplicate equal requirements (keep every source; stated beats proposed).
  const merged = new Map<string, { text: string; basis: "explicit" | "inferred"; refs: string[]; origins: string[] }>();
  for (const c of candidates) {
    const k = norm(c.text);
    if (!k) continue;
    const m = merged.get(k);
    if (m) {
      m.refs.push(...c.refs);
      m.origins.push(c.origin);
      if (c.basis === "explicit") m.basis = "explicit";
    } else merged.set(k, { text: c.text, basis: c.basis === "explicit" ? "explicit" : "inferred", refs: [...c.refs], origins: [c.origin] });
  }

  // The engine's readings name requirements, not features: they stay one list (REQUIREMENTS_GROUP) instead of being
  // sorted into features guessed from keywords ("Payments", "Sign-in and accounts"), which read as the analyst's
  // findings although nobody found them.
  const features = new Map<string, Feature>();
  const rejectedRequirements: BriefRequirement[] = [];
  const featureOf = (name: string) => {
    let f = features.get(name);
    if (!f) features.set(name, (f = { name, confirmedRequirements: [], proposedRequirements: [], openQuestions: [], conflicts: [] }));
    return f;
  };
  for (const [k, m] of merged) {
    const id = `R-${sha(k, 10)}`;
    const sources = [...new Set(m.refs.map(refName))];
    const decision = inputs.decisions.requirements[id];
    const base = { id, description: m.text, sourceRefs: [...new Set(m.refs)], sources };
    if (decision === "rejected") { rejectedRequirements.push({ ...base, basis: m.basis }); continue; }
    const feature = featureOf(REQUIREMENTS_GROUP);
    if (m.basis === "explicit") feature.confirmedRequirements.push({ ...base, basis: "explicit" });
    else if (decision === "confirmed") feature.confirmedRequirements.push({ ...base, basis: "confirmed" });
    else feature.proposedRequirements.push({ ...base, basis: "inferred", needsConfirmation: true });
  }

  // Questions that are really open: the goal or the users when nothing records them yet (Project setup no longer asks
  // for them; the business analyst does), and your files' questions that the answers do not already settle (each
  // asked once).
  const openQuestions: BriefQuestion[] = [];
  if (!goal) openQuestions.push({ key: "basics:goal", question: "What problem should this project solve?", priority: "high", context: "Not answered yet", kind: "basics", topic: "goal" });
  if (!users) openQuestions.push({ key: "basics:users", question: "Who will use it?", priority: "high", context: "Not answered yet", kind: "basics", topic: "users" });
  const asked = new Set<string>();
  for (const q of fileQuestions) {
    const k = norm(q.question);
    if (!k || asked.has(k)) continue;
    if (goal && ANSWERED_GOAL.test(q.question)) continue;
    if (users && ANSWERED_USERS.test(q.question)) continue;
    asked.add(k);
    const question: BriefQuestion = { key: `Q-${sha(k, 10)}`, question: q.question, priority: "medium", context: `From ${nameOf.get(q.sourceId) || "your material"}`, kind: "material" };
    openQuestions.push(question);
  }

  // Where the files disagree: only what the engine's readings report. They report none today, so none is listed (a
  // keyword match on "login" / "no login" across the files was shown as "Your files disagree about signing in").
  const conflicts: ProjectBrief["conflicts"] = [];

  const businessRules = allObservations
    .filter((o) => o.kind === "business_rule")
    .map((o) => ({ rule: o.text, sourceRefs: [`${o.sourceId}:${o.id}`], basis: "explicit" }));
  const integrations = allObservations
    .filter((o) => o.kind === "integration")
    .map((o) => ({ name: o.text.split(":")[0] || o.text, description: o.text, sourceRefs: [`${o.sourceId}:${o.id}`] }));

  const attachmentStatus: BriefAttachment[] = inputs.sources.map((s) => ({
    fileId: s.fileId,
    name: s.name,
    status: s.status,
    observationCount: s.status === "ready" ? s.findings?.observations?.length || 0 : 0,
    ...(s.status === "ready" ? { requirementCount: requirementCount.get(s.fileId) || 0 } : {}),
    ...(s.status === "ready" && str(s.findings?.summary) ? { summary: str(s.findings?.summary) } : {}),
    ...(s.errorCode ? { errorCode: s.errorCode, errorMessage: s.errorMessage } : {}),
  }));

  return {
    schema: BRIEF_SCHEMA,
    version,
    generatedAt: new Date().toISOString(),
    inputFingerprint: inputs.fingerprint,
    source: inputs.source,
    project,
    targetUsers,
    userJourneys: [],
    features: [...features.values()],
    rejectedRequirements,
    businessRules,
    constraints,
    integrations,
    nonFunctionalRequirements: [],
    outOfScope,
    conflicts,
    openQuestions,
    attachmentStatus,
    ...(inputs.decisions.confirmedAt ? { confirmedAt: inputs.decisions.confirmedAt } : {}),
    ...(inputs.decisions.confirmedByUserId ? { confirmedByUserId: inputs.decisions.confirmedByUserId } : {}),
  };
}

/** The one group the brief's requirements are listed in: the readings group nothing into features. */
export const REQUIREMENTS_GROUP = "From your material";
