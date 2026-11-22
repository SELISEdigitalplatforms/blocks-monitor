// What the project's context holds, end to end (DEMO-SCOPE-31.10.md): the basics of the guided start, the shared notes
// and files with what was read from them (the brief), the questions and answers, the requirements and the objective,
// every scope version and which one is locked, the milestones and the tickets, each build and its commit, the previews,
// the releases and the decisions (chat included), the look and feel with the current screens, and the comments people
// left on items with what the team answered (feedback).
//
// Built from the rows the engine reads (the Blocks worker loads the project's rows from the Data Gateway right before
// every job, engineWorker/store.ts loadProject) plus the files of the project's folder (artifacts/brief/*, project.json).
// Every record carries `ref` = "Schema:ItemId", the same form as a job's OutputRefs, so outputs and sources link up.
// Only what the work needs: no credentials (the test environment and run instructions are left out), long text clipped,
// nothing volatile (progress, read times), so a refresh that changed nothing keeps the version.
import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../functions/_lib/gateway";
import type { ProjectView } from "../local/engine/context.ts";
import { detailsFromRow } from "../../src/domain/setupDetails.ts";
import { parseProductPrototype } from "../../src/domain/factoryDesign";
import { briefFactsOf } from "../../src/domain/projectBrief";
import { currencyCodeIn } from "./currency.ts";
import { resolveProjectFacts, type FactAnswer, type FactConflict, type ProjectFacts } from "./facts.ts";
import { confirmedIdOf, effectiveAnswers } from "./answers.ts";
import { feedbackSectionOf, type FeedbackSection } from "./feedbackContext.ts";

export type { FeedbackEntry, FeedbackSection, FeedbackThreadItem } from "./feedbackContext.ts";

export type Item = { ref: string } & Record<string, unknown>;

export interface Basics {
  name: string;
  client: string;
  industry: string;
  region: string;
  existing: boolean;
  repoName: string;
  description: string;
  goal: string;
  targetUsers: string;
  mustHaves: { text: string; priority: string }[];
  workflows: string[];
  exclusions: string[];
  constraints: { kind: string; text: string }[];
  intendedChanges: string;
  changeTags: string[];
  approvalOwnerUserId: string;
  approvalOwnerName: string;
  stage: string;
  status: string;
  setupStatus: string;
  appUrl: string;
  websiteUrl: string;
  handedOverAt: string;
  requirementsConfirmedAt: string;
  scopeLockedAt: string;
  /** The currency the material names ("EUR"), "" when it names none (currency.ts: never a home-region default). */
  currency: string;
  /** The facts every generated piece agrees on (facts.ts): currency, tax rate, payout schedule, country, the main call
   *  to action; the client's answers win over the documents; a fact the material does not state is absent. */
  facts?: ProjectFacts;
  /** Actual product tenant, distinct from this context's Factory record key. */
  blocksProjectId?: string;
  blocksProjectDomain?: string;
  blocksProvisioningStatus?: string;
  /** Where an answer and a document (or two answers) state a fact differently (facts.ts resolveProjectFacts): the
   *  answer is followed, the client confirms it. Absent when there is none. */
  factConflicts?: FactConflict[];
}

export interface NoteItem extends Item {
  title: string;
  body: string;
  by: string;
  isProjectBrief: boolean;
}

export interface FileItem extends Item {
  name: string;
  mime: string;
  status: string;
  ready: boolean;
  by: string;
  storageObjectId: string;
  sizeBytes: number;
  /** The brief's extraction of the file (artifacts/brief/sources/<id>/), when there is one. */
  extraction: { sourceId: string; status: string; summary: string; observationCount: number } | null;
}

/** A file a person attached while talking to the team (an Attachment row: a comment, an answer, a change request, a
 *  chat message, feedback on a preview). `owner` is the record it belongs to, "Schema:ItemId". */
export interface AttachmentItem extends Item {
  name: string;
  mime: string;
  sizeBytes: number;
  kind: string;
  owner: string;
  ownerType: string;
  by: string;
  at: string;
}

/** The schema of an Attachment's owner (Attachment.OwnerType), so `owner` reads "Schema:ItemId"; an owner type this
 *  list does not know stays as it is. */
const ATTACHMENT_OWNER_SCHEMAS: Readonly<Record<string, string>> = {
  "feedback-comment": "FeedbackComment",
  clarification: "Clarification",
  "change-request": "ChangeRequest",
  "agent-chat": "AgentChatMessage",
  ticket: "Ticket",
  "design-brief": "DesignBrief",
  "assistant-message": "AssistantMessage",
};
export const attachmentOwnerSchema = (ownerType: string): string => ATTACHMENT_OWNER_SCHEMAS[ownerType] ?? ownerType;

/** True for an Attachment that belongs to a record (ready, its owner saved: not a "draft:" of a text being written). */
export function attachedFile(a: Row): boolean {
  const owner = typeof a.OwnerId === "string" ? a.OwnerId : "";
  return a.Status === "ready" && owner !== "" && !owner.startsWith("draft:") && typeof a.OwnerType === "string" && a.OwnerType !== "";
}

export interface BriefSummary {
  version: number;
  generatedAt: string;
  inputFingerprint: string;
  problem: string;
  desiredOutcome: string;
  targetUsers: string[];
  features: { name: string; confirmed: string[]; proposed: string[]; openQuestions: string[] }[];
  conflicts: { key: string; description: string; resolution: string }[];
  openQuestions: string[];
  outOfScope: string[];
  /** decisions.json: the Project understanding step. */
  confirmedAt: string;
  confirmedByUserId: string;
  requirementDecisions: { confirmed: number; rejected: number };
}

export interface ScopeVersionItem extends Item {
  number: number;
  title: string;
  status: string;
  lockedAt: string;
  lockedByUserId: string;
  planHours: number;
  successTargets: string;
  features: Item[];
}

export interface Sections {
  basics: Basics;
  /** `attachments`: absent in a context written before files could be attached to answers, chats and feedback. */
  sources: { notes: NoteItem[]; files: FileItem[]; suggestions: Item[]; brief: BriefSummary | null; attachments?: AttachmentItem[] };
  clarifications: Item[];
  requirements: { objective: Item | null; items: Item[]; extras: Item[] };
  scope: { current: number; locked: number | null; versions: ScopeVersionItem[] };
  milestones: Item[];
  tickets: Item[];
  builds: { latestBuild: unknown; previewUrl: string; builds: Item[]; branches: Item[]; environments: unknown };
  previews: Item[];
  releases: Item[];
  decisions: { decisions: Item[]; tech: Item[]; changeRequests: Item[]; chat: Item[] };
  /** The look and feel and the current screens (DesignBrief, DesignScreen); absent while there are none (and in a
   *  context written before). */
  design?: DesignSection;
  /** The comments people left on items and what the team answered (feedbackContext.ts); absent while nobody has
   *  commented (and in a context written before). */
  feedback?: FeedbackSection;
}

export interface DesignSection {
  brief: (Item & { make?: { revision: string; source: string; projectUrl: string; provider?: string; artifactFileId?: string; jobId?: string; reviewComplete?: boolean; screens?: { name: string; nodeId: string; requirementKeys: string[] }[] } | null }) | null;
  screens: Item[];
}

export const SECTION_NAMES = ["basics", "sources", "clarifications", "requirements", "scope", "milestones", "tickets", "builds", "previews", "releases", "decisions", "design", "feedback"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const clip = (s: string, max: number): string => {
  const t = s.replace(/\r\n/g, "\n").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const ref = (schema: string, r: Row): string => `${schema}:${str(r.ItemId)}`;
/** A list field stored as an array or as compact JSON text. */
const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return strs(v);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      return strs(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return typeof v === "string" && v.trim() ? [v.trim()] : [];
};
const byAt = (a: Row, b: Row): number => str(a.At || a.CreatedDate).localeCompare(str(b.At || b.CreatedDate));

/** Reads a JSON file of the knowledge base (null when it is missing or broken). */
function readKb(kbDir: string | null, ...parts: string[]): unknown {
  if (!kbDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(kbDir, ...parts), "utf8")) as unknown;
  } catch {
    return null;
  }
}

const slug = (id: string): string => id.replace(/[^a-zA-Z0-9-]/g, "-");

/** The knowledge-base source folder of a file (extraction worker: sourceId = the file's id), or "". */
export function sourceIdOf(kbDir: string | null, f: { ItemId?: unknown; StorageObjectId?: unknown }): string {
  if (!kbDir) return "";
  for (const id of [str(f.ItemId), str(f.StorageObjectId)]) {
    if (id && fs.existsSync(path.join(kbDir, "sources", slug(id), "meta.json"))) return slug(id);
  }
  return "";
}

function briefSummary(kbDir: string | null): BriefSummary | null {
  const b = readKb(kbDir, "brief.json");
  if (!isObj(b)) return null;
  const d = readKb(kbDir, "decisions.json");
  const reqs = isObj(d) && isObj(d.requirements) ? Object.values(d.requirements) : [];
  const project = isObj(b.project) ? b.project : {};
  const desc = (x: unknown): string => clip(isObj(x) ? str(x.description) : str(x), 300);
  return {
    version: num(b.version),
    generatedAt: str(b.generatedAt),
    inputFingerprint: str(b.inputFingerprint),
    problem: clip(str(project.problem), 800),
    desiredOutcome: clip(str(project.desiredOutcome), 800),
    targetUsers: arr(b.targetUsers).filter(isObj).map((u) => clip(`${str(u.persona)}${str(u.description) ? `: ${str(u.description)}` : ""}`, 300)).slice(0, 20),
    features: arr(b.features).filter(isObj).slice(0, 40).map((f) => ({
      name: clip(str(f.name), 120),
      confirmed: arr(f.confirmedRequirements).map(desc).filter(Boolean).slice(0, 30),
      proposed: arr(f.proposedRequirements).map(desc).filter(Boolean).slice(0, 30),
      openQuestions: arr(f.openQuestions).map((q) => clip(isObj(q) ? str(q.question) : str(q), 300)).filter(Boolean).slice(0, 10),
    })),
    conflicts: arr(b.conflicts).filter(isObj).slice(0, 20).map((c) => ({ key: str(c.key), description: clip(str(c.description), 400), resolution: clip(str(c.resolution), 300) })),
    openQuestions: arr(b.openQuestions).map((q) => clip(isObj(q) ? str(q.question) : str(q), 300)).filter(Boolean).slice(0, 20),
    outOfScope: strs(b.outOfScope).map((s) => clip(s, 200)).slice(0, 20),
    confirmedAt: isObj(d) ? str(d.confirmedAt) : str(b.confirmedAt),
    confirmedByUserId: isObj(d) ? str(d.confirmedByUserId) : str(b.confirmedByUserId),
    requirementDecisions: { confirmed: reqs.filter((v) => v === "confirmed").length, rejected: reqs.filter((v) => v === "rejected").length },
  };
}

function extractionOf(kbDir: string | null, f: Row): FileItem["extraction"] {
  const sourceId = sourceIdOf(kbDir, f);
  if (!sourceId) return null;
  const meta = readKb(kbDir, "sources", sourceId, "meta.json");
  if (!isObj(meta)) return null;
  return { sourceId, status: str(meta.status), summary: clip(str(meta.summary), 600), observationCount: num(meta.observationCount) };
}

/** What the brief's extraction read from a file (sources/<id>/full-text.md), at most 200 kB; "" without one. */
function fullTextOf(kbDir: string | null, f: FileItem): string {
  const id = f.extraction?.sourceId;
  if (!kbDir || !id) return "";
  try {
    const file = path.join(kbDir, "sources", id, "full-text.md");
    return fs.statSync(file).size <= 200_000 ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

/** project.json of the project's folder (builds, branches, latest build, environments), or null. */
export function readProjectJson(projectDir: string | null): Record<string, unknown> | null {
  if (!projectDir) return null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function buildsOf(pj: Record<string, unknown> | null): Sections["builds"] {
  const builds = isObj(pj?.builds) ? (pj!.builds as Record<string, unknown>) : {};
  const branches = isObj(pj?.branches) ? (pj!.branches as Record<string, unknown>) : {};
  const latest = isObj(pj?.latestBuild) ? pj!.latestBuild : null;
  return {
    latestBuild: latest,
    previewUrl: str(pj?.previewUrl),
    builds: Object.entries(builds)
      .filter(([, b]) => isObj(b))
      .map(([id, b]) => {
        const x = b as Record<string, unknown>;
        return { ref: `Build:${id}`, buildId: id, version: str(x.version), branch: str(x.branch), commit: str(x.commit), jobId: str(x.jobId), at: str(x.at), files: num(x.files) };
      })
      .sort((a, b) => a.at.localeCompare(b.at)),
    branches: Object.entries(branches)
      .filter(([, b]) => isObj(b))
      .map(([name, b]) => {
        const x = b as Record<string, unknown>;
        return { ref: `Branch:${name}`, name, status: str(x.status), commit: str(x.commit), buildId: str(x.buildId), at: str(x.at) };
      }),
    environments: isObj(pj?.environments) ? pj!.environments : {},
  };
}

export interface SnapshotInput {
  p: ProjectView;
  /** The project's knowledge-base folder (artifacts/brief), or null. */
  kbDir: string | null;
  /** The project's engine folder (for project.json), or null. */
  projectDir: string | null;
}

/** The sections of the project's context, from the rows and the folder's files. Pure apart from reading those files. */
export function buildSections(i: SnapshotInput): Sections {
  const { p, kbDir } = i;
  const row = p.project;
  // the same reading as kinds/analysis/setup.ts setupOf (without the test environment and the run instructions): the
  // description, goal and users wherever they are recorded (the Project brief note, the business analyst's answers)
  const d = detailsFromRow(row);
  const approver = str(row.ApprovalOwnerUserId);
  const about = briefFactsOf(p);
  const s = {
    goal: about.goal,
    targetUsers: about.targetUsers,
    mustHaves: d.mustHaves,
    workflows: d.workflows,
    exclusions: d.exclusions,
    constraints: d.constraints,
    intendedChanges: d.intendedChanges.trim(),
    changeTags: d.changeTags,
    approvalOwnerUserId: approver,
    approvalOwnerName: approver ? p.personName(approver) : "",
  };
  const basics: Basics = {
    name: p.name,
    client: p.client,
    industry: p.industry,
    region: str(row.ClientRegion),
    existing: p.existingProduct,
    repoName: p.repo.name,
    description: clip(about.description, 4000),
    goal: clip(s.goal, 2000),
    targetUsers: clip(s.targetUsers, 2000),
    mustHaves: s.mustHaves.map((m) => ({ text: clip(m.text, 500), priority: m.priority })),
    workflows: s.workflows.map((w) => clip(w, 500)),
    exclusions: s.exclusions.map((w) => clip(w, 500)),
    constraints: s.constraints.map((c) => ({ kind: c.kind, text: clip(c.text, 500) })),
    intendedChanges: clip(s.intendedChanges, 2000),
    changeTags: s.changeTags,
    approvalOwnerUserId: s.approvalOwnerUserId,
    approvalOwnerName: s.approvalOwnerName,
    stage: str(row.Stage),
    status: str(row.Status),
    setupStatus: str(row.SetupStatus),
    appUrl: str(row.AppUrl),
    websiteUrl: str(row.WebsiteUrl),
    handedOverAt: str(row.BusinessHandedOverAt),
    requirementsConfirmedAt: str(row.RequirementsConfirmedAt),
    scopeLockedAt: str(row.ScopeLockedAt),
    currency: "",
    facts: {},
    blocksProjectId: str(row.BlocksProjectRef),
    blocksProjectDomain: str(row.BlocksProjectDomain),
    blocksProvisioningStatus: str(row.BlocksProvisioningStatus),
  };

  const notes: NoteItem[] = p.notes().map((n) => ({
    ref: ref("DocNote", n),
    title: clip(str(n.Title), 200),
    body: clip(str(n.BodyMd), 4000),
    by: str(n.CreatedByUserId),
    isProjectBrief: n.IsProjectBrief === true,
  }));
  const files: FileItem[] = p.rows("DocFile").map((f) => ({
    ref: ref("DocFile", f),
    name: str(f.Name),
    mime: str(f.Mime),
    status: str(f.Status),
    ready: f.Status === "ready",
    by: str(f.CreatedByUserId),
    storageObjectId: str(f.StorageObjectId),
    sizeBytes: num(f.SizeBytes),
    extraction: extractionOf(kbDir, f),
  }));
  const suggestions = p.rows("SetupSuggestion").map((x) => ({
    ref: ref("SetupSuggestion", x), kind: str(x.Kind), text: clip(str(x.Text), 400), status: str(x.Status), source: str(x.SourceRef), sourceName: str(x.SourceName), job: str(x.EngineJobId),
  }));
  // the files people attached to their answers, change requests, chat messages and feedback (the newest 60)
  const attachments: AttachmentItem[] = p.rows("Attachment")
    .filter(attachedFile)
    .sort((a, b) => str(a.CreatedDate).localeCompare(str(b.CreatedDate)) || str(a.ItemId).localeCompare(str(b.ItemId)))
    .slice(-60)
    .map((a) => ({
      ref: ref("Attachment", a),
      name: clip(str(a.FileName) || "file", 200),
      mime: str(a.Mime),
      sizeBytes: num(a.SizeBytes),
      kind: str(a.Kind),
      owner: `${attachmentOwnerSchema(str(a.OwnerType))}:${str(a.OwnerId)}`,
      ownerType: str(a.OwnerType),
      by: str(a.CreatedByUserId),
      at: str(a.CreatedDate),
    }));

  const clarifications = p.clarifications().map((c) => ({
    ref: ref("Clarification", c),
    number: num(c.Number),
    question: clip(str(c.Question), 600),
    answer: clip(str(c.Answer), 1500),
    status: str(c.Status),
    deferReason: clip(str(c.DeferReason), 300),
    owner: str(c.OwnerUserId),
    source: str(c.SourceType) && str(c.SourceRef) ? `${str(c.SourceType)}:${str(c.SourceRef)}` : str(c.SourceType),
    answeredBy: str(c.AnsweredByUserId),
    answeredAt: str(c.AnsweredAt),
    // a conflict question (answers.ts): the answer it confirms or corrects
    ...(confirmedIdOf(str(c.RequestKey)) ? { confirms: `Clarification:${confirmedIdOf(str(c.RequestKey))}` } : {}),
  }));

  const o = p.objective();
  const objective = o
    ? { ref: ref("Objective", o), statement: clip(str(o.Statement), 1500), acceptance: list(o.AcceptanceCriteria).map((a) => clip(a, 300)), status: str(o.Status), specVersion: num(o.SpecVersion), confirmedAt: str(o.ConfirmedAt) }
    : null;
  const requirements = p.requirements().map((r) => ({
    ref: ref("Requirement", r),
    number: num(r.Number),
    key: str(r.Key),
    title: clip(str(r.Title), 200),
    text: clip(str(r.Text), 800),
    category: str(r.Category),
    priority: str(r.Priority),
    status: str(r.Status),
    acceptance: list(r.AcceptanceCriteria).map((a) => clip(a, 300)).slice(0, 8),
    sourceRefs: list(r.SourceRefs),
    specVersion: num(r.SpecVersion),
  }));
  const extras = p.rows("RequirementExtra").map((x) => ({ ref: ref("RequirementExtra", x), kind: str(x.Kind), title: clip(str(x.Title), 200), status: str(x.Status), origin: str(x.Origin) }));

  const current = p.scopeVersion;
  const versionRows = p.rows("ScopeVersion").sort((a, b) => num(a.Number) - num(b.Number));
  const versions: ScopeVersionItem[] = versionRows.map((v) => {
    const n = num(v.Number);
    return {
      ref: ref("ScopeVersion", v),
      number: n,
      title: clip(str(v.Title), 200),
      status: str(v.Status),
      lockedAt: str(v.LockedAt),
      unlockedAt: str(v.UnlockedAt),
      lockedByUserId: str(v.LockedByUserId),
      planHours: num(v.PlanHours),
      successTargets: clip(str(v.SuccessTargets), 1500),
      features: p.features(n).map((f) => ({
        ref: ref("Feature", f),
        key: str(f.Key),
        title: clip(str(f.Title), 200),
        description: clip(str(f.Description), 500),
        priority: str(f.Priority),
        status: str(f.Status),
        requirementRefs: list(f.RequirementRefs),
        stories: p.storiesOf(str(f.Key), n).map((st) => ({
          ref: ref("Story", st), key: str(st.Key), title: clip(str(st.Title), 200), actor: str(st.ActorRole), priority: str(st.Priority), hours: num(st.EstimateHours),
          acceptance: list(st.AcceptanceCriteria).map((a) => clip(a, 200)).slice(0, 6),
        })),
      })),
    };
  });
  const locked = [...versions].reverse().find((v) => v.status === "locked");

  const milestones = p.rows("Milestone")
    .sort((a, b) => num(a.ScopeVersion) - num(b.ScopeVersion) || num(a.SortOrder) - num(b.SortOrder) || num(a.Number) - num(b.Number))
    .map((m) => ({
      ref: ref("Milestone", m), scopeVersion: num(m.ScopeVersion, 1), number: num(m.Number), name: clip(str(m.Name), 200), goal: clip(str(m.Goal), 500),
      featureRefs: list(m.FeatureRefs), previewPoint: clip(str(m.PreviewPoint), 300), status: str(m.Status), acceptedAt: str(m.AcceptedAt), job: str(m.EngineJobId),
    }));

  const tickets = p.tickets().map((t) => ({
    ref: ref("Ticket", t), number: num(t.Number), title: clip(str(t.Title), 200), type: str(t.TicketType), column: str(t.Column), done: t.IsDone === true,
    milestone: str(t.MilestoneId) ? `Milestone:${str(t.MilestoneId)}` : "", feature: str(t.FeatureRef), story: str(t.StoryRef), role: str(t.AgentRole),
    hours: num(t.EstimateHours), dependsOn: list(t.DependsOn), acceptance: list(t.Acceptance).map((a) => clip(a, 200)).slice(0, 6), source: str(t.Source),
    changeRequest: str(t.ChangeRequestId) ? `ChangeRequest:${str(t.ChangeRequestId)}` : "", job: str(t.EngineJobId),
  }));

  const previews = p.rows("Preview").map((x) => ({
    ref: ref("Preview", x), milestone: str(x.MilestoneId) ? `Milestone:${str(x.MilestoneId)}` : "", environment: str(x.Environment), version: str(x.Version), url: str(x.Url), status: str(x.Status), readyAt: str(x.ReadyAt), job: str(x.EngineJobId),
  }));
  const releases = p.releases().map((x) => ({
    ref: ref("Release", x), environment: str(x.Environment), version: str(x.Version), url: str(x.Url), status: str(x.Status), releasedAt: str(x.ReleasedAt), releasedBy: str(x.ReleasedByUserId),
    milestone: str(x.MilestoneId) ? `Milestone:${str(x.MilestoneId)}` : "", changeRequests: list(x.ChangeRequestIds).map((id) => `ChangeRequest:${id}`), job: str(x.EngineJobId),
  }));

  const decisions = p.rows("Decision").sort((a, b) => num(a.Number) - num(b.Number)).map((d) => ({
    ref: ref("Decision", d), number: num(d.Number), title: clip(str(d.Title), 200), statement: clip(str(d.Statement), 800), rationale: clip(str(d.Rationale), 500), status: str(d.Status),
    clarification: str(d.ClarificationId) ? `Clarification:${str(d.ClarificationId)}` : "", source: str(d.SourceRef), decidedBy: str(d.DecidedByUserId), decidedAt: str(d.DecidedAt),
  }));
  const tech = p.techDecisions().map((d) => ({
    ref: ref("TechDecision", d), number: num(d.Number), area: str(d.Area), title: clip(str(d.Title), 200), choice: clip(str(d.Choice), 500), rationale: clip(str(d.Rationale), 500), status: str(d.Status), decidedAt: str(d.DecidedAt),
  }));
  const changeRequests = p.changeRequests().map((c) => ({
    ref: ref("ChangeRequest", c), number: num(c.Number), title: clip(str(c.Title), 200), description: clip(str(c.Description), 600), status: str(c.Status), lane: str(c.Lane), version: str(c.Version), job: str(c.EngineJobId),
  }));
  const chat = [
    ...p.rows("AgentChatMessage").map((m) => ({ row: m, schema: "AgentChatMessage" })),
    ...p.rows("AssistantMessage").map((m) => ({ row: m, schema: "AssistantMessage" })),
  ]
    .sort((a, b) => byAt(a.row, b.row))
    .slice(-40)
    .map(({ row: m, schema }) => ({
      ref: ref(schema, m), thread: schema === "AgentChatMessage" ? `agent:${str(m.AgentRole)}` : `assistant:${str(m.Environment)}`, role: str(m.Role), kind: str(m.Kind),
      text: clip(str(m.Text), 500), by: str(m.AuthorUserId), at: str(m.At), job: str(m.EngineJobId),
    }));

  // the project's own currency: what its material names (the client's words first, then what was drafted from them).
  // The setup is the project row's own words: the Project brief note and the analyst's answers are read as themselves
  // below, so an answer is never also counted as a setup document (no conflict of an answer with itself).
  const setupWords = [p.brief, str(row.Goal).trim(), str(row.TargetUsers).trim()];
  const factTexts = [
    ...setupWords, ...s.mustHaves.map((m) => m.text), ...s.constraints.map((c) => c.text),
    ...p.notes().map((n) => `${str(n.Title)}\n${str(n.BodyMd)}`),
    ...files.map((f) => fullTextOf(kbDir, f)),
    ...p.clarifications().map((c) => `${str(c.Question)} ${str(c.Answer)}`),
    ...p.rows("Decision").map((d) => `${str(d.Title)} ${str(d.Statement)}`),
    ...p.requirements().map((r) => `${str(r.Title)} ${str(r.Text)} ${list(r.AcceptanceCriteria).join(" ")}`),
  ];
  // the client's answers first (facts.ts resolveProjectFacts): what an answer or an accepted decision states wins over
  // the documents and the drafts; every difference is kept as a conflict for the client to confirm
  const factAnswers: FactAnswer[] = [
    ...effectiveAnswers(clarifications.map((c) => ({ ...c, confirms: (c as { confirms?: string }).confirms }))).map((a) => ({ ref: a.ref, number: a.number, question: a.question, answer: a.answer })),
    ...p.rows("Decision").filter((d) => d.Status === "accepted").sort((a, b) => num(a.Number) - num(b.Number))
      .map((d) => ({ ref: ref("Decision", d), number: num(d.Number), question: str(d.Title), answer: str(d.Statement), kind: "decision" as const })),
  ];
  const resolved = resolveProjectFacts({
    answers: factAnswers,
    documents: [
      { text: [...setupWords, ...s.mustHaves.map((m) => m.text), ...s.constraints.map((c) => c.text)].filter(Boolean).join("\n"), ref: "", name: "the project setup" },
      ...p.notes().map((n) => ({ text: `${str(n.Title)}\n${str(n.BodyMd)}`, ref: ref("DocNote", n), name: `the note “${str(n.Title) || "untitled"}”` })),
      ...files.map((f) => ({ text: fullTextOf(kbDir, f), ref: f.ref, name: `the file “${f.name}”` })),
    ],
    drafted: [
      ...p.rows("Decision").filter((d) => d.Status !== "accepted").map((d) => `${str(d.Title)} ${str(d.Statement)}`),
      ...p.requirements().map((r) => `${str(r.Title)} ${str(r.Text)} ${list(r.AcceptanceCriteria).join(" ")}`),
      // the technical decisions last: drafted from the rest
      ...p.rows("TechDecision").filter((t) => t.Status !== "rejected").map((t) => `${str(t.Title)}. ${str(t.Choice)}`),
    ],
    region: basics.region,
    currency: currencyCodeIn(factTexts),
  });
  basics.currency = resolved.facts.currency ?? "";
  basics.facts = resolved.facts;
  if (resolved.conflicts.length) basics.factConflicts = resolved.conflicts;

  // the look and feel and the current screens (a screen's newer version replaces it: superseded ones are left out)
  const db = p.designBrief();
  const screens = p.screens()
    .sort((a, b) => num(a.SortOrder) - num(b.SortOrder) || str(a.Key).localeCompare(str(b.Key)) || num(a.Version) - num(b.Version))
    .map((x) => ({ ref: ref("DesignScreen", x), key: str(x.Key), name: clip(str(x.Name), 200), version: num(x.Version), status: str(x.Status), job: str(x.EngineJobId) }));
  const make = db && str(db.Mode) === "figma" ? parseProductPrototype(db.PrototypeJson) : null;
  const design: DesignSection | null = db || screens.length
    ? {
        brief: db
          ? {
              ref: ref("DesignBrief", db),
              mode: str(db.Mode),
              instructions: clip(str(db.Instructions), 600),
              status: str(db.Status),
              confirmedAt: str(db.ConfirmedAt),
              ...(str(db.Mode) === "figma" ? { make: make ? { provider: make.provider, revision: make.revision, source: make.source, projectUrl: make.projectUrl, artifactFileId: make.artifactFileId, jobId: make.jobId,
                ...(make.provider === 'figma-design' ? { reviewComplete: make.reviewComplete !== false, screens: make.screens.map(({ name, nodeId, requirementKeys }) => ({ name, nodeId, requirementKeys })) } : {}) } : null } : {}),
            }
          : null,
        screens,
      }
    : null;
  const feedback = feedbackSectionOf(p);

  return {
    basics,
    sources: { notes, files, suggestions, brief: briefSummary(kbDir), attachments },
    clarifications,
    requirements: { objective, items: requirements, extras },
    scope: { current, locked: locked ? locked.number : null, versions },
    milestones,
    tickets,
    builds: buildsOf(readProjectJson(i.projectDir)),
    previews,
    releases,
    decisions: { decisions, tech, changeRequests, chat },
    ...(design ? { design } : {}),
    ...(feedback ? { feedback } : {}),
  };
}
