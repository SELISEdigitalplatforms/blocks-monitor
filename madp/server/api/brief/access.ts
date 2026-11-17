/**
 * The project's own facts for the brief, read with the signed-in person's access.
 *
 * In Blocks mode the host hands the brief routes a `CallerReads` port: the same path as POST /api/data (session cookie,
 * IAM check, S1 catalogue validation, Data Gateway GraphQL with the caller's own token). A project the caller cannot
 * read is simply not returned, so every brief route answers 404 for it. Local mode passes no port and keeps the
 * knowledge-base answers (form-answers.json).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { detailsFromRow } from "../../../src/domain/setupDetails.ts";
import { briefFacts } from "../../../src/domain/projectBrief.ts";
import { BRIEF_ANSWER_SCHEMA, decisionsFromAnswers, isBriefAnswer, type BriefDecisionSet } from "../../../src/domain/briefDecisions.ts";
import { parseOutputRef } from "../../../src/domain/engineJob.ts";

export interface DataRead {
  schema: string;
  fields: string[];
  filter?: ({ field: string; op: "eq"; value: string | number | boolean } | { field: string; op: "in"; values: (string | number | boolean)[] })[];
  sort?: { field: string; dir: "asc" | "desc" }[];
  pageNo: number;
  /** At most 100 (server/fnHost/dataRead.ts MAX_PAGE_SIZE). */
  pageSize: number;
}

/** One read's answer; `totalCount` is the gateway's count of every matching row (null or absent when it gave none). */
export type CallerReadPart = { ok: true; items: Record<string, unknown>[]; totalCount?: number | null } | { ok: false };
export type CallerReadResult = { ok: true; userId: string; results: CallerReadPart[] } | { ok: false; status: number };

/** Reads Data Gateway rows as the signed-in caller (the host's POST /api/data path). */
export type CallerReads = (req: IncomingMessage, res: ServerResponse, reads: DataRead[]) => Promise<CallerReadResult>;

export type CallerOpResult = { ok: true; data: unknown } | { ok: false; status: number; code: string };
/** Runs one op of the project function as the signed-in caller (the same router, permission checks and stamps as
 *  POST /api/fn/project): the brief routes write people's decisions through it. */
export type CallerOp = (req: IncomingMessage, res: ServerResponse, op: string, args: Record<string, unknown>) => Promise<CallerOpResult>;

export interface FactFile { id: string; name: string; mime: string; ready: boolean }

/** The MADP engine's latest reading of one file (its file.extract job; the engine reads files on the engine host). */
export interface FactReading {
  fileId: string;
  jobId: string;
  status: "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled";
  /** The Storage object with what the engine found (a succeeded reading); "" otherwise. */
  objectId: string;
  message: string;
  errorCode: string;
  at: string;
}

/** Blocks mode: what the engine read and what people decided, from the project's rows. */
export interface BlocksFacts {
  readings: FactReading[];
  decisions: BriefDecisionSet;
}

/** What the guided start and the material say about the project, in plain values. */
export interface ProjectFacts {
  id: string;
  workspaceId: string;
  name: string;
  existing: boolean;
  /** What the project is about, its goal and its users wherever they are recorded, as every agent reads them
   *  (projectBrief briefFacts): the project's own fields first; the description else from the Project brief note
   *  ("About the project"), the goal and the users else the answers to the business analyst's own brief questions
   *  (Clarification rows after the hand-over). Project Setup has not asked for the goal and the users since 08.11. */
  about: string;
  goal: string;
  targetUsers: string;
  /** The business analyst's drafted objective statement ("" before there is one): the brief's objective while the goal
   *  is not recorded (briefObjective, as Business Analysis shows it). Not one of the client's answers. */
  objective: string;
  mustHaves: { text: string; priority: string }[];
  workflows: string[];
  exclusions: string[];
  constraints: { kind: string; text: string }[];
  changes: string[];
  /** The project's files (uploaded and still uploading). */
  files: FactFile[];
  /** The signed-in person who asked. */
  userId: string;
  /** Blocks mode only (read as the caller): the engine's readings and people's decisions. */
  blocks?: BlocksFacts;
}

export type FactsResult = { ok: true; facts: ProjectFacts } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Engine folder ids (DEMO-SCOPE-31.10.md): checked before any path is made. */
const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Blocks item ids are lower-case UUIDs (links may carry them upper-case). */
export const blocksItemId = (id: string): string => (UUID.test(id) ? id.toLowerCase() : id);

/** Which project's knowledge base: <MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/artifacts/brief. */
export interface KbKey { workspaceId: string; projectId: string }

/** A valid key with both ids in their stored form; throws when an id is not a safe folder name. */
export function kbKey(workspaceId: string, projectId: string): KbKey {
  const ws = typeof workspaceId === "string" ? blocksItemId(workspaceId) : "";
  const pid = typeof projectId === "string" ? blocksItemId(projectId) : "";
  if (!FOLDER_ID.test(ws)) throw new Error("Invalid workspace identifier.");
  if (!FOLDER_ID.test(pid)) throw new Error("Invalid project identifier.");
  return { workspaceId: ws, projectId: pid };
}

/** Local mode has no Blocks workspace at hand: its briefs live under this workspace folder. */
export const LOCAL_WORKSPACE = "local";

const PROJECT_FIELDS = [
  "WorkspaceId", "Name", "Goal", "TargetUsers", "RepoMode", "Brief", "SetupMustHaves", "SetupWorkflows", "SetupExclusions", "SetupConstraints",
  "IntendedChanges", "IntendedChangeTags",
];

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function projectReads(projectId: string): DataRead[] {
  const id = blocksItemId(projectId);
  return [
    { schema: "Project", fields: PROJECT_FIELDS, filter: [{ field: "ItemId", op: "eq", value: id }], pageNo: 1, pageSize: 1 },
    { schema: "DocFile", fields: ["Name", "Mime", "Status"], filter: [{ field: "ProjectId", op: "eq", value: id }, { field: "Status", op: "in", values: ["pending", "ready"] }], pageNo: 1, pageSize: 100 },
    { schema: "DocNote", fields: ["Title", "BodyMd", "IsProjectBrief", "IsScratchPad"], filter: [{ field: "ProjectId", op: "eq", value: id }, { field: "Title", op: "eq", value: "Project brief" }], pageNo: 1, pageSize: 5 },
    // the newest readings first (a file's latest one is what counts)
    { schema: "EngineJob", fields: READING_FIELDS, filter: [{ field: "ProjectId", op: "eq", value: id }, { field: "Kind", op: "eq", value: READING_KIND }], sort: [{ field: "CreatedDate", dir: "desc" }], pageNo: 1, pageSize: 100 },
    { schema: BRIEF_ANSWER_SCHEMA, fields: ["QuestionKey", "OptionId", "Text", "UpdatedByUserId", "CreatedByUserId", "LastUpdatedDate"], filter: [{ field: "ProjectId", op: "eq", value: id }], pageNo: 1, pageSize: 100 },
    // where the goal and the users are recorded since 08.11 (briefFacts): the answered questions, in their order, and
    // the business analyst's drafted objective
    { schema: "Clarification", fields: ["Number", "Question", "Answer", "Status"], filter: [{ field: "ProjectId", op: "eq", value: id }, { field: "Status", op: "eq", value: "answered" }], sort: [{ field: "Number", dir: "asc" }], pageNo: 1, pageSize: 100 },
    { schema: "Objective", fields: ["Statement"], filter: [{ field: "ProjectId", op: "eq", value: id }], pageNo: 1, pageSize: 1 },
  ];
}

const READING_KIND = "file.extract";
/** The TargetType of a reading (EngineJob.TargetType is lower-case kebab: ^(|[a-z][a-z0-9-]{0,39})$). */
const READING_TARGET = "doc-file";
const READING_FIELDS = ["TargetType", "TargetId", "Status", "OutputRefs", "Message", "ErrorCode", "CreatedDate", "FinishedAt"];
const JOB_STATUSES = new Set(["queued", "claimed", "running", "succeeded", "failed", "cancelled"]);

/** Pure: the latest file.extract job of each file (by when it was queued). */
export function readingsFromJobs(jobs: readonly Record<string, unknown>[]): FactReading[] {
  const queuedAt = (j: Record<string, unknown>) => Date.parse(text(j.CreatedDate)) || 0;
  const latest = new Map<string, FactReading>();
  for (const j of [...jobs].sort((a, b) => queuedAt(a) - queuedAt(b))) {
    const fileId = text(j.TargetId);
    const status = text(j.Status);
    if (!fileId || text(j.TargetType) !== READING_TARGET || !JOB_STATUSES.has(status) || typeof j.ItemId !== "string") continue;
    const object = (Array.isArray(j.OutputRefs) ? j.OutputRefs : []).map(parseOutputRef).find((r) => r?.schema === "StorageObject");
    const reading: FactReading = {
      fileId: blocksItemId(fileId), jobId: j.ItemId, status: status as FactReading["status"],
      objectId: status === "succeeded" && object ? object.id : "",
      message: text(j.Message), errorCode: text(j.ErrorCode), at: text(j.FinishedAt) || text(j.CreatedDate),
    };
    const prev = latest.get(blocksItemId(fileId));
    if (prev?.status === "succeeded" && prev.objectId && status === "failed" && !object) {
      continue;
    }
    latest.set(blocksItemId(fileId), reading);
  }
  return [...latest.values()];
}

/** The records besides the project row, its files and its notes that hold the goal and the users. */
export interface FactRecords {
  /** The project's Clarification rows (only the answers to the business analyst's own brief questions are read). */
  clarifications?: readonly Record<string, unknown>[];
  /** The project's Objective row (its drafted statement is the brief's objective while the goal is not recorded). */
  objective?: Record<string, unknown> | null;
}

/** Pure: the facts from the reads (project row, files, the Project brief note, the answered questions, the objective). */
export function factsFromRows(projectId: string, userId: string, project: Record<string, unknown>, files: Record<string, unknown>[], notes: Record<string, unknown>[], records: FactRecords = {}): ProjectFacts {
  const d = detailsFromRow(project);
  // the description, goal and users as every agent reads them (the Business Analysis page and the engine kinds)
  const f = briefFacts(project, { notes, clarifications: records.clarifications });
  return {
    id: blocksItemId(projectId),
    workspaceId: text(project.WorkspaceId),
    name: text(project.Name),
    existing: project.RepoMode === "existing",
    about: f.description,
    goal: f.goal,
    targetUsers: f.targetUsers,
    objective: text(records.objective?.Statement),
    mustHaves: d.mustHaves.map((m) => ({ text: m.text, priority: m.priority })),
    workflows: d.workflows,
    exclusions: d.exclusions,
    constraints: d.constraints.map((c) => ({ kind: c.kind, text: c.text })),
    changes: [...d.changeTags, d.intendedChanges.trim()].filter(Boolean),
    files: files
      .filter((f) => typeof f.ItemId === "string" && typeof f.Name === "string")
      .map((f) => ({ id: f.ItemId as string, name: f.Name as string, mime: text(f.Mime), ready: f.Status === "ready" })),
    userId,
  };
}

/** A list read at the full page size (100) wants every row: its later pages are read when its count says there are
 *  more, up to this many pages per list. */
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 20;
/** At most this many reads in one request (server/fnHost/dataRead.ts MAX_READS). */
const MAX_READS_PER_REQUEST = 40;

/** The answers with the later pages of every full-page list whose count says it holds more (one more request per 40
 *  pages), appended in page order; null when one of those reads fails (the brief is never built from part of a list). */
export async function withLaterPages(reads: CallerReads, req: IncomingMessage, res: ServerResponse, asked: readonly DataRead[], first: readonly CallerReadPart[]): Promise<CallerReadPart[] | null> {
  const later: { index: number; read: DataRead }[] = [];
  asked.forEach((read, index) => {
    const part = first[index];
    if (read.pageSize !== LIST_PAGE_SIZE || !part?.ok || typeof part.totalCount !== "number") return;
    const last = Math.min(MAX_LIST_PAGES, Math.ceil(part.totalCount / read.pageSize));
    for (let pageNo = read.pageNo + 1; pageNo <= last; pageNo += 1) later.push({ index, read: { ...read, pageNo } });
  });
  const out = first.map((p) => (p.ok ? { ...p, items: [...p.items] } : p));
  for (let i = 0; i < later.length; i += MAX_READS_PER_REQUEST) {
    const chunk = later.slice(i, i + MAX_READS_PER_REQUEST);
    const answer = await reads(req, res, chunk.map((c) => c.read));
    if (!answer.ok) return null;
    for (let j = 0; j < chunk.length; j += 1) {
      const part = answer.results[j];
      const target = out[chunk[j]!.index];
      if (!part?.ok || !target?.ok) return null;
      const seen = new Set(target.items.map((r) => r.ItemId).filter((id): id is string => typeof id === "string"));
      for (const r of part.items) if (typeof r.ItemId !== "string" || !seen.has(r.ItemId)) target.items.push(r);
    }
  }
  return out;
}

/** Read the project, its files, its brief note and where its goal and users are recorded as the caller. 404 when the
 *  caller cannot read the project. */
export async function readProjectFacts(reads: CallerReads, req: IncomingMessage, res: ServerResponse, projectId: string): Promise<FactsResult> {
  let answer: CallerReadResult;
  let results: CallerReadPart[] | null;
  try {
    const asked = projectReads(projectId);
    answer = await reads(req, res, asked);
    results = answer.ok ? await withLaterPages(reads, req, res, asked, answer.results) : null;
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
  if (!answer.ok) return { ok: false, status: answer.status, error: answer.status === 401 ? "unauthenticated" : answer.status === 403 ? "forbidden" : "unavailable" };
  if (!results) return { ok: false, status: 503, error: "unavailable" };
  const [project, files, notes, jobs, answers, asked, objective] = results;
  if (!project?.ok) return { ok: false, status: 503, error: "unavailable" };
  const row = project.items[0];
  if (!row) return { ok: false, status: 404, error: "not_found" };
  // the files, the brief note, the readings, the decisions, the answered questions and the objective are part of the
  // brief: never build it from a partial answer (a failed read of the files once answered "no files")
  if (!files?.ok || !notes?.ok || !jobs?.ok || !answers?.ok || !asked?.ok || !objective?.ok) return { ok: false, status: 503, error: "unavailable" };
  const facts = factsFromRows(projectId, answer.userId, row, files.items, notes.items,
    { clarifications: asked.items, objective: objective.items[0] ?? null });
  facts.blocks = { readings: readingsFromJobs(jobs.items), decisions: decisionsFromAnswers(answers.items.filter((a) => isBriefAnswer(a.QuestionKey))) };
  return { ok: true, facts };
}

/** The knowledge-base form answers (read by the brief builder and the project-brief MCP tools). */
export function formAnswersFromFacts(f: ProjectFacts): Record<string, unknown> {
  return {
    name: f.name,
    kind: f.existing ? "existing" : "new",
    description: f.about,
    goal: f.goal,
    targetUsers: f.targetUsers,
    mustHaves: f.mustHaves,
    workflows: f.workflows,
    exclusions: f.exclusions,
    constraints: f.constraints,
    intendedChanges: f.changes,
    files: f.files.filter((x) => x.ready).map((x) => ({ fileId: x.id, name: x.name, mimeType: x.mime })),
  };
}
